// The Reels approve bot (@panda_reels_approve_bot): the owner sends a finished video, gets it back with the post text and
// "publish" / "skip" buttons, and a press publishes it to Instagram and the Facebook Page (meta.js). Runs every 30 minutes
// on GitHub Actions with getUpdates, so it needs no server. Design: docs/superpowers/specs/2026-11-14-reel-publisher-design.md
// (owner approved, 2026-11-14).

// Fixed post text (owner, 2026-11-13): no link anywhere in the post; a comment "פנדה" gets the link by private message.
export const POST_TEXT = [
  "🐼 מחפשים משהו בעלי אקספרס? הפנדה מוצא לכם 4 מוצרים מומלצים בכמה שניות.",
  'כתבו "פנדה" בתגובות ואשלח לכם את הקישור 👇',
  "",
  "#עלי_אקספרס #דילים #קניות_ברשת #עליאקספרס_ישראל #פנדה_דילים",
].join("\n");

const MAX_BYTES = 20 * 1024 * 1024; // the Bot API's getFile limit
const KEEP = 50; // items remembered between runs (a second press on an old one says it's gone)
const PLATFORMS = { instagram: "אינסטגרם", facebook: "פייסבוק" };
const HELP = "שלחו לי סרטון מוכן (mp4, עד 20MB) ואחזיר אותו עם כפתור פרסום לאינסטגרם ולפייסבוק.";

const buttons = (rows) => ({ reply_markup: { inline_keyboard: rows } });
const closed = (text) => buttons([[{ text, callback_data: "done" }]]);

export function createReelsHandler({ api, ownerId, publish, download }) {
  const owner = String(ownerId);
  const fromOwner = (u) => String(u?.from?.id) === owner;

  async function onVideo(msg, state) {
    const file = msg.video ?? (/^video\//.test(msg.document?.mime_type ?? "") ? msg.document : null);
    if (!file) return api.sendMessage(owner, HELP);
    if (file.file_size > MAX_BYTES) return api.sendMessage(owner, "⚠️ הקובץ גדול מ-20MB, וטלגרם לא נותן לבוט להוריד אותו. שלחו גרסה קטנה יותר.");
    const n = (state.next ?? 0) + 1;
    state.next = n;
    const sent = await api.sendVideo(owner, file.file_id, {
      caption: `תצוגה מקדימה. זה הטקסט שיעלה עם הסרטון:\n\n${POST_TEXT}`,
      ...buttons([[{ text: "✅ לפרסם", callback_data: `pub:${n}` }, { text: "⏭ לדלג", callback_data: `skip:${n}` }]]),
    });
    state.items[n] = { fileId: file.file_id, messageId: sent.message_id, status: "pending", done: {} };
  }

  async function onPress(q, state) {
    const [action, n] = String(q.data ?? "").split(":");
    const item = state.items[n];
    const answer = (text) => api.answerCallbackQuery(q.id, text ? { text } : {}).catch(() => {}); // an old press can't be answered
    if (!item) return answer(action === "done" ? "" : "לא מצאתי את הסרטון הזה, שלחו אותו שוב");
    if (item.status === "published" || item.status === "skipped") return answer("כבר טופל");
    if (action === "skip") {
      item.status = "skipped";
      await answer("דולג");
      return api.editMessageReplyMarkup(owner, item.messageId, closed("⏭ דולג"));
    }
    if (action !== "pub") return answer();
    await answer("מפרסם...");
    const results = await download(item.fileId)
      .then((bytes) => publish(bytes, POST_TEXT, { skip: { ...item.done } }))
      .catch((e) => Object.fromEntries(Object.keys(PLATFORMS).filter((p) => !item.done[p]).map((p) => [p, { ok: false, error: e.message }])));
    for (const [p, r] of Object.entries(results)) if (r?.ok) item.done[p] = true;
    const all = Object.keys(PLATFORMS).every((p) => item.done[p]);
    item.status = all ? "published" : "partial";
    const line = (p) => `${item.done[p] ? "✅" : "❌"} ${PLATFORMS[p]}: ${item.done[p] ? "פורסם" : `נכשל (${results[p]?.error ?? "לא נוסה"})`}`;
    await api.sendMessage(owner, Object.keys(PLATFORMS).map(line).join("\n"));
    await api.editMessageReplyMarkup(owner, item.messageId, all ? closed("✅ פורסם") : buttons([[{ text: "🔁 לנסות שוב את מה שנכשל", callback_data: `pub:${n}` }]]));
  }

  // updates: from getUpdates; state: { offset, next, items } from the previous run. Returns the state to save.
  return async function handle(updates, previous = {}) {
    const state = { offset: previous.offset ?? 0, next: previous.next ?? 0, items: { ...(previous.items ?? {}) } };
    for (const u of updates) {
      state.offset = Math.max(state.offset, u.update_id + 1);
      try {
        if (u.callback_query && fromOwner(u.callback_query)) await onPress(u.callback_query, state);
        else if (u.message && fromOwner(u.message) && u.message.chat?.type === "private") await onVideo(u.message, state);
      } catch (e) {
        console.error(`reels: update ${u.update_id} failed: ${e.message}`);
      }
    }
    const keep = Object.keys(state.items).map(Number).sort((a, b) => b - a).slice(0, KEEP);
    state.items = Object.fromEntries(keep.map((k) => [k, state.items[k]]));
    return state;
  };
}
