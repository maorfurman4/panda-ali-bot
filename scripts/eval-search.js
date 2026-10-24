// End-to-end search quality: for each query the real AI + AliExpress pipeline picks 4 products, then a second
// AI (the judge, gpt-6-luna by default) checks which of them really ARE what was asked. Reports precision@4.
// Usage: npm run eval:search [-- --judge gpt-6-luna]
import { createUnderstander, createRelevanceFilter, filterRelevant } from "../query.js";
import { searchProducts, isMockMode } from "../aliexpress.js";
import { pickProducts } from "../bot.js";

if (!process.env.OPENAI_API_KEY || isMockMode()) {
  console.log("Needs OPENAI_API_KEY and the ALI_* keys in .env.");
  process.exit(0);
}
const i = process.argv.indexOf("--judge");
const judge = createRelevanceFilter({ env: { ...process.env, OPENAI_RELEVANCE_MODEL: i > 0 ? process.argv[i + 1] : "gpt-6-luna" } });
const understand = createUnderstander();

const QUERIES = [
  // earlier weak spots
  "תיק לעבודה", "מגפיים לנשים", "כיסוי לאייפד פרחוני", "בגדים של זארה", "שרוול מרינו מחמם", "מנורת לילה לילדים",
  // electronics
  "מטען לאייפון", "אוזניות אלחוטיות עד 100 שקל", "רחפן עם מצלמה", "שעון חכם לריצה", "כיסוי לגלקסי S24 אולטרה",
  "מקלדת מכנית אלחוטית", "רמקול בלוטות' עמיד במים", "מצלמת דרך לרכב", "פאוורבנק 20000", "עכבר שקט למחשב",
  // home & kitchen
  "בקבוק עם מסנן", "מארגן למקרר", "וילון האפלה לחדר שינה", "מטחנת קפה ידנית", "סכין שף", "פח אשפה חכם", "מנורת שולחן לד",
  // fashion & beauty
  "שמלת ערב שחורה", "נעלי ריצה לגברים", "משקפי שמש מקוטבים", "תיק גב לבית ספר", "מייבש שיער מקצועי", "מברשת שיניים חשמלית",
  "ארנק עור לגברים", "פיג'מה לנשים לחורף",
  // kids, pets, sports, car, tools
  "צעצוע לתינוקת", "לגו טכני", "קולר לכלב קטן", "מזרן יוגה עבה", "משקולות יד 5 קילו", "משענת לאוטו", "מעמד לטלפון לרכב",
  "מברגה נטענת", "סט מפתחות אלן",
  // slang, typos, attributes
  "אזניות לגיימינג עם מיקרופון", "כיסוי לאיפון 15 שקוף", "מטריה חזקה נגד רוח", "כוס תרמית 500 מל", "שטיח לסלון אפור",
];

// The filter fails open (keeps everything) on errors; catch its warning so a failed judgement isn't counted as a pass.
let judgeFailed = false;
const warn = console.warn;
console.warn = (...a) => (String(a[0]).includes("relevance") ? (judgeFailed = true) : warn(...a));

const rows = [];
for (const q of QUERIES) {
  const t = Date.now();
  const intent = await understand(q);
  if (intent?.status !== "ok") {
    rows.push({ query: q, keywords: "", shown: 0, relevant: "", wrong: `AI: ${intent?.status ?? "failed"}`, s: ((Date.now() - t) / 1000).toFixed(1) });
    continue;
  }
  const shown = await pickProducts(
    { search: searchProducts, relevant: filterRelevant, live: true },
    { keywords: intent.keywords_en, fallback: intent.fallback_en, context: intent.corrected_he, maxPriceIls: intent.max_price_ils, limit: 4 },
  ).catch(() => []);
  const s = ((Date.now() - t) / 1000).toFixed(1);
  judgeFailed = false;
  const { exact, partial } = await judge({ he: intent.corrected_he, en: intent.keywords_en }, shown);
  rows.push({
    query: q,
    keywords: intent.keywords_en,
    shown: shown.length,
    relevant: judgeFailed ? "judge failed" : exact.length + partial.length,
    exact: judgeFailed ? "" : exact.length,
    wrong: judgeFailed ? "" : shown.filter((p) => !exact.includes(p) && !partial.includes(p)).map((p) => String(p.product_title).slice(0, 25)).join(" ; "),
    s,
  });
}
console.warn = warn;

console.table(rows);
const judged = rows.filter((r) => typeof r.relevant === "number" && r.shown);
const precision = judged.reduce((a, r) => a + r.relevant / r.shown, 0) / (judged.length || 1);
const exactRate = judged.reduce((a, r) => a + r.exact / r.shown, 0) / (judged.length || 1);
const latencies = rows.map((r) => Number(r.s)).sort((a, b) => a - b);
console.log(
  `precision@4: ${(precision * 100).toFixed(0)}% right item · ${(exactRate * 100).toFixed(0)}% with every requested feature (${judged.length} judged) · fewer than 4 results: ${rows.filter((r) => r.shown < 4).length}/${rows.length} · ` +
    `p50 time: ${latencies[Math.floor((latencies.length - 1) / 2)]} s · max: ${latencies.at(-1)} s`,
);
