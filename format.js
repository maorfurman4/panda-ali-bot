// Hebrew message texts and formatting (HTML parse mode).
// Every line starts with RLM so lines that begin with a digit, a price or a Latin brand still render right-to-left.
export const RLM = "‏";
const MIN_FEEDBACK = 90;
const TITLE_MAX = 40; // photo captions are only as wide as the photo
const QUERY_MAX = 80; // the header lists every advisor choice
// Seller filler at the start of machine-translated titles ("2022 חדש", "NEW", "1 יחידה").
const TITLE_JUNK = /^(?:(?:20\d\d|new|חדש(?:ה|ים|ות)?|hot|1\s*(?:יחידה|יחידות|pcs?)|מקורי(?:ת)?|לשנת)[\s,:-]*)+/i;
// Also drops a leading "–" and seller coupon codes ("(קוד קופון: HOT888)"), which we can't verify.
const cleanTitle = (title) =>
  oneLine(title).replace(/\([^)]*(?:קופון|coupon|code)[^)]*\)/gi, "").trim().replace(TITLE_JUNK, "").replace(/^[\s\-–—|,.:;*•]+/, "");
const CAPTION_MAX = 1024; // Telegram photo caption limit, counted after HTML parsing
const MEDALS = ["🥇", "🥈", "🥉", "4️⃣", "5️⃣"];
const GROUP_URL = process.env.GROUP_URL || "https://t.me/panda_deals_il"; // shown under "🐼 פנדה אקספרס" at the end of each result

export const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const rtl = (lines) => lines.map((l) => RLM + l).join("\n");
const oneLine = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const clip = (s, max) => ([...s].length > max ? [...s].slice(0, max - 1).join("") + "…" : s);

// Length as Telegram counts it: text after HTML parsing, in UTF-16 code units.
export const parsedLength = (html) =>
  html.replace(/<[^>]*>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&").length;

// evaluate_rate is the positive-feedback percentage as a string, e.g. "96.5%". It is NOT a star rating.
export function parseEvaluateRate(value) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const m = String(value).trim().match(/^(\d+(?:\.\d+)?)%?$/);
  const n = m ? Number(m[1]) : NaN;
  return n >= 0 && n <= 100 ? n : null;
}

// Best first: recent sales (log scale) weighted by positive feedback; ties keep the API order.
// AliExpress Choice items come from this one store in the API ("Stone's Store"; the item page says "Choice · AliExpress
// commitment": fast delivery, free returns, refund if late; checked 2026-11-01). They get a small push (≈1.5× the sales).
export const CHOICE_SHOP_ID = "1103573332";
export const isChoice = (p) => String(p.shop_id ?? "") === CHOICE_SHOP_ID;
export function rankProducts(products) {
  const score = (p) => Math.log10((Number(p.lastest_volume) || 0) + 1) * ((parseEvaluateRate(p.evaluate_rate) ?? 90) / 100) * (isChoice(p) ? 1.05 : 1);
  return products.map((p, i) => ({ p, i, s: score(p) })).sort((a, b) => b.s - a.s || a.i - b.i).map((x) => x.p);
}

// The same product from several sellers counts once (the first, i.e. best-ranked, stays). Three keys: brand + model
// ("BINNUNE BW06", "Lenovo GM2"), the start of the normalized title, and one store's listings with the same sales count
// (a straw bag listed twice by one store, 2,835 sold each, 2026-11-01). From 300 sold: two different items of one store
// share a small count (52 and 52 seen).
const TWIN_MIN_SOLD = 300;
export function dedupeProducts(products) {
  const seen = new Set();
  return products.filter((p) => {
    const t = cleanTitle(p.product_title).toLowerCase(); // "2025 – מגפי…" and "2026 – מגפי…" are the same product
    const model = t.match(/\b[a-z]{3,}\s+(?:[a-z]+\d|\d+[a-z])[a-z0-9]*\b/)?.[0];
    const twin = p.shop_id && Number(p.lastest_volume) >= TWIN_MIN_SOLD && `s:${p.shop_id}:${p.lastest_volume}`;
    const keys = [model && `m:${model}`, `t:${t.replace(/[^\p{L}\p{N}]+/gu, "").slice(0, 24)}`, twin].filter(Boolean);
    if (keys.some((k) => seen.has(k))) return false;
    keys.forEach((k) => seen.add(k));
    return true;
  });
}

