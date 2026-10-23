// Live check of everything the bot depends on (AI, AliExpress, the server). Exits 1 on any failure,
// so the daily GitHub Action turns a broken dependency (e.g. a deprecated AI model) into an email.
// Usage: npm run check:live   (optional: SERVER_URL=https://panda-ali-bot.onrender.com)
import { createUnderstander } from "../query.js";
import { searchProducts, generateAffiliateLink, isMockMode } from "../aliexpress.js";

const results = [];
async function check(name, fn) {
  const t = Date.now();
  try {
    results.push({ check: name, ok: "✅", detail: String(await fn()).slice(0, 80), ms: Date.now() - t });
  } catch (e) {
    results.push({ check: name, ok: "❌", detail: e.message.slice(0, 80), ms: Date.now() - t });
  }
}

await check("AI: Hebrew typo -> English keywords", async () => {
  const r = await createUnderstander()("אושניות");
  if (r?.status !== "ok" || !/ear|head/i.test(r.keywords_en)) throw new Error(`unexpected: ${JSON.stringify(r)}`);
  return r.keywords_en;
});
await check("AI: chit-chat is not a product", async () => {
  const r = await createUnderstander()("מה נשמע");
  if (r?.status !== "not_product") throw new Error(`got ${r?.status ?? "no answer (AI failed)"}`);
  return r.status;
});

if (isMockMode()) {
  results.push({ check: "AliExpress", ok: "❌", detail: "mock mode: ALI_APP_KEY / ALI_APP_SECRET / ALI_TRACKING_ID missing", ms: 0 });
} else {
  let first;
  await check("AliExpress: search, ILS, short links", async () => {
    const products = await searchProducts("usb cable");
    if (products.length < 5) throw new Error(`only ${products.length} products`);
    if (products[0].target_sale_price_currency !== "ILS") throw new Error(`currency ${products[0].target_sale_price_currency}`);
    if (!products.every((p) => p.promotion_link?.startsWith("https://s.click.aliexpress.com/"))) throw new Error("links are not short affiliate links");
    first = products[0];
    return `${products.length} products`;
  });
  await check("AliExpress: affiliate link for a product", async () => {
    if (!first) throw new Error("skipped: search failed");
    return generateAffiliateLink(`https://www.aliexpress.com/item/${first.product_id}.html`);
  });
}

if (process.env.SERVER_URL) {
  await check("Server: /health (wakes it up)", async () => {
    const r = await (await fetch(`${process.env.SERVER_URL}/health`, { signal: AbortSignal.timeout(90_000) })).json();
    if (!r.ok || r.mock) throw new Error(JSON.stringify(r));
    return `${r.mode}, real data`;
  });
}

console.table(results);
if (results.some((r) => r.ok !== "✅")) process.exit(1);
