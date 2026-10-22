import { TypedEmitter } from "./events.ts";
import { FlackleGatewayError } from "./errors.ts";
import type { RestClient } from "./rest.ts";
import type {
  GatewayEvents,
  HelloPayload,
  Message,
  PresenceStatus,
  SelfUser,
  Snowflake,
} from "./types.ts";

interface BunWebSocketOptions {
  headers?: Record<string, string>;
  proxy?: string;
  tls?: Record<string, unknown>;
}

export interface GatewayOptions {
  /** Reconnect automatically after an unexpected close. */
  autoReconnect?: boolean;
  /** How often to send `ping`. */
  heartbeatIntervalMs?: number;
  /** How long to wait for any frame after a ping before forcing a reconnect. */
  heartbeatTimeoutMs?: number;
  /** Consecutive reconnect attempts before giving up. */
  maxReconnectAttempts?: number;
  /** Origin header; Flackle's gateway rejects requests without a browser origin. */
  origin?: string;
  userAgent?: string;
  /** Supplies the current user so `ready` can include it. */
  getUser?: () => SelfUser | undefined;
}

type Packet = { type: string; payload: any };

const WS_OPEN = 1;

/**
 * Flackle's realtime gateway.
 *
 * The wire format is newline-delimited JSON (`{ "type": "...", "payload": {...} }`).
 * A connection is authenticated with a short-lived ticket from `/api/ws/url`.
 */
export class Gateway extends TypedEmitter<GatewayEvents> {
  readonly rest: RestClient;
  readonly origin: string;
  readonly userAgent: string;

  socket: WebSocket | null = null;
  isConnected = false;
  sessionId?: string;
  ping = -1;
  user?: SelfUser;

  readonly #autoReconnect: boolean;
  readonly #heartbeatIntervalMs: number;
  readonly #heartbeatTimeoutMs: number;
  readonly #maxReconnectAttempts: number;
  readonly #getUser?: () => SelfUser | undefined;

  #manualClose = false;
  #reconnectAttempts = 0;
  #fastReconnects = 0;
  #reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  #heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  #heartbeatDeadline: ReturnType<typeof setTimeout> | null = null;
  #lastActivity = 0;
  #pingSentAt = 0;
  #idle = false;
  #openPromise: Promise<void> | null = null;
  #subscribedServers: Snowflake[] = [];
  #connectResolve: (() => void) | null = null;
  #connectReject: ((error: Error) => void) | null = null;

  constructor(rest: RestClient, options: GatewayOptions = {}) {
    super();
    this.rest = rest;
    this.origin = options.origin ?? rest.baseUrl;
    this.userAgent = options.userAgent ?? rest.userAgent;
    this.#autoReconnect = options.autoReconnect ?? true;
    this.#heartbeatIntervalMs = options.heartbeatIntervalMs ?? 45_000;
    this.#heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? 20_000;
    this.#maxReconnectAttempts = options.maxReconnectAttempts ?? 10;
    this.#getUser = options.getUser;
  }

  get latency(): number {
    return this.ping;
  }

  get subscribedServers(): readonly Snowflake[] {
    return this.#subscribedServers;
  }

