# API reference

This is a grouped reference for the public client surface. The exhaustive,
auto-generated reference — every interface, type alias and option field — is built
with TypeDoc:

```bash
bun run docs
# open docs/site/index.html
# TypeDoc: docs/site/api/index.html
```

`Snowflake` means `string | number`. API payloads use strings.

## FlackleClient

```ts
new FlackleClient(options?: FlackleClientOptions)
```

| Option | Default | Meaning |
| --- | --- | --- |
| `baseUrl` | `https://flackle.com` | Web app origin |
| `userAgent` | Chrome-like UA | Sent to REST and gateway |
| `requestIntervalMs` | `50` | Minimum gap between REST requests |
| `timeoutMs` | `30000` | Per-request timeout |
| `maxRetries` | `2` | Retries for 429/5xx |
| `autoReconnect` | `true` | Gateway reconnect |
| `heartbeatIntervalMs` | `45000` | Gateway ping interval |
| `maxReconnectAttempts` | `10` | Consecutive gateway attempts |
| `autoSubscribe` | `true` | Subscribe to all joined servers |
| `accessToken` | — | Existing session token |
| `refreshToken` | — | Existing refresh token |
| `csrfToken` | — | Existing CSRF token |

Properties:

| Property | Type | Notes |
| --- | --- | --- |
| `rest` | `RestClient` | Low-level HTTP |
| `gateway` | `Gateway` | WebSocket |
| `user` | `SelfUser \| undefined` | Set after login/refresh |
| `autoSubscribe` | `boolean` | Constructor option |

### Lifecycle

| Method | Returns | Notes |
| --- | --- | --- |
| `login(options)` | `Promise<SelfUser>` | Email/password, optional MFA callback |
| `refreshSession()` | `Promise<SelfUser>` | Refresh cookies and return account |
| `fetchMe()` | `Promise<SelfUser>` | Current account |
| `connect()` | `Promise<void>` | Open gateway, wait for `hello` |
| `destroy()` | `Promise<void>` | Disconnect and stop timers |
| `logout()` | `Promise<void>` | End session, clear local tokens |

### Bootstrap and reading

| Method | Returns |
| --- | --- |
| `fetchEntry()` | `BootstrapPayload` |
| `fetchServers()` | `Server[]` |
| `fetchServer(serverId)` | `Server` |
| `fetchChannels(serverId)` | `ChannelBundle` (`categories`, `channels`, `permissions`) |
| `fetchConversations()` | `Conversation[]` |
| `fetchUnreadSummary()` | `{ channels: UnreadChannel[] }` |
| `fetchServerSettings()` | `ServerFolders` |
| `fetchVoiceStates()` | `{ voice_states: Record<Snowflake, VoiceState[]> }` |
| `fetchStatus()` | `{ status: PresenceStatus }` |
| `setStatus(status)` | `Promise<void>` |
| `fetchSessions()` | `{ sessions: SessionInfo[] }` |
| `fetchSavedMedia(options?)` | `SavedMediaPage` |

## Messages

```ts
type MessageTarget =
  | { serverId: Snowflake; channelId: Snowflake }
  | { conversationId: Snowflake };
```

| Method | Returns | Notes |
| --- | --- | --- |
| `fetchMessages(target, options?)` | `Page<Message>` | `limit`, `before`, `after`, `around` |
| `sendMessage(target, content, options?)` | `Promise<Message>` | Gateway required |
| `editMessage(target, messageId, content)` | `Promise<void>` | Gateway required |
| `deleteMessage(target, messageId, reason?)` | `Promise<void>` | Gateway required |
| `sendTyping(target)` | `Promise<void>` | Gateway required |
| `stopTyping(target)` | `Promise<void>` | Gateway required |
| `markRead(target, messageId)` | `Promise<void>` | Gateway required |
| `fetchMessagesByIds(ids)` | `ConversationMessagesByIds` | Grouped by conversation |
| `searchMessages(target, options)` | `MessageSearchPage` | `query`/`q`, filters |
| `bulkDeleteMessages(serverId, channelId, count, reason?)` | `BulkDeleteResult` | Destructive |
| `fetchLatestMessageId(serverId, channelId)` | `Snowflake \| null` | Guild only |
| `updateMessageEmbeds(target, messageId, embeds)` | `Promise<Message>` | Raw array body |
| `createLinkPreview(url)` | `Promise<unknown>` | REST GET |
| `saveMedia(url)` | `MediaStorageSnapshot` | — |
| `unsaveMedia(url)` | `MediaStorageSnapshot` | — |

### Send options

```ts
interface SendMessageOptions {
  attachments?: Attachment[];
  replyToMessageId?: Snowflake;
  nonce?: string;
}
```

### Page

```ts
interface Page<T> {
  messages: T[];
  has_more: boolean;
  has_more_before: boolean;
  has_more_after: boolean;
}
```

