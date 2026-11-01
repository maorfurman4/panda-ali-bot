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
  dedupeProducts,
  isPartFor,
  vatLine,
  esc,
  RLM,
  HELP,
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

test("title: first clause without seller filler, max 40 chars, cut at a word boundary, brand words intact", () => {
  assert.equal(
    shortTitle("אוזניות אלחוטיות Baseus Bowie E19 Bluetooth 5.3 עם ביטול רעשים"),
    "אוזניות אלחוטיות Baseus Bowie E19…",
  );
  assert.equal(shortTitle("כבל USB-C"), "כבל USB-C");
  assert.equal(shortTitle("line one\nline   two"), "line one line two");
  assert.equal(shortTitle("2022 חדש סתיו חורף מגפי נשים חמים, בעבודת יד"), "סתיו חורף מגפי נשים חמים");
  assert.equal(shortTitle("מנורת קריאה תלויה לצוואר - נטענת USB"), "מנורת קריאה תלויה לצוואר");
  assert.equal(shortTitle("נעלי נשים, מגפי פליז"), "נעלי נשים, מגפי פליז", "too-short first clause keeps the rest");
  assert.equal(shortTitle("2026 – מגפי פלטפורמה קלאסיות חדשות לנשים"), "מגפי פלטפורמה קלאסיות חדשות לנשים", "no leading dash");
  assert.equal(shortTitle("(קוד קופון:  HOT888) רובוט שואב אבק wd8, תרסיס מים"), "רובוט שואב אבק wd8", "no unverifiable coupon codes");
  const oneWord = shortTitle("x".repeat(60));
  assert.equal([...oneWord].length, 40);
  assert.ok(oneWord.endsWith("…"));
});

test("sold: exact under 100, 2 significant digits after 'מעל' from 100", () => {
  assert.equal(soldText("87"), "87");
  assert.equal(soldText(87), "87");
  assert.equal(soldText("100"), "מעל 100");
  assert.equal(soldText("155"), "מעל 150");
  assert.equal(soldText("1874"), "מעל 1,800");
  assert.equal(soldText(5230), "מעל 5,200");
  assert.equal(soldText("987654"), "מעל 980,000");
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
  assert.deepEqual(withinPrice([p("40"), p("90"), p("160")], 150, 80).map((x) => x.target_sale_price), ["90"], "80–150 range");
  assert.deepEqual(withinPrice([p("40"), p("90")], null, 80).map((x) => x.target_sale_price), ["90"]);
});

