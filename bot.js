// Telegram handlers: search triggers, link conversion, cooldowns, Hebrew photo result cards.
// Privacy: logs contain only update IDs and error messages, never message text or user names.
import { Bot, InputFile } from "grammy";
import { searchProducts, convertToAffiliate, isMockMode } from "./aliexpress.js";
import { findAliExpressUrl } from "./links.js";
import { understandQuery, filterRelevant, nextAdvice, explainFit } from "./query.js";
import { makeCollage } from "./collage.js";
import { createModeration } from "./moderation.js";
import { stats as defaultStats } from "./stats.js";
import { searchProducts as liveSearch } from "./aliexpress.js";
import { createUnderstander } from "./query.js";
import {
  filterProducts,
  rankProducts,
  dedupeProducts,
  esc,
  RLM,
  withinPrice,
  formatCard,
  formatLinkReply,
  questionText,
  chosenText,
  cooldownMessage,
  HELP,
  GROUP_HELP,
  EMPTY_QUERY,
  NO_RESULTS,
  NOT_PRODUCT,
  NOT_ALLOWED,
  OFF_TOPIC,
  SEARCHING,
  guideText,
  SEARCH_ERROR,
  LINK_ERROR,
  SEARCH_NOW,
  MORE_LABEL,
  GOOD_LABEL,
  BAD_LABEL,
  NO_MORE,
  MORE_NOT_YOURS,
  VOTE_THANKS,
  VOTED,
  CLARIFY_NOT_YOURS,
  CLARIFY_EXPIRED,
  ADVICE_EXPIRED,
  ADVICE_EMPTY,
} from "./format.js";

