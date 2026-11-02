// Advisor quality end to end: a general request -> the bot's questions (answered by a fixed button pattern) -> search.
// A judge AI (gpt-5.4-mini by default) checks each of the 4 products against the request AND the answers.
// Each shown question also lists what each button would find on AliExpress (best sellers that pass the quality filter).
// --save file keeps the questions asked; --replay file asks the same ones again while the same buttons are picked (less
// noise between two versions); --check runs the bot's button check on every question.
// Usage: npm run eval:advice [-- --judge gpt-5.4-mini] [-- --save a.json | --replay a.json] [-- --check]
import { readFileSync, writeFileSync } from "node:fs";
import { createUnderstander, createRelevanceFilter, createAdvisor } from "../query.js";
import { searchProducts, isMockMode } from "../aliexpress.js";
import { pickProducts, optionSales, checkOptions } from "../bot.js";

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
const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : null; };
const replay = arg("replay") ? JSON.parse(readFileSync(arg("replay"))) : {};
const check = process.argv.includes("--check");
const saved = {};
const STRONG = 100; // sold: a product that real shoppers buy
const median = (a) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor((a.length - 1) / 2)] : 0);

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
  // A recorded step is reused while the path of picked labels is the same as in the recorded run.
  const path = (h) => [request, ...h.map((x) => x.a)].join(" > ");
  const rec = replay[request] ?? {};
  const ask = async (history) => rec[path(history)] ?? (await advise({ request, history }));
  const steps = (saved[request] = {});
  let step = intent?.status === "clarify" ? { question_he: intent.clarify_question_he, options: intent.options } : await ask([]);
  const s = { history: [], keywords: intent?.keywords_en || request, min: intent?.min_price_ils ?? null, max: intent?.max_price_ils ?? null };
  const buttons = [];
  for (const pick of picks) {
    if (!step?.options?.length) break;
    steps[path(s.history)] = step;
    // The same button as the recorded run when it is still shown (by its label), so two versions take the same path.
    const want = step.options[Math.min(pick, step.options.length - 1)].label_he;
    if (check) step = { ...step, options: await checkOptions(searchProducts, step.options, { minIls: s.min, maxIls: s.max }) };
    const strength = await Promise.all(step.options.map((o) => (o.min_price_ils || o.max_price_ils ? null : optionSales(searchProducts, o.keywords_en, { minIls: s.min, maxIls: s.max }).catch(() => null))));
    buttons.push(step.options.map((o, i) => `${o.label_he} ${strength[i] ? strength[i].filter((n) => n >= STRONG).length : "-"}`).join(" · "));
    const o = step.options.find((x) => x.label_he === want) ?? step.options[Math.min(pick, step.options.length - 1)];
    s.history.push({ q: step.question_he, a: o.label_he });
    s.broad ??= o.keywords_en;
    Object.assign(s, { keywords: o.keywords_en, min: o.min_price_ils ?? s.min, max: o.max_price_ils ?? s.max });
    if (s.history.length >= MAX_QUESTIONS) break;
    const next = await ask(s.history);
    if (next) steps[path(s.history)] = next;
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
    sold: median(shown.map((p) => Number(p.lastest_volume) || 0)),
    priceOk: shown.every((p) => (!s.max || price(p) <= s.max) && (!s.min || price(p) >= s.min)) ? "✓" : "✗",
    wrong: shown.filter((p) => !exact.includes(p) && !partial.includes(p)).map((p) => String(p.product_title).slice(0, 22)).join(" ; "),
    s: ((Date.now() - t) / 1000).toFixed(1),
  });
  Object.defineProperty(rows.at(-1), "buttons", { value: buttons, enumerable: false });
}
console.table(rows);
for (const r of rows) console.log(`${r.request}\n   ${r.buttons.join("\n   ")}`);
if (arg("save")) writeFileSync(arg("save"), JSON.stringify(saved, null, 1));
const judged = rows.filter((r) => r.shown);
const avg = (f) => ((judged.reduce((a, r) => a + f(r), 0) / (judged.length || 1)) * 100).toFixed(0);
console.log(`advisor precision@4: ${avg((r) => r.relevant / r.shown)}% right item · ${avg((r) => r.exact / r.shown)}% match every answer · empty: ${rows.length - judged.length}/${rows.length} · median sold ${median(judged.map((r) => r.sold))} · price range kept: ${rows.filter((r) => r.priceOk === "✓").length}/${rows.length}`);