// A spare part / accessory FOR the item rather than the item (robot vacuum bags and brushes), unless parts were asked for.
const PART_REQUEST = /חלק|חילוף|אביזר|מברש|שקי|מסנן|פילטר|רפיד|מטלי|filter|brush|bag|spare|replacement|accessor/i;
const PART_TITLE = /(?:חלקי|חלק) חילוף|חלופי|spare parts?|replacement|אביזר\S*\s+ל|^(?:ל|עבור\s)|^(?:מברשת|מברשות|שקית|שקיות|מסנן|מסננים|פילטר|רפידות|מטלית|מטליות)\s/i;
// A title that STARTS with a part/accessory word ("כבל מקלדת", "סוללת קטנוע", "משענות יד") is a part, unless the request
// itself names that word ("כיסוי לאייפון" still finds covers, "מטען" still finds chargers). Matched by a 3-letter stem.
const PART_FIRST_WORDS = /^(?:סוללת|סוללה|סוללות|כבל|כבלי|מעמד|משענת|משענות|גלגל|גלגלים|צמיג|צמיגים|מטען|כיסוי|כיסויים|מגן|מגני|רצועה|רצועת|תושבת|ידית|הרמת|מתאם)$/;
const BUNDLE_PREFIX = /^(?:סט(?: של)?\s*\d*|\d+\s*(?:יחידות|יח'|pcs)|זוג)\s+/i;
// The same model under two names ("Lenovo LP40 Pro אוזניות TWS" and "Lenovo LP40 Pro אוזניות", 2026-11-01): the first
// run of Latin words that holds a model number (brand + model), else the whole name.
// A run without a digit counts when it starts with a capitalized brand ("KZ EDX Pro X"), not a spec ("USB C", "Type C").
// Version words at the end are dropped, so "KZ EDX Pro X" and "KZ EDX Pro" are one model (2026-11-01).
const SPEC_WORDS = /^(?:usb|led|rgb|tws|pd|qc|hd|uv|dc|ac|gan|anc|type|ipx\d*)$/i;
const VERSION_WORDS = /^(?:x|s|pro|max|plus|lite|se|mini|ultra|\+)$/i;
export function modelKey(name = "") {
  const runs = name.match(/[A-Za-z0-9][\w.-]*(?:\s+[A-Za-z0-9][\w.-]*)*/g) ?? [];
  const brandLed = (run) => { const [first, ...rest] = run.split(/\s+/); return rest.length > 0 && /^[A-Z][A-Za-z]+$/.test(first) && !SPEC_WORDS.test(first); };
  const model = runs.find((run) => /[a-z]/i.test(run) && (/\d/.test(run) || brandLed(run)));
  if (!model) return name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  const words = model.split(/\s+/);
  while (words.length > 2 && VERSION_WORDS.test(words.at(-1))) words.pop();
  return words.join("").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

// A card holds at most 2 near-identical items (3 motion-sensor night lights of 4, 2026-11-01); the third waits for the
// next card. Alike = a shared word (3-letter stem) beyond the request's own words: four "צעיף מרובע" in one card
// shared only "מרובע" (2026-11-01).
const STOP_WORDS = new Set(["עם", "של", "לכל", "for", "and", "wit"]);
export function varied(products, request = "", limit = 4) {
  const stem = (w) => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "").slice(0, 3);
  const asked = new Set(request.split(/\s+/).map(stem));
  const words = (p) => new Set((p.short_he ?? "").split(/\s+/).map(stem).filter((s) => s.length === 3 && !STOP_WORDS.has(s) && !asked.has(s)));
  const alike = (a, b) => [...a].some((w) => b.has(w));
  const rest = products.map((p) => ({ p, w: words(p) }));
  const out = [];
  while (rest.length) {
    const card = [];
    for (let i = 0; i < rest.length && card.length < limit; ) {
      if (card.filter((c) => alike(c.w, rest[i].w)).length >= 2) i++;
      else card.push(...rest.splice(i, 1));
    }
    while (card.length < limit && rest.length) card.push(rest.shift()); // only alike ones left: better than a short card
    out.push(...card.map((c) => c.p));
  }
  return out;
}

// Holiday-themed items the AI sometimes keeps as "close" (Halloween and Snoopy covers for "כרית נוי לסלון", 2026-11-01):
// left out unless the request names a holiday.
const HOLIDAY = /halloween|ליל כל הקדושים|האלווין|הלווין|christmas|xmas|חג המולד|כריסמס|סנטה|santa|easter|פסחא|thanksgiving/i;
export const offTheme = (title, request = "") => HOLIDAY.test(title ?? "") && !HOLIDAY.test(request);

// Specialized kinds a general request doesn't mean; the AI still called gaming mice exact for "עכבר אלחוטי" (2026-11-01),
// so the code moves them to "close" unless the request names the kind.
// 2026-11-01 (30 general searches): cycling bottles, camping and tamagoyaki pans, a citronella candle, DIY sticker clocks,
// party tablecloths and whiskey glasses came in as "exact" too.
const SPECIAL_KINDS = [
  /gaming|gamer|e-?sports|גיימינג|גיימר|(?:מקלדת|מקלדות|עכבר|אוזניות|כיסא)[^,]{0,25}?\s(?:ל)?משחק/i,
  /shower speaker|(?:רמקול|speaker)[^,]{0,25}(?:מקלחת|אמבטיה|shower)/i, // a speaker only: towels say "אמבטיה" too
  /hydroponic|הידרופוני/i,
  /keffiyeh|kufiya|כאפי|קפיה/i,
  /tesla|טסלה/i,
  /cycling|bicycle|\bbike\b|אופניים|רכיבה על אופניים/i,
  /camping|מחנאות|קמפינג|קמפינג/i,
  /tamagoyaki|טמאגויאקי/i,
  /citronella|mosquito|ציטרונלה|יתושים/i,
  /\bdiy\b|עשה זאת בעצמך/i,
  /disposable|חד[ -]?פעמי|למסיבה|לקישוט חתונה/i,
  /whisk(?:e)?y|ויסקי|כוסות שוט|shot glass/i,
  /measuring|כוס מדידה|כלי מדידה/i,
  /personali[sz]ed|custom photo|your (?:own )?photo|(?:תמונה|פוסטר|הדפס|קנבס|כרית|ציפית|ספל)[^,]{0,20}בהתאמה אישית/i,
];
export const specialKind = (title, request = "") => SPECIAL_KINDS.some((k) => k.test(title ?? "") && !k.test(request));

// Luxury brands AliExpress sells only as fakes (a ₪127 "Diptyque" candle, 2026-11-01): left out unless the shopper names
// the brand (then the search handles it as a brand request).
const LUXURY = /diptyque|דיפיקס|dior|דיור|chanel|שאנל|gucci|גוצ'י|louis vuitton|לואי ויטון|herm[eè]s|הרמס|prada|פראדה|rolex|רולקס|cartier|קרטייה|versace|ורסצ'ה|balenciaga|ysl|yves saint|burberry|ברברי|fendi|tiffany|טיפאני|jo malone|ג'ו מלון/i;
export const fakeLuxury = (title, request = "") => LUXURY.test(title ?? "") && !LUXURY.test(request);

// Items mostly sold as their cover: for "כרית נוי" a cushion cover IS the item (45x45 covers were dropped, 2026-11-01).
const SOLD_AS_COVER = /^(?:כיסוי|כיסויי|ציפית|ציפיות)\s+ל?(כרית|כריות|שמיכ|פוך|דובה)/;
export function isPartFor(title, request = "") {
  if (PART_REQUEST.test(request)) return false;
  const t = cleanTitle(title);
  if (PART_TITLE.test(t)) return true;
  const cover = t.replace(BUNDLE_PREFIX, "").match(SOLD_AS_COVER);
  if (cover && request.includes(cover[1].slice(0, 3))) return false;
  const first = t.replace(BUNDLE_PREFIX, "").split(/[\s,]/)[0];
  return PART_FIRST_WORDS.test(first) && !request.includes(first.slice(0, 4)); // 4 letters: "כיסוי" isn't "כיסא"
}

export function filterProducts(products) {
  return products.filter((p) => {
    const rate = parseEvaluateRate(p.evaluate_rate);
    return rate === null || rate >= MIN_FEEDBACK;
  });
}

export function formatPrice(value, currency) {
  const n = Number(value);
  if (value == null || value === "" || !Number.isFinite(n)) return null;
  return currency === "ILS" ? `₪${n.toFixed(2)}` : `${currency ?? ""} ${n.toFixed(2)}`.trim();
}

// The title's first clause without seller filler, one line, cut at a word boundary so brand/model words stay intact.
export function shortTitle(title) {
  const full = cleanTitle(title);
  const first = full.split(/\s*[,،|;]\s*|\s+[-–]\s+/)[0];
  const t = [...first].length >= 12 ? first : full; // a too-short first clause ("נעלי נשים") says too little
  if ([...t].length <= TITLE_MAX) return t;
  let out = "";
  for (const word of t.split(" ")) {
    const next = out ? `${out} ${word}` : word;
    if ([...next].length > TITLE_MAX - 1) break;
    out = next;
  }
  return (out || [...t].slice(0, TITLE_MAX - 1).join("")) + "…";
}

// Exact below 100; from 100, rounded down to 2 significant digits after "מעל" (a trailing "+" flips to the left in RTL).
export function soldText(volume) {
  const n = Math.floor(Number(volume));
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n < 100) return String(n);
  const step = 10 ** (String(n).length - 2);
  return `מעל ${(Math.floor(n / step) * step).toLocaleString("en-US")}`;
}

// Stars + review count (future DS API data) first, else the positive-feedback %, else nothing. Never shows 0.
export function ratingText(p) {
  const stars = Number(p.avgStars);
  const reviews = Math.round(Number(p.reviewCount));
  if (stars > 0 && reviews > 0) return `⭐ דירוג: ${stars.toFixed(1)} (${reviews.toLocaleString("en-US")} ביקורות)`;
  const rate = parseEvaluateRate(p.evaluate_rate);
  return rate > 0 ? `👍 משוב חיובי: ${Math.round(rate)}%` : null;
}

const salePrice = (p) => formatPrice(p.target_sale_price ?? p.sale_price, p.target_sale_price_currency ?? p.sale_price_currency);

// from: the search price is the cheapest variant (a ₪15.59 rug is the 60 cm one, 2026-11-01), so the card says "החל מ".
export function priceLine(p, { from = false } = {}) {
  const price = salePrice(p);
  return price ? `💰 מחיר: ${from ? "החל מ-" : ""}<b>${esc(price)}</b>` : null;
}

// Original price + 🔥 badge only for 5% ≤ discount < 80% (higher means an inflated "original").
export function discountLine(p) {
  const s = Number(p.target_sale_price ?? p.sale_price);
  const original = p.target_original_price ?? p.original_price;
  const o = Number(original);
  if (!(s > 0 && o > s)) return null;
  const discount = Math.round((1 - s / o) * 100);
  if (discount < 5 || discount >= 80) return null;
  return `🏷️ במקום <s>${esc(formatPrice(original, p.target_sale_price_currency ?? p.sale_price_currency))}</s> · ${discount}% הנחה 🔥`;
}

export const CLOSEST_NOTE = "לא מצאתי התאמה מדויקת, אלה הכי קרובים 👇";
// Almost nothing found (real wall mirrors: only acrylic stickers, 2026-11-01): AliExpress often doesn't ship it to Israel.
export const RARE_NOTE = "לא מצאתי התאמה מדויקת (ייתכן שעלי אקספרס לא שולחת את זה לישראל), אלה הכי קרובים 👇";

// Israel: personal imports above $75 pay 18% VAT, collected by AliExpress at checkout (the $75 cap is back since June 2026).
// shortcut: compares the item price only, at a fixed rate; the real check is the whole order's value.
const VAT_FREE_ILS = 75 * 3.7;
export function vatLine(p) {
  const n = Number(p.target_sale_price ?? p.sale_price);
  return (p.target_sale_price_currency ?? p.sale_price_currency) === "ILS" && n > VAT_FREE_ILS ? "🧾 מעל 75$: יתווסף מע״מ 18% בקופה" : null;
}

function buildCard(products, query, demo, reasons, closest, rare) {
  const lines = [`🔎 <b>${esc(clip(oneLine(query), QUERY_MAX))}</b>${demo ? " [דמו – תוצאות קבועות]" : ""}`, ...(closest ? [rare ? RARE_NOTE : CLOSEST_NOTE] : [])];
  products.forEach((p, i) => {
    const link = /^https?:\/\//i.test(p.promotion_link ?? "") ? p.promotion_link : null;
    const sold = soldText(p.lastest_volume);
    lines.push(
      "",
      ...[
        // A ✨ or 🏷️ pick isn't ranked by sales, so it has no medal; the medals count the best sellers only (🥇 ✨ 🥈 ✨).
        `${p.pretty ? "✨" : p.brandSlot ? "🏷️" : MEDALS[products.slice(0, i).filter((q) => !q.pretty && !q.brandSlot).length]} <b>${esc(p.short_he || shortTitle(p.product_title) || "מוצר")}</b>`,
        p.pretty && "✨ מהיפים ביותר בחיפוש",
        reasons?.[i] && `💡 ${esc(reasons[i])}`,
        priceLine(p, { from: true }),
        discountLine(p),
        vatLine(p),
        // Trust badges ride on the rating line (a line each would push the 4th product past the caption limit).
        [ratingText(p), isChoice(p) && "✅ Choice", p.brandTag === "official" ? "🏷️ חנות רשמית" : p.brandTag === "known" && "🏷️ מותג מוכר"].filter(Boolean).join(" · ") || null,
        sold ? `🛒 נמכרו: ${sold}` : `${p.lastest_volume}` === "0" && "🆕 עוד לא נקנה", // never-sold come last; the buyer should know (unknown: no line)
        link && `🔗 ${esc(link)}`,
      ].filter(Boolean),
    );
  });
  lines.push("", "🐼 פנדה אקספרס", esc(GROUP_URL)); // group link at the end (owner request)
  return { caption: rtl(lines) }; // links are in the text; the keyboard holds only the bot's own buttons (owner request)
}

// Result card for up to 5 products; drops trailing products until the caption fits Telegram's limit.
export function formatCard(products, { query, demo = false, reasons = null, closest = false, rare = false }) {
  let n = Math.min(products.length, MEDALS.length);
  let card;
  do card = buildCard(products.slice(0, n--), query, demo, reasons, closest, rare);
  while (n > 0 && parsedLength(card.caption) > CAPTION_MAX);
  return card;
}

// Price range from the AI: applies only to ILS prices; other currencies ignore it.
export function withinPrice(products, maxIls, minIls = null) {
  if (!maxIls && !minIls) return products;
  return products.filter((p) => {
    if ((p.target_sale_price_currency ?? p.sale_price_currency) !== "ILS") return true;
    const n = Number(p.target_sale_price ?? p.sale_price);
    return (!maxIls || n <= maxIls) && (!minIls || n >= minIls);
  });
}

export const questionText = (question) => rtl([`🤔 ${esc(question)}`]);
export const chosenText = (label) => rtl([`🔎 ${esc(label)}`]);

export function formatLinkReply(link, { demo = false } = {}) {
  return rtl([`🔗 הנה הקישור${demo ? " [דמו]" : ""}:`, esc(link)]);
}

export const GROUP_LINK = GROUP_URL;
export const HELP = rtl([
  "🐼 <b>פנדה אקספרס: אתם אומרים מה צריך, אני מוצא את הכי שווה בעלי אקספרס</b>",
  "",
  '🔎 כתבו בקבוצה "חפש לי" ואחריו מה שאתם מחפשים:',
  'חפש לי אוזניות אלחוטיות עד 100 ש"ח',
  "",
  "💡 ככל שתפרטו יותר (סוג, צבע, מידה, תקציב), התוצאות מדויקות יותר.",
  "🎁 לא בטוחים מה לקנות? כתבו: חפש לי מתנה לאמא, ואשאל כמה שאלות קצרות.",
  "👇 מתחת לכל תוצאה: 🎯 בול! / 🐼 לא זה, ו-🔍 לחפש עוד?",
]);

export const PRIVATE_INVITE = rtl([
  "🐼 היי! אני עובד בקבוצת <b>פנדה אקספרס</b>.",
  'שם כותבים "חפש לי" ואחריו שם המוצר, ומקבלים את המוצרים הכי שווים מעלי אקספרס.',
  "מחכים לכם בקבוצה 👇",
]);
export const PRIVATE_BUTTON = "החיפוש עובד בקבוצת פנדה אקספרס 🐼";

export const NOT_PRODUCT = rtl(["🤔 לא הבנתי מה לחפש.", 'נסו לכתוב שוב: "חפש לי" ואחריו שם המוצר, למשל: חפש לי אוזניות אלחוטיות']);
export const OFF_TOPIC = rtl(["🐼 שימו לב: הקבוצה מיועדת למוצרים ודילים מעלי אקספרס.", 'לחיפוש מוצר כתבו "חפש לי" ואחריו שם המוצר, למשל: חפש לי מטען לרכב']);
export const LINK_HELP = rtl(["🔗 אני ממיר רק קישורים של מוצרים מעלי אקספרס.", "באפליקציה: נכנסים למוצר ← שיתוף ← העתקת קישור, ומדביקים כאן."]);
export const NOT_ALLOWED = rtl(["🙏 את זה אני לא מחפש בקבוצה.", "אשמח לעזור עם כל מוצר אחר, למשל: חפש לי אוזניות אלחוטיות"]);
export const SEARCHING = rtl(["🔎 מחפש לכם… רגע ⏳"]);
export const SEARCH_NOW = "🔎 תחפש כבר";
export const BACK_LABEL = "⬅️ חזרה";
export const MORE_LABEL = "🔍 לחפש עוד?";
export const GOOD_LABEL = "🎯 בול!";
export const BAD_LABEL = "🐼 לא זה";
export const NO_MORE = "אין עוד תוצאות לחיפוש הזה";
export const MORE_NOT_YOURS = "רק מי שחיפש יכול לבקש עוד";
export const VOTE_THANKS = "תודה על המשוב 🙏";
export const VOTED = "כבר הצבעת, תודה 🙂";
export const ADVICE_EMPTY = rtl(["על מה להתייעץ? לדוגמה: /advice מתנה לאמא"]);
export const CLARIFY_NOT_YOURS = "רק מי שביקש יכול לבחור";
export const CLARIFY_EXPIRED = "הבקשה פגה, חפשו שוב";
export const EMPTY_QUERY = rtl(["מה לחפש? לדוגמה: חפש לי אוזניות אלחוטיות"]);
export const NO_FOOD = rtl(["😕 עלי אקספרס כמעט לא שולח מזון לישראל, ולכן אין תוצאות.", "אפשר לחפש אביזרים, למשל: חפש לי מטחנת קפה ידנית"]);
export const NO_RESULTS = rtl(["😕 לא מצאתי מוצרים שמתאימים בדיוק למה שביקשתם, אבל אני כאן בשבילכם!", "נסו לנסח את הבקשה קצת אחרת או יותר כללי, למשל: חפש לי מטען לאייפון 🙂"]);
export const HOW_TO_SEARCH = rtl(["🐼 היי! הקבוצה מיועדת לדילים ולמוצרים מעלי אקספרס בלבד.", 'מחפשים משהו? כתבו "חפש לי" ואחריו שם המוצר, למשל: חפש לי אוזניות אלחוטיות']);
export const guideText = (name) => rtl(['🙂 כדי שאוכל לעזור בצורה הכי טובה, כתבו "חפש לי" ואחריו שם המוצר.', `למשל: חפש לי ${esc(name)}`]);
export const SEARCH_ERROR = rtl(["😕 הייתה תקלה בחיבור לעלי אקספרס. נסו שוב בעוד דקה."]);
export const LINK_ERROR = rtl(["😕 לא הצלחתי ליצור קישור כרגע. נסו שוב בעוד דקה."]);
export const cooldownMessage = (seconds) => rtl([`⏳ רגע… אפשר לחפש שוב בעוד ${seconds} שניות.`]);
