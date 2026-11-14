// Entry point: validates env, then runs the bot with long polling (local) or a webhook (production).
const { BOT_TOKEN, WEBHOOK_URL, WEBHOOK_SECRET } = process.env;
const PORT = Number(process.env.PORT) || 3000;

if (!BOT_TOKEN) {
  console.error("❌ BOT_TOKEN missing. Copy .env.example to .env and fill in BOT_TOKEN.");
  process.exit(1);
}
if (WEBHOOK_URL && !/^[A-Za-z0-9_-]{1,256}$/.test(WEBHOOK_SECRET ?? "")) {
  console.error("❌ WEBHOOK_SECRET missing or invalid (1-256 chars: A-Z a-z 0-9 _ -). It is required when WEBHOOK_URL is set.");
  process.exit(1);
}

// Imported after the checks so a missing token always gives the clear message above.
const { createBot } = await import("./bot.js");
const { createApp } = await import("./server.js");
const { isMockMode, listOrders, skuApproved } = await import("./aliexpress.js");

if (isMockMode()) {
  console.warn("⚠️ Mock mode: ALI_APP_KEY / ALI_APP_SECRET / ALI_TRACKING_ID are not all set. Replies use [דמו] products and fake links.");
}

if (!process.env.OPENAI_API_KEY) {
  console.warn("⚠️ OPENAI_API_KEY is empty: AI query understanding is off, raw queries are searched.");
}

const mode = WEBHOOK_URL ? "webhook" : "polling";
const { stats, moneyReport } = await import("./stats.js");
const bot = createBot({ token: BOT_TOKEN });
// The Reels approve bot (reels.js) rides on this server in webhook mode, once REELS_BOT_TOKEN is set on Render. The owner
// is ADMIN_USER_ID; the Meta values publish to Instagram and the Facebook Page (meta.js).
const reelsApi = mode === "webhook" && process.env.REELS_BOT_TOKEN && process.env.ADMIN_USER_ID ? new (await import("grammy")).Api(process.env.REELS_BOT_TOKEN) : null;
let reels = null;
if (reelsApi) {
  const { createReelsHandler } = await import("./reels.js");
  const { publishReel } = await import("./meta.js");
  // The file's address holds the bot token: it is never printed.
  const download = async (fileId) => {
    const { file_path } = await reelsApi.getFile(fileId);
    const res = await fetch(`https://api.telegram.org/file/bot${process.env.REELS_BOT_TOKEN}/${file_path}`);
    if (!res.ok) throw new Error(`Telegram file download HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  };
  const publish = (bytes, caption, { only }) => publishReel(bytes, caption, { token: process.env.META_PAGE_TOKEN, igId: process.env.META_IG_ID, pageId: process.env.META_PAGE_ID, only });
  reels = createReelsHandler({ api: reelsApi, ownerId: process.env.ADMIN_USER_ID, publish, download });
}
const app = createApp({ bot, mode, webhookSecret: mode === "webhook" ? WEBHOOK_SECRET : undefined, reels });

function fail(what, e) {
  console.error(`❌ ${what}: ${e.message}`);
  process.exit(1);
}

await bot.init().catch((e) => fail("Could not connect to Telegram (check BOT_TOKEN)", e));
if (process.env.ADMIN_USER_ID) stats.setNotifier((text) => bot.api.sendMessage(process.env.ADMIN_USER_ID, text));
else console.warn("⚠️ ADMIN_USER_ID is empty: no owner alerts and no /status. Send /myid to the bot in private to get it.");
// Express 5 passes bind errors (e.g. port in use) to this callback, so wait for success before going live.
const server = await new Promise((resolve) => {
  const s = app.listen(PORT, (err) => (err ? fail(`HTTP server could not start on port ${PORT}`, err) : resolve(s)));
});
console.log(`🌐 HTTP server on port ${PORT} (${mode} mode)`);

if (mode === "webhook") {
  await bot.api
    .setWebhook(`${WEBHOOK_URL.replace(/\/+$/, "")}/webhook`, { secret_token: WEBHOOK_SECRET })
    .catch((e) => fail("setWebhook failed", e));
  console.log(`✅ @${bot.botInfo.username} is running (webhook)`);
  if (reelsApi) {
    // A failure here leaves the search bot running: only the Reels bot is off, and the log says why.
    await reelsApi
      .setWebhook(`${WEBHOOK_URL.replace(/\/+$/, "")}/reels`, { secret_token: WEBHOOK_SECRET, allowed_updates: ["message", "callback_query"] })
      .then(() => console.log("✅ Reels approve bot is running (webhook /reels)"), (e) => console.error(`❌ Reels bot setWebhook failed: ${e.message}`));
  }
  // The server pings its own public URL every 10 minutes within the awake window, so it never sleeps there even if the
  // external wake-up job (cron-job.org) fails; that job is still what wakes it at 05:00.
  const { isAwakeHour, isDigestTime } = await import("./server.js");
  setInterval(() => {
    if (isAwakeHour()) fetch(`${WEBHOOK_URL.replace(/\/+$/, "")}/health`).catch(() => {});
    if (!process.env.ADMIN_USER_ID || !isDigestTime()) return;
    // shortcut: the digest covers what's in memory since the last digest or restart; a deploy that day resets it.
    const text = stats.digest();
    // Orders and SKU come from AliExpress, so they go out even on a night with no searches.
    (isMockMode() ? Promise.resolve(null) : moneyReport({ listOrders, skuApproved }).catch(() => null)).then((money) => {
      const msg = [text, money].filter(Boolean).join("\n\n");
      if (msg) bot.api.sendMessage(process.env.ADMIN_USER_ID, msg).catch(() => {});
    });
  }, 10 * 60_000).unref();
} else {
  await bot.api.deleteWebhook().catch((e) => fail("deleteWebhook failed", e));
  bot
    .start({ onStart: (me) => console.log(`✅ @${me.username} is running (polling)`) })
    .catch((e) => fail("Polling stopped", e));
}

async function shutdown(signal) {
  console.log(`${signal} received, shutting down...`);
  setTimeout(() => process.exit(0), 5000).unref();
  if (bot.isRunning()) await bot.stop();
  server.close(() => process.exit(0));
}
process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
