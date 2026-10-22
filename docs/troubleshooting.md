# Troubleshooting

## Authentication

### Every request returns 401

The session is missing or expired.

```ts
await client.login({ email, password });
// or, with an existing refresh token:
await client.refreshSession();
```

If `login()` succeeds but the next request still returns 401, check that you are
not overriding the `Cookie` header in a custom request.

### 401 after copying browser tokens

Flackle rotates refresh tokens. If the browser refreshes after you copy tokens,
your client has a stale pair. Refreshing with the old token can invalidate the
session for both the browser and the client.

Use `login()` in long-running clients, or copy a fresh token pair and run only one
client from it. Do not share a refresh token between processes.

### 403 `csrf_invalid`

The `__Host-csrf` cookie and `x-csrf-token` header must match. `RestClient`
handles this automatically. It can happen if you:

- send a custom `Cookie` header without the CSRF cookie;
- send a custom `x-csrf-token` that does not match;
- use `auth: false`/`cookies: false` and then make a mutating request.

Use `client.rest` instead of raw `fetch` unless you replicate the headers.

### 403 `Missing permission`

You are authenticated; the account lacks the server permission. Inspect:

```ts
const bits = await client.fetchChannelPermissions(serverId, channelId);
console.log(permissionNames(bits));
```

Do not retry a permission error; it will not fix itself. The audit log may show
the permission change if you have access.

### 403 `requires_elevation` / `requires_mfa_enrollment`

The action needs step-up authentication or 2FA enrollment. Complete it in the
browser/current session, then retry. The error object exposes:

```ts
error.requiresElevation;
error.requiresMfaEnrollment;
```

## Messages

### `sendMessage` throws "gateway is not connected"

Messages are sent over the WebSocket, not REST:

```ts
await client.connect();
await client.sendMessage(target, "hello");
```

### My guild message has no ID / missing fields

Flackle does not echo your own guild message. The client waits for `message_ack`
and synthesizes a message after a short grace period. The ID and content are
usable; fields that only exist in a real echo may be absent. For a complete
message, fetch it by ID or use the next `fetchMessages()` page.

### Search returns a stream / parse error

The endpoint emits NDJSON by default. The high-level `searchMessages()` requests
`Accept: application/json` and parses the JSON form. If you call the endpoint
manually, set that header or parse NDJSON line by line.

### `/attachments` returns 405 or 500

Those routes are upload endpoints. GET is not allowed (405), and a JSON body
produces a server error (500). Use `uploadAttachment()` or
`uploadAttachmentDirect()` with multipart `file` data.

### `fetchServerUserSettings()` returns `undefined`

The account has no explicit override for that server. Use server defaults from
`fetchServer()` or the field in `/api/servers/@me/settings`. `undefined` is not an
error.

### Permission overwrite save returns 409

The `version` is stale. Re-fetch and retry:

```ts
const current = await client.fetchPermissionOverwrites(serverId, { channelId });
await client.updatePermissionOverwrites(serverId, { channelId }, {
  version: current.version,
  role_overrides: current.role_overrides,
  user_overrides: current.user_overrides,
});
```

## Rate limits

`429` responses are paused and retried, honoring `Retry-After`. `FlackleAPIError`
exposes `retryAfterMs`. If you are being limited frequently, increase the gap:

```ts
new FlackleClient({ requestIntervalMs: 150, maxRetries: 3 });
```

Do not parallelize history exports aggressively. Use sequential pagination with a
small delay. The library serializes requests, but server limits still apply.

## Gateway

### `connect()` hangs

- The ticket from `/api/ws/url` expires quickly; `connect()` fetches a new one.
- The gateway requires a browser-like `Origin: https://flackle.com`. The client
  sets it; a custom gateway must too.
- If the account/session is invalid, the HTTP ticket request fails first.

Check `client.gateway.isConnected` and `client.gateway.latency`.

### Reconnect loop

Inspect the close code in `FlackleGatewayError.code` or the `disconnected` event.
Codes `1000` and `4001` stop reconnection; `1012` triggers fast retries. A
persistent `4001` usually means auth/session failure, not a network problem.

### No guild events

- Call `connect()`.
- Ensure `autoSubscribe` is true or call `subscribeServers([serverId])`.
- Check `client.gateway.subscribedServers`.
- Own guild messages are not echoed; that is expected.

### Duplicate events after reconnect

The gateway replays subscriptions, not a message backlog. If you cache messages,
deduplicate by `message.id` anyway; events and REST can overlap.

## Uploads

- Presigned URLs expire; complete the upload promptly.
- Rejected size limits come from the plan. Do not retry a `413` unchanged.
- `Bun.file(path)` returns a `Blob`-compatible value; pass it directly.
- For direct uploads, the multipart field is `file`; the client handles it.
- If a custom upload fails, check `content_type` and `size` in the init request.

## TypeScript

The package exports TypeScript source:

```ts
import { FlackleClient } from "flackle-selfbot";
```

Your `tsconfig` needs `"moduleResolution": "bundler"` (or NodeNext with the right
settings) and `allowImportingTsExtensions` if you import internal `.ts` paths
directly. Use Bun as the runtime; `ts-node`/plain Node are not supported.

## Diagnostics

```bash
bun run check       # type check
bun test            # unit tests
bun run check:api   # live read-only API check
```

`check:api` creates a temporary login session and logs it out. If it fails on
`audit-log` with `Missing permission`, the selected server is not owned by the
account; set `FLACKLE_SERVER_ID` to a server where you have `ViewAuditLog`.

## Still stuck?

Capture:

- the method and path from `FlackleAPIError` (`status`, `code`, `body`);
- the gateway close code and last frames (`client.on("raw", ...)`);
- whether the same action works in the browser;
- whether it is a permission, auth, rate-limit or protocol error.

Then open an issue with the relevant snippet and sanitized logs. Never include
tokens, cookies, passwords, 2FA secrets, or private message content.
