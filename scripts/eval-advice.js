// Advisor quality end to end: a general request -> the bot's questions (answered by a fixed button pattern) -> search.
// A judge AI (gpt-5.4-mini by default) checks each of the 4 products against the request AND the answers.
// Usage: npm run eval:advice [-- --judge gpt-5.4-mini]
import { createUnderstander, createRelevanceFilter, createAdvisor } from "../query.js";
import { searchProducts, isMockMode } from "../aliexpress.js";
import { pickProducts } from "../bot.js";

if (!process.env.OPENAI_API_KEY || isMockMode()) {
  console.log("Needs OPENAI_API_KEY and the ALI_* keys in .env.");
  process.exit(0);
}
const j = process.argv.indexOf("--judge");
const judge = createRelevanceFilter({ env: { ...process.env, OPENAI_RELEVANCE_MODEL: j > 0 ? process.argv[j + 1] : "gpt-5.5" } });
const understand = createUnderstander();
const advise = createAdvisor();
const relevant = createRelevanceFilter();
const MAX_QUESTIONS = 3;

// [request, button picked at each question]
const CASES = [
  ["מתנה לאמא", [0, 1, 0]], ["משהו לבית", [1, 0, 1]], ["מתנה לבת 5", [0, 0, 0]], ["מתנה לבן זוג", [2, 1, 0]],
  ["משהו למטבח", [1, 1, 1]], ["ציוד לטיול", [0, 2, 1]], ["משהו לרכב", [2, 0, 0]], ["מתנה ליום הולדת לחבר", [1, 0, 2]],
  ["משהו לחדר של תינוק", [0, 1, 1]], ["ציוד לחתול", [1, 2, 0]],
];

const rows = [];
for (const [request, picks] of CASES) {
  const t = Date.now();
  const intent = await understand(request);
  let step = intent?.status === "clarify" ? { question_he: intent.clarify_question_he, options: intent.options } : await advise({ request, history: [] });
  const s = { history: [], keywords: intent?.keywords_en || request, min: intent?.min_price_ils ?? null, max: intent?.max_price_ils ?? null };
  for (const pick of picks) {
    if (!step?.options?.length) break;
    const o = step.options[Math.min(pick, step.options.length - 1)];
    s.history.push({ q: step.question_he, a: o.label_he });
    s.broad ??= o.keywords_en;
    Object.assign(s, { keywords: o.keywords_en, min: o.min_price_ils ?? s.min, max: o.max_price_ils ?? s.max });
    if (s.history.length >= MAX_QUESTIONS) break;
    const next = await advise({ request, history: s.history });
    if (next?.status === "done") {
      Object.assign(s, { keywords: next.keywords_en, min: next.min_price_ils ?? s.min, max: next.max_price_ils ?? s.max });
      break;
    }
    step = next;
  }
  const context = `${request} (${s.history.map((h) => h.a).join(", ")})`;
  const shown = await pickProducts({ search: searchProducts, relevant, live: true }, { keywords: s.keywords, fallback: s.broad, context, maxPriceIls: s.max, minPriceIls: s.min, limit: 4 }).catch(() => []);
  const { exact, partial } = await judge({ he: context, en: s.keywords }, shown);
  const price = (p) => Number(p.target_sale_price ?? p.sale_price);
  rows.push({
    request: context.slice(0, 50),
    keywords: s.keywords.slice(0, 40),
    budget: s.min || s.max ? `${s.min ?? 0}-${s.max ?? "∞"}` : "",
    shown: shown.length,
    relevant: exact.length + partial.length,
    exact: exact.length,
    priceOk: shown.every((p) => (!s.max || price(p) <= s.max) && (!s.min || price(p) >= s.min)) ? "✓" : "✗",
    wrong: shown.filter((p) => !exact.includes(p) && !partial.includes(p)).map((p) => String(p.product_title).slice(0, 22)).join(" ; "),
    s: ((Date.now() - t) / 1000).toFixed(1),
  });
}
console.table(rows);
const judged = rows.filter((r) => r.shown);
const avg = (f) => ((judged.reduce((a, r) => a + f(r), 0) / (judged.length || 1)) * 100).toFixed(0);
console.log(`advisor precision@4: ${avg((r) => r.relevant / r.shown)}% right item · ${avg((r) => r.exact / r.shown)}% match every answer · empty: ${rows.length - judged.length}/${rows.length} · price range kept: ${rows.filter((r) => r.priceOk === "✓").length}/${rows.length}`);
