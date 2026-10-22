import { FlackleClient } from "../src/index.ts";

const client = new FlackleClient();

client.on("ready", (ready) => {
  console.log(`connected as ${ready.user?.username ?? "unknown"} (session ${ready.session_id})`);
});

client.on("messageCreate", (event) => {
  const where = event.serverId
    ? `server ${event.serverId} / channel ${event.channelId}`
    : `conversation ${event.conversationId}`;
  const author = event.message.sender?.display_name ?? event.message.sender?.username ?? "unknown";
  console.log(`[${where}] ${author}: ${event.message.content}`);
});

client.on("typingStart", (event) => {
  console.log(`typing: ${event.userId} in ${event.channelId ?? event.conversationId}`);
});

client.on("presenceUpdate", (event) => {
  console.log(`presence: ${event.userId} -> ${event.status}`);
});

client.on("error", (error) => {
  console.error("gateway error:", error.message);
});

await client.login({
  email: process.env.FLACKLE_EMAIL ?? "",
  password: process.env.FLACKLE_PASSWORD ?? "",
  mfa: async () => prompt("MFA code:") ?? "",
});

await client.connect();
console.log("listening for events — press Ctrl+C to stop");

process.on("SIGINT", async () => {
  await client.destroy();
  process.exit(0);
});