## Reactions

| Method | Returns | Notes |
| --- | --- | --- |
| `react(target, messageId, emoji)` | `Promise<void>` | Adds your reaction |
| `unreact(target, messageId, emoji)` | `Promise<void>` | Removes your reaction |
| `fetchReactions(target, messageId, emoji)` | `User[]` | Unwraps `{ users }` |
| `fetchReactionUsers(target, messageId, emoji)` | `ReactionUsersPage` | `{ users, total? }` |

`Message.reactions` contains `{ emoji, count, me, users? }`; `users` is a preview
of up to four people.

## Servers and channels

| Method | Returns | Notes |
| --- | --- | --- |
| `createServer(name)` | `CreateServerResult` | `{ server, channel }` |
| `updateServer(serverId, patch)` | `Server` | name/description/notification |
| `deleteServer(serverId)` | `Promise<void>` | Owner only |
| `leaveServer(serverId)` | `Promise<void>` | — |
| `uploadServerIcon(serverId, image)` | `string` | Returns URL |
| `uploadServerBanner(serverId, image)` | `string` | Returns URL |
| `fetchChannelKinds()` | `string[]` | `text`, `voice`, `stats` |
| `createChannel(serverId, options)` | `Channel` | — |
| `updateChannel(serverId, channelId, patch)` | `Channel` | — |
| `deleteChannel(serverId, channelId)` | `Promise<void>` | — |
| `createCategory(serverId, name)` | `Category` | — |
| `updateCategory(serverId, categoryId, patch \| name)` | `Category` | — |
| `deleteCategory(serverId, categoryId)` | `Promise<void>` | — |
| `updateChannelPositions(serverId, positions)` | `Promise<void>` | — |
| `updateCategoryPositions(serverId, positions)` | `Promise<void>` | — |
| `fetchChannelSettings(serverId)` | `ChannelSettings[]` | — |
| `updateChannelSettings(serverId, channelId, patch)` | `Promise<void>` | notification/mute |
| `fetchServerUserSettings(serverId)` | `ServerUserSettings \| undefined` | Account override |
| `updateServerUserSettings(serverId, patch)` | `Promise<void>` | — |
| `markServerRead(serverId)` | `Promise<void>` | — |
| `updateServerPositions(servers)` | `Promise<void>` | Rail order/folders |
| `createFolder(name, color?)` | `{ folder?: unknown }` | — |
| `updateFolder(folderId, patch)` | `{ folder?: unknown }` | — |
| `deleteFolder(folderId)` | `Promise<void>` | — |
| `updateFolderPositions(positions)` | `Promise<void>` | — |

## Members, roles and permissions

| Method | Returns | Notes |
| --- | --- | --- |
| `fetchMembersPage(serverId, options?)` | `MemberPage` | `limit`/`offset` |
| `fetchMembers(serverId, options?)` | `Member[]` | One page |
| `fetchAllMembers(serverId, options?)` | `Member[]` | Walks pages |
| `fetchMember(serverId, userId)` | `Member` | — |
| `fetchChannelMembers(serverId, channelId)` | `Snowflake[]` | Visible members |
| `updateMember(serverId, userId, patch)` | `Member` | Nickname etc. |
| `setNickname(serverId, userId, nickname)` | `Member` | `null` clears |
| `setMemberRoles(serverId, userId, add?, remove?)` | `Member` | — |
| `addMemberRole(serverId, userId, roleId)` | `Member` | — |
| `removeMemberRole(serverId, userId, roleId)` | `Member` | — |
| `timeoutMember(serverId, userId, seconds, reason?)` | `TimeoutResult` | — |
| `removeTimeout(serverId, userId)` | `Promise<void>` | — |
| `kickMember(serverId, userId, reason?)` | `Promise<void>` | Destructive |
| `banMember(serverId, userId, reason?)` | `Promise<void>` | Destructive |
| `fetchBans(serverId)` | `ServerBan[]` | — |
| `unbanMember(serverId, userId)` | `Promise<void>` | — |
| `fetchRolesResponse(serverId)` | `RolesResponse` | — |
| `fetchRoles(serverId)` | `Role[]` | — |
| `updateRoles(serverId, batch, iconFiles?)` | `RoleBatchResponse` | Batch create/update/delete |
| `fetchServerPermissions(serverId)` | `string` | Decimal bits |
| `fetchChannelPermissions(serverId, channelId)` | `string` | — |
| `fetchCategoryPermissions(serverId, categoryId)` | `string` | — |
| `fetchPermissionOverwrites(serverId, target)` | `PermissionOverwritesResponse` | channel/category |
| `updatePermissionOverwrites(serverId, target, payload)` | `PermissionOverwritesResponse` | version conflict 409 |

### Permission helpers

