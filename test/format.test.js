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
  manySizes,
  SIZES_NOTE,
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
  assert.equal(specialKind("360 °   מתקן טלפון לרכב מסתובב ויציב", "מעמד לטלפון"), true, "a car phone mount called מתקן");
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
  assert.match(formatCard([p], { query: "נעליים לבנות · ⚪ בצבע לבן" }).caption, /מבחר צבעים/, "white shoes (chosen) keep the note");
  assert.match(formatCard([p], { query: "סניקרס לבנים לנשים" }).caption, /מבחר צבעים/, "clear from the request: the note");
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
  assert.match(bigItem("ספה תלת מושבית").question, /כמעט לא שולחת ספות/);
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

test("stage A (2026-11-04): a ₪4 '65W' charger is fake, a ₪14 30W isn't; sizes note; a long card shortens 💡 lines before dropping a product", () => {
  assert.equal(fakeCapacity("מטען USB C GaN 65W עם 2 יציאות", 4.26), true);
  assert.equal(fakeCapacity("מטען Essager Mini 30W סוג C", 13.79), false);
  assert.equal(fakeCapacity("מטען מהיר 20W USB-C", 5), false, "under 40W is left alone");
  assert.equal(manySizes("דיסק און קי SanDisk Ultra Dual Drive Luxe בנפחים של 32GB 64GB 128GB 256GB 1TB"), true);
  assert.equal(manySizes("SanDisk Extreme כרטיס זיכרון 1TB"), false);
  assert.equal(manySizes("שמלת ערב שחורה מידות S M L XL"), false, "clothes sizes are not counted");
  const p = (i) => ({ product_title: `x${i}`, short_he: "שם מוצר ארוך מאוד שמתאר בדיוק את המכונית ואת השלט שלה", target_sale_price: "60", target_sale_price_currency: "ILS", lastest_volume: "900", promotion_link: `https://s.click.aliexpress.com/e/_${"a".repeat(8)}${i}` });
  const products = [1, 2, 3, 4].map(p);
  const reasons = products.map(() => "מתאימה לילד בן 8 שאוהב מהירות, עם שלט נוח, סוללה נטענת וסיבוב של 360 מעלות לפעלולים בבית ובחוץ");
  const card = formatCard(products, { query: "מתנה לילד בן 8 · 50-100₪ · מכונית על שלט", reasons });
  assert.equal(card.count, 4, "all 4 stay");
  assert.equal((card.caption.match(/💡/g) ?? []).length, 4);
  assert.ok(formatCard([{ ...p(1), product_title: "SanDisk 32GB 64GB 128GB 1TB" }], { query: "דיסק און קי" }).caption.includes(SIZES_NOTE));
});

test("bigItem: an accessory named after the machine is searched, not answered with buttons (washer door prop, 2026-11-05)", async () => {
  const { bigItem } = await import("../format.js");
  assert.equal(bigItem("מכונת כביסה מחזיק דלת"), null);
  assert.equal(bigItem("ספה כרית גב"), null);
  assert.equal(bigItem("מזגן שלט"), null);
  assert.ok(bigItem("מכונת כביסה"), "the machine itself still gets the buttons");
  assert.ok(bigItem("מכונת כביסה 8 קילו"));
  assert.ok(bigItem("ספה תלת מושבית"));
  assert.ok(bigItem("ספה לסלון"), "סלון is not an accessory");
  assert.ok(bigItem("מכונת כביסה פתח קדמי"));
});

test("namesModel: Chinese car makes from the owner's feed (BYD, Atto 3, Seagull, MG) and 'ל-' with a hyphen (2026-11-05)", async () => {
  const { namesModel } = await import("../format.js");
  for (const t of ["כיסוי מפתח ל-BYD", "שטיחונים לאטו 3", "מגן מסך לסיגל", "מחזיק טלפון ל-MG ZS", "כיסוי ל-iPhone 15", "כיסוי הגה לצ'רי טיגו 8"]) assert.equal(namesModel(t), true, t);
  for (const t of ["בובת דולפין", "דולפין מתנפח", "יואן סיני"]) assert.equal(namesModel(t), false, t);
});

