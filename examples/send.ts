import { FlackleClient } from "../src/index.ts";

/**
 * Send a message from the command line.
 *
 *   FLACKLE_SERVER_ID=123 FLACKLE_CHANNEL_ID=456 bun run examples/send.ts "hello"
 *   FLACKLE_CONVERSATION_ID=789 bun run examples/send.ts "hello"
 */
const text = process.argv.slice(2).join(" ");
if (!text) {
  console.error("usage: bun run examples/send.ts <message>");
  process.exit(1);
}

const client = new FlackleClient();
await client.login({
  email: process.env.FLACKLE_EMAIL ?? "",
  password: process.env.FLACKLE_PASSWORD ?? "",
});
await client.connect();

const target = process.env.FLACKLE_SERVER_ID
  ? { serverId: process.env.FLACKLE_SERVER_ID, channelId: process.env.FLACKLE_CHANNEL_ID ?? "" }
  : { conversationId: process.env.FLACKLE_CONVERSATION_ID ?? "" };

if (!target.serverId && !target.conversationId) {
  console.error("set FLACKLE_SERVER_ID + FLACKLE_CHANNEL_ID, or FLACKLE_CONVERSATION_ID");
  process.exit(1);
}

const message = await client.sendMessage(target, text);
console.log(`sent ${message.id}: ${message.content}`);

await client.destroy();
