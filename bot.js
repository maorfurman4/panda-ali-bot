// Telegram handlers: search triggers, link conversion, cooldowns, Hebrew photo result cards.
// Privacy: logs contain only update IDs and error messages, never message text or user names.
import { Bot, InputFile } from "grammy";
import { searchProducts, convertToAffiliate, isMockMode, shortenLinks, addStars, skuDetails } from "./aliexpress.js";
import { findAliExpressUrl } from "./links.js";
import { understandQuery, filterRelevant, nextAdvice, explainFit, shortTitles, pickColorPhotos } from "./query.js";
import { makeCollage, photoHash } from "./collage.js";
import { createModeration } from "./moderation.js";
import { stats as defaultStats } from "./stats.js";
import { searchProducts as liveSearch } from "./aliexpress.js";
import { createUnderstander, claudeCheck, namesLook } from "./query.js";
import {
  shortTitle,
  soldText,
  filterProducts,
  bigSeller,
  rankProducts,
  strength,
  offColor,
  babyOnly,
  notForShabbat,
  colorVariant,
  namesItem,
  normalizeText,
  headerOf,
  whiteOrKids,
  inColors,
  trustedFirst,
  sameReviews,
  sellerFirst,
  dedupeProducts,
  esc,
  RLM,
  withinPrice,
  formatCard,
  formatLinkReply,
  questionText,
  WELCOME_PIN,
  chosenText,
  cooldownMessage,
  HELP,
  PRIVATE_INVITE,
  PRIVATE_BUTTON,
  GROUP_LINK,
  EMPTY_QUERY,
  NO_RESULTS,
  NO_FOOD,
  bigItem,
  WEAK_SOLD,
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
  offTheme,
  specialKind,
  fakeLuxury,
  fakeCapacity,
  titleShare,
  SELF_CHECK,
  fakeExample,
  singleForSet,
  modelKey,
  sameModel,
  varied,
} from "./format.js";

const GROUP_RESULTS = 4;
const PRIVATE_RESULTS = 4;
const HELP_COOLDOWN_MS = 10 * 60_000;
const CLARIFY_TTL_MS = 10 * 60_000;
const MAX_QUESTIONS = 3;
const OUR_GROUP_ID = "-1004397097299"; // פנדה אקספרס (@panda_deals_il), read from Telegram getChat on 2026-10-25
const PHOTO_SPARE = 2; // the photo check sees the products to show plus this many, so a dropped one is replaced
// A named color: listings show their main photo, often another color than the one asked for (AliExpress's own search shows
// the asked color's photo), so the photo check sees more of them, and only what it saw can be shown.
const COLOR_PHOTO_SPARE = 8;
const COLOR_PICK_MAX = 4; // multi-color listings whose other photos are looked at for the asked color (≈5 photos each)
// A named color is a variant, not a kind: big sellers list one sweater in ten colors and name none in the title, so a search
// with the color found only small sellers (free check, 2026-11-05, the middle of the 16 best: burgundy sweater 5 sold vs 1,630
// for "women sweater"; black travel mug 1 vs 2,057; pink earbuds 6 vs 18,410). The item is also searched without the color,
// and the best sellers the judges left out get a look at their other photos for the asked color (one call, ≈0.45¢).
// Materials and patterns (cashmere, leather, linen, floral) stay: they are the item, not a variant.
// The reading words a color several ways ("maroon", "dark red", "navy blue"), so the common ones are all stripped: an
// unstripped one skips the color-free search (a guess at why one "סוודר בורדו" card had only 1-9 sold, 2026-11-06).
const COLOR_EN = /\b(?:(?:dark|light|deep|sky|navy|wine|baby|royal|rose)\s+)?(?:black|white|red|blue|navy|green|yellow|pink|purple|brown|beige|khaki|nude|gr[ae]y|orange|burgundy|turquoise|wine|maroon|bordeaux|claret|ivory|cream|camel|apricot|lavender|violet|lilac|fuchsia|magenta|teal|mint|olive|mustard|coral|champagne|charcoal|silver|gold|golden)\b/gi;
export const withoutColor = (keywords = "") => keywords.replace(COLOR_EN, " ").replace(/\s+/g, " ").trim();
const COLOR_POOL_PICK = 6; // at most this many go to the photo picker
const COLOR_SKU_CHECK = 40; // the color-free best sellers whose variants are checked (free: 40 at once in 0.7-1.5 s, 2026-11-06)
// Titles only on gpt-5.4: ~$0.008 per 48. Non-style searches get 72: the three readings' words make up to ~17 lists, and
// at 48 they pushed out sellers each single reading had (8,298 shavers, 16,652 car chargers; simulated 2026-11-02).
// Style searches stay at 48, as approved (with 72 a blue gown got into "שמלת ערב שחורה ארוכה", 2026-11-02).
const RELEVANCE_POOL = 48;
const WIDE_POOL = 72;
const PROVEN_SALES = 50; // 34- and 10-sold items took 2nd place at 10 (2026-11-02)
const CHEAPEST = /הכי זול|הזול ביותר|הזולים ביותר|זול ביותר|במחיר הכי נמוך|הכי משתלם במחיר|cheapest|самый дешев|الأرخص/i;
const SECOND_CHANCE_BUDGET_MS = 7000; // a slow AliExpress day: show what was found rather than wait another ~5 s (18-24 s outliers seen)
const TRUSTED_FEEDBACK = 92; // ≈4.6-4.7 stars; 95 (≈4.8) pushed down 45% of strong sellers (1,953 products, 2026-11-01)
// Style items (bags, clothes, jewelry, decor): the card mixes the best sellers with the prettiest. The photo look sees this
// many matches (the card and both "עוד" pages, with spares), from those with ≥20 sold and ≥90% positive feedback (≈4.5
// stars): a 92% designer straw bag with 301 sold is a fine pick, not a never-sold one. A ✨ pick with 20 sold was too few
// to trust (2026-11-01), so 100.
const STYLE_PHOTOS = 16;
const STYLE_MIN_SOLD = 100;
const DECENT_REVIEWS = 10;
const STRONG_REVIEWS = 20; // a style item with 100+ sold and 20+ reviews (4.5+) leads its card even if the AI called it "close"
const STYLE_MIN_FEEDBACK = 90;
// The floor rises with the search: items selling under a fifth of its top seller drop out while the look still gets
// STYLE_PHOTOS to choose from (owner: as many sales in the card as possible, 2026-11-05). Free check on 32 fashion
// searches: sandals (top 34,403) and men's shorts lose their 100-500-sold items; weak searches keep 100.
const STYLE_TOP_SHARE = 0.2;
export function styleFloor(products) {
  const sales = products.map((p) => Number(p.lastest_volume) || 0).sort((a, b) => b - a);
  return Math.max(STYLE_MIN_SOLD, Math.min(STYLE_TOP_SHARE * (sales[0] ?? 0), sales[STYLE_PHOTOS - 1] ?? 0));
}
// Each card holds one item of a trusted brand when there is one: an official brand store, or a well-known brand the title
// check names (Baseus, Ugreen, Anker…), with ≥100 sold and ≥92% feedback (owner request, 2026-11-01).
const BRAND_MIN_SOLD = 100;
const BRAND_SHARE = 0.1;
// AliExpress barely ships food to Israel: an empty food search gets an explanation instead of "try rewording".
const FOOD_WORDS = /חטיף|ממתק|שוקולד|סוכרי|עוגיות|\bתה\b|קפה טחון|פולי קפה|אוכל|מזון|תבלין|דבש|אגוזים|food|snack|candy|tea\b/i;
const RESULTS_TTL_MS = 24 * 60 * 60_000; // one answer a day: the judges vary run to run (owner, 2026-11-01). shortcut: prices may drift within the day; shorten if that matters
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
// The card's title never starts with the search verb, even when the AI echoes it ("חפש לי שמלת ערב", live test 2026-11-02).
const VERB_LEAD = new RegExp(String.raw`^\s*${LEAD}${VERB}(?:\s*-?\s*${ME})?(?![\u05D0-\u05EA])[\s:,.]*`);
export const cardTitle = (text) => text.replace(BIDI_MARKS, "").replace(VERB_LEAD, "").replace(/[\s.,:]+$/, "").trim() || text;

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
// A short reply that refines your own search; thanks, laughs and questions aren't refinements.
const REFINE_MAX = 60;
const NOT_REFINE = /^(?:תודה|תודה רבה|תנקס|אחלה|מעולה|מושלם|יופי|וואו|סבבה|אוקיי|אוקי|ok|לא|כן|חח+|ח+|👍|🙏|❤️|😂)[\s!.?]*$|\?$/i;
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

