import { FlackleAPIError, FlackleAuthError, FlackleError } from "./errors.ts";
import { Gateway } from "./gateway.ts";
import { TypedEmitter } from "./events.ts";
import { RestClient, type RestClientOptions } from "./rest.ts";
import { randomNonce } from "./util.ts";
import type {
  Attachment,
  AuditLogEntry,
  AuditLogOptions,
  AuditLogPage,
  BackupCodes,
  BentoCard,
  BentoResponse,
  BillingSession,
  BlockEntry,
  BlocksResponse,
  BootstrapPayload,
  BulkDeleteResult,
  Category,
  CategoryPositionUpdate,
  CategoryUpdate,
  Channel,
  ChannelBundle,
  ChannelMembers,
  ChannelPositionUpdate,
  ChannelSettings,
  ChannelSettingsPatch,
  ChannelUpdate,
  Conversation,
  ConversationMessagesByIds,
  ConversationUpdate,
  ConversationVoiceState,
  CreateChannelOptions,
  CreateServerResult,
  FetchMessagesOptions,
  FriendRequests,
  GatewayEvents,
  GatewayMessageAck,
  Game,
  GdprRequest,
  GlobalInvites,
  Invite,
  InvitePreview,
  LatestMessageIdResponse,
  LoginOptions,
  MediaStorageSnapshot,
  Member,
  MemberPage,
  Message,
  MessageSearchOptions,
  MessageSearchPage,
  MessageTarget,
  Page,
  PermissionOverwritesInput,
  PermissionOverwritesResponse,
  PermissionTarget,
  PresenceStatus,
  ReactionUsersPage,
  ReportInput,
  Role,
  RoleBatchPayload,
  RoleBatchResponse,
  RolesResponse,
  SavedMediaPage,
  SecurityEvent,
  SelfUser,
  SendMessageOptions,
  Server,
  ServerBan,
  ServerFolders,
  ServerInvite,
  ServerPermissionsResponse,
  ServerPositionUpdate,
  ServerTransferInput,
  ServerUpdate,
  ServerUserSettings,
  ServerVoiceStatesResponse,
  SessionInfo,
  Snowflake,
  SupporterRoleResponse,
  TimeoutResult,
  TwoFactorSetup,
  TwoFactorStatus,
  TypingIndicatorSettings,
  UnreadChannel,
  UploadComplete,
  UploadInit,
  User,
  UserCard,
  VoiceState,
} from "./types.ts";

export interface FlackleClientOptions extends RestClientOptions {
  autoReconnect?: boolean;
  heartbeatIntervalMs?: number;
  maxReconnectAttempts?: number;
  /** Subscribe to guild events for every joined server after connecting. */
  autoSubscribe?: boolean;
  accessToken?: string;
  refreshToken?: string;
  csrfToken?: string;
}

/** The client emits every gateway event, plus the same names for convenience. */
export type ClientEvents = GatewayEvents;

interface LoginResponse {
  user?: SelfUser;
  access_token?: string;
  mfa_required?: boolean;
  mfa_token?: string;
  methods?: string[];
  error?: string;
  code?: string;
}

interface PendingSend {
  nonce: string;
  content: string;
  target: MessageTarget;
  resolve: (message: Message) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  grace?: ReturnType<typeof setTimeout>;
  messageId?: string;
  attachments?: Attachment[];
  embeds?: Message["embeds"];
}

interface PendingOp {
  resolve: () => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const ACK_TIMEOUT_MS = 20_000;

/**
 * Unofficial Flackle client.
 *
 * ```ts
 * const client = new FlackleClient();
 * await client.login({ email: "...", password: "..." });
 * client.on("messageCreate", (event) => console.log(event.message.content));
 * await client.connect();
 * ```
 */
export class FlackleClient extends TypedEmitter<ClientEvents> {
  readonly rest: RestClient;
  readonly gateway: Gateway;
  readonly autoSubscribe: boolean;

  user?: SelfUser;

  readonly #pendingSends = new Map<string, PendingSend>();
  readonly #pendingOps = new Map<string, PendingOp>();

