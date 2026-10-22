# Servers and channels

## Listing servers

```ts
const servers = await client.fetchServers();

for (const server of servers) {
  console.log(server.id, server.name, server.owner_id, server.icon_url);
}
```

`fetchServers()` returns servers the account has joined. Flackle's public
discovery directory is not modelled; join a server with an invite instead.

```ts
const preview = await client.fetchServerInvite("invite-code");
const { server, landing_channel_id } = await client.acceptServerInvite("invite-code");
```

## Fetching one server

```ts
const server = await client.fetchServer(serverId);

console.log(server.name);
console.log(server.description);
console.log(server.owner_id);
console.log(server.default_notification_level);
```

## Exploring channels and categories

```ts
const { categories, channels, permissions } = await client.fetchChannels(serverId);

for (const category of categories) {
  console.log("category", category.id, category.name, category.position);
}

for (const channel of channels) {
  console.log(
    channel.id,
    channel.type,
    channel.name,
    "category:",
    channel.category_id,
  );
}
```

`permissions` is a map of channel/category IDs to decimal permission bitfields for
your account. Prefer `fetchChannelPermissions()` or
`fetchCategoryPermissions()` for one target.

### Channel kinds

```ts
const kinds = await client.fetchChannelKinds();
// ["text", "voice", "stats"]
```

### Building a tree

```ts
const byCategory = new Map<string | null, typeof channels>();

for (const channel of channels) {
  const key = channel.category_id ?? null;
  const list = byCategory.get(key) ?? [];
  list.push(channel);
  byCategory.set(key, list);
}

for (const category of categories) {
  console.log(category.name);
  for (const channel of byCategory.get(category.id) ?? []) {
    console.log("  #" + channel.name, channel.type);
  }
}

for (const channel of byCategory.get(null) ?? []) {
  console.log("(no category)", channel.name);
}
```

## Creating, updating and deleting

### Servers

```ts
const { server, channel } = await client.createServer("My server");

await client.updateServer(server.id, {
  name: "Renamed",
  description: "About this server",
  default_notification_level: "mentions",
});

await client.uploadServerIcon(server.id, Bun.file("./icon.png"));
await client.uploadServerBanner(server.id, Bun.file("./banner.png"));

await client.leaveServer(server.id);  // leave
await client.deleteServer(server.id); // owner only, permanent
```

`uploadServerIcon()` and `uploadServerBanner()` return the hosted URL.

### Channels

```ts
const channel = await client.createChannel(serverId, {
  name: "general",
  type: "text",
  category_id: categoryId,
  topic: "Welcome",
  slowmode_seconds: 0,
});

await client.updateChannel(serverId, channel.id, {
  name: "renamed",
  topic: "New topic",
  slowmode_seconds: 10,
  category_id: null, // move out of a category
});

await client.deleteChannel(serverId, channel.id);
```

`CreateChannelOptions`:

```ts
{
  name: string;
  type?: "text" | "voice" | "stats" | string;
  category_id?: Snowflake | null;
  topic?: string | null;
  slowmode_seconds?: number;
}
```

`ChannelUpdate` supports `name`, `topic`, `slowmode_seconds`, `category_id`,
`position`, `icon_color`, `visibility_status`, and `metadata`.

### Categories

```ts
const category = await client.createCategory(serverId, "Projects");

await client.updateCategory(serverId, category.id, { name: "Archive" });
await client.deleteCategory(serverId, category.id);
```

`updateCategory()` also accepts a plain string as a shorthand for the new name.

## Positions and layout

```ts
await client.updateChannelPositions(serverId, [
  { id: channelId, position: 0, category_id: categoryId },
  { id: otherChannelId, position: 1, category_id: null },
]);

await client.updateCategoryPositions(serverId, [
  { id: categoryId, position: 0 },
]);

// Server rail order and folders
await client.updateServerPositions([
  { server_id: serverId, position: 0, folder_id: folderId },
  { server_id: otherServerId, position: 1, clear_folder: true },
]);
```

Folders:

```ts
const created = await client.createFolder("Communities", "#5865f2");
await client.updateFolder(folderId, { name: "Servers", color: null });
await client.updateFolderPositions([{ id: folderId, position: 0 }]);
await client.deleteFolder(folderId);
```

Folder response shapes are intentionally loose (`{ folder?: unknown }`) because
the web client does not rely on a strict schema.

## Notification settings

```ts
// Per-server override
await client.updateServerUserSettings(serverId, {
  notification_level: "mentions",
});

// Per-channel override
await client.updateChannelSettings(serverId, channelId, {
  notification_level: "nothing",
  muted_until: "2026-11-01T00:00:00Z",
});

// Clear an existing mute
await client.updateChannelSettings(serverId, channelId, {
  clear_muted_until: true,
});

const channels = await client.fetchChannelSettings(serverId);
const settings = await client.fetchServerUserSettings(serverId); // may be undefined
```

`fetchServerUserSettings()` reads the server entry out of
`/api/servers/@me/settings`; it returns `undefined` when the account has no
explicit override for that server.

Mark a server read:

```ts
await client.markServerRead(serverId);
```

Unread counts:

```ts
const { channels: unread } = await client.fetchUnreadSummary();
for (const entry of unread) {
  console.log(entry.server_id, entry.channel_id, entry.unread_count, entry.mention_count);
}
```

## Invites

```ts
const invite = await client.createServerInvite(serverId, {
  max_uses: 1,
  channel_id: channelId,
  force_new: true,
});

await client.fetchServerInvites(serverId);
await client.deleteServerInvite(serverId, invite.code);

const preview = await client.fetchServerInvite(invite.code);
await client.acceptServerInvite(invite.code);
```

Account-level invite quota:

```ts
await client.fetchInvites();
await client.createInvite({ max_uses: 1, grants_root: false });
await client.deleteInvite(code);
await client.validateInvite(code);
```

See [Members, roles and permissions](members-roles-permissions.md) for bans,
audit log and moderation, and [API reference](api-reference.md) for every
signature.
