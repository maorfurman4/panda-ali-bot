import { test } from "node:test";
import assert from "node:assert/strict";
import { parseEvaluateRate, filterProducts, formatResults, formatLinkReply, esc, RLM, DISCLOSURE, HELP } from "../format.js";

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

const product = (over = {}) => ({
  product_title: "Wireless Earbuds",
  target_sale_price: "45.90",
  target_sale_price_currency: "ILS",
  evaluate_rate: "96.5%",
  lastest_volume: "1234",
  promotion_link: "https://s.click.aliexpress.com/e/_abc",
  ...over,
});

test("formats results as one HTML message with feedback %, orders, price and link", () => {
  const html = formatResults([product()]);
  assert.match(html, /96% משוב חיובי/);
  assert.match(html, /1,234 הזמנות/);
  assert.match(html, /45\.90 ₪/);
  assert.match(html, /<a href="https:\/\/s\.click\.aliexpress\.com\/e\/_abc">לקנייה<\/a>/);
  assert.ok(html.includes(DISCLOSURE));
});

test("displays the currency the API returned", () => {
  assert.match(formatResults([product({ target_sale_price: "12.5", target_sale_price_currency: "USD" })]), /12\.5 \$/);
  assert.match(formatResults([product({ target_sale_price: "9", target_sale_price_currency: "EUR" })]), /9 EUR/);
});

test("omits the feedback line when evaluate_rate is missing or unparseable, never shows 0", () => {
  for (const evaluate_rate of [undefined, "", "garbage"]) {
    const html = formatResults([product({ evaluate_rate })]);
    assert.doesNotMatch(html, /משוב חיובי/);
    assert.doesNotMatch(html, /\b0%/);
  }
});

test("prefixes every line with RLM", () => {
  const html = formatResults([product(), product({ product_title: "2 Pack Cable" }), product({ product_title: "line one\nline two" })]);
  for (const line of html.split("\n")) assert.ok(line.startsWith(RLM), JSON.stringify(line));
  for (const line of formatLinkReply("https://s.click.aliexpress.com/e/_x").split("\n")) assert.ok(line.startsWith(RLM));
});

test("escapes API-supplied titles and URLs", () => {
  const html = formatResults([product({ product_title: '<b>Hack</b> & "Co"', promotion_link: 'https://x.com/?a=1&b="2"><script>' })]);
  assert.ok(html.includes("&lt;b&gt;Hack&lt;/b&gt; &amp; &quot;Co&quot;"));
  assert.ok(html.includes('href="https://x.com/?a=1&amp;b=&quot;2&quot;&gt;&lt;script&gt;"'));
  assert.doesNotMatch(html, /<script>/);
  assert.equal(esc("<a&b>\""), "&lt;a&amp;b&gt;&quot;");
});

test("marks demo results and demo links", () => {
  assert.match(formatResults([product()], { demo: true }), /\[דמו\]/);
  assert.match(formatLinkReply("https://example.com/demo", { demo: true }), /\[דמו\]/);
});

test("help text includes the disclosure", () => {
  assert.ok(HELP.includes(DISCLOSURE));
});
