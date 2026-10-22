// Hebrew message texts and formatting (HTML parse mode).
// Every line starts with RLM so lines that begin with a digit or a Latin brand still render right-to-left.
export const RLM = "‏";
export const DISCLOSURE = "ℹ️ קישורי שותפים – ייתכן שנקבל עמלה על רכישה. המחירים משוערים.";
const MIN_FEEDBACK = 90;
const TITLE_MAX = 90;
const SYMBOLS = { ILS: "₪", USD: "$" };

export const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const rtl = (lines) => lines.map((l) => RLM + l).join("\n");

const truncate = (s) => {
  const chars = [...s];
  return chars.length > TITLE_MAX ? chars.slice(0, TITLE_MAX - 1).join("") + "…" : s;
};

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

export function formatResults(products, { demo = false } = {}) {
  const count = products.length === 1 ? "מוצר אחד" : `${products.length} מוצרים`;
  const lines = [`🐼 <b>מצאתי לך ${count}${demo ? " [דמו]" : ""}:</b>`];
  products.forEach((p, i) => {
    const title = String(p.product_title ?? "").replace(/\s+/g, " ").trim(); // a newline would start a line without RLM
    lines.push("", `${i + 1}. <b>${esc(truncate(title))}</b>`);
    const stats = [];
    const price = p.target_sale_price ?? p.sale_price;
    const currency = p.target_sale_price_currency ?? p.sale_price_currency ?? "";
    if (price) stats.push(`💰 ${esc(price)} ${esc(SYMBOLS[currency] ?? currency)}`.trim());
    const rate = parseEvaluateRate(p.evaluate_rate);
    if (rate !== null) stats.push(`👍 ${Math.floor(rate)}% משוב חיובי`);
    const orders = Number(p.lastest_volume);
    if (orders > 0) stats.push(`📦 ${orders.toLocaleString("en-US")} הזמנות`);
    if (stats.length) lines.push(stats.join(" · "));
    if (/^https?:\/\//i.test(p.promotion_link ?? "")) lines.push(`👉 <a href="${esc(p.promotion_link)}">לקנייה</a>`);
  });
  lines.push("", `<i>${DISCLOSURE}</i>`);
  return rtl(lines);
}

export function formatLinkReply(link, { demo = false } = {}) {
  return rtl([`🔗 הנה הקישור${demo ? " [דמו]" : ""}:`, esc(link), "", `<i>${DISCLOSURE}</i>`]);
}

export const HELP = rtl([
  "🐼 <b>היי! אני הבוט של פנדה דילים</b>",
  "אני מחפש בשבילכם מוצרים בעלי אקספרס.",
  "",
  "🔎 <b>איך מחפשים?</b>",
  "• כתבו: חפש לי אוזניות אלחוטיות",
  "• או: /search wireless earbuds",
  "• או תייגו אותי עם מה שאתם מחפשים",
  "",
  "🔗 הדביקו קישור למוצר מעלי אקספרס ואחזיר קישור לרכישה.",
  "💡 חיפוש באנגלית מחזיר לרוב תוצאות טובות יותר.",
  "",
  `<i>${DISCLOSURE}</i>`,
]);

export const EMPTY_QUERY = rtl(["מה לחפש? לדוגמה: חפש לי אוזניות אלחוטיות"]);
export const NO_RESULTS = rtl(["😕 לא מצאתי מוצרים מתאימים. נסו מילים אחרות (באנגלית זה עובד הכי טוב)."]);
export const SEARCH_ERROR = rtl(["😕 הייתה תקלה בחיבור לעלי אקספרס. נסו שוב בעוד דקה."]);
export const LINK_ERROR = rtl(["😕 לא הצלחתי ליצור קישור כרגע. נסו שוב בעוד דקה."]);
export const cooldownMessage = (seconds) => rtl([`⏳ רגע… אפשר לחפש שוב בעוד ${seconds} שניות.`]);
