import { FlackleClient } from "../src/index.ts";

/**
 * Read-only API coverage check. Logs in with env credentials, prints a compact
 * summary of the expanded endpoints, and logs the temporary session out.
 *
 *   FLACKLE_EMAIL=... FLACKLE_PASSWORD=... bun run check:api
 *
 * Optional: FLACKLE_SERVER_ID and FLACKLE_CHANNEL_ID pick a specific target.
 */
const email = process.env.FLACKLE_EMAIL;
const password = process.env.FLACKLE_PASSWORD;
if (!email || !password) {
  console.error("Set FLACKLE_EMAIL and FLACKLE_PASSWORD first.");
  process.exit(1);
}

const client = new FlackleClient({ requestIntervalMs: 100 });

try {
  const me = await client.login({ email, password });
  console.log(`account: ${me.username} (${me.id})`);

  const servers = await client.fetchServers();
  const serverId =
    process.env.FLACKLE_SERVER_ID ??
    servers.find((entry) => entry.owner_id === me.id)?.id ??
    servers[0]?.id;
  if (!serverId) throw new Error("The account is not in any servers.");

  const server = await client.fetchServer(serverId);
  const bundle = await client.fetchChannels(serverId);
  const channelId =
    process.env.FLACKLE_CHANNEL_ID ??
    bundle.channels?.find((channel) => channel.type === "text")?.id;
  if (!channelId) throw new Error("No text channel found in the target server.");

  const [members, roles, permissions, kinds, invites] = await Promise.all([
    client.fetchMembers(serverId, { limit: 5 }),
    client.fetchRoles(serverId),
    client.fetchChannelPermissions(serverId, channelId),
    client.fetchChannelKinds(),
    client.fetchServerInvites(serverId),
  ]);
  const audits = await client.fetchAuditLog(serverId, { limit: 2 }).catch(() => undefined);

  const search = await client.searchMessages(
    { serverId, channelId },
    { query: process.env.FLACKLE_SEARCH_QUERY ?? "test" },
  );

  const saved = await client.fetchSavedMedia({ serverId });
  const settings = await client.fetchServerUserSettings(serverId);
  const card = await client.fetchUserCard(me.username, serverId);

  console.log(
    JSON.stringify(
      {
        server: { id: server.id, name: server.name, owner: server.owner_id },
        channelId,
        members: members.length,
        roles: roles.length,
        permissions,
        channelKinds: kinds,
        auditEntries: audits?.entries?.length ?? null,
        invites: invites.length,
        search: {
          messages: search.messages?.length ?? 0,
          scanned: search.scanned,
          incomplete: search.incomplete,
        },
        savedMedia: saved.items?.length ?? 0,
        notificationLevel: settings?.notification_level,
        card: { blocks: card.blocks?.length ?? 0, member: Boolean(card.member) },
      },
      null,
      2,
    ),
  );
} finally {
  await client.logout().catch(() => undefined);
}
