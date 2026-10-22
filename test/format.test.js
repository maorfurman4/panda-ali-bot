import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseEvaluateRate,
  filterProducts,
  formatPrice,
  shortTitle,
  soldText,
  ratingText,
  priceLine,
  formatCard,
  formatLinkReply,
  parsedLength,
  esc,
  RLM,
  DISCLOSURE,
  HELP,
  GROUP_HELP,
} from "../format.js";

test("parses evaluate_rate strings safely", () => {
  assert.equal(parseEvaluateRate("96.5%"), 96.5);
  assert.equal(parseEvaluateRate(" 100% "), 100);
  assert.equal(parseEvaluateRate("92"), 92);
  for (const bad of ["", undefined, null, "garbage", "96.5%%", "abc%", "150%", "-3%", {}, NaN]) {
    assert.equal(parseEvaluateRate(bad), null, String(bad));
  }
});

test("drops products whose positive feedback is present and below 90, keeps API order", () => {
  const products = [
    { product_id: "a", evaluate_rate: "95.0%" },
    { product_id: "b", evaluate_rate: "89.9%" },
    { product_id: "c" },
    { product_id: "d", evaluate_rate: "garbage" },
    { product_id: "e", evaluate_rate: "90%" },
  ];
  assert.deepEqual(filterProducts(products).map((p) => p.product_id), ["a", "c", "d", "e"]);
});

test("price: ₪ only for ILS, otherwise the currency code; always 2 decimals", () => {
  assert.equal(formatPrice("39.9", "ILS"), "₪39.90");
  assert.equal(formatPrice("12.5", "USD"), "USD 12.50");
  assert.equal(formatPrice(undefined, "ILS"), null);
  assert.equal(formatPrice("abc", "ILS"), null);
});

test("title: one line, max ~40 chars, cut at a word boundary, brand words intact", () => {
  assert.equal(
    shortTitle("אוזניות אלחוטיות Baseus Bowie E19 Bluetooth 5.3 עם ביטול רעשים"),
    "אוזניות אלחוטיות Baseus Bowie E19…",
  );
  assert.equal(shortTitle("כבל USB-C"), "כבל USB-C");
  assert.equal(shortTitle("line one\nline   two"), "line one line two");
  const oneWord = shortTitle("x".repeat(60));
  assert.equal([...oneWord].length, 40);
  assert.ok(oneWord.endsWith("…"));
});

test("sold: exact under 100, 2 significant digits + '+' from 100, label 'נמכרו לאחרונה'", () => {
  assert.equal(soldText("87"), "87 נמכרו לאחרונה");
  assert.equal(soldText("100"), "100+ נמכרו לאחרונה");
  assert.equal(soldText("155"), "150+ נמכרו לאחרונה");
  assert.equal(soldText("1874"), "1,800+ נמכרו לאחרונה");
  assert.equal(soldText("5230"), "5,200+ נמכרו לאחרונה");
  assert.equal(soldText("987654"), "980,000+ נמכרו לאחרונה");
  for (const bad of ["0", undefined, "x", ""]) assert.equal(soldText(bad), null, String(bad));
});

test("rating: stars+reviews first, then rounded feedback %, never 0, never % as stars", () => {
  assert.equal(ratingText({ avgStars: 4.83, reviewCount: 1234, evaluate_rate: "97%" }), "⭐ 4.8 (1,234 ביקורות)");
  assert.equal(ratingText({ avgStars: 5, reviewCount: 12 }), "⭐ 5.0 (12 ביקורות)");
  assert.equal(ratingText({ evaluate_rate: "96.5%" }), "👍 97% משוב חיובי");
  assert.equal(ratingText({ avgStars: 0, reviewCount: 0, evaluate_rate: "92%" }), "👍 92% משוב חיובי");
  assert.equal(ratingText({ evaluate_rate: "0%" }), null);
  assert.equal(ratingText({}), null);
});

test("price line: exact strings, badge only for 5% ≤ discount < 80%", () => {
  const p = (sale, original) => ({ target_sale_price: sale, target_original_price: original, target_sale_price_currency: "ILS" });
  assert.equal(priceLine(p("39.90", "69.90")), "💰 <b>₪39.90</b>  <s>₪69.90</s>  🔥 43%-");
  assert.equal(priceLine(p("59.00", "399.00")), "💰 <b>₪59.00</b>", "≥80% discount: inflated original is not shown");
  assert.equal(priceLine(p("31.70", "33.00")), "💰 <b>₪31.70</b>", "<5% discount: no badge");
  assert.equal(priceLine(p("24.50", undefined)), "💰 <b>₪24.50</b>");
  assert.equal(priceLine(p("24.50", "20.00")), "💰 <b>₪24.50</b>", "original below sale is ignored");
  assert.equal(priceLine({ sale_price: "9.5", original_price: "19", sale_price_currency: "USD" }), "💰 <b>USD 9.50</b>  <s>USD 19.00</s>  🔥 50%-");
  assert.equal(priceLine({}), null);
});

const full = (n, over = {}) => ({
  product_title: `אוזניות אלחוטיות Baseus Bowie E${n} Bluetooth 5.3 עם ביטול רעשים ENC וסוללה ל-30 שעות`,
  product_main_image_url: "https://ae01.alicdn.com/kf/x.jpg",
  target_sale_price: "39.90",
  target_original_price: "69.90",
  target_sale_price_currency: "ILS",
  evaluate_rate: "97.8%",
  lastest_volume: "5230",
  avgStars: 4.8,
  reviewCount: 1234,
  promotion_link: `https://s.click.aliexpress.com/e/_${n}`,
  ...over,
});

