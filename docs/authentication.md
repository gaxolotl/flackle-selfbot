# Authentication

Flackle's web app authenticates with **cookies**, not bearer tokens alone. A
plain `Authorization: Bearer ...` request returns `401`. The client reproduces the
browser's real flow:

- `access_token` cookie — short-lived JWT
- `refresh_token` cookie — long-lived rotating token
- `__Host-csrf` cookie + `x-csrf-token` header — double-submit CSRF check
- `X-Requested-With: XMLHttpRequest` — required by the API
- browser-like `Origin`/`Referer` headers

`FlackleClient.login()` performs the login request and stores the resulting
cookies in an in-memory jar. Nothing is written to disk by the library.

## Logging in

```ts
const client = new FlackleClient();

await client.login({
  email: process.env.FLACKLE_EMAIL!,
  password: process.env.FLACKLE_PASSWORD!,
});
```

The return value is the `SelfUser`. `client.user` is also set.

### MFA

If the account has TOTP enabled, provide `mfa`. It receives the challenge and
must return a six-digit TOTP code or a backup code:

```ts
await client.login({
  email,
  password,
  mfa: async ({ mfaToken, methods }) => {
    // Show the challenge to the operator, or read a TOTP secret from env.
    return process.env.FLACKLE_MFA_CODE!;
  },
});
```

Use `backupCode: true` if the callback returns a backup code and the server
needs to be told explicitly:

```ts
await client.login({
  email,
  password,
  backupCode: true,
  mfa: () => process.env.FLACKLE_BACKUP_CODE!,
});
```

## Using existing browser tokens

You can construct a client from an existing session:

```ts
const client = new FlackleClient({
  accessToken: process.env.FLACKLE_ACCESS_TOKEN,
  refreshToken: process.env.FLACKLE_REFRESH_TOKEN,
  csrfToken: process.env.FLACKLE_CSRF_TOKEN,
});
```

Get these from the browser's request headers or cookie storage. `access_token`
and `refresh_token` are HttpOnly, so DevTools network request headers are usually
the easiest source.

> **Refresh-token rotation is dangerous to replay.** Flackle rotates the refresh
> token on refresh and appears to invalidate the session when an old one is
> reused. If you copy tokens from a live browser and then the browser refreshes
> first, your client's copy is stale. A refresh attempt with that stale token can
> end the session for both the browser and the client. For long-running use,
> `login()` and let the client own the session.

## Refreshing and logging out

```ts
await client.refreshSession(); // refresh cookies, return the current user
await client.logout();         // POST /api/auth/logout and clear local session
```

The REST client refreshes automatically on an expired access token when a refresh
token is available. Concurrent requests are serialized through the same client.

If refresh fails with `401`/`403`, the client clears the session and throws
`FlackleAuthError`. Log in again.

## Manual requests

`client.rest` sends the same headers as the high-level methods:

```ts
const data = await client.rest.get("/api/servers");
const result = await client.rest.request("POST", "/api/some/route", {
  body: { hello: "world" },
});
```

Supported helpers: `get`, `post`, `put`, `patch`, `delete`, `request`.

Request options include `query`, `body`, `headers`, `timeoutMs`, `retries`,
`auth`, and `cookies`. See [API reference](api-reference.md#restclient).

### Custom headers

```ts
const data = await client.rest.post("/api/servers/123/channels/456/messages/search", {
  body: { query: "hello" },
  headers: { accept: "application/json" },
});
```

The client merges custom headers over its defaults, but does not let you replace
the auth cookie or CSRF token accidentally unless you explicitly set them.

## Session security

- Treat `access_token`, `refresh_token`, `__Host-csrf`, 2FA secrets, and backup
  codes as passwords.
- Do not commit `.env`, token dumps, or browser cookie exports.
- Do not run multiple clients from the same refresh token. They will race and
  can invalidate each other.
- Prefer a dedicated account/session for automation, and log out when done.
- `fetchSessions()` shows active sessions; `revokeSession()` and
  `revokeAllSessions()` end them.

## Common auth failures

| Status | Meaning | Fix |
| --- | --- | --- |
| `401` on every request | No/expired session cookie | `login()` or `refreshSession()` |
| `401` after copying tokens | Stale or replayed refresh token | Log in again; use a fresh session |
| `403` `csrf_invalid` | Missing or mismatched CSRF token | Let `RestClient` manage cookies; don't override them |
| `403` `Missing permission` | Authenticated but lacking a server permission | Check permission bits, not auth |
| `403` `requires_elevation` | Step-up auth required | Re-authenticate in the browser/current session |

See [Troubleshooting](troubleshooting.md) for more.
