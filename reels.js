// The Reels approve bot (@panda_reels_approve_bot): the owner sends a finished video, gets it back with the post text and
// "publish" / "skip" buttons, and a press publishes it to Instagram and the Facebook Page (meta.js). It runs inside the
// search bot's server on Render (a webhook at /reels), so a press acts at once and the Mac can be off.
// Design: docs/superpowers/specs/2026-11-14-reel-publisher-design.md (owner approved; Render move, owner 2026-11-14).
// No memory between updates: a press carries the preview message (with its video), so a Render restart loses nothing.

// The post text of a video the owner sends the bot himself (style 1): the same one line as the daily reels (owner,
// 2026-11-16: "only the sentence I said, always").
export const POST_TEXT = "🔗 הקישור לערוץ הדילים בביו 👆";

import { station, whereOf } from "./aura-report.js";

// AURA HQ status (aura-report.js): never awaited, as in bot.js, so the office can't hold up a press on the live server.
const aura = (id, status, headline, metrics) => void station("reels", id, status, headline, metrics);

const MAX_BYTES = 20 * 1024 * 1024; // the Bot API's getFile limit
const PLATFORMS = { instagram: "אינסטגרם", facebook: "פייסבוק" };
const HELP = "שלחו לי סרטון מוכן (mp4, עד 20MB) ואחזיר אותו עם כפתור פרסום לאינסטגרם ולפייסבוק.\n💡 שלחו אותו כקובץ (📎 ← קובץ) כדי שטלגרם לא יקטין את האיכות.";

const buttons = (rows) => ({ reply_markup: { inline_keyboard: rows } });
const closed = (text) => buttons([[{ text, callback_data: "done" }]]);
// A video sent as a file (document) keeps its original bytes; Telegram re-encodes what is sent as a video.
const videoOf = (m) => m?.video ?? m?.document ?? null;

// The preview's caption and buttons: the bot's own previews, and scripts/reels-preview.js (a Reel edited on the Mac).
// The post text travels in the preview's own caption, so each video can have its own (styles 2 and 3, owner 2026-11-14)
// and the server still needs no memory: a press publishes the text the owner saw.
const PREVIEW_HEAD = "תצוגה מקדימה. זה הטקסט שיעלה עם הסרטון:\n\n";
// id: the preview's aura_approvals row, so a press and AURA's /reels/decide claim the same row ("pub#12"); none: "pub".
const choice = (id = null) => buttons([[{ text: "✅ לפרסם", callback_data: id == null ? "pub" : `pub#${id}` }, { text: "⏭ לדלג", callback_data: id == null ? "skip" : `skip#${id}` }]]);
export const previewExtra = (text = POST_TEXT) => ({ caption: `${PREVIEW_HEAD}${text}`, ...choice() });
const postTextOf = (preview) => (preview?.caption?.startsWith(PREVIEW_HEAD) && preview.caption.length > PREVIEW_HEAD.length ? preview.caption.slice(PREVIEW_HEAD.length) : POST_TEXT);

// AURA approvals: one public.aura_approvals row per preview, in the office's Supabase (the reporter's env), so Maor can
// approve a reel from AURA too. insert() is null when Supabase isn't set; claim() takes a row only while it is waiting.
export function supabaseApprovals({ fetch = globalThis.fetch, env = process.env } = {}) {
  const url = (env.AURA_SUPABASE_URL || env.SUPABASE_URL || "").replace(/\/$/, "");
  const key = env.AURA_SUPABASE_KEY || env.SUPABASE_SERVICE_KEY;
  const call = async (query, method, body) => {
    if (!url || !key) throw new Error("Supabase is not set");
    const r = await fetch(`${url}/rest/v1/aura_approvals${query}`, { method, body: JSON.stringify(body), signal: AbortSignal.timeout(5000), headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "return=representation" } });
    if (!r.ok) throw new Error(`aura_approvals: HTTP ${r.status}`);
    return r.json();
  };
  return {
    insert: async (row) => (url && key ? (await call("", "POST", row))[0] ?? null : null),
    claim: async (id, status, by) => (await call(`?id=eq.${Number(id)}&status=eq.waiting`, "PATCH", { status, decided_by: by, decided_at: new Date().toISOString() }))[0] ?? null,
  };
}