```ts
PermissionFlags
Permissions // alias
ALL_PERMISSIONS
KNOWN_PERMISSIONS
toBitfield(value)
resolvePermission(permission)
hasPermission(bits, permission)
has(...) // alias
permissionNames(bits)
permissionsFrom(names)
computePermissions(input)
formatPermissions(bits)
```

See [Members, roles and permissions](members-roles-permissions.md).

## Invites and moderation

| Method | Returns | Notes |
| --- | --- | --- |
| `fetchInvites()` | `GlobalInvites` | Account quota |
| `createInvite(options?)` | `Invite` | `max_uses`, `grants_root` |
| `deleteInvite(code)` | `Promise<void>` | — |
| `validateInvite(code)` | `Promise<unknown>` | `{ valid }` |
| `fetchServerInvites(serverId)` | `ServerInvite[]` | — |
| `createServerInvite(serverId, options?)` | `Invite` | max uses/expiry/channel |
| `deleteServerInvite(serverId, code)` | `Promise<void>` | — |
| `fetchServerInvite(code)` | `InvitePreview` | Public preview |
| `acceptServerInvite(code)` | `{ server?, landing_channel_id? }` | Join |
| `fetchAuditLog(serverId, options?)` | `AuditLogPage` | action/actor/target filters |
| `transferServer(serverId, input)` | `Promise<unknown>` | Destructive |
| `acceptServerTransfer(serverId)` | `Promise<void>` | — |
| `denyServerTransfer(serverId)` | `Promise<void>` | — |
| `cancelServerTransfer(serverId)` | `Promise<void>` | — |

## Conversations

| Method | Returns | Notes |
| --- | --- | --- |
| `fetchConversation(conversationId)` | `Conversation` | — |
| `createDM(userId)` | `Conversation` | — |
| `createGroup(memberIds, name?)` | `Conversation` | — |
| `updateConversation(conversationId, patch)` | `Conversation` | name/icon URL |
| `deleteConversation(conversationId)` | `Promise<void>` | Hides |
| `unhideConversation(conversationId)` | `Promise<void>` | — |
| `muteConversation(conversationId)` | `Promise<void>` | — |
| `unmuteConversation(conversationId)` | `Promise<void>` | — |
| `addConversationMembers(conversationId, ids)` | `{ members?, ... }` | — |
| `removeConversationMember(conversationId, userId)` | `Promise<void>` | — |
| `leaveConversation(conversationId, silent?)` | `Promise<void>` | — |
| `uploadConversationIcon(conversationId, image)` | `string` | Returns URL |
| `fetchConversationVoiceState(conversationId)` | `ConversationVoiceState` | — |
| `declineConversationCall(conversationId)` | `Promise<void>` | — |
| `stopConversationRinging(conversationId, userId)` | `Promise<void>` | — |
| `fetchBlockedWarning(conversationId)` | `{ should_show?, blocked_members? }` | — |
| `dismissBlockedWarning(conversationId)` | `Promise<void>` | — |

## Profile and account

| Method | Returns | Notes |
| --- | --- | --- |
| `fetchUserByUsername(username)` | `User` | — |
| `fetchUserById(userId)` | `User` | — |
| `fetchUserCard(username, serverId?)` | `UserCard` | Profile card |
| `fetchUserBento(username)` | `BentoCard[]` | — |
| `fetchUserBlocks(username)` | `BlockEntry[]` | — |
| `updateBento(cards)` | `BentoResponse` | — |
| `updateBlocks(blocks)` | `BlocksResponse` | — |
| `uploadBlockImage(image)` | `string` | Returns URL |
| `updateProfile(patch)` | `User` | display name/username/password |
| `uploadAvatar(image)` | `string` | — |
| `uploadBanner(image)` | `string` | — |
| `checkUsername(username)` | `{ available?, ... }` | GET |
| `updateTypingIndicator(settings)` | `TypingIndicatorSettings` | — |
| `changePassword(current, next)` | `{ message?, ... }` | — |
| `changeEmail(email, password)` | `Promise<unknown>` | — |
| `fetch2FAStatus()` | `TwoFactorStatus` | — |
| `setup2FA(password)` | `TwoFactorSetup` | secret + otpauth |
| `confirm2FA(code)` | `Promise<unknown>` | — |
| `disable2FA(options)` | `Promise<void>` | password + code/backup |
| `createBackupCodes(password, code)` | `BackupCodes` | — |
| `revokeSession(sessionId, code?)` | `Promise<void>` | — |
| `revokeAllSessions(code?)` | `Promise<void>` | — |
| `fetchSecurityEvents()` | `SecurityEvent[]` | — |
| `clearSecurityEvents(code?)` | `Promise<void>` | — |
| `fetchGdprRequests()` | `GdprRequest[]` | — |
| `submitGdprRequest(type)` | `Promise<void>` | `data`/`delete` |
| `cancelAccountDeletion()` | `Promise<void>` | — |
| `acceptLegal(version)` | `Promise<void>` | — |
| `createBillingPortal()` | `BillingSession` | URL only |

