import { FlackleClient } from "../src/index.ts";

/**
 * End-to-end smoke test. Read-only unless SMOKE_SEND=1, in which case it sends
 * and immediately deletes one message in the supplied channel.
 *
 *   FLACKLE_EMAIL=... FLACKLE_PASSWORD=... bun run scripts/smoke.ts
 *   SMOKE_SEND=1 FLACKLE_SERVER_ID=... FLACKLE_CHANNEL_ID=... bun run scripts/smoke.ts
 */
const client = new FlackleClient({ requestIntervalMs: 80 });

client.on("ready", (ready) => {
  console.log(`ready: ${ready.user?.username} session=${ready.session_id} presences=${Object.keys(ready.presences).length}`);
});
client.on("raw", (packet) => {
  if (packet.type !== "pong") console.log(`ws <- ${packet.type}`);
});
client.on("messageCreate", (event) => {
  console.log(`messageCreate: ${event.message.id} ${event.message.sender?.username}: ${event.message.content.slice(0, 80)}`);
});
client.on("error", (error) => console.error("error:", error.message));

console.log("logging in...");
const user = await client.login({
  email: process.env.FLACKLE_EMAIL ?? "",
  password: process.env.FLACKLE_PASSWORD ?? "",
  mfa: async () => prompt("MFA code:") ?? "",
});
console.log(`login ok: ${user.username} (${user.id}) plan=${user.membership?.plan ?? "?"}`);

const servers = await client.fetchServers();
console.log(`servers: ${servers.length}`);
for (const server of servers.slice(0, 8)) {
  console.log(`  - ${server.id} ${server.name} owner=${server.owner_id === user.id}`);
}

const targetServer =
  servers.find((server) => server.id === process.env.FLACKLE_SERVER_ID) ??
  servers.find((server) => server.owner_id === user.id) ??
  servers[0];

if (targetServer) {
  const bundle = await client.fetchChannels(targetServer.id);
  console.log(`channels in ${targetServer.name}: ${bundle.channels.length}`);
  for (const channel of bundle.channels.slice(0, 12)) {
    console.log(`  - ${channel.id} ${channel.type} #${channel.name}`);
  }
  const channel =
    bundle.channels.find((c) => c.id === process.env.FLACKLE_CHANNEL_ID) ??
    bundle.channels.find((c) => c.type === "text");
  if (channel) {
    const page = await client.fetchMessages({ serverId: targetServer.id, channelId: channel.id }, { limit: 3 });
    console.log(`messages in #${channel.name}: ${page.messages.length} (has_more=${page.has_more})`);
  }
}

const conversations = await client.fetchConversations();
console.log(`conversations: ${conversations.length}`);

console.log("connecting gateway...");
await client.connect();
console.log(`gateway connected, subscribed servers=${client.gateway.subscribedServers.length}`);

if (process.env.SMOKE_SEND === "1") {
  const serverId = process.env.FLACKLE_SERVER_ID;
  const channelId = process.env.FLACKLE_CHANNEL_ID;
  if (!serverId || !channelId) throw new Error("SMOKE_SEND requires FLACKLE_SERVER_ID and FLACKLE_CHANNEL_ID");
  console.log("sending test message...");
  const message = await client.sendMessage({ serverId, channelId }, `selfbot smoke test ${Date.now()}`);
  console.log(`sent ${message.id}; editing...`);
  await client.editMessage({ serverId, channelId }, message.id, `${message.content} (edited)`);
  console.log("edited; reacting...");
  await client.react({ serverId, channelId }, message.id, "👍");
  console.log("reacted; removing reaction...");
  await client.unreact({ serverId, channelId }, message.id, "👍");
  console.log("unreacted; deleting...");
  await client.deleteMessage({ serverId, channelId }, message.id);
  console.log("deleted");
}

await new Promise((resolve) => setTimeout(resolve, Number(process.env.SMOKE_WAIT_MS ?? 4000)));
await client.destroy();
console.log("done");
