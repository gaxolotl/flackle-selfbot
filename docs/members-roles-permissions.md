# Members, roles and permissions

## Members

```ts
const page = await client.fetchMembersPage(serverId, { limit: 100, offset: 0 });
// { members, total? }

const members = await client.fetchMembers(serverId, { limit: 100 });
const everyone = await client.fetchAllMembers(serverId); // walks pages
const member = await client.fetchMember(serverId, userId);
```

`fetchAllMembers()` defaults to 100 per page and at most 100 pages. It stops when
a page is short or no new members are returned.

```ts
const visible = await client.fetchChannelMembers(serverId, channelId);
// Snowflake[] of members who can see the channel
```

### Member shape

```ts
{
  user: User;
  user_id?: string;
  nickname?: string | null;
  role_ids?: string[];
  roles?: string[];
  joined_at?: string;
  timed_out_until?: string | null;
  is_owner?: boolean;
}
```

## Nicknames and roles

```ts
await client.updateMember(serverId, userId, { nickname: "new name" });
await client.setNickname(serverId, userId, "new name");
await client.setNickname(serverId, userId, null); // clear

await client.addMemberRole(serverId, userId, roleId);
await client.removeMemberRole(serverId, userId, roleId);

await client.setMemberRoles(serverId, userId, [addRoleId], [removeRoleId]);
```

`setMemberRoles` and the single-role helpers return the updated `Member`.

## Roles

```ts
const roles = await client.fetchRoles(serverId);
const response = await client.fetchRolesResponse(serverId);
// { roles, can_view_role_permissions? }

for (const role of roles) {
  console.log(role.id, role.name, role.permissions, role.position);
}
```

Role permissions are decimal strings. `can_view_role_permissions: false` means
the account can see names but not the bits.

### Batch updates

The web client writes roles as one batch so creates, deletes, updates and the
final order stay consistent:

```ts
const roles = await client.fetchRoles(serverId);

await client.updateRoles(serverId, {
  updates: [
    {
      id: roleId,
      name: "Renamed",
      expected_updated_at: role.updated_at,
    },
  ],
  creates: [{ name: "New role", permissions: "0" }],
  deletes: [{ id: oldRoleId }],
  order: roles.map((role) => role.id),
});
```

`expected_updated_at` is optimistic concurrency. A stale value is rejected.

### Role icons

```ts
await client.updateRoles(
  serverId,
  {
    updates: [{ id: roleId, upload_icon: true }],
  },
  { [roleId]: Bun.file("./role.png") },
);
```

Passing `iconFiles` switches the request to multipart `changes` +
`icon_<roleId>` fields.

## Moderation

```ts
await client.timeoutMember(serverId, userId, 600, "cool down"); // seconds
await client.removeTimeout(serverId, userId);

await client.kickMember(serverId, userId, "reason");
await client.banMember(serverId, userId, "reason");
await client.fetchBans(serverId);
await client.unbanMember(serverId, userId);
```

These require the matching permissions. Kicks and bans are destructive; timeouts
are reversible.

### Audit log

```ts
const audit = await client.fetchAuditLog(serverId, {
  limit: 50,
  before: cursor,
  actionTypes: ["member_kick"],
  actorIds: [moderatorId],
  targetIds: [userId],
});
```

```ts
interface AuditLogOptions {
  limit?: number;
  before?: string;
  actionTypes?: string[];
  actorIds?: Snowflake[];
  targetIds?: Snowflake[];
}
```

The response shape is `AuditLogPage` (`entries`, `users`, pagination cursor) and
is loosely typed because Flackle's action schema varies.

### Ownership transfer

```ts
await client.transferServer(serverId, {
  new_owner_user_id: userId,
  confirm_name: server.name,
  password: accountPassword,
});

await client.acceptServerTransfer(serverId);
// or denyServerTransfer / cancelServerTransfer
```

This is irreversible once accepted. Treat it like deleting the server.

## Permissions

Permission values are decimal strings and use 33 bits, so the library uses
`bigint`.

```ts
import {
  ALL_PERMISSIONS,
  KNOWN_PERMISSIONS,
  PermissionFlags,
  computePermissions,
  formatPermissions,
  hasPermission,
  permissionNames,
  permissionsFrom,
  toBitfield,
} from "flackle-selfbot";
```

### Reading bits

```ts
const serverBits = await client.fetchServerPermissions(serverId);
const channelBits = await client.fetchChannelPermissions(serverId, channelId);
const categoryBits = await client.fetchCategoryPermissions(serverId, categoryId);

if (hasPermission(channelBits, "SendMessages")) {
  // ...
}

console.log(permissionNames(channelBits));
console.log(formatPermissions(channelBits));
```

`hasPermission` treats `Administrator` as granting everything.

### Building a bitfield

```ts
const bits = permissionsFrom([
  "ViewChannel",
  "SendMessages",
  PermissionFlags.AddReactions,
]);
```

Permission names are the keys of `PermissionFlags`:

```ts
ViewChannel, SendMessages, AttachFiles, ManageMessages, MentionEveryone,
CreateInvite, KickMembers, BanMembers, ManageChannels, ManageRoles,
ManageServer, ChangeNickname, ManageNicknames, Administrator, AddReactions,
Connect, Speak, MuteMembers, MoveMembers, DeafenMembers, UseVideo,
ManageMembers, BypassSlowmode, TimeoutMembers, BulkDelete, ViewAuditLog,
ManagePermissions, PinMessages, SaveMedia
```

`ALL_PERMISSIONS` is `(1n << 33n) - 1n` (the server's full field, including bits
without public names). `KNOWN_PERMISSIONS` is the OR of the named flags above.

### Overwrites

```ts
const overwrites = await client.fetchPermissionOverwrites(serverId, {
  channelId,
});

// or:
const categoryOverwrites = await client.fetchPermissionOverwrites(serverId, {
  categoryId,
});
```

Response:

```ts
{
  role_overrides?: { role_id, allow, deny }[];
  user_overrides?: { user_id, allow, deny }[];
  category_role_overrides?: ...;
  category_user_overrides?: ...;
  version?: string;
  permission_synced?: boolean;
}
```

Save with the returned `version`:

```ts
await client.updatePermissionOverwrites(
  serverId,
  { channelId },
  {
    version: overwrites.version,
    permission_synced: overwrites.permission_synced,
    role_overrides: [
      { role_id: roleId, allow: "0", deny: PermissionFlags.SendMessages.toString() },
    ],
    user_overrides: [],
  },
);
```

A stale version returns HTTP `409`; fetch the overwrites again and retry. This
is intentional conflict protection, not an auth failure.

### Computing effective permissions

```ts
const [roles, member, server, overwrites] = await Promise.all([
  client.fetchRoles(serverId),
  client.fetchMember(serverId, userId),
  client.fetchServer(serverId),
  client.fetchPermissionOverwrites(serverId, { channelId }),
]);

const effective = computePermissions({
  userId,
  ownerId: server.owner_id,
  member,
  roles,
  overwrites: [
    ...(overwrites.role_overrides ?? []),
    ...(overwrites.user_overrides ?? []),
  ],
});

console.log(permissionNames(effective));
```

The algorithm matches the web client: base `@everyone` role, other roles, then
`@everyone`/role/member overwrites, with owner and administrator bypasses.

See the [API reference](api-reference.md#members-roles-and-permissions) and generated TypeDoc for
the full table.
