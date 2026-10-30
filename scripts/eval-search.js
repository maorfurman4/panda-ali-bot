// End-to-end search quality: for each query the real AI + AliExpress pipeline picks 4 products, then a second
// AI (the judge, gpt-5.5 by default: stronger than the bot) checks which of them really ARE what was asked. Reports precision@4.
// Usage: npm run eval:search [-- --judge gpt-5.5] [-- --model <relevance model>] [-- --max 1.3]
import { createUnderstander, createRelevanceFilter } from "../query.js";
import { searchProducts, isMockMode } from "../aliexpress.js";
import { pickProducts } from "../bot.js";

if (!process.env.OPENAI_API_KEY || isMockMode()) {
  console.log("Needs OPENAI_API_KEY and the ALI_* keys in .env.");
  process.exit(0);
}
const i = process.argv.indexOf("--judge");
const judgeModel = i > 0 ? process.argv[i + 1] : "gpt-5.5"; // stronger than the bot's model: an independent judge
// $ per 1M tokens [input, output], read 2026-10-24 from https://developers.openai.com/api/docs/pricing
const PRICES = { "gpt-5.4": [2.5, 15], "gpt-5.5": [5, 30], "gpt-5.4-nano": [0.2, 1.25], "gpt-5.4-mini": [0.75, 4.5], "gpt-6-luna": [0.1, 0.5], "gpt-5-nano": [0.05, 0.4], "gpt-5-mini": [0.25, 2] };
const m = process.argv.indexOf("--model");
if (m > 0) process.env.OPENAI_RELEVANCE_MODEL = process.argv[m + 1];
// The whole bill, judge included, with a hard stop: --max <dollars> (default 1.3) ends the run before the next query.
const x = process.argv.indexOf("--max");
const MAX_USD = x > 0 ? Number(process.argv[x + 1]) : 1.3;
let cost = 0, judgeCost = 0;
const meter = (model, judging = false) => ({ input_tokens, output_tokens }) => {
  const [pin, pout] = PRICES[model] ?? [NaN, NaN];
  const usd = (input_tokens * pin + output_tokens * pout) / 1e6;
  if (judging) judgeCost += usd;
  else cost += usd;
};
const understand = createUnderstander({ onUsage: meter(process.env.OPENAI_MODEL || "gpt-5.4-mini") });
const filterRelevant = createRelevanceFilter({ onUsage: meter(process.env.OPENAI_RELEVANCE_MODEL || "gpt-5.4") });
const judge = createRelevanceFilter({ env: { ...process.env, OPENAI_RELEVANCE_MODEL: judgeModel }, onUsage: meter(judgeModel, true) });

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
  // real group requests the owner flagged (2026-10-30)
  "מסרק לשיער", "תחתיות לסירים", "ברז למטבח", "מניפות מעוצבות לחתונה",
];

// The filter fails open (keeps everything) on errors; catch its warning so a failed judgement isn't counted as a pass.
let judgeFailed = false;
const warn = console.warn;
console.warn = (...a) => (String(a[0]).includes("relevance") ? (judgeFailed = true) : warn(...a));

const rows = [];
for (const q of QUERIES) {
  if (cost + judgeCost >= MAX_USD) {
    console.log(`Stopped: $${(cost + judgeCost).toFixed(2)} spent, the cap is $${MAX_USD}.`);
    break;
  }
  const t = Date.now();
  const intent = await understand(q);
  if (intent?.status !== "ok") {
    rows.push({ query: q, keywords: "", shown: 0, relevant: "", wrong: `AI: ${intent?.status ?? "failed"}`, s: ((Date.now() - t) / 1000).toFixed(1) });
    continue;
  }
  const shown = await pickProducts(
    { search: searchProducts, relevant: filterRelevant, live: true },
    // The same inputs the bot passes (bot.js showResults): the other wording, the main category and the brand name.
    { keywords: intent.keywords_en, fallback: intent.fallback_en, alt: intent.alt_en ?? null, category: intent.category_id ?? null, looks: intent.looks_like ?? null, context: intent.corrected_he, maxPriceIls: intent.max_price_ils, minPriceIls: intent.min_price_ils ?? intent.floor_price_ils, brandOnly: intent.brand || false, limit: 4 },
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
    `p50 time: ${latencies[Math.floor((latencies.length - 1) / 2)]} s · max: ${latencies.at(-1)} s · bot AI cost: $${(cost / rows.length).toFixed(5)} per search · total spent $${(cost + judgeCost).toFixed(2)} (judge $${judgeCost.toFixed(2)})`,
);
