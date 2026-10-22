# flackle-selfbot

An unofficial TypeScript client for [Flackle](https://flackle.com), built for Bun.

It speaks Flackle's real HTTP API and realtime gateway directly — no browser
automation, no scraping. It is a personal-use client: **not** a bot framework for
spam, raids, mass DMs, or plan-limit bypassing.

> Flackle staff have said selfbots are allowed at the time of writing. That is
> not a formal API licence, and it can change. You are responsible for how you
> use this. Do not use it to harass people, evade moderation, or exceed your
> plan's limits.

## Documentation

Full guides and an API reference live in [`docs/`](docs/README.md):

- [Getting started](docs/getting-started.md)
- [Messages](docs/messages.md) and [reactions](docs/reactions.md)
- [Servers and channels](docs/servers-channels.md)
- [Members, roles and permissions](docs/members-roles-permissions.md)
- [Gateway events](docs/gateway.md)
- [API reference](docs/api-reference.md)
- [Recipes](docs/recipes.md) and [troubleshooting](docs/troubleshooting.md)

Build the browsable guide site and the TypeDoc reference:

```bash
bun run docs
# open docs/site/index.html
```

### Cloudflare Pages deployment

Every push to `main` builds the docs and deploys them to Cloudflare Pages through
[`.github/workflows/docs.yml`](.github/workflows/docs.yml). Generated docs are not
committed; the workflow rebuilds them from the Markdown sources.

The workflow:

1. installs dependencies with Bun,
2. runs `bun run docs`,
3. uploads `docs/site` as a build artifact,
4. creates the `flackle-selfbot-docs` Pages project on first deploy,
5. publishes `main` to `https://flackle-selfbot-docs.pages.dev`.

Pull requests build and upload the docs but do not deploy. If the Cloudflare
secrets are missing, the build still succeeds and deployment is skipped with a
warning.

**One-time Cloudflare setup**

1. In the Cloudflare dashboard, create an API token with
   **Account → Cloudflare Pages → Edit** permission.
2. Copy the account ID from the dashboard.
3. Add the repository secrets:

```bash
gh secret set CLOUDFLARE_API_TOKEN
gh secret set CLOUDFLARE_ACCOUNT_ID
```

4. Push to `main`, or run **Actions → Docs → Run workflow**.

If `flackle-selfbot-docs` is already taken, change the project name in
`.github/workflows/docs.yml` and `wrangler.toml`.

For a local deploy:

```bash
bunx wrangler login
bun run docs
bunx wrangler pages deploy docs/site --project-name flackle-selfbot-docs
```

## Requirements

- [Bun](https://bun.sh) 1.1+ (the gateway handshake needs a custom `Origin`
  header, which Bun's WebSocket supports)
- A Flackle account

## Install

This is not published to npm — use the folder directly:

```bash
cd flackle-selfbot
bun install
```

Or add it to another project by path:

```bash
bun add /path/to/flackle-selfbot
```

## Quick start

```ts
import { FlackleClient } from "flackle-selfbot";

const client = new FlackleClient();

await client.login({
  email: process.env.FLACKLE_EMAIL!,
  password: process.env.FLACKLE_PASSWORD!,
});

client.on("ready", (ready) => {
  console.log(`connected as ${ready.user?.username}`);
});

client.on("messageCreate", (event) => {
  console.log(event.message.sender?.username, event.message.content);
});

await client.connect();
```

`login()` handles TOTP MFA:

```ts
await client.login({
  email,
  password,
  mfa: async () => prompt("MFA code:")!,
});
```

## How authentication works

Flackle authenticates with **HttpOnly cookies**, not a bearer token. The API
accepts `Authorization: Bearer` only alongside the `access_token` cookie, so the
client maintains a cookie jar and replays it on every request.

- `POST /api/auth/login` sets `access_token` (15 min) and `refresh_token` (30 days)
- `POST /api/auth/refresh` rotates the access token
- Mutating requests need the `__Host-csrf` cookie and a matching `x-csrf-token`
  header (double-submit). The client fetches the cookie automatically and retries
  once on `csrf_invalid`.
- Every request sends `X-Requested-With: XMLHttpRequest`

You can skip `login()` if you already have tokens:

```ts
const client = new FlackleClient({
  accessToken: "...",
  refreshToken: "...",
  csrfToken: "...",
});
```

The client refreshes an expired access token automatically before retrying a
401. If the refresh token is dead, it throws `FlackleAuthError`.

## Sending messages

Flackle's web client sends, edits, and deletes messages over the **gateway**, not
REST. The gateway must be connected first.

```ts
await client.connect();

// Guild channel
const message = await client.sendMessage(
  { serverId: "369864995946631168", channelId: "371326486818328576" },
  "hello from a selfbot",
);

// DM / group conversation
await client.sendMessage({ conversationId: "370211735648342016" }, "hi");

// Reply
await client.sendMessage(target, "replying", { replyToMessageId: message.id });

// Edit / delete
await client.editMessage(target, message.id, "edited");
await client.deleteMessage(target, message.id);
```

`sendMessage()` resolves with the created message. Because Flackle does not echo
your own guild messages back over the gateway, the client uses the
`message_ack` frame and returns a message object assembled from it after a short
grace period (id, content, attachments, embeds). For DMs, the real echo is used
when it arrives.

### Attachments

```ts
const file = Bun.file("./cat.png");
const attachment = await client.uploadAttachment(file, "cat.png");
await client.sendMessage(target, "", { attachments: [attachment] });
```

Uploads use Flackle's multipart flow (`POST /api/uploads` → presigned R2 parts →
`POST /api/uploads/:id/complete`). Part size and URLs come from the server.

There is also a one-shot multipart endpoint used by the web client:

```ts
// POST .../attachments with multipart field "file"
const attachments = await client.uploadAttachmentDirect(target, file, "cat.png");
await client.sendMessage(target, "", { attachments });

// Larger files use the direct path (.../attachments/direct)
const big = await client.uploadAttachmentDirect(target, bigFile, "backup.zip", true);
```

### Typing, read state, reactions

```ts
await client.sendTyping(target);
await client.stopTyping(target);
await client.markRead(target, message.id);

await client.react(target, message.id, "👍");
await client.unreact(target, message.id, "👍");

// Who reacted with one emoji (full list)
const users = await client.fetchReactions(target, message.id, "👍");
const { users: everyone, total } = await client.fetchReactionUsers(
  target,
  message.id,
  "👍",
);
```

Each message also carries a reaction summary, so you can inspect every emoji
without an extra request:

```ts
for (const reaction of message.reactions ?? []) {
  console.log(reaction.emoji, reaction.count, reaction.me, reaction.users);
}
```

`reaction.users` is the same short preview the web client renders (up to four
users); call `fetchReactionUsers()` when you need the complete list.

Guild reactions are scoped with `/@me`; DM reactions rely on the session cookie,
matching the web client.

## Reading data

```ts
const me = await client.fetchMe();
const servers = await client.fetchServers();
const server = await client.fetchServer(serverId);
const { channels, categories, permissions } = await client.fetchChannels(serverId);

// Walk the server tree, newest page of each text channel, and print reactions.
for (const channel of channels) {
  if (channel.type !== "text") continue;

  const page = await client.fetchMessages(
    { serverId, channelId: channel.id },
    { limit: 50 },
  );

  for (const message of page.messages) {
    for (const reaction of message.reactions ?? []) {
      const reactors = await client.fetchReactions(
        { serverId, channelId: channel.id },
        message.id,
        reaction.emoji,
      );
      console.log(channel.name, message.id, reaction.emoji, reactors.map((u) => u.username));
    }
  }
}

const page = await client.fetchMessages(
  { serverId, channelId },
  { limit: 50, before: messageId }, // or after / around
);

const conversations = await client.fetchConversations();
const messages = await client.fetchMessages({ conversationId });
```

Messages are paginated with `has_more`, `has_more_before`, and
`has_more_after`.

Other helpers: `fetchEntry()`, `fetchUnreadSummary()`, `fetchServerSettings()`,
`fetchVoiceStates()`, `fetchSavedMedia()`, `fetchSessions()`, `setStatus()`,
`logout()`.

## Members and roles

```ts
const members = await client.fetchAllMembers(serverId);        // walks pagination
const page = await client.fetchMembersPage(serverId, { limit: 100, offset: 0 });
const member = await client.fetchMember(serverId, userId);
const visibleIds = await client.fetchChannelMembers(serverId, channelId);

await client.setNickname(serverId, userId, "new nickname");
await client.addMemberRole(serverId, userId, roleId);
await client.removeMemberRole(serverId, userId, roleId);
await client.setMemberRoles(serverId, userId, [addId], [removeId]);

await client.timeoutMember(serverId, userId, 600, "cool down");
await client.removeTimeout(serverId, userId);
await client.kickMember(serverId, userId, "reason");
await client.banMember(serverId, userId, "reason");
await client.unbanMember(serverId, userId);
```

Roles are written as a batch, which is how the web client keeps positions and
deletions consistent. `expected_updated_at` gives optimistic concurrency:

```ts
const roles = await client.fetchRoles(serverId);
const role = roles.find((r) => r.id === roleId)!;

await client.updateRoles(serverId, {
  updates: [{ id: role.id, name: "New name", expected_updated_at: role.updated_at }],
  creates: [{ name: "New role", permissions: "0" }],
  deletes: [{ id: oldRoleId }],
  order: roles.map((r) => r.id),
});
```

Pass `iconFiles` keyed by role ID to upload role icons in the same request; the
client switches to multipart `changes` + `icon_<id>` fields.

## Permissions

Permission payloads are decimal strings. The library exposes them as `bigint`:

```ts
import {
  PermissionFlags,
  computePermissions,
  formatPermissions,
  hasPermission,
  permissionNames,
} from "flackle-selfbot";

const bits = await client.fetchChannelPermissions(serverId, channelId);
if (hasPermission(bits, "ManageMessages")) {
  // ...
}
console.log(formatPermissions(bits));
console.log(permissionNames(bits));

await client.fetchServerPermissions(serverId);
await client.fetchCategoryPermissions(serverId, categoryId);
```

To compute a member's effective channel permissions locally:

```ts
const [roles, member, server, overwrites] = await Promise.all([
  client.fetchRoles(serverId),
  client.fetchMember(serverId, userId),
  client.fetchServer(serverId),
  client.fetchPermissionOverwrites(serverId, { channelId }),
]);

const effective = computePermissions({
  userId,
  ownerId: server.owner_id as string,
  member,
  roles,
  overwrites: [
    ...(overwrites.role_overrides ?? []),
    ...(overwrites.user_overrides ?? []),
  ],
});
```

Overwrites are saved with the version returned by the GET; a stale version gives
HTTP 409 and must be refreshed:

```ts
await client.updatePermissionOverwrites(serverId, { channelId }, {
  version: overwrites.version,
  permission_synced: overwrites.permission_synced,
  role_overrides: [{ role_id: roleId, allow: "0", deny: PermissionFlags.SendMessages.toString() }],
  user_overrides: [],
});
```

`PermissionFlags` has every named bit from the web client. `ALL_PERMISSIONS` is
the full 33-bit field used by the server; `KNOWN_PERMISSIONS` is just the named
subset.

## Search and message utilities

Channel and conversation search is a `POST` that normally streams NDJSON. The
client requests JSON and returns `{ messages, incomplete, scanned, next_before? }`:

```ts
const result = await client.searchMessages(target, { query: "release notes" });
console.log(result.messages, result.scanned, result.incomplete);
```

Other message helpers:

```ts
await client.fetchMessagesByIds([messageId1, messageId2]); // grouped by conversation
const latest = await client.fetchLatestMessageId(serverId, channelId);
await client.bulkDeleteMessages(serverId, channelId, 25, "cleanup");
await client.updateMessageEmbeds(target, messageId, embeds);
await client.createLinkPreview("https://example.com");
```

`bulkDeleteMessages` deletes the newest `count` messages and is irreversible.

## Invites, moderation and audit log

```ts
// Server invite links
const invite = await client.createServerInvite(serverId, {
  max_uses: 1,
  channel_id: channelId,
});
await client.fetchServerInvites(serverId);
await client.deleteServerInvite(serverId, invite.code);

// Invite preview and join
const preview = await client.fetchServerInvite(invite.code);
await client.acceptServerInvite(invite.code);

// Account-level invite quota (Flackle's site invites)
await client.fetchInvites();
await client.createInvite({ max_uses: 1, grants_root: false });

const bans = await client.fetchBans(serverId);
const audit = await client.fetchAuditLog(serverId, { limit: 50 });
```

Ownership transfer is explicit and destructive:

```ts
await client.transferServer(serverId, {
  new_owner_user_id: userId,
  confirm_name: server.name,
  password: accountPassword,
});
await client.acceptServerTransfer(serverId);
```

## Server and channel management

```ts
const { server, channel } = await client.createServer("My server");
await client.updateServer(serverId, {
  name: "Renamed",
  description: "About this server",
  default_notification_level: "mentions",
});
await client.uploadServerIcon(serverId, iconFile);
await client.uploadServerBanner(serverId, bannerFile);

const text = await client.createChannel(serverId, {
  name: "general",
  type: "text",
  category_id: categoryId,
});
await client.updateChannel(serverId, text.id, {
  topic: "Topic",
  slowmode_seconds: 10,
});
await client.deleteChannel(serverId, text.id);

const category = await client.createCategory(serverId, "Projects");
await client.updateCategory(serverId, category.id, { name: "Archive" });
await client.deleteCategory(serverId, category.id);

await client.updateChannelPositions(serverId, [{ id: text.id, position: 2 }]);
await client.updateCategoryPositions(serverId, [{ id: category.id, position: 1 }]);
```

Per-server notification settings:

```ts
await client.updateServerUserSettings(serverId, {
  notification_level: "mentions",
});
await client.updateChannelSettings(serverId, channelId, {
  notification_level: "nothing",
  clear_muted_until: true,
});
await client.markServerRead(serverId);
await client.fetchChannelSettings(serverId);
```

`fetchServerUserSettings()` reads the server entry from `/api/servers/@me/settings`
and returns `undefined` when no override exists.

## Conversations

```ts
const dm = await client.createDM(userId);
const group = await client.createGroup([userId1, userId2], "Group name");

await client.updateConversation(group.id, { name: "Renamed" });
await client.addConversationMembers(group.id, [userId3]);
await client.removeConversationMember(group.id, userId3);
await client.leaveConversation(group.id, true);

await client.muteConversation(group.id);
await client.unmuteConversation(group.id);
await client.deleteConversation(group.id);   // hides it
await client.unhideConversation(group.id);
await client.uploadConversationIcon(group.id, iconFile);
```

## Profiles and account security

```ts
const card = await client.fetchUserCard("gax", serverId);
const user = await client.fetchUserByUsername("gax");

await client.updateProfile({ display_name: "New display name" });
await client.uploadAvatar(file);
await client.uploadBanner(file);
await client.updateTypingIndicator({
  enabled: true,
  text: "typing...",
  style: "text",
  emojis: [],
});

await client.updateBento(cards);       // PUT /api/users/bento
await client.updateBlocks(blocks);     // PUT /api/users/blocks
await client.uploadBlockImage(image);  // returns the hosted URL

await client.changePassword(currentPassword, newPassword);
await client.changeEmail(newEmail, password);

const status = await client.fetch2FAStatus();
const setup = await client.setup2FA(password);   // secret + otpauth URL
await client.confirm2FA(code);
await client.createBackupCodes(password, code);

await client.revokeSession(sessionId, code);
await client.revokeAllSessions(code);
const events = await client.fetchSecurityEvents();
await client.clearSecurityEvents(code);

await client.submitGdprRequest("data");
await client.cancelAccountDeletion();
```

Treat 2FA secrets, backup codes, and session revocation codes as passwords.

## Voice

REST voice state and moderation are covered:

```ts
const states = await client.fetchServerVoiceStates(serverId);
const channelState = await client.fetchServerVoiceState(serverId, channelId);

await client.warmVoice(serverId, channelId);
await client.serverMuteVoiceMember(serverId, channelId, userId, true);
await client.serverDeafenVoiceMember(serverId, channelId, userId, true);
await client.moveVoiceMember(serverId, channelId, userId);
await client.disconnectVoiceMember(serverId, channelId, userId);

await client.fetchConversationVoiceState(conversationId);
await client.declineConversationCall(conversationId);
await client.stopConversationRinging(conversationId, userId);
```

Full voice audio (the SFU WebSocket/WebRTC transport, `libdave` encryption) is
**not** implemented. You can still inspect and moderate voice states, and send
raw voice gateway frames through `client.gateway.send()` or
`client.rest.request()` if you need to experiment.

## What else is exposed

| Area | Methods |
| --- | --- |
| Servers | `createServer`, `updateServer`, `deleteServer`, `leaveServer`, icon/banner upload, folders/rail positions |
| Channels | create/update/delete channels and categories, positions, settings, `fetchChannelKinds` |
| Members | list/page/all, get, channel visibility, nickname, roles, timeout, kick, ban |
| Roles | list, batch create/update/delete/reorder, icon upload |
| Permissions | server/channel/category `@me` bits, overwrite read/write, `computePermissions` |
| Messages | send/edit/delete, replies, reactions, typing, read state, search, bulk delete, by-ID fetch, embeds, latest ID |
| Invites | global and server invites, preview, accept, delete |
| Moderation | bans, kicks, timeouts, audit log, reports, ownership transfer |
| Conversations | DM/group create, rename, members, hide/unhide, mute, icon, call control |
| Profile | card, bento, blocks, avatar/banner, typing indicator, username check |
| Security | password/email, 2FA, backup codes, sessions, security events, GDPR, legal acceptance |
| Media | saved-media listing, save/unsave, direct attachments, link previews |
| Voice | states, warm, mute/deafen/move/disconnect, DM call control |
| Misc | lifts/supporters, channel analytics, weather/Spotify/Tweet/game metadata |

Anything not typed yet is still reachable through the escape hatch:

```ts
const data = await client.rest.request("GET", "/api/some/unmodelled/route");
```

### Not covered

- Full voice SFU/WebRTC audio transport (`libdave`, Opus, RTP)
- Purchasing flows beyond opening the billing portal
- Signup/age-gate and account creation
- Any action outside your own account or servers you can already access


## Friends

```ts
const friends = await client.fetchFriends("search");
const { incoming, outgoing } = await client.fetchFriendRequests();

await client.addFriend("username");
await client.acceptFriendRequest(requestId);
await client.rejectFriendRequest(requestId);
await client.removeFriend(userId);
await client.blockUser(userId);
await client.unblockUser(userId);
```

## Gateway events

The client forwards every gateway event. Raw packets are available as `raw`.

| Event | When |
| --- | --- |
| `ready` | `hello` received; includes `session_id`, `presences` and your user |
| `connected` / `disconnected` | socket lifecycle |
| `messageCreate` | `new_message` (DM) or `channel_message` (guild) |
| `messageUpdate` | `message_edited` / `channel_message_edited` |
| `messageDelete` | `message_deleted` / `channel_message_deleted` |
| `messagesBulkDelete` | `channel_messages_bulk_deleted` |
| `messageAck` | send/edit/delete ack, slowmode, timeout |
| `typingStart` / `typingStop` | `typing` (DM) or `channel_typing` (guild) |
| `reactionAdd` / `reactionRemove` | reaction events |
| `presenceUpdate` | `{ userId, status }` |
| `channelCreate` / `channelUpdate` / `channelDelete` | guild channels |
| `conversationCreate` / `conversationUpdate` / `conversationDelete` | DMs/groups |
| `friendRequestReceived` / `friendRequestAccepted` | friend requests |
| `friendAdd` / `friendRemove` | friend list changes |
| `guildMemberAdd` / `guildMemberRemove` | membership |
| `accountRestricted` | moderation restriction |
| `error` | socket/protocol errors |

```ts
client.on("messageCreate", ({ message, serverId, channelId, conversationId }) => {
  console.log({ serverId, channelId, conversationId, id: message.id });
});

client.on("raw", ({ type, payload }) => {
  // Every frame, including ones the client does not normalise.
});
```

### Subscriptions

After `connect()`, the client subscribes to every server you are in so guild
events flow. Control it with `autoSubscribe: false` and subscribe manually:

```ts
client.gateway.subscribeServers([serverId]);
client.gateway.addServerSubscription(serverId);
```

### Idle and status

```ts
client.gateway.setIdle(true);       // gateway idle flag
await client.setStatus("dnd");      // profile status: online | idle | dnd | offline | invisible
```

## Reconnection

The gateway sends `ping` every 45 seconds and expects any frame within 20
seconds. On an unexpected close the client reconnects with exponential backoff
(1s, 2s, 4s … up to 10 attempts). Code `1012` triggers eight fast retries
(250–750 ms). Codes `1000` and `4001` stop reconnection.

Close codes are surfaced as `FlackleGatewayError.code`.

## Errors

```ts
import {
  FlackleAPIError,
  FlackleAuthError,
  FlackleError,
  FlackleGatewayError,
} from "flackle-selfbot";

try {
  await client.react(target, messageId, "👍");
} catch (error) {
  if (error instanceof FlackleAPIError) {
    console.log(error.status, error.code, error.body);
    if (error.requiresElevation) {
      // the account needs step-up auth for this action
    }
  }
}
```

`FlackleAPIError` exposes `status`, `code`, `body`, `retryAfterMs`,
`requiresElevation`, `requiresMfaEnrollment`, `accountRestricted`, and
`accountPendingDeletion`.

## Rate limits

Flackle does not document its limits. The client serialises requests with a
50 ms gap by default and pauses the whole queue when a `429` arrives, honouring
`Retry-After`. Tune it:

```ts
new FlackleClient({ requestIntervalMs: 100, maxRetries: 3, timeoutMs: 30_000 });
```

## Smoke test

A live diagnostic lives in `scripts/smoke.ts`:

```bash
FLACKLE_EMAIL=... FLACKLE_PASSWORD=... bun run scripts/smoke.ts
```

To exercise send/edit/react/delete in a channel you own:

```bash
SMOKE_SEND=1 \
FLACKLE_SERVER_ID=... FLACKLE_CHANNEL_ID=... \
FLACKLE_EMAIL=... FLACKLE_PASSWORD=... \
bun run scripts/smoke.ts
```

It sends one message and deletes it immediately.

### Read-only API check

```bash
FLACKLE_EMAIL=... FLACKLE_PASSWORD=... bun run check:api
```

This logs in, picks a server you own (or `FLACKLE_SERVER_ID`), and exercises
members, roles, permissions, search, audit log, invites, saved media and profile
cards. It logs the temporary session out afterwards.

## How this was reverse-engineered

The client was built against the live app:

- REST route catalog and request shapes came from the authenticated Next.js
  chunks and captured XHR traffic
- Gateway frames (`hello`, `pong`, `presence_update`) were observed live
- The packet protocol (`send_channel_message`, `edit_channel_message`,
  `delete_channel_message`, `typing`, `mark_read`, `subscribe_servers`, `ping`,
  `set_idle`) mirrors the web client's own WebSocket store
- `X-Requested-With` + `__Host-csrf` double-submit behaviour matches the app's
  `fetch` wrapper

No credentials are stored by the library. If you use a `.env`, keep it out of
version control.

## Legal

This project is not affiliated with Flackle. Use it at your own risk. Automating
an account can violate a server's rules even where selfbots are tolerated; check
the current terms and the rules of any server you use it in. The authors do not
condone spam, harassment, evasion of moderation, or bypassing plan limits.
