// Hourly run of the daily-deals channel (by .github/workflows/daily-deals.yml): posts when this hour is a posting hour.
// DEALS_FORCE=true posts now whatever the hour. DEALS_PREVIEW=true sends one post to the owner's private chat
// (DEALS_OWNER_ID) instead of the channel and keeps the channel's state as it was (owner, 2026-11-08: tests in private);
// DEALS_PREVIEW_COUNT=10 sends 10 of them, each on another topic.
// Needs DEALS_BOT_TOKEN (the new bot) and DEALS_CHAT_ID (its channel; found by itself on the first run). Without the
// token it is a dry run that prints the post.
// State (posted product ids, last topic) lives in DEALS_STATE, kept between runs by the workflow's cache.
// Usage: npm run deal
import { readFile, writeFile } from "node:fs/promises";
import { Api } from "grammy";
import { runDeals, sendDailyStatus, israelTime } from "../deals.js";
import { addStars, fetchReviews } from "../aliexpress.js";

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
const preview = process.env.DEALS_PREVIEW === "true";
if (preview || !token) process.env.AURA_REPORT = "off"; // a preview or a dry run is not the channel: nothing goes to AURA HQ (aura-report.js)
if (preview && token && !process.env.DEALS_OWNER_ID) throw new Error("a preview needs DEALS_OWNER_ID");
// DEALS_PREVIEW_HOUR: a preview as if it were that hour in Israel (to see the morning or evening topics at any time).
const hour = preview ? Number(process.env.DEALS_PREVIEW_HOUR) : NaN;
const now = new Date(Date.now() + (Number.isInteger(hour) && hour >= 0 && hour <= 23 ? (hour - israelTime().hour) * 3600e3 : 0));
const run = (st) => runDeals(st, { now, api: token ? new Api(token) : null, chatId: preview ? process.env.DEALS_OWNER_ID : chatId, stars: addStars, reviews: fetchReviews, force: preview || process.env.DEALS_FORCE === "true", special: process.env.DEALS_SPECIAL || null });
let next = await run(state);
// DEALS_PREVIEW_COUNT: several previews in a row, each on the next topic (the topic moves on in memory only; owner,
// 2026-11-08: "at least 10" to judge a change).
if (preview) for (let n = 1, count = Math.min(Number(process.env.DEALS_PREVIEW_COUNT) || 1, 20); n < count; n++) next = await run(next);
if (preview) {
  console.log("preview: sent to the owner, state unchanged");
} else {
  // The owner's nightly summary after the last post (DEALS_OWNER_ID = the owner's numeric Telegram id, like ADMIN_USER_ID).
  if (token) next = await sendDailyStatus(next, { api: new Api(token), chatId, ownerId: process.env.DEALS_OWNER_ID });
  await writeFile(file, JSON.stringify(next));
}
