# Conversations (DMs and groups)

A conversation is either a direct message (`type: "dm"`) or a group
(`type: "group"`). The same message APIs work with a `conversationId`.

## Listing conversations

```ts
const conversations = await client.fetchConversations();

for (const conversation of conversations) {
  console.log(conversation.id, conversation.type, conversation.name);
  console.log(conversation.members?.map((member) => member.user.username));
  console.log(conversation.last_message?.content, conversation.unread_count);
}
```

Fetch one:

```ts
const conversation = await client.fetchConversation(conversationId);
```

## Creating

```ts
const dm = await client.createDM(userId);

const group = await client.createGroup(
  [userId1, userId2],
  "Project chat", // optional name
);
```

DMs normally require an existing friendship or an account setting that allows
messages from non-friends. If sending fails with `not_friends`, add the user as a
friend first.

## Sending and reading

```ts
await client.sendMessage({ conversationId: group.id }, "hello");

const page = await client.fetchMessages({ conversationId: group.id }, { limit: 50 });
```

Search:

```ts
const results = await client.searchMessages(
  { conversationId: group.id },
  { query: "hello" },
);
```

Some conversations are hidden from `fetchConversations()`; pass the ID directly
if you know it.

## Members and metadata

```ts
await client.updateConversation(group.id, { name: "Renamed" });

await client.addConversationMembers(group.id, [userId3]);
await client.removeConversationMember(group.id, userId3);
await client.leaveConversation(group.id);
await client.leaveConversation(group.id, true); // silent
```

`updateConversation()` accepts `name` and `icon_url`. To upload an icon:

```ts
const url = await client.uploadConversationIcon(group.id, Bun.file("./icon.png"));
await client.updateConversation(group.id, { icon_url: url });
```

## Mute, hide and unhide

```ts
await client.muteConversation(conversationId);
await client.unmuteConversation(conversationId);

await client.deleteConversation(conversationId); // hides for you
await client.unhideConversation(conversationId);
```

`deleteConversation()` is a local hide, not a destructive delete for the other
participants. It matches the web app's "delete conversation" action.

## Blocked warning

```ts
const warning = await client.fetchBlockedWarning(conversationId);
if (warning.should_show) {
  console.log(warning.blocked_members);
}

await client.dismissBlockedWarning(conversationId);
```

## Voice call control

REST state and ringing control are supported; audio transport is not.

```ts
const state = await client.fetchConversationVoiceState(conversationId);
console.log(state.participants, state.ringing);

await client.declineConversationCall(conversationId);
await client.stopConversationRinging(conversationId, userId);
```

To join voice, use `client.gateway.send()` with the web client's voice frames, or
extend the library. See [Voice](api-reference.md#voice) for the REST moderation
methods.

## Message utilities

```ts
const latest = await client.fetchLatestMessageId(serverId, channelId); // guild only
const grouped = await client.fetchMessagesByIds([id1, id2]); // works across DMs
```
