// Hourly run of the daily-deals channel (by .github/workflows/daily-deals.yml): posts when this hour is a posting hour.
// DEALS_FORCE=true posts now whatever the hour.
// Needs DEALS_BOT_TOKEN (the new bot) and DEALS_CHAT_ID (its channel; found by itself on the first run). Without the
// token it is a dry run that prints the post.
// State (posted product ids, last topic) lives in DEALS_STATE, kept between runs by the workflow's cache.
// Usage: npm run deal
import { readFile, writeFile } from "node:fs/promises";
import { Api } from "grammy";
import { runDeals } from "../deals.js";

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
const next = await runDeals(state, { api: token ? new Api(token) : null, chatId, force: process.env.DEALS_FORCE === "true", special: process.env.DEALS_SPECIAL || null });
await writeFile(file, JSON.stringify(next));
