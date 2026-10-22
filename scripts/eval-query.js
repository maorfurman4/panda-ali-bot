// Runs sample Hebrew queries through the AI only (no AliExpress, no Telegram) and prints what it understood.
// Usage: npm run eval:query
import { createUnderstander } from "../query.js";

if (!process.env.ANTHROPIC_API_KEY) {
  console.log("ANTHROPIC_API_KEY is empty. Add it with: ./set-key.sh ANTHROPIC_API_KEY — then run again.");
  process.exit(0);
}

const QUERIES = [
  "אושניות",
  "אזניות אלחוטיות",
  "מטען לאייפון",
  "כבל usb c",
  "מנורת לילה לילדים",
  "אוזניות עד 50 שקל",
  "שעון חכם לריצה",
  "מתנה לאמא",
  "משהו לבית",
  "מה נשמע",
  "בקבוק מים תרמי 500 מל",
  "מעמד לטלפון לרכב",
];

const understand = createUnderstander();
const rows = [];
for (const query of QUERIES) {
  const started = Date.now();
  const r = await understand(query);
  rows.push({
    query,
    status: r?.status ?? "FAIL-OPEN",
    corrected_he: r?.corrected_he ?? "",
    keywords_en: r?.keywords_en ?? "",
    max_price: r?.max_price_ils ?? "",
    options: r?.options?.map((o) => `${o.label_he}=${o.keywords_en}`).join(" | ") ?? "",
    ms: Date.now() - started,
  });
}
console.table(rows);
