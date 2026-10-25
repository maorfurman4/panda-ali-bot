// Category map: 2 real searches in each main AliExpress category. Each search runs the real pipeline twice on the SAME
// AliExpress results, once with the strong relevance model and once with the cheap one, and an independent judge
// (gpt-5.5) checks both. Shows where the bot is strong or weak, and where the cheap model is good enough.
// Usage: npm run eval:categories
import { createUnderstander, createRelevanceFilter } from "../query.js";
import { searchProducts, isMockMode } from "../aliexpress.js";
import { pickProducts } from "../bot.js";

if (!process.env.OPENAI_API_KEY || isMockMode()) {
  console.log("Needs OPENAI_API_KEY and the ALI_* keys in .env.");
  process.exit(0);
}
// $ per 1M tokens [input, output], read 2026-10-24/25 from https://developers.openai.com/api/docs/pricing
const PRICES = { "gpt-5.4": [2.5, 15], "gpt-5.4-mini": [0.75, 4.5] };
const STRONG = "gpt-5.4", CHEAP = "gpt-5.4-mini";
const cost = { [STRONG]: 0, [CHEAP]: 0 };
const filter = (model) => createRelevanceFilter({
  env: { ...process.env, OPENAI_RELEVANCE_MODEL: model },
  onUsage: (u) => { cost[model] += (u.input_tokens * PRICES[model][0] + u.output_tokens * PRICES[model][1]) / 1e6; },
});
const strong = filter(STRONG), cheap = filter(CHEAP);
const judge = createRelevanceFilter({ env: { ...process.env, OPENAI_RELEVANCE_MODEL: "gpt-5.5" } });
const understand = createUnderstander();

const CATEGORIES = {
  "Consumer Electronics": ["חפש לי אוזניות אלחוטיות", "חפש לי רמקול בלוטות' עמיד במים"],
  "Phones & Accessories": ["חפש לי כיסוי לאייפון 15", "חפש לי מגן מסך לגלקסי S24"],
  "Computer & Office": ["חפש לי עכבר אלחוטי שקט", "חפש לי מעמד למחשב נייד"],
  "Home Appliances": ["חפש לי מכונת קפה קטנה", "חפש לי מאוורר שולחני נטען"],
  "Home & Garden": ["חפש לי מארגן לארון בגדים", "חפש לי קולר לכלב קטן"],
  "Home Improvement": ["חפש לי ברז נשלף למטבח", "חפש לי מברגה נטענת"],
  "Tools": ["חפש לי סט מברגים מדויק", "חפש לי מד לחץ אוויר לצמיגים"],
  "Lights & Lighting": ["חפש לי פס לד לחדר", "חפש לי מנורת לילה לילדים"],
  "Furniture": ["חפש לי כיסא גיימינג", "חפש לי מדף קיר צף"],
  "Security & Protection": ["חפש לי מצלמת אבטחה לבית", "חפש לי פעמון דלת חכם"],
  "Automobiles": ["חפש לי מטען לרכב", "חפש לי מצלמת דרך"],
  "Motorcycle": ["חפש לי קסדה לקטנוע", "חפש לי מחזיק טלפון לאופנוע"],
  "Sports & Entertainment": ["חפש לי רצועות התנגדות לאימון", "חפש לי מזרן יוגה עבה"],
  "Sports Clothing & Shoes": ["חפש לי טייץ ספורט לנשים", "חפש לי נעלי ריצה לגברים"],
  "Shoes": ["חפש לי כפכפים לנשים", "חפש לי מגפיים לנשים"],
  "Women's Clothing": ["חפש לי שמלת קיץ", "חפש לי מעיל לנשים לחורף"],
  "Men's Clothing": ["חפש לי חולצה מכופתרת לגבר", "חפש לי מכנסי ג'ינס לגבר"],
  "Underwear": ["חפש לי גרביים לגברים", "חפש לי חזיית ספורט"],
  "Apparel Accessories": ["חפש לי חגורת עור לגבר", "חפש לי משקפי שמש מקוטבים"],
  "Jewelry": ["חפש לי שרשרת כסף לנשים", "חפש לי צמיד לגבר"],
  "Watches": ["חפש לי שעון יד לגבר", "חפש לי שעון חכם לילדים"],
  "Luggage & Bags": ["חפש לי מזוודה לעלייה למטוס", "חפש לי תיק גב למחשב"],
  "Beauty & Health": ["חפש לי מכונת תספורת", "חפש לי מברשת שיניים חשמלית"],
  "Hair & Wigs": ["חפש לי פאה לנשים", "חפש לי מייבש שיער"],
  "Mother & Kids": ["חפש לי מוניטור לתינוק", "חפש לי בקבוק האכלה לתינוק"],
  "Toys & Hobbies": ["חפש לי לגו טכני", "חפש לי רחפן לילדים"],
  "Office & School": ["חפש לי קלמר לבית ספר", "חפש לי מחברת A5"],
  "Weddings & Events": ["חפש לי בלונים ליום הולדת", "חפש לי קישוטים לחתונה"],
  "Novelty & Gifts": ["חפש לי מחזיק מפתחות מצחיק", "חפש לי מתנה לגבר"],
  "Electronic Components": ["חפש לי ערכת ארדואינו", "חפש לי מלחם"],
  "Kitchen": ["חפש לי סכין שף", "חפש לי מטחנת קפה ידנית"],
  "Food": ["חפש לי חטיפים יפניים", "חפש לי תה ירוק"],
  "Books & Culture": ["חפש לי ערכת ציור לילדים", "חפש לי סימניות לספרים"],
};