  constructor(options: FlackleClientOptions = {}) {
    super();
    this.rest = new RestClient(options);
    this.autoSubscribe = options.autoSubscribe ?? true;
    this.gateway = new Gateway(this.rest, {
      autoReconnect: options.autoReconnect ?? true,
      heartbeatIntervalMs: options.heartbeatIntervalMs,
      maxReconnectAttempts: options.maxReconnectAttempts,
      origin: this.rest.baseUrl,
      userAgent: this.rest.userAgent,
      getUser: () => this.user,
    });

    if (options.accessToken || options.refreshToken || options.csrfToken) {
      this.rest.setTokens({
        accessToken: options.accessToken,
        refreshToken: options.refreshToken,
        csrfToken: options.csrfToken,
      });
    }

    this.#forwardGatewayEvents();
    this.gateway.on("messageCreate", (event) => this.#onMessageCreate(event));
    this.gateway.on("messageAck", (ack) => this.#onMessageAck(ack));
  }

  /** Logs in with email/password, handling TOTP MFA when required. */
  async login(options: LoginOptions): Promise<SelfUser> {
    await this.rest.ensureCsrf();
    const response = await this.rest.post<LoginResponse>("/api/auth/login", {
      auth: false,
      refreshOn401: false,
      body: { email: options.email, password: options.password },
    });

    if (response.mfa_required) {
      if (!options.mfa) {
        throw new FlackleAuthError("This account requires MFA, but no `mfa` callback was provided");
      }
      if (!response.mfa_token) throw new FlackleAuthError("MFA challenge did not include a token");
      const code = await options.mfa({ mfaToken: response.mfa_token, methods: response.methods });
      const body = options.backupCode
        ? { mfa_token: response.mfa_token, backup_code: code }
        : { mfa_token: response.mfa_token, code };
      const mfaResponse = await this.rest.post<LoginResponse>("/api/auth/login/mfa", {
        auth: false,
        refreshOn401: false,
        body,
      });
      return this.#completeLogin(mfaResponse);
    }

    return this.#completeLogin(response);
  }

  async #completeLogin(response: LoginResponse): Promise<SelfUser> {
    const accessToken = response.access_token ?? this.rest.jar.value("access_token");
    if (!accessToken) {
      throw new FlackleAuthError(response.error ?? "Login succeeded but no access token was returned");
    }
    this.rest.setTokens({
      accessToken,
      refreshToken: this.rest.jar.value("refresh_token"),
      csrfToken: this.rest.jar.value("__Host-csrf"),
    });
    if (response.user) {
      this.user = response.user;
      return response.user;
    }
    return this.fetchMe();
  }

  /** Refreshes the session and returns the current account. */
  async refreshSession(): Promise<SelfUser> {
    await this.rest.refresh();
    this.user = await this.fetchMe();
    return this.user;
  }

  async fetchMe(): Promise<SelfUser> {
    this.user = await this.rest.get<SelfUser>("/api/auth/me");
    return this.user;
  }

  /** Connects to the gateway and subscribes to all joined servers. */
  async connect(): Promise<void> {
    if (!this.rest.hasSession) {
      throw new FlackleAuthError("Call `login()` or provide tokens before connecting");
    }
    if (!this.user) await this.fetchMe().catch(() => undefined);
    await this.gateway.connect();

    if (this.autoSubscribe) {
      const servers = await this.fetchServers().catch(() => []);
      if (servers.length > 0) this.gateway.subscribeServers(servers.map((server) => server.id));
    }
  }

  async destroy(): Promise<void> {
    this.#rejectAll(new FlackleError("Client destroyed"));
    await this.gateway.disconnect();
    this.gateway.removeAllListeners();
    this.removeAllListeners();
  }

  /* ------------------------------------------------------------------ */
  /* Bootstrap / account                                                 */
  /* ------------------------------------------------------------------ */

  fetchEntry(): Promise<BootstrapPayload> {
    return this.rest.get<BootstrapPayload>("/api/entry");
  }

  async fetchServers(): Promise<Server[]> {
    const data = await this.rest.get<{ servers: Server[] }>("/api/servers");
    return data.servers ?? [];
  }

  fetchServer(serverId: Snowflake): Promise<Server> {
    return this.rest.get<Server>(`/api/servers/${serverId}`);
  }

  fetchChannels(serverId: Snowflake): Promise<ChannelBundle> {
    return this.rest.get<ChannelBundle>(`/api/servers/${serverId}/channels`);
  }

  fetchConversations(): Promise<Conversation[]> {
    return this.rest.get<Conversation[]>("/api/conversations");
  }

  fetchUnreadSummary(): Promise<{ channels: UnreadChannel[] }> {
    return this.rest.get<{ channels: UnreadChannel[] }>("/api/servers/@me/unread-summary");
  }

  fetchServerSettings(): Promise<ServerFolders> {
    return this.rest.get<ServerFolders>("/api/servers/@me/settings");
  }

  fetchVoiceStates(): Promise<{ voice_states: Record<Snowflake, VoiceState[]> }> {
    return this.rest.get<{ voice_states: Record<Snowflake, VoiceState[]> }>("/api/voice-states");
  }

  fetchStatus(): Promise<{ status: PresenceStatus }> {
    return this.rest.get<{ status: PresenceStatus }>("/api/status");
  }

  async setStatus(status: PresenceStatus): Promise<void> {
    await this.rest.patch("/api/status", { body: { status } });
  }

  fetchSessions(): Promise<{ sessions: SessionInfo[] }> {
    return this.rest.get<{ sessions: SessionInfo[] }>("/api/auth/sessions");
  }

  fetchSavedMedia(options: { serverId?: Snowflake; cursor?: string } = {}): Promise<SavedMediaPage> {
    return this.rest.get<SavedMediaPage>("/api/media/saved", {
      query: { server_id: options.serverId, cursor: options.cursor },
    });
  }

  async logout(): Promise<void> {
    try {
      await this.rest.post("/api/auth/logout");
    } finally {
      this.rest.clearSession();
      this.user = undefined;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Messages                                                            */
  /* ------------------------------------------------------------------ */

  fetchMessages(target: MessageTarget, options: FetchMessagesOptions = {}): Promise<Page<Message>> {
    const path = messagePath(target);
    return this.rest.get<Page<Message>>(path, {
      query: {
        limit: options.limit ?? 50,
        before: options.before,
        after: options.after,
        around: options.around,
      },
    });
  }

  /**
   * Sends a message over the gateway and resolves with the echoed message.
   * The gateway must be connected; Flackle's web client does not POST messages.
   */
  async sendMessage(target: MessageTarget, content: string, options: SendMessageOptions = {}): Promise<Message> {
    if (!content && (!options.attachments || options.attachments.length === 0)) {
      throw new FlackleError("Message content or at least one attachment is required");
    }
    this.#requireGateway();

    const nonce = options.nonce ?? randomNonce();
    const payload: Record<string, unknown> = { content, nonce };
    if (isGuildTarget(target)) {
      payload.server_id = target.serverId;
      payload.channel_id = target.channelId;
    } else {
      payload.conversation_id = target.conversationId;
    }
    if (options.attachments?.length) payload.attachments = options.attachments;
    if (options.replyToMessageId) payload.reply_to_message_id = options.replyToMessageId;

    const promise = this.#waitForSend(nonce, content, target);
    try {
      this.gateway.send(isGuildTarget(target) ? "send_channel_message" : "send_message", payload);
    } catch (error) {
      this.#dropSend(nonce);
      throw error;
    }
    return promise;
  }

  async editMessage(target: MessageTarget, messageId: Snowflake, content: string): Promise<void> {
    this.#requireGateway();
    const nonce = randomNonce();
    const promise = this.#waitForOp(nonce);
    try {
      if (isGuildTarget(target)) {
        this.gateway.send("edit_channel_message", {
          server_id: target.serverId,
          channel_id: target.channelId,
          message_id: messageId,
          content,
          nonce,
        });
      } else {
        this.gateway.send("edit_message", {
          conversation_id: target.conversationId,
          message_id: messageId,
          content,
          nonce,
        });
      }
    } catch (error) {
      this.#dropOp(nonce);
      throw error;
    }
    return promise;
  }

  async deleteMessage(target: MessageTarget, messageId: Snowflake, reason?: string): Promise<void> {
    this.#requireGateway();
    const nonce = randomNonce();
    const promise = this.#waitForOp(nonce);
    try {
      if (isGuildTarget(target)) {
        const payload: Record<string, unknown> = {
          server_id: target.serverId,
          channel_id: target.channelId,
          message_id: messageId,
          nonce,
        };
        if (reason) payload.reason = reason;
        this.gateway.send("delete_channel_message", payload);
      } else {
        this.gateway.send("delete_message", {
          conversation_id: target.conversationId,
          message_id: messageId,
          nonce,
        });
      }
    } catch (error) {
      this.#dropOp(nonce);
      throw error;
    }
    return promise;
  }

  /** Starts a typing indicator (the server expires it after ~5 seconds). */
  async sendTyping(target: MessageTarget): Promise<void> {
    this.#requireGateway();
    if (isGuildTarget(target)) {
      this.gateway.send("channel_typing_start", {
        server_id: target.serverId,
        channel_id: target.channelId,
      });
    } else {
      this.gateway.send("typing_start", { conversation_id: target.conversationId });
    }
  }

  async stopTyping(target: MessageTarget): Promise<void> {
    this.#requireGateway();
    if (isGuildTarget(target)) {
      this.gateway.send("channel_typing_stop", {
        server_id: target.serverId,
        channel_id: target.channelId,
      });
    } else {
      this.gateway.send("typing_stop", { conversation_id: target.conversationId });
    }
  }

  async markRead(target: MessageTarget, messageId: Snowflake): Promise<void> {
    this.#requireGateway();
    if (isGuildTarget(target)) {
      this.gateway.send("mark_channel_read_channel", {
        server_id: target.serverId,
        channel_id: target.channelId,
        message_id: messageId,
      });
    } else {
      this.gateway.send("mark_read", {
        conversation_id: target.conversationId,
        message_id: messageId,
      });
    }
  }

  /** Adds the current account's reaction. */
  async react(target: MessageTarget, messageId: Snowflake, emoji: string): Promise<void> {
    await this.rest.put(reactionPath(target, messageId, emoji));
  }

  /** Removes the current account's reaction. */
  async unreact(target: MessageTarget, messageId: Snowflake, emoji: string): Promise<void> {
    await this.rest.delete(reactionPath(target, messageId, emoji));
  }

  /**
   * Removes another user's reaction. Flackle's web client only calls the
   * `/@me` route, so this per-user route is best-effort: a server may reject
   * it with 403/404 even when removing your own reaction works.
   */
  async unreactUser(
    target: MessageTarget,
    messageId: Snowflake,
    emoji: string,
    userId: Snowflake,
  ): Promise<void> {
    await this.rest.delete(reactionUserPath(target, messageId, emoji, userId));
  }

  /** Fetches every user who reacted with `emoji`, following pages. */
  async fetchReactions(
    target: MessageTarget,
    messageId: Snowflake,
    emoji: string,
    options: { pageSize?: number; maxPages?: number } = {},
  ): Promise<User[]> {
    return this.fetchAllReactions(target, messageId, emoji, options);
  }

  /** Walks the reaction-user list until it is exhausted or `maxPages` is reached. */
  async fetchAllReactions(
    target: MessageTarget,
    messageId: Snowflake,
    emoji: string,
    options: { pageSize?: number; maxPages?: number } = {},
  ): Promise<User[]> {
    const pageSize = Math.min(100, Math.max(1, Math.floor(options.pageSize ?? 50)));
    const maxPages = Math.min(1000, Math.max(1, Math.floor(options.maxPages ?? 100)));
    const users = new Map<string, User>();
    let after: string | undefined;

    for (let page = 0; page < maxPages; page++) {
      const result = await this.fetchReactionUsers(target, messageId, emoji, {
        limit: pageSize,
        after,
      });
      const batch = result.users ?? [];

      for (const user of batch) {
        if (user?.id) users.set(user.id, user);
      }

      if (typeof result.total === "number" && users.size >= result.total) break;
      if (batch.length < pageSize) break;
      const next = batch[batch.length - 1]?.id;
      if (!next || next === after) break;
      after = next;
    }

    return [...users.values()];
  }

  /** Fetches the reaction-user page, including the total count when supplied. */
  fetchReactionUsers(
    target: MessageTarget,
    messageId: Snowflake,
    emoji: string,
    options: { limit?: number; after?: string } = {},
  ): Promise<ReactionUsersPage> {
    return this.rest.get<ReactionUsersPage>(
      reactionPath(target, messageId, emoji, false),
      { query: { limit: options.limit ?? 50, after: options.after } },
    );
  }

  /* ------------------------------------------------------------------ */
  /* Uploads                                                             */
  /* ------------------------------------------------------------------ */

  /**
   * Uploads a file with Flackle's multipart protocol and returns the attachment
   * descriptor accepted by {@link sendMessage}.
   */
  async uploadAttachment(file: Blob, fileName?: string): Promise<Attachment> {
    const name = fileName ?? (file as File).name ?? "file";
    const contentType = file.type || "application/octet-stream";
    const init = await this.rest.post<UploadInit>("/api/uploads", {
      body: { file_name: name, content_type: contentType, size: file.size },
    });

    try {
      const parts: { part_number: number; etag: string }[] = [];
      for (let index = 0; index < init.urls.length; index++) {
        const start = index * init.part_size;
        const chunk = file.slice(start, Math.min(start + init.part_size, file.size));
        const etag = await this.rest.putAbsolute(init.urls[index]!, chunk);
        parts.push({ part_number: index + 1, etag });
      }
      const result = await this.rest.post<UploadComplete>(`/api/uploads/${init.id}/complete`, {
        body: { parts },
      });
      return result.attachment;
    } catch (error) {
      await this.rest.post(`/api/uploads/${init.id}/abort`, { body: {} }).catch(() => undefined);
      throw error;
    }
  }

  /**
   * Uploads through the direct attachment endpoint (multipart `file` field).
   * This is a simpler alternative to the presigned `/api/uploads` flow and is
   * what the web client uses for channel and conversation attachments.
   */
  async uploadAttachmentDirect(
    target: MessageTarget,
    file: Blob,
    fileName?: string,
    direct = false,
  ): Promise<Attachment[]> {
    const form = new FormData();
    form.append("file", file, fileName ?? (file as File).name ?? "file");
    const data = await this.rest.post<{
      attachments?: Attachment[];
      attachment?: Attachment;
    }>(`${attachmentsPath(target)}${direct ? "/direct" : ""}`, { body: form });
    if (data.attachments) return data.attachments;
    return data.attachment ? [data.attachment] : [];
  }

  /* ------------------------------------------------------------------ */
  /* Social                                                              */
  /* ------------------------------------------------------------------ */

  fetchFriends(search?: string): Promise<User[]> {
    return this.rest.get<User[]>("/api/friends", { query: search ? { search } : undefined });
  }

  fetchFriendRequests(): Promise<FriendRequests> {
    return this.rest.get<FriendRequests>("/api/friends/requests");
  }

  /** Fetches the accounts the authenticated user has blocked. */
  async fetchBlocked(): Promise<User[]> {
    const data = await this.rest.get<
      User[] | { users?: User[]; blocked?: User[]; blocked_users?: User[] }
    >("/api/friends/blocked");
    if (Array.isArray(data)) return data;
    return data.users ?? data.blocked ?? data.blocked_users ?? [];
  }

  /** Alias for {@link fetchBlocked}. */
  fetchBlockedUsers(): Promise<User[]> {
    return this.fetchBlocked();
  }

  async addFriend(username: string): Promise<void> {
    await this.rest.post("/api/friends/requests", { body: { username } });
  }

  async acceptFriendRequest(requestId: Snowflake): Promise<void> {
    await this.rest.post(`/api/friends/requests/${requestId}/accept`);
  }

  async rejectFriendRequest(requestId: Snowflake): Promise<void> {
    await this.rest.post(`/api/friends/requests/${requestId}/reject`);
  }

  async cancelFriendRequest(requestId: Snowflake): Promise<void> {
    await this.rest.delete(`/api/friends/requests/${requestId}`);
  }

  async removeFriend(userId: Snowflake): Promise<void> {
    await this.rest.delete(`/api/friends/${userId}`);
  }

  /** Blocks a user account-wide. */
  async blockUser(userId: Snowflake): Promise<void> {
    await this.rest.post("/api/friends/block", { body: { user_id: userId } });
  }

  /** Removes an account-wide block. */
  async unblockUser(userId: Snowflake): Promise<void> {
    await this.rest.delete(`/api/friends/block/${userId}`);
  }

  /* ------------------------------------------------------------------ */
  /* Server management                                                   */
  /* ------------------------------------------------------------------ */

  createServer(name: string): Promise<CreateServerResult> {
    return this.rest.post<CreateServerResult>("/api/servers", { body: { name } });
  }

  updateServer(serverId: Snowflake, patch: ServerUpdate): Promise<Server> {
    return this.rest.patch<Server>(`/api/servers/${serverId}`, { body: patch });
  }

  /** Deletes a server. The account must be the owner. */
  async deleteServer(serverId: Snowflake): Promise<void> {
    await this.rest.delete(`/api/servers/${serverId}`);
  }

  async leaveServer(serverId: Snowflake): Promise<void> {
    await this.rest.delete(`/api/servers/${serverId}/members/@me`);
  }

  uploadServerIcon(serverId: Snowflake, image: Blob): Promise<string> {
    return this.#uploadImage(`/api/servers/${serverId}/icon`, image, "icon.png");
  }

  uploadServerBanner(serverId: Snowflake, image: Blob): Promise<string> {
    return this.#uploadImage(`/api/servers/${serverId}/banner`, image, "banner.png");
  }

  async fetchChannelKinds(): Promise<string[]> {
    const data = await this.rest.get<{ types?: string[] }>("/api/channel-kinds/creatable");
    return data.types ?? [];
  }

  createChannel(serverId: Snowflake, options: CreateChannelOptions): Promise<Channel> {
    return this.rest.post<Channel>(`/api/servers/${serverId}/channels`, { body: options });
  }

  updateChannel(
    serverId: Snowflake,
    channelId: Snowflake,
    patch: ChannelUpdate,
  ): Promise<Channel> {
    return this.rest.patch<Channel>(`/api/servers/${serverId}/channels/${channelId}`, {
      body: patch,
    });
  }

  async deleteChannel(serverId: Snowflake, channelId: Snowflake): Promise<void> {
    await this.rest.delete(`/api/servers/${serverId}/channels/${channelId}`);
  }

  createCategory(serverId: Snowflake, name: string): Promise<Category> {
    return this.rest.post<Category>(`/api/servers/${serverId}/categories`, { body: { name } });
  }

  updateCategory(
    serverId: Snowflake,
    categoryId: Snowflake,
    patch: CategoryUpdate | string,
  ): Promise<Category> {
    const body = typeof patch === "string" ? { name: patch } : patch;
    return this.rest.patch<Category>(`/api/servers/${serverId}/categories/${categoryId}`, { body });
  }

  async deleteCategory(serverId: Snowflake, categoryId: Snowflake): Promise<void> {
    await this.rest.delete(`/api/servers/${serverId}/categories/${categoryId}`);
  }

  async updateChannelPositions(
    serverId: Snowflake,
    positions: ChannelPositionUpdate[],
  ): Promise<void> {
    await this.rest.put(`/api/servers/${serverId}/channels/positions`, {
      body: { channels: positions },
    });
  }

  async updateCategoryPositions(
    serverId: Snowflake,
    positions: CategoryPositionUpdate[],
  ): Promise<void> {
    await this.rest.put(`/api/servers/${serverId}/categories/positions`, {
      body: { categories: positions },
    });
  }

  async fetchChannelSettings(serverId: Snowflake): Promise<ChannelSettings[]> {
    const data = await this.rest.get<{ channel_settings?: ChannelSettings[] }>(
      `/api/servers/${serverId}/channel-settings`,
    );
    return data.channel_settings ?? [];
  }

  async updateChannelSettings(
    serverId: Snowflake,
    channelId: Snowflake,
    patch: ChannelSettingsPatch,
  ): Promise<void> {
    await this.rest.patch(`/api/servers/${serverId}/channels/${channelId}/settings`, { body: patch });
  }

  /** Reads per-server notification settings from the account settings bundle. */
  async fetchServerUserSettings(
    serverId: Snowflake,
  ): Promise<ServerUserSettings | undefined> {
    const data = await this.rest.get<{ server_settings?: ServerUserSettings[] }>(
      "/api/servers/@me/settings",
    );
    return (data.server_settings ?? []).find(
      (settings) => String(settings.server_id) === String(serverId),
    );
  }

  async updateServerUserSettings(
    serverId: Snowflake,
    patch: ServerUserSettings,
  ): Promise<void> {
    await this.rest.patch(`/api/servers/${serverId}/settings`, { body: patch });
  }

  async markServerRead(serverId: Snowflake): Promise<void> {
    await this.rest.post(`/api/servers/${serverId}/mark-read`);
  }

  async updateServerPositions(servers: ServerPositionUpdate[]): Promise<void> {
    await this.rest.put("/api/servers/@me/settings", { body: { servers } });
  }

  createFolder(name: string, color?: string): Promise<{ folder?: unknown }> {
    return this.rest.post<{ folder?: unknown }>("/api/servers/@me/folders", {
      body: { name, ...(color ? { color } : {}) },
    });
  }

  updateFolder(
    folderId: string,
    patch: { name?: string; color?: string | null },
  ): Promise<{ folder?: unknown }> {
    return this.rest.patch<{ folder?: unknown }>(
      `/api/servers/@me/folders/${encodeURIComponent(folderId)}`,
      { body: patch },
    );
  }

  async deleteFolder(folderId: string): Promise<void> {
    await this.rest.delete(`/api/servers/@me/folders/${encodeURIComponent(folderId)}`);
  }

  async updateFolderPositions(positions: { id: string; position: number }[]): Promise<void> {
    await this.rest.put("/api/servers/@me/folders/positions", {
      body: { folders: positions },
    });
  }

  /* ------------------------------------------------------------------ */
  /* Members, roles and permissions                                      */
  /* ------------------------------------------------------------------ */

  fetchMembersPage(
    serverId: Snowflake,
    options: { limit?: number; offset?: number } = {},
  ): Promise<MemberPage> {
    return this.rest.get<MemberPage>(`/api/servers/${serverId}/members`, {
      query: { limit: options.limit ?? 100, offset: options.offset ?? 0 },
    });
  }

  async fetchMembers(
    serverId: Snowflake,
    options: { limit?: number; offset?: number } = {},
  ): Promise<Member[]> {
    const data = await this.fetchMembersPage(serverId, options);
    return data.members ?? [];
  }

  /** Walks the member list until it is exhausted or `maxPages` is reached. */
  async fetchAllMembers(
    serverId: Snowflake,
    options: { pageSize?: number; maxPages?: number } = {},
  ): Promise<Member[]> {
    const pageSize = options.pageSize ?? 100;
    const maxPages = options.maxPages ?? 100;
    const members: Member[] = [];
    const seen = new Set<string>();

    for (let page = 0; page < maxPages; page++) {
      const data = await this.fetchMembersPage(serverId, {
        limit: pageSize,
        offset: page * pageSize,
      });
      const batch = data.members ?? [];
      let added = 0;
      for (const member of batch) {
        const id = String(member.user?.id ?? member.user_id ?? "");
        if (id && seen.has(id)) continue;
        if (id) seen.add(id);
        members.push(member);
        added++;
      }
      if (batch.length < pageSize || added === 0) break;
    }

    return members;
  }

  fetchMember(serverId: Snowflake, userId: Snowflake): Promise<Member> {
    return this.rest.get<Member>(`/api/servers/${serverId}/members/${userId}`);
  }

  async fetchChannelMembers(
    serverId: Snowflake,
    channelId: Snowflake,
  ): Promise<Snowflake[]> {
    const data = await this.rest.get<ChannelMembers>(
      `/api/servers/${serverId}/channels/${channelId}/members`,
    );
    return data.member_ids ?? [];
  }

  updateMember(
    serverId: Snowflake,
    userId: Snowflake,
    patch: { nickname?: string | null; [key: string]: unknown },
  ): Promise<Member> {
    return this.rest.patch<Member>(`/api/servers/${serverId}/members/${userId}`, {
      body: patch,
    });
  }

  setNickname(
    serverId: Snowflake,
    userId: Snowflake,
    nickname: string | null,
  ): Promise<Member> {
    return this.updateMember(serverId, userId, {
      nickname: nickname?.trim() ? nickname.trim() : null,
    });
  }

  setMemberRoles(
    serverId: Snowflake,
    userId: Snowflake,
    add: Snowflake[] = [],
    remove: Snowflake[] = [],
  ): Promise<Member> {
    return this.rest.patch<Member>(`/api/servers/${serverId}/members/${userId}/roles`, {
      body: { add, remove },
    });
  }

  addMemberRole(
    serverId: Snowflake,
    userId: Snowflake,
    roleId: Snowflake,
  ): Promise<Member> {
    return this.setMemberRoles(serverId, userId, [roleId], []);
  }

  removeMemberRole(
    serverId: Snowflake,
    userId: Snowflake,
    roleId: Snowflake,
  ): Promise<Member> {
    return this.setMemberRoles(serverId, userId, [], [roleId]);
  }

  timeoutMember(
    serverId: Snowflake,
    userId: Snowflake,
    durationSeconds: number,
    reason?: string,
  ): Promise<TimeoutResult> {
    return this.rest.put<TimeoutResult>(
      `/api/servers/${serverId}/members/${userId}/timeout`,
      { body: { duration_seconds: durationSeconds, ...(reason ? { reason } : {}) } },
    );
  }

  async removeTimeout(serverId: Snowflake, userId: Snowflake): Promise<void> {
    await this.rest.delete(`/api/servers/${serverId}/members/${userId}/timeout`);
  }

  async kickMember(
    serverId: Snowflake,
    userId: Snowflake,
    reason?: string,
  ): Promise<void> {
    await this.rest.delete(`/api/servers/${serverId}/members/${userId}`, {
      ...(reason ? { body: { reason } } : {}),
    });
  }

  async banMember(
    serverId: Snowflake,
    userId: Snowflake,
    reason?: string,
  ): Promise<void> {
    await this.rest.post(`/api/servers/${serverId}/bans`, {
      body: { user_id: userId, ...(reason ? { reason } : {}) },
    });
  }

  async fetchBans(serverId: Snowflake): Promise<ServerBan[]> {
    const data = await this.rest.get<{ bans?: ServerBan[] }>(`/api/servers/${serverId}/bans`);
    return data.bans ?? [];
  }

  async unbanMember(serverId: Snowflake, userId: Snowflake): Promise<void> {
    await this.rest.delete(`/api/servers/${serverId}/bans/${userId}`);
  }

  fetchRolesResponse(serverId: Snowflake): Promise<RolesResponse> {
    return this.rest.get<RolesResponse>(`/api/servers/${serverId}/roles`);
  }

  async fetchRoles(serverId: Snowflake): Promise<Role[]> {
    const data = await this.fetchRolesResponse(serverId);
    return data.roles ?? [];
  }

  /**
   * Applies a role batch. Role icons can be uploaded by passing blobs keyed by
   * role ID; the request is then sent as multipart `changes` + `icon_<id>`.
   */
  async updateRoles(
    serverId: Snowflake,
    batch: RoleBatchPayload,
    iconFiles: Record<string, Blob> = {},
  ): Promise<RoleBatchResponse> {
    if (Object.keys(iconFiles).length === 0) {
      return this.rest.patch<RoleBatchResponse>(`/api/servers/${serverId}/roles/batch`, {
        body: batch,
      });
    }

    const form = new FormData();
    const updates = (batch.updates ?? []).map((update) => {
      const copy = { ...update };
      const file = iconFiles[String(update.id)];
      if (file) {
        copy.upload_icon = true;
        form.append(
          `icon_${update.id}`,
          file,
          (file as File).name || `${update.id}.png`,
        );
      }
      return copy;
    });
    form.append("changes", JSON.stringify({ ...batch, updates }));
    return this.rest.patch<RoleBatchResponse>(`/api/servers/${serverId}/roles/batch`, {
      body: form,
    });
  }

  async fetchServerPermissions(serverId: Snowflake): Promise<string> {
    const data = await this.rest.get<ServerPermissionsResponse>(
      `/api/servers/${serverId}/permissions/@me`,
    );
    return data.permissions ?? "0";
  }

  async fetchChannelPermissions(
    serverId: Snowflake,
    channelId: Snowflake,
  ): Promise<string> {
    const data = await this.rest.get<ServerPermissionsResponse>(
      `/api/servers/${serverId}/channels/${channelId}/permissions/@me`,
    );
    return data.permissions ?? "0";
  }

  async fetchCategoryPermissions(
    serverId: Snowflake,
    categoryId: Snowflake,
  ): Promise<string> {
    const data = await this.rest.get<ServerPermissionsResponse>(
      `/api/servers/${serverId}/categories/${categoryId}/permissions/@me`,
    );
    return data.permissions ?? "0";
  }

  fetchPermissionOverwrites(
    serverId: Snowflake,
    target: PermissionTarget,
  ): Promise<PermissionOverwritesResponse> {
    return this.rest.get<PermissionOverwritesResponse>(
      permissionPath(serverId, target),
    );
  }

  updatePermissionOverwrites(
    serverId: Snowflake,
    target: PermissionTarget,
    payload: PermissionOverwritesInput,
  ): Promise<PermissionOverwritesResponse> {
    return this.rest.put<PermissionOverwritesResponse>(
      permissionPath(serverId, target),
      { body: payload },
    );
  }

  /**
   * Applies a permission-overwrite change using a fresh version on every try.
   * Flackle answers 409 when another client changed the permissions between the
   * GET and PUT, so the mutation is rebuilt from the latest response.
   */
  async updatePermissionOverwritesWithRetry(
    serverId: Snowflake,
    target: PermissionTarget,
    update: (current: PermissionOverwritesResponse) => PermissionOverwritesInput,
    attempts = 3,
  ): Promise<PermissionOverwritesResponse> {
    const total = Math.max(1, Math.floor(attempts));
    let lastError: unknown;

    for (let attempt = 1; attempt <= total; attempt++) {
      const current = await this.fetchPermissionOverwrites(serverId, target);
      try {
        return await this.updatePermissionOverwrites(serverId, target, update(current));
      } catch (error) {
        lastError = error;
        if (!(error instanceof FlackleAPIError) || !error.isConflict) throw error;
        if (attempt === total) break;
        await new Promise((resolve) => setTimeout(resolve, attempt * 75));
      }
    }

    throw lastError ?? new FlackleError("Permission overwrite update failed.");
  }

  /**
   * Adds or removes a channel's category sync. Removing sync materialises the
   * category's overrides into the channel so its effective permissions do not
   * change. Use `updatePermissionOverwritesWithRetry` for a combined edit.
   */
  setChannelPermissionsSynced(
    serverId: Snowflake,
    channelId: Snowflake,
    synced: boolean,
  ): Promise<PermissionOverwritesResponse> {
    return this.updatePermissionOverwritesWithRetry(
      serverId,
      { channelId },
      (current) => {
        const materialise = !synced && current.permission_synced === true;
        const roles = materialise
          ? (current.category_role_overrides ?? current.role_overrides ?? [])
          : (current.role_overrides ?? []);
        const users = materialise
          ? (current.category_user_overrides ?? current.user_overrides ?? [])
          : (current.user_overrides ?? []);

        return {
          version: current.version,
          permission_synced: synced,
          role_overrides: roles
            .filter((entry) => entry.role_id)
            .map((entry) => ({
              role_id: String(entry.role_id),
              allow: entry.allow,
              deny: entry.deny,
            })),
          user_overrides: users
            .filter((entry) => entry.user_id)
            .map((entry) => ({
              user_id: String(entry.user_id),
              allow: entry.allow,
              deny: entry.deny,
            })),
        };
      },
    );
  }

  /* ------------------------------------------------------------------ */
  /* Invites, bans and audit log                                         */
  /* ------------------------------------------------------------------ */

  fetchInvites(): Promise<GlobalInvites> {
    return this.rest.get<GlobalInvites>("/api/invites");
  }

  createInvite(options: { max_uses?: number; grants_root?: boolean } = {}): Promise<Invite> {
    return this.rest.post<Invite>("/api/invites", { body: options });
  }

  async deleteInvite(code: string): Promise<void> {
    await this.rest.delete(`/api/invites/${encodeURIComponent(code)}`);
  }

  validateInvite(code: string): Promise<unknown> {
    return this.rest.post("/api/invites/validate", { body: { code } });
  }

  async fetchServerInvites(serverId: Snowflake): Promise<ServerInvite[]> {
    const data = await this.rest.get<{ invites?: ServerInvite[] }>(
      `/api/servers/${serverId}/invites`,
    );
    return data.invites ?? [];
  }

  createServerInvite(
    serverId: Snowflake,
    options: {
      max_uses?: number;
      expires_at?: string;
      channel_id?: Snowflake;
      force_new?: boolean;
    } = {},
  ): Promise<Invite> {
    return this.rest.post<Invite>(`/api/servers/${serverId}/invites`, { body: options });
  }

  async deleteServerInvite(serverId: Snowflake, code: string): Promise<void> {
    await this.rest.delete(
      `/api/servers/${serverId}/invites/${encodeURIComponent(code)}`,
    );
  }

  fetchServerInvite(code: string): Promise<InvitePreview> {
    return this.rest.get<InvitePreview>(
      `/api/server-invites/${encodeURIComponent(code)}`,
    );
  }

  acceptServerInvite(code: string): Promise<{
    server?: Server;
    landing_channel_id?: Snowflake;
    [key: string]: unknown;
  }> {
    return this.rest.post(
      `/api/server-invites/${encodeURIComponent(code)}/accept`,
    );
  }

  fetchAuditLog(
    serverId: Snowflake,
    options: AuditLogOptions = {},
  ): Promise<AuditLogPage> {
    return this.rest.get<AuditLogPage>(`/api/servers/${serverId}/audit-log`, {
      query: {
        limit: options.limit ?? 50,
        before: options.before,
        action_type: options.actionTypes,
        actor_id: options.actorIds,
        target_id: options.targetIds,
      },
    });
  }

  transferServer(
    serverId: Snowflake,
    input: ServerTransferInput,
  ): Promise<unknown> {
    return this.rest.post(`/api/servers/${serverId}/transfer`, { body: input });
  }

  async acceptServerTransfer(serverId: Snowflake): Promise<void> {
    await this.rest.post(`/api/servers/${serverId}/transfer/accept`);
  }

  async denyServerTransfer(serverId: Snowflake): Promise<void> {
    await this.rest.post(`/api/servers/${serverId}/transfer/deny`);
  }

  async cancelServerTransfer(serverId: Snowflake): Promise<void> {
    await this.rest.post(`/api/servers/${serverId}/transfer/cancel`);
  }

  /* ------------------------------------------------------------------ */
  /* Message extras                                                      */
  /* ------------------------------------------------------------------ */

  fetchMessagesByIds(ids: Snowflake[]): Promise<ConversationMessagesByIds> {
    return this.rest.get<ConversationMessagesByIds>("/api/conversations/messages", {
      query: { ids: ids.join(",") },
    });
  }

  /**
   * Streams a channel/conversation search. Flackle emits NDJSON by default but
   * serves the same result as JSON when `Accept: application/json` is set.
   */
  searchMessages(
    target: MessageTarget,
    options: MessageSearchOptions,
  ): Promise<MessageSearchPage> {
    const { query, q, ...rest } = options;
    const body: Record<string, unknown> = { ...rest, query: query ?? q ?? "" };
    return this.rest.post<MessageSearchPage>(`${messagePath(target)}/search`, {
      body,
      headers: { accept: "application/json" },
    });
  }

  bulkDeleteMessages(
    serverId: Snowflake,
    channelId: Snowflake,
    count: number,
    reason?: string,
  ): Promise<BulkDeleteResult> {
    return this.rest.post<BulkDeleteResult>(
      `/api/servers/${serverId}/channels/${channelId}/messages/bulk-delete`,
      { body: { count, ...(reason?.trim() ? { reason: reason.trim() } : {}) } },
    );
  }

  async fetchLatestMessageId(
    serverId: Snowflake,
    channelId: Snowflake,
  ): Promise<Snowflake | null> {
    const data = await this.rest.get<LatestMessageIdResponse>(
      `/api/servers/${serverId}/channels/${channelId}/latest-message-id`,
    );
    return data.latest_message_id ?? null;
  }

  updateMessageEmbeds(
    target: MessageTarget,
    messageId: Snowflake,
    embeds: NonNullable<Message["embeds"]>,
  ): Promise<Message> {
    return this.rest.put<Message>(`${messagePath(target)}/${messageId}/embeds`, {
      body: embeds,
    });
  }

  saveMedia(url: string): Promise<MediaStorageSnapshot> {
    return this.rest.post<MediaStorageSnapshot>("/api/media/save", { body: { url } });
  }

  unsaveMedia(url: string): Promise<MediaStorageSnapshot> {
    return this.rest.post<MediaStorageSnapshot>("/api/media/unsave", { body: { url } });
  }

  createLinkPreview(url: string): Promise<unknown> {
    return this.rest.get("/api/link-preview", { query: { url } });
  }

  /* ------------------------------------------------------------------ */
  /* Conversations                                                       */
  /* ------------------------------------------------------------------ */

  fetchConversation(conversationId: Snowflake): Promise<Conversation> {
    return this.rest.get<Conversation>(`/api/conversations/${conversationId}`);
  }

  createDM(userId: Snowflake): Promise<Conversation> {
    return this.rest.post<Conversation>("/api/conversations", {
      body: { member_ids: [userId] },
    });
  }

  createGroup(memberIds: Snowflake[], name?: string): Promise<Conversation> {
    return this.rest.post<Conversation>("/api/conversations", {
      body: { member_ids: memberIds, ...(name ? { name } : {}) },
    });
  }

  updateConversation(
    conversationId: Snowflake,
    patch: ConversationUpdate,
  ): Promise<Conversation> {
    return this.rest.patch<Conversation>(`/api/conversations/${conversationId}`, {
      body: patch,
    });
  }

  /** Hides the conversation for the current account. */
  async deleteConversation(conversationId: Snowflake): Promise<void> {
    await this.rest.delete(`/api/conversations/${conversationId}`);
  }

  async unhideConversation(conversationId: Snowflake): Promise<void> {
    await this.rest.post(`/api/conversations/${conversationId}/unhide`);
  }

  async muteConversation(conversationId: Snowflake): Promise<void> {
    await this.rest.post(`/api/conversations/${conversationId}/mute`);
  }

  async unmuteConversation(conversationId: Snowflake): Promise<void> {
    await this.rest.delete(`/api/conversations/${conversationId}/mute`);
  }

  addConversationMembers(
    conversationId: Snowflake,
    memberIds: Snowflake[],
  ): Promise<{ members?: Conversation["members"]; [key: string]: unknown }> {
    return this.rest.post(`/api/conversations/${conversationId}/members`, {
      body: { member_ids: memberIds },
    });
  }

  async removeConversationMember(
    conversationId: Snowflake,
    userId: Snowflake,
  ): Promise<void> {
    await this.rest.delete(`/api/conversations/${conversationId}/members/${userId}`);
  }

  async leaveConversation(conversationId: Snowflake, silent = false): Promise<void> {
    await this.rest.delete(`/api/conversations/${conversationId}/members/@me`, {
      query: silent ? { silent: true } : undefined,
    });
  }

  uploadConversationIcon(conversationId: Snowflake, image: Blob): Promise<string> {
    return this.#uploadImage(
      `/api/conversations/${conversationId}/icon`,
      image,
      "group.png",
    );
  }

  fetchConversationVoiceState(
    conversationId: Snowflake,
  ): Promise<ConversationVoiceState> {
    return this.rest.get<ConversationVoiceState>(
      `/api/conversations/${conversationId}/voice`,
    );
  }

  async declineConversationCall(conversationId: Snowflake): Promise<void> {
    await this.rest.post(`/api/conversations/${conversationId}/voice/decline`);
  }

  async stopConversationRinging(
    conversationId: Snowflake,
    userId: Snowflake,
  ): Promise<void> {
    await this.rest.post(
      `/api/conversations/${conversationId}/voice/stop-ringing/${userId}`,
    );
  }

  fetchBlockedWarning(
    conversationId: Snowflake,
  ): Promise<{ should_show?: boolean; blocked_members?: unknown[] }> {
    return this.rest.get(`/api/conversations/${conversationId}/blocked-warning`);
  }

  async dismissBlockedWarning(conversationId: Snowflake): Promise<void> {
    await this.rest.post(`/api/conversations/${conversationId}/blocked-warning/dismiss`);
  }

  /* ------------------------------------------------------------------ */
  /* Profiles, bento and blocks                                          */
  /* ------------------------------------------------------------------ */

  fetchUserByUsername(username: string): Promise<User> {
    return this.rest.get<User>(`/api/users/${encodeURIComponent(username)}`);
  }

  fetchUserById(userId: Snowflake): Promise<User> {
    return this.rest.get<User>(`/api/users/by-id/${userId}`);
  }

  fetchUserCard(username: string, serverId?: Snowflake): Promise<UserCard> {
    return this.rest.get<UserCard>(
      `/api/users/${encodeURIComponent(username)}/card`,
      { query: { server_id: serverId } },
    );
  }

  async fetchUserBento(username: string): Promise<BentoCard[]> {
    const data = await this.rest.get<BentoResponse>(
      `/api/users/${encodeURIComponent(username)}/bento`,
    );
    return data.cards ?? [];
  }

  async fetchUserBlocks(username: string): Promise<BlockEntry[]> {
    const data = await this.rest.get<BlocksResponse>(
      `/api/users/${encodeURIComponent(username)}/blocks`,
    );
    return data.blocks ?? [];
  }

  updateBento(cards: BentoCard[]): Promise<BentoResponse> {
    return this.rest.put<BentoResponse>("/api/users/bento", { body: { cards } });
  }

  updateBlocks(blocks: BlockEntry[]): Promise<BlocksResponse> {
    return this.rest.put<BlocksResponse>("/api/users/blocks", { body: { blocks } });
  }

  uploadBlockImage(image: Blob): Promise<string> {
    return this.#uploadImage("/api/users/blocks/image", image, "block.png");
  }

  updateProfile(patch: {
    display_name?: string | null;
    username?: string;
    password?: string;
  }): Promise<User> {
    return this.rest.patch<User>("/api/users/profile", { body: patch });
  }

  uploadAvatar(image: Blob): Promise<string> {
    return this.#uploadImage("/api/users/avatar", image, "avatar.png");
  }

  uploadBanner(image: Blob): Promise<string> {
    return this.#uploadImage("/api/users/banner", image, "banner.png");
  }

  checkUsername(
    username: string,
  ): Promise<{ available?: boolean; [key: string]: unknown }> {
    return this.rest.get("/api/users/check-username", { query: { username } });
  }

  updateTypingIndicator(
    settings: TypingIndicatorSettings,
  ): Promise<TypingIndicatorSettings> {
    return this.rest.patch<TypingIndicatorSettings>("/api/users/typing-indicator", {
      body: settings,
    });
  }

  /* ------------------------------------------------------------------ */
  /* Account security                                                    */
  /* ------------------------------------------------------------------ */

  changePassword(
    currentPassword: string,
    newPassword: string,
  ): Promise<{ message?: string; [key: string]: unknown }> {
    return this.rest.post("/api/auth/change-password", {
      body: { current_password: currentPassword, new_password: newPassword },
    });
  }

  changeEmail(newEmail: string, password: string): Promise<unknown> {
    return this.rest.post("/api/auth/change-email", {
      body: { new_email: newEmail, password },
    });
  }

  fetch2FAStatus(): Promise<TwoFactorStatus> {
    return this.rest.get<TwoFactorStatus>("/api/auth/2fa");
  }

  setup2FA(password: string): Promise<TwoFactorSetup> {
    return this.rest.post<TwoFactorSetup>("/api/auth/2fa/setup", { body: { password } });
  }

  confirm2FA(code: string): Promise<unknown> {
    return this.rest.post("/api/auth/2fa/confirm", { body: { code } });
  }

  async disable2FA(options: {
    password: string;
    code?: string;
    backupCode?: string;
  }): Promise<void> {
    await this.rest.post("/api/auth/2fa/disable", {
      body: {
        password: options.password,
        ...(options.backupCode ? { backup_code: options.backupCode } : { code: options.code }),
      },
    });
  }

  createBackupCodes(password: string, code: string): Promise<BackupCodes> {
    return this.rest.post<BackupCodes>("/api/auth/2fa/backup-codes", {
      body: { password, code },
    });
  }

  async revokeSession(sessionId: string, code?: string): Promise<void> {
    await this.rest.delete(`/api/auth/sessions/${encodeURIComponent(sessionId)}`, {
      body: code ? { code } : {},
    });
  }

  async revokeAllSessions(code?: string): Promise<void> {
    await this.rest.delete("/api/auth/sessions", { body: code ? { code } : {} });
  }

  async fetchSecurityEvents(): Promise<SecurityEvent[]> {
    const data = await this.rest.get<{ events?: SecurityEvent[] }>(
      "/api/auth/security-events",
    );
    return data.events ?? [];
  }

  async clearSecurityEvents(code?: string): Promise<void> {
    await this.rest.post("/api/auth/security-events/clear", {
      body: code ? { code } : undefined,
    });
  }

  async fetchGdprRequests(): Promise<GdprRequest[]> {
    const data = await this.rest.get<GdprRequest[]>("/api/gdpr");
    return data ?? [];
  }

  async submitGdprRequest(type: "data" | "delete" | (string & {})): Promise<void> {
    await this.rest.post("/api/gdpr", { body: { type } });
  }

  async cancelAccountDeletion(): Promise<void> {
    await this.rest.post("/api/gdpr/cancel-deletion");
  }

  async acceptLegal(version: string): Promise<void> {
    await this.rest.post("/api/legal/accept", { body: { version } });
  }

  createBillingPortal(): Promise<BillingSession> {
    return this.rest.post<BillingSession>("/api/billing/portal");
  }

  /* ------------------------------------------------------------------ */
  /* Voice                                                               */
  /* ------------------------------------------------------------------ */

  fetchServerVoiceState(serverId: Snowflake, channelId: Snowflake): Promise<unknown> {
    return this.rest.get(`/api/servers/${serverId}/channels/${channelId}/voice`);
  }

  fetchServerVoiceStates(serverId: Snowflake): Promise<ServerVoiceStatesResponse> {
    return this.rest.get<ServerVoiceStatesResponse>(
      `/api/servers/${serverId}/voice-states`,
    );
  }

  async warmVoice(serverId: Snowflake, channelId: Snowflake): Promise<void> {
    await this.rest.post(`/api/servers/${serverId}/channels/${channelId}/voice/warm`);
  }

  async serverMuteVoiceMember(
    serverId: Snowflake,
    channelId: Snowflake,
    userId: Snowflake,
    muted: boolean,
  ): Promise<void> {
    await this.rest.post(
      `/api/servers/${serverId}/channels/${channelId}/voice/members/${userId}/server-mute`,
      { body: { muted } },
    );
  }

  async serverDeafenVoiceMember(
    serverId: Snowflake,
    channelId: Snowflake,
    userId: Snowflake,
    deafened: boolean,
  ): Promise<void> {
    await this.rest.post(
      `/api/servers/${serverId}/channels/${channelId}/voice/members/${userId}/server-deafen`,
      { body: { deafened } },
    );
  }

  /** Moves a member into the moderator's current voice channel. */
  async moveVoiceMember(
    serverId: Snowflake,
    channelId: Snowflake,
    userId: Snowflake,
  ): Promise<void> {
    await this.rest.post(
      `/api/servers/${serverId}/channels/${channelId}/voice/members/${userId}/move`,
    );
  }

  async disconnectVoiceMember(
    serverId: Snowflake,
    channelId: Snowflake,
    userId: Snowflake,
  ): Promise<void> {
    await this.rest.post(
      `/api/servers/${serverId}/channels/${channelId}/voice/members/${userId}/disconnect`,
    );
  }

  /* ------------------------------------------------------------------ */
  /* Reports, lifts and misc                                             */
  /* ------------------------------------------------------------------ */

  submitReport(input: ReportInput): Promise<unknown> {
    return this.rest.post("/api/reports", { body: input });
  }

  reportUser(
    userId: Snowflake,
    options: Omit<ReportInput, "report_type" | "reported_user_id">,
  ): Promise<unknown> {
    return this.submitReport({
      report_type: "user",
      reported_user_id: userId,
      ...options,
    });
  }

  reportMessage(
    target: MessageTarget,
    messageId: Snowflake,
    options: Omit<
      ReportInput,
      | "report_type"
      | "reported_message_id"
      | "reported_channel_id"
      | "reported_conversation_id"
    >,
  ): Promise<unknown> {
    const location = isGuildTarget(target)
      ? { reported_channel_id: target.channelId }
      : { reported_conversation_id: target.conversationId };
    return this.submitReport({
      report_type: "message",
      reported_message_id: messageId,
      ...location,
      ...options,
    });
  }

  fetchServerLifts(serverId: Snowflake): Promise<unknown> {
    return this.rest.get(`/api/servers/${serverId}/lifts`);
  }

  fetchServerLiftSupporters(serverId: Snowflake): Promise<unknown> {
    return this.rest.get(`/api/servers/${serverId}/lifts/supporters`);
  }

  setSupporterRole(
    serverId: Snowflake,
    roleId: Snowflake | null,
  ): Promise<SupporterRoleResponse> {
    return this.rest.put<SupporterRoleResponse>(
      `/api/servers/${serverId}/lifts/supporter-role`,
      { body: { role_id: roleId } },
    );
  }

  fetchChannelAnalytics(
    serverId: Snowflake,
    channelId: Snowflake,
    scope: string,
  ): Promise<unknown> {
    return this.rest.get(
      `/api/servers/${serverId}/channels/${channelId}/analytics`,
      { query: { scope } },
    );
  }

  fetchChannelAnalyticsBundle(
    serverId: Snowflake,
    channelId: Snowflake,
  ): Promise<unknown> {
    return this.rest.get(
      `/api/servers/${serverId}/channels/${channelId}/analytics/bundle`,
    );
  }

  fetchChannelAnalyticsCalendar(
    serverId: Snowflake,
    channelId: Snowflake,
    query: Record<string, unknown> = {},
  ): Promise<unknown> {
    return this.rest.get(
      `/api/servers/${serverId}/channels/${channelId}/analytics/calendar`,
      { query },
    );
  }

  fetchChannelAnalyticsPunchcard(
    serverId: Snowflake,
    channelId: Snowflake,
    days = 30,
  ): Promise<unknown> {
    return this.rest.get(
      `/api/servers/${serverId}/channels/${channelId}/analytics/punchcard`,
      { query: { days } },
    );
  }

  fetchSpotify(url: string): Promise<unknown> {
    return this.rest.get("/api/spotify", { query: { url } });
  }

  /** Looks up game metadata used by rich presence embeds. */
  async searchGames(query: string): Promise<Game[]> {
    const data = await this.rest.get<{ games?: Game[] }>("/api/game", {
      query: { q: query },
    });
    return data.games ?? [];
  }

  fetchGame(gameId: string): Promise<Game> {
    return this.rest.post<Game>("/api/game", { body: { gameId } });
  }

  fetchTweet(url: string): Promise<unknown> {
    return this.rest.get("/api/tweet", { query: { url } });
  }

  fetchWeather(location: string): Promise<unknown> {
    return this.rest.get("/api/weather", { query: { location } });
  }

  searchWeather(query: string): Promise<unknown> {
    return this.rest.get("/api/weather/search", { query: { q: query } });
  }

  /* ------------------------------------------------------------------ */
  /* Internals                                                           */
  /* ------------------------------------------------------------------ */

  async #uploadImage(path: string, image: Blob, fileName: string): Promise<string> {
    const form = new FormData();
    form.append("image", image, (image as File).name || fileName);
    const data = await this.rest.post<{
      url?: string;
      icon_url?: string;
      banner_url?: string;
    }>(path, { body: form });
    const url = data?.url ?? data?.icon_url ?? data?.banner_url;
    if (!url) throw new FlackleError("Upload succeeded but no URL was returned");
    return url;
  }

  #forwardGatewayEvents(): void {
    const events = [
      "raw",
      "connected",
      "disconnected",
      "ready",
      "messageCreate",
      "messageUpdate",
      "messageDelete",
      "messagesBulkDelete",
      "messageAck",
      "typingStart",
      "typingStop",
      "reactionAdd",
      "reactionRemove",
      "presenceUpdate",
      "channelCreate",
      "channelUpdate",
      "channelDelete",
      "conversationCreate",
      "conversationUpdate",
      "conversationDelete",
      "friendRequestReceived",
      "friendRequestAccepted",
      "friendAdd",
      "friendRemove",
      "guildMemberAdd",
      "guildMemberRemove",
      "accountRestricted",
      "error",
    ] as const;

    for (const event of events) {
      this.gateway.on(event as never, ((payload: unknown) => {
        if (event === "ready") {
          const ready = payload as { user?: SelfUser };
          if (ready.user) this.user = ready.user;
        }
        this.emit(event as never, payload as never);
      }) as never);
    }
  }

