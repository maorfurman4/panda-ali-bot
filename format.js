// Hebrew message texts and formatting (HTML parse mode).
// Every line starts with RLM so lines that begin with a digit, a price or a Latin brand still render right-to-left.
export const RLM = "‏";
export const DISCLOSURE = "ℹ️ קישורי שותפים – ייתכן שנקבל עמלה על רכישה. המחירים משוערים."; // private /start only, by owner decision
const MIN_FEEDBACK = 90;
const TITLE_MAX = 40; // photo captions are only as wide as the photo
const QUERY_MAX = 45;
// Seller filler at the start of machine-translated titles ("2022 חדש", "NEW", "1 יחידה").
const TITLE_JUNK = /^(?:(?:20\d\d|new|חדש(?:ה|ים|ות)?|hot|1\s*(?:יחידה|יחידות|pcs?)|מקורי(?:ת)?|לשנת)[\s,:-]*)+/i;
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
export function rankProducts(products) {
  const score = (p) => Math.log10((Number(p.lastest_volume) || 0) + 1) * ((parseEvaluateRate(p.evaluate_rate) ?? 90) / 100);
  return products.map((p, i) => ({ p, i, s: score(p) })).sort((a, b) => b.s - a.s || a.i - b.i).map((x) => x.p);
}

// The same product from several sellers counts once (the first, i.e. best-ranked, stays). Two keys: brand + model
// ("BINNUNE BW06", "Lenovo GM2") and the start of the normalized title.
export function dedupeProducts(products) {
  const seen = new Set();
  return products.filter((p) => {
    const t = oneLine(p.product_title).toLowerCase();
    const model = t.match(/\b[a-z]{3,}\s+(?:[a-z]+\d|\d+[a-z])[a-z0-9]*\b/)?.[0];
    const keys = [model && `m:${model}`, `t:${t.replace(/[^\p{L}\p{N}]+/gu, "").slice(0, 24)}`].filter(Boolean);
    if (keys.some((k) => seen.has(k))) return false;
    keys.forEach((k) => seen.add(k));
    return true;
  });
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
  const full = oneLine(title).replace(TITLE_JUNK, "");
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

export function priceLine(p) {
  const price = salePrice(p);
  return price ? `💰 מחיר: <b>${esc(price)}</b>` : null;
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

function buildCard(products, query, demo, reasons) {
  const lines = [`🔎 <b>${esc(clip(oneLine(query), QUERY_MAX))}</b>${demo ? " [דמו – תוצאות קבועות]" : ""}`];
  const buttons = [];
  products.forEach((p, i) => {
    const link = /^https?:\/\//i.test(p.promotion_link ?? "") ? p.promotion_link : null;
    const sold = soldText(p.lastest_volume);
    lines.push(
      "",
      ...[
        `${MEDALS[i]} <b>${esc(shortTitle(p.product_title) || "מוצר")}</b>`,
        reasons?.[i] && `💡 ${esc(reasons[i])}`,
        priceLine(p),
        discountLine(p),
        ratingText(p),
        sold && `🛒 נמכרו: ${sold}`,
        link && `🔗 ${esc(link)}`,
      ].filter(Boolean),
    );
    if (link) buttons.push({ text: salePrice(p) ? `${MEDALS[i]} ${salePrice(p)}` : MEDALS[i], url: link });
  });
  lines.push("", "🐼 פנדה אקספרס", esc(GROUP_URL)); // group link at the end (owner request)
  const rows = [];
  const perRow = buttons.length === 4 ? 2 : 3; // 4 results -> 2×2, like the collage
  for (let i = 0; i < buttons.length; i += perRow) rows.push(buttons.slice(i, i + perRow));
  return { caption: rtl(lines), buttons: rows };
}

// Result card for up to 5 products; drops trailing products until the caption fits Telegram's limit.
export function formatCard(products, { query, demo = false, reasons = null }) {
  let n = Math.min(products.length, MEDALS.length);
  let card;
  do card = buildCard(products.slice(0, n--), query, demo, reasons);
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

export const questionText = (question, { inGroup = false } = {}) =>
  rtl([`🤔 ${esc(question)}`, ...(inGroup ? ["👇 הבחירה תמשיך איתכם בצ'אט פרטי"] : [])]);
export const chosenText = (label) => rtl([`🔎 ${esc(label)}`]);

export function formatLinkReply(link, { demo = false } = {}) {
  return rtl([`🔗 הנה הקישור${demo ? " [דמו]" : ""}:`, esc(link)]);
}

export const HELP = rtl([
  "🐼 <b>היי, אני הבוט של פנדה דילים</b>",
  "אני מחפש בשבילכם מוצרים בעלי אקספרס.",
  "",
  "🔎 <b>איך מחפשים?</b>",
  "• בקבוצה, בתחילת ההודעה: חפש לי אוזניות אלחוטיות",
  "• או: מצא לי מטען לרכב",
  "• או: /search wireless earbuds",
  "• או: תייגו אותי בתחילת ההודעה עם מה שאתם מחפשים",
  "• או פשוט כתבו בקבוצה: מישהו מכיר… / מחפש… / יש המלצה על…",
  "• כאן בפרטי: פשוט כתבו מה אתם מחפשים",
  "🧭 לא בטוחים מה לקנות? /advice מתנה לאמא, ואשאל כמה שאלות קצרות",
  "",
  "🔗 קישור למוצר מעלי אקספרס: שלחו אותו כאן, או בקבוצה אחרי תיוג שלי, ואחזיר קישור לרכישה.",
  "💡 חיפוש באנגלית מחזיר לרוב תוצאות טובות יותר.",
  "📊 מספר המכירות הוא לפי עלי אקספרס, בתקופה האחרונה.",
  "",
  `<i>${DISCLOSURE}</i>`,
]);

export const GROUP_HELP = rtl(['🐼 כתבו "חפש לי ..." ואמצא לכם מוצרים. הסבר מלא בפרטי 👈']);
export const NOT_PRODUCT = rtl(["🤔 לא הבנתי מה לחפש.", 'נסו לכתוב שוב: "חפש לי" ואחריו שם המוצר, למשל: חפש לי אוזניות אלחוטיות']);
export const SEARCHING = rtl(["🔎 מחפש לכם… רגע ⏳"]);
export const SEARCH_NOW = "🔎 תחפש כבר";
export const moreLabel = (n) => (n === 1 ? "🔄 עוד תוצאה" : `🔄 עוד ${n} תוצאות`);
export const NO_MORE = "אין עוד תוצאות לחיפוש הזה";
export const MORE_NOT_YOURS = "רק מי שחיפש יכול לבקש עוד";
export const VOTE_THANKS = "תודה על המשוב 🙏";
export const VOTED = "כבר הצבעת, תודה 🙂";
export const ADVICE_EXPIRED = rtl(["הייעוץ פג. כתבו לי שוב מה אתם מחפשים 🙂"]);
export const ADVICE_EMPTY = rtl(["על מה להתייעץ? לדוגמה: /advice מתנה לאמא"]);
export const CLARIFY_NOT_YOURS = "רק מי שביקש יכול לבחור";
export const CLARIFY_EXPIRED = "הבקשה פגה, חפשו שוב";
export const EMPTY_QUERY = rtl(["מה לחפש? לדוגמה: חפש לי אוזניות אלחוטיות"]);
export const NO_RESULTS = rtl(["😕 לא מצאתי מוצרים שמתאימים בדיוק למה שביקשתם, אבל אני כאן בשבילכם!", "נסו לנסח את הבקשה קצת אחרת או יותר כללי, למשל: חפש לי מטען לאייפון 🙂"]);
export const guideText = (name) => rtl(['🙂 כדי שאוכל לעזור בצורה הכי טובה, כתבו "חפש לי" ואחריו שם המוצר.', `למשל: חפש לי ${esc(name)}`]);
export const SEARCH_ERROR = rtl(["😕 הייתה תקלה בחיבור לעלי אקספרס. נסו שוב בעוד דקה."]);
export const LINK_ERROR = rtl(["😕 לא הצלחתי ליצור קישור כרגע. נסו שוב בעוד דקה."]);
export const cooldownMessage = (seconds) => rtl([`⏳ רגע… אפשר לחפש שוב בעוד ${seconds} שניות.`]);