test("look-alike brands (2026-11-05): the card says the original isn't on AliExpress; accessories FOR the brand get no note", async () => {
  const { lookalikeBrand, LOOKALIKE_NOTE } = await import("../format.js");
  for (const q of ["איירפודס פרו", "שעון של רולקס", "טייץ לולולמון", "קרוקס לילדים", "מייבש שיער של דייסון"]) assert.equal(lookalikeBrand(q), true, q);
  for (const q of ["כיסוי לאיירפודס", "קישוטים לקרוקס", "חלקים לשואב דייסון", "שעון חכם", "רצועה לאפל ווטש"]) assert.equal(lookalikeBrand(q), false, q);
  const p = { product_title: "x", target_sale_price: "40", target_sale_price_currency: "ILS", lastest_volume: "900", promotion_link: "https://s.click.aliexpress.com/e/_a" };
  assert.ok(formatCard([p], { query: "איירפודס פרו" }).caption.includes(LOOKALIKE_NOTE));
  assert.ok(!formatCard([p], { query: "כיסוי לאיירפודס" }).caption.includes(LOOKALIKE_NOTE));
});

test("colorAlsoLine: the asked color in the shopper's word; none without a color", async () => {
  const { colorAlsoLine } = await import("../format.js");
  assert.equal(colorAlsoLine("שמלה שחורה"), "🎨 מגיע גם בשחור, בוחרים בדף המוצר");
  assert.equal(colorAlsoLine("חולצה ניוד"), "🎨 מגיע גם בניוד, בוחרים בדף המוצר");
  assert.equal(colorAlsoLine("נעליים אדומות"), "🎨 מגיע גם באדום, בוחרים בדף המוצר");
  assert.equal(colorAlsoLine("תיק לעבודה לבנות"), null, "for women, not white");
  assert.equal(colorAlsoLine("שמלה"), null);
});

test("babyOnly: a baby-only title for a child's request; a title for both, or a baby request, is fine", async () => {
  const { babyOnly } = await import("../format.js");
  assert.equal(babyOnly("שמלת פרחים לתינוקת קיץ", "שמלה לילדה"), true);
  assert.equal(babyOnly("Newborn baby girl dress", "שמלה לילדה"), true);
  assert.equal(babyOnly("שמלה לתינוקות ולילדות 1-6 שנים", "שמלה לילדה"), false);
  assert.equal(babyOnly("שמלת נסיכה לילדות", "שמלה לילדה"), false);
  assert.equal(babyOnly("שמלת פרחים לתינוקת", "שמלה לתינוקת"), false);
  assert.equal(babyOnly("שמלת פרחים לתינוקת", "שמלה"), false, "no child named: unchanged");
  // real titles from the free check, 2026-11-05
  assert.equal(babyOnly("שמלת פרינט פרחונית לתינוקות בנות חדשה לקיץ 2025, שמלת נסיכה נושמת לתינוקות בגילאי 0-3 שנים", "שמלה לילדה"), true);
  assert.equal(babyOnly("שמלת תינוקת קיץ שמלת רשת דובדבן שמלת ילדה חמודה שמלת חוף תינוקת בגדי תינוקות", "שמלה לילדה"), true);
  assert.equal(babyOnly("(0-3 שמלת ילדה בת תינוק) קיץ צהוב חדש", "שמלה לילדה"), true);
  assert.equal(babyOnly("0-24 חודשים שמלת תינוקת עם קצה פרחוני", "שמלה לילדה"), true);
  assert.equal(babyOnly("שמלת נסיכת מואנה אלזה לילדות תחפושת ילדים תלבושת לפעוטות 2-8 שנים", "שמלה לילדה"), false);
  assert.equal(babyOnly("2026 בגדי ילדים חדשים קיץ בנות שמלת שרוולים קצרים שמלת נסיכה לילדים בגדי מסיבת יום הולדת לתינוק", "שמלה לילדה"), false);
});