const GROUP_RESULTS = 4;
const PRIVATE_RESULTS = 4;
const HELP_COOLDOWN_MS = 10 * 60_000;
const CLARIFY_TTL_MS = 10 * 60_000;
const MAX_QUESTIONS = 3;
const RELEVANCE_POOL = 24;
const MORE_PAGES = 2; // up to 2 more cards behind "🔄 עוד", from products already found and checked (no extra AI cost)
const MORE_TTL_MS = 10 * 60_000;
const CARD_TTL_MS = 24 * 60 * 60_000; // votes are deduplicated for a day
const CARDS_MAX = 500;
const BIDI_MARKS = /[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g; // copied mobile text often starts with one
// The search command in its common forms and typos (owner request: every way people write it should work):
// - verbs: חפש/מצא with ח/כ/ה, ש/ס, א/ה/ע swaps and extra/missing י/ו (חפס, כפש, חיפש, תחפוש, מצה, מצע, תמצאי…)
// - a stray or grammatical first letter (החפש, וחפש, לחפש) and polite openers (בבקשה / אפשר / תוכל / פנדה …)
// - "לי" / "ליי" / "לנו", glued or not ("חפשלי"), and the same keys typed on an English layout ("jpa kh")
const LEAD = String.raw`(?:(?:פנדה|בוט|היי|הי|בבקשה|אפשר|תוכל|תוכלי|אתה יכול|את יכולה)[\s,]+)*`;
const VERB = String.raw`[הושל]?(?:ת?[חכה]י?פו?[שס]{1,2}[וי]?|ת?מי?צ(?:[אהע]|וא)[וי]?)`;
const ME = String.raw`(?:לי{1,2}|לנו)`;
const TRIGGER = new RegExp(String.raw`^\s*${LEAD}(?:${VERB}\s*-?\s*${ME}|jpa\s*kh|nmt\s*kh)(?![\u05D0-\u05EA])[\s:,.]*([\s\S]*)$`, "i");
// A missing space after "לי" ("חפש ליהדום"): the whole rest goes to the AI, which fixes it (and keeps real words like "לימון").
const TRIGGER_GLUED = new RegExp(String.raw`^\s*${LEAD}${VERB}\s+(לי[\u05D0-\u05EA][\s\S]*)$`);
// The verb without "לי" ("חפש מטען", "תמצא אוזניות"): searched only if the AI confirms a product; otherwise silent.
const VERB_START = new RegExp(String.raw`^\s*${LEAD}${VERB}\s+\S`);
export const startsWithSearchVerb = (text) => VERB_START.test(text.replace(BIDI_MARKS, ""));

// Natural shopping phrases that may appear anywhere in a group message. Only these messages are sent to the AI,
// and the bot answers only if the AI confirms a product request (otherwise it stays silent).
const SOFT_PHRASES = [
  "מחפש", "מחפשת", "מחפשים", "מחפשות",
  "מישהו מכיר", "מישהי מכירה", "מישהו יודע איפה", "מכירים",
  "יש המלצה", "יש למישהו המלצה", "יש לכם המלצה", "המלצה על", "ממליצים על", "תמליצו", "מה מומלץ",
  "איפה קונים", "איפה אפשר לקנות", "איפה מוצאים", "איפה משיגים",
  "רוצה לקנות", "בא לי לקנות", "צריך לקנות", "צריכה לקנות", "שווה לקנות",
];
const SOFT = new RegExp(`(?:^|[\\s,.!?"'(])(?:${SOFT_PHRASES.join("|")})(?=$|[\\s,.!?])`);
const SOFT_MAX_LENGTH = 200;

// A bare product name in a group ("שרוול מרינו מחמם"): short, Hebrew, no link or mention. The AI confirms before any reply.
const BARE_MAX_LENGTH = 40;
export const isBareName = (text) => {
  const t = text.replace(BIDI_MARKS, "").trim();
  return t.length <= BARE_MAX_LENGTH && t.split(/\s+/).length <= 5 && /[\u05D0-\u05EA]/.test(t) && !/https?:|www\.|t\.me|@/i.test(t);
};
const GUIDE_COOLDOWN_MS = 10 * 60_000;
// Backup for the AI's "not_allowed" when the AI is unavailable: the most obvious Hebrew/English words only.
const BLOCKED_WORDS = /סכין קפיצית|אגרופן|טייזר|ויברטור|דילדו|סיגרי(?:ה|ות) אלקטרוני|וייפ|מצלמ(?:ה|ת) (?:נסתרת|ריגול)|switchblade|brass knuckles|taser|vibrator|dildo|\bvape\b|hidden camera|spy cam/i;
const isBlocked = (intent, text) => intent?.status === "not_allowed" || (!intent && BLOCKED_WORDS.test(text));

export const isSoftRequest = (text) => text.length <= SOFT_MAX_LENGTH && SOFT.test(text.replace(BIDI_MARKS, ""));

// Text after a leading "@username", or null when the message doesn't start with the mention.
function mentionRest(text, username) {
  const m = text.replace(BIDI_MARKS, "").match(new RegExp(`^\\s*@${username}(?![A-Za-z0-9_])[\\s:,]*([\\s\\S]*)$`, "i"));
  return m ? m[1].trim() : null;
}

// Query for a start-of-message trigger ("" when it has no query), or null when the text isn't addressed to the bot.
export function parseTrigger(text, username) {
  const clean = text.replace(BIDI_MARKS, "");
  const m = clean.match(TRIGGER) ?? clean.match(TRIGGER_GLUED);
  return m ? m[1].trim() : mentionRest(text, username);
}

// The result pipeline, shared by the bot and the search-quality eval:
// search -> quality filter (≥90% feedback, price cap) -> AI relevance on the top 24 (real results only, exact before partial)
// -> ranking. With fewer than `limit` exact matches a broader fallback search runs (no duplicates). Throws if the first search fails.
export async function pickProducts({ search, relevant, live }, { keywords, fallback, context, maxPriceIls = null, minPriceIls = null, limit = 4, extra = 0 }) {
  const keyOf = (p) => p.product_id ?? p.promotion_link;
  const find = (q) => search(q, { minIls: minPriceIls, maxIls: maxPriceIls });
  // The broader search starts right away, in parallel (AliExpress calls are free); its AI check runs only if needed. Saves ~2 s.
  const first = find(keywords);
  const early = fallback && fallback !== keywords ? find(fallback) : null;
  early?.catch(() => {}); // handled below; never an unhandled rejection
  const gather = async (found, seen) => {
    const fresh = withinPrice(filterProducts(await found), maxPriceIls, minPriceIls).filter((p) => !seen.has(keyOf(p)));
    if (!live) return { exact: fresh, partial: [] };
    const top = rankProducts(fresh).slice(0, RELEVANCE_POOL); // fewer titles = a faster, steadier AI check
    const out = await relevant({ he: context, en: keywords }, top).catch(() => ({ exact: top, partial: [] }));
    return Array.isArray(out) ? { exact: out, partial: [] } : out;
  };
  let { exact, partial } = await gather(first, new Set());
  // Fewer than `limit` exact matches: a broader search may find more, before partial matches fill the card.
  if (exact.length < limit && early) {
    try {
      const more = await gather(early, new Set([...exact, ...partial].map(keyOf)));
      exact = exact.concat(more.exact);
      partial = partial.concat(more.partial);
    } catch (e) {
      console.error(`fallback search failed: ${e.message}`); // the first results still show
    }
  }
  return dedupeProducts([...rankProducts(exact), ...rankProducts(partial)]).slice(0, limit + extra);
}

// Live checks for /status: one fresh AI call and one AliExpress search.
async function liveHealthChecks() {
  const lines = [];
  let t = Date.now();
  const intent = await createUnderstander()("אושניות");
  lines.push(intent ? `AI: ✅ (${Date.now() - t} ms, "${intent.corrected_he}")` : "AI: ❌ (בדקו OPENAI_API_KEY או את המודל)");
  if (isMockMode()) return [...lines, "עלי אקספרס: מצב דמו (אין מפתחות)"];
  t = Date.now();
  try {
    const products = await liveSearch("usb cable");
    lines.push(`עלי אקספרס: ✅ ${products.length} מוצרים (${Date.now() - t} ms)`);
  } catch (e) {
    lines.push(`עלי אקספרס: ❌ ${e.message}`);
  }
  return lines;
}

export function createBot({
  token,
  botInfo,
  search = searchProducts,
  convert = convertToAffiliate,
  understand = understandQuery,
  relevant = filterRelevant,
  advise = nextAdvice,
  explain = explainFit,
  collage = makeCollage,
  stats = defaultStats,
  adminId = process.env.ADMIN_USER_ID, // owner's numeric Telegram id: /status and alerts
  version = process.env.RENDER_GIT_COMMIT?.slice(0, 7) ?? "local",
  healthChecks = liveHealthChecks,
  live, // tests only: force the live (non-mock) path
  typingEveryMs = 4000,
  now = Date.now,
  cooldownMs = 10_000,
}) {
  const bot = new Bot(token, botInfo ? { botInfo } : {});
  const moderation = createModeration({ now });
  bot.use(moderation.middleware); // runs first: spam is removed before any search logic sees it
  bot.on("message:new_chat_members", moderation.onJoin);
  const cooldowns = new Map(); // shortcut: in-memory, resets on restart; fine for a single instance
  const groupHelpAt = new Map();
  const guidedAt = new Map(); // last "write חפש לי" hint per user (same in-memory shortcut)
  const pending = new Map(); // advisor sessions waiting for a button press, by short id (same shortcut as above)
  let clarifySeq = 0;
  const cards = new Map(); // sent result cards: leftover products for "🔄 עוד" and voters, by short id (same shortcut)
  let cardSeq = 0;

  // Who may press a result's or question's buttons. Anonymous admins post as the group (sender_chat) and press as
  // themselves, so their requests are open to anyone (null).
  const requester = (ctx) => (ctx.msg?.sender_chat ? null : ctx.from?.id);
  const isRequester = (ctx, owner) => owner == null || ctx.from.id === owner;
  const replyParams = (messageId) => ({ reply_parameters: { message_id: messageId, allow_sending_without_reply: true } });
  const replyTo = (ctx) => replyParams(ctx.msg.message_id);
  const reply = (ctx, html, extra = {}) =>
    ctx.reply(html, { parse_mode: "HTML", link_preview_options: { is_disabled: true }, ...replyTo(ctx), ...extra });

  const coolingDown = (ctx) => {
    const entry = cooldowns.get(ctx.from?.id ?? ctx.chat.id);
    return Boolean(entry && entry.at + cooldownMs > now());
  };

  // Per-user cooldown shared by searches and link conversions; warns once per window, then stays silent.
  async function allow(ctx) {
    const userId = ctx.from?.id ?? ctx.chat.id;
    const entry = cooldowns.get(userId);
    const wait = entry ? entry.at + cooldownMs - now() : 0;
    if (wait > 0) {
      if (!entry.warned) {
        entry.warned = true;
        await reply(ctx, cooldownMessage(Math.ceil(wait / 1000)));
      }
      return false;
    }
    cooldowns.set(userId, { at: now(), warned: false });
    if (cooldowns.size > 1000) for (const [id, e] of cooldowns) if (now() - e.at > cooldownMs) cooldowns.delete(id);
    return true;
  }

  // Telegram shows a chat action for ~5 s only, so "typing…" is refreshed until the work is done.
  async function withTyping(ctx, work) {
    const send = () => ctx.replyWithChatAction("typing").catch(() => {});
    send();
    const timer = setInterval(send, typingEveryMs);
    try {
      return await work();
    } finally {
      clearInterval(timer);
    }
  }

  async function runSearch(ctx, rawQuery) {
    const query = rawQuery.trim();
    if (!query) return reply(ctx, EMPTY_QUERY);
    if (!(await allow(ctx))) return;

    return withTyping(ctx, async () => {
      const intent = await understand(query).catch(() => null); // null = AI unavailable: search the raw query
      if (intent?.status === "not_product") return reply(ctx, NOT_PRODUCT);
      if (isBlocked(intent, query)) return reply(ctx, NOT_ALLOWED); // natural requests and bare names stay silent (status isn't "ok")
      if (intent?.status === "clarify") return askClarify(ctx, query, intent);
      return showResults(ctx, {
        keywords: intent?.keywords_en || query,
        fallback: intent?.fallback_en,
        header: intent?.corrected_he || query,
        maxPriceIls: intent?.max_price_ils ?? null,
        minPriceIls: intent?.min_price_ils ?? null,
        replyToId: ctx.msg.message_id,
      });
    });
  }

  // At most one hint (bare name / off-topic) per user per 10 minutes. Checked before any AI call: saves cost.
  const hintAllowed = (ctx) => !coolingDown(ctx) && !(now() - (guidedAt.get(ctx.from.id) ?? -Infinity) < GUIDE_COOLDOWN_MS);
  function hint(ctx, html) {
    guidedAt.set(ctx.from.id, now());
    if (guidedAt.size > 1000) for (const [id, at] of guidedAt) if (now() - at > GUIDE_COOLDOWN_MS) guidedAt.delete(id);
    return reply(ctx, html);
  }

  // A natural group request ("מישהו מכיר מטען טוב?"): searched when the AI confirms a product request. A request for
  // something that isn't a product ("מחפש עבודה", "יש המלצה על רופא?") gets a warning-style hint; other cases stay silent.
  async function runSoftSearch(ctx, text, { warn = true } = {}) {
    if (coolingDown(ctx)) return;
    const intent = await understand(text).catch(() => null);
    if (warn && intent?.status === "not_product" && hintAllowed(ctx)) return hint(ctx, OFF_TOPIC);
    if (intent?.status !== "ok" && intent?.status !== "clarify") return;
    await allow(ctx); // starts the cooldown only for requests the bot actually answers
    if (intent.status === "clarify") return askClarify(ctx, text, intent);
    return withTyping(ctx, () =>
      showResults(ctx, { keywords: intent.keywords_en, fallback: intent.fallback_en, header: intent.corrected_he || text, maxPriceIls: intent.max_price_ils ?? null, minPriceIls: intent.min_price_ils ?? null, replyToId: ctx.msg.message_id }),
    );
  }

  // A bare product name: a one-line hint to write "חפש לי ...", at most once per 10 minutes per user, only if the AI sees a product.
  async function guideBareName(ctx, text) {
    if (!hintAllowed(ctx)) return;
    const intent = await understand(text).catch(() => null);
    if (intent?.status !== "ok") return;
    // The AI fixed a mistyped command ("החפש לי אוזניות" -> "חפש לי אוזניות"): search it instead of hinting.
    const fixed = parseTrigger(intent.corrected_he ?? "", ctx.me.username);
    if (fixed) return runSearch(ctx, fixed);
    return hint(ctx, guideText(intent.corrected_he || text));
  }

  // Search -> quality filter (≥90% feedback, price cap) -> AI relevance (real results only) -> ranking.
  // When fewer than the limit remain, a broader fallback search fills up (no duplicates).
  async function showResults(ctx, opts) {
    // A visible "searching…" note (Telegram shows "typing" only in the header), removed once the answer is sent.
    const note = await ctx.reply(SEARCHING, replyParams(opts.replyToId)).catch(() => null);
    try {
      return await sendResults(ctx, opts);
    } finally {
      if (note) await ctx.api.deleteMessage(ctx.chat.id, note.message_id).catch(() => {});
    }
  }

  async function sendResults(ctx, { keywords, fallback, header, context = header, maxPriceIls, minPriceIls, replyToId, advice = null }) {
    const limit = ctx.chat.type === "private" ? PRIVATE_RESULTS : GROUP_RESULTS;
    stats.count("search");
    let found;
    try {
      found = await pickProducts({ search, relevant, live: live ?? !isMockMode() }, { keywords, fallback, context, maxPriceIls, minPriceIls, limit, extra: limit * MORE_PAGES });
    } catch (e) {
      stats.failure("aliexpress", e.message);
      console.error(`update ${ctx.update.update_id}: search failed: ${e.message}`);
      return ctx.reply(SEARCH_ERROR, { parse_mode: "HTML", ...replyParams(replyToId) });
    }
    if (!found.length) {
      stats.count("noResults");
      return ctx.reply(NO_RESULTS, { parse_mode: "HTML", ...replyParams(replyToId) });
    }
    const shown = found.slice(0, limit);
    const reasons = advice ? await explain(advice, shown).catch(() => null) : null; // "why it fits" only after advice
    return sendCard(ctx, shown, { header, replyToId, reasons, rest: found.slice(limit) });
  }

  // Photo card (collage), then 🎯/🐼 side by side and "לחפש עוד?" below them (always shown, owner request).
  async function sendCard(ctx, shown, { header, replyToId, reasons = null, rest = [] }) {
    for (const [key, c] of cards) if (now() - c.at > CARD_TTL_MS) cards.delete(key);
    if (cards.size >= CARDS_MAX) cards.delete(cards.keys().next().value);
    const id = (++cardSeq).toString(36);
    cards.set(id, { userId: requester(ctx), header, replyToId, rest, voters: new Set(), at: now() });
    const { caption } = formatCard(shown, { query: header, demo: isMockMode(), reasons });
    const keyboard = [
      [{ text: GOOD_LABEL, callback_data: `f:${id}:u` }, { text: BAD_LABEL, callback_data: `f:${id}:d` }],
      [{ text: MORE_LABEL, callback_data: `m:${id}` }], // nothing left -> the press answers "אין עוד תוצאות"
    ];
    const extra = { parse_mode: "HTML", ...replyParams(replyToId), reply_markup: { inline_keyboard: keyboard } };
    const collageImage = await collage(shown.map((p) => p.product_main_image_url)).catch(() => null);
    const image = collageImage ? new InputFile(collageImage, "panda-results.jpg") : shown[0].product_main_image_url;
    if (collageImage || /^https:\/\//i.test(image ?? "")) {
      try {
        return await ctx.replyWithPhoto(image, { caption, ...extra });
      } catch (e) {
        stats.failure("telegram", e.message);
        console.error(`update ${ctx.update.update_id}: sendPhoto failed, sending text instead: ${e.message}`);
      }
    }
    return ctx.reply(caption, { ...extra, link_preview_options: { is_disabled: true } });
  }

  // ---- Shopping advisor: up to 3 questions with buttons, then a search with "why it fits" lines.
  // In groups only the first question is shown; its options are deep links that continue in private chat.
  function newSession(ctx, request, maxPriceIls = null, minPriceIls = null) {
    for (const [key, e] of pending) if (now() - e.at > CLARIFY_TTL_MS) pending.delete(key);
    const id = (++clarifySeq).toString(36);
    const session = { id, userId: requester(ctx), request, history: [], keywords: null, label: null, maxPriceIls, minPriceIls, replyToId: ctx.msg?.message_id, at: now() };
    pending.set(id, session);
    return session;
  }

  function showQuestion(ctx, session, question, options, { edit = false } = {}) {
    Object.assign(session, { question, options, at: now() });
    const inGroup = ctx.chat.type !== "private";
    const rows = options.map((o, n) =>
      inGroup ? [{ text: o.label_he, url: `https://t.me/${ctx.me.username}?start=q_${session.id}_${n}` }] : [{ text: o.label_he, callback_data: `q:${session.id}:${n}` }],
    );
    rows.push([{ text: SEARCH_NOW, callback_data: `q:${session.id}:go` }]);
    const extra = { parse_mode: "HTML", reply_markup: { inline_keyboard: rows } };
    const text = questionText(question, { inGroup });
    return edit ? ctx.editMessageText(text, extra).catch(() => {}) : reply(ctx, text, extra);
  }

  function askClarify(ctx, query, intent) {
    return showQuestion(ctx, newSession(ctx, query, intent.max_price_ils, intent.min_price_ils), intent.clarify_question_he, intent.options);
  }

  // Records the answer, then asks the next question (max 3 in total) or searches.
  async function answer(ctx, session, n, { edit }) {
    const option = session.options?.[n];
    if (!option) return;
    session.history.push({ q: session.question, a: option.label_he });
    session.broad ??= option.keywords_en; // the first answer's search: the broader fallback if the final one finds too few
    Object.assign(session, { keywords: option.keywords_en, label: option.label_he, maxPriceIls: option.max_price_ils ?? session.maxPriceIls, minPriceIls: option.min_price_ils ?? session.minPriceIls });
    if (session.history.length < MAX_QUESTIONS) {
      const step = await withTyping(ctx, () => advise({ request: session.request, history: session.history }).catch(() => null));
      if (step?.status === "ask") return showQuestion(ctx, session, step.question_he, step.options, { edit });
      if (step?.status === "done") Object.assign(session, { keywords: step.keywords_en, maxPriceIls: step.max_price_ils ?? session.maxPriceIls, minPriceIls: step.min_price_ils ?? session.minPriceIls });
    }
    return finish(ctx, session, { edit });
  }

  async function finish(ctx, session, { edit }) {
    pending.delete(session.id);
    const header = session.label ? `${session.request} · ${session.label}` : session.request; // a bare "80–150 ₪" said nothing
    if (edit) await ctx.editMessageText(chosenText(header), { parse_mode: "HTML" }).catch(() => {}); // no reply_markup = buttons removed
    const advice = session.history.length ? { request: session.request, history: session.history } : null;
    const context = advice ? `${session.request} (${session.history.map((h) => h.a).join(", ")})` : session.request;
    return withTyping(ctx, () =>
      showResults(ctx, { keywords: session.keywords ?? session.request, fallback: session.broad, header, context, maxPriceIls: session.maxPriceIls, minPriceIls: session.minPriceIls, replyToId: session.replyToId, advice }),
    );
  }

  // A group option's deep link (/start q_<id>_<n>) continues the advice in private chat.
  async function continueInPrivate(ctx, id, n) {
    const source = pending.get(id);
    if (!source || now() - source.at > CLARIFY_TTL_MS) {
      pending.delete(id);
      return reply(ctx, ADVICE_EXPIRED);
    }
    // The requester continues their own session; anyone else gets their own copy.
    const session = source.userId === ctx.from.id ? source : { ...structuredClone(source), id: (++clarifySeq).toString(36), userId: ctx.from.id };
    pending.set(session.id, session);
    session.replyToId = ctx.msg.message_id;
    return answer(ctx, session, n, { edit: false });
  }

  async function runConvert(ctx, url) {
    if (!(await allow(ctx))) return;
    let link;
    try {
      link = await convert(url);
    } catch (e) {
      console.error(`update ${ctx.update.update_id}: link conversion failed: ${e.message}`);
      return reply(ctx, LINK_ERROR);
    }
    if (link) return reply(ctx, formatLinkReply(link, { demo: isMockMode() }));
  }

  // Private: full help. Group: one line + deep link, at most once per 10 minutes per chat (silent otherwise).
  bot.command(["start", "help"], (ctx) => {
    const deep = ctx.chat.type === "private" && ctx.match.match(/^q_([0-9a-z]+)_(\d)$/);
    if (deep) return continueInPrivate(ctx, deep[1], Number(deep[2]));
    if (ctx.chat.type === "private") return reply(ctx, HELP);
    const last = groupHelpAt.get(ctx.chat.id);
    if (last !== undefined && now() - last < HELP_COOLDOWN_MS) return;
    groupHelpAt.set(ctx.chat.id, now());
    const button = { text: "להסבר המלא", url: `https://t.me/${ctx.me.username}?start=help` };
    return reply(ctx, GROUP_HELP, { reply_markup: { inline_keyboard: [[button]] } });
  });
  bot.command("search", (ctx) => runSearch(ctx, ctx.match));
  bot.command("myid", (ctx) => ctx.chat.type === "private" && reply(ctx, `🆔 ${ctx.from.id}`));
  // Owner-only health report: version, counters, last errors and live checks of the AI and AliExpress.
  bot.command("status", async (ctx) => {
    if (ctx.chat.type !== "private" || !adminId || String(ctx.from.id) !== String(adminId)) return;
    const { startedAt, counters, lastError, lists } = stats.snapshot();
    const n = (k) => counters[k] ?? 0;
    const errors = Object.entries(lastError).map(([kind, e]) => `• ${kind}: ${e.detail} (לפני ${Math.round((now() - e.at) / 60_000)} דק')`);
    const checks = await withTyping(ctx, () => healthChecks().catch((e) => [`בדיקה חיה נכשלה: ${e.message}`]));
    const lines = [
      "📊 <b>מצב הבוט</b>",
      `🏷️ גרסה: ${esc(version)} · ${isMockMode() ? "דמו" : "אמיתי"} · פעיל ${Math.round((now() - startedAt) / 60_000)} דק'`,
      `🔎 חיפושים: ${n("search")} · ללא תוצאות: ${n("noResults")} · שגיאות עלי אקספרס: ${n("fail:aliexpress")}`,
      `🤖 כשלי AI: ${n("fail:ai")} · כשלי טלגרם: ${n("fail:telegram")}`,
      `🎯 בול: ${n("thumbsUp")} · 🐼 לא זה: ${n("thumbsDown")} · 🔍 לחפש עוד: ${n("more")}`,
      "",
      "<b>בדיקה חיה</b>",
      ...checks.map(esc),
      ...(errors.length ? ["", "<b>שגיאות אחרונות</b>", ...errors.map(esc)] : []),
      ...(lists.thumbsDown?.length ? ["", "<b>חיפושים שקיבלו 🐼 לא זה</b>", ...lists.thumbsDown.map((x) => `• ${esc(x.text)}`)] : []),
    ];
    return reply(ctx, lines.map((l) => RLM + l).join("\n"));
  });
  bot.command("advice", async (ctx) => {
    const request = ctx.match.trim();
    if (!request) return reply(ctx, ADVICE_EMPTY);
    if (!(await allow(ctx))) return;
    if (isBlocked(await understand(request).catch(() => null), request)) return reply(ctx, NOT_ALLOWED); // cached; same policy as searches
    const step = await withTyping(ctx, () => advise({ request, history: [] }).catch(() => null));
    if (step?.status === "ask") return showQuestion(ctx, newSession(ctx, request), step.question_he, step.options);
    return withTyping(ctx, () =>
      showResults(ctx, { keywords: step?.keywords_en || request, header: request, maxPriceIls: step?.max_price_ils ?? null, minPriceIls: step?.min_price_ils ?? null, replyToId: ctx.msg.message_id }),
    );
  });

  // Advisor buttons. Only the requester may press; the search cooldown was already counted for the request.
  bot.callbackQuery(/^q:([0-9a-z]+):(\d|go)$/, async (ctx) => {
    const [, id, choice] = ctx.match;
    const session = pending.get(id);
    if (!session || now() - session.at > CLARIFY_TTL_MS) {
      pending.delete(id);
      return ctx.answerCallbackQuery({ text: CLARIFY_EXPIRED });
    }
    if (!isRequester(ctx, session.userId)) return ctx.answerCallbackQuery({ text: CLARIFY_NOT_YOURS });
    await ctx.answerCallbackQuery();
    if (session.busy) return; // a double tap while the AI is thinking
    session.busy = true;
    try {
      return await (choice === "go" ? finish(ctx, session, { edit: true }) : answer(ctx, session, Number(choice), { edit: true }));
    } finally {
      session.busy = false;
    }
  });
  // "לחפש עוד?": the next products of the same search, for the requester only.
  bot.callbackQuery(/^m:([0-9a-z]+)$/, async (ctx) => {
    const card = cards.get(ctx.match[1]);
    if (!card || now() - card.at > MORE_TTL_MS || !card.rest.length) return ctx.answerCallbackQuery({ text: NO_MORE });
    if (!isRequester(ctx, card.userId)) return ctx.answerCallbackQuery({ text: MORE_NOT_YOURS });
    await ctx.answerCallbackQuery();
    const next = card.rest.splice(0, ctx.chat.type === "private" ? PRIVATE_RESULTS : GROUP_RESULTS); // taken now: a double tap can't resend it
    stats.count("more");
    return withTyping(ctx, () => sendCard(ctx, next, { header: card.header, replyToId: card.replyToId, rest: card.rest }));
  });

  // 🎯/🐼 on a card: anyone, once per card. The 🐼 searches show up in /status so they can become eval cases.
  bot.callbackQuery(/^f:([0-9a-z]+):([ud])$/, (ctx) => {
    const [, id, vote] = ctx.match;
    const card = cards.get(id);
    if (card?.voters.has(ctx.from.id)) return ctx.answerCallbackQuery({ text: VOTED });
    card?.voters.add(ctx.from.id);
    stats.count(vote === "u" ? "thumbsUp" : "thumbsDown");
    if (vote === "d" && card) stats.remember("thumbsDown", card.header);
    return ctx.answerCallbackQuery({ text: VOTE_THANKS });
  });
  bot.on("callback_query:data", (ctx) => ctx.answerCallbackQuery()); // never leave a button spinning

  bot.on("message:text", async (ctx) => {
    const text = ctx.msg.text;
    if (text.startsWith("/")) return; // commands for other bots, or unknown commands
    const username = ctx.me.username;
    const isPrivate = ctx.chat.type === "private";
    // Groups: links are converted only when the message starts with the bot mention; plain links stay untouched.
    if (isPrivate || mentionRest(text, username) !== null) {
      const url = findAliExpressUrl(text);
      if (url) return runConvert(ctx, url);
    }
    const query = parseTrigger(text, username);
    if (query !== null) return runSearch(ctx, query);
    if (isPrivate) return runSearch(ctx, text);
    if (isSoftRequest(text)) return runSoftSearch(ctx, text);
    if (startsWithSearchVerb(text)) return runSoftSearch(ctx, text, { warn: false }); // "חפש מטען": searched if the AI sees a product
    if (!ctx.msg.reply_to_message && isBareName(text)) return guideBareName(ctx, text); // replies are conversation, not requests
  });

  bot.catch((err) => console.error(`update ${err.ctx.update.update_id} failed: ${err.error?.message ?? err.error}`));
  return bot;
}
