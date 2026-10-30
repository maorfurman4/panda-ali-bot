// Posts one deal to the daily-deals channel (run by .github/workflows/daily-deals.yml).
// Needs DEALS_BOT_TOKEN (the new bot) and DEALS_CHAT_ID (its channel; found by itself on the first run). Without the
// token it is a dry run that prints the post.
// State (posted product ids, last topic) lives in DEALS_STATE, kept between runs by the workflow's cache.
// Usage: npm run deal
import { readFile, writeFile } from "node:fs/promises";
import { Api } from "grammy";
import { postDeal } from "../deals.js";

const file = process.env.DEALS_STATE || "deals-state.json";
const state = await readFile(file, "utf8").then(JSON.parse).catch(() => ({}));
const { DEALS_BOT_TOKEN: token } = process.env;
let chatId = process.env.DEALS_CHAT_ID;
if (token && !chatId) {
  // First run: the channel the bot was just made admin of (Telegram keeps updates for 24 h). Its id is not a secret.
  const chat = (await new Api(token).getUpdates()).map((u) => u.my_chat_member?.chat ?? u.channel_post?.chat).filter((c) => c?.type === "channel").at(-1);
  if (!chat) throw new Error("DEALS_CHAT_ID is not set and the bot sees no channel: add the bot to the channel as admin, or set the secret");
  chatId = chat.id;
  console.log(`channel found: ${chat.title} (${chatId}); save this id as the DEALS_CHAT_ID secret`);
}
const next = await postDeal(state, { api: token ? new Api(token) : null, chatId });
await writeFile(file, JSON.stringify(next));