test("colorVariant: the asked color in real variant names; codes, no mapping or a full list leave it undecided", async () => {
  const { colorVariant } = await import("../format.js");
  const vs = (...colors) => colors.map((color, i) => ({ skuId: String(i), color, photo: `p${i}` }));
  assert.equal(colorVariant(vs("Wine Red", "Gray"), "סוודר בורדו").variant.color, "Wine Red");
  assert.equal(colorVariant(vs("Navy", "Khaki"), "מעיל נייבי").variant.color, "Navy");
  assert.deepEqual(colorVariant(vs("Red", "Gray"), "סוודר בורדו"), { variant: null, decided: true });
  assert.equal(colorVariant(vs("Wine Red"), "סוודר אדום").variant, null, "wine red is burgundy, not red");
  assert.equal(colorVariant(vs("A", "B"), "שמלה שחורה").decided, false, "codes");
  assert.equal(colorVariant(vs("Pink"), "חולצה פודרה").decided, false, "no mapping");
  assert.equal(colorVariant(vs("White"), "תיק לעבודה לבנות").decided, false, "for women, not white");
  assert.equal(colorVariant(vs(...Array.from({ length: 20 }, (_, i) => `Gray ${i}`)), "סוודר בורדו").decided, false, "a full list may hide it");
  assert.equal(colorVariant(vs("SAKURA PINK", "MIDNIGHT BLACK"), "אוזניות ורודות").variant.color, "SAKURA PINK");
  assert.equal(colorVariant([], "שמלה שחורה").decided, false);
});

test("namesItem: the request's first word near the title's start", async () => {
  const { namesItem } = await import("../format.js");
  assert.equal(namesItem("שמלת חורף 2024 לנשים בצבע אחיד", "שמלה ניוד"), true);
  assert.equal(namesItem("2026 נעלי לוליטה חדשות עם קשר פרפר לנשים", "שמלה ניוד"), false);
  assert.equal(namesItem("תיק בקבוק מים נייד עם רצועה מתכווננת", "כוס תרמית שחורה"), false);
  assert.equal(namesItem("כוס תרמית כפולה מנירוסטה", "כוס תרמית שחורה"), true);
  assert.equal(namesItem("אוזניות בלוטות' אלחוטיות עמידות במים", "אוזניות אלחוטיות ורודות"), true);
  assert.equal(namesItem("ג'קטים לטיולים עמידים במים", "מעיל נייבי"), false);
  assert.equal(namesItem("הלבשה תחתונה שיפון סקסית ללא כתפיות, שמלה", "שמלה שחורה"), false);
  assert.equal(namesItem("E6s אלחוטית bluetooth אוזניות אלחוטיות", "אוזניות ורודות"), true);
  assert.equal(namesItem("נרתיק לאוזניות רך וגמיש עמיד", "אוזניות ורודות"), false, "an accessory for the item");
  assert.equal(namesItem("כיסוי סיליקון לאוזניות", "אוזניות ורודות"), false);
});

test("colorVariant: 'בז' without the geresh finds beige variants", async () => {
  const { colorVariant } = await import("../format.js");
  assert.equal(colorVariant([{ skuId: "1", color: "Beige", photo: "p" }, { skuId: "2", color: "Black", photo: "q" }], "סוודר בז").variant.color, "Beige");
});

test("titleShare and namesItem: a word with a geresh (ג'ינס, ז'קט) matches its titles - the self-check paid a second reading for 'ג'ינס'", async () => {
  const { titleShare, namesItem } = await import("../format.js");
  assert.equal(titleShare("ג'ינס", [{ product_title: "ג'ינס גברים ישר" }]), 1);
  assert.equal(titleShare("ג׳ינס", [{ product_title: "ג'ינס גברים ישר" }]), 1);
  assert.equal(namesItem("ג'ינס גברים ישר", "ג'ינס שחור לגבר"), true);
  assert.equal(namesItem("ז'קט עור לגברים", "ז'קט שחור"), true);
});