// After a preview is sent: its waiting row, then the buttons get the row's id. Any failure leaves today's plain buttons.
// The row is stored but the button edit fails: the row is closed at once, so AURA can never claim it and only the plain
// Telegram button can publish (no double publish).
export async function recordPreview({ api, owner, sent, text = POST_TEXT, title, fileId = null, approvals = supabaseApprovals() }) {
  try {
    const payload = { chat_id: String(owner), message_id: sent.message_id, file_id: videoOf(sent)?.file_id ?? fileId, caption: text };
    const row = await approvals.insert({ bot: "reels", kind: "publish", title: String(title ?? "רילס").slice(0, 80), payload });
    if (row?.id == null) return null;
    try {
      await api.editMessageReplyMarkup(owner, sent.message_id, choice(row.id));
    } catch (e) {
      await approvals.claim(row.id, "rejected", "none").catch(() => {});
      throw e;
    }
    return row;
  } catch (e) {
    console.error(`reels: no AURA approval row (${e.message}); the Telegram buttons work as before`);
    return null;
  }
}

export function createReelsHandler({ api, ownerId, publish, download, report = aura, approvals = supabaseApprovals() }) {
  const owner = String(ownerId);
  const working = new Set(); // previews being published right now: a second press waits for nothing
  const fromOwner = (x) => String(x?.from?.id) === owner;

  async function onMessage(m) {
    const file = m.video ?? (/^video\//.test(m.document?.mime_type ?? "") ? m.document : null);
    if (!file) return api.sendMessage(owner, HELP);
    if (file.file_size > MAX_BYTES) return api.sendMessage(owner, "⚠️ הקובץ גדול מ-20MB, וטלגרם לא נותן לבוט להוריד אותו. שלחו גרסה קטנה יותר.");
    const extra = previewExtra();
    const sent = await (m.video ? api.sendVideo(owner, file.file_id, extra) : api.sendDocument(owner, file.file_id, extra));
    await recordPreview({ api, owner, sent, title: m.caption || file.file_name || "סרטון ששלחת", fileId: file.file_id, approvals });
    return sent;
  }

  // The core of a decision, for the Telegram button and AURA alike: skip, or publish and report, editing the preview.
  // answer(text): the press's toast (a no-op for AURA's /reels/decide, which answers its HTTP call there).
  async function run(action, { messageId, fileId, text = POST_TEXT, only = null }, answer) {
    if (working.has(messageId)) return answer("כבר מפרסם, רגע...");
    if (action === "reject") {
      report("approve", "done", "דילגת על הרילס");
      await answer("דולג");
      return api.editMessageReplyMarkup(owner, messageId, closed("⏭ דולג"));
    }
    if (!fileId) return answer("לא מצאתי את הסרטון, שלחו אותו שוב");
    working.add(messageId);
    let uploading = false; // AURA HQ: "publish" is at work, so a throw before its result is reported as an error
    try {
      await answer("מפרסם...");
      await api.editMessageReplyMarkup(owner, messageId, closed("⏳ מפרסם..."));
      const names = only ? [only] : Object.keys(PLATFORMS);
      if (!only) report("approve", "done", "אושר לפרסום"); // a retry of one platform was approved at the first press
      report("publish", "working", `מעלה ל${names.map((p) => PLATFORMS[p]).join(" ול")}`);
      uploading = true;
      let thrown = null; // AURA HQ: where a download or publish throw happened
      const results = await download(fileId)
        .then((bytes) => publish(bytes, text, { only }))
        .catch((e) => ((thrown = e), Object.fromEntries(names.map((p) => [p, { ok: false, error: e.message }]))));
      const failed = names.filter((p) => !results[p]?.ok);
      uploading = false;
      report("publish", failed.length ? "error" : "done", failed.length ? `הפרסום נכשל ב${failed.map((p) => PLATFORMS[p]).join(" וב")}` : `פורסם ב${names.map((p) => PLATFORMS[p]).join(" וב")}`, { ...Object.fromEntries(names.map((p) => [p, results[p]?.ok ? 1 : 0])), ...(thrown && { where: whereOf(thrown) }) });
      await api.sendMessage(owner, names.map((p) => `${results[p]?.ok ? "✅" : "❌"} ${PLATFORMS[p]}: ${results[p]?.ok ? "פורסם" : `נכשל (${results[p]?.error ?? "לא נוסה"})`}`).join("\n"));
      // Retry only what failed: one failed platform is a button of its own; both failed, "pub" again.
      const retry = failed.length === 1 ? `pub:${failed[0]}` : failed.length ? (only ? `pub:${only}` : "pub") : null;
      await api.editMessageReplyMarkup(owner, messageId, retry ? buttons([[{ text: "🔁 לנסות שוב את מה שנכשל", callback_data: retry }]]) : closed("✅ פורסם"));
    } catch (e) {
      if (uploading) report("publish", "error", "הפרסום נעצר בשגיאה", { where: whereOf(e) });
      throw e;
    } finally {
      working.delete(messageId);
    }
  }

  // rowOrPayload: { id } (AURA), or { id?, payload, only } (a press; payload read from the preview itself). With an id the
  // row is claimed first (PATCH ... status=eq.waiting): nothing comes back -> already decided, nothing is done.
  // action: "approve" | "reject"; by: "telegram" | "aura".
  async function decide(rowOrPayload, action, by, { answer = async () => {} } = {}) {
    let payload = rowOrPayload.payload ?? null;
    if (rowOrPayload.id != null) {
      let row;
      try {
        row = await approvals.claim(rowOrPayload.id, action === "approve" ? "approved" : "rejected", by);
      } catch (e) {
        if (by !== "telegram" || !payload) throw e;
        console.error(`reels: approval ${rowOrPayload.id} not claimed (${e.message}); the press goes on as before`);
        row = { payload }; // fail-open for Maor's own button: Supabase down never blocks a press
      }
      if (!row) return { already: true };
      payload ??= row.payload ?? {};
    }
    await run(action, { messageId: payload?.message_id, fileId: payload?.file_id, text: payload?.caption ?? POST_TEXT, only: rowOrPayload.only ?? null }, answer);
    return { ok: true };
  }

  async function onPress(q) {
    const [head, id = null] = String(q.data ?? "").split("#");
    const [action, only = null] = head.split(":");
    const preview = q.message;
    const answer = (text) => api.answerCallbackQuery(q.id, text ? { text } : {}).catch(() => {}); // an old press can't be answered
    if (action === "done") return answer("כבר טופל");
    if (!preview) return answer("");
    if (action !== "pub" && action !== "skip") return answer("לא מצאתי את הסרטון, שלחו אותו שוב");
    const payload = { message_id: preview.message_id, file_id: videoOf(preview)?.file_id, caption: postTextOf(preview) };
    const r = await decide({ id, only, payload }, action === "pub" ? "approve" : "reject", "telegram", { answer });
    if (r.already) await answer("כבר טופל");
  }

  // One Telegram update (from the /reels webhook). Never throws: an error is logged and the owner can press again.
  return Object.assign(async function handleUpdate(u) {
    try {
      if (u.callback_query && fromOwner(u.callback_query)) await onPress(u.callback_query);
      else if (u.message && fromOwner(u.message) && u.message.chat?.type === "private") await onMessage(u.message);
    } catch (e) {
      console.error(`reels: update ${u.update_id} failed: ${e.message}`);
    }
  }, { decide }); // decide: for AURA's POST /reels/decide (server.js)
}