test("card layout: header, medal title lines, price and rating lines, RLM everywhere", () => {
  const { caption } = formatCard([full(1), full(2)], { query: "אוזניות" });
  const lines = caption.split("\n");
  for (const line of lines) assert.ok(line.startsWith(RLM), JSON.stringify(line));
  const body = lines.map((l) => l.slice(1));
  assert.deepEqual(body.slice(0, 5), [
    "🔎 <b>אוזניות</b>",
    "",
    "🥇 <b>אוזניות אלחוטיות Baseus Bowie E1…</b>",
    "💰 <b>₪39.90</b>  <s>₪69.90</s>  🔥 43%-",
    "⭐ 4.8 (1,234 ביקורות) · 🛒 5,200+ נמכרו לאחרונה",
  ]);
  assert.match(body[6], /^🥈 /);
  assert.doesNotMatch(caption, /לקנייה|קישורי שותפים/);
});

test("card: demo label in header only; query escaped and max 30 chars", () => {
  const { caption } = formatCard([full(1)], { query: "<b>" + "א".repeat(40), demo: true });
  const header = caption.split("\n")[0];
  assert.ok(header.includes("&lt;b&gt;"));
  assert.match(header, /\[דמו\]/);
  assert.equal(caption.match(/\[דמו\]/g).length, 1);
  const shownQuery = header.match(/<b>(.*)<\/b>/)[1].replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  assert.ok([...shownQuery].length <= 30);
});

test("card: rating+sold line dropped when both are missing; ranks 4–5 use keycaps", () => {
  const bare = full(1, { evaluate_rate: undefined, lastest_volume: undefined, avgStars: undefined, reviewCount: undefined });
  const { caption } = formatCard([bare], { query: "x" });
  assert.equal(caption.split("\n").length, 4, "header, blank, title, price");
  const five = formatCard([1, 2, 3, 4, 5].map((n) => full(n)), { query: "x" });
  assert.match(five.caption, /4️⃣ /);
  assert.match(five.caption, /5️⃣ /);
});

test("card buttons: one per product with medal + price; 3 per row; invalid links skipped", () => {
  const three = formatCard([full(1), full(2, { target_sale_price: "24.5" }), full(3)], { query: "x" });
  assert.deepEqual(three.buttons, [[
    { text: "🥇 ₪39.90", url: "https://s.click.aliexpress.com/e/_1" },
    { text: "🥈 ₪24.50", url: "https://s.click.aliexpress.com/e/_2" },
    { text: "🥉 ₪39.90", url: "https://s.click.aliexpress.com/e/_3" },
  ]]);
  const five = formatCard([1, 2, 3, 4, 5].map((n) => full(n)), { query: "x" });
  assert.deepEqual(five.buttons.map((r) => r.length), [3, 2]);
  const bad = formatCard([full(1, { promotion_link: "javascript:alert(1)" })], { query: "x" });
  assert.deepEqual(bad.buttons, []);
});

test("caption stays ≤ 1024 parsed chars with the longest realistic titles; extra items are dropped", () => {
  const long = (n) => full(n, { product_title: "ש".repeat(200) + " Xiaomi Redmi " + "ב".repeat(200), target_sale_price: "1234.56", target_original_price: "9999.99" });
  const five = formatCard([1, 2, 3, 4, 5].map(long), { query: "ק".repeat(80), demo: true });
  assert.ok(parsedLength(five.caption) <= 1024, `parsed length ${parsedLength(five.caption)}`);
  const many = formatCard(Array.from({ length: 30 }, (_, i) => long(i)), { query: "x" });
  assert.ok(parsedLength(many.caption) <= 1024);
  const shown = many.caption.split("\n").filter((l) => /^‏(🥇|🥈|🥉|\d️⃣)/u.test(l)).length;
  assert.equal(many.buttons.flat().length, shown, "one button per shown product");
});

test("no unsupported claims, no exclamation marks, max 2 emoji per line", () => {
  const { caption } = formatCard([1, 2, 3, 4, 5].map((n) => full(n)), { query: "x" });
  assert.doesNotMatch(caption, /משלוח חינם|מלאי מוגבל|מבצע בזק|!/);
  for (const line of caption.split("\n")) {
    const emoji = line.match(/\p{Extended_Pictographic}/gu) ?? [];
    assert.ok(emoji.length <= 2, `${emoji.length} emoji in ${JSON.stringify(line)}`);
  }
});

test("parsedLength counts text after HTML parsing (UTF-16 units)", () => {
  assert.equal(parsedLength("<b>a&amp;b</b> &lt;i&gt;"), "a&b <i>".length);
});

test("link reply: link only, demo label, no disclosure, RLM on each line", () => {
  const reply = formatLinkReply("https://s.click.aliexpress.com/e/_x?a=1&b=2");
  assert.equal(reply, `${RLM}🔗 הנה הקישור:\n${RLM}https://s.click.aliexpress.com/e/_x?a=1&amp;b=2`);
  assert.match(formatLinkReply("https://example.com/demo", { demo: true }), /\[דמו\]/);
  assert.equal(esc('<a&b>"'), "&lt;a&amp;b&gt;&quot;");
});

test("help texts: private keeps the full disclosure sentence; group help is one line", () => {
  assert.ok(HELP.includes(DISCLOSURE));
  assert.match(HELP, /חפש לי/);
  assert.match(HELP, /מצא לי/);
  assert.equal(GROUP_HELP, `${RLM}🐼 כתבו "חפש לי ..." ואמצא לכם מוצרים. הסבר מלא בפרטי 👈`);
});