// The text audit (2026-11-06): the same request written another common way must be read the same.
test("normalizeText: invisible direction marks, curly or Hebrew geresh, maqaf, no-break and double spaces, niqqud", async () => {
  const { normalizeText } = await import("../format.js");
  assert.equal(normalizeText("‏ג׳ינס  שחור"), "ג'ינס שחור");
  assert.equal(normalizeText("ג’ינס ‎לגבר"), "ג'ינס לגבר");
  assert.equal(normalizeText("בקבוק 500 מ״ל"), 'בקבוק 500 מ"ל');
  assert.equal(normalizeText("שעון בפחות מ־200"), "שעון בפחות מ-200");
  assert.equal(normalizeText("שָׁלוֹם"), "שלום");
  assert.equal(normalizeText("יש עוד צבעים?"), "יש עוד צבעים?", "punctuation stays: a question isn't a refine");
  assert.equal(normalizeText("👍"), "👍");
});

test("titleShare and namesItem: a trailing question mark or a curly geresh don't change the reading", async () => {
  const { titleShare, namesItem } = await import("../format.js");
  const titles = [{ product_title: "ג'ינס גברים ישר" }];
  assert.equal(titleShare("ג'ינס?", titles), 1);
  assert.equal(namesItem("ג'ינס גברים ישר", "ג'ינס?"), true);
  assert.equal(namesItem("ג’ינס גברים ישר", "ג'ינס"), true, "a curly geresh in the title");
});

test("namesModel: 'ל BYD' with a space counts like 'ל-BYD'", async () => {
  const { namesModel } = await import("../format.js");
  assert.equal(namesModel("מטען לרכב ל BYD"), true);
});

test("namesItem and titleShare: full or defective spelling (אזניות/אוזניות, סודר/סוודר, טלויזיה/טלוויזיה, ג'קט/ז'קט) reads the same", async () => {
  const { namesItem, titleShare } = await import("../format.js");
  for (const [req, title] of [["אזניות אלחוטיות", "אוזניות בלוטות' אלחוטיות"], ["סודר לנשים", "סוודר לנשים סרוג"], ["טלויזיה", "טלוויזיה חכמה"], ["ג'קט עור", "ז'קט מעור לגברים"], ["פיג'אמה לנשים", "פיג'מה לנשים סאטן"], ["חלצה לבנה", "חולצה לבנה לנשים"], ["טיץ ספורט", "טייץ ספורט לנשים"]]) {
    assert.equal(namesItem(title, req), true, req);
    assert.equal(titleShare(req, [{ product_title: title }]), 1, req);
  }
  assert.equal(namesItem("נרתיק לאוזניות רך", "אזניות"), false, "still not an accessory");
});

test("colorVariant: silver and gold, and an agreeing 'לבנים' as white", async () => {
  const { colorVariant } = await import("../format.js");
  const vs = [{ skuId: "1", color: "Silver", photo: "a" }, { skuId: "2", color: "Gold", photo: "b" }, { skuId: "3", color: "White", photo: "c" }];
  assert.equal(colorVariant(vs, "שעון לגבר כסוף").variant.color, "Silver");
  assert.equal(colorVariant(vs, "עגילי זהב לנשים").variant.color, "Gold");
  assert.equal(colorVariant(vs, "סניקרס לבנים לנשים").variant.color, "White");
  assert.equal(colorVariant(vs, "כפכפים לבנים").variant, null, "asked first");
});

test("after choosing '👦 לבנים' / '👧 לבנות', 'לבנים' isn't the color: no off-color, no colors note (owner's test, 2026-11-06)", async () => {
  const { offColor, inColors, formatCard } = await import("../format.js");
  assert.equal(offColor("כפכפי ילדים כחולים", "כפכפים לבנים (👦 לבנים)"), false);
  assert.equal(offColor("נעלי ספורט ורודות לילדות", "נעלי ספורט לבנות (👧 לבנות)"), false);
  assert.equal(offColor("נעלי ספורט ורודות", "נעלי ספורט לבנות (⚪ בצבע לבן)"), true, "chose white: still the color");
  assert.equal(offColor("סניקרס ורודות", "סניקרס לבנים לנשים"), true, "clear from the request: the color");
  assert.equal(inColors("נעלי ספורט כחול, לבן, ורוד", "נעלי ספורט לבנות (👧 לבנות)"), false);
  const card = formatCard([{ product_title: "כפכפי ילדים", target_sale_price: "20", target_sale_price_currency: "ILS", lastest_volume: "500", promotion_link: "https://s.click.aliexpress.com/e/x" }], { query: "כפכפים לבנים · 👦 לבנים" }).caption;
  assert.doesNotMatch(card, /מגיעים במבחר צבעים/);
});