  #onMessageCreate(event: ClientEvents["messageCreate"]): void {
    const nonce = event.message.nonce;
    let pending: PendingSend | undefined;

    if (nonce) pending = this.#pendingSends.get(nonce);
    if (!pending) {
      for (const candidate of this.#pendingSends.values()) {
        if (candidate.messageId && candidate.messageId === event.message.id) {
          pending = candidate;
          break;
        }
      }
    }
    if (!pending) return;

    clearTimeout(pending.timer);
    if (pending.grace) clearTimeout(pending.grace);
    this.#pendingSends.delete(pending.nonce);
    pending.resolve(event.message);
  }

  #onMessageAck(ack: GatewayMessageAck): void {
    if (ack.status === "sent") {
      const pending = this.#pendingSends.get(ack.nonce);
      if (!pending || pending.grace) return;
      pending.messageId = ack.messageId;
      pending.attachments = ack.attachments;
      pending.embeds = ack.embeds;
      // `channel_message` normally follows immediately; if it does not, settle
      // with the id so callers are not left hanging.
      pending.grace = setTimeout(() => {
        this.#pendingSends.delete(pending.nonce);
        clearTimeout(pending.timer);
        pending.resolve({
          id: ack.messageId ?? "",
          content: pending.content,
          type: "text",
          is_deleted: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          sender: this.user,
          attachments: pending.attachments,
          embeds: pending.embeds,
        });
      }, 1500);
      return;
    }

