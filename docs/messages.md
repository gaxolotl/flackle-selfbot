# Messages

Messages can live in a server channel or a DM/group conversation. Most methods
take a `MessageTarget`:

```ts
type MessageTarget =
  | { serverId: Snowflake; channelId: Snowflake }
  | { conversationId: Snowflake };
```

`Snowflake` is `string | number`; IDs are strings in API payloads.

## Reading history

```ts
const page = await client.fetchMessages(
  { serverId, channelId },
  { limit: 50 },
);

for (const message of page.messages) {
  console.log(message.id, message.sender?.username, message.content);
}
```

```ts
type FetchMessagesOptions = {
  limit?: number;      // default 50
  before?: Snowflake;
  after?: Snowflake;
  around?: Snowflake;
};
```

The response is a `Page<Message>`:

```ts
{
  messages: Message[];
  has_more: boolean;
  has_more_before: boolean;
  has_more_after: boolean;
}
```

Paginate towards older messages by passing the oldest ID as `before`; paginate
towards newer messages with `after`. `around` is useful for jumping to a message.

For DMs/groups:

```ts
const page = await client.fetchMessages({ conversationId }, { limit: 50 });
```

### Message shape

```ts
{
  id: string;
  content: string;
  type: "text" | "system" | string;
  sender?: User;
  created_at: string;
  edited_at?: string;
  is_deleted: boolean;
  attachments?: Attachment[];
  embeds?: Embed[];
  reply_to?: MessageReply;
  reactions?: Reaction[];
  mention_ids?: Snowflake[];
  mention_everyone?: boolean;
}
```

## Sending

Sending uses the gateway, not REST. Connect first:

```ts
await client.connect();

const message = await client.sendMessage(
  { serverId, channelId },
  "hello",
);
```

`sendMessage` resolves with a message object. For your own guild messages,
Flackle does not echo the created message back over the socket; the client waits
for `message_ack` and assembles the result after a short grace period. The ID and
content are usable, but fields that only exist in the real echo may be missing.
DM messages use the real gateway echo.

### Replies

```ts
await client.sendMessage(target, "replying to you", {
  replyToMessageId: message.id,
});
```

### Attachments

```ts
const attachment = await client.uploadAttachment(
  Bun.file("./cat.png"),
  "cat.png",
);

await client.sendMessage(target, "", { attachments: [attachment] });
```

At least one of content or attachments is required.

### Custom nonce

```ts
await client.sendMessage(target, "hello", {
  nonce: crypto.randomUUID(),
});
```

Use this when you need to correlate the gateway `message_ack` with your own
bookkeeping.

## Editing and deleting

Both require the gateway:

```ts
await client.editMessage(target, message.id, "new content");
await client.deleteMessage(target, message.id);

// Optional moderator reason on guild messages:
await client.deleteMessage(target, message.id, "spam cleanup");
```

Only the author (or a moderator with the right permission) can edit/delete.
Deletion is permanent.

## Typing and read state

```ts
await client.sendTyping(target);
await client.stopTyping(target);

await client.markRead(target, message.id);
```

Typing indicators expire after roughly five seconds. `markRead` sends a gateway
read receipt; it does not fetch messages for you.

## Searching

Search is a `POST` that streams NDJSON by default. The client requests JSON and
returns a page:

```ts
const result = await client.searchMessages(target, {
  query: "release notes",
  limit: 50,
});

console.log(result.messages, result.scanned, result.incomplete);
```

`q` is accepted as an alias for `query`. Extra filters are passed through to the
server, including `before`, `after`, `author_id`, `pinned`, `limit`, and `offset`
where supported.

```ts
const older = await client.searchMessages(target, {
  query: "deploy",
  before: messageId,
  author_id: userId,
});
```

The response includes `next_before` on some pages:

```ts
type MessageSearchPage = {
  messages: Message[];
  incomplete?: boolean;
  scanned?: number;
  next_before?: string;
};
```

Search is server-side; it may scan a limited window and return
`incomplete: true`. Do not treat it as an exhaustive database export.

### Fetch by IDs

```ts
const grouped = await client.fetchMessagesByIds([id1, id2, id3]);
// { conversations: { [conversationId]: { messages, has_more_before, has_more } } }
```

### Latest message ID

```ts
const latest = await client.fetchLatestMessageId(serverId, channelId);
```

### Bulk delete

```ts
const { deleted } = await client.bulkDeleteMessages(
  serverId,
  channelId,
  25,
  "cleanup",
);
```

This deletes the newest `count` messages and is irreversible. It needs the
relevant bulk-delete/manage-messages permission.

## Reactions

Every `Message` carries a reaction summary:

```ts
for (const reaction of message.reactions ?? []) {
  console.log(reaction.emoji, reaction.count, reaction.me, reaction.users);
}
```

See [Reactions](reactions.md) for full reactor lists and live events.

## Embeds and link previews

Link previews are fetched over REST:

```ts
const preview = await client.createLinkPreview("https://example.com");
```

Updating a message's embeds sends the raw embed array to
`PUT .../messages/:id/embeds`:

```ts
await client.updateMessageEmbeds(target, message.id, embeds);
```

`embeds` must be the full array you want to store, not `{ embeds }`. The API
accepts the array body directly.

## Deleting/hiding a conversation

`deleteConversation()` hides a DM/group for your account; it does not delete the
other person's copy. See [Conversations](conversations.md).
