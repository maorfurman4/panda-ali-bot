// Is the search bot up? Run by the hourly deals workflow (no extra GitHub minutes). Asks the server's /health and, when
// BOT_TOKEN is set, Telegram's webhook info. Down: a Telegram message to the owner through the deals bot, again every 3
// hours while it stays down; up again: one "back" message. State (bot-watch.json) is carried between runs by the workflow.
// Owner, 2026-11-07: "תעשה את התראה שהבוט נופל". Always exits 0: the message is the alert, not a GitHub email.
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const REMIND_MS = 3 * 60 * 60_000;
const WEBHOOK_ERROR_MS = 60 * 60_000; // a Telegram delivery error in the last hour counts

// What to send, given the last state and this check. Returns { state, message } (message null: send nothing).
export function decideWatch(state = {}, problem = null, now = Date.now()) {
  if (!problem) return { state: { down: false }, message: state.down ? "✅ בוט החיפוש חזר לענות" : null };
  const remind = !state.down || now - (state.alertedAt ?? 0) >= REMIND_MS;
  const message = remind ? `🚨 בוט החיפוש לא עונה${state.down ? " (עדיין)" : ""}: ${problem}. כדאי לבדוק ב-Render` : null;
  return { state: { down: true, since: state.since ?? now, alertedAt: remind ? now : state.alertedAt }, message };
}

async function health(url) {
  try {
    const r = await fetch(`${url}/health`, { signal: AbortSignal.timeout(60_000) });
    const body = await r.json().catch(() => null);
    return r.ok && body?.ok ? null : `השרת ענה ${r.status}`;
  } catch {
    return "השרת לא ענה תוך דקה";
  }
}

async function webhook(token, now) {
  const info = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`, { signal: AbortSignal.timeout(20_000) }).then((r) => r.json()).catch(() => null);
  const at = (info?.result?.last_error_date ?? 0) * 1000;
  return at && now - at < WEBHOOK_ERROR_MS ? `טלגרם לא מצליחה להעביר הודעות לבוט (${info.result.last_error_message ?? "שגיאה"})` : null;
}

async function main() {
  const { SERVER_URL, BOT_TOKEN, DEALS_BOT_TOKEN, DEALS_OWNER_ID } = process.env;
  const file = "bot-watch.json";
  const state = (() => { try { return JSON.parse(readFileSync(file, "utf8")); } catch { return {}; } })();
  const now = Date.now();
  // A slow first answer gets one more try (a cold server takes ~50 s to wake).
  let problem = await health(SERVER_URL);
  if (problem) problem = await new Promise((r) => setTimeout(r, 20_000)).then(() => health(SERVER_URL));
  if (!problem && BOT_TOKEN) problem = await webhook(BOT_TOKEN, now);
  const { state: next, message } = decideWatch(state, problem, now);
  writeFileSync(file, JSON.stringify(next));
  console.log(problem ? `down: ${problem}` : "up");
  if (message && DEALS_BOT_TOKEN && DEALS_OWNER_ID) {
    await fetch(`https://api.telegram.org/bot${DEALS_BOT_TOKEN}/sendMessage`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat_id: DEALS_OWNER_ID, text: message }) })
      .then((r) => console.log(`alert sent: ${r.status}`), (e) => console.log(`alert failed: ${e.message}`));
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