test("notForShabbat: a light switched by motion, sound, touch, an app or a screen bar isn't for a Shabbat request", async () => {
  const { notForShabbat } = await import("../format.js");
  for (const t of ["מנורת לילה עם חיישן תנועה", "מנורת לילה עם עמעום מגע USB", "מנורת לילה חכמה בשליטת אפליקציה", "פס תאורה למסך מחשב", "Motion sensor night light", "מנורת מקרן כוכבים RGB, מנורת לילה לד", "מנורת קיר עם תאורת לילה, טעינה באמצעות שלט רחוק", "מנורת לילה עם טיימר כיבוי אוטומטי", "תנועה הוביל חיישן אור אלחוטי הוביל אור בלילה", "5 מ' הוביל אור עם תקע USB 24 מפתחות rgb"]) assert.equal(notForShabbat(t, "מנורת לילה לשבת"), true, t);
  for (const t of ["מנורת לילה מיני USB אור חם", "מנורת לילה בצורת פטרייה עם חיישן אור"]) assert.equal(notForShabbat(t, "מנורת לילה לשבת"), false, t);
  assert.equal(notForShabbat("מנורת לילה עם חיישן תנועה", "מנורת לילה לארון"), false, "no Shabbat in the request");
  assert.equal(notForShabbat("שקע חכם Tuya WiFi טיימר", "שעון שבת"), false, "a Shabbat timer may be a smart plug timer");
});

test("headerOf: the AI's corrected Hebrew cut mid-word ('חולצת פולו משי ק') gives way to what was typed; a real correction stays", async () => {
  const { headerOf } = await import("../format.js");
  assert.equal(headerOf("חולצת פולו משי ק", "חולצת פולו משי קר"), "חולצת פולו משי קר");
  assert.equal(headerOf("משי ק", "חפש לי משי קר"), "משי קר");
  assert.equal(headerOf("אוזניות", "אוזנייות"), "אוזניות", "a typo fix stays");
  assert.equal(headerOf("מטען לרכב", "מטען לרכב"), "מטען לרכב");
  assert.equal(headerOf("", "מקרן"), "מקרן");
  assert.equal(headerOf("שמלה", "שמלה שחורה"), "שמלה", "a whole word: the AI's reading, not a cut");
});

test("namesItem: a short first word (סט, סל, מד, פס, שק) gives way to the next; final letters match (שטיחונים/שטיחון, מזרנים/מזרן)", async () => {
  const { namesItem, titleShare } = await import("../format.js");
  assert.equal(namesItem("סט מברגים דיגיטלי 24 ב-1", "סט מברגים מדויק"), true);
  assert.equal(namesItem("סל כביסה נייד מתקפל", "סל כביסה"), true);
  assert.equal(namesItem("מד לחץ צמיגים דיגיטלי", "מד לחץ אוויר לצמיגים"), true);
  assert.equal(namesItem("שטיחון לרצפת הרכב, דגם Y", "שטיחונים לטסלה מודל Y"), true);
  assert.equal(namesItem("מזרן יוגה ספורטיבי EVA", "מזרנים ליוגה"), true);
  assert.equal(namesItem("סט מגבות למלון", "סט סירים"), false, "the next word decides");
  assert.equal(titleShare("שטיחונים לטסלה", [{ product_title: "שטיחון לרצפת הרכב" }]), 1);
});

