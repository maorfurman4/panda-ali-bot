// One run of the Reels approve bot (GitHub Actions, every 30 minutes): reads the bot's new messages and button presses,
// answers them (reels.js), publishes on "publish" (meta.js), saves the state for the next run.
// Usage: node --env-file-if-exists=.env scripts/reels-run.js
import { readFile, writeFile } from "node:fs/promises";
import { Api } from "grammy";
import { createReelsHandler } from "../reels.js";
import { publishReel } from "../meta.js";

const STATE = process.env.REELS_STATE ?? "reels-state.json";
const token = process.env.REELS_BOT_TOKEN;
const ownerId = process.env.REELS_OWNER_ID;
if (!token || !ownerId) {
  console.log("REELS_BOT_TOKEN or REELS_OWNER_ID not set; skipping");
  process.exit(0);
}

const api = new Api(token);
const state = JSON.parse(await readFile(STATE, "utf8").catch(() => "{}"));
// The file's address holds the bot token: it is never printed.
const download = async (fileId) => {
  const { file_path } = await api.getFile(fileId);
  const res = await fetch(`https://api.telegram.org/file/bot${token}/${file_path}`);
  if (!res.ok) throw new Error(`Telegram file download HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
};
const publish = (bytes, caption, { skip }) => publishReel(bytes, caption, { token: process.env.META_PAGE_TOKEN, igId: process.env.META_IG_ID, pageId: process.env.META_PAGE_ID, skip });

let updates;
try {
  updates = await api.getUpdates({ offset: state.offset ?? 0, timeout: 0, allowed_updates: ["message", "callback_query"] });
} catch (e) {
  // 409: a webhook is set on this bot, so getUpdates can't read it.
  console.error(`reels: getUpdates failed: ${e.description ?? e.message}`);
  process.exit(1);
}
const next = await createReelsHandler({ api, ownerId, publish, download })(updates, state);
await writeFile(STATE, JSON.stringify(next));
console.log(`reels: ${updates.length} updates handled; ${Object.values(next.items).filter((i) => i.status === "pending").length} waiting for a press`);