// What an advisor button would find: the sales of its words' best sellers that pass the quality filter and the price
// range, highest first. One free AliExpress call, no AI.
export async function optionSales(search, keywords, { minIls = null, maxIls = null } = {}) {
  const list = await search(keywords, { minIls, maxIls, shorten: false, askAgain: false });
  return withinPrice(filterProducts(list), maxIls, minIls).map((p) => Number(p.lastest_volume) || 0).sort((a, b) => b - a);
}

// A brand-and-model request also searches the brand and the model alone: "access point Aruba AP22" finds nothing on
// AliExpress, "Aruba AP22" finds the AP22 (owner's comparison, 2026-11-03). The model = the words after the brand that are
// capitalized or carry a digit ("Aruba AP22", "Xiaomi Redmi Note 13"); null when there is none or it is the whole search.
export function brandModel(brand, keywords) {
  if (typeof brand !== "string" || !keywords) return null;
  const words = keywords.split(/\s+/);
  const at = words.findIndex((w) => w.toLowerCase() === brand.toLowerCase());
  const model = [];
  for (const w of words.slice(at + 1)) if (/\d|^[A-Z]/.test(w)) model.push(w); else if (model.length) break;
  const short = model.length ? `${brand} ${model.join(" ")}` : null;
  return short && short.toLowerCase() !== keywords.toLowerCase() ? short : null;
}

// The pool the AI judges (non-style searches): the top POOL_EACH of every list in turn, so every wording, meaning and brand
// list keeps a voice, then the strongest of all lists together, a product found by more lists counting more (+15% each).
// By turns alone a 25,335-sold LED strip at #20 in 9 of 15 lists, and a 15,417-sold toothbrush at #10 of the main list,
// never reached the AI. On 20 searches' lists: products with 5,000+ sales reaching the AI 295 -> 472 of 638, no search
// fewer, every list still in (owner, 2026-11-03).
const POOL_EACH = 3;
const PER_LIST = 0.15;
export function strongPool(lists, size, keyOf = (p) => p.product_id ?? p.promotion_link) {
  const head = [], seen = new Set();
  for (let i = 0; i < POOL_EACH && head.length < size; i++) {
    for (const l of lists) if (l[i] && !seen.has(keyOf(l[i])) && head.length < size) seen.add(keyOf(l[i])) && head.push(l[i]);
  }
  const count = new Map(), rest = new Map();
  for (const l of lists) for (const p of l) {
    count.set(keyOf(p), (count.get(keyOf(p)) ?? 0) + 1);
    if (!seen.has(keyOf(p)) && !rest.has(keyOf(p))) rest.set(keyOf(p), p);
  }
  const weight = (p) => strength(p) * (1 + PER_LIST * (count.get(keyOf(p)) - 1));
  return head.concat([...rest.values()].sort((a, b) => weight(b) - weight(a)).slice(0, size - head.length));
}

