// Hebrew message texts and formatting (HTML parse mode).
// Every line starts with RLM so lines that begin with a digit, a price or a Latin brand still render right-to-left.
export const RLM = "‏";
export const DISCLOSURE = "ℹ️ קישורי שותפים – ייתכן שנקבל עמלה על רכישה. המחירים משוערים."; // private /start only, by owner decision
const MIN_FEEDBACK = 90;
const TITLE_MAX = 40;
const QUERY_MAX = 30;
const CAPTION_MAX = 1024; // Telegram photo caption limit, counted after HTML parsing
const MEDALS = ["🥇", "🥈", "🥉", "4️⃣", "5️⃣"];

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

// One line, cut at a word boundary so English brand/model words stay intact.
export function shortTitle(title) {
  const t = oneLine(title);
  if ([...t].length <= TITLE_MAX) return t;
  let out = "";
  for (const word of t.split(" ")) {
    const next = out ? `${out} ${word}` : word;
    if ([...next].length > TITLE_MAX - 1) break;
    out = next;
  }
  return (out || [...t].slice(0, TITLE_MAX - 1).join("")) + "…";
}

// Exact below 100; from 100, rounded down to 2 significant digits + "+".
export function soldText(volume) {
  const n = Math.floor(Number(volume));
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n < 100) return `${n} נמכרו לאחרונה`;
  const step = 10 ** (String(n).length - 2);
  return `${(Math.floor(n / step) * step).toLocaleString("en-US")}+ נמכרו לאחרונה`;
}

// Stars + review count (future DS API data) first, else the positive-feedback %, else nothing. Never shows 0.
export function ratingText(p) {
  const stars = Number(p.avgStars);
  const reviews = Math.round(Number(p.reviewCount));
  if (stars > 0 && reviews > 0) return `⭐ ${stars.toFixed(1)} (${reviews.toLocaleString("en-US")} ביקורות)`;
  const rate = parseEvaluateRate(p.evaluate_rate);
  return rate > 0 ? `👍 ${Math.round(rate)}% משוב חיובי` : null;
}

// Sale price, plus the original price and 🔥 badge only for 5% ≤ discount < 80% (higher means an inflated "original").
export function priceLine(p) {
  const sale = p.target_sale_price ?? p.sale_price;
  const original = p.target_original_price ?? p.original_price;
  const currency = p.target_sale_price_currency ?? p.sale_price_currency;
  const salePrice = formatPrice(sale, currency);
  if (!salePrice) return null;
  let line = `💰 <b>${esc(salePrice)}</b>`;
  const s = Number(sale);
  const o = Number(original);
  if (s > 0 && o > s) {
    const discount = Math.round((1 - s / o) * 100);
    if (discount >= 5 && discount < 80) line += `  <s>${esc(formatPrice(original, currency))}</s>  🔥 ${discount}%-`;
  }
  return line;
}

function buildCard(products, query, demo) {
  const lines = [`🔎 <b>${esc(clip(oneLine(query), QUERY_MAX))}</b>${demo ? " [דמו]" : ""}`];
  const buttons = [];
  products.forEach((p, i) => {
    lines.push("", `${MEDALS[i]} <b>${esc(shortTitle(p.product_title) || "מוצר")}</b>`);
    const price = priceLine(p);
    if (price) lines.push(price);
    const sold = soldText(p.lastest_volume);
    const stats = [ratingText(p), sold && `🛒 ${sold}`].filter(Boolean).join(" · ");
    if (stats) lines.push(stats);
    if (/^https?:\/\//i.test(p.promotion_link ?? "")) {
      const label = formatPrice(p.target_sale_price ?? p.sale_price, p.target_sale_price_currency ?? p.sale_price_currency);
      buttons.push({ text: label ? `${MEDALS[i]} ${label}` : MEDALS[i], url: p.promotion_link });
    }
  });
  const rows = [];
  for (let i = 0; i < buttons.length; i += 3) rows.push(buttons.slice(i, i + 3));
  return { caption: rtl(lines), buttons: rows };
}

// Result card for up to 5 products; drops trailing products until the caption fits Telegram's limit.
export function formatCard(products, { query, demo = false }) {
  let n = Math.min(products.length, MEDALS.length);
  let card;
  do card = buildCard(products.slice(0, n--), query, demo);
  while (n > 0 && parsedLength(card.caption) > CAPTION_MAX);
  return card;
}

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
  "• כאן בפרטי: פשוט כתבו מה אתם מחפשים",
  "",
  "🔗 קישור למוצר מעלי אקספרס: שלחו אותו כאן, או בקבוצה אחרי תיוג שלי, ואחזיר קישור לרכישה.",
  "💡 חיפוש באנגלית מחזיר לרוב תוצאות טובות יותר.",
  "",
  `<i>${DISCLOSURE}</i>`,
]);

export const GROUP_HELP = rtl(['🐼 כתבו "חפש לי ..." ואמצא לכם מוצרים. הסבר מלא בפרטי 👈']);
export const EMPTY_QUERY = rtl(["מה לחפש? לדוגמה: חפש לי אוזניות אלחוטיות"]);
export const NO_RESULTS = rtl(["😕 לא מצאתי מוצרים מתאימים. נסו מילים אחרות (באנגלית זה עובד הכי טוב)."]);
export const SEARCH_ERROR = rtl(["😕 הייתה תקלה בחיבור לעלי אקספרס. נסו שוב בעוד דקה."]);
export const LINK_ERROR = rtl(["😕 לא הצלחתי ליצור קישור כרגע. נסו שוב בעוד דקה."]);
export const cooldownMessage = (seconds) => rtl([`⏳ רגע… אפשר לחפש שוב בעוד ${seconds} שניות.`]);