const { parseTrigger } = await import("../bot.js");
const rows = [];
for (const [cat, msgs] of Object.entries(CATEGORIES)) {
  for (const m of msgs) {
    const q = parseTrigger(m, "x") ?? m;
    const t = Date.now();
    const intent = await understand(q);
    if (intent?.status !== "ok") { rows.push({ cat, q, note: `AI: ${intent?.status ?? "failed"}` }); continue; }
    // One AliExpress fetch per query, reused by both runs, so both models judge the same products.
    const memo = new Map();
    const search = (kw, o) => memo.get(kw) ?? memo.set(kw, searchProducts(kw, o)).get(kw);
    const opts = { keywords: intent.keywords_en, fallback: intent.fallback_en, context: intent.corrected_he, maxPriceIls: intent.max_price_ils, minPriceIls: intent.min_price_ils ?? intent.floor_price_ils, brandOnly: Boolean(intent.brand), limit: 4 };
    const [a, b] = await Promise.all([
      pickProducts({ search, relevant: strong, live: true }, opts).catch(() => []),
      pickProducts({ search, relevant: cheap, live: true }, opts).catch(() => []),
    ]);
    const s = ((Date.now() - t) / 1000).toFixed(1);
    const req = { he: intent.corrected_he, en: intent.keywords_en };
    const [ja, jb] = await Promise.all([judge(req, a), judge(req, b)]);
    const ok = (shown, j) => j.exact.length + j.partial.length;
    rows.push({ cat, q, strong: `${ok(a, ja)}/${a.length}`, cheap: `${ok(b, jb)}/${b.length}`, s, _a: [ok(a, ja), a.length], _b: [ok(b, jb), b.length] });
  }
}

// Per category: right items out of shown, for each model.
const byCat = {};
for (const r of rows) {
  const c = (byCat[r.cat] ??= { strongOk: 0, strongN: 0, cheapOk: 0, cheapN: 0, notes: [] });
  if (r.note) { c.notes.push(`${r.q}: ${r.note}`); continue; }
  c.strongOk += r._a[0]; c.strongN += r._a[1]; c.cheapOk += r._b[0]; c.cheapN += r._b[1];
}
const pct = (ok, n) => (n ? `${Math.round((ok / n) * 100)}%` : "-");
console.table(rows.map(({ _a, _b, ...r }) => r));
console.table(Object.entries(byCat).map(([cat, c]) => ({ cat, strong: `${pct(c.strongOk, c.strongN)} (${c.strongN})`, cheap: `${pct(c.cheapOk, c.cheapN)} (${c.cheapN})`, notes: c.notes.join(" ; ") })));
const tot = Object.values(byCat).reduce((t, c) => ({ so: t.so + c.strongOk, sn: t.sn + c.strongN, co: t.co + c.cheapOk, cn: t.cn + c.cheapN }), { so: 0, sn: 0, co: 0, cn: 0 });
const n = rows.filter((r) => !r.note).length || 1;
console.log(`TOTAL strong ${STRONG}: ${pct(tot.so, tot.sn)} right (${tot.sn} shown, $${(cost[STRONG] / n).toFixed(4)}/search) · cheap ${CHEAP}: ${pct(tot.co, tot.cn)} right (${tot.cn} shown, $${(cost[CHEAP] / n).toFixed(4)}/search) · ${rows.length} searches`);