// Every advisor button should lead to a strong card (owner, 2026-11-02). Each kind option is looked up on AliExpress: one
// with fewer than STRONG_MIN best sellers (STRONG_SOLD+ sold) is dropped, the rest go strongest first. Budget options, a
// failed or slow lookup, and the last 2 options always stay (a question needs 2 buttons).
const OVER_BUDGET = 1.1;
const STRONG_SOLD = 100;
const STRONG_MIN = 4;
const LOOKUP_MS = 4000;
// Told by the label: the AI leaves the prices off some budget buttons ("עד 50₪") and copies the budget onto kind buttons.
const PRICE_LABEL = /₪|ש["״']?ח|שקל|\d{2,}/;
export async function checkOptions(search, options, { minIls = null, maxIls = null } = {}) {
  if (options.some((o) => PRICE_LABEL.test(o.label_he))) return options; // a budget question: price ranges keep their order
  const lookup = (o) => Promise.race([optionSales(search, o.keywords_en, { minIls: o.min_price_ils ?? minIls, maxIls: o.max_price_ils ?? maxIls }), new Promise((r) => setTimeout(r, LOOKUP_MS, null).unref())]).catch(() => null);
  const sales = await Promise.all(options.map(lookup));
  const strong = (i) => (sales[i] ? sales[i].filter((n) => n >= STRONG_SOLD).length : Infinity); // unknown = kept
  const ranked = options.map((o, i) => ({ o, n: strong(i), top: sales[i] ? (sales[i][0] ?? 0) : Infinity })).sort((a, b) => b.n - a.n || b.top - a.top);
  const kept = ranked.filter((x) => x.n >= STRONG_MIN);
  return (kept.length >= 2 ? kept : ranked.slice(0, 2)).map((x) => x.o);
}

export async function pickProducts({ search, relevant, look = null, live, hash = null, pickPhoto = null, skus = null }, { keywords, fallback, alt = null, terms = [], category = null, looks = null, context, maxPriceIls = null, minPriceIls = null, brandOnly = false, cheapest = false, style = false, brands = [], limit = 4, extra = 0, reread = null }) {
  const keyOf = (p) => p.product_id ?? p.promotion_link;
  const started = Date.now();
  // AliExpress's best-seller list often buries the real item under accessories that sell more ("adjustable desk" -> phone
  // stands, "baby pacifier" -> pacifier clips; the real ones were on page 2 or in the relevance order, 2026-10-29). So the
  // main words fetch three lists at once (free, parallel) and the AI pool mixes them, each ranked, round-robin.
  // Inside the item's main category the same words skip most accessories (microwave: 19 real microwaves of 50 vs 6; Baseus:
  // the 4,026-sold S1 Lite appeared, 2026-10-29), but a wrong category finds nothing (Ruckus): so two extra lists, never the only ones.
  // AliExpress's default order isn't relevance: EV chargers and car tools for "fast charger", action figures for "wall clock"
  // (2026-11-02). Over 59 recorded searches its lists held 11% of the AI pool and found 4% of the exact matches, most of
  // them dresses, so only style searches keep them.
  const byDefault = style ? [{ sort: "relevance" }] : [];
  const inCategory = category ? [{ category }, ...(style ? [{ category, sort: "relevance" }] : [])] : [];
  const LISTS = live ? [{}, { page: 2 }, ...byDefault, ...inCategory] : [{}];
  // Each list ranked on its own (best sellers first), then lists mixed in turn: every list's top items get in.
  // Up to 10% over the budget is fine (owner, 2026-11-02): such a product says so on its card, at most one per card.
  const cap = maxPriceIls ? maxPriceIls * OVER_BUDGET : null;
  const markOver = (p) => (maxPriceIls && (p.target_sale_price_currency ?? p.sale_price_currency) === "ILS" && Number(p.target_sale_price ?? p.sale_price) > maxPriceIls ? { ...p, overBudget: true } : p);
  const fetchLists = async (q, lists) => {
    const got = await Promise.allSettled(lists.map((v) => search(q, { minIls: minPriceIls, maxIls: cap, shorten: false, ...v })));
    if (got.every((r) => r.status === "rejected")) throw got[0].reason;
    return got.map((r) => (r.status === "fulfilled" ? rankProducts(withinPrice(filterProducts(r.value), cap, minPriceIls).map(markOver)) : []));
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
  // The trusted brands the AI names for the item are searched as "<brand> <item>" too (free): Baseus and Ugreen car chargers
  // weren't in a pool led by ₪5 no-name ones (2026-11-01).
  const brandWords = new Set(brandOnly ? [] : brands.map((b) => `${b} ${keywords}`));
  const shortModel = brandModel(brandOnly, keywords);
  const wordings = live ? [...new Set([shortModel, alt, ...terms, ...brandWords].filter((t) => t && t !== keywords))] : [];
  const plain = live && namesLook(context) && withoutColor(keywords) !== keywords && withoutColor(keywords) ? withoutColor(keywords) : null;
  // A "<brand> <item>" list that comes back empty usually is empty ("QCY white wireless earbuds" in every run, 2026-11-02):
  // no second ask, which would only wait 1.2 s.
  const [main, wide, wideColor, ...reworded] = await Promise.allSettled([fetchLists(keywords, LISTS), broader ? fetchLists(fallback, [{}]) : Promise.resolve([]), plain ? fetchLists(plain, LISTS) : Promise.resolve([]), ...wordings.map((t) => fetchLists(t, [brandWords.has(t) ? { askAgain: false } : {}]))]);
  // The search fails only when every list failed: with AliExpress slow, the main words timed out at 10 s while other
  // wordings had come back, and the shopper got "תקלה בחיבור" (owner, 2026-11-03).
  if (main.status === "rejected" && (!broader || wide.status === "rejected") && reworded.every((r) => r.status === "rejected")) throw main.reason;
  if (main.status === "rejected") console.error(`main search failed, using the other wordings: ${main.reason.message}`);
  const mainLists = main.status === "fulfilled" ? main.value : [];
  const plainLists = wideColor.status === "fulfilled" ? wideColor.value : [];
  const otherLists = [...reworded, wide].flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  const first = inTurn(mainLists);
  // Self-check: the main words' top titles share nothing with the Hebrew request, so the reading was likely word for word
  // ("נטילת ידיים" -> soap). One more reading (≈0.15¢, before the judges), kept only if its titles match better.
  if (live && reread && titleShare(context, first) < SELF_CHECK) {
    const share = titleShare(context, first);
    const n = await reread(keywords).catch(() => null);
    if (n?.keywords && n.keywords !== keywords) {
      const probe = inTurn(await fetchLists(n.keywords, [{}]).catch(() => [[]]));
      console.log(`self-check: "${context}" read as "${keywords}" matched ${share.toFixed(2)}; "${n.keywords}" ${titleShare(context, probe).toFixed(2)}`);
      if (titleShare(context, probe) > share) {
        return pickProducts({ search, relevant, look, live, hash, pickPhoto, skus }, { keywords: n.keywords, fallback: n.fallback ?? fallback, alt: n.alt ?? null, terms: n.terms ?? [], category, looks: n.looks ?? looks, context, maxPriceIls, minPriceIls, brandOnly, cheapest, style, brands, limit, extra });
      }
    }
  }
  const more = inTurn(otherLists, Infinity, new Set(first.map(keyOf)));
  let exact = first.length >= limit ? first : first.concat(more); // demo mode (no AI): the broader search only tops up
  let partial = [];
  const known = new Set(); // well-known brands, as the title check names them
  let near = []; // one judge said exact, the other close
  let colorPooled = false; // the color-free best sellers already had their photo look (one picker call per search)
  const trace = [`"${keywords}"`]; // what happened, step by step: the owner sees it under his own searches (2026-11-06)
  // Each candidate's photo in the asked color: first from its variants (SKU API: a "Burgundy" variant's own photo, no AI,
  // 2026-11-06); a listing whose variants decide "not in this color" is out; only the undecided ones (coded colors, no
  // data, a full list of 20) go to the photo picker, at most pickMax of them. Returns key -> { url, variant }.
  const photoInColor = async (cands, pickMax, opts) => {
    const found = new Map();
    const variants = skus && cands.length ? await skus(cands.map((p) => String(keyOf(p)))).catch(() => new Map()) : new Map();
    const undecided = [];
    for (const p of cands) {
      const v = colorVariant(variants.get(String(keyOf(p))) ?? [], context);
      if (v.variant?.photo) found.set(keyOf(p), { url: v.variant.photo, variant: v.variant });
      else if (!v.decided || v.variant) undecided.push(p);
    }
    const byVariant = found.size;
    const toPicker = undecided.slice(0, pickMax);
    const urls = toPicker.length ? await pickPhoto({ he: context, en: keywords }, toPicker, opts).catch(() => []) : [];
    toPicker.forEach((p, i) => urls[i] && found.set(keyOf(p), { url: urls[i] }));
    if (cands.length) trace.push(`צבע: ${cands.length} נבדקו, ${byVariant} לפי וריאציות (${variants.size} ענו), ${found.size - byVariant}/${toPicker.length} לפי תמונות`);
    return found;
  };
  if (live) {
    // Every list (the main words' best sellers, page 2, relevance order and category lists; each other wording; the broader
    // search) puts in its top items in turn, so no way of searching crowds out the others (half the pool for the other
    // wordings pushed out the strong gaming headsets, 2026-10-31).
    const poolSize = style ? RELEVANCE_POOL : WIDE_POOL;
    // The shopper named a brand: its items go first in every list, or 25,000-sold generic holders crowd every Baseus one
    // out of the pool ("מעמד טלפון לרכב של Baseus": 8 Baseus holders came back, none reached the AI, 2026-11-02).
    const named = (p) => typeof brandOnly === "string" && (p.product_title ?? "").toLowerCase().includes(brandOnly.toLowerCase());
    const brandFirst = (l) => (typeof brandOnly === "string" ? [...l.filter(named), ...l.filter((p) => !named(p))] : l);
    const lists = [...mainLists, ...otherLists].map(brandFirst);
    const pool = style ? inTurn(lists, poolSize) : strongPool(lists, poolSize, keyOf); // style searches as approved
    // steady: the same verdict every time (temperature 0), on non-style searches only.
    const judge = () => relevant({ he: context, en: keywords, looks, terms: wordings, steady: !style }, pool).catch(() => ({ exact: [], partial: pool }));
    let out = await judge();
    // "Nothing fits" on a full pool is often a one-off AI verdict on a vague request ("מתקן להחזקת מסך לרכב": 0 of 36 in the
    // group, 9 fitting holders on a rerun, 2026-10-29), so it is asked once more (≈0.7¢, only on these rare searches).
    const none = (o) => !(Array.isArray(o) ? o.length : o.exact.length + o.partial.length);
    // Same for "nothing exact": towels came back all "close" once and all fine on a rerun (2026-11-01).
    const noExact = (o) => !Array.isArray(o) && !o.exact.length && o.partial.length >= limit;
    if ((none(out) || noExact(out)) && pool.length >= 8 && Date.now() - started < SECOND_CHANCE_BUDGET_MS) {
      const again = await judge();
      if (!none(again) && !(noExact(again) && !none(out))) out = again;
    }
    ({ exact, partial } = Array.isArray(out) ? { exact: out, partial: [] } : out);
    near = out.near ?? [];
    for (const p of out.brand ?? []) known.add(keyOf(p));
    // The color-free search's best sellers the judges left out (their first photo shows another variant): the photo picker
    // looks for the asked color among their other photos; one it finds is an exact match shown in that color.
    // They stay out of the judges' pool, which keeps every place for listings pictured in the asked color (sharing it left
    // "סוודר בורדו" and "שמלה ניוד" with 3 products, owner's test 2026-11-05), so this step only ever adds. Only one the
    // picker sees in the asked color is shown, its first photo included: on the judges' word a pink "15 colors" puffer led
    // a navy coat card. The title must name the request's item near its start ("coat" also found towel hooks).
    if (plain) trace.push(`בלי צבע: "${plain}"`);
    if (plain && pickPhoto) {
      const inPool = new Set(pool.map(keyOf));
      const left = inTurn(plainLists).filter((p) => !inPool.has(keyOf(p)) && namesItem(p.product_title, context) && !offColor(p.product_title, context) && (p.product_small_image_urls?.string?.length ?? 0) > 0)
        .sort((a, b) => (Number(b.lastest_volume) || 0) - (Number(a.lastest_volume) || 0)).slice(0, COLOR_SKU_CHECK);
      const found = await photoInColor(left, COLOR_POOL_PICK, { withMain: true });
      colorPooled = left.length > 0;
      // The color is proven; the kind is not: these skipped the judges, so a sprayer head came in for "ברז נשלף למטבח
      // שחור" and T-shirts for a white button-down shirt (final check, 2026-11-06). One titles-only check of the few found.
      const matched = left.filter((p) => found.has(keyOf(p)));
      const verdict = matched.length ? await relevant({ he: context, en: keywords, looks, terms: wordings, steady: !style }, matched).catch(() => null) : null;
      const fits = verdict ? new Set((Array.isArray(verdict) ? verdict : [...(verdict.exact ?? []), ...(verdict.near ?? []), ...(verdict.partial ?? [])]).map(keyOf)) : new Set(matched.map(keyOf));
      if (matched.length) trace.push(`צבע: ${fits.size} מתוך ${matched.length} עברו את השופטים`);
      exact = exact.concat(matched.filter((p) => fits.has(keyOf(p))).map((p) => ({ ...p, product_main_image_url: found.get(keyOf(p)).url, colorPick: true, ...(found.get(keyOf(p)).variant ? { variant: found.get(keyOf(p)).variant } : {}) })));
    }
    // Second chance: too few matches -> search the AI's other wording and check only the new candidates (one more AI call,
    // only for weak searches: "baby pacifier" returned clips, "silicone orthodontic pacifier" returns pacifiers).
    // Also when the matches barely sell (the best under WEAK_SOLD): often the words, not the supply (slow juicers only for
    // "מסחטת מיצים", 2026-11-04). One more AI call, only on these weak searches.
    const weakSold = !style && Math.max(0, ...[...exact, ...near].map((p) => Number(p.lastest_volume) || 0)) < WEAK_SOLD;
    if (alt && (exact.length + partial.length < limit || weakSold) && Date.now() - started < SECOND_CHANCE_BUDGET_MS) {
      const known = new Set([...first, ...more].map(keyOf));
      const fresh = await find(alt, [{}, ...byDefault, ...(category ? [inCategory.at(-1)] : [])]).then((l) => l.filter((p) => !known.has(keyOf(p))), () => []);
      if (fresh.length) {
        const again = await relevant({ he: context, en: alt, looks, terms: wordings, steady: !style }, fresh.slice(0, poolSize)).catch(() => ({ exact: [], partial: [] }));
        for (const p of again.brand ?? []) known.add(keyOf(p));
        exact = exact.concat(again.exact ?? []);
        partial = partial.concat(again.partial ?? []);
      }
    }
  }
  // Trusted products first (≥10 sold and ≥92% positive feedback, ≈4.6 stars; checked against the site's stars), so a card isn't led by unknown
  // or so-so sellers.
  const rate = (p) => parseFloat(p.evaluate_rate);
  // A big seller (1,000+ sold, 85%+ feedback) counts as proven too: kept by the quality filter, it should compete, not trail.
  const trusted = (p) => !(rate(p) < TRUSTED_FEEDBACK) || bigSeller(p);
  const proven = (p) => Number(p.lastest_volume) >= PROVEN_SALES && trusted(p);
  // Suspiciously cheap: under a quarter of the typical price of the matches AND barely sold (proven cheap items stay).
  const prices = [...exact, ...partial].map((p) => Number(p.target_sale_price ?? p.sale_price)).filter((n) => n > 0).sort((a, b) => a - b);
  const median = prices.length >= 4 ? prices[Math.floor(prices.length / 2)] : 0;
  const suspicious = (p) => median && Number(p.target_sale_price ?? p.sale_price) < median / 4 && Number(p.lastest_volume) < 100;
  // Suspiciously expensive: over 4× the typical price AND under 10 sold (a ₪4,035 laundry basket, 0 sold, 2026-10-31);
  // a pricey item people do buy stays.
  // The exact model the shopper named is never "too expensive": the ₪928 Aruba AP22 among ₪150 access points (2026-11-03).
  const namesModel = (p) => Boolean(shortModel) && shortModel.split(" ").slice(1).every((w) => (p.product_title ?? "").toLowerCase().includes(w.toLowerCase()));
  const overpriced = (p) => median && Number(p.target_sale_price ?? p.sale_price) > median * 4 && Number(p.lastest_volume) < PROVEN_SALES && !namesModel(p);
  const keep = (p) => !suspicious(p) && !overpriced(p) && !offTheme(p.product_title, `${context} ${keywords}`) && !fakeLuxury(p.product_title, `${context} ${keywords}`);
  exact = exact.filter(keep);
  partial = partial.filter(keep);
  near = near.filter(keep);
  // A title naming only another color is close, whatever the judges said (a brown dress for "שחורה", 2026-11-01).
  const wrongColor = (p) => !style && offColor(p.product_title, context); // style searches as at 17:30
  // titleOff: the title itself names another color (offColor alone can also be the photo look's "close").
  partial = [...partial.map((p) => (wrongColor(p) ? { ...p, offColor: true, titleOff: true } : p)), ...[...exact, ...near].filter(wrongColor).map((p) => ({ ...p, offColor: true, titleOff: true }))];
  exact = exact.filter((p) => !wrongColor(p));
  near = near.filter((p) => !wrongColor(p));
  // A baby item for a child's request is close, never a real match (style searches too).
  const baby = (p) => babyOnly(p.product_title, context) || notForShabbat(p.product_title, context); // and a sensor light for Shabbat
  partial = [...partial, ...[...exact, ...near].filter(baby).map((p) => ({ ...p, titleOff: true }))];
  exact = exact.filter((p) => !baby(p));
  near = near.filter((p) => !baby(p));
  const special = exact.filter((p) => specialKind(p.product_title, `${context} ${keywords}`) || singleForSet(p.product_title, context));
  if (special.length) (exact = exact.filter((p) => !special.includes(p))), (partial = [...special, ...partial]);
  // A brand was asked for and found: another brand isn't "close", but the same brand's near items are (Logitech M750 for
  // "ergonomic Logitech mouse"). brandOnly is the brand name, or true when unknown.
  const ofBrand = (p) => typeof brandOnly === "string" && (p.product_title ?? "").toLowerCase().includes(brandOnly.toLowerCase());
  // A brand search shows the brand; other brands only fill a card that would be short (always 4, owner): the Aruba AP22
  // came alone once found, its close alternatives all removed (2026-11-03).
  const brandFill = brandOnly && exact.length ? partial.filter((p) => !ofBrand(p)) : [];
  if (brandOnly && exact.length) partial = partial.filter(ofBrand);
  const brandTag = (p) => (/official store/i.test(p.shop_name ?? "") ? "official" : known.has(keyOf(p)) ? "known" : null);
  // match: the card says so when nothing shown is an exact match; brandTag: the card names a trusted brand.
  const tag = (list, match) => list.map((p) => (brandTag(p) ? { ...p, match, brandTag: brandTag(p) } : { ...p, match }));
  exact = tag(exact, "exact");
  partial = tag(partial, "partial");
  near = tag(near, "near");
  // Proven real matches, then proven close ones, then barely-sold real matches: a 2,775-sold advent calendar the check called
  // "close" beat ones with 5 sales (2026-10-31). But when no real match is proven, the best one that has sold still leads
  // (Logitech Lift, 6 sold, before an M750 that only calls itself ergonomic). Never-sold items come last.
  const sold = (p) => Number(p.lastest_volume) >= 1 && trusted(p);
  const exactProven = exact.filter(proven);
  const exactSold = rankProducts(exact.filter((p) => !proven(p) && sold(p)));
  const lead = exactProven.length ? [] : exactSold.slice(0, 1);
  // Non-style: a proven "near" (one judge exact, the other close) is ranked with the proven exact ones by sales, not after
  // all of them: the 79,513-sold T9 clipper fell past the 12 picks of "מכונת תספורת אלחוטית" behind a 1,383-sold exact one
  // (owner's test, 2026-11-02). Wrong kinds are moved to close by the code checks above (whisky glasses, Tesla-only...).
  // Only one that sold at least twice the best proven exact one: a 37,295-sold car holder ("near") led "מעמד לטלפון" over
  // 34,784-sold desk stands without this limit.
  const bestExact = Math.max(0, ...exactProven.map((p) => Number(p.lastest_volume)));
  // Family 1 (2026-11-04): every proven "near" now ranks with them; the car holders that needed the limit are moved to
  // close by carCharger since 2026-11-02, and a strong "near" earbud or speaker sat after weak exact ones.
  const strongNear = style ? [] : near.filter(proven);
  const short = Math.max(0, limit - exact.length - near.length - partial.length);
  const tiers = [style ? exactProven : rankProducts([...exactProven, ...strongNear]), lead, near.filter((p) => proven(p) && !strongNear.includes(p)), partial.filter(proven), exactSold.slice(lead.length), near.filter((p) => !proven(p)), exact.filter((p) => !sold(p)), partial.filter((p) => !proven(p)), rankProducts(brandFill).slice(0, short).map((p) => ({ ...p, brandFill: true }))];
  // "הכי זול": the matches cheapest first (exact before partial); the quality and suspicious-price filters still apply.
  const byPrice = (list) => [...list].sort((a, b) => Number(a.target_sale_price ?? a.sale_price) - Number(b.target_sale_price ?? b.sale_price));
  const all = cheapest ? [...byPrice(exact), ...byPrice(near), ...byPrice(partial)] : tiers.flatMap(rankProducts);
  let ranked = dedupeProducts(all);
  // Few results: the same model from another seller is still a choice, usually at another price (Ruckus R350 at ₪1,179
  // and ₪1,859; the competitor showed both, 2026-10-29). The photo check below still drops identical listings.
  if (ranked.length < limit) ranked = ranked.concat(all.filter((p) => !ranked.includes(p)).slice(0, limit - ranked.length));
  // Fake capacity (a ₪20 "2TB"): after every real one; fakeMoved marks one that would have been on the card, so it says why.
  const fake = (p) => fakeCapacity(p.product_title, p.target_sale_price ?? p.sale_price);
  const top = new Set(ranked.slice(0, limit));
  ranked = [...ranked.filter((p) => !fake(p)), ...ranked.filter(fake).map((p) => ({ ...p, fakeCap: true, ...(top.has(p) ? { fakeMoved: true } : {}) }))];
  // Photo check on the candidates that can still be shown (2× the need, so removed repeats get refilled).
  let shown = hash ? await dedupeByPhoto(ranked.slice(0, (limit + extra) * 2), hash) : [...ranked];
  // Always 4 when there are 4 (owner): with few matches the same model from another seller, dropped as a photo repeat, comes
  // back ("אוזניות אנקר ליברטי פרו" showed 2 while the competitor showed 4 Liberty Pro listings, 2026-11-03).
  if (shown.length < limit) shown = shown.concat(ranked.filter((p) => !shown.includes(p)).slice(0, limit - shown.length));
  // A card without a trusted-brand item gets the best one from further down, second: 🥇 best seller, 🏷️ brand, 🥈, 🥉.
  // Before the photo check, so the brand item is looked at too. Style searches keep their own mix (✨).
  const strongBrand = (p) => !p.fakeCap && p.brandTag && p.match === "exact" && Number(p.lastest_volume) >= BRAND_MIN_SOLD && !(rate(p) < TRUSTED_FEEDBACK);
  // The brand item must sell at least BRAND_SHARE of the product it pushes out of the card: a 430-sold Homefish towel rail
  // took 2nd place over 15,000-sold rails (owner's comparison, 2026-11-03); a 15,000-sold Baseus charger next to 40,000-sold
  // ones still gets the slot.
  for (let start = 0; !style && !cheapest && start < Math.min(shown.length, limit + extra); start += limit) {
    if (shown.slice(start, start + limit).some(strongBrand)) continue;
    const out = Number(shown[start + limit - 1]?.lastest_volume) || 0;
    const j = shown.findIndex((p, i) => i >= start + limit && strongBrand(p) && Number(p.lastest_volume) >= out * BRAND_SHARE);
    if (j < 0) break;
    const [b] = shown.splice(j, 1);
    shown.splice(start + 1, 0, { ...b, brandSlot: true });
  }
  // Last look, at the photos of the products about to be shown (a few spare): a title can lie ("kitchen faucet" on a
  // faucet sprayer head, 2026-10-30). A product the photos show isn't the item drops out and the next one moves up.
  // Fails open: no answer, or every one rejected (an odd verdict), keeps the list as it was.
  const banners = new Set(); // products whose main photo is an ad banner (the photo look says so)
  const otherColor = new Set(); // products the photo look saw as only close (often another color)
  // A named color: real matches the photo look dropped, maybe for showing another color variant on their first photo
  // (clothes come in many colors; owner, 2026-11-05). Their other photos get a look for the asked color below.
  const dropped = new Map();
  const dropIn = (head, keep) => { if (namedColor) for (const p of head) if (!keep(p) && p.match === "exact" && !offColor(p.product_title, context) && (p.product_small_image_urls?.string?.length ?? 0) > 1) dropped.set(keyOf(p), p); };
  const namedColor = namesLook(context);
  const lookRequest = { he: context, en: keywords, looks, terms: wordings, steady: !style };
  // A named color with fewer than 4 confirmed: the photo look checks the next candidates too, and those it sees in the right
  // color fill the card (one more call, only then): "שמלת ערב שחורה" came out with 3 dresses (owner, 2026-11-03).
  const moreInColor = async (candidates, have) => {
    const next = candidates.filter((p) => !have.some((h) => keyOf(h) === keyOf(p))).slice(0, STYLE_PHOTOS);
    const seen = next.length ? await look(lookRequest, next).catch(() => null) : null;
    for (const p of seen?.banner ?? []) banners.add(keyOf(p));
    const right = new Set((seen?.exact ?? []).map(keyOf)); // the right color only: "close" is often another color
    return next.filter((p) => right.has(keyOf(p))).slice(0, limit - have.length);
  };
  const styleable = shown.filter((p) => p.match === "exact" && !(rate(p) < STYLE_MIN_FEEDBACK));
  // A named color keeps 100: the look drops every other color, so a higher floor left "שמלה שחורה" with 3 dresses and the
  // weak-results note (owner's test, 2026-11-05).
  const floor = namedColor ? STYLE_MIN_SOLD : styleFloor(styleable);
  const styled = style && !cheapest && live && look ? rankProducts(styleable.filter((p) => Number(p.lastest_volume) >= floor)) : [];
  if (styled.length >= limit) {
    // Style items: 🥇 best seller, ✨ prettiest, 🥈 next seller, ✨ next prettiest… Plain-looking ones go last, never out.
    // As it was at 17:30 (owner, 2026-11-01: tonight's review order and color tags made the dress cards worse).
    const head = styled.slice(0, STYLE_PHOTOS);
    const seen = await look(lookRequest, head, { pick: Math.ceil((limit + extra) / 2) }).catch(() => null);
    const keys = (list) => new Set((list ?? []).map(keyOf));
    const ok = keys([...(seen?.exact ?? []), ...(seen?.near ?? []), ...(seen?.partial ?? [])]), plain = keys(seen?.plain), same = keys(seen?.same);
    for (const p of seen?.banner ?? []) banners.add(keyOf(p));
    // The same item from another listing (one POEDAGAR watch twice, 2026-11-01) is dropped like a photo that isn't the item.
    // A variant-confirmed one (the SKU API says it comes in the asked color) stays even if the photo look leaves it out:
    // "שמלת ערב סגולה" lost its one purple best seller that way, the look kept 11 of 12 (owner's /trace, 2026-11-06).
    const kept = head.filter((p) => (ok.has(keyOf(p)) && !same.has(keyOf(p))) || p.variant);
    trace.push(`מבט בתמונות: ${kept.length} מתוך ${head.length}${seen ? "" : " (לא ענה)"}`);
    if (seen) dropIn(head, (p) => ok.has(keyOf(p)) || same.has(keyOf(p)));
    if (kept.length) {
      const byKey = new Map(kept.map((p) => [keyOf(p), p]));
      const pretty = (seen.pretty ?? []).map((p) => byKey.get(keyOf(p))).filter((p) => p && !plain.has(keyOf(p)));
      const sellers = kept.filter((p) => !plain.has(keyOf(p)));
      // Taken in turn; an item already in (a best seller that is also among the prettiest) shows once, and its turn passes
      // to the next one of the same kind. When one kind runs out, the other fills the card.
      const mixed = [];
      const next = (list) => list.find((p) => !mixed.some((m) => keyOf(m) === keyOf(p)));
      for (let turn = 0; ; turn++) {
        const list = (turn % 2 ? [pretty, sellers] : [sellers, pretty]).find(next);
        if (!list) break;
        mixed.push(list === pretty ? { ...next(list), pretty: true } : next(list));
      }
      // A named color: products the photo look didn't see are left out (a light blue and an orange dress filled a black
      // dress card, 2026-11-01).
      const unseen = shown.filter((p) => !byKey.has(keyOf(p)) && !head.includes(p));
      // A named color: what the photo shows as only close (often another color) follows every right-color one.
      const photoClose = keys(seen?.partial);
      for (const k of photoClose) otherColor.add(k);
      const right = (list) => (namedColor ? [...list.filter((p) => !photoClose.has(keyOf(p))), ...list.filter((p) => photoClose.has(keyOf(p)))] : list);
      shown = [...right([...mixed, ...kept.filter((p) => plain.has(keyOf(p)))]), ...(namedColor ? [] : unseen)];
      if (namedColor && shown.length < limit) shown = shown.concat(await moreInColor(unseen, shown));
    }
  } else if (live && look && shown.length) {
    const head = shown.slice(0, limit + (namedColor ? COLOR_PHOTO_SPARE : PHOTO_SPARE));
    const seen = await look(lookRequest, head).catch(() => null);
    for (const p of seen?.banner ?? []) banners.add(keyOf(p));
    if (seen) {
      const ok = new Set((Array.isArray(seen) ? seen : [...(seen.exact ?? []), ...(seen.near ?? []), ...(seen.partial ?? [])]).map(keyOf));
      // What the photo shows as only close (a silver faucet for "שחור") follows the real matches (2026-11-01).
      const close = new Set((Array.isArray(seen) ? [] : [...(seen.near ?? []), ...(seen.partial ?? [])]).map(keyOf)); // near: one judge saw another shade
      for (const k of close) otherColor.add(k);
      // A fill item of another brand (a brand search with few items of the brand) stays: the photo look drops it for "not
      // Aruba", though both title judges called it the same kind of item (the AP22 card came out with 1 product, 2026-11-03).
      const kept = head.filter((p) => ok.has(keyOf(p)) || p.brandFill || p.variant); // variant-confirmed: see the style look
      trace.push(`מבט בתמונות: ${kept.length} מתוך ${head.length}`);
      dropIn(head, (p) => ok.has(keyOf(p)) || p.brandFill);
      const rest = shown.slice(head.length);
      if (kept.length) shown = [...kept.filter((p) => !close.has(keyOf(p))).map((p) => ({ ...p, looked: true })), ...kept.filter((p) => close.has(keyOf(p))).map((p) => ({ ...p, match: "partial", offColor: true, looked: true })), ...(namedColor ? [] : rest)];
      if (namedColor && shown.length < limit) shown = shown.concat((await moreInColor(rest, shown)).map((p) => ({ ...p, looked: true })));
    }
  }
  // A named color, a listing in several colors that include it, and the photo look saw another color: the listing's photo
  // in the asked color takes the card's place, with a note to pick that color on the product page (a 1,554-sold gown,
  // light blue on its 1st photo and black on its 6th, sat in a black dress card; owner, 2026-11-02). The photo shows the
  // requested item in the asked color, so it counts as an exact match and moves ahead of the other-color ones.
  if (namedColor && live && pickPhoto && !colorPooled && (otherColor.size || dropped.size)) {
    const isShown = (p) => shown.some((s) => keyOf(s) === keyOf(p));
    const back = [...dropped.values()].filter((p) => !isShown(p));
    const multi = [...shown.slice(0, limit + extra).filter((p) => otherColor.has(keyOf(p)) && inColors(p.product_title, context) && (p.product_small_image_urls?.string?.length ?? 0) > 1), ...back].slice(0, COLOR_PICK_MAX);
    const found = await photoInColor(multi, COLOR_PICK_MAX);
    const picked = new Map([...found].map(([k, f]) => [k, f.url]));
    // A dropped one seen in the asked color comes back; one with no such photo comes back only when its title names the
    // asked color among others, after the right-color ones, with a line saying it comes in that color too.
    shown = [...shown, ...back.filter((p) => picked.has(keyOf(p))).map((p) => ({ ...p, looked: true }))];
    const also = back.filter((p) => !picked.has(keyOf(p)) && inColors(p.product_title, context)).map((p) => ({ ...p, match: "partial", offColor: true, looked: true }));
    for (const p of also) otherColor.add(keyOf(p));
    shown = [...shown, ...also];
    if (picked.size) {
      shown = shown.map((p) => (picked.has(keyOf(p)) ? { ...p, product_main_image_url: picked.get(keyOf(p)), match: "exact", offColor: false, titleOff: false, colorPick: true, ...(found.get(keyOf(p)).variant ? { variant: found.get(keyOf(p)).variant } : {}) } : p));
      const off = (p) => otherColor.has(keyOf(p)) && !p.colorPick;
      // Back to its sales place among the right-color ones; a style card keeps its seller/✨ turns (orderCard ranks it).
      const place = new Map(ranked.map((p, i) => [keyOf(p), i]));
      const right = shown.filter((p) => !off(p));
      shown = [...(style ? right : right.sort((a, b) => place.get(keyOf(a)) - place.get(keyOf(b)))), ...shown.filter(off)];
    }
  }
  if (namedColor) shown = shown.map((p) => (p.offColor && !p.colorPick && inColors(p.product_title, context) ? { ...p, colorAlso: true } : p));
  // A photo that is mostly an ad ("CLEARANCE 70% OFF", "998000PA", 2026-11-01) gives way to the listing's next photo.
  shown = shown.map((p) => { const next = p.product_small_image_urls?.string?.[1]; return banners.has(keyOf(p)) && /^https:\/\//.test(next ?? "") ? { ...p, product_main_image_url: next } : p; });
  // A swapped photo (ad banner, asked color) can match another listing's: two listings of one ring light, banners on
  // their first photos, showed the same second photo in one card (owner's test, 2026-11-02). Checked again only then.
  if (hash && (banners.size || shown.some((p) => p.colorPick))) shown = await dedupeByPhoto(shown, hash);
  shown = sellerFirst(shown, limit); // one moved up when the photo check dropped the leader
  // A fake that would have led was moved down: every returned product carries it, so the card (and "עוד") can say why.
  const out = shown.slice(0, limit + extra);
  const moved = ranked.find((p) => p.fakeMoved);
  trace.push(`בכרטיס: ${Math.min(limit, out.length)} (${out.slice(0, limit).map((p) => `${p.colorPick ? (p.variant ? "🧬" : "📷") : ""}${Number(p.lastest_volume) || 0}`).join(" / ")})`);
  return Object.assign(moved ? out.map((p) => ({ ...p, fakesSkipped: fakeExample(moved.product_title) })) : out, { trace });
}

// The card's final order, once names and stars are in (the bot and the search-quality check share it).
// A color search: in each card the medals (🥇🥈🥉) go to the right-color best sellers in sales order, ✨ and 🏷️ keep their
// places (owner, 2026-11-05: a 1,100-sold Choice dress was 🥇 over 2,500 and 2,400 sold ones, by the Choice boost).
export function medalsBySales(found, limit) {
  const medal = (p) => !p.pretty && !p.brandSlot && !p.offColor && !p.titleOff;
  const out = [...found];
  for (let start = 0; start < out.length; start += limit) {
    const at = out.slice(start, start + limit).map((p, i) => (medal(p) ? start + i : -1)).filter((i) => i >= 0);
    const sorted = at.map((i) => out[i]).sort((a, b) => (Number(b.lastest_volume) || 0) - (Number(a.lastest_volume) || 0));
    at.forEach((i, k) => (out[i] = sorted[k]));
  }
  return out;
}

export function orderCard(found, { context, style = false, cheapest = false, limit }) {
  const byColor = !cheapest && namesLook(context);
  // Same model in another color or listing gets the same name or model (KZ EDX Pro X, Lenovo LP40 Pro twice): with
  // enough results, keep the first. With few results a second seller of the same model stays (see pickProducts).
  const key = (name) => modelKey(name, context, { plainNames: style });
  // The same plain name and nearly the same review count is one product in two listings (two "מטען קיר GaN", 4,926 and
  // 4,920 reviews, 2026-11-02): AliExpress shares reviews between linked listings.
  const twin = (p, q) => p.short_he === q.short_he && p.reviewCount >= 100 && Math.abs(p.reviewCount - q.reviewCount) <= p.reviewCount * 0.01;
  if (found.length > limit) found = found.filter((p, i) => !p.short_he || found.findIndex((q) => q === p || (q.short_he && (sameModel(key(q.short_he), key(p.short_he)) || twin(p, q)))) === i);
  found = sameReviews(found);
  const counted = found.some((p) => p.reviewCount);
  // ✨ only for well-reviewed products (owner's spec): a pretty pick with few reviews is an ordinary product. Style searches
  // too: white sneakers with 3 reviews got "✨ מהיפים ביותר" (live test, 2026-11-02).
  if (counted) found = found.map((p) => (p.pretty && !(p.reviewCount >= 20 && p.avgStars >= 4.5) ? { ...p, pretty: false } : p));
  if (style) {
    // Style searches as at 17:30: best sellers and ✨ in turn, no review order. But 🥇 is a proven seller when the card has
    // one (owner, 2026-11-02): a black evening dress with 4 reviews and 13 sold led the card.
    // Strong sellers first, across the card and its "עוד" pages: the "עוד" page of "שמלת ערב שחורה" held dresses with
    // 1,900 and 1,100 sold and 100-200 reviews (the AI called them "close") while the first card showed 6-79 sold
    // (owner, 2026-11-02: "the more-results ones are much better"). A product shown in another color stays out of this.
    // Then the decent ones (50+ sold, 10+ reviews), most sold first, before barely-sold ones: a 510-sold, 96-review club
    // dress the photo look called "close" sat on the "עוד" page behind a 79-sold, 5-review one (owner, 2026-11-02).
    const rated = (p, n) => (p.reviewCount ? p.reviewCount >= n && p.avgStars >= 4.5 : !(parseFloat(p.evaluate_rate) < TRUSTED_FEEDBACK));
    const sold = (p) => Number(p.lastest_volume) || 0;
    const strong = (p) => !p.offColor && !p.titleOff && sold(p) >= STYLE_MIN_SOLD && rated(p, STRONG_REVIEWS); // titleOff: another color, or a baby item for a child
    const decent = (p) => !strong(p) && !p.titleOff && sold(p) >= PROVEN_SALES && rated(p, DECENT_REVIEWS);
    // A decent one the photo look called only "close" (maybe another shade) follows the decent right-looking ones.
    const bySold = (list) => list.sort((a, b) => sold(b) - sold(a));
    const ok = found.filter(decent);
    found = [...found.filter(strong), ...bySold(ok.filter((p) => !p.offColor)), ...bySold(ok.filter((p) => p.offColor)), ...found.filter((p) => !strong(p) && !decent(p))];
    found = varied(found, context, limit);
    const proven = (p) => Number(p.lastest_volume) >= PROVEN_SALES && !(parseFloat(p.evaluate_rate) < TRUSTED_FEEDBACK);
    const lead = found.slice(0, limit).findIndex(proven);
    if (lead > 0 && !proven(found[0])) found.unshift(...found.splice(lead, 1));
    return byColor ? medalsBySales(found, limit) : found;
  }
  // Only what the photo look saw can rise into the card: the review order pulled unseen ones up (a polka-dot green dress
  // titled "black", a steel faucet for "שחור", 2026-11-01). "הכי זול" stays cheapest first.
  const order = (list) => trustedFirst(list, { bySales: !style, look: namesLook(context) });
  if (!cheapest) found = found.some((p) => p.looked) ? [...order(found.filter((p) => p.looked)), ...order(found.filter((p) => !p.looked))] : order(found);
  found = varied(found, context, limit);
  // One brand slot per card (🏷️ second): the sales order can bring the next card's brand item up (two 🏷️ in one card,
  // Kemei and ENCHEN, 2026-11-01), so a second one in a card shows as an ordinary product; the first moves back second.
  found = found.map((p, i) => (p.brandSlot && found.findIndex((q, j) => q.brandSlot && Math.floor(j / limit) === Math.floor(i / limit)) !== i ? { ...p, brandSlot: false } : p));
  const b = found.findIndex((p) => p.brandSlot);
  if (b > 1 && b < limit) found.splice(1, 0, ...found.splice(b, 1));
  found = sellerFirst(found, limit, { strip: !style && !cheapest && counted });
  return byColor ? medalsBySales(found, limit) : found;
}

// Live checks for /status: one fresh AI call and one AliExpress search.
async function liveHealthChecks() {
  const lines = [];
  let t = Date.now();
  const intent = await createUnderstander()("אושניות");
  lines.push(intent ? `AI: ✅ (${Date.now() - t} ms, "${intent.corrected_he}")` : "AI: ❌ (בדקו OPENAI_API_KEY או את המודל)");
  const claude = await claudeCheck();
  lines.push(claude ? `Claude (גיבוי + שופט שני): ${claude}` : "Claude: כבוי (אין ANTHROPIC_API_KEY)");
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
  look = (request, products, opts = {}) => filterRelevant(request, products, { photos: true, ...opts }),
  pickPhoto = pickColorPhotos,
  skus = skuDetails,
  advise = nextAdvice,
  explain = explainFit,
  title = shortTitles,
  collage = makeCollage,
  shorten = (products) => shortenLinks(products), // only the products a card shows get short links
  stars = (products) => addStars(products), // real stars and review counts for the products found (tests: none)
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
  // The bot lives in OUR group only (owner request). Other groups are ignored completely. In private only the owner is
  // served (to try searches without the group seeing, 2026-11-01); everyone else gets /myid and an invitation to the group.
  const isOwner = (ctx) => Boolean(adminId) && String(ctx.from?.id) === String(adminId);
  let traceOn = false;
  bot.use(async (ctx, next) => {
    const type = ctx.chat?.type;
    if (type === "group" || type === "supergroup") return groupId == null || String(ctx.chat.id) === String(groupId) ? next() : undefined;
    if (type !== "private" || privateChat || isOwner(ctx)) return next();
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
  const resultsCache = new Map(); // same search within 24 h -> same products, no AI or AliExpress cost (same in-memory shortcut)
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
    // A trailing "?", "!" or emoji isn't part of the item ("מקרן?" read and paid for apart from "מקרן", text audit 2026-11-06).
    const query = rawQuery.replace(/(?:[\s?!.,;:…\uFE0F]|\p{Extended_Pictographic})+$/u, "").trim() || rawQuery.trim();
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
      let intent = await understand(query).catch(() => null); // null = AI unavailable: search the raw query
      // An explicit search of 2+ words gets a second look before "לא הבנתי": "מוט פינוק לאינטרפול 4 דרך" is Israeli slang for
      // a rain shower system (owner, 2026-11-03). One more AI call (≈0.15¢), only on these rare searches.
      if (intent?.status === "not_product" && /\S\s+\S/.test(query)) intent = (await understand(query, { retry: true }).catch(() => null)) ?? intent;
      if (intent?.status === "not_product") return reply(ctx, NOT_PRODUCT);
      if (isBlocked(intent, query)) return reply(ctx, NOT_ALLOWED); // natural requests and bare names stay silent (status isn't "ok")
      if (intent?.status === "clarify") return askClarify(ctx, query, intent);
      const big = bigItem(intent?.corrected_he || query);
      if (big) return showQuestion(ctx, Object.assign(newSession(ctx, query, null, null, intent?.keywords_en ?? null), { direct: true }), big.question, big.options);
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
        style: intent?.style ?? false,
        brands: intent?.brands_en ?? [],
        cheapest: CHEAPEST.test(query),
        header: headerOf(intent?.corrected_he, query),
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
      showResults(ctx, { keywords: intent.keywords_en, fallback: intent.fallback_en, alt: intent.alt_en ?? null, looks: intent.looks_like ?? null, terms: intent.terms_en ?? [], style: intent.style ?? false, brands: intent.brands_en ?? [], cheapest: CHEAPEST.test(text), header: headerOf(intent.corrected_he, text), maxPriceIls: intent.max_price_ils ?? null, minPriceIls: intent.min_price_ils ?? intent.floor_price_ils ?? null, floorOnly: Boolean(!intent.min_price_ils && intent.floor_price_ils), brandOnly: intent.brand || false, category: intent.category_id ?? null, replyToId: ctx.msg.message_id }),
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

  async function sendResults(ctx, { keywords, fallback, alt = null, terms = [], looks = null, style = false, brands = [], cheapest = false, header: rawHeader, context = cardTitle(rawHeader), maxPriceIls, minPriceIls, floorOnly = false, brandOnly = false, category = null, replyToId, advice = null }) {
    const limit = ctx.chat.type === "private" ? PRIVATE_RESULTS : GROUP_RESULTS;
    const header = cardTitle(rawHeader);
    stats.count("search");
    let found;
    let trace = ["מהזיכרון (אותו חיפוש ב-24 השעות האחרונות)"];
    try {
      const key = JSON.stringify([keywords, fallback, category, maxPriceIls, minPriceIls, brandOnly, cheapest, limit]);
      const hit = resultsCache.get(key);
      if (hit && now() - hit.at < RESULTS_TTL_MS) {
        found = hit.found;
        stats.count("cached");
      } else {
        // The self-check's second reading tells the AI what the first one searched (cached like any reading).
        const reread = (words) => understand(rawHeader, { wrong: words }).then((i) => (i?.status === "ok" ? { keywords: i.keywords_en, alt: i.alt_en ?? null, terms: i.terms_en ?? [], fallback: i.fallback_en, looks: i.looks_like ?? null } : null));
        const pick = (min) => pickProducts({ search, relevant, look, live: live ?? !isMockMode(), hash, pickPhoto, skus }, { keywords, fallback, alt, terms, category, looks, context, maxPriceIls, minPriceIls: min, brandOnly, cheapest, style, brands, limit, extra: limit * MORE_PAGES, reread });
        found = await pick(minPriceIls);
        if (!found.length && floorOnly) found = await pick(null); // the AI's price floor found nothing: better cheaper than empty
        trace = found.trace ?? null;
        // Short links and short Hebrew names together (parallel, no extra wait); names cover the "עוד" pages too.
        const [linked, names, rated] = await Promise.all([shorten(found).catch(() => found), title(context, found).catch(() => null), stars(found).catch(() => null)]);
        found = linked.map((p, i) => ({ ...p, ...(names?.[i] ? { short_he: names[i] } : {}), ...(rated?.[i]?.reviewCount ? { avgStars: rated[i].avgStars, reviewCount: rated[i].reviewCount } : {}) }));
        found = orderCard(found, { context, style, cheapest, limit });
        const over = found.filter((p) => p.overBudget); // one over-budget product per card: the others wait for "עוד"
        if (over.length > 1) found = [...found.filter((p) => !p.overBudget || p === over[0]), ...over.slice(1)];
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
    const sent = await sendCard(ctx, shown, { header, replyToId, reasons, rest: found.slice(limit), style });
    // The owner, in a private chat, also gets how the card was made (one short line per step), to see where products drop.
    if (traceOn && isOwner(ctx) && ctx.chat.type === "private" && trace?.length) await ctx.reply(`🔧 ${trace.join("\n")}`).catch(() => {});
    return sent;
  }

  // Photo card (collage), then 🎯/🐼 side by side and "לחפש עוד?" below them (always shown, owner request).
  async function sendCard(ctx, shown, { header, replyToId, reasons = null, rest = [], style = false }) {
    for (const [key, c] of cards) if (now() - c.at > CARD_TTL_MS) cards.delete(key);
    if (cards.size >= CARDS_MAX) cards.delete(cards.keys().next().value);
    const id = (++cardSeq).toString(36);
    // What the card showed, so a 🐼 report says what went wrong, not only what was asked.
    const shownText = shown.map((p) => `${p.short_he || shortTitle(p.product_title)} (${soldText(p.lastest_volume) ?? 0} נמכרו)`).join(" · ");
    cards.set(id, { userId: requester(ctx), header, replyToId, rest, voters: new Set(), at: now(), shownText, style });
    // e.g. a brand AliExpress doesn't carry. Style items: "close" is usually another cut of the same thing (a maxi for an
    // evening dress), so the note is only for a card that is all another color.
    const closest = style ? shown.every((p) => p.offColor) : !shown.some((p) => p.match !== "partial");
    // Half the card barely sold counts too (Tesla mats sold 7 and 4 under a 1,640-sold one, juicers 17-76; owner's test,
    // 2026-11-04); style cards often sell little and have their own order.
    const few = shown.filter((p) => (Number(p.lastest_volume) || 0) < WEAK_SOLD).length;
    // Fewer than 4 is weak only with a barely-sold one among them: three 10,000-sold pink earbuds got "few products sell"
    // (owner's test, 2026-11-06).
    const weak = (shown.length < GROUP_RESULTS && few > 0) || Math.max(0, ...shown.map((p) => Number(p.lastest_volume) || 0)) < WEAK_SOLD || (!style && few * 2 >= shown.length);
    if (weak) stats.remember("weak", `${header} (${shown.map((p) => soldText(p.lastest_volume) ?? 0).join(" / ")})`);
    const { caption, count } = formatCard(shown, { query: header, demo: isMockMode(), reasons, closest, rare: closest && shown.length + rest.length <= 2, weak, fakes: shown.find((p) => p.fakesSkipped)?.fakesSkipped ?? false });
    if (count < shown.length) cards.get(id)?.rest.unshift(...shown.slice(count)), (shown = shown.slice(0, count)); // the collage shows what the caption lists; the rest waits for "עוד"
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

  // The buttons are checked on AliExpress first (checkOptions); "back" shows the already checked ones again.
  async function showQuestion(ctx, session, question, options, { edit = false, check = !session.direct } = {}) {
    if (check && (live ?? !isMockMode())) options = await checkOptions(search, options, { minIls: session.minPriceIls, maxIls: session.maxPriceIls });
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
    // The white-or-boys question is the only one: the answer makes the search clear, no advisor round after it.
    const session = Object.assign(newSession(ctx, query, intent.max_price_ils, intent.min_price_ils, intent.keywords_en || null), whiteOrKids(intent.corrected_he) ? { direct: true } : {});
    return showQuestion(ctx, session, intent.clarify_question_he, intent.options);
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
    if (!session.direct && session.history.length < MAX_QUESTIONS) {
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
    // White or for boys/girls, answered: the judges get the plain meaning, not the ambiguous word ("👦 לבנים" kept 0 of 6
    // kids' slides: they read white; owner's test, 2026-11-06).
    const who = whiteOrKids(session.request), pick = session.history[0]?.a ?? "";
    const plainRequest = who && pick ? session.request.replace(/(לבנות|לבנים)(?=[\s.!?]*$)/, /⚪/.test(pick) ? "בצבע לבן" : /👦/.test(pick) ? "לילדים בנים" : "לילדות") : null;
    const context = plainRequest ?? (advice ? `${session.request} (${session.history.map((h) => h.a).join(", ")})` : session.request);
    return withTyping(ctx, async () => {
      // The full understanding of what was chosen (sellers' wordings, the look), as every direct search gets; the advisor's
      // own words stay the main search.
      const more = advice ? await understand(header).catch(() => null) : null;
      const extra = more?.status === "ok" ? { alt: more.keywords_en, terms: more.terms_en ?? [], looks: more.looks_like ?? null, category: more.category_id ?? null, style: more.style ?? false, brands: more.brands_en ?? [] } : {};
      return showResults(ctx, { keywords: session.keywords ?? session.request, fallback: session.broad, header, context, maxPriceIls: session.maxPriceIls, minPriceIls: session.minPriceIls, replyToId: session.replyToId, advice, ...extra });
    });
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
  // The owner, in private: post the welcome to the group, remove the old pins, pin it (owner, 2026-11-04). Needs the bot's
  // "pin messages" right in the group.
  bot.command("pin_welcome", async (ctx) => {
    if (ctx.chat.type !== "private" || !adminId || String(ctx.from.id) !== String(adminId) || !groupId) return;
    const extra = { parse_mode: "HTML", link_preview_options: { is_disabled: true } };
    try {
      // Already pinned by the bot: edited in place, no new message or pin (owner, 2026-11-04).
      const pinned = (await ctx.api.getChat(groupId).catch(() => null))?.pinned_message;
      if (pinned?.from?.id === ctx.me.id) {
        await ctx.api.editMessageText(groupId, pinned.message_id, WELCOME_PIN, extra).catch((e) => {
          if (!/not modified/i.test(e.description ?? e.message)) throw e;
        });
        return ctx.reply("✅ הודעת הפתיחה המוצמדת עודכנה.");
      }
      const msg = await ctx.api.sendMessage(groupId, WELCOME_PIN, extra);
      await ctx.api.unpinAllChatMessages(groupId);
      await ctx.api.pinChatMessage(groupId, msg.message_id, { disable_notification: true });
      return ctx.reply("✅ הודעת הפתיחה נשלחה לקבוצה והוצמדה. ההצמדות הישנות בוטלו.");
    } catch (e) {
      return ctx.reply(`😕 לא הצלחתי: ${esc(e.description ?? e.message)}. בדקו שלבוט יש הרשאת "הצמדת הודעות" בקבוצה.`);
    }
  });

  // /trace (owner, private): turns the "how the card was made" line under his searches on or off. Off after a restart.
  bot.command("trace", async (ctx) => {
    if (ctx.chat.type !== "private" || !adminId || String(ctx.from.id) !== String(adminId)) return;
    traceOn = !traceOn;
    await ctx.reply(traceOn ? "🔧 אבחון פועל: מתחת לכל חיפוש שלך תופיע שורה שמראה איך נבנה הכרטיס. /trace שוב כדי לכבות." : "🔧 אבחון כבוי.");
  });

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
        return await showQuestion(ctx, session, prev.question, prev.options, { edit: true, check: false });
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
    return withTyping(ctx, () => sendCard(ctx, next, { header: card.header, replyToId: card.replyToId, rest: card.rest, style: card.style }));
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
    const text = normalizeText(ctx.msg.text); // one form for the ways the same request is typed (see format.js)
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
    // A reply to your own search adds to it ("חפש לי מתקן לכוסות חד פעמי" + "לתליה על הקיר"): the two are searched
    // together (owner, 2026-11-05, seen in another deals bot). Thanks and chatter stay conversation.
    const own = ctx.msg.reply_to_message;
    const before = own && own.from?.id === ctx.from?.id && typeof own.text === "string" ? (parseTrigger(normalizeText(own.text), username) ?? (isPrivate ? normalizeText(own.text) : null)) : null;
    if (before && text.length <= REFINE_MAX && !NOT_REFINE.test(text.trim())) return runSearch(ctx, `${before} ${text.trim()}`);
    if (isPrivate) return runSearch(ctx, text);
    if (isSoftRequest(text)) return runSoftSearch(ctx, text);
    if (startsWithSearchVerb(text)) return runSoftSearch(ctx, text, { warn: false }); // "חפש מטען": searched if the AI sees a product
    // Other replies are conversation (a reply with "חפש לי" or a natural request was already handled above); shared links are deals.
    if (ctx.msg.reply_to_message || LINKISH.test(text) || text.length > SOFT_MAX_LENGTH) return;
    return guideOrWarn(ctx);
  });

  bot.catch((err) => console.error(`update ${err.ctx.update.update_id} failed: ${err.error?.message ?? err.error}`));
  return bot;
}
