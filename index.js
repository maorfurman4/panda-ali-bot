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
const { isMockMode } = await import("./aliexpress.js");

if (isMockMode()) {
  console.warn("⚠️ Mock mode: ALI_APP_KEY / ALI_APP_SECRET / ALI_TRACKING_ID are not all set. Replies use [דמו] products and fake links.");
}

if (!process.env.OPENAI_API_KEY) {
  console.warn("⚠️ OPENAI_API_KEY is empty: AI query understanding is off, raw queries are searched.");
}

const mode = WEBHOOK_URL ? "webhook" : "polling";
const { stats } = await import("./stats.js");
const bot = createBot({ token: BOT_TOKEN });
const app = createApp({ bot, mode, webhookSecret: mode === "webhook" ? WEBHOOK_SECRET : undefined });

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
  // The server pings its own public URL every 10 minutes within the awake window, so it never sleeps there even if the
  // external wake-up job (cron-job.org) fails; that job is still what wakes it at 05:00.
  const { isAwakeHour } = await import("./server.js");
  setInterval(() => {
    if (isAwakeHour()) fetch(`${WEBHOOK_URL.replace(/\/+$/, "")}/health`).catch(() => {});
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
