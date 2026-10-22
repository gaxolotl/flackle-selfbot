# Recipes

Copy-paste starting points. All examples assume:

```ts
import { FlackleClient } from "flackle-selfbot";

const client = new FlackleClient();
await client.login({
  email: process.env.FLACKLE_EMAIL!,
  password: process.env.FLACKLE_PASSWORD!,
});
```

## 1. Print every server and channel

```ts
const servers = await client.fetchServers();

for (const server of servers) {
  console.log(`\n${server.name} (${server.id})`);

  const { categories, channels } = await client.fetchChannels(server.id);
  const categoryName = new Map(categories.map((category) => [category.id, category.name]));

  for (const channel of channels) {
    const category = channel.category_id
      ? categoryName.get(channel.category_id) ?? "unknown"
      : "(none)";
    console.log(`  [${category}] ${channel.type} ${channel.name} (${channel.id})`);
  }
}
```

## 2. Export a channel to JSONL

```ts
import { appendFile } from "node:fs/promises";

const output = "./channel-export.jsonl";
let before: string | undefined;

for (let page = 0; page < 20; page++) {
  const result = await client.fetchMessages(
    { serverId, channelId },
    { limit: 100, before },
  );

  for (const message of result.messages) {
    const line = JSON.stringify({
      id: message.id,
      created_at: message.created_at,
      author: message.sender
        ? {
            id: message.sender.id,
            username: message.sender.username,
            display_name: message.sender.display_name,
          }
        : null,
      content: message.content,
      attachments: message.attachments,
      reactions: message.reactions,
    });
    await appendFile(output, line + "\n");
  }

  if (!result.has_more_before || result.messages.length === 0) break;
  before = result.messages[result.messages.length - 1]!.id;

  await Bun.sleep(250); // be gentle
}

console.log("wrote", output);
```

This is a personal export; respect other users' privacy and the server's rules.

## 3. Watch messages across all joined servers

```ts
const names = new Map<string, { server: string; channel: string }>();

for (const server of await client.fetchServers()) {
  const { channels } = await client.fetchChannels(server.id);
  for (const channel of channels) {
    names.set(`${server.id}:${channel.id}`, {
      server: server.name,
      channel: channel.name,
    });
  }
}

await client.connect();

client.on("messageCreate", ({ message, serverId, channelId }) => {
  const label = serverId && channelId
    ? names.get(`${serverId}:${channelId}`)
    : undefined;

  const where = label
    ? `${label.server} / #${label.channel}`
    : `DM ${message.conversation_id ?? ""}`;

  console.log(`[${where}] ${message.sender?.username}: ${message.content}`);
});
```

`autoSubscribe` is on by default, so events arrive for all joined servers.

## 4. Search a channel for a user's messages

```ts
const results = await client.searchMessages(
  { serverId, channelId },
  {
    query: process.env.FLACKLE_SEARCH_QUERY ?? "hello",
    author_id: userId,
    limit: 50,
  },
);

for (const message of results.messages) {
  console.log(message.created_at, message.content);
}
```

Search may return `incomplete: true` when the server stops scanning early.

## 5. Inspect reactions and tag reactors

```ts
const page = await client.fetchMessages({ serverId, channelId }, { limit: 100 });

for (const message of page.messages) {
  for (const reaction of message.reactions ?? []) {
    const users = await client.fetchReactions(
      { serverId, channelId },
      message.id,
      reaction.emoji,
    );

    console.log(
      message.id,
      reaction.emoji,
      reaction.count,
      users.map((user) => user.username).join(", "),
    );
  }
}
```

## 6. Compute a member's effective channel permissions

```ts
import { computePermissions, permissionNames } from "flackle-selfbot";

const [server, roles, member, overwrites] = await Promise.all([
  client.fetchServer(serverId),
  client.fetchRoles(serverId),
  client.fetchMember(serverId, userId),
  client.fetchPermissionOverwrites(serverId, { channelId }),
]);

const bits = computePermissions({
  userId,
  ownerId: server.owner_id,
  member,
  roles,
  overwrites: [
    ...(overwrites.role_overrides ?? []),
    ...(overwrites.user_overrides ?? []),
  ],
});

console.log(permissionNames(bits));
```

## 7. Check whether you can post before trying

```ts
import { hasPermission } from "flackle-selfbot";

const bits = await client.fetchChannelPermissions(serverId, channelId);

if (!hasPermission(bits, "ViewChannel") || !hasPermission(bits, "SendMessages")) {
  throw new Error("This account cannot post in that channel");
}

await client.connect();
await client.sendMessage({ serverId, channelId }, "hello");
```

## 8. DM watcher

```ts
await client.connect();

client.on("messageCreate", ({ message, conversationId }) => {
  if (!conversationId) return;
  console.log(`DM ${conversationId}: ${message.sender?.username}: ${message.content}`);
});
```

To reply:

```ts
await client.sendMessage({ conversationId }, "hi");
```

## 9. Create and clean up a test channel

```ts
const channel = await client.createChannel(serverId, {
  name: "selfbot-test",
  type: "text",
});

try {
  await client.connect();
  await client.sendMessage({ serverId, channelId: channel.id }, "test");
  await Bun.sleep(1_000);
} finally {
  await client.deleteChannel(serverId, channel.id);
}
```

Always use `try/finally` for test artifacts.

## 10. Build a permission audit table

```ts
const [roles, members] = await Promise.all([
  client.fetchRoles(serverId),
  client.fetchAllMembers(serverId),
]);

for (const member of members) {
  const bits = computePermissions({
    userId: member.user.id,
    ownerId: server.owner_id,
    member,
    roles,
  });

  console.log(member.user.username, permissionNames(bits).join(", "));
}
```

For channel-specific permissions, add the channel overwrites. This can be many
requests on large servers; cache `fetchRoles()` and overwrites.

## 11. Read saved media

```ts
let cursor: string | undefined;

do {
  const page = await client.fetchSavedMedia({ cursor });
  for (const item of page.items) {
    console.log(item.file_name, item.url, item.saved_at);
  }
  cursor = page.next_cursor ?? undefined;
} while (cursor);
```

## 12. Raw request escape hatch

When an endpoint is not modelled:

```ts
const data = await client.rest.request("GET", "/api/some/route", {
  query: { limit: 10 },
});

const created = await client.rest.post("/api/some/route", {
  body: { hello: "world" },
});
```

The raw client still handles cookies, CSRF, refresh, retries and rate limiting.