    if (ack.status === "edit_ok" || ack.status === "delete_ok") {
      const op = this.#pendingOps.get(ack.nonce);
      if (!op) return;
      clearTimeout(op.timer);
      this.#pendingOps.delete(ack.nonce);
      op.resolve();
      return;
    }

    const pending = this.#pendingSends.get(ack.nonce);
    if (pending) {
      clearTimeout(pending.timer);
      if (pending.grace) clearTimeout(pending.grace);
      this.#pendingSends.delete(ack.nonce);
      pending.reject(new FlackleError(ack.error ?? `Message failed: ${ack.status}`));
      return;
    }

    const op = this.#pendingOps.get(ack.nonce);
    if (op) {
      clearTimeout(op.timer);
      this.#pendingOps.delete(ack.nonce);
      op.reject(new FlackleError(ack.error ?? `Message operation failed: ${ack.status}`));
    }
  }

  #waitForSend(nonce: string, content: string, target: MessageTarget): Promise<Message> {
    return new Promise<Message>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pendingSends.delete(nonce);
        reject(new FlackleError("Timed out waiting for message acknowledgement"));
      }, ACK_TIMEOUT_MS);
      this.#pendingSends.set(nonce, { nonce, content, target, resolve, reject, timer });
    });
  }

  #waitForOp(nonce: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pendingOps.delete(nonce);
        reject(new FlackleError("Timed out waiting for message acknowledgement"));
      }, ACK_TIMEOUT_MS);
      this.#pendingOps.set(nonce, { resolve, reject, timer });
    });
  }

  #rejectAll(error: Error): void {
    for (const pending of this.#pendingSends.values()) {
      clearTimeout(pending.timer);
      if (pending.grace) clearTimeout(pending.grace);
      pending.reject(error);
    }
    this.#pendingSends.clear();
    for (const op of this.#pendingOps.values()) {
      clearTimeout(op.timer);
      op.reject(error);
    }
    this.#pendingOps.clear();
  }

  #requireGateway(): void {
    if (!this.gateway.isConnected) {
      throw new FlackleError("The gateway must be connected for this action; call `connect()` first");
    }
  }

  #dropSend(nonce: string): void {
    const pending = this.#pendingSends.get(nonce);
    if (!pending) return;
    clearTimeout(pending.timer);
    if (pending.grace) clearTimeout(pending.grace);
    this.#pendingSends.delete(nonce);
  }

  #dropOp(nonce: string): void {
    const op = this.#pendingOps.get(nonce);
    if (!op) return;
    clearTimeout(op.timer);
    this.#pendingOps.delete(nonce);
  }
}

