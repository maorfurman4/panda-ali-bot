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
  singleForSet,
  vatLine,
  esc,
  RLM,
  HELP,
  fakeCapacity,
  FAKE_SKIPPED_NOTE,
  FAKE_SHOWN_NOTE,
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

test("isPartFor: a title starting with ל is a part only when it is FOR the requested item", () => {
  assert.ok(isPartFor("לרובוט השואב אבק Xiaomi X20 תיק אבק", "שואב אבק רובוטי"));
  for (const [t, req] of [["לוח שנה של NeeDoh לאדוונט 2026", "לוח אדוונט של נידו"], ["לגו טכניק מכונית מירוץ", "לגו"], ["לד פס תאורה RGB 5 מטר", "פס לד"],
    ["לוח מחיק מגנטי למקרר", "לוח מחיק"], ["לפטופ Lenovo 15 אינץ", "מחשב נייד"]]) assert.equal(isPartFor(t, req), false, t);
});

test("isPartFor: a case is a case under any name (מגן/כיסוי/נרתיק/קייס); a screen protector is still a part for a case request", () => {
  // "מגן לאייפון" returned 0 results: every "כיסוי…" title was dropped as a part (live test, 2026-11-02).
  for (const [t, req] of [["כיסוי סיליקון לאייפון 15", "מגן לאייפון"], ["כיסוי מתכתי לסמסונג S24", "מגן לסמסונג s24"],
    ["כיסוי ורוד לאייפון 15", "מגן לאייפון 15 ורוד"], ["נרתיק עור לאייפון", "כיסוי לאייפון"], ["מגן שקוף לאייפון 16", "כיסוי לאייפון"],
    ["כיסוי חום לאייפון 17", "קייס לאייפון 17"]]) assert.equal(isPartFor(t, req), false, `${t} | ${req}`);
  assert.equal(isPartFor("מגן מסך זכוכית לאייפון 15", "כיסוי לאייפון 15"), true, "a screen protector isn't a case");
  assert.equal(isPartFor("מגן מסך זכוכית לאייפון 15", "מגן מסך לאייפון"), false, "unless a screen protector was asked for");
  assert.equal(isPartFor("כיסוי לשעון חכם", "שעון חכם"), true, "a cover is still a part when no case was asked for");
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
  assert.equal(offTheme("לוח שנה של נידו לשנת 2026, מתנה לחג המולד", "לוח אדוונט של נידו"), false, "an advent calendar is a Christmas request");
  assert.equal(offTheme("לוח אדוונט נידו לליל כל הקדושים", "לוח אדוונט לחג המולד"), true, "another holiday only");
  assert.equal(offTheme("בובה רכה מתנה לחג המולד, ליל כל הקדושים, יום הולדת", "לוח אדוונט לחג המולד"), false, "the asked holiday among others");
  // Jewish holidays and Judaica
  assert.equal(offTheme("קשת נרות לחג המולד", "חנוכייה"), true, "a Christmas candle arch for a hanukkiah");
  assert.equal(offTheme("חנוכייה מכסף עם מגן דוד", "חנוכייה"), false);
  assert.equal(offTheme("שרשרת מגן דוד מזהב", "מתנה לחנוכה"), false, "Judaica fits a Jewish holiday");
  assert.equal(offTheme("שרשרת מגן דוד מזהב", "שרשרת לאישה"), true, "Judaica only when asked");
  assert.equal(offTheme("תחפושת ליל כל הקדושים לילדים", "תחפושת לפורים"), false, "Purim costumes are sold as Halloween ones");
  assert.equal(offTheme("קערת פסח קרמית", "קערה לסלטים"), true);
  assert.equal(offTheme("ביצי פסחא צבעוניות", "קערת סדר לפסח"), true, "Easter is not Passover");
  assert.equal(offTheme("מנורת שבת אוטומטית", "מנורת לילה לשבת"), false, "לשבת in a request is Shabbat");
  assert.equal(offTheme("כרית נוחה לשבת עליה בכיסא", "כרית לכיסא"), false, "לשבת in a title is also 'to sit'");
  assert.equal(offTheme("סט מצעים מסדרת קיץ", "מצעים"), false, "everyday words aren't holidays");
  for (const t of ["אוזניות עם תצוגה דיגיטלית", "מטלית מיקרופייבר", "אחיזה מגנטית משופרת", "מברשת סופר סופגנית", "ספר סיפורים לילדים", "צעיף טלית סאטן", "תושבת טלפון לרכב"])
    assert.equal(offTheme(t, "מוצר"), false, t);
  assert.equal(offTheme("תחפושת מלכה לפורים", "תחפושת"), true);
  assert.equal(offTheme("כובעי קוסם לגברים ונשים להלווין", "כובע קסם"), false, "costume props are sold as Halloween ones");
  assert.equal(offTheme("כובע קוסם לליל כל הקדושים", "כובע צמר"), true);
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
  const { sameModel } = await import("../format.js");
  const plain = (name) => modelKey(name, "", { plainNames: false });
  assert.ok(!sameModel(plain("מטען רכב USB-C"), plain("מטען רכב USB-C")), "non-style: the same plain name is a kind, not one model (2026-11-02)");
  assert.ok(sameModel(modelKey("שמלת מקסי שחורה"), modelKey("שמלת מקסי שחורה")), "style: the same plain name is one dress");
  assert.ok(sameModel(plain("Lenovo LP40 Pro אוזניות"), plain("Lenovo LP40 Pro - אוזניות TWS")), "a real model still merges");
  const lamps = [n("מנורת לילה עם חיישן תנועה", 1), n("מנורת לילה חיישן תנועה USB-C", 2), n("מנורת לילה חיישן תנועה", 3), n("מנורת לילה RGB 13 צבעים", 4), n("מנורת לילה מגע לחדר", 5)];
  assert.deepEqual(varied(lamps, "מנורת לילה", 4).map((p) => p.id), [1, 2, 4, 5, 3]);
  const chargers = [n("מטען רכב USB-C", 1), n("מטען רכב 5 יציאות", 2), n("מטען רכב תצוגה דיגיטלית", 3), n("מטען רכב Baseus 30W", 4)];
  assert.deepEqual(varied(chargers, "מטען לרכב", 4).map((p) => p.id), [1, 2, 3, 4], "different kinds keep their order");
});

