# Reactions

Flackle exposes reactions in two places:

1. **On every message** — a summary of each emoji, its count, whether you reacted,
   and a short user preview.
2. **A dedicated endpoint** — the complete list of users for one emoji.

## Reaction summary

```ts
const page = await client.fetchMessages({ serverId, channelId }, { limit: 50 });

for (const message of page.messages) {
  for (const reaction of message.reactions ?? []) {
    console.log({
      emoji: reaction.emoji,
      count: reaction.count,
      me: reaction.me,
      users: reaction.users,
    });
  }
}
```

```ts
interface Reaction {
  emoji: string;
  count: number;
  me?: boolean;
  users?: User[]; // preview, normally capped at four
}
```

The `users` array is what the web client renders in the reaction tooltip. If
`count` is greater than `users.length`, fetch the full list.

## Who reacted — complete list

```ts
const users = await client.fetchReactions(
  { serverId, channelId },
  message.id,
  "👍",
);

console.log(users.map((user) => `${user.display_name ?? user.username} (${user.id})`));
```

The lower-level method also returns the total:

```ts
const { users, total } = await client.fetchReactionUsers(
  { serverId, channelId },
  message.id,
  "👍",
);

console.log(`${users.length} of ${total ?? users.length}`);
```

Both methods use:

```text
GET /api/servers/{serverId}/channels/{channelId}/messages/{messageId}/reactions/{emoji}
GET /api/conversations/{conversationId}/messages/{messageId}/reactions/{emoji}
```

The emoji is URL-encoded automatically. Pass the exact emoji string that appears
in `reaction.emoji`.

> The HTTP response is `{ users, total }`, not a bare array. `fetchReactions()`
> unwraps it for convenience.

## Adding and removing your reaction

```ts
await client.react(target, messageId, "👍");
await client.unreact(target, messageId, "👍");
```

For guild messages the client uses the web app's `/@me` scoped route. DM
reactions rely on the session cookie. Both require authentication but not the
gateway.

## Live reaction events

Connect the gateway first:

```ts
await client.connect();

client.on("reactionAdd", ({ messageId, emoji, count, user, userId, serverId, channelId }) => {
  console.log(`${user?.username ?? userId} added ${emoji}; now ${count}`);
});

client.on("reactionRemove", ({ messageId, emoji, count, user, userId }) => {
  console.log(`${user?.username ?? userId} removed ${emoji}; now ${count}`);
});
```

```ts
interface GatewayReaction {
  messageId: Snowflake;
  emoji: string;
  count: number;
  userId?: Snowflake;
  user?: User;
  serverId?: Snowflake;
  channelId?: Snowflake;
  conversationId?: Snowflake;
}
```

The gateway event already includes `user` when Flackle supplies it, so you may
not need an extra REST call for live updates. For history, use the REST methods
above.

## Recipe: inspect all reactions in a channel

```ts
const page = await client.fetchMessages({ serverId, channelId }, { limit: 100 });

for (const message of page.messages) {
  for (const reaction of message.reactions ?? []) {
    const users = await client.fetchReactions(
      { serverId, channelId },
      message.id,
      reaction.emoji,
    );

    console.log({
      messageId: message.id,
      preview: message.content.slice(0, 60),
      emoji: reaction.emoji,
      count: reaction.count,
      reactors: users.map((user) => user.username),
    });
  }
}
```

Be considerate with request volume: cache results, paginate slowly, and don't poll
every message continuously.

## Notes

- Custom emoji support depends on how Flackle represents them. Pass the exact
  `emoji` value from the message payload; do not invent a shortcode.
- Reaction counts in gateway frames are authoritative at the time of the event,
  but can race with REST reads. Re-fetch if you need a consistent snapshot.
- Removing a reaction you do not have is a no-op or an error depending on the
  endpoint; the client simply sends the DELETE.