test("specOf and sizeVariant: the size or spec a request names, found in a listing's variants", async () => {
  const { specOf, hasSpec, sizeVariant } = await import("../format.js");
  assert.deepEqual(specOf("name necklace 45cm"), { num: "45", unit: "cm", raw: "45cm" });
  assert.deepEqual(specOf("power station 300w"), { num: "300", unit: "w", raw: "300w" });
  assert.deepEqual(specOf("men shoes size 43"), { num: "43", unit: "size", raw: "size 43" });
  assert.equal(specOf("wireless earbuds"), null);
  assert.equal(specOf("Galaxy S24 case"), null, "a model number is not a size");
  assert.equal(hasSpec("Custom Name Necklace 45cm Gold", specOf("necklace 45cm")), true);
  assert.equal(hasSpec("Custom Name Necklace 145cm", specOf("necklace 45cm")), false);
  const vs = (...props) => props.map((p, i) => ({ skuId: String(i + 1), props: p }));
  assert.equal(sizeVariant(vs({ Length: "40cm" }, { Length: "45cm", "Metal Color": "Gold" }), specOf("necklace 45cm")).skuId, "2");
  assert.equal(sizeVariant(vs({ Length: "45 cm" }), specOf("necklace 45cm")).skuId, "1", "a space before the unit");
  assert.equal(sizeVariant(vs({ "Shoe Size": "EU 43" }, { "Shoe Size": "44" }), specOf("men shoes size 43")).skuId, "1");
  assert.equal(sizeVariant(vs({ Length: "145cm" }), specOf("belt 45cm")), null);
  assert.equal(sizeVariant(vs({ Power: "30W" }), specOf("power station 300w")), null);
});

test("colorAlsoLine: a thermometer (מדחום) names no brown", async () => {
  const { colorAlsoLine } = await import("../format.js");
  assert.equal(colorAlsoLine("מדחום לחדר"), null, "family 4, 2026-11-07");
  assert.match(colorAlsoLine("סוודר חום"), /בחום/);
});

test("kids' European sizes (height in cm): the size an AliExpress seller lists for it", async () => {
  // Family 11 (2026-11-07): "חולצה לילד מידה 116" found almost nothing: Israeli kids' sizes are a height in cm (116 is
  // 5-6 years), sellers list ages ("5-6Y", "6T"), months, or round heights ("120", the top of the range).
  const { specOf, hasSpec, sizeVariant } = await import("../format.js");
  assert.deepEqual(specOf("boys t-shirt 116"), { unit: "kids", num: "116", eu: 116, lo: 5, hi: 6, raw: "116" });
  assert.deepEqual(specOf("girls dress size 98"), { unit: "kids", num: "98", eu: 98, lo: 2, hi: 3, raw: "size 98" });
  assert.deepEqual([specOf("baby pajamas 74").lo, specOf("baby pajamas 74").hi], [0.5, 0.75], "6-9 months");
  assert.equal(specOf("t-shirt 116"), null, "no child named: not a kids' size");
  assert.equal(specOf("boys jeans size 30").unit, "size", "under 50: a plain size");
  const vs = (...vals) => vals.map((v, i) => ({ skuId: String(i + 1), props: { Size: v } }));
  assert.equal(sizeVariant(vs("4-5Y", "5-6Y", "7-8Y"), specOf("boys t-shirt 116")).skuId, "2");
  assert.equal(sizeVariant(vs("110", "120", "130"), specOf("boys t-shirt 116")).skuId, "2", "120 fits a child up to 120 cm");
  assert.equal(sizeVariant(vs("5T", "6T"), specOf("boys t-shirt 116")).skuId, "2", "6T is the top of 5-6");
  assert.equal(sizeVariant(vs("6-9M", "9-12M"), specOf("baby pajamas 74")).skuId, "1");
  assert.equal(sizeVariant(vs("2-3Y", "3-4Y"), specOf("boys t-shirt 116")), null);
  assert.equal(hasSpec("Kids T-shirt Summer 2-8Y", specOf("boys t-shirt 116")), true, "a title's age range covers it");
  assert.equal(hasSpec("Kids T-shirt 1-3Y", specOf("boys t-shirt 116")), false);
});

