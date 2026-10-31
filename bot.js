// Telegram handlers: search triggers, link conversion, cooldowns, Hebrew photo result cards.
// Privacy: logs contain only update IDs and error messages, never message text or user names.
import { Bot, InputFile } from "grammy";
import { searchProducts, convertToAffiliate, isMockMode, shortenLinks } from "./aliexpress.js";
import { findAliExpressUrl } from "./links.js";
import { understandQuery, filterRelevant, nextAdvice, explainFit, shortTitles } from "./query.js";
import { makeCollage, photoHash } from "./collage.js";
import { createModeration } from "./moderation.js";
import { stats as defaultStats } from "./stats.js";
import { searchProducts as liveSearch } from "./aliexpress.js";
import { createUnderstander } from "./query.js";
import {
  shortTitle,
  soldText,
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
  PRIVATE_INVITE,
  PRIVATE_BUTTON,
  GROUP_LINK,
  EMPTY_QUERY,
  NO_RESULTS,
  NO_FOOD,
  NOT_PRODUCT,
  NOT_ALLOWED,
  OFF_TOPIC,
  LINK_HELP,
  SEARCHING,
  HOW_TO_SEARCH,
  SEARCH_ERROR,
  LINK_ERROR,
  SEARCH_NOW,
  BACK_LABEL,
  MORE_LABEL,
  GOOD_LABEL,
  BAD_LABEL,
  NO_MORE,
  MORE_NOT_YOURS,
  VOTE_THANKS,
  VOTED,
  CLARIFY_NOT_YOURS,
  CLARIFY_EXPIRED,
  ADVICE_EMPTY,
} from "./format.js";

