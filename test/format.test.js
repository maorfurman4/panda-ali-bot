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
  discountLine,
  formatCard,
  formatLinkReply,
  parsedLength,
  withinPrice,
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

test("title: one line, max ~30 chars, cut at a word boundary, brand words intact", () => {
  assert.equal(
    shortTitle("אוזניות אלחוטיות Baseus Bowie E19 Bluetooth 5.3 עם ביטול רעשים"),
    "אוזניות אלחוטיות Baseus Bowie…",
  );
  assert.equal(shortTitle("כבל USB-C"), "כבל USB-C");
  assert.equal(shortTitle("line one\nline   two"), "line one line two");
  const oneWord = shortTitle("x".repeat(60));
  assert.equal([...oneWord].length, 30);
  assert.ok(oneWord.endsWith("…"));
});

test("sold: exact under 100, 2 significant digits + '+' from 100", () => {
  assert.equal(soldText("87"), "87");
  assert.equal(soldText(87), "87");
  assert.equal(soldText("100"), "100+");
  assert.equal(soldText("155"), "150+");
  assert.equal(soldText("1874"), "1,800+");
  assert.equal(soldText(5230), "5,200+");
  assert.equal(soldText("987654"), "980,000+");
  for (const bad of ["0", undefined, "x", ""]) assert.equal(soldText(bad), null, String(bad));
});

test("rating: stars+reviews first, then rounded feedback %, never 0, never % as stars", () => {
  assert.equal(ratingText({ avgStars: 4.83, reviewCount: 1234, evaluate_rate: "97%" }), "⭐ דירוג: 4.8 (1,234 ביקורות)");
  assert.equal(ratingText({ avgStars: 5, reviewCount: 12 }), "⭐ דירוג: 5.0 (12 ביקורות)");
  assert.equal(ratingText({ evaluate_rate: "96.5%" }), "👍 משוב חיובי: 97%");
  assert.equal(ratingText({ avgStars: 0, reviewCount: 0, evaluate_rate: "92%" }), "👍 משוב חיובי: 92%");
  assert.equal(ratingText({ evaluate_rate: "0%" }), null);
  assert.equal(ratingText({}), null);
});

test("original price is wrapped in <s> (strikethrough) inside the HTML caption", () => {
  const { caption } = formatCard([full(1)], { query: "x" });
  assert.ok(caption.includes("<s>₪69.90</s>"));
});

test("withinPrice drops ILS products above the cap and ignores the cap for other currencies", () => {
  const p = (price, currency = "ILS") => ({ target_sale_price: price, target_sale_price_currency: currency });
  assert.deepEqual(withinPrice([p("40"), p("50"), p("60")], 50).map((x) => x.target_sale_price), ["40", "50"]);
  assert.equal(withinPrice([p("99", "USD")], 50).length, 1);
  assert.equal(withinPrice([p("99")], null).length, 1);
});

test("price and discount lines: exact strings, discount only for 5% ≤ discount < 80%", () => {
  const p = (sale, original) => ({ target_sale_price: sale, target_original_price: original, target_sale_price_currency: "ILS" });
  assert.equal(priceLine(p("39.90", "69.90")), "💰 מחיר: <b>₪39.90</b>");
  assert.equal(discountLine(p("39.90", "69.90")), "🏷️ לפני הנחה: <s>₪69.90</s> 🔥 43%-");
  assert.equal(discountLine(p("59.00", "399.00")), null, "≥80% discount: inflated original is not shown");
  assert.equal(discountLine(p("31.70", "33.00")), null, "<5% discount: not shown");
  assert.equal(discountLine(p("24.50", undefined)), null);
  assert.equal(discountLine(p("24.50", "20.00")), null, "original below sale is ignored");
  assert.equal(discountLine({ sale_price: "9.5", original_price: "19", sale_price_currency: "USD" }), "🏷️ לפני הנחה: <s>USD 19.00</s> 🔥 50%-");
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

test("card layout: group link header, each detail on its own line, visible link per product, RLM everywhere", () => {
  const { caption } = formatCard([full(1), full(2)], { query: "אוזניות" });
  const lines = caption.split("\n");
  for (const line of lines) assert.ok(line.startsWith(RLM), JSON.stringify(line));
  const body = lines.map((l) => l.slice(1));
  assert.deepEqual(body.slice(0, 9), [
    '🐼 <a href="https://t.me/panda_deals_il">פנדה אקספרס</a>',
    "🔎 <b>אוזניות</b>",
    "",
    "🥇 <b>אוזניות אלחוטיות Baseus Bowie…</b>",
    "💰 מחיר: <b>₪39.90</b>",
    "🏷️ לפני הנחה: <s>₪69.90</s> 🔥 43%-",
    "⭐ דירוג: 4.8 (1,234 ביקורות)",
    "🛒 נמכרו: 5,200+",
    "🔗 https://s.click.aliexpress.com/e/_1",
  ]);
  assert.match(body[10], /^🥈 /);
  assert.doesNotMatch(caption, /קישורי שותפים/);
});

test("card: demo label on the query line only; query escaped and max 30 chars", () => {
  const { caption } = formatCard([full(1)], { query: "<b>" + "א".repeat(40), demo: true });
  const queryLine = caption.split("\n")[1];
  assert.ok(queryLine.includes("&lt;b&gt;"));
  assert.ok(queryLine.endsWith(" [דמו – תוצאות קבועות]"));
  assert.equal(caption.match(/\[דמו/g).length, 1);
  const shownQuery = queryLine.match(/<b>(.*)<\/b>/)[1].replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  assert.ok([...shownQuery].length <= 30);
});

test("card: missing details drop their own line; ranks 4–5 use keycaps", () => {
  const bare = full(1, { evaluate_rate: undefined, lastest_volume: undefined, avgStars: undefined, reviewCount: undefined, target_original_price: undefined });
  const { caption } = formatCard([bare], { query: "x" });
  assert.equal(caption.split("\n").length, 6, "brand, query, blank, title, price, link");
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
  assert.ok(HELP.includes("מספר המכירות הוא לפי עלי אקספרס, בתקופה האחרונה"));
  assert.equal(GROUP_HELP, `${RLM}🐼 כתבו "חפש לי ..." ואמצא לכם מוצרים. הסבר מלא בפרטי 👈`);
});