test("fakeCapacity: a car socket panel with a voltmeter sums its ports' watts; it isn't a fake", async () => {
  // 1,000 check (2026-11-06): a ₪10-13 "117W" socket with a voltmeter, 10,000 sold, was flagged.
  const { fakeCapacity } = await import("../format.js");
  assert.equal(fakeCapacity("מטען רכב USB כפול PD כפול 117W עם מד וולטמטר מתאם יציאת חשמל עמיד למים", "13.09"), false);
  assert.equal(fakeCapacity("96w כפול pd qc3.0 USB מטען motobike עם מתאם שקע מתח", "11.09"), false);
  assert.equal(fakeCapacity("מטען רכב USB PD 250W טעינה מהירה סוג C מתאם טלפון", "18.31"), true, "a plain 250W car charger at ₪18 still is");
});

test("colorVariant: more of the names sellers give the asked color", async () => {
  // Free check of 31 color searches (2026-11-07): listings shown in the asked color 90 -> 112 of 616.
  const { colorVariant } = await import("../format.js");
  const vs = (...names) => names.map((c, i) => ({ skuId: String(i + 1), color: c }));
  assert.equal(colorVariant(vs("Black", "WineRed"), "פיג'מה בורדו").variant.color, "WineRed");
  assert.equal(colorVariant(vs("Blue", "Army Green"), "פונצ'ו חאקי").variant.color, "Army Green");
  assert.equal(colorVariant(vs("Pink", "Champagne"), "עבאיה בז'").variant.color, "Champagne");
  assert.equal(colorVariant(vs("Black", "Chrome"), "ברז כסוף").variant.color, "Chrome");
  assert.equal(colorVariant(vs("touch-black-chrome"), "ברז כסוף").variant, null, "black chrome is black");
  assert.equal(colorVariant(vs("Red", "Olive"), "מעיל ירוק").variant.color, "Olive");
});

test("otherGender: a title only for the other gender; unisex and ungendered titles are fine", async () => {
  const { otherGender } = await import("../format.js");
  assert.equal(otherGender("נעלי ספורט רשת לנשים", "נעלי ספורט לגברים מידה 43"), true);
  assert.equal(otherGender("women mesh sneakers", "men sports shoes size 43"), true);
  assert.equal(otherGender("men women unisex sneakers", "men sports shoes"), false, "unisex");
  assert.equal(otherGender("sneakers", "men sports shoes"), false);
  assert.equal(otherGender("men running shoes", "women leggings size L"), true);
  assert.equal(otherGender("women leggings", "leggings size L"), false, "the request names no gender");
});

test("ageSpec: a child's age in the Hebrew request becomes a kids' size the variants are checked for", async () => {
  const { ageSpec, sizeVariant } = await import("../format.js");
  assert.deepEqual(ageSpec("שמלה לילדה גיל 6"), { unit: "kids", num: "116", eu: 116, lo: 5, hi: 6, raw: "גיל 6" });
  assert.equal(ageSpec("שמלה לבת 8").eu, 128);
  assert.equal(ageSpec("פיג'מה לתינוק בן 9 חודשים").eu, 74);
  assert.equal(ageSpec("מגבת 6 יחידות"), null, "not an age");
  assert.equal(ageSpec("חולצה לבן 30"), null, "no child's size");
  const vs = (...vals) => vals.map((v, i) => ({ skuId: String(i + 1), props: { Size: v } }));
  assert.equal(sizeVariant(vs("4Y", "6Y", "8Y"), ageSpec("שמלה לילדה גיל 6")).skuId, "2");
  assert.equal(sizeVariant(vs("3-4Y", "5-6Y"), ageSpec("שמלה לילדה גיל 6")).skuId, "2");
});

test("fitsDevice: the car or phone a part is for isn't the part's brand", async () => {
  const { fitsDevice } = await import("../format.js");
  assert.equal(fitsDevice("מגב לטויוטה קורולה", "Toyota"), true);
  assert.equal(fitsDevice("כיסוי לאייפון 13", "iPhone"), true);
  assert.equal(fitsDevice("מטען של אנקר לאייפון", "Anker"), false, "the charger's own brand stays");
  assert.equal(fitsDevice("שעון שיאומי", "Xiaomi"), false, "a Xiaomi watch is a Xiaomi");
});