test("specialKind: gaming, shower, hydroponic, keffiyeh, Tesla-only are special unless asked", async () => {
  const { specialKind } = await import("../format.js");
  assert.equal(specialKind("עכבר גיימינג אלחוטי ATTACK SHARK X8", "עכבר אלחוטי wireless mouse"), true);
  assert.equal(specialKind("עכבר אנכי של HOMEFISH ארגונומי 2.4GHz", "עכבר אלחוטי wireless mouse"), true, "a vertical mouse for a plain mouse");
  assert.equal(specialKind("עכבר אנכי של HOMEFISH ארגונומי 2.4GHz", "עכבר אנכי vertical mouse"), false);
  assert.equal(specialKind("עכבר אלחוטי נטען, עיצוב ארגונומי", "עכבר אלחוטי wireless mouse"), false, "ergonomic alone is a plain mouse");
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

test("trustedFirst: 20+ reviews and 4.5+ stars first, real before close; gadgets by sales with 200+ sales; a named color keeps photo-off colors last", async () => {
  const { trustedFirst, sellerFirst, sameReviews } = await import("../format.js");
  const id = (l) => l.map((p) => p.id);
  const p = (id, match, reviewCount, avgStars, sold = 5000, more = {}) => ({ id, match, reviewCount, avgStars, lastest_volume: String(sold), ...more });
  const top = p("top", "exact", 300, 4.7, 30000), fine = p("fine", "exact", 2000, 4.9, 5000), low = p("low", "exact", 5000, 4.4);
  const few = p("few", "exact", 5, 4.9), close = p("close", "partial", 8000, 4.8), rare = p("rare", "exact", 400, 4.9, 90);
  const choice = p("choice", "exact", 250, 4.9, 5000, { shop_id: 1103573332 });
  assert.deepEqual(id(trustedFirst([few, fine, close, low, top, rare], { bySales: true })), ["top", "fine", "close", "few", "low", "rare"], "by sales among the trusted; 4.4 stars and 90 sales aren't trusted for gadgets");
  assert.deepEqual(id(trustedFirst([p("big", "exact", 300, 4.9, 6000), choice], { bySales: true })), ["choice", "big"], "Choice: a big boost (5,000 sold passes 6,000)");
  assert.deepEqual(id(trustedFirst([few, fine, close, top])), ["fine", "top", "close", "few"], "style: the trusted keep their order, real before close");
  const offColor = p("off", "partial", 900, 4.9, 5000, { offColor: true });
  assert.deepEqual(id(trustedFirst([offColor, close, few, fine], { look: true })), ["fine", "few", "close", "off"], "a named color: right color first, even barely reviewed; another color by the photo last");
  assert.deepEqual(trustedFirst([{ id: "a" }, { id: "b" }]).map((x) => x.id), ["a", "b"], "no counts: as it was");
  const unread = { id: "unread", match: "exact", lastest_volume: "13482" };
  assert.deepEqual(id(trustedFirst([few, unread, fine], { bySales: true })), ["unread", "fine", "few"], "a failed lookup on a big seller stays trusted");
  assert.deepEqual(id(sameReviews([p("a", "exact", 4926, 4.9), p("b", "exact", 4926, 4.9), p("c", "exact", 50, 4.9), p("d", "exact", 50, 4.9)])), ["a", "c", "d"]);
  assert.deepEqual(sellerFirst([{ id: "x", brandSlot: true, reviewCount: 1749 }, { id: "y" }], 4, { strip: true }).map((x) => [x.id, Boolean(x.brandSlot)]), [["x", false], ["y", false]]);
  assert.deepEqual(id(sellerFirst([{ id: "x", pretty: true }, { id: "y" }], 4)), ["y", "x"]);
});

test("offColor: a title naming only another color than the one asked for; variants listing it, no color, or trims stay", async () => {
  const { offColor } = await import("../format.js");
  assert.equal(offColor("שמלת ערב ארוכה חומה עם צווארון גבוה", "שמלת ערב שחורה"), true);
  assert.equal(offColor("Women Evening Dress Pink Satin", "שמלת ערב ירוקה"), true);
  assert.equal(offColor("שמלת ערב שחורה-זהובה", "שמלת ערב שחורה"), false, "two-tone with the asked color: the photo judges it");
  assert.equal(offColor("Evening dress black white red", "שמלת ערב שחורה"), false, "color variants that include it");
  assert.equal(offColor("שמלת ערב סאטן ללא גב", "שמלת ערב שחורה"), false, "no color in the title");
  assert.equal(offColor("תיק עם אבזם זהב", "תיק שחור"), false, "gold trims don't count");
  assert.equal(offColor("שמלת ערב חומה", "שמלת ערב"), false, "no color asked");
});

test("shaver heads and blades are parts for a grooming kit, unless asked for", async () => {
  const { isPartFor } = await import("../format.js");
  assert.equal(isPartFor("ראשי גילוח חלופיים 7 להבים", "ערכת טיפוח לגבר"), true);
  assert.equal(isPartFor("ראשי גילוח חלופיים", "ראש גילוח למכונה"), false, "asked for");
});

test("singleForSet: for a set/kit request, a title that isn't a set is a single item (goes last); other requests are untouched", () => {
  for (const [t, req] of [["מברג ראצ'ט רב שימושי", "סט מברגים"], ["מקצפת מאצ'ה מבמבוק", "ערכת מאצ'ה להכנה ביתית"], ["מכשיר להסרת שיער מהאף", "ערכת טיפוח לגבר"]])
    assert.equal(singleForSet(t, req), true, t);
  for (const [t, req] of [["ערכת מברגים מדויקים 152 ב-1", "סט מברגים"], ["סט מאצ'ה יפני 6 חלקים", "ערכת מאצ'ה"], ["WEEME ערכת טיפוח 4 ב-1", "ערכת טיפוח לגבר"],
    ["סט מברגים דיוק מיקרו 11 חלקים", "סט מברגים"], ["מברג ראצ'ט", "מברג חשמלי"], ["שמלת ערב", "שמלת ערב שחורה"]])
    assert.equal(singleForSet(t, req), false, t);
});

test("inColors: a listing in several colors that include the asked one", async () => {
  const { inColors } = await import("../format.js");
  assert.ok(inColors("שמלות ארוכות עם סרט סאטן, כחול, ירוק, שחור, צהוב", "שמלת ערב שחורה ארוכה"));
  assert.ok(!inColors("שמלת ערב שחורה", "שמלת ערב שחורה"), "one color is not several");
  assert.ok(!inColors("שמלה כחול, ירוק", "שמלה שחורה"), "the asked color isn't there");
  assert.ok(!inColors("שמלה כחול, שחור", "שמלת ערב"), "no color asked");
});

test("specialKind: a car charger is close for a charger request that doesn't say car", async () => {
  const { specialKind } = await import("../format.js");
  assert.ok(specialKind("מטען לרכב USB-C 100W טעינה מהירה", "מטען מהיר fast charger"));
  assert.ok(specialKind("מטען רכב מהיר PD", "מטען לטלפון phone charger"));
  assert.ok(specialKind("100w/200w qc3.0 pd מטען קטן 12-24v קל טעינה מהירה לרכב מסוג USB", "מטען מהיר fast charger"), "'לרכב' far into the title (live, 2026-11-02)");
  assert.ok(!specialKind("מטען לרכב USB-C 100W", "מטען לרכב car charger"), "asked for a car one");
  assert.ok(!specialKind("מטען קיר מהיר 65W GaN", "מטען מהיר fast charger"));
  assert.ok(!specialKind("מטען אלחוטי לרכב עם מחזיק", "מחזיק טלפון לרכב car phone holder"), "any car request keeps it");
});


test("isPartFor: מחזיק / מעמד / תושבת are one item for a holder request; still a part for another request", async () => {
  const { isPartFor } = await import("../format.js");
  assert.equal(isPartFor("תושבת טלפון לרכב Baseus מתכת כבידה", "מעמד טלפון לרכב של Baseus"), false);
  assert.equal(isPartFor("תושבת טלפון לרכב מגנטית", "מחזיק טלפון לרכב"), false);
  assert.equal(isPartFor("מעמד טלפון לרכב מגנטי", "מחזיק טלפון לרכב"), false);
  assert.equal(isPartFor("מעמד למקלדת", "מקלדת"), true, "a stand for the asked item is still a part");
});

test("specialKind: a car phone holder is close for a phone stand request that doesn't say car", async () => {
  const { specialKind } = await import("../format.js");
  assert.ok(specialKind("מחזיק טלפון מגנטי לרכב", "מעמד לטלפון phone stand"));
  assert.ok(specialKind("תושבת טלפון לרכב למיזוג", "מעמד לטלפון phone stand"));
  assert.ok(!specialKind("מעמד שולחני מתכוונן לטלפון", "מעמד לטלפון phone stand"));
  assert.ok(!specialKind("תושבת טלפון לרכב Baseus", "מעמד טלפון לרכב של Baseus Baseus car phone holder"));
});

test("white noise is not a color: no color note and no color photo check", async () => {
  const { formatCard } = await import("../format.js");
  const { namesLook } = await import("../query.js");
  const p = { product_title: "x", target_sale_price: "10", target_sale_price_currency: "ILS", lastest_volume: "100", promotion_link: "https://s.click.aliexpress.com/e/_a" };
  assert.doesNotMatch(formatCard([p], { query: "מכונת רעש לבן" }).caption, /🎨/);
  assert.match(formatCard([p], { query: "תיק לבן" }).caption, /🎨/);
  assert.equal(namesLook("מכונת רעש לבן white noise machine"), false);
  assert.equal(namesLook("תיק לבן"), true);
});

test("a card for 'תיק לעבודה לבנות' has no colors note: 'לבנות' there means for women", async () => {
  const { formatCard } = await import("../format.js");
  const p = { product_title: "Women work bag", target_sale_price: "50", target_sale_price_currency: "ILS", promotion_link: "https://s.click.aliexpress.com/e/_x" };
  assert.doesNotMatch(formatCard([p], { query: "תיק לעבודה לבנות" }).caption, /מבחר צבעים/);
  assert.match(formatCard([p], { query: "נעליים לבנות" }).caption, /מבחר צבעים/, "white shoes keep the note");
});

test("family 3: a search for something that fits a named device or car gets the 'pick your model' note", async () => {
  const { formatCard, namesModel, MODELS_NOTE } = await import("../format.js");
  for (const t of ["כיסוי לאייפון 17", "רצועה לאפל ווטש", "כיסוי למפתח של טויוטה קורולה", "case for iphone 15"]) assert.ok(namesModel(t), t);
  for (const t of ["אוזניות אלחוטיות", "כיסוי לכרית", "מטען מהיר"]) assert.ok(!namesModel(t), t);
  const p = { product_title: "Case", target_sale_price: "10", target_sale_price_currency: "ILS", promotion_link: "https://s.click.aliexpress.com/e/_x" };
  assert.ok(formatCard([p], { query: "כיסוי לאייפון 17" }).caption.includes(MODELS_NOTE));
  assert.ok(!formatCard([p], { query: "אוזניות" }).caption.includes(MODELS_NOTE));
});

test("family 6: big items AliExpress hardly ships get buttons for what does ship; a weak card says so", async () => {
  const { bigItem, formatCard, WEAK_NOTE } = await import("../format.js");
  assert.deepEqual(bigItem("מכונת כביסה").options.map((o) => o.label_he), ["מכונת כביסה ניידת", "אביזרים למכונת כביסה"]);
  assert.match(bigItem("ספה תלת מושבית").question, /כמעט לא שולח ספות/);
  for (const t of ["מכונת כביסה ניידת", "כיסוי לספה", "מקרר קטן לרכב", "מגנט למקרר", "אוזניות"]) assert.equal(bigItem(t), null, t);
  const p = (sold) => ({ product_title: "x", target_sale_price: "10", target_sale_price_currency: "ILS", lastest_volume: String(sold), promotion_link: "https://s.click.aliexpress.com/e/_x" });
  assert.ok(formatCard([p(20), p(5)], { query: "מפזר חום", weak: true }).caption.includes(WEAK_NOTE));
  assert.ok(!formatCard([p(2000)], { query: "אוזניות" }).caption.includes(WEAK_NOTE));
});

test("fakeCapacity: storage, power banks and chargers whose capacity the price rules out; a multi-size listing by its smallest", () => {
  assert.equal(fakeCapacity("Lenovo דיסק און קי 2TB 1TB 512GB USB 3.0", 18), true);
  assert.equal(fakeCapacity("SanDisk כרטיס זיכרון micro sd 64GB 128GB 256GB 1TB", 30), false, "a real listing shows its smallest size's price");
  assert.equal(fakeCapacity("SanDisk Extreme כרטיס זיכרון 1TB", 250), false);
  assert.equal(fakeCapacity("דיסק און קי חדש בנפח 2 טרה-בייט USB 3.0", 12.69), true, "Hebrew units");
  assert.equal(fakeCapacity("SanDisk דיסק און קי 64GB", 30), false);
  assert.equal(fakeCapacity("סוללה ניידת 50000mAh מטען מהיר", 25), true);
  assert.equal(fakeCapacity("Baseus סוללה ניידת 20000mAh 65W", 90), false);
  assert.equal(fakeCapacity("סוללה ניידת 10,000mAh", 30), false);
  assert.equal(fakeCapacity("מטען לרכב 350W USB C", 6), true);
  assert.equal(fakeCapacity("Ugreen מטען 100W GaN", 120), false);
  assert.equal(fakeCapacity("כבל Baseus USB Type C ל-USB C 100W PD טעינה מהירה כבל מטען", 10.09), false, "a cable is not a charger");
  assert.equal(fakeCapacity("Ugreen 100w usb סוג c עד USB עבור macbook pd מטען מהיר USB", 13.79), false, "'C to USB' is a cable");
  assert.equal(fakeCapacity("מטען קיר מהיר עם 4 יציאות, הספק 120W, כולל כבל נתונים", 6.79), true, "a charger with a cable is a charger");
  assert.equal(fakeCapacity("מכונת תספורת 1200mAh", 40), false, "mAh on something that isn't a power bank");
});

test("card notes: fakes skipped or shown", () => {
  const p = { product_title: "x", target_sale_price: "40", target_sale_price_currency: "ILS", lastest_volume: "900", promotion_link: "https://s.click.aliexpress.com/e/_a" };
  assert.ok(formatCard([p], { query: "דיסק און קי", fakes: true }).caption.includes(FAKE_SKIPPED_NOTE));
  assert.ok(formatCard([{ ...p, fakeCap: true }], { query: "דיסק און קי", fakes: true }).caption.includes(FAKE_SHOWN_NOTE));
  assert.ok(!formatCard([p], { query: "דיסק און קי" }).caption.includes("⚠️"));
});
