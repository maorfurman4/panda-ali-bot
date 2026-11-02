// Runs 12 sample Hebrew queries through the AI only (no AliExpress, no Telegram) and scores them.
// Usage: npm run eval:query [-- --model gpt-6-luna] [-- --budget 0.05]
import { createUnderstander } from "../query.js";

// USD per 1M tokens, from https://developers.openai.com/api/docs/pricing (read 2026-10-22).
const PRICES = {
  "gpt-6-luna": [0.1, 0.5],
  "gpt-5.6-luna": [0.2, 1.2],
  "gpt-5.4-nano": [0.2, 1.25],
  "gpt-5-nano": [0.05, 0.4],
  "gpt-4.1-nano": [0.1, 0.4],
};

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const model = arg("model", process.env.OPENAI_MODEL || "gpt-5.4-nano");
const budget = Number(arg("budget", "0.05"));

if (!process.env.OPENAI_API_KEY) {
  console.log("OPENAI_API_KEY is empty. Add it with: ./set-key.sh OPENAI_API_KEY — then run again.");
  process.exit(0);
}
if (!PRICES[model]) console.log(`⚠️ No price on file for ${model}; cost will show as 0.`);

const EARBUDS = /earbuds|earphones|headphones|headset/i;
// Expected answer per query: status, plus checks on corrected_he / keywords_en / max price.
const CASES = [
  { q: "אושניות", status: "ok", he: /אוזניות/, kw: [EARBUDS] },
  { q: "אזניות אלחוטיות", status: "ok", kw: [/wireless|bluetooth/i, EARBUDS] },
  { q: "מטען לאייפון", status: "ok", kw: [/charger/i, /iphone|lightning/i] },
  { q: "כבל usb c", status: "ok", kw: [/usb[- ]?c|type[- ]?c/i, /cable/i] },
  { q: "מנורת לילה לילדים", status: "ok", kw: [/night ?(light|lamp)/i] },
  { q: "אוזניות עד 50 שקל", status: "ok", kw: [EARBUDS], noKw: /\d/, max: 50 },
  { q: "שעון חכם לריצה", status: "ok", kw: [/smart ?watch|running watch|gps watch|sport watch/i] },
  { q: "מתנה לאמא", status: "clarify" },
  // Live test 2026-11-02
  { q: "חודים לאייפד", status: "ok", kw: [/tip|nib|pencil/i], noKw: /case|cover/i },
  { q: "מכונת גילוח עם דירוג", status: "ok", kw: [/clipper|trimmer/i], noKw: /foil|rotary/i },
  { q: "מגן לאייפון", status: "ok", kw: [/case|cover/i, /iphone/i] },
  { q: "נעלי ספורט לבנות", status: "clarify" },
  { q: "נעלי ספורט בצבע לבן", status: "ok", kw: [/white/i] },
  { q: "משהו לבית", status: "clarify" },
  { q: "מה נשמע", status: "not_product" },
  { q: "בקבוק מים תרמי 500 מל", status: "ok", kw: [/thermos|insulated|vacuum|thermal/i, /500 ?ml/i] },
  { q: "מעמד לטלפון לרכב", status: "ok", kw: [/car/i, /phone/i, /holder|mount|stand/i] },
  // natural group sentences (no "חפש לי")
  { q: "מישהו מכיר מטען טוב לרכב?", status: "ok", kw: [/car/i, /charger/i] },
  { q: "יש המלצה על שואב אבק רובוטי?", status: "ok", kw: [/robot/i, /vacuum/i] },
  { q: "אני מחפש עבודה בתל אביב", status: "not_product" },
  { q: "מישהו מכיר את דני?", status: "not_product" },
];

function judge(c, r) {
  if (!r) return "fail-open";
  if (r.status !== c.status) return `status ${r.status}`;
  if (c.he && !c.he.test(r.corrected_he)) return "corrected_he";
  if (c.kw?.some((re) => !re.test(r.keywords_en))) return "keywords";
  if (c.noKw?.test(r.keywords_en)) return "price in keywords";
  if (c.max !== undefined && r.max_price_ils !== c.max) return `max ${r.max_price_ils}`;
  return "PASS";
}

let usage = null;
const understand = createUnderstander({ env: { ...process.env, OPENAI_MODEL: model }, onUsage: (u) => (usage = u) });
const [inPrice, outPrice] = PRICES[model] ?? [0, 0];
const rows = [];
const latencies = [];
let totalCost = 0;

for (const c of CASES) {
  if (totalCost > budget) {
    console.log(`Budget $${budget} reached — stopping early.`);
    break;
  }
  usage = null;
  const started = Date.now();
  const r = await understand(c.q);
  const ms = Date.now() - started;
  const cost = usage ? (usage.input_tokens * inPrice + usage.output_tokens * outPrice) / 1e6 : 0;
  totalCost += cost;
  latencies.push(ms);
  rows.push({
    query: c.q,
    status: r?.status ?? "FAIL-OPEN",
    corrected_he: r?.corrected_he ?? "",
    keywords_en: r?.keywords_en ?? "",
    max_price: r?.max_price_ils ?? "",
    options: r?.options?.map((o) => `${o.label_he}=${o.keywords_en}`).join(" | ") ?? "",
    ms,
    tokens: usage ? `${usage.input_tokens}+${usage.output_tokens}` : "",
    cost_usd: cost.toFixed(6),
    result: judge(c, r),
  });
}

const sorted = [...latencies].sort((a, b) => a - b);
console.log(`\nModel: ${model}`);
console.table(rows);
console.log(
  `Accuracy: ${rows.filter((r) => r.result === "PASS").length}/${rows.length} · ` +
    `p50 latency: ${sorted[Math.floor((sorted.length - 1) / 2)]} ms · max: ${sorted.at(-1)} ms · ` +
    `total cost: $${totalCost.toFixed(5)}`,
);