  /** Connects and resolves once the gateway's `hello` frame arrives. */
  async connect(): Promise<void> {
    if (this.isConnected) return;
    if (this.socket && this.socket.readyState === 0) {
      return this.#openPromise ?? Promise.resolve();
    }
    if (this.#openPromise) return this.#openPromise;

    this.#manualClose = false;
    this.#openPromise = this.#open().finally(() => {
      this.#openPromise = null;
    });
    return this.#openPromise;
  }

  async #open(): Promise<void> {
    const { url, ticket } = await this.rest.get<{ url: string; ticket: string }>("/api/ws/url");
    if (!url || !ticket) throw new FlackleGatewayError("Gateway did not return a URL and ticket");

    const endpoint = `${url}?ticket=${encodeURIComponent(ticket)}`;
    // Bun's WebSocket accepts a headers option. Browsers cannot set Origin, so
    // this client is meant to run under Bun (or another runtime that allows it).
    const options: BunWebSocketOptions = {
      headers: {
        Origin: this.origin,
        "User-Agent": this.userAgent,
      },
    };

    const ws = new WebSocket(endpoint, options as unknown as string[]);
    this.socket = ws;

    const opened = new Promise<void>((resolve, reject) => {
      this.#connectResolve = resolve;
      this.#connectReject = reject;
    });

    const timeout = setTimeout(() => {
      this.#failConnect(new FlackleGatewayError("Timed out waiting for the gateway hello frame"));
      try {
        ws.close(4000, "hello timeout");
      } catch {
        // ignore
      }
    }, 15_000);

    ws.onopen = () => {
      if (this.socket !== ws) return;
      this.#lastActivity = Date.now();
      this.#reconnectAttempts = 0;
      this.#fastReconnects = 0;
      this.#startHeartbeat();
      this.#send("set_idle", { idle: this.#idle });
      if (this.#subscribedServers.length > 0) {
        this.#send("subscribe_servers", { server_ids: this.#subscribedServers });
      }
      this.emit("connected", undefined);
    };

    ws.onmessage = (event) => {
      if (this.socket !== ws) return;
      this.#handleMessage(String((event as MessageEvent).data));
    };

    ws.onerror = () => {
      if (this.socket !== ws) return;
      this.#failConnect(new FlackleGatewayError("Gateway socket error"));
      try {
        ws.close();
      } catch {
        // ignore
      }
    };

    ws.onclose = (event) => {
      if (this.socket !== ws) return;
      clearTimeout(timeout);
      this.socket = null;
      this.isConnected = false;
      this.#stopHeartbeat();
      this.emit("disconnected", { code: event.code, reason: event.reason });

      if (this.isConnected || this.#connectResolve) {
        // The hello never arrived.
        this.#failConnect(
          new FlackleGatewayError(`Gateway closed before hello (${event.code} ${event.reason})`, event.code),
        );
      }

      if (event.code === 4001 || event.code === 1000) {
        // 4001 = session replaced/closed by the server; do not fight it.
        this.#manualClose = true;
      }
      if (event.code === 1012) this.#fastReconnects = 8;

      this.#scheduleReconnect();
    };

    try {
      await opened;
    } finally {
      clearTimeout(timeout);
    }
  }

  #handleMessage(raw: string): void {
    this.#lastActivity = Date.now();
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let packet: Packet;
      try {
        packet = JSON.parse(trimmed) as Packet;
      } catch {
        continue;
      }
      if (!packet || typeof packet.type !== "string") continue;
      this.emit("raw", { type: packet.type, payload: packet.payload });
      try {
        this.#dispatch(packet.type, packet.payload);
      } catch (error) {
        this.emit("error", error instanceof Error ? error : new Error(String(error)));
      }
    }
  }

  #dispatch(type: string, payload: any): void {
    switch (type) {
      case "hello": {
        const hello = payload as HelloPayload;
        this.sessionId = hello.session_id;
        this.isConnected = true;
        this.user = this.#getUser?.();
        this.ping = 0;
        this.emit("ready", { ...hello, user: this.user });
        this.#connectResolve?.();
        this.#connectResolve = null;
        this.#connectReject = null;
        return;
      }

      case "pong":
        return;

      case "new_message": {
        const message = payload as Message;
        this.emit("messageCreate", {
          message,
          conversationId: message.conversation_id ?? undefined,
        });
        return;
      }

      case "channel_message": {
        this.emit("messageCreate", {
          message: payload.message as Message,
          serverId: payload.server_id,
          channelId: payload.channel_id,
        });
        return;
      }

      case "message_edited": {
        this.emit("messageUpdate", {
          message: { id: payload.message_id, conversation_id: payload.conversation_id, content: payload.content, edited_at: payload.edited_at },
          conversationId: payload.conversation_id,
        });
        return;
      }

      case "channel_message_edited": {
        this.emit("messageUpdate", {
          message: { id: payload.message_id, content: payload.content, edited_at: payload.edited_at },
          serverId: payload.server_id,
          channelId: payload.channel_id,
        });
        return;
      }

      case "message_deleted": {
        this.emit("messageDelete", {
          id: payload.message_id,
          conversationId: payload.conversation_id,
        });
        return;
      }

      case "channel_message_deleted": {
        this.emit("messageDelete", {
          id: payload.message_id,
          serverId: payload.server_id,
          channelId: payload.channel_id,
        });
        return;
      }

      case "channel_messages_bulk_deleted": {
        this.emit("messagesBulkDelete", {
          ids: payload.message_ids ?? [],
          serverId: payload.server_id,
          channelId: payload.channel_id,
        });
        return;
      }

      case "message_reaction_added":
      case "message_reaction_removed": {
        this.emit(type === "message_reaction_added" ? "reactionAdd" : "reactionRemove", {
          messageId: payload.message_id,
          conversationId: payload.conversation_id,
          emoji: payload.emoji,
          count: payload.count ?? 0,
          userId: payload.user_id,
          user: payload.user,
        });
        return;
      }

      case "channel_message_reaction_added":
      case "channel_message_reaction_removed": {
        this.emit(type === "channel_message_reaction_added" ? "reactionAdd" : "reactionRemove", {
          messageId: payload.message_id,
          serverId: payload.server_id,
          channelId: payload.channel_id,
          emoji: payload.emoji,
          count: payload.count ?? 0,
          userId: payload.user_id,
          user: payload.user,
        });
        return;
      }

      case "typing": {
        this.emit(payload.is_typing ? "typingStart" : "typingStop", {
          userId: payload.user_id,
          conversationId: payload.conversation_id,
          isTyping: Boolean(payload.is_typing),
        });
        return;
      }

      case "channel_typing": {
        this.emit(payload.is_typing ? "typingStart" : "typingStop", {
          userId: payload.user_id,
          serverId: payload.server_id,
          channelId: payload.channel_id,
          isTyping: Boolean(payload.is_typing),
        });
        return;
      }

      case "message_ack": {
        this.emit("messageAck", {
          nonce: payload.nonce,
          status: payload.status,
          messageId: payload.message_id,
          embeds: payload.embeds,
          attachments: payload.attachments,
          retryAfter: payload.retry_after,
          error: payload.error,
        });
        return;
      }

      case "presence_update": {
        this.emit("presenceUpdate", {
          userId: payload.user_id,
          status: payload.status as PresenceStatus,
        });
        return;
      }

      case "channel_created":
        this.emit("channelCreate", payload);
        return;
      case "channel_updated":
        this.emit("channelUpdate", payload);
        return;
      case "channel_deleted":
        this.emit("channelDelete", payload);
        return;

      case "conversation_created":
        this.emit("conversationCreate", payload);
        return;
      case "conversation_updated":
        this.emit("conversationUpdate", payload);
        return;
      case "conversation_hidden":
        this.emit("conversationDelete", payload);
        return;

      case "friend_request_received":
        this.emit("friendRequestReceived", payload);
        return;
      case "friend_request_accepted":
        this.emit("friendRequestAccepted", payload);
        return;
      case "friend_added":
        this.emit("friendAdd", payload);
        return;
      case "friend_removed":
        this.emit("friendRemove", payload);
        return;

      case "guild_member_added":
      case "member_added":
        this.emit("guildMemberAdd", payload);
        return;
      case "guild_member_removed":
      case "member_removed":
      case "member_left":
        this.emit("guildMemberRemove", payload);
        return;

      case "account_restricted":
        this.emit("accountRestricted", payload);
        return;

      default:
        // Every packet is already available through the `raw` event.
        return;
    }
  }

  /** Sends a raw gateway packet. Throws if the socket is not open. */
  send(type: string, payload: Record<string, unknown> = {}): void {
    this.#send(type, payload);
  }

  #send(type: string, payload: Record<string, unknown>): void {
    if (!this.socket || this.socket.readyState !== WS_OPEN) {
      throw new FlackleGatewayError("Gateway is not connected");
    }
    this.socket.send(JSON.stringify({ type, payload }));
  }

  trySend(type: string, payload: Record<string, unknown> = {}): boolean {
    try {
      this.#send(type, payload);
      return true;
    } catch {
      return false;
    }
  }

  /** Subscribes to guild events. The subscription is replayed on reconnect. */
  subscribeServers(serverIds: Snowflake[]): void {
    this.#subscribedServers = [...new Set(serverIds.filter(Boolean))];
    this.trySend("subscribe_servers", { server_ids: this.#subscribedServers });
  }

  addServerSubscription(serverId: Snowflake): void {
    if (!this.#subscribedServers.includes(serverId)) {
      this.#subscribedServers.push(serverId);
    }
    this.trySend("subscribe_servers", { server_ids: this.#subscribedServers });
  }

  /** Marks the account as idle (`true`) or active (`false`). */
  setIdle(idle: boolean): void {
    this.#idle = idle;
    this.trySend("set_idle", { idle });
  }

  async disconnect(code = 1000, reason = "client disconnect"): Promise<void> {
    this.#manualClose = true;
    this.#clearReconnect();
    this.#stopHeartbeat();
    const socket = this.socket;
    if (!socket) return;

    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 2000);
      socket.onclose = () => {
        clearTimeout(timer);
        resolve();
      };
      try {
        socket.close(code, reason);
      } catch {
        clearTimeout(timer);
        resolve();
      }
    });
    this.socket = null;
    this.isConnected = false;
  }

  #startHeartbeat(): void {
    this.#stopHeartbeat();
    this.#heartbeatTimer = setInterval(() => {
      if (!this.socket || this.socket.readyState !== WS_OPEN) return;
      this.#pingSentAt = Date.now();
      try {
        this.#send("ping", { idle: this.#idle });
      } catch {
        return;
      }
      if (this.#heartbeatDeadline) clearTimeout(this.#heartbeatDeadline);
      this.#heartbeatDeadline = setTimeout(() => {
        if (this.#lastActivity >= this.#pingSentAt) return;
        this.emit("error", new FlackleGatewayError("Heartbeat stalled; reconnecting", 4002));
        try {
          this.socket?.close(4002, "heartbeat stall");
        } catch {
          // ignore
        }
      }, this.#heartbeatTimeoutMs);
    }, this.#heartbeatIntervalMs);
  }

  #stopHeartbeat(): void {
    if (this.#heartbeatTimer) {
      clearInterval(this.#heartbeatTimer);
      this.#heartbeatTimer = null;
    }
    if (this.#heartbeatDeadline) {
      clearTimeout(this.#heartbeatDeadline);
      this.#heartbeatDeadline = null;
    }
  }

  #scheduleReconnect(): void {
    if (this.#manualClose || !this.#autoReconnect) return;
    if (this.#reconnectAttempts >= this.#maxReconnectAttempts) {
      this.emit("error", new FlackleGatewayError("Maximum reconnect attempts reached"));
      return;
    }
    this.#clearReconnect();
    const fast = this.#fastReconnects > 0;
    const delay = fast ? 250 + Math.random() * 500 : 1000 * 2 ** this.#reconnectAttempts;
    if (fast) this.#fastReconnects--;
    else this.#reconnectAttempts++;

    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = null;
      void this.connect().catch((error) => {
        this.emit("error", error instanceof Error ? error : new Error(String(error)));
        this.#scheduleReconnect();
      });
    }, delay);
  }

  #clearReconnect(): void {
    if (this.#reconnectTimer) {
      clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = null;
    }
  }

  #failConnect(error: Error): void {
    this.#connectReject?.(error);
    this.#connectReject = null;
    this.#connectResolve = null;
  }
}