## Voice

REST voice state and moderation; audio transport is not implemented.

| Method | Returns |
| --- | --- |
| `fetchServerVoiceState(serverId, channelId)` | `Promise<unknown>` |
| `fetchServerVoiceStates(serverId)` | `ServerVoiceStatesResponse` |
| `warmVoice(serverId, channelId)` | `Promise<void>` |
| `serverMuteVoiceMember(serverId, channelId, userId, muted)` | `Promise<void>` |
| `serverDeafenVoiceMember(serverId, channelId, userId, deafened)` | `Promise<void>` |
| `moveVoiceMember(serverId, channelId, userId)` | `Promise<void>` |
| `disconnectVoiceMember(serverId, channelId, userId)` | `Promise<void>` |
| `fetchConversationVoiceState(conversationId)` | `ConversationVoiceState` |
| `declineConversationCall(conversationId)` | `Promise<void>` |
| `stopConversationRinging(conversationId, userId)` | `Promise<void>` |

## Reports, lifts and metadata

| Method | Returns |
| --- | --- |
| `submitReport(input)` | `Promise<unknown>` |
| `reportUser(userId, options)` | `Promise<unknown>` |
| `reportMessage(target, messageId, options)` | `Promise<unknown>` |
| `fetchServerLifts(serverId)` | `Promise<unknown>` |
| `fetchServerLiftSupporters(serverId)` | `Promise<unknown>` |
| `setSupporterRole(serverId, roleId \| null)` | `SupporterRoleResponse` |
| `fetchChannelAnalytics(serverId, channelId, scope)` | `Promise<unknown>` |
| `fetchChannelAnalyticsBundle(serverId, channelId)` | `Promise<unknown>` |
| `fetchChannelAnalyticsCalendar(serverId, channelId, query?)` | `Promise<unknown>` |
| `fetchChannelAnalyticsPunchcard(serverId, channelId, days?)` | `Promise<unknown>` |
| `searchGames(query)` | `Game[]` |
| `fetchGame(gameId)` | `Game` |
| `fetchSpotify(url)` | `Promise<unknown>` |
| `fetchTweet(url)` | `Promise<unknown>` |
| `fetchWeather(location)` | `Promise<unknown>` |
| `searchWeather(query)` | `Promise<unknown>` |

## RESTClient

```ts
new RestClient(options?: RestClientOptions)
```

| Option | Default |
| --- | --- |
| `baseUrl` | `https://flackle.com` |
| `userAgent` | Chrome-like |
| `requestIntervalMs` | `50` |
| `timeoutMs` | `30000` |
| `maxRetries` | `2` |
| `fetch` | global `fetch` |

Methods:

```ts
get<T>(path, options?)
post<T>(path, options?)
put<T>(path, options?)
patch<T>(path, options?)
delete<T>(path, options?)
request<T>(method, path, options?)
putAbsolute(url, body, timeoutMs?) // presigned upload PUT, returns ETag
```

`RequestOptions`:

```ts
{
  query?: Record<string, unknown>;
  body?: unknown;
  headers?: Record<string, string>;
  auth?: boolean;        // default true
  cookies?: boolean;     // default true
  refreshOn401?: boolean;// default true
  retries?: number;
  timeoutMs?: number;
}
```

Session helpers:

```ts
client.rest.setTokens({ accessToken, refreshToken, csrfToken });
client.rest.clearSession();
client.rest.ensureCsrf();
client.rest.refresh();
client.rest.csrfToken;
client.rest.hasSession;
```

## Gateway

```ts
client.gateway.connect();
client.gateway.disconnect(code?, reason?);
client.gateway.send(type, payload?);
client.gateway.trySend(type, payload?);
client.gateway.subscribeServers(ids);
client.gateway.addServerSubscription(id);
client.gateway.setIdle(idle);
client.gateway.latency;
client.gateway.subscribedServers;
client.gateway.isConnected;
client.gateway.socket;
```

See [Gateway events](gateway.md).

## Errors

| Class | Extra fields |
| --- | --- |
| `FlackleError` | `message` |
| `FlackleAPIError` | `status`, `method`, `path`, `code`, `body`, `retryAfterMs` |
| `FlackleAuthError` | message |
| `FlackleGatewayError` | `code` |

`FlackleAPIError` getters: `isUnauthorized`, `isForbidden`, `isRateLimited`,
`requiresElevation`, `requiresMfaEnrollment`, `accountRestricted`,
`accountPendingDeletion`.

## Events

`ClientEvents` is exactly `GatewayEvents`. See the event table in
[Gateway events](gateway.md#events) or the generated TypeDoc for every payload.