test("price and discount lines: exact strings, discount only for 5% ≤ discount < 80%", () => {
  const p = (sale, original) => ({ target_sale_price: sale, target_original_price: original, target_sale_price_currency: "ILS" });
  assert.equal(priceLine(p("39.90", "69.90")), "💰 מחיר: <b>₪39.90</b>");
  assert.equal(discountLine(p("39.90", "69.90")), "🏷️ במקום <s>₪69.90</s> · 43% הנחה 🔥");
  assert.equal(discountLine(p("59.00", "399.00")), null, "≥80% discount: inflated original is not shown");
  assert.equal(discountLine(p("31.70", "33.00")), null, "<5% discount: not shown");
  assert.equal(discountLine(p("24.50", undefined)), null);
  assert.equal(discountLine(p("24.50", "20.00")), null, "original below sale is ignored");
  assert.equal(discountLine({ sale_price: "9.5", original_price: "19", sale_price_currency: "USD" }), "🏷️ במקום <s>USD 19.00</s> · 50% הנחה 🔥");
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

test("card layout: query header, each detail on its own line, visible link per product, group link at the end, RLM everywhere", () => {
  const { caption } = formatCard([full(1), full(2)], { query: "אוזניות" });
  const lines = caption.split("\n");
  for (const line of lines) assert.ok(line.startsWith(RLM), JSON.stringify(line));
  const body = lines.map((l) => l.slice(1));
  assert.deepEqual(body.slice(-3), ["", "🐼 פנדה אקספרס", "https://t.me/panda_deals_il"], "group link at the end");
  assert.deepEqual(body.slice(0, 8), [
    "🔎 <b>אוזניות</b>",
    "",
    "🥇 <b>אוזניות אלחוטיות Baseus Bowie E1…</b>",
    "💰 מחיר: החל מ-<b>₪39.90</b>",
    "🏷️ במקום <s>₪69.90</s> · 43% הנחה 🔥",
    "⭐ דירוג: 4.8 (1,234 ביקורות)",
    "🛒 נמכרו: מעל 5,200",
    "🔗 https://s.click.aliexpress.com/e/_1",
  ]);
  assert.match(body[9], /^🥈 /);
  assert.doesNotMatch(caption, /קישורי שותפים/);
});

test("card: demo label on the query line only; query escaped and max 80 chars", () => {
  const { caption } = formatCard([full(1)], { query: "<b>" + "א".repeat(100), demo: true });
  const queryLine = caption.split("\n")[0];
  assert.ok(queryLine.includes("&lt;b&gt;"));
  assert.ok(queryLine.endsWith(" [דמו – תוצאות קבועות]"));
  assert.equal(caption.match(/\[דמו/g).length, 1);
  const shownQuery = queryLine.match(/<b>(.*)<\/b>/)[1].replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  assert.ok([...shownQuery].length <= 80);
});

test("card: missing details drop their own line; ranks 4–5 use keycaps", () => {
  const bare = full(1, { evaluate_rate: undefined, lastest_volume: undefined, avgStars: undefined, reviewCount: undefined, target_original_price: undefined });
  const { caption } = formatCard([bare], { query: "x" });
  assert.equal(caption.split("\n").length, 8, "query, blank, title, price, link, blank, brand, group link");
  const five = formatCard([1, 2, 3, 4, 5].map((n) => full(n)), { query: "x" });
  assert.match(five.caption, /4️⃣ /);
  assert.match(five.caption, /5️⃣ /);
});

test("card: a never-sold item says so", () => {
  assert.match(formatCard([full(1, { lastest_volume: "0" })], { query: "x" }).caption, /🆕 עוד לא נקנה/);
  assert.doesNotMatch(formatCard([full(1, { lastest_volume: "40" })], { query: "x" }).caption, /עוד לא נקנה/);
});

test("caption stays ≤ 1024 parsed chars with the longest realistic titles; extra items are dropped", () => {
  const long = (n) => full(n, { product_title: "ש".repeat(200) + " Xiaomi Redmi " + "ב".repeat(200), target_sale_price: "1234.56", target_original_price: "9999.99" });
  const five = formatCard([1, 2, 3, 4, 5].map(long), { query: "ק".repeat(80), demo: true });
  assert.ok(parsedLength(five.caption) <= 1024, `parsed length ${parsedLength(five.caption)}`);
  const many = formatCard(Array.from({ length: 30 }, (_, i) => long(i)), { query: "x" });
  assert.ok(parsedLength(many.caption) <= 1024);
  assert.equal(formatCard([full(1)], { query: "x" }).buttons, undefined, "no price buttons: links are in the text");
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

test("help text: for the group, how to search, no private-chat or affiliate wording", () => {
  assert.match(HELP, /חפש לי/);
  assert.match(HELP, /מתנה לאמא/);
  assert.doesNotMatch(HELP, /בפרטי|שותפים|עמלה|תייגו/);
});

test("dedupe: the same product from several sellers shows once (brand + model, or the same title start)", () => {
  const t = (product_title) => ({ product_title });
  const out = dedupeProducts([
    t("אוזניות גיימינג אלחוטיות BINNUNE BW06 Bluetooth עם מיקרופון"),
    t("אוזניות משחק אלחוטיות BINNUNE BW06 2.4GHz עם מיקרופון"),
    t("אוזניות Lenovo XT80 Bluetooth"),
    t("אוזניות Lenovo XT53 Bluetooth"),
    t("שטיח אפור כהה מעונב בצביעת טאי דאי, שטיחים שאגי"),
    t("שטיח אפור כהה מעונב בצביעת טאי דאי, לסלון"),
    t("אוזניות Bluetooth 5.3 ספורט"),
    t("2025 – מגפי פלטפורמה קלאסיות חדשות לנשים"),
    t("2026 – מגפי פלטפורמה קלאסיות חדשות, חמות"),
  ]).map((p) => p.product_title);
  assert.deepEqual(out, [
    "אוזניות גיימינג אלחוטיות BINNUNE BW06 Bluetooth עם מיקרופון",
    "אוזניות Lenovo XT80 Bluetooth",
    "אוזניות Lenovo XT53 Bluetooth",
    "שטיח אפור כהה מעונב בצביעת טאי דאי, שטיחים שאגי",
    "אוזניות Bluetooth 5.3 ספורט",
    "2025 – מגפי פלטפורמה קלאסיות חדשות לנשים",
  ]);
});

test("isPartFor: spare parts for the item are spotted, unless the shopper asked for parts; the item itself and cases are fine", () => {
  const req = "שואב אבק רובוטי";
  for (const t of ["חלקי חילוף לשואב אבק רובוטי Dreame X40", "אביזרים לשואב אבק רובוטי JONR P20", "אביזרים לשקי אבק רובוטיים Roborock",
    "שקיות חלופיות לשואב אבק רובוטי Dreame", "לרובוט השואב אבק Xiaomi X20 תיק אבק", "עבור xiaomi רובוט ואקום s20 חלקים",
    "מברשת צדית ראשית, מטלית, מסנן Hepa"]) assert.ok(isPartFor(t, req), t);
  for (const t of ["רובוט שואב אבק wd8, תרסיס מים כפול", "רובוט ניקוי חכם לשאיבה וסטאטוס"]) assert.ok(!isPartFor(t, req), t);
  assert.ok(!isPartFor("חלקי חילוף למברשות גליליות", "מברשות לשואב אבק רובוטי"), "parts were asked for");
  assert.ok(!isPartFor("כיסוי שקוף לאייפון 15 פרו", "כיסוי לאייפון 15"));
  // titles that start with the accessory's name (step 4: keyboard accessories, scooter batteries)
  for (const [t, req] of [["כבל מקלדת מכנית מסוג USB Type C", "מקלדת"], ["סט של 2 משענות יד בעיצוב כנפי מלאך", "מקלדת"], ["מעמד מיני מתקפל למחשב נייד", "מקלדת"],
    ["הרמת מקלדת 2 חלקים מעמד תמיכה", "מקלדת"], ["סוללת קטנוע חשמלי 48V 13S6P 20Ah", "קורקינט חשמלי"], ["רצועה לשעון חכם", "שעון חכם"]]) assert.ok(isPartFor(t, req), t);
  for (const [t, req] of [["מטען מהיר 65W GaN", "מטען 65W לגלקסי"], ["כבל טעינה מהירה לאייפון", "כבל לאייפון"], ["מקלדת אלחוטית מיני", "מקלדת"],
    ["מגן מסך לאייפון 15", "מגן מסך לאייפון"]]) assert.ok(!isPartFor(t, req), t);
});

test("VAT note: items above $75 (≈₪277) pay 18% VAT at checkout; cheaper or non-ILS items get no note", () => {
  assert.match(vatLine({ target_sale_price: "300", target_sale_price_currency: "ILS" }), /מע״מ 18%/);
  assert.equal(vatLine({ target_sale_price: "200", target_sale_price_currency: "ILS" }), null);
  assert.equal(vatLine({ sale_price: "300", sale_price_currency: "USD" }), null);
  assert.ok(isPartFor("כיסוי אוניברסלי לכיסא משרדי", "כיסא גיימינג"), "a chair cover isn't a chair (4-letter stem)");
});

test("dedupe: one store's listings with the same sales count (from 300 sold) are the same product", () => {
  const p = (id, shop, sold) => ({ product_id: id, product_title: `תיק קש ${id}`, shop_id: shop, lastest_volume: String(sold) });
  const out = dedupeProducts([p("a", 1, 2835), p("b", 1, 2835), p("c", 2, 2835), p("d", 3, 52), p("e", 3, 52)]).map((x) => x.product_id);
  assert.deepEqual(out, ["a", "c", "d", "e"], "another store or a small count is not a twin");
});

test("isPartFor: for a cushion request, a cushion cover is the item (mostly sold as covers); for a phone, a cover is still a part", () => {
  assert.equal(isPartFor("כיסוי כרית 45x45cm איכות גבוהה כיסוי כרית דקורטיבי לסלון", "כרית נוי לסלון"), false);
  assert.equal(isPartFor("ציפית כרית בוהו לבן קרם", "כריות נוי"), false);
  assert.equal(isPartFor("כיסוי כרית מלבני 30x50", "מטען לרכב"), true, "a cushion cover for another request is still a part-like title");
  assert.equal(isPartFor("כיסוי סיליקון לאייפון 15", "אייפון 15"), true);
});

test("offTheme: holiday items are left out unless the request names a holiday", async () => {
  const { offTheme } = await import("../format.js");
  assert.equal(offTheme("1pc/4pcs halloween כיסוי כרית", "כרית נוי לסלון"), true);
  assert.equal(offTheme("כיסוי כרית חג המולד סנטה", "כרית נוי"), true);
  assert.equal(offTheme("כיסוי כרית חג המולד סנטה", "כרית לחג המולד"), false);
  assert.equal(offTheme("כיסוי כרית בוהו לבן קרם", "כרית נוי"), false);
});

test("modelKey and varied: one model once, at most 2 alike per card (the third waits for the next card)", async () => {
  const { modelKey, varied } = await import("../format.js");
  const n = (short_he, id) => ({ short_he, id });
  assert.equal(modelKey("Lenovo LP40 Pro - אוזניות TWS"), modelKey("Lenovo LP40 Pro - אוזניות בלוטות'"));
  assert.equal(modelKey("Lenovo LP40 Pro אוזניות TWS"), modelKey("Lenovo LP40 Pro אוזניות"), "without ' - ' too");
  const scarves = [n("צעיף מרובע לנשים", 1), n("צעיף מרובע 65x65 ס\"מ", 2), n("צעיף מרובע מנומר", 3), n("צעיף צמר ארוך חם", 4), n("צעיף משי מרובע", 5)];
  assert.deepEqual(varied(scarves, "צעיף", 4).map((p) => p.id), [1, 2, 4, 3, 5], "two square scarves, then another kind");
  assert.notEqual(modelKey("מטען רכב USB-C"), modelKey("מטען רכב 5 יציאות"));
  const lamps = [n("מנורת לילה עם חיישן תנועה", 1), n("מנורת לילה חיישן תנועה USB-C", 2), n("מנורת לילה חיישן תנועה", 3), n("מנורת לילה RGB 13 צבעים", 4), n("מנורת לילה מגע לחדר", 5)];
  assert.deepEqual(varied(lamps, "מנורת לילה", 4).map((p) => p.id), [1, 2, 4, 5, 3]);
  const chargers = [n("מטען רכב USB-C", 1), n("מטען רכב 5 יציאות", 2), n("מטען רכב תצוגה דיגיטלית", 3), n("מטען רכב Baseus 30W", 4)];
  assert.deepEqual(varied(chargers, "מטען לרכב", 4).map((p) => p.id), [1, 2, 3, 4], "different kinds keep their order");
});

test("specialKind: gaming, shower, hydroponic, keffiyeh, Tesla-only are special unless asked", async () => {
  const { specialKind } = await import("../format.js");
  assert.equal(specialKind("עכבר גיימינג אלחוטי ATTACK SHARK X8", "עכבר אלחוטי wireless mouse"), true);
  assert.equal(specialKind("עכבר גיימינג אלחוטי", "עכבר גיימינג"), false);
  assert.equal(specialKind("רמקול למקלחת עמיד במים", "רמקול בלוטוס"), true);
  assert.equal(specialKind("UGREEN עכבר אלחוטי ארגונומי שקט", "עכבר אלחוטי"), false);
});

test("specialKind and fakeLuxury: cycling, camping, tamagoyaki, citronella, DIY, party, whiskey, 'מקלדת משחקים'; luxury fakes", async () => {
  const { specialKind, fakeLuxury } = await import("../format.js");
  for (const [t, r] of [["בקבוק מים לאופניים ROCKBROS", "בקבוק מים"], ["מחבת קמפינג Naturehike מתקפלת", "מחבת"], ["מחבת אומלט יפנית Tamagoyaki", "מחבת"],
    ["נר ריחני דוחה יתושים ציטרונלה", "נר ריחני"], ["שעון תלת מימד יצירתי עשה זאת בעצמך", "שעון קיר"], ["כיסויי שולחן מפלסטיק לקישוט חתונה יומולדת", "מפת שולחן"],
    ["כוס ויסקי 280ml קריסטל", "כוס"], ["מקלדת משחקים RGB", "מקלדת"], ["מקלדת מכאנית למשחקים AULA S75", "מקלדת"]]) assert.equal(specialKind(t, r), true, t);
  assert.equal(specialKind("בקבוק מים לאופניים", "בקבוק לאופניים"), false);
  assert.equal(specialKind("מחבת טיגון נון סטיק 28 ס\"מ", "מחבת"), false);
  assert.equal(fakeLuxury("נרות דיפיקס מוגבלים רומנטיים", "נר ריחני"), true);
  assert.equal(fakeLuxury("Dior perfume", "בושם של דיור"), false, "a named brand is the shopper's choice");
});

test("specialKind: a bath towel is not a 'shower' special; a shower speaker is", async () => {
  const { specialKind } = await import("../format.js");
  assert.equal(specialKind("סט מגבות מכותנה רכה, אביזרי אמבטיה", "מגבת"), false);
  assert.equal(specialKind("רמקול בלוטות' מיני לאמבטיה עמיד במים", "רמקול בלוטוס"), true);
});

test("modelKey: brand + model without a digit, version words dropped; specs aren't models", async () => {
  const { modelKey } = await import("../format.js");
  assert.equal(modelKey("KZ EDX Pro X אוזניות חוטיות"), modelKey("KZ EDX Pro אוזניות חוטיות"));
  assert.notEqual(modelKey("כבל USB ל-Type C ‏100W"), modelKey("כבל USB ל-Type C קצר"), "Type C is a spec, not a model");
  assert.notEqual(modelKey("QKZ AK6 אוזניות"), modelKey("KZ EDX Pro אוזניות"));
});

test("couponLine: the biggest valid code the item's price reaches; expired or out-of-reach codes are skipped", async () => {
  const { couponLine } = await import("../format.js");
  const coupons = [{ code: "IL5", off: 5, min: 39, until: "2026-11-30" }, { code: "IL10", off: 10, min: 79, until: "2026-11-30" }, { code: "OLD", off: 20, min: 1, until: "2026-10-01" }];
  const now = Date.parse("2026-11-02T10:00:00Z");
  const at = (ils) => ({ target_sale_price: String(ils) });
  assert.equal(couponLine(at(400), coupons, now), "🎟️ קופון <code>IL10</code>: $10 הנחה מעל $79");
  assert.equal(couponLine(at(160), coupons, now), "🎟️ קופון <code>IL5</code>: $5 הנחה מעל $39");
  assert.equal(couponLine(at(50), coupons, now), null);
  assert.equal(couponLine(at(400), [], now), null);
});

test("modelKey: the device the request names isn't the item's model (every S24 case is not one product)", async () => {
  const { modelKey } = await import("../format.js");
  const req = "כיסוי שקוף לסמסונג S24";
  assert.notEqual(modelKey("כיסוי שקוף ל-Samsung S24", req), modelKey("כיסוי מגנטי שקוף Samsung S24", req));
  assert.equal(modelKey("Lenovo LP40 Pro אוזניות", "אוזניות אלחוטיות"), modelKey("Lenovo LP40 Pro - אוזניות TWS", "אוזניות אלחוטיות"));
});

test("sameModel: a key that holds another with a model number is the same model; plain names never merge", async () => {
  const { modelKey, sameModel } = await import("../format.js");
  assert.ok(sameModel(modelKey("Xiaomi Redmi Buds 6 Active"), modelKey("Redmi Buds 6 Active")));
  assert.ok(!sameModel(modelKey("Redmi Buds 6 Active"), modelKey("Redmi Buds 8 Pro")));
  assert.ok(!sameModel(modelKey("כיסוי שקוף לסמסונג"), modelKey("כיסוי שקוף לסמסונג גלקסי")));
});

test("isPartFor: toilet-seat hinges and dampers are parts, unless asked for", () => {
  assert.equal(isPartFor("צירים אוניברסליים לאסלה", "מושב אסלה שנסגר לאט"), true);
  assert.equal(isPartFor("ערכת דמפר למושב אסלה", "מושב אסלה שנסגר לאט"), true);
  assert.equal(isPartFor("2 יחידות, צירים למכסה אסלה", "צירים לאסלה"), false);
  assert.equal(isPartFor("מושב אסלה בצורת O עם סגירה איטית", "מושב אסלה שנסגר לאט"), false);
});

test("reviewedFirst: many reviews lift a product within its standing, never past it; no counts keeps the order", async () => {
  const { reviewedFirst, sellerFirst } = await import("../format.js");
  const few = { id: "few", match: "exact", reviewCount: 5, avgStars: 4.9 };
  const many = { id: "many", match: "exact", reviewCount: 146, avgStars: 4.9 };
  const low = { id: "low", match: "exact", reviewCount: 300, avgStars: 4.1 };
  const close = { id: "close", match: "partial", reviewCount: 900, avgStars: 4.8 };
  const near = { id: "near", match: "near", reviewCount: 40, avgStars: 4.7 };
  assert.deepEqual(reviewedFirst([few, low, close, many, near]).map((p) => p.id), ["many", "near", "close", "few", "low"]);
  // standing first: a proven close best seller stays ahead of a barely-sold exact one with few reviews
  const barely = { id: "barely", match: "exact", reviewCount: 4, avgStars: 5 };
  const provenClose = { id: "pc", match: "partial", proven: "close", reviewCount: 12, avgStars: 4.9 };
  const provenReal = { id: "pr", match: "exact", proven: "real", reviewCount: 5, avgStars: 4.9 };
  assert.deepEqual(reviewedFirst([barely, provenClose, provenReal]).map((p) => p.id), ["pr", "pc", "barely"]);
  const plain = [{ id: "a" }, { id: "b" }];
  assert.deepEqual(reviewedFirst(plain), plain);
  // a ✨ pick that rose to the front gives the lead back to a best seller
  assert.deepEqual(sellerFirst([{ id: "x", pretty: true }, { id: "y" }], 4).map((p) => p.id), ["y", "x"]);
});
