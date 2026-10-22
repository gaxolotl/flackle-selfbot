# Account, profile and security

## Profile

```ts
const me = await client.fetchMe();
const user = await client.fetchUserByUsername("gax");
const byId = await client.fetchUserById(userId);

const card = await client.fetchUserCard("gax", serverId);
// { user, membership, badges, socials, blocks, member? }
```

Update the profile:

```ts
await client.updateProfile({
  display_name: "New name",
  username: "new_username",
  password: currentPassword, // required for some username changes
});

await client.uploadAvatar(Bun.file("./avatar.png"));
await client.uploadBanner(Bun.file("./banner.png"));

const availability = await client.checkUsername("new_username");
console.log(availability.available);
```

`checkUsername()` is a GET with `?username=`. The profile update endpoint may
require the current password when changing the username; the API will say so.

## Bento and blocks

Bento cards and profile blocks are JSON arrays:

```ts
const cards = await client.fetchUserBento("gax");
await client.updateBento(cards);

const blocks = await client.fetchUserBlocks("gax");
await client.updateBlocks(blocks);

const imageUrl = await client.uploadBlockImage(Bun.file("./block.png"));
```

`BentoCard` and `BlockEntry` are intentionally open-ended (`{ type, ... }`)
because the profile layout supports several block types.

## Typing indicator style

```ts
await client.updateTypingIndicator({
  enabled: true,
  text: "typing...",
  style: "text", // "text" | "emojis"
  emojis: ["👀"],
});
```

This is the account-level typing indicator, separate from sending a typing event
with `sendTyping()`.

## Password and email

```ts
await client.changePassword(currentPassword, newPassword);
await client.changeEmail(newEmail, password);
```

Both may require step-up confirmation. Changing the password can invalidate other
sessions; check `fetchSessions()` afterwards.

## Two-factor authentication

```ts
const status = await client.fetch2FAStatus(); // { enabled }

const setup = await client.setup2FA(password);
// { secret, otpauth_url?, qr_code? }

await client.confirm2FA(totpCode);

const backup = await client.createBackupCodes(password, totpCode);
// { codes: string[] }

await client.disable2FA({
  password,
  code: totpCode,          // or:
  backupCode: backupCode,
});
```

Treat `secret`, `otpauth_url`, QR data, and `codes` as passwords. Do not log them
to shared consoles. The setup flow is incomplete until `confirm2FA()` succeeds.

## Sessions and security events

```ts
const { sessions } = await client.fetchSessions();

await client.revokeSession(sessionId);
await client.revokeSession(sessionId, totpCode);
await client.revokeAllSessions(totpCode);

const events = await client.fetchSecurityEvents();
await client.clearSecurityEvents(totpCode);
```

`revokeAllSessions()` may require a current 2FA code; without one the server can
reject the request with `requires_elevation`. Clearing security events is also
protected.

## GDPR and legal

```ts
const requests = await client.fetchGdprRequests();
await client.submitGdprRequest("data");   // data export
await client.submitGdprRequest("delete"); // account deletion request
await client.cancelAccountDeletion();

await client.acceptLegal(version);
```

Account deletion is delayed and cancellable during the grace period. Do not call
it unless you mean it. The library refuses nothing here; these are explicit
account actions.

## Billing

```ts
const session = await client.createBillingPortal();
console.log(session.url);
```

Only the billing portal session is modelled. Purchasing, upgrading and plan-limit
bypass are deliberately out of scope. Open the returned URL in a browser.

## Reports

```ts
await client.reportUser(userId, {
  category: "harassment",
  additional_info: "details",
  is_ongoing_issue: true,
});

await client.reportMessage(target, messageId, {
  category: "spam",
  additional_info: "details",
});
```

For full control use `submitReport()`:

```ts
await client.submitReport({
  report_type: "message",
  category: "spam",
  subcategory: "advertising",
  additional_info: "...",
  is_ongoing_issue: false,
  is_immediate_danger: false,
  reported_message_id: messageId,
  reported_channel_id: channelId,
  reported_user_id: userId,
});
```

Reports are not a moderation shortcut; false reports can have consequences.

## Lifts, analytics and metadata

```ts
const lifts = await client.fetchServerLifts(serverId);
const supporters = await client.fetchServerLiftSupporters(serverId);
await client.setSupporterRole(serverId, roleId);

await client.fetchChannelAnalytics(serverId, channelId, "messages");
await client.fetchChannelAnalyticsBundle(serverId, channelId);
await client.fetchChannelAnalyticsCalendar(serverId, channelId);
await client.fetchChannelAnalyticsPunchcard(serverId, channelId, 30);

await client.searchGames("minecraft");
await client.fetchGame(gameId);
await client.fetchWeather("London");
await client.searchWeather("London");
await client.fetchSpotify("https://open.spotify.com/track/...");
await client.fetchTweet("https://x.com/...");
```

Analytics scopes and metadata response shapes vary; they are typed as `unknown`
and documented by the generated TypeDoc where possible.

## Security checklist

- Use a unique password and enable 2FA.
- Keep `.env`, tokens and backup codes out of version control.
- Run one client per refresh token.
- Log out temporary sessions created by diagnostics.
- Do not use automation to evade moderation or restrictions.
