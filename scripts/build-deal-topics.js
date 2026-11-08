// Builds deal-topics.json, the deals channel's topics (owner, 2026-11-08: all the sub-categories studied for the search
// bot, not 48). Free: AliExpress searches only, no AI. A term is kept when its search finds at least MIN_ITEMS products
// that pass the channel's own filters (candidates(): 3,000+ sold, ≈4.7 stars, a link and a photo).
// Input: research_notes/deal-terms.jsonl (the 1,000 and 1,500 checks' terms) plus the 48 proven TOPICS.
// Usage: node --env-file=.env scripts/build-deal-topics.js
import { readFileSync, writeFileSync } from "node:fs";
import { searchProducts } from "../aliexpress.js";
import { candidates, TOPICS, CATS } from "../deals.js";

const MIN_ITEMS = 3;
const AT_ONCE = 8; // 2 searches each: 16 calls at once; AppCallLimit came at ~3 search-bot searches (30-45 calls)

const byId = Object.fromEntries(Object.entries(CATS).filter(([, c]) => c.id).map(([name, c]) => [c.id, name]));
const terms = [
  ...TOPICS.map(([kw, id]) => ({ kw, he: null, cat: byId[id] ?? "Home & Garden" })),
  ...readFileSync(new URL("../research_notes/deal-terms.jsonl", import.meta.url), "utf8").trim().split("\n").map((l) => JSON.parse(l)),
];
const seen = new Set();
// Not for a public deals channel: lingerie and intimate wear (socks, undershirts and loungewear stay), and hobby electronics
// (soldering, boards, modules) that few readers want (2026-11-08).
export const SKIP = /\b(bra|panties|thong|g string|lingerie|nipple|fishnet|pantyhose|briefs|camisole)\b/i;
const SKIP_CATS = new Set(["Electronic Components", "Food"]); // food from abroad: customs and kashrut
const KEEP_ANYWAY = /\b(micro sd|led strip)\b/i; // everyday items listed under the hobby category
const todo = terms.filter((t) => CATS[t.cat] && !SKIP.test(t.kw) && (!SKIP_CATS.has(t.cat) || KEEP_ANYWAY.test(t.kw)) && !seen.has(t.kw.toLowerCase()) && seen.add(t.kw.toLowerCase()));

const kept = [];
let done = 0;
async function one(t) {
  const id = CATS[t.cat].id;
  const [inCategory, anywhere] = await Promise.all([id ? searchProducts(t.kw, { category: id, shorten: false }).catch(() => []) : [], searchProducts(t.kw, { shorten: false }).catch(() => [])]);
  const good = candidates([...inCategory, ...anywhere]);
  if (good.length >= MIN_ITEMS) kept.push({ words: t.kw, he: t.he, cat: t.cat, category: id, windows: CATS[t.cat].windows, items: good.length, top: Number(good[0].lastest_volume) });
  if (++done % 100 === 0) console.log(`${done}/${todo.length} checked, ${kept.length} kept`);
}
for (let i = 0; i < todo.length; i += AT_ONCE) await Promise.all(todo.slice(i, i + AT_ONCE).map(one));

kept.sort((a, b) => a.cat.localeCompare(b.cat) || b.top - a.top);
writeFileSync(new URL("../deal-topics.json", import.meta.url), JSON.stringify(kept, null, 0).replace(/\},\{/g, "},\n{") + "\n");
const per = {};
for (const t of kept) for (const w of t.windows) per[w] = (per[w] ?? 0) + 1;
console.log(`kept ${kept.length} of ${todo.length}; per window: ${JSON.stringify(per)}`);
