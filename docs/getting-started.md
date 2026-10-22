# Getting started

## Requirements

- [Bun](https://bun.sh) 1.1 or newer. The gateway handshake needs a custom
  `Origin` header, which Bun's WebSocket supports.
- A Flackle account.
- Node.js is not supported as a runtime; the library uses Bun APIs and `.ts`
  imports directly.

## Install

This package is not published to npm. Use the folder directly:

```bash
cd flackle-selfbot
bun install
```

Or add it to another project by path:

```bash
bun add /path/to/flackle-selfbot
```

## Credentials

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

```dotenv
FLACKLE_EMAIL=you@example.com
FLACKLE_PASSWORD=your-password
```

Bun loads `.env` automatically. Never commit it. `.env` is already in
`.gitignore`.

If the account has MFA enabled, `login()` needs a callback that returns a TOTP
code or a backup code:

```ts
await client.login({
  email: process.env.FLACKLE_EMAIL!,
  password: process.env.FLACKLE_PASSWORD!,
  mfa: async ({ mfaToken, methods }) => {
    console.log("MFA challenge", { mfaToken, methods });
    return process.env.FLACKLE_MFA_CODE!;
  },
});
```

## First script

Create `first.ts`:

```ts
import { FlackleClient } from "flackle-selfbot";

const client = new FlackleClient();

const me = await client.login({
  email: process.env.FLACKLE_EMAIL!,
  password: process.env.FLACKLE_PASSWORD!,
});
console.log(`logged in as ${me.username} (${me.id})`);

const servers = await client.fetchServers();
for (const server of servers) {
  console.log(server.id, server.name);
}

// Pick a server you are in and one of its text channels.
const serverId = servers[0]!.id;
const { channels } = await client.fetchChannels(serverId);
const channel = channels.find((entry) => entry.type === "text")!;

// Read history over REST; no gateway needed yet.
const page = await client.fetchMessages({ serverId, channelId: channel.id });
for (const message of page.messages) {
  console.log(message.sender?.username, message.content);
}

// Gateway is required for events and for send/edit/delete.
await client.connect();

client.on("messageCreate", ({ message, channelId, serverId }) => {
  console.log("new message", { serverId, channelId, content: message.content });
});

await client.sendMessage({ serverId, channelId: channel.id }, "hello from Bun");

// Call this when shutting down.
await client.destroy();
```

Run it:

```bash
bun run first.ts
```

## Login alternatives

### Existing session tokens

If you already have a browser session, you can construct the client without
`login()`:

```ts
const client = new FlackleClient({
  accessToken: process.env.FLACKLE_ACCESS_TOKEN,
  refreshToken: process.env.FLACKLE_REFRESH_TOKEN,
  csrfToken: process.env.FLACKLE_CSRF_TOKEN,
});
```

> **Important:** Flackle rotates refresh tokens when it refreshes a session. A
> stale or replayed refresh token can invalidate the whole session. Prefer
> `login()` for long-running bots, or always copy the current token pair and
> never run two clients from the same pair. See [Authentication](authentication.md).

### Environment defaults

`RestClientOptions` can be passed to the constructor:

```ts
const client = new FlackleClient({
  requestIntervalMs: 100,
  timeoutMs: 30_000,
  maxRetries: 3,
  autoReconnect: true,
  autoSubscribe: true,
});
```

## Gateway vs REST

| Task | Gateway required? |
| --- | --- |
| List servers/channels/members/roles | No |
| Read message history, search, fetch reactions | No |
| Send, edit or delete a message | **Yes** |
| Typing and read receipts | **Yes** |
| Realtime message/reaction/presence events | **Yes** |

`connect()` resolves after the gateway's `hello` frame and, by default,
subscribes to every joined server. Set `autoSubscribe: false` if you want to
subscribe manually:

```ts
await client.connect();
client.gateway.subscribeServers([serverId]);
```

## First checks

```bash
bun run check       # TypeScript
bun test            # unit tests
bun run check:api   # live read-only API check (needs credentials)
```

`check:api` logs in, picks a server you own (or `FLACKLE_SERVER_ID`), exercises
the expanded read endpoints, and logs the temporary session out.

Examples:

```bash
bun run example:watch
bun run example:send
```

## Project layout

```text
flackle-selfbot/
  src/
    client.ts       high-level FlackleClient
    rest.ts         fetch wrapper, cookies, CSRF, retries
    gateway.ts      WebSocket protocol and event normalization
    permissions.ts  permission bits and computation
    types.ts        request/response/event types
    errors.ts       typed errors
  docs/             this documentation
  examples/         watch and send examples
  scripts/          smoke test and read-only API check
  test/             unit tests
```

## Next steps

- [Messages](messages.md)
- [Reactions](reactions.md)
- [Servers and channels](servers-channels.md)
- [Recipes](recipes.md)
