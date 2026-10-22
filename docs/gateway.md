# Gateway and events

Flackle's realtime API is a WebSocket that speaks newline-delimited JSON:

```json
{"type":"hello","payload":{"v":1,"session_id":"...","presences":{}}}
```

The client obtains a short-lived ticket from `GET /api/ws/url`, opens
`wss://ws.flackle.com/ws` with a browser-like `Origin: https://flackle.com`, and
then starts the heartbeat.

## Connecting

```ts
const client = new FlackleClient();
await client.login({ email, password });

await client.connect();
```

`connect()` resolves after the `hello` frame. By default the client subscribes to
every server you are in so guild events flow.

```ts
client.on("ready", ({ session_id, presences }) => {
  console.log("gateway ready", session_id, presences);
});

client.on("connected", () => console.log("socket open"));
client.on("disconnected", ({ code, reason }) => console.log(code, reason));
```

## Events

| Event | Source frames | Payload |
| --- | --- | --- |
| `ready` | `hello` | `session_id`, `presences`, `user` |
| `connected` / `disconnected` | socket lifecycle | none / `{ code, reason }` |
| `messageCreate` | `new_message`, `channel_message` | `{ message, serverId?, channelId?, conversationId? }` |
| `messageUpdate` | `message_edited`, `channel_message_edited` | same shape |
| `messageDelete` | `message_deleted`, `channel_message_deleted` | `{ messageId, ... }` |
| `messagesBulkDelete` | `channel_messages_bulk_deleted` | `{ ids, serverId, channelId }` |
| `messageAck` | `message_ack` | send/edit/delete status, slowmode, timeout |
| `typingStart` / `typingStop` | `typing`, `channel_typing` | `{ userId, isTyping, ... }` |
| `reactionAdd` / `reactionRemove` | reaction frames | `{ messageId, emoji, count, user?, userId? }` |
| `presenceUpdate` | `presence_update` | `{ userId, status }` |
| `channelCreate` / `channelUpdate` / `channelDelete` | guild channels | raw payload |
| `conversationCreate` / `conversationUpdate` / `conversationDelete` | DM/group lifecycle | raw payload |
| `friendRequestReceived` / `friendRequestAccepted` | friend frames | raw payload |
| `friendAdd` / `friendRemove` | friend list changes | raw payload |
| `guildMemberAdd` / `guildMemberRemove` | membership | raw payload |
| `accountRestricted` | moderation state | raw payload |
| `error` | socket/protocol errors | `Error` |

Every frame is also emitted as `raw`:

```ts
client.on("raw", ({ type, payload }) => {
  console.log(type, payload);
});
```

Unknown frame types are not dropped; they arrive through `raw`.

## Message events

```ts
client.on("messageCreate", ({ message, serverId, channelId, conversationId }) => {
  console.log({
    serverId,
    channelId,
    conversationId,
    id: message.id,
    author: message.sender?.username,
    content: message.content,
    reactions: message.reactions,
  });
});
```

Your own guild messages are **not** echoed as `channel_message`. The client
resolves `sendMessage()` from `message_ack` after a short grace period. DM sends
use the real echo when available.

## Subscriptions

```ts
await client.connect();

client.gateway.subscribeServers([serverId]);
client.gateway.addServerSubscription(serverId);

console.log(client.gateway.subscribedServers);
```

Subscriptions are replayed automatically after a reconnect. To manage them
yourself:

```ts
new FlackleClient({ autoSubscribe: false });
await client.connect();
client.gateway.subscribeServers([serverId]);
```

## Heartbeat and latency

The gateway sends a `ping` roughly every 45 seconds and expects any frame within
20 seconds. The client replies with `pong` and exposes the measured round-trip:

```ts
console.log(client.gateway.latency); // milliseconds
```

If no frame arrives in time, the client treats the connection as dead and
reconnects.

## Reconnection

Unexpected closes reconnect with exponential backoff (about 1s, 2s, 4s, … up to
10 attempts). Close code `1012` triggers eight fast retries (250–750ms). Codes
`1000` and `4001` stop reconnection.

```ts
new FlackleClient({
  autoReconnect: true,
  maxReconnectAttempts: 10,
});
```

Close codes surface as `FlackleGatewayError.code`. See
[Troubleshooting](troubleshooting.md#gateway).

## Idle and status

Two different things:

```ts
client.gateway.setIdle(true);      // gateway idle flag
await client.setStatus("dnd");     // profile status
```

Profile statuses: `online`, `idle`, `dnd`, `offline`, `invisible`.

## Raw packets

For features the library does not model yet:

```ts
client.gateway.send("set_idle", { idle: true });

const sent = client.gateway.trySend("some_packet", { foo: "bar" });
if (!sent) console.warn("socket is not open");
```

`send()` throws when the socket is not open; `trySend()` returns `false`.

Known outbound packets used by the client:

- `send_channel_message` / `send_message`
- `edit_channel_message` / `edit_message`
- `delete_channel_message` / `delete_message`
- `channel_typing_start` / `channel_typing_stop`
- `typing_start` / `typing_stop`
- `mark_channel_read_channel` / `mark_read`
- `subscribe_servers`
- `ping` / `pong`
- `set_idle`

The exact payload fields are visible in `src/client.ts` and `src/gateway.ts`.

## Shutdown

```ts
await client.destroy();
```

This disconnects the gateway, stops timers, and clears the client state. It does
not necessarily log out the HTTP session; call `logout()` for that.
