# Media and uploads

## Attachment shape

```ts
interface Attachment {
  id?: string;
  url: string;
  filename?: string;
  content_type?: string;
  size?: number;
  width?: number;
  height?: number;
  saved?: boolean;
  [key: string]: unknown;
}
```

Messages carry `attachments?: Attachment[]`.

## Presigned upload (default)

`uploadAttachment()` uses Flackle's multipart/R2 flow:

1. `POST /api/uploads` with `{ file_name, content_type, size }`
2. upload each part to the returned URLs
3. `POST /api/uploads/:id/complete`
4. return the attachment descriptor

```ts
const attachment = await client.uploadAttachment(
  Bun.file("./cat.png"),
  "cat.png",
);

await client.sendMessage(target, "", { attachments: [attachment] });
```

`file` can be any `Blob`; the optional name overrides `File.name`. Content type
defaults to `application/octet-stream`.

## Direct upload

The web client also has a one-shot multipart endpoint:

```ts
const attachments = await client.uploadAttachmentDirect(
  target,
  Bun.file("./cat.png"),
  "cat.png",
);

await client.sendMessage(target, "", { attachments });
```

The third argument is the filename. Set the fourth argument to `true` to use the
direct/R2 path used for larger files:

```ts
const large = await client.uploadAttachmentDirect(
  target,
  Bun.file("./backup.zip"),
  "backup.zip",
  true,
);
```

`target` can be a guild channel or a conversation; the method selects:

```text
/api/servers/{serverId}/channels/{channelId}/attachments[/direct]
/api/conversations/{conversationId}/attachments[/direct]
```

The endpoint expects multipart field `file` and returns `{ attachments }` (the
method unwraps it).

## Server icons, banners and avatars

These methods handle the multipart fields for you and return the hosted URL:

```ts
const iconUrl = await client.uploadServerIcon(serverId, Bun.file("./icon.png"));
const bannerUrl = await client.uploadServerBanner(serverId, Bun.file("./banner.png"));
const avatarUrl = await client.uploadAvatar(Bun.file("./avatar.png"));
const profileBannerUrl = await client.uploadBanner(Bun.file("./banner.png"));
const groupIconUrl = await client.uploadConversationIcon(groupId, Bun.file("./group.png"));
const blockImageUrl = await client.uploadBlockImage(Bun.file("./block.png"));
```

To update the profile avatar/banner after uploading, the upload methods already
associate the image with the account. For conversation icons, pass the returned
URL to `updateConversation()`:

```ts
await client.updateConversation(groupId, { icon_url: groupIconUrl });
```

## Saved media

Flackle can save media so it does not expire with the message.

```ts
const page = await client.fetchSavedMedia({ serverId });
// { items, count, next_cursor?, used, budget, first_grace_ends_at? }

await client.saveMedia(attachment.url);
await client.unsaveMedia(attachment.url);
```

Paginate with `cursor`:

```ts
let cursor: string | undefined;
do {
  const page = await client.fetchSavedMedia({ cursor });
  console.log(page.items);
  cursor = page.next_cursor ?? undefined;
} while (cursor);
```

Saved-media capacity depends on the account's plan and grace period. The library
does not bypass those limits.

## Link previews

```ts
const preview = await client.createLinkPreview("https://example.com");
```

This is a `GET /api/link-preview?url=...` request and returns embed metadata.
Use `updateMessageEmbeds()` to attach it to an existing message:

```ts
await client.updateMessageEmbeds(target, messageId, [
  ...(message.embeds ?? []),
  { ...previewEmbed },
]);
```

Embeds are sent as the raw array body, not `{ embeds }`.

## Media proxy

Flackle serves proxied media at `/api/attachments/blob?url=...`. If you need the
proxy URL for an attachment:

```ts
const proxied = `/api/attachments/blob?url=${encodeURIComponent(attachment.url)}`;
```

The library does not download binary media automatically; use `fetch()` or
`Bun.file()` for that.

## Limits and failures

- Upload size limits come from the account plan and endpoint. The server returns
  `413`/`400` when exceeded; do not retry a rejected oversized upload.
- Presigned part URLs expire. Use the descriptor immediately.
- A `500` from a JSON body on `/attachments` usually means you called an upload
  endpoint without multipart data.
- `fetchAttachments()` is intentionally not provided: those routes are upload
  endpoints, not attachment listings. Use message payloads or saved media.