function isGuildTarget(target: MessageTarget): target is { serverId: Snowflake; channelId: Snowflake } {
  return "serverId" in target && typeof target.serverId === "string";
}

function messagePath(target: MessageTarget): string {
  if (isGuildTarget(target)) {
    return `/api/servers/${target.serverId}/channels/${target.channelId}/messages`;
  }
  return `/api/conversations/${target.conversationId}/messages`;
}

function permissionPath(serverId: Snowflake, target: PermissionTarget): string {
  if ("channelId" in target && target.channelId) {
    return `/api/servers/${serverId}/channels/${target.channelId}/permissions`;
  }
  return `/api/servers/${serverId}/categories/${target.categoryId}/permissions`;
}

function attachmentsPath(target: MessageTarget): string {
  if (isGuildTarget(target)) {
    return `/api/servers/${target.serverId}/channels/${target.channelId}/attachments`;
  }
  return `/api/conversations/${target.conversationId}/attachments`;
}

function reactionPath(
  target: MessageTarget,
  messageId: Snowflake,
  emoji: string,
  mine = true,
): string {
  const base = `${messagePath(target)}/${messageId}/reactions/${encodeURIComponent(emoji)}`;
  if (!mine) return base;
  // The web client scopes guild reactions with `/@me`; DM reactions rely on the
  // session cookie.
  return isGuildTarget(target) ? `${base}/@me` : base;
}

function reactionUserPath(
  target: MessageTarget,
  messageId: Snowflake,
  emoji: string,
  userId: Snowflake,
): string {
  return `${reactionPath(target, messageId, emoji, false)}/${encodeURIComponent(userId)}`;
}