const GROUP_RESULTS = 4;
const PRIVATE_RESULTS = 4;
const HELP_COOLDOWN_MS = 10 * 60_000;
const CLARIFY_TTL_MS = 10 * 60_000;
const MAX_QUESTIONS = 3;
const OUR_GROUP_ID = "-1004397097299"; // פנדה אקספרס (@panda_deals_il), read from Telegram getChat on 2026-10-25
const PHOTO_SPARE = 2; // the photo check sees the products to show plus this many, so a dropped one is replaced
const RELEVANCE_POOL = 48; // titles only on gpt-5.4: ~$0.008 per check; up to 10 lists (main sorts, other wordings) share it
const PROVEN_SALES = 10;
const CHEAPEST = /הכי זול|הזול ביותר|הזולים ביותר|זול ביותר|במחיר הכי נמוך|הכי משתלם במחיר|cheapest|самый дешев|الأرخص/i;
const SECOND_CHANCE_BUDGET_MS = 7000; // a slow AliExpress day: show what was found rather than wait another ~5 s (18-24 s outliers seen)
const TRUSTED_FEEDBACK = 95;
// AliExpress barely ships food to Israel: an empty food search gets an explanation instead of "try rewording".
const FOOD_WORDS = /חטיף|ממתק|שוקולד|סוכרי|עוגיות|\bתה\b|קפה טחון|פולי קפה|אוכל|מזון|תבלין|דבש|אגוזים|food|snack|candy|tea\b/i;
const RESULTS_TTL_MS = 6 * 60 * 60_000; // shortcut: prices may drift a little within 6 h; shorten if that matters
const RESULTS_MAX = 300;
const MORE_PAGES = 2; // up to 2 more cards behind "🔄 עוד", from products already found and checked (no extra AI cost)
const MORE_TTL_MS = 10 * 60_000;
const CARD_TTL_MS = 24 * 60 * 60_000; // votes are deduplicated for a day
const CARDS_MAX = 500;
const BIDI_MARKS = /[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g; // copied mobile text often starts with one
// The search command in its common forms and typos (owner request: every way people write it should work):
// - verbs: חפש/מצא with ח/כ/ה, ש/ס, א/ה/ע swaps and extra/missing י/ו (חפס, כפש, חיפש, תחפוש, מצה, מצע, תמצאי…)
// - a stray or grammatical first letter (החפש, וחפש, לחפש) and polite openers (בבקשה / אפשר / תוכל / פנדה …)
// - "לי" / "ליי" / "לנו", glued or not ("חפשלי"), and the same keys typed on an English layout ("jpa kh")
const LEAD = String.raw`(?:(?:פנדה|בוט|היי|הי|בבקשה|אפשר|תוכל|תוכלי|אתה יכול|את יכולה|אחי|אחותי|חברים|דחוף|יאללה|@\w+)[\s,!.]+)*`; // "דחוף!!! חפש לי…", "אחי תחפש לי…", "היי @בוט תמצא לי…"
const VERB = String.raw`[הושל]?(?:ת?[חכה]י?פו?[שס]{1,3}[וי]?|ת?מי?צ(?:[אהע]|וא)[וי]?)`;
const ME = String.raw`(?:[ךכ]?לי{1,2}|ךי|לנו)`; // also "ךלי"/"ךי": ך sits next to ל on the Hebrew keyboard
// Members who write in English, Russian or Arabic ("find me…", "найди мне…", "ابحث لي عن…") are searched too.
const FOREIGN = String.raw`find\s+me|search\s+for|look\s+for|b[uú]s?ca(?:me)?|encu[eé]ntra(?:me)?|найди(?:те)?(?:\s+мне)?|поищи(?:\s+мне)?|ابحث(?:\s+لي)?(?:\s+عن)?|دور(?:\s+لي)?(?:\s+على)?`;
const TRIGGER = new RegExp(String.raw`^\s*(?:${LEAD}(?:${VERB}\s*-?\s*${ME}|jpa\s*kh|nmt\s*kh)(?![\u05D0-\u05EA])|(?:${FOREIGN})(?=\s))[\s:,.]*([\s\S]*)$`, "i");
// A missing space after "לי" ("חפש ליהדום"): the whole rest goes to the AI, which fixes it (and keeps real words like "לימון").
const TRIGGER_GLUED = new RegExp(String.raw`^\s*${LEAD}${VERB}\s*(לי[\u05D0-\u05EA][\s\S]*)$`); // also "חפשליאוזניות"
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

const GUIDE_COOLDOWN_MS = 10 * 60_000;
const VAGUE_START = /^(?:מוצר|מוצרים|משהו|דבר|דברים|מתנה|מתנות|רעיון|רעיונות)(?:\s|$)/;
// Asking for the help in Hebrew (the whole message), like /help.
const HELP_WORDS = /^(?:עזרה|הסבר|הוראות|מדריך|איך (?:זה עובד|הבוט עובד|מחפשים|משתמשים(?: בבוט)?|עובדים עם הבוט)|מה (?:הבוט|אתה) (?:יודע|עושה)(?: לעשות)?|help)\s*[?!.]*$/i;
// A link or a bare web address ("google.com", "s.click.aliexpress.com"): never searched as a product.
const LINKISH = /https?:\/\/|www\.|t\.me\/|(?:^|\s)[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|il|co|io|me|app|ly|ru|cn|info|biz|us)(?:\/\S*)?(?=\s|$)/i;
// Backup for the AI's "not_allowed" when the AI is unavailable: the most obvious Hebrew/English words only.
const BLOCKED_WORDS = /סכין קפיצית|אגרופן|טייזר|ויברטור|דילדו|סיגרי(?:ה|ות) אלקטרוני|וייפ|מצלמ(?:ה|ת) (?:נסתרת|ריגול)|switchblade|brass knuckles|taser|vibrator|dildo|\bvape\b|hidden camera|spy cam/i;
const isBlocked = (intent, text) => intent?.status === "not_allowed" || BLOCKED_WORDS.test(text); // the list wins even if the AI says ok ("וייפ")

export const isSoftRequest = (text) => text.length <= SOFT_MAX_LENGTH && SOFT.test(text.replace(BIDI_MARKS, ""));

// Text after a leading "@username", or null when the message doesn't start with the mention.
function mentionRest(text, username) {
  const m = text.replace(BIDI_MARKS, "").match(new RegExp(`^\\s*@${username}(?![A-Za-z0-9_])[\\s:,]*([\\s\\S]*)$`, "i"));
  return m ? m[1].trim() : null;
}

// Query for a start-of-message trigger ("" when it has no query), or null when the text isn't addressed to the bot.
// Hebrew typed with the English keyboard layout ("jpa kh nturb"): the rest is converted key by key, and the AI gets both,
// so an English product name the shopper meant ("jpa kh iphone") still works.
const HEB_KEYS = { q: "/", w: "'", e: "ק", r: "ר", t: "א", y: "ט", u: "ו", i: "ן", o: "ם", p: "פ", a: "ש", s: "ד", d: "ג", f: "כ", g: "ע", h: "י", j: "ח", k: "ל", l: "ך", ";": "ף", z: "ז", x: "ס", c: "ב", v: "ה", b: "נ", n: "מ", m: "צ", ",": "ת", ".": "ץ" };
const toHebrewKeys = (s) => s.toLowerCase().replace(/[a-z;,.]/g, (c) => HEB_KEYS[c]);

export function parseTrigger(text, username) {
  const clean = text.replace(BIDI_MARKS, "");
  const m = clean.match(TRIGGER) ?? clean.match(TRIGGER_GLUED);
  if (!m) return mentionRest(text, username);
  const rest = m[1].trim();
  const latinLayout = /^\s*(?:jpa|nmt)\s*kh\b/i.test(clean) && /^[a-z;,.\s\d]+$/i.test(rest) && /[a-z]/i.test(rest);
  return latinLayout ? `${rest} (${toHebrewKeys(rest)})` : rest;
}

// The result pipeline, shared by the bot and the search-quality eval:
// main + broader search together -> quality filter (≥90% feedback, price range) -> ONE AI relevance call on the best 24 of
// both (real results only, exact before partial) -> ranking (proven sellers first) -> one listing per photo.
// Throws only if both searches fail.
// Same photo (Hamming distance ≤ 6 of 64) = the same product from another seller: keep the first (best-ranked).
const SAME_PHOTO_MAX_DISTANCE = 6;
export async function dedupeByPhoto(products, hash) {
  const hashes = await Promise.all(products.map((p) => hash(p.product_main_image_url).catch(() => null)));
  const kept = [];
  return products.filter((_, i) => {
    const h = hashes[i];
    const near = (k) => [...h].reduce((d, b, j) => d + (b !== k[j]), 0) <= SAME_PHOTO_MAX_DISTANCE;
    if (h && kept.some(near)) return false;
    if (h) kept.push(h);
    return true;
  });
}

export async function pickProducts({ search, relevant, look = null, live, hash = null }, { keywords, fallback, alt = null, terms = [], category = null, looks = null, context, maxPriceIls = null, minPriceIls = null, brandOnly = false, cheapest = false, limit = 4, extra = 0 }) {
  const keyOf = (p) => p.product_id ?? p.promotion_link;
  const started = Date.now();
  // AliExpress's best-seller list often buries the real item under accessories that sell more ("adjustable desk" -> phone
  // stands, "baby pacifier" -> pacifier clips; the real ones were on page 2 or in the relevance order, 2026-10-29). So the
  // main words fetch three lists at once (free, parallel) and the AI pool mixes them, each ranked, round-robin.
  // Inside the item's main category the same words skip most accessories (microwave: 19 real microwaves of 50 vs 6; Baseus:
  // the 4,026-sold S1 Lite appeared, 2026-10-29), but a wrong category finds nothing (Ruckus): so two extra lists, never the only ones.
  const inCategory = category ? [{ category }, { category, sort: "relevance" }] : [];
  const LISTS = live ? [{}, { page: 2 }, { sort: "relevance" }, ...inCategory] : [{}];
  // Each list ranked on its own (best sellers first), then lists mixed in turn: every list's top items get in.
  const fetchLists = async (q, lists) => {
    const got = await Promise.allSettled(lists.map((v) => search(q, { minIls: minPriceIls, maxIls: maxPriceIls, shorten: false, ...v })));
    if (got.every((r) => r.status === "rejected")) throw got[0].reason;
    return got.map((r) => (r.status === "fulfilled" ? rankProducts(withinPrice(filterProducts(r.value), maxPriceIls, minPriceIls)) : []));
  };
  const inTurn = (ranked, max = Infinity, seen = new Set()) => {
    const out = [];
    for (let i = 0; i < Math.max(0, ...ranked.map((l) => l.length)) && out.length < max; i++) {
      for (const l of ranked) if (l[i] && !seen.has(keyOf(l[i])) && out.length < max) seen.add(keyOf(l[i])) && out.push(l[i]);
    }
    return out;
  };
  const find = async (q, lists) => inTurn(await fetchLists(q, lists));
  const broader = Boolean(fallback && fallback !== keywords);
  // Every other wording the AI gave (the sellers' names, every common meaning of the words) is searched from the start too,
  // free and in parallel: strong items often hide under another name ("detangling brush" for a comb, "car air freshener"
  // for "מטהר אוויר לרכב", 2026-10-30/31). ONE AI call then judges the pool.
  const wordings = live ? [...new Set([alt, ...terms].filter((t) => t && t !== keywords))] : [];
  const [main, wide, ...reworded] = await Promise.allSettled([fetchLists(keywords, LISTS), broader ? fetchLists(fallback, [{}]) : Promise.resolve([]), ...wordings.map((t) => fetchLists(t, [{}]))]);
  if (main.status === "rejected" && (!broader || wide.status === "rejected")) throw main.reason;
  if (main.status === "rejected") console.error(`main search failed, using the broader one: ${main.reason.message}`);
  const mainLists = main.status === "fulfilled" ? main.value : [];
  const otherLists = [...reworded, wide].flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  const first = inTurn(mainLists);
  const more = inTurn(otherLists, Infinity, new Set(first.map(keyOf)));
  let exact = first.length >= limit ? first : first.concat(more); // demo mode (no AI): the broader search only tops up
  let partial = [];
  if (live) {
    // Every list (the main words' best sellers, page 2, relevance order and category lists; each other wording; the broader
    // search) puts in its top items in turn, so no way of searching crowds out the others (half the pool for the other
    // wordings pushed out the strong gaming headsets, 2026-10-31).
    const pool = inTurn([...mainLists, ...otherLists], RELEVANCE_POOL);
    const judge = () => relevant({ he: context, en: keywords, looks, terms: wordings }, pool).catch(() => ({ exact: [], partial: pool }));
    let out = await judge();
    // "Nothing fits" on a full pool is often a one-off AI verdict on a vague request ("מתקן להחזקת מסך לרכב": 0 of 36 in the
    // group, 9 fitting holders on a rerun, 2026-10-29), so it is asked once more (≈0.7¢, only on these rare searches).
    const none = (o) => !(Array.isArray(o) ? o.length : o.exact.length + o.partial.length);
    if (none(out) && pool.length >= 8 && Date.now() - started < SECOND_CHANCE_BUDGET_MS) out = await judge();
    ({ exact, partial } = Array.isArray(out) ? { exact: out, partial: [] } : out);
    // Second chance: too few matches -> search the AI's other wording and check only the new candidates (one more AI call,
    // only for weak searches: "baby pacifier" returned clips, "silicone orthodontic pacifier" returns pacifiers).
    if (alt && exact.length + partial.length < limit && Date.now() - started < SECOND_CHANCE_BUDGET_MS) {
      const known = new Set([...first, ...more].map(keyOf));
      const fresh = await find(alt, [{}, { sort: "relevance" }, ...inCategory.slice(1)]).then((l) => l.filter((p) => !known.has(keyOf(p))), () => []);
      if (fresh.length) {
        const again = await relevant({ he: context, en: alt, looks, terms: wordings }, fresh.slice(0, RELEVANCE_POOL)).catch(() => ({ exact: [], partial: [] }));
        exact = exact.concat(again.exact ?? []);
        partial = partial.concat(again.partial ?? []);
      }
    }
  }
  // Trusted products first (≥10 sold and ≥95% positive feedback, the safe bar in buyer guides), so a card isn't led by unknown
  // or so-so sellers.
  const rate = (p) => parseFloat(p.evaluate_rate);
  const proven = (p) => Number(p.lastest_volume) >= PROVEN_SALES && !(rate(p) < TRUSTED_FEEDBACK);
  // Suspiciously cheap: under a quarter of the typical price of the matches AND barely sold (proven cheap items stay).
  const prices = [...exact, ...partial].map((p) => Number(p.target_sale_price ?? p.sale_price)).filter((n) => n > 0).sort((a, b) => a - b);
  const median = prices.length >= 4 ? prices[Math.floor(prices.length / 2)] : 0;
  const suspicious = (p) => median && Number(p.target_sale_price ?? p.sale_price) < median / 4 && Number(p.lastest_volume) < 100;
  exact = exact.filter((p) => !suspicious(p));
  partial = partial.filter((p) => !suspicious(p));
  // A brand was asked for and found: another brand isn't "close", but the same brand's near items are (Logitech M750 for
  // "ergonomic Logitech mouse"). brandOnly is the brand name, or true when unknown.
  const ofBrand = (p) => typeof brandOnly === "string" && (p.product_title ?? "").toLowerCase().includes(brandOnly.toLowerCase());
  if (brandOnly && exact.length) partial = partial.filter(ofBrand);
  const tag = (list, match) => list.map((p) => ({ ...p, match })); // the card says so when nothing shown is an exact match
  exact = tag(exact, "exact");
  partial = tag(partial, "partial");
  // A real match that has sold at least once beats a popular close one (Logitech Lift, 6 sold, before an M750 that only
  // calls itself ergonomic); never-sold real matches still come after proven close ones.
  const sold = (p) => Number(p.lastest_volume) >= 1 && !(rate(p) < TRUSTED_FEEDBACK);
  const tiers = [exact.filter(proven), exact.filter((p) => !proven(p) && sold(p)), partial.filter(proven), exact.filter((p) => !sold(p)), partial.filter((p) => !proven(p))];
  // "הכי זול": the matches cheapest first (exact before partial); the quality and suspicious-price filters still apply.
  const byPrice = (list) => [...list].sort((a, b) => Number(a.target_sale_price ?? a.sale_price) - Number(b.target_sale_price ?? b.sale_price));
  const all = cheapest ? [...byPrice(exact), ...byPrice(partial)] : tiers.flatMap(rankProducts);
  let ranked = dedupeProducts(all);
  // Few results: the same model from another seller is still a choice, usually at another price (Ruckus R350 at ₪1,179
  // and ₪1,859; the competitor showed both, 2026-10-29). The photo check below still drops identical listings.
  if (ranked.length < limit) ranked = ranked.concat(all.filter((p) => !ranked.includes(p)).slice(0, limit - ranked.length));
  // Photo check on the candidates that can still be shown (2× the need, so removed repeats get refilled).
  let shown = hash ? await dedupeByPhoto(ranked.slice(0, (limit + extra) * 2), hash) : ranked;
  // Last look, at the photos of the products about to be shown (a few spare): a title can lie ("kitchen faucet" on a
  // faucet sprayer head, 2026-10-30). A product the photos show isn't the item drops out and the next one moves up.
  // Fails open: no answer, or every one rejected (an odd verdict), keeps the list as it was.
  if (live && look && shown.length) {
    const head = shown.slice(0, limit + PHOTO_SPARE);
    const seen = await look({ he: context, en: keywords, looks, terms: wordings }, head).catch(() => null);
    if (seen) {
      const ok = new Set((Array.isArray(seen) ? seen : [...(seen.exact ?? []), ...(seen.partial ?? [])]).map(keyOf));
      const kept = head.filter((p) => ok.has(keyOf(p)));
      if (kept.length) shown = [...kept, ...shown.slice(head.length)];
    }
  }
  return shown.slice(0, limit + extra);
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
  look = (request, products) => filterRelevant(request, products, { photos: true }),
  advise = nextAdvice,
  explain = explainFit,
  title = shortTitles,
  collage = makeCollage,
  shorten = (products) => shortenLinks(products), // only the products a card shows get short links
  hash = photoHash, // tests pass a network-free stub
  stats = defaultStats,
  adminId = process.env.ADMIN_USER_ID, // owner's numeric Telegram id: /status and alerts
  version = process.env.RENDER_GIT_COMMIT?.slice(0, 7) ?? "local",
  healthChecks = liveHealthChecks,
  live, // tests only: force the live (non-mock) path
  typingEveryMs = 4000,
  now = Date.now,
  cooldownMs = 10_000,
  doubleTapMs = 1500, // a second tap right after a question changed in place lands on the new question's button
  groupId = process.env.GROUP_CHAT_ID ?? OUR_GROUP_ID, // null = any group (tests)
  privateChat = false, // tests only: serve private chats like the group
}) {
  const bot = new Bot(token, botInfo ? { botInfo } : {});
  const moderation = createModeration({ now });
  // The bot lives in OUR group only (owner request). Other groups are ignored completely. In private nobody is served,
  // the owner included, except /status (owner) and /myid; everyone gets an invitation to the group.
  bot.use(async (ctx, next) => {
    const type = ctx.chat?.type;
    if (type === "group" || type === "supergroup") return groupId == null || String(ctx.chat.id) === String(groupId) ? next() : undefined;
    if (type !== "private" || privateChat) return next();
    if (ctx.callbackQuery) return ctx.answerCallbackQuery({ text: PRIVATE_BUTTON });
    if (/^\/(?:myid|status)\b/.test(ctx.message?.text ?? "")) return next();
    if (ctx.message) return reply(ctx, PRIVATE_INVITE, { reply_markup: { inline_keyboard: [[{ text: "🐼 להצטרפות לקבוצה", url: GROUP_LINK }]] } });
  });
  bot.use(moderation.middleware); // spam is removed before any search logic sees it
  bot.on("message:new_chat_members", moderation.onJoin);
  const cooldowns = new Map(); // shortcut: in-memory, resets on restart; fine for a single instance
  const groupHelpAt = new Map();
  const guidedAt = new Map(); // last "write חפש לי" hint per user (same in-memory shortcut)
  const pending = new Map(); // advisor sessions waiting for a button press, by short id (same shortcut as above)
  let clarifySeq = 0;
  const resultsCache = new Map(); // same search within 6 h -> same products, no AI or AliExpress cost (same in-memory shortcut)
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
    // "מטען לרכב וגם כבל לאייפון": two items, a card for each (at most two; "מטען וכבל" stays one, it is often a set).
    const both = query.split(/\s+וגם\s+/).map((q) => q.trim()).filter((q) => q.length >= 2);
    if (both.length === 2) {
      for (const one of both) await searchOne(ctx, one);
      return;
    }
    return searchOne(ctx, query);
  }

  async function searchOne(ctx, query) {
    return withTyping(ctx, async () => {
      const intent = await understand(query).catch(() => null); // null = AI unavailable: search the raw query
      if (intent?.status === "not_product") return reply(ctx, NOT_PRODUCT);
      if (isBlocked(intent, query)) return reply(ctx, NOT_ALLOWED); // natural requests and bare names stay silent (status isn't "ok")
      if (intent?.status === "clarify") return askClarify(ctx, query, intent);
      // "מוצר למטבח", "משהו לבית", "מתנה לאמא": always the advisor, even when the AI said "search" (it did for a typo).
      if (intent?.status === "ok" && VAGUE_START.test(intent.corrected_he || query)) {
        const step = await advise({ request: intent.corrected_he || query, history: [] }).catch(() => null);
        if (step?.status === "ask") return showQuestion(ctx, newSession(ctx, query, intent.max_price_ils, intent.min_price_ils, intent.keywords_en), step.question_he, step.options);
      }
      return showResults(ctx, {
        keywords: intent?.keywords_en || query,
        fallback: intent?.fallback_en,
        alt: intent?.alt_en ?? null,
        looks: intent?.looks_like ?? null,
        terms: intent?.terms_en ?? [],
        cheapest: CHEAPEST.test(query),
        header: intent?.corrected_he || query,
        maxPriceIls: intent?.max_price_ils ?? null,
        minPriceIls: intent?.min_price_ils ?? intent?.floor_price_ils ?? null,
        floorOnly: Boolean(!intent?.min_price_ils && intent?.floor_price_ils),
        brandOnly: intent?.brand || false,
        category: intent?.category_id ?? null,
        replyToId: ctx.msg.message_id,
      });
    });
  }

  // At most one hint of each kind (bare name / off-topic) per user per 10 minutes. Checked before any AI call: saves cost.
  const hintAllowed = (ctx, kind) => !coolingDown(ctx) && !(now() - (guidedAt.get(`${kind}:${ctx.from.id}`) ?? -Infinity) < GUIDE_COOLDOWN_MS);
  function hint(ctx, kind, html) {
    guidedAt.set(`${kind}:${ctx.from.id}`, now());
    if (guidedAt.size > 1000) for (const [id, at] of guidedAt) if (now() - at > GUIDE_COOLDOWN_MS) guidedAt.delete(id);
    return reply(ctx, html);
  }

  // A natural group request ("מישהו מכיר מטען טוב?"): searched when the AI confirms a product request. A request for
  // something that isn't a product ("מחפש עבודה", "יש המלצה על רופא?") gets a warning-style hint; other cases stay silent.
  async function runSoftSearch(ctx, text, { warn = true } = {}) {
    if (coolingDown(ctx)) return;
    const intent = await understand(text).catch(() => null);
    if (warn && intent?.status === "not_product" && hintAllowed(ctx, "offTopic")) return hint(ctx, "offTopic", OFF_TOPIC);
    if (intent?.status !== "ok" && intent?.status !== "clarify") return;
    await allow(ctx); // starts the cooldown only for requests the bot actually answers
    if (intent.status === "clarify") return askClarify(ctx, text, intent);
    return withTyping(ctx, () =>
      showResults(ctx, { keywords: intent.keywords_en, fallback: intent.fallback_en, alt: intent.alt_en ?? null, looks: intent.looks_like ?? null, terms: intent.terms_en ?? [], cheapest: CHEAPEST.test(text), header: intent.corrected_he || text, maxPriceIls: intent.max_price_ils ?? null, minPriceIls: intent.min_price_ils ?? intent.floor_price_ils ?? null, floorOnly: Boolean(!intent.min_price_ils && intent.floor_price_ils), brandOnly: intent.brand || false, category: intent.category_id ?? null, replyToId: ctx.msg.message_id }),
    );
  }

  // Any other group message (owner request: no silence, one fixed message, no AI cost): how to search, at most once per
  // 10 minutes per user. Admins are exempt (their posts and deals).
  async function guideOrWarn(ctx) {
    if (!hintAllowed(ctx, "bare") || (await moderation.isAdmin(ctx, ctx.from.id))) return;
    return hint(ctx, "bare", HOW_TO_SEARCH);
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

  async function sendResults(ctx, { keywords, fallback, alt = null, terms = [], looks = null, cheapest = false, header, context = header, maxPriceIls, minPriceIls, floorOnly = false, brandOnly = false, category = null, replyToId, advice = null }) {
    const limit = ctx.chat.type === "private" ? PRIVATE_RESULTS : GROUP_RESULTS;
    stats.count("search");
    let found;
    try {
      const key = JSON.stringify([keywords, fallback, category, maxPriceIls, minPriceIls, brandOnly, cheapest, limit]);
      const hit = resultsCache.get(key);
      if (hit && now() - hit.at < RESULTS_TTL_MS) {
        found = hit.found;
        stats.count("cached");
      } else {
        const pick = (min) => pickProducts({ search, relevant, look, live: live ?? !isMockMode(), hash }, { keywords, fallback, alt, terms, category, looks, context, maxPriceIls, minPriceIls: min, brandOnly, cheapest, limit, extra: limit * MORE_PAGES });
        found = await pick(minPriceIls);
        if (!found.length && floorOnly) found = await pick(null); // the AI's price floor found nothing: better cheaper than empty
        // Short links and short Hebrew names together (parallel, no extra wait); names cover the "עוד" pages too.
        const [linked, names] = await Promise.all([shorten(found).catch(() => found), title(context, found).catch(() => null)]);
        found = linked.map((p, i) => (names?.[i] ? { ...p, short_he: names[i] } : p));
        // Same model in another color gets the same short name (KZ EDX Pro X twice): with enough results, keep the first.
        // With few results a second seller of the same model stays (see pickProducts).
        if (found.length > limit) found = found.filter((p, i) => !p.short_he || found.findIndex((q) => q.short_he === p.short_he) === i);
        if (found.length) resultsCache.set(key, { found, at: now() });
        if (resultsCache.size > RESULTS_MAX) resultsCache.delete(resultsCache.keys().next().value);
      }
    } catch (e) {
      stats.failure("aliexpress", e.message);
      console.error(`update ${ctx.update.update_id}: search failed: ${e.message}`);
      return ctx.reply(SEARCH_ERROR, { parse_mode: "HTML", ...replyParams(replyToId) });
    }
    if (!found.length) {
      stats.count("noResults");
      stats.report("noResults", `😕 בלי תוצאות: "${header}" (חיפשתי: ${keywords})`);
      const food = FOOD_WORDS.test(`${header} ${keywords}`) && !/מטחנ|כוס|ספל|קופס|grinder|mug|cup|box/i.test(`${header} ${keywords}`);
      return ctx.reply(food ? NO_FOOD : NO_RESULTS, { parse_mode: "HTML", ...replyParams(replyToId) });
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
    // What the card showed, so a 🐼 report says what went wrong, not only what was asked.
    const shownText = shown.map((p) => `${p.short_he || shortTitle(p.product_title)} (${soldText(p.lastest_volume) ?? 0} נמכרו)`).join(" · ");
    cards.set(id, { userId: requester(ctx), header, replyToId, rest, voters: new Set(), at: now(), shownText });
    const closest = !shown.some((p) => p.match !== "partial"); // e.g. a brand AliExpress doesn't carry
    const { caption } = formatCard(shown, { query: header, demo: isMockMode(), reasons, closest });
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
  function newSession(ctx, request, maxPriceIls = null, minPriceIls = null, keywords = null) {
    for (const [key, e] of pending) if (now() - e.at > CLARIFY_TTL_MS) pending.delete(key);
    const id = (++clarifySeq).toString(36);
    const session = { id, userId: requester(ctx), request, history: [], keywords, label: null, maxPriceIls, minPriceIls, replyToId: ctx.msg?.message_id, at: now() };
    pending.set(id, session);
    return session;
  }

  function showQuestion(ctx, session, question, options, { edit = false } = {}) {
    Object.assign(session, { question, options, at: now() });
    const rows = options.map((o, n) => [{ text: o.label_he, callback_data: `q:${session.id}:${n}` }]); // in the group too (owner request)
    rows.push([
      ...(session.stack?.length ? [{ text: BACK_LABEL, callback_data: `q:${session.id}:back` }] : []),
      { text: SEARCH_NOW, callback_data: `q:${session.id}:go` },
    ]);
    const extra = { parse_mode: "HTML", reply_markup: { inline_keyboard: rows } };
    const text = questionText(question);
    return edit ? ctx.editMessageText(text, extra).catch(() => {}) : reply(ctx, text, extra);
  }

  function askClarify(ctx, query, intent) {
    // The AI's keywords ride along, so "תחפש כבר" before any answer searches them, not the Hebrew request.
    return showQuestion(ctx, newSession(ctx, query, intent.max_price_ils, intent.min_price_ils, intent.keywords_en || null), intent.clarify_question_he, intent.options);
  }

  // Records the answer, then asks the next question (max 3 in total) or searches.
  async function answer(ctx, session, n, { edit }) {
    const option = session.options?.[n];
    if (!option) return;
    // A snapshot for "⬅️ חזרה": back restores the question and everything chosen before this answer.
    const { question, options, keywords, label, maxPriceIls, minPriceIls, broad } = session;
    (session.stack ??= []).push({ question, options, keywords, label, maxPriceIls, minPriceIls, broad, history: [...session.history] });
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
    const header = [session.request, ...session.history.map((h) => h.a)].join(" · "); // every choice, e.g. "מתנה לאמא · עגילים · מעל 400 ₪"
    if (edit) await ctx.editMessageText(chosenText(header), { parse_mode: "HTML" }).catch(() => {}); // no reply_markup = buttons removed
    const advice = session.history.length ? { request: session.request, history: session.history } : null;
    const context = advice ? `${session.request} (${session.history.map((h) => h.a).join(", ")})` : session.request;
    return withTyping(ctx, () =>
      showResults(ctx, { keywords: session.keywords ?? session.request, fallback: session.broad, header, context, maxPriceIls: session.maxPriceIls, minPriceIls: session.minPriceIls, replyToId: session.replyToId, advice }),
    );
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

  // The help, in the group itself (owner request: the bot lives in the group), at most once per 10 minutes per chat.
  function sendHelp(ctx) {
    if (ctx.chat.type !== "private") {
      const last = groupHelpAt.get(ctx.chat.id);
      if (last !== undefined && now() - last < HELP_COOLDOWN_MS) return;
      groupHelpAt.set(ctx.chat.id, now());
    }
    return reply(ctx, HELP);
  }
  bot.command(["start", "help"], sendHelp);
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
      `🤖 כשלי AI: ${n("fail:ai")} · כשלי טלגרם: ${n("fail:telegram")} · 💰 עלות AI: $${n("aiCost").toFixed(2)}`,
      `🎯 בול: ${n("thumbsUp")} · 🐼 לא זה: ${n("thumbsDown")} · 🔍 לחפש עוד: ${n("more")} · ♻️ מהזיכרון: ${n("cached")}`,
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
  bot.callbackQuery(/^q:([0-9a-z]+):(\d|go|back)$/, async (ctx) => {
    const [, id, choice] = ctx.match;
    const session = pending.get(id);
    if (!session || now() - session.at > CLARIFY_TTL_MS) {
      pending.delete(id);
      return ctx.answerCallbackQuery({ text: CLARIFY_EXPIRED });
    }
    if (!isRequester(ctx, session.userId)) return ctx.answerCallbackQuery({ text: CLARIFY_NOT_YOURS });
    await ctx.answerCallbackQuery();
    if (session.busy) return; // a double tap while the AI is thinking
    if (now() - session.at < doubleTapMs) return; // the accidental second tap of a double tap (see doubleTapMs)
    session.busy = true;
    try {
      if (choice === "back") {
        const prev = session.stack?.pop();
        if (!prev) return;
        Object.assign(session, prev);
        return await showQuestion(ctx, session, prev.question, prev.options, { edit: true });
      }
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
    if (vote === "d" && card) stats.report("thumbsDown", `🐼 "לא זה" על: "${card.header}"\nהוצג: ${card.shownText}`);
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
      // Basically just a link to another site (or an AliExpress address without a product): explain, don't search it.
      const words = text.replace(new RegExp(LINKISH.source, "gi"), " ").replace(/@\w+/g, " ").trim().split(/\s+/).filter(Boolean);
      if (LINKISH.test(text) && words.length <= 1) return reply(ctx, LINK_HELP);
    }
    if (HELP_WORDS.test(text.replace(BIDI_MARKS, "").trim())) return sendHelp(ctx); // "עזרה", "איך זה עובד?"…
    const query = parseTrigger(text, username);
    if (query !== null) return runSearch(ctx, query);
    if (isPrivate) return runSearch(ctx, text);
    if (isSoftRequest(text)) return runSoftSearch(ctx, text);
    if (startsWithSearchVerb(text)) return runSoftSearch(ctx, text, { warn: false }); // "חפש מטען": searched if the AI sees a product
    // Replies are conversation (a reply with "חפש לי" or a natural request was already handled above); shared links are deals.
    if (ctx.msg.reply_to_message || LINKISH.test(text) || text.length > SOFT_MAX_LENGTH) return;
    return guideOrWarn(ctx);
  });

  bot.catch((err) => console.error(`update ${err.ctx.update.update_id} failed: ${err.error?.message ?? err.error}`));
  return bot;
}
