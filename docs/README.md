# flackle-selfbot documentation

An unofficial Bun/TypeScript client for [Flackle](https://flackle.com). It talks
to Flackle's real HTTP API and realtime gateway — no browser automation, no
scraping.

> **Status:** personal-use library. Flackle staff have tolerated selfbots, but
> there is no official bot API or formal permission. Rules can change. Do not use
> this for spam, raids, mass DMs, harassment, evasion of moderation, or bypassing
> plan limits.

## Start here

| Guide | What it covers |
| --- | --- |
| [Getting started](getting-started.md) | Install, log in, connect, send the first message |
| [Authentication](authentication.md) | Cookies, CSRF, token refresh, MFA, session safety |
| [Messages](messages.md) | Read history, paginate, send/edit/delete, search, embeds |
| [Reactions](reactions.md) | Reaction summaries, full reactor lists, live events |
| [Servers and channels](servers-channels.md) | Explore servers, categories and channels |
| [Members, roles and permissions](members-roles-permissions.md) | Member lists, role batches, permission math |
| [Conversations](conversations.md) | DMs, groups, members, mute/hide, call control |
| [Gateway events](gateway.md) | Realtime events, subscriptions, reconnect behaviour |
| [Media and uploads](media-uploads.md) | Presigned uploads, direct uploads, saved media |
| [Account and security](account.md) | Profile, 2FA, sessions, GDPR, reports |
| [API reference](api-reference.md) | Grouped method reference for the whole client |
| [Recipes](recipes.md) | Copy-paste examples for common tasks |
| [Troubleshooting](troubleshooting.md) | Auth errors, rate limits, gateway problems |

The browsable guide site is built to `docs/site/index.html`; the generated TypeDoc
API lives at `docs/site/api/index.html`. Build both with:

```bash
bun run docs
```

## 30-second example

```ts
import { FlackleClient } from "flackle-selfbot";

const client = new FlackleClient();

await client.login({
  email: process.env.FLACKLE_EMAIL!,
  password: process.env.FLACKLE_PASSWORD!,
});

await client.connect();

client.on("messageCreate", ({ message, serverId, channelId }) => {
  console.log(serverId, channelId, message.sender?.username, message.content);
});

const servers = await client.fetchServers();
console.log(servers.map((server) => server.name));
```

`connect()` is required for gateway events and for sending, editing or deleting
messages. Read-only REST calls work without it.

## Two ways to use it

**Whole client** — high-level helpers, gateway lifecycle and events:

```ts
const client = new FlackleClient();
await client.login({ email, password });
await client.connect();

const page = await client.fetchMessages({ serverId, channelId });
await client.sendMessage({ serverId, channelId }, "hello");
```

**Raw REST** — for endpoints that are not modelled yet:

```ts
const data = await client.rest.request("GET", "/api/some/unmodelled/route");
```

The REST client still handles cookies, CSRF, refresh, retries and rate limiting.

## What it does not do

- Full voice audio (SFU/WebRTC, Opus, `libdave`). REST voice state and moderation
  are supported.
- Signup, age-gate, password reset, and purchases beyond opening the billing
  portal.
- Public server discovery. You can list servers you joined and accept invites.
- Anything outside your own account or servers you can already access.

## Legal

This project is not affiliated with Flackle. Automating an account can violate a
server's rules even where selfbots are tolerated. Check the current terms and the
rules of any server you use it in. The authors do not condone abuse.
