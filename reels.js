// The Reels approve bot (@panda_reels_approve_bot): the owner sends a finished video, gets it back with the post text and
// "publish" / "skip" buttons, and a press publishes it to Instagram and the Facebook Page (meta.js). It runs inside the
// search bot's server on Render (a webhook at /reels), so a press acts at once and the Mac can be off.
// Design: docs/superpowers/specs/2026-11-14-reel-publisher-design.md (owner approved; Render move, owner 2026-11-14).
// No memory between updates: a press carries the preview message (with its video), so a Render restart loses nothing.

// Fixed post text (owner, 2026-11-13): no link anywhere in the post; a comment "פנדה" gets the link by private message.
export const POST_TEXT = [
  "🐼 מחפשים משהו בעלי אקספרס? הפנדה מוצא לכם 4 מוצרים מומלצים בכמה שניות.",
  'כתבו "פנדה" בתגובות ואשלח לכם את הקישור 👇',
  "",
  "#עלי_אקספרס #דילים #קניות_ברשת #עליאקספרס_ישראל #פנדה_דילים",
].join("\n");

const MAX_BYTES = 20 * 1024 * 1024; // the Bot API's getFile limit
const PLATFORMS = { instagram: "אינסטגרם", facebook: "פייסבוק" };
const HELP = "שלחו לי סרטון מוכן (mp4, עד 20MB) ואחזיר אותו עם כפתור פרסום לאינסטגרם ולפייסבוק.\n💡 שלחו אותו כקובץ (📎 ← קובץ) כדי שטלגרם לא יקטין את האיכות.";

const buttons = (rows) => ({ reply_markup: { inline_keyboard: rows } });
const closed = (text) => buttons([[{ text, callback_data: "done" }]]);
// A video sent as a file (document) keeps its original bytes; Telegram re-encodes what is sent as a video.
const videoOf = (m) => m?.video ?? m?.document ?? null;

export function createReelsHandler({ api, ownerId, publish, download }) {
  const owner = String(ownerId);
  const working = new Set(); // previews being published right now: a second press waits for nothing
  const fromOwner = (x) => String(x?.from?.id) === owner;

  async function onMessage(m) {
    const file = m.video ?? (/^video\//.test(m.document?.mime_type ?? "") ? m.document : null);
    if (!file) return api.sendMessage(owner, HELP);
    if (file.file_size > MAX_BYTES) return api.sendMessage(owner, "⚠️ הקובץ גדול מ-20MB, וטלגרם לא נותן לבוט להוריד אותו. שלחו גרסה קטנה יותר.");
    const extra = { caption: `תצוגה מקדימה. זה הטקסט שיעלה עם הסרטון:\n\n${POST_TEXT}`, ...buttons([[{ text: "✅ לפרסם", callback_data: "pub" }, { text: "⏭ לדלג", callback_data: "skip" }]]) };
    return m.video ? api.sendVideo(owner, file.file_id, extra) : api.sendDocument(owner, file.file_id, extra);
  }

  async function onPress(q) {
    const [action, only = null] = String(q.data ?? "").split(":");
    const preview = q.message;
    const answer = (text) => api.answerCallbackQuery(q.id, text ? { text } : {}).catch(() => {}); // an old press can't be answered
    if (action === "done") return answer("כבר טופל");
    if (!preview || working.has(preview.message_id)) return answer(preview ? "כבר מפרסם, רגע..." : "");
    const file = videoOf(preview);
    if (action === "skip") {
      await answer("דולג");
      return api.editMessageReplyMarkup(owner, preview.message_id, closed("⏭ דולג"));
    }
    if (action !== "pub" || !file) return answer("לא מצאתי את הסרטון, שלחו אותו שוב");
    working.add(preview.message_id);
    try {
      await answer("מפרסם...");
      await api.editMessageReplyMarkup(owner, preview.message_id, closed("⏳ מפרסם..."));
      const names = only ? [only] : Object.keys(PLATFORMS);
      const results = await download(file.file_id)
        .then((bytes) => publish(bytes, POST_TEXT, { only }))
        .catch((e) => Object.fromEntries(names.map((p) => [p, { ok: false, error: e.message }])));
      const failed = names.filter((p) => !results[p]?.ok);
      await api.sendMessage(owner, names.map((p) => `${results[p]?.ok ? "✅" : "❌"} ${PLATFORMS[p]}: ${results[p]?.ok ? "פורסם" : `נכשל (${results[p]?.error ?? "לא נוסה"})`}`).join("\n"));
      // Retry only what failed: one failed platform is a button of its own; both failed, "pub" again.
      const retry = failed.length === 1 ? `pub:${failed[0]}` : failed.length ? (only ? `pub:${only}` : "pub") : null;
      await api.editMessageReplyMarkup(owner, preview.message_id, retry ? buttons([[{ text: "🔁 לנסות שוב את מה שנכשל", callback_data: retry }]]) : closed("✅ פורסם"));
    } finally {
      working.delete(preview.message_id);
    }
  }

  // One Telegram update (from the /reels webhook). Never throws: an error is logged and the owner can press again.
  return async function handleUpdate(u) {
    try {
      if (u.callback_query && fromOwner(u.callback_query)) await onPress(u.callback_query);
      else if (u.message && fromOwner(u.message) && u.message.chat?.type === "private") await onMessage(u.message);
    } catch (e) {
      console.error(`reels: update ${u.update_id} failed: ${e.message}`);
    }
  };
}
