import { test } from "node:test";
import assert from "node:assert/strict";
import { setup, textUpdate, callbackUpdate } from "./helpers.js";
import { parseTrigger, isSoftRequest, startsWithSearchVerb, dedupeByPhoto, checkOptions, strongPool, brandModel } from "../bot.js";
import { RLM, EMPTY_QUERY, NO_RESULTS, SEARCH_ERROR, LINK_ERROR, HELP, PRIVATE_INVITE, NOT_PRODUCT, NOT_ALLOWED, OFF_TOPIC, SEARCHING, guideText, CLOSEST_NOTE, LINK_HELP, NO_FOOD, HOW_TO_SEARCH } from "../format.js";

const product = (n, over = {}) => ({
  product_title: `Wireless Earbuds model ${n}`,
  product_main_image_url: `https://ae01.alicdn.com/kf/img${n}.jpg`,
  target_sale_price: `${10 + n}.00`,
  target_sale_price_currency: "ILS",
  evaluate_rate: "96.5%",
  lastest_volume: "1234",
  promotion_link: `https://s.click.aliexpress.com/e/_p${n}`,
  ...over,
});
const SIX = [1, 2, 3, 4, 5, 6].map((n) => product(n));

// Product numbers in card order, read from the visible links (_p<n>).
const shownIds = (msg) => [...(msg.caption ?? msg.text).matchAll(/aliexpress\.com\/e\/_p(\d+)/g)].map((m) => m[1]);

function searchSpy(result = SIX) {
  const queries = [];
  const search = async (q) => {
    queries.push(q);
    if (result instanceof Error) throw result;
    return result;
  };
  return { queries, search };
}

async function run(text, opts = {}, updateOpts = {}) {
  const spy = searchSpy(opts.result);
  const ctx = setup({ search: spy.search, ...opts });
  await ctx.bot.handleUpdate(textUpdate(text, updateOpts));
  return { ...ctx, queries: spy.queries };
}

test("parseTrigger: start-of-message triggers only", () => {
  const u = "panda_test_bot";
  assert.equal(parseTrigger("חפש לי אוזניות", u), "אוזניות");
  assert.equal(parseTrigger("מצא לי מטען", u), "מטען");
  assert.equal(parseTrigger("חפש לי: כבל", u), "כבל");
  assert.equal(parseTrigger("‏חפש לי אוזניות", u), "אוזניות", "leading RLM from copied mobile text");
  assert.equal(parseTrigger("jpa kh tuzbhu,", u), "tuzbhu, (אוזניות)", "Hebrew typed on the English layout: both spellings go to the AI");
  assert.equal(parseTrigger("jpa kh מטען", u), "מטען", "already Hebrew: unchanged");
  for (const text of ["busca cargador", "Búscame cargador", "encuéntrame cargador"]) assert.equal(parseTrigger(text, u), "cargador", text);
  assert.equal(parseTrigger("@panda_test_bot כבל", u), "כבל");
  assert.equal(parseTrigger("@Panda_Test_Bot, מנורה", u), "מנורה");
  assert.equal(parseTrigger("חפש לי", u), "");
  assert.equal(parseTrigger("@panda_test_bot", u), "");
  assert.equal(parseTrigger("חפש ליהדום לרגליים", u), "ליהדום לרגליים", "missing space: the AI fixes the rest");
  assert.equal(parseTrigger("חפש לימון", u), "לימון");
  assert.equal(parseTrigger("חפשלי מטען", u), "מטען", "no space");
  assert.equal(parseTrigger("חפס לי מטען", u), "מטען", "ס for ש");
  assert.equal(parseTrigger("חפש לי, אוזניות", u), "אוזניות");
  assert.equal(parseTrigger("חפש-לי אוזניות", u), "אוזניות");
  assert.equal(parseTrigger("חפש לי🎧", u), "🎧");
  // every common way of writing the command (owner request)
  for (const text of [
    "החפש לי מטען", "וחפש לי מטען", "חיפש לי מטען", "כפש לי מטען", "הפש לי מטען", "חפשש לי מטען", "תחפוש לי מטען", "תחפס לי מטען",
    "תחפשי לי מטען", "תחפשו לי מטען", "מצה לי מטען", "מצע לי מטען", "תמצא לי מטען", "תמצאי לי מטען", "מיצא לי מטען",
    "חפש ליי מטען", "חפש לנו מטען", "חפש לי. מטען", "בבקשה תחפש לי מטען", "אפשר לחפש לי מטען", "תוכל למצוא לי מטען",
    "פנדה, חפש לי מטען", "jpa kh מטען", "JPA KH מטען", "חפש ךלי מטען", "מצא ךי מטען", "דחוף!!! חפש לי מטען", "אחי תחפש לי מטען",
    "היי @panda_test_bot תמצא לי מטען", "חפששש ליי מטען",
  ]) assert.equal(parseTrigger(text, u), "מטען", text);
  for (const text of ["תודה @panda_test_bot", "חפש בגוגל", "חפש מטען", "חפש", "חפשתי אתמול", "מצאתי לי מטען", "@panda_test_bot_fake כבל", "מה קורה"]) {
    assert.equal(parseTrigger(text, u), null, text);
  }
});

test('a "searching…" note is shown while searching, as a reply, and deleted after the card', async () => {
  const { calls } = await run("/search wireless earbuds");
  const methods = calls.map((c) => c.method).filter((m) => ["sendMessage", "sendPhoto", "deleteMessage"].includes(m));
  assert.deepEqual(methods, ["sendMessage", "sendPhoto", "deleteMessage"]);
  const note = calls.find((c) => c.method === "sendMessage").payload;
  assert.equal(note.text, SEARCHING);
  assert.ok(note.reply_parameters.message_id > 0);
  assert.equal(calls.find((c) => c.method === "deleteMessage").payload.message_id, 999);
});

test("group /search sends ONE photo card: top 4, as a reply, with only the bot's own buttons", async () => {
  const { sent, queries, calls } = await run("/search wireless earbuds");
  assert.deepEqual(queries, ["wireless earbuds"]);
  assert.equal(sent().length, 1);
  const [msg] = sent();
  assert.equal(msg.method, "sendPhoto");
  assert.equal(msg.photo, "https://ae01.alicdn.com/kf/img1.jpg");
  assert.equal(msg.parse_mode, "HTML");
  assert.ok(msg.reply_parameters.message_id > 0);
  assert.equal(msg.reply_parameters.allow_sending_without_reply, true);
  assert.deepEqual(msg.reply_markup.inline_keyboard.map((r) => r.map((b) => b.text)), [["🎯 בול!", "🐼 לא זה"], ["🔍 לחפש עוד?"]], "no price buttons");
  assert.deepEqual(shownIds(msg), ["1", "2", "3", "4"]);
  assert.match(msg.caption, /4️⃣/);
  assert.doesNotMatch(msg.caption, /5️⃣/);
  assert.ok(calls.some((c) => c.method === "sendChatAction" && c.payload.action === "typing"));
});

test("short Hebrew names from the AI replace seller titles; without them the cleaned seller title stays", async () => {
  const asked = [];
  const title = async (request, products) => (asked.push(request), products.map((_, i) => `שם קצר ${i + 1}`));
  const { sent } = await run("/search wireless earbuds", { title });
  assert.deepEqual(asked, ["wireless earbuds"]);
  assert.match(sent()[0].caption, /<b>שם קצר 1<\/b>/);
  const plain = await run("/search wireless earbuds", { title: async () => null });
  assert.doesNotMatch(plain.sent()[0].caption, /שם קצר/);
});

test("'X וגם Y' searches both items, a card for each; 'X ו-Y' without 'וגם' stays one search", async () => {
  const { sent, queries } = await run("/search מטען לרכב וגם כבל לאייפון");
  assert.deepEqual(queries, ["מטען לרכב", "כבל לאייפון"]);
  assert.equal(sent().filter((m) => m.method === "sendPhoto").length, 2);
  const one = await run("/search מטען וכבל");
  assert.deepEqual(one.queries, ["מטען וכבל"]);
});

test("few results: the same model from another seller fills the card; with enough results each model shows once", async () => {
  const two = [product(1, { product_title: "Ruckus R350 access point" }), product(2, { product_title: "Ruckus R350 access point original", target_sale_price: "1858.90" })];
  const few = setup({ search: async () => two, relevant: async (_r, p) => ({ exact: p, partial: [] }), live: true });
  await few.bot.handleUpdate(textUpdate("חפש לי ruckus r350"));
  assert.deepEqual(shownIds(few.sent()[0]), ["1", "2"]);
  const many = [...two, product(3), product(4), product(5), product(6)];
  const full = setup({ search: async () => many, relevant: async (_r, p) => ({ exact: p, partial: [] }), live: true });
  await full.bot.handleUpdate(textUpdate("חפש לי ruckus r350"));
  assert.equal(shownIds(full.sent()[0]).filter((id) => id === "1" || id === "2").length, 1);
});

test("two products with the same short name (one model, two colors) show once when there are enough results", async () => {
  const title = async (_r, products) => products.map((_, i) => (i < 2 ? "KZ EDX Pro X אוזניות" : `שם ${i}`));
  const { sent } = await run("/search earbuds", { title });
  const caption = sent()[0].caption;
  assert.equal(caption.match(/KZ EDX Pro X/g).length, 1);
  assert.match(caption, /4️⃣/, "the card is still filled to 4");
});

test("different products with the same plain short name all stay (three 'מטען רכב USB-C' chargers, 2026-11-02)", async () => {
  const title = async (_r, products) => products.map((_, i) => (i < 3 ? "מטען רכב USB-C" : `שם ${i}`));
  const { sent } = await run("/search car charger", { title });
  assert.equal(sent()[0].caption.match(/מטען רכב USB-C/g).length, 2, "at most 2 alike per card; the third waits for the next card");
});

test("the card title never starts with the search verb, even when the AI echoes it", async () => {
  const { cardTitle } = await import("../bot.js");
  assert.equal(cardTitle("חפש לי שמלת ערב"), "שמלת ערב");
  assert.equal(cardTitle("חפש שמלת ערב ."), "שמלת ערב");
  assert.equal(cardTitle("תמצאי לי מטען"), "מטען");
  assert.equal(cardTitle("מצלמת דרך"), "מצלמת דרך", "a word that only starts like the verb stays");
  const ctx = setup({ understand: async () => intent({ corrected_he: "חפש לי אוזניות" }) });
  await ctx.bot.handleUpdate(textUpdate("חפש לי אוזניות"));
  assert.match(ctx.sent()[0].caption, /🔎 <b>אוזניות<\/b>/);
});

test("orderCard: the same plain name with nearly the same review count is one product in two listings", async () => {
  const { orderCard } = await import("../bot.js");
  const p = (id, short_he, reviewCount, sold) => ({ product_id: id, short_he, reviewCount, avgStars: 4.9, lastest_volume: String(sold), match: "exact", evaluate_rate: "98%" });
  const found = [p("1", "מטען קיר GaN", 4926, 107577), p("2", "מטען קיר GaN", 4920, 105977), p("3", "מטען רכב USB מהיר", 3064, 47265), p("4", "מטען רכב USB-C מהיר", 3069, 39546), p("5", "מטען קיר GaN", 470, 64902), p("6", "מטען שולחני", 900, 9000)];
  const ids = orderCard(found, { context: "מטען מהיר", limit: 4 }).map((x) => x.product_id);
  assert.ok(!ids.includes("2"), "4,920 vs 4,926 reviews under one name: the same listing twice");
  assert.ok(ids.includes("5"), "the same name with other reviews is another product");
  assert.ok(ids.includes("3") && ids.includes("4"), "other names stay, even with close review counts");
});

test("a color search gets one line under the title: many products come in several colors", async () => {
  const colored = setup({ understand: async () => intent({ corrected_he: "ברז שחור למטבח" }) });
  await colored.bot.handleUpdate(textUpdate("חפש לי ברז שחור למטבח"));
  assert.match(colored.sent()[0].caption, /🎨 חלק מהמוצרים מגיעים במבחר צבעים: בדף המוצר בחרו את הצבע שביקשתם/);
  const plain = setup({ understand: async () => intent({ corrected_he: "ברז למטבח" }) });
  await plain.bot.handleUpdate(textUpdate("חפש לי ברז למטבח"));
  assert.doesNotMatch(plain.sent()[0].caption, /🎨/);
});

test("private search also shows 4 products", async () => {
  const { sent } = await run("earbuds", {}, { chat: "private" });
  const [msg] = sent();
  assert.match(msg.caption, /4️⃣/);
  assert.doesNotMatch(msg.caption, /5️⃣/);
  assert.equal(shownIds(msg).length, 4);
});

test("falls back to a text message with the same buttons when sendPhoto fails", async () => {
  const { sent } = await run("/search x", { failMethods: ["sendPhoto"] });
  const methods = sent().map((m) => m.method);
  assert.deepEqual(methods, ["sendPhoto", "sendMessage"]);
  const [photo, text] = sent();
  assert.equal(text.text, photo.caption);
  assert.deepEqual(text.reply_markup, photo.reply_markup);
  assert.ok(text.reply_parameters.message_id > 0);
});

test("missing image goes straight to a text message", async () => {
  const { sent } = await run("/search x", { result: [product(1, { product_main_image_url: undefined })] });
  assert.deepEqual(sent().map((m) => m.method), ["sendMessage"]);
});

test("/search@thisbot works, /search@otherbot is ignored", async () => {
  assert.deepEqual((await run("/search@panda_test_bot lamp")).queries, ["lamp"]);
  const other = await run("/search@other_bot lamp");
  assert.deepEqual(other.queries, []);
  assert.equal(other.calls.length, 0);
});

test("group triggers: חפש לי / מצא לי / mention at start", async () => {
  assert.deepEqual((await run('חפש לי כוס זכוכית 750 מ"ל')).queries, ['כוס זכוכית 750 מ"ל']);
  assert.deepEqual((await run("מצא לי מטען")).queries, ["מטען"]);
  assert.deepEqual((await run("@panda_test_bot כבל")).queries, ["כבל"]);
});

test("look-alike triggers never search; plain chatter gets one fixed 'how to search' message, never an AI call", async () => {
  for (const text of ["תודה @panda_test_bot", "חפש בגוגל", "אוזניות", "שלום לכולם"]) {
    const { sent, queries } = await run(text, { understand: async () => intent({ status: "not_product", keywords_en: "" }) });
    assert.deepEqual(queries, [], text);
    assert.ok(sent().every((m) => m.body === HOW_TO_SEARCH), text);
  }
  const other = await run("/start@other_bot");
  assert.equal(other.calls.length, 0, "commands for other bots: nothing");
});


test("private chat: plain text is a search, and 'חפש לי' is stripped", async () => {
  assert.deepEqual((await run("earbuds", {}, { chat: "private" })).queries, ["earbuds"]);
  assert.deepEqual((await run("חפש לי earbuds", {}, { chat: "private" })).queries, ["earbuds"]);
});

test("empty query asks what to search, without searching", async () => {
  for (const text of ["/search", "חפש לי", "מצא לי", "@panda_test_bot"]) {
    const { sent, queries } = await run(text);
    assert.deepEqual(queries, [], text);
    assert.equal(sent()[0].body, EMPTY_QUERY, text);
  }
});

test("products below 90% positive feedback are hidden; nothing left -> no-results message", async () => {
  const { sent } = await run("/search x", { result: [product(1, { evaluate_rate: "80%" })] });
  assert.equal(sent()[0].body, NO_RESULTS);
});

test("an API error shows the error message, never 'no results'", async () => {
  const { sent } = await run("/search x", { result: new Error("AliExpress down") });
  assert.equal(sent()[0].body, SEARCH_ERROR);
});

test("API titles and the user's query are HTML-escaped in the caption", async () => {
  const { sent } = await run("/search <script>", { result: [product(1, { product_title: "<b>Bad</b> & co" })] });
  const caption = sent()[0].caption;
  assert.ok(caption.includes("&lt;b&gt;Bad&lt;/b&gt; &amp; co"));
  assert.ok(caption.includes("&lt;script&gt;"));
  assert.doesNotMatch(caption, /<script>/);
});

test("mock mode labels the header only and hides the <90% demo product", async () => {
  const ctx = setup(); // default search, mock mode (no ALI_* env in tests)
  await ctx.bot.handleUpdate(textUpdate("/search earbuds", { chat: "private" }));
  const caption = ctx.sent()[0].caption;
  const lines = caption.split("\n");
  assert.match(lines[0], /\[דמו – תוצאות קבועות\]/);
  assert.equal(caption.match(/\[דמו/g).length, 1);
  assert.doesNotMatch(caption, /85%/);
});

test("per-user cooldown of 10 seconds, one warning per window", async () => {
  let t = 100_000;
  const spy = searchSpy();
  const ctx = setup({ search: spy.search, now: () => t });
  await ctx.bot.handleUpdate(textUpdate("/search a", { userId: 1 }));
  t += 3000;
  await ctx.bot.handleUpdate(textUpdate("/search b", { userId: 1 }));
  await ctx.bot.handleUpdate(textUpdate("/search b2", { userId: 1 }));
  await ctx.bot.handleUpdate(textUpdate("/search c", { userId: 2 }));
  t += 8000;
  await ctx.bot.handleUpdate(textUpdate("/search d", { userId: 1 }));
  assert.deepEqual(spy.queries, ["a", "c", "d"]);
  assert.match(ctx.sent()[1].body, /בעוד 7 שניות/);
  assert.equal(ctx.sent().length, 4, "3 results + 1 warning");
});

test("link conversion: private always, group only after a leading mention", async () => {
  const urls = [];
  const convert = async (url) => (urls.push(url), "https://s.click.aliexpress.com/e/_mine");
  const link = "https://he.aliexpress.com/item/1005001234567890.html?spm=x";

  const priv = await run(`תראו ${link}`, { convert }, { chat: "private" });
  assert.ok(priv.sent()[0].body.includes("https://s.click.aliexpress.com/e/_mine"));

  const mention = await run(`@panda_test_bot ${link}`, { convert });
  assert.ok(mention.sent()[0].body.includes("https://s.click.aliexpress.com/e/_mine"));
  assert.deepEqual(mention.queries, []);

  for (const text of [link, `תראו ${link}`, "https://s.click.aliexpress.com/e/_someoneElse"]) {
    const plain = await run(text, { convert });
    assert.equal(plain.calls.length, 0, text);
  }
  assert.deepEqual(urls, [link, link]);
});

test("link reply has the link, no disclosure line, and every line starts with RLM", async () => {
  const { sent } = await run("https://www.aliexpress.com/item/1005001234567890.html", { convert: async () => "https://s.click.aliexpress.com/e/_m" }, { chat: "private" });
  const body = sent()[0].body;
  assert.match(body, /הנה הקישור/);
  assert.doesNotMatch(body, /קישורי שותפים/);
  for (const line of body.split("\n")) assert.ok(line.startsWith(RLM));
});

test("look-alike domains are ignored even in private", async () => {
  const convert = async () => assert.fail("must not convert look-alikes");
  const { sent } = await run("https://aliexpress.com.evil.com/item/1005001234567890.html", { convert }, { chat: "private" });
  assert.notEqual(sent()[0]?.method, undefined, "treated as a normal private search instead");
});

test("link conversion: API error -> friendly message; unresolvable link -> silent", async () => {
  const failing = await run("https://a.aliexpress.com/_x", { convert: async () => { throw new Error("boom"); } }, { chat: "private" });
  assert.equal(failing.sent()[0].body, LINK_ERROR);
  const unresolved = await run("https://a.aliexpress.com/_x", { convert: async () => null }, { chat: "private" });
  assert.equal(unresolved.sent().length, 0);
});

test("/start and /help in a group: the full help in the group itself, 10-minute per-chat cooldown", async () => {
  let t = 0;
  const ctx = setup({ now: () => t });
  await ctx.bot.handleUpdate(textUpdate("/start"));
  assert.equal(ctx.sent()[0].body, HELP);
  t += 60_000;
  await ctx.bot.handleUpdate(textUpdate("/help", { userId: 8 }));
  assert.equal(ctx.sent().length, 1, "silent while cooling down, for any member");
});


test("/start and /help in private show the full help", async () => {
  for (const cmd of ["/start", "/help", "/start help"]) {
    const { sent } = await run(cmd, {}, { chat: "private" });
    assert.equal(sent()[0].body, HELP);
  }
});

test("logs never contain message text", async (t) => {
  const logged = [];
  for (const level of ["log", "warn", "error", "info"]) t.mock.method(console, level, (...a) => logged.push(a.join(" ")));
  await run("/search סוד_פרטי_123", { result: new Error("AliExpress down") });
  await run("https://a.aliexpress.com/_x סוד_פרטי_123", { convert: async () => { throw new Error("boom"); } }, { chat: "private" });
  await run("/search סוד_פרטי_123", { failMethods: ["sendPhoto"] });
  assert.ok(logged.length > 0, "errors are logged");
  for (const line of logged) assert.doesNotMatch(line, /סוד_פרטי_123/);
});

// ---- AI query understanding (Phase 2a) ----

const intent = (over = {}) => ({ status: "ok", corrected_he: "אוזניות", keywords_en: "wireless earbuds", max_price_ils: null, ...over });

test("typo: AI-corrected Hebrew in the header, English keywords sent to the search", async () => {
  const seen = [];
  const { sent, queries } = await run("חפש לי אושניות", { understand: async (q) => (seen.push(q), intent()) });
  assert.deepEqual(seen, ["אושניות"], "only the query text goes to the AI");
  assert.deepEqual(queries, ["wireless earbuds"]);
  const header = sent()[0].caption.split("\n")[0];
  assert.match(header, /אוזניות/);
  assert.doesNotMatch(header, /אושניות|wireless/);
});

test("fail-open: when the AI returns null the raw query is searched as before", async () => {
  const { queries, sent } = await run("חפש לי אושניות", { understand: async () => null });
  assert.deepEqual(queries, ["אושניות"]);
  assert.match(sent()[0].caption.split("\n")[0], /אושניות/);
});

test("fail-open: an AI function that throws is treated as unavailable", async () => {
  const { queries } = await run("חפש לי אושניות", { understand: async () => { throw new Error("boom"); } });
  assert.deepEqual(queries, ["אושניות"]);
});

test("not_product: one short reply, no search", async () => {
  const { sent, queries } = await run("@panda_test_bot תודה", { understand: async () => intent({ status: "not_product", keywords_en: "" }) });
  assert.deepEqual(queries, []);
  assert.equal(sent().length, 1);
  assert.equal(sent()[0].body, NOT_PRODUCT);
});

test("max price: up to 10% over the cap, one such product per card with a note; non-ILS results ignore the cap", async () => {
  const ils = await run("חפש לי אוזניות עד 13 שקל", { understand: async () => intent({ max_price_ils: 13 }) });
  assert.deepEqual(shownIds(ils.sent()[0]), ["1", "2", "3", "4"]); // 14 ₪ is within 10% of 13; 15 ₪ is not
  assert.equal(ils.sent()[0].body.match(/קצת מעל התקציב/g).length, 1);
  const pricey = [product(1, { target_sale_price: "21.00" }), product(2, { target_sale_price: "21.50" }), ...SIX.slice(2)];
  const two = await run("חפש לי אוזניות עד 20 שקל", { understand: async () => intent({ max_price_ils: 20 }), result: pricey }); // 2 over, 4 within
  assert.equal(two.sent()[0].body.match(/קצת מעל התקציב/g).length, 1);
  assert.equal(shownIds(two.sent()[0]).length, 4);
  const fill = await run("חפש לי אוזניות עד 12.8 שקל", { understand: async () => intent({ max_price_ils: 12.8 }) }); // only 2 within: both over ones fill the card
  assert.deepEqual(shownIds(fill.sent()[0]), ["1", "2", "3", "4"]);
  const tooLow = await run("חפש לי אוזניות עד 5 שקל", { understand: async () => intent({ max_price_ils: 5 }) });
  assert.equal(tooLow.sent()[0].body, NO_RESULTS);
  const usd = SIX.map((p) => ({ ...p, target_sale_price_currency: "USD" }));
  const other = await run("חפש לי אוזניות עד 5 שקל", { understand: async () => intent({ max_price_ils: 5 }), result: usd });
  assert.equal(other.sent()[0].method, "sendPhoto");
});

const CLARIFY = intent({
  status: "clarify",
  corrected_he: "מתנה לאמא",
  keywords_en: "",
  clarify_question_he: "איזו מתנה?",
  options: [
    { label_he: "תכשיט", keywords_en: "women necklace" },
    { label_he: "משהו לבית", keywords_en: "home decor" },
  ],
});

const BUDGET = {
  status: "ask",
  question_he: "מה התקציב?",
  options: [
    { label_he: "עד 50 ₪", keywords_en: "women necklace", max_price_ils: 50 },
    { label_he: "עד 150 ₪", keywords_en: "women necklace", max_price_ils: 150 },
  ],
};

async function adviceSetup({ chat = "private", ...opts } = {}) {
  let t = 0;
  const spy = searchSpy();
  const sessions = [];
  const advise = opts.advise ?? (async (s) => (sessions.push(structuredClone(s)), null));
  const ctx = setup({ search: spy.search, understand: async () => CLARIFY, now: () => t, ...opts, advise: async (s) => (sessions.push(structuredClone(s)), advise === opts.advise ? advise(s) : null) });
  await ctx.bot.handleUpdate(textUpdate("חפש לי מתנה לאמא", { userId: 7, chat }));
  const question = ctx.sent()[0];
  const buttons = question.reply_markup.inline_keyboard.flat();
  return { ...ctx, spy, question, buttons, sessions, tick: (ms) => (t += ms) };
}
const press = (ctx, button, userId = 7, chat = "private") => ctx.bot.handleUpdate(callbackUpdate(button.callback_data, { userId, chat }));

test("advisor (private): first question as a reply, option buttons + 'search already', no search yet", async () => {
  const { question, buttons, spy } = await adviceSetup();
  assert.match(question.body, /איזו מתנה\?/);
  assert.ok(question.reply_parameters.message_id > 0);
  assert.deepEqual(buttons.map((b) => b.text), ["תכשיט", "משהו לבית", "🔎 תחפש כבר"]);
  for (const b of buttons) {
    assert.match(b.callback_data, /^q:[0-9a-z]+:(\d|go)$/);
    assert.ok(Buffer.byteLength(b.callback_data) <= 64);
  }
  assert.deepEqual(spy.queries, []);
});

test("advisor (private): a choice asks the next question in the same message, then searches when done, with 'why it fits'", async () => {
  let step = 0;
  const advise = async () => (++step === 1 ? BUDGET : { status: "done", keywords_en: "silver necklace", max_price_ils: 150 });
  const explained = [];
  const explain = async (session, products) => (explained.push(session), products.map((_, i) => `סיבה ${i + 1}`));
  const ctx = await adviceSetup({ advise, explain });
  await press(ctx, ctx.buttons[0]);
  assert.deepEqual(ctx.sessions[0], { request: "מתנה לאמא", history: [{ q: "איזו מתנה?", a: "תכשיט" }] });
  const edit = ctx.calls.find((c) => c.method === "editMessageText");
  assert.match(edit.payload.text, /מה התקציב\?/);
  const next = edit.payload.reply_markup.inline_keyboard.flat();
  assert.deepEqual(next.map((b) => b.text), ["עד 50 ₪", "עד 150 ₪", "⬅️ חזרה", "🔎 תחפש כבר"]);
  assert.deepEqual(ctx.spy.queries, []);

  await press(ctx, next[1]);
  assert.deepEqual(ctx.sessions[1].history.map((h) => h.a), ["תכשיט", "עד 150 ₪"]);
  assert.deepEqual(ctx.spy.queries, ["silver necklace", "women necklace"], "the first answer's search is the broader fallback");
  const card = ctx.sent().at(-1);
  assert.equal(card.method, "sendPhoto");
  assert.match(card.caption, /💡 סיבה 1/);
  assert.equal(explained.length, 1);
});

test("advisor: the chosen request gets the full understanding too (sellers' wordings searched)", async () => {
  const understand = async (q) => (q.includes("·") ? intent({ keywords_en: "silver pendant necklace", terms_en: ["women silver chain"] }) : CLARIFY);
  const ctx = await adviceSetup({ understand, live: true, advise: async () => ({ status: "done", keywords_en: "silver necklace", max_price_ils: 150 }) });
  await press(ctx, ctx.buttons[0]);
  assert.ok(ctx.spy.queries.includes("silver necklace"), "the advisor's words stay the main search");
  assert.ok(ctx.spy.queries.includes("women silver chain") && ctx.spy.queries.includes("silver pendant necklace"));
});

test("advisor: at most 3 questions, then it searches with the last choice's keywords", async () => {
  const ctx = await adviceSetup({ advise: async () => BUDGET });
  await press(ctx, ctx.buttons[0]); // answer 1 -> question 2
  let kb = () => ctx.calls.filter((c) => c.method === "editMessageText").at(-1).payload.reply_markup?.inline_keyboard.flat();
  await press(ctx, kb()[0]); // answer 2 -> question 3
  await press(ctx, kb()[0]); // answer 3 -> search, no 4th question
  assert.equal(ctx.sessions.length, 2, "advisor asked twice after the first question");
  assert.deepEqual(ctx.spy.queries, ["women necklace"]);
});

test("advisor: 'search already' searches right away with the best keywords so far", async () => {
  const ctx = await adviceSetup({ advise: async () => BUDGET });
  await press(ctx, ctx.buttons[2]); // before any answer: the original request
  assert.deepEqual(ctx.spy.queries, ["מתנה לאמא"]);
  const ctx2 = await adviceSetup({ advise: async () => BUDGET });
  await press(ctx2, ctx2.buttons[0]);
  const kb = ctx2.calls.find((c) => c.method === "editMessageText").payload.reply_markup.inline_keyboard.flat();
  await press(ctx2, kb.at(-1));
  assert.deepEqual(ctx2.spy.queries, ["women necklace"]);
});

test("advisor: if the AI fails mid-way, it searches with what it has", async () => {
  const ctx = await adviceSetup(); // advise returns null
  await press(ctx, ctx.buttons[1]);
  assert.deepEqual(ctx.spy.queries, ["home decor"]);
});

test("advisor: buttons expire after 10 minutes, and a used question can't be pressed again", async () => {
  const ctx = await adviceSetup();
  ctx.tick(10 * 60_000 + 1);
  await press(ctx, ctx.buttons[0]);
  assert.equal(ctx.calls.find((c) => c.method === "answerCallbackQuery").payload.text, "הבקשה פגה, חפשו שוב");
  const fresh = await adviceSetup();
  await press(fresh, fresh.buttons[2]);
  await press(fresh, fresh.buttons[0]);
  assert.equal(fresh.calls.filter((c) => c.method === "answerCallbackQuery").at(-1).payload.text, "הבקשה פגה, חפשו שוב");
});

test("advisor (group): 'search already' is for the requester only and answers in the group", async () => {
  const ctx = await adviceSetup({ chat: "group" });
  const go = ctx.buttons[2];
  await press(ctx, go, 99, "group");
  assert.equal(ctx.calls.find((c) => c.method === "answerCallbackQuery").payload.text, "רק מי שביקש יכול לבחור");
  await press(ctx, go, 7, "group");
  assert.deepEqual(ctx.spy.queries, ["מתנה לאמא"]);
  assert.equal(ctx.sent().at(-1).reply_parameters.message_id, ctx.question.reply_parameters.message_id);
});

test("/advice starts the advisor even for a specific product; without the AI it just searches", async () => {
  const sessions = [];
  const ctx = setup({ search: searchSpy().search, advise: async (s) => (sessions.push(s), BUDGET) });
  await ctx.bot.handleUpdate(textUpdate("/advice אוזניות", { chat: "private" }));
  assert.deepEqual(sessions, [{ request: "אוזניות", history: [] }]);
  assert.match(ctx.sent()[0].body, /מה התקציב\?/);
  const spy = searchSpy();
  const plain = setup({ search: spy.search });
  await plain.bot.handleUpdate(textUpdate("/advice אוזניות", { chat: "private" }));
  assert.deepEqual(spy.queries, ["אוזניות"]);
});

test("'why it fits' is only for advisor results", async () => {
  const explained = [];
  await run("/search x", { explain: async (...a) => (explained.push(a), null) });
  assert.equal(explained.length, 0);
});

test("any other callback is still answered", async () => {
  const { bot, calls } = setup();
  await bot.handleUpdate(callbackUpdate("something-else"));
  assert.equal(calls.filter((c) => c.method === "answerCallbackQuery").length, 1);
});

// ---- collage + relevance (Phase 2b) ----
import { InputFile } from "grammy";

test("a collage image is sent as the photo when it can be built", async () => {
  const seen = [];
  const collage = async (urls) => (seen.push(urls), Buffer.from([0xff, 0xd8, 0xff]));
  const { sent } = await run("/search x", { collage });
  assert.ok(sent()[0].photo instanceof InputFile);
  assert.deepEqual(seen, [[1, 2, 3, 4].map((n) => `https://ae01.alicdn.com/kf/img${n}.jpg`)]);
});

test("relevance filter decides which products are shown, using the corrected Hebrew, English keywords and the item's look", async () => {
  const calls = [];
  const relevant = async (req, products) => (calls.push(req), products.filter((p) => /model (2|5)/.test(p.product_title)));
  const ctx = setup({ search: async () => SIX, understand: async () => intent({ looks_like: "two small in-ear buds in a case" }), relevant, live: true });
  await ctx.bot.handleUpdate(textUpdate("חפש לי אושניות"));
  assert.deepEqual(calls, [{ he: "אוזניות", en: "wireless earbuds", looks: "two small in-ear buds in a case", terms: [], steady: true }]);
  assert.deepEqual(shownIds(ctx.sent()[0]), ["2", "5"]);
});

test("relevance filter leaving nothing -> no-results message", async () => {
  const ctx = setup({ search: async () => SIX, relevant: async () => [], live: true });
  await ctx.bot.handleUpdate(textUpdate("/search x"));
  assert.equal(ctx.sent()[0].text, NO_RESULTS);
});


// ---- natural requests without "חפש לי" (group) ----

test("parseTrigger: more explicit command forms", () => {
  for (const [text, q] of [["תחפש לי מטען", "מטען"], ["תמצא לי כבל", "כבל"], ["חפשו לי מנורה", "מנורה"], ["מצאי לי תיק", "תיק"]]) {
    assert.equal(parseTrigger(text, "panda_test_bot"), q, text);
  }
});

test("isSoftRequest spots natural shopping phrases anywhere in a short message", () => {
  for (const text of ["מישהו מכיר מטען טוב לרכב?", "היי, אני מחפש אוזניות", "יש המלצה על שואב אבק?", "איפה קונים כיסוי לאייפון", "רוצה לקנות שעון חכם", "מה מומלץ לקנות לתינוק?"]) {
    assert.equal(isSoftRequest(text), true, text);
  }
  for (const text of ["שלום לכולם", "אוזניות", "מחפשון", "תודה רבה", "x".repeat(10) + " מחפש " + "y".repeat(300)]) {
    assert.equal(isSoftRequest(text), false, text);
  }
});

test("natural request in a group: the AI reads the sentence, keywords are searched", async () => {
  const seen = [];
  const understand = async (q) => (seen.push(q), intent({ corrected_he: "מטען לרכב", keywords_en: "car charger" }));
  const { sent, queries } = await run("מישהו מכיר מטען טוב לרכב?", { understand });
  assert.deepEqual(seen, ["מישהו מכיר מטען טוב לרכב?"]);
  assert.deepEqual(queries, ["car charger"]);
  assert.equal(sent()[0].method, "sendPhoto");
});

test("natural request for something that isn't a product: one warning-style hint per 10 minutes, no search", async () => {
  let t = 0;
  const spy = searchSpy();
  const ctx = setup({ now: () => t, search: spy.search, understand: async () => intent({ status: "not_product", keywords_en: "" }) });
  await ctx.bot.handleUpdate(textUpdate("אני מחפש עבודה בתל אביב"));
  t += 60_000;
  await ctx.bot.handleUpdate(textUpdate("יש המלצה על רופא שיניים?"));
  assert.deepEqual(ctx.sent().map((m) => m.body), [OFF_TOPIC]);
  assert.deepEqual(spy.queries, []);
});

test("natural request when the AI is unavailable stays silent", async () => {
  for (const understand of [async () => null, async () => { throw new Error("x"); }]) {
    const { calls, queries } = await run("אני מחפש עבודה בתל אביב", { understand });
    assert.deepEqual(queries, []);
    assert.equal(calls.filter((c) => c.method.startsWith("send")).length, 0);
  }
});

test("natural request while cooling down is silent (no warning message)", async () => {
  let t = 0;
  const spy = searchSpy();
  const ctx = setup({ search: spy.search, understand: async () => intent(), now: () => t });
  await ctx.bot.handleUpdate(textUpdate("מישהו מכיר אוזניות טובות?", { userId: 1 }));
  t += 2000;
  await ctx.bot.handleUpdate(textUpdate("מישהו מכיר אוזניות אחרות?", { userId: 1 }));
  assert.equal(spy.queries.length, 1);
  assert.equal(ctx.sent().length, 1, "only the first card, no cooldown warning");
});

test("a rejected natural request does not start a cooldown", async () => {
  let n = 0;
  const understand = async () => (++n === 1 ? intent({ status: "not_product", keywords_en: "" }) : intent());
  const ctx = setup({ search: searchSpy().search, understand });
  await ctx.bot.handleUpdate(textUpdate("אני מחפש עבודה", { userId: 1 }));
  await ctx.bot.handleUpdate(textUpdate("חפש לי אוזניות", { userId: 1 }));
  assert.equal(ctx.sent().at(-1).method, "sendPhoto", "the explicit search right after still runs");
});

test("natural request that needs clarifying shows the question", async () => {
  const ctx = setup({ search: searchSpy().search, understand: async () => CLARIFY });
  await ctx.bot.handleUpdate(textUpdate("מישהו מכיר מתנה טובה לאמא?"));
  assert.match(ctx.sent()[0].body, /איזו מתנה\?/);
});

test("natural phrases in a served private chat are searched as-is", async () => {
  assert.deepEqual((await run("מישהו מכיר אוזניות?", {}, { chat: "private" })).queries, ["מישהו מכיר אוזניות?"]);
});


test("'typing…' is refreshed while a slow search runs, and stops after the reply", async () => {
  const slow = async () => (await new Promise((r) => setTimeout(r, 400)), SIX); // generous: the suite runs files in parallel
  const ctx = setup({ search: slow, typingEveryMs: 20 });
  await ctx.bot.handleUpdate(textUpdate("/search x"));
  const typing = () => ctx.calls.filter((c) => c.method === "sendChatAction" && c.payload.action === "typing").length;
  assert.ok(typing() >= 3, `typing sent ${typing()} times`);
  const after = typing();
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(typing(), after, "no typing after the answer");
});


// ---- accuracy: more candidates, broader fallback, ranking, full context ----

test("too few relevant results -> a second, broader search fills up to 4 (no duplicates)", async () => {
  const queries = [];
  const search = async (q) => (queries.push(q), q === "floral ipad case" ? [product(1)] : [product(1), product(2), product(3), product(4)]);
  const ctx = setup({ search, understand: async () => intent({ corrected_he: "כיסוי לאייפד פרחוני", keywords_en: "floral ipad case", fallback_en: "ipad case" }) });
  await ctx.bot.handleUpdate(textUpdate("חפש לי כיסוי לאייפד פרחוני"));
  assert.deepEqual(queries, ["floral ipad case", "ipad case"]);
  assert.equal(shownIds(ctx.sent()[0]).length, 4);
});

test("the broader search runs alongside, in the same single AI check; its weaker item isn't shown when enough are better", async () => {
  const queries = [];
  const checked = [];
  const relevant = async (r, p) => (checked.push(r.en), { exact: p, partial: [] });
  const ctx = setup({ search: async (q) => (queries.push(q), q === "earphones" ? [product(9, { lastest_volume: "1" })] : SIX), relevant, live: true, understand: async () => intent({ fallback_en: "earphones" }) });
  await ctx.bot.handleUpdate(textUpdate("חפש לי אוזניות"));
  assert.deepEqual([...new Set(queries)], ["wireless earbuds", "earphones"], "both start together (3 lists for the main words)");
  assert.deepEqual(checked, ["wireless earbuds"], "one AI check only");
  assert.ok(!shownIds(ctx.sent()[0]).includes("9"));
});

test("results are ranked by sales × positive feedback, best first", async () => {
  const items = [
    product(1, { lastest_volume: "50", evaluate_rate: "99%" }),
    product(2, { lastest_volume: "20000", evaluate_rate: "95%" }),
    product(3, { lastest_volume: "3000", evaluate_rate: "98%" }),
  ];
  const { sent } = await run("/search x", { result: items });
  assert.deepEqual(shownIds(sent()[0]), ["2", "3", "1"]);
});

test("the relevance check gets the full advisor context, not just the last button", async () => {
  const seen = [];
  const relevant = async (req, products) => (seen.push(req), products);
  const ctx = await adviceSetup({ relevant, live: true });
  await press(ctx, ctx.buttons[0]); // AI unavailable -> search with "תכשיט"
  assert.equal(seen[0].he, "מתנה לאמא (תכשיט)");
  assert.equal(seen[0].en, "women necklace");
});

test("no-results message no longer claims English works better", () => {
  assert.doesNotMatch(NO_RESULTS, /באנגלית/);
});


test("at most 72 candidates go to the relevance check (keeps it fast)", async () => {
  const many = Array.from({ length: 90 }, (_, i) => product(i + 1, { lastest_volume: String(1000 - i) }));
  let sentToAi = 0;
  const ctx = setup({ search: async () => many, relevant: async (_r, p) => ((sentToAi = p.length), p), live: true });
  await ctx.bot.handleUpdate(textUpdate("/search x"));
  assert.equal(sentToAi, 72);
});

test("a style search keeps 48 candidates for the relevance check, as approved", async () => {
  const many = Array.from({ length: 90 }, (_, i) => product(i + 1, { lastest_volume: String(1000 - i) }));
  let sentToAi = 0;
  const ctx = setup({ search: async () => many, understand: async () => intent({ style: true }), relevant: async (_r, p) => ((sentToAi = p.length), p), live: true });
  await ctx.bot.handleUpdate(textUpdate("חפש לי שמלה"));
  assert.equal(sentToAi, 48);
});


test("exact matches are shown before partial ones, even with fewer sales", async () => {
  const items = [product(1, { lastest_volume: "90000" }), product(2, { lastest_volume: "10" }), product(3, { lastest_volume: "50000" })];
  const relevant = async (_r, p) => ({ exact: [p.find((x) => x.promotion_link.endsWith("_p2"))], partial: p.filter((x) => !x.promotion_link.endsWith("_p2")) });
  const { sent } = await run("/search x", { result: items, relevant, live: true });
  assert.deepEqual(shownIds(sent()[0]), ["2", "1", "3"]);
});

test("fewer than 4 exact matches -> the broader search runs even if partials fill the card", async () => {
  const queries = [];
  const search = async (q) => (queries.push(q), q === "primary" ? [product(1), product(2), product(3), product(4)] : [product(5)]);
  const relevant = async (_r, p) => ({ exact: p.filter((x) => /_p(1|5)$/.test(x.promotion_link)), partial: p.filter((x) => !/_p(1|5)$/.test(x.promotion_link)) });
  const ctx = setup({ search, relevant, live: true, understand: async () => intent({ keywords_en: "primary", fallback_en: "broader" }) });
  await ctx.bot.handleUpdate(textUpdate("חפש לי משהו"));
  assert.deepEqual([...new Set(queries)], ["primary", "broader"]);
  assert.deepEqual(shownIds(ctx.sent()[0]).slice(0, 2).sort(), ["1", "5"], "both exact matches first");
});

// ---- bare product names in groups: a hint to write "חפש לי ..." ----
test("a reply that says 'חפש לי' or asks naturally is searched (owner request)", async () => {
  for (const text of ["חפש לי אוזניות", "מישהו מכיר אוזניות טובות?"]) {
    const ctx = setup({ search: searchSpy().search, understand: async () => intent() });
    const u = textUpdate(text);
    u.message.reply_to_message = { message_id: 1, date: 0, chat: u.message.chat, text: "x" };
    await ctx.bot.handleUpdate(u);
    assert.equal(ctx.sent()[0].method, "sendPhoto", text);
  }
});

// ---- 🎯/🐼 and "לחפש עוד?" under each card ----
import { createStats } from "../stats.js";
import { NO_MORE, MORE_NOT_YOURS, VOTE_THANKS, VOTED } from "../format.js";

const keyboard = (msg) => msg.reply_markup.inline_keyboard.map((r) => r.map((b) => b.text));
const button = (msg, text) => msg.reply_markup.inline_keyboard.flat().find((b) => b.text === text);
const answers = (calls) => calls.filter((c) => c.method === "answerCallbackQuery").map((c) => c.payload.text);

test('"לחפש עוד?" sends the next products of the same search to the requester only, without a new search or AI call', async () => {
  const spy = searchSpy([1, 2, 3, 4, 5, 6, 7].map((n) => product(n)));
  let understood = 0;
  const ctx = setup({ search: spy.search, understand: async () => (understood++, null) });
  await ctx.bot.handleUpdate(textUpdate("חפש לי אוזניות"));
  const more = button(ctx.sent()[0], "🔍 לחפש עוד?");
  await ctx.bot.handleUpdate(callbackUpdate(more.callback_data, { userId: 8 }));
  assert.equal(answers(ctx.calls).at(-1), MORE_NOT_YOURS);
  await ctx.bot.handleUpdate(callbackUpdate(more.callback_data, { userId: 7 }));
  const second = ctx.sent()[1];
  assert.equal(second.method, "sendPhoto");
  assert.match(second.caption, /model 5/);
  assert.match(second.caption, /model 7/);
  assert.doesNotMatch(second.caption, /model 1\b/);

  assert.equal(second.reply_parameters.message_id, ctx.sent()[0].reply_parameters.message_id, "replies to the original request");
  assert.deepEqual(spy.queries.length, 1);
  assert.equal(understood, 1);
  await ctx.bot.handleUpdate(callbackUpdate(more.callback_data, { userId: 7 }));
  assert.equal(answers(ctx.calls).at(-1), NO_MORE);
  assert.equal(ctx.sent().length, 2);
});

test('"לחפש עוד?" is always there; with nothing left it answers "אין עוד תוצאות"', async () => {
  const ctx = setup({ search: searchSpy([1, 2, 3].map((n) => product(n))).search });
  await ctx.bot.handleUpdate(textUpdate("/search x"));
  assert.deepEqual(keyboard(ctx.sent()[0]), [["🎯 בול!", "🐼 לא זה"], ["🔍 לחפש עוד?"]]);
  await ctx.bot.handleUpdate(callbackUpdate(button(ctx.sent()[0], "🔍 לחפש עוד?").callback_data));
  assert.equal(answers(ctx.calls).at(-1), NO_MORE);
  assert.equal(ctx.sent().length, 1);
});

test("🎯/🐼: anyone votes once per card; counts and the 🐼 searches show in /status", async () => {
  const stats = createStats();
  const ctx = setup({ stats, adminId: "777", healthChecks: async () => [], search: searchSpy().search, understand: async () => ({ status: "ok", corrected_he: "מגפיים לבנות", keywords_en: "girls boots", max_price_ils: null }) });
  await ctx.bot.handleUpdate(textUpdate("חפש לי מגפיים לבנות"));
  const [up, down] = ["🎯 בול!", "🐼 לא זה"].map((t) => button(ctx.sent()[0], t).callback_data);
  await ctx.bot.handleUpdate(callbackUpdate(up, { userId: 7 }));
  await ctx.bot.handleUpdate(callbackUpdate(down, { userId: 7 }));
  await ctx.bot.handleUpdate(callbackUpdate(down, { userId: 8 }));
  assert.deepEqual(answers(ctx.calls), [VOTE_THANKS, VOTED, VOTE_THANKS]);
  await ctx.bot.handleUpdate(textUpdate("/status", { chat: "private", userId: 777 }));
  const report = ctx.sent().at(-1).body;
  assert.match(report, /🎯 בול: 1 · 🐼 לא זה: 1/);
  assert.match(report, /חיפושים שקיבלו 🐼 לא זה[\s\S]*מגפיים לבנות/);
});

test("not_allowed (weapons, adult, spy cams…): a polite refusal, no search; natural requests and bare names stay silent", async () => {
  const understand = async () => intent({ status: "not_allowed", keywords_en: "" });
  const direct = await run("חפש לי מצלמה נסתרת לשירותים", { understand, search: async () => assert.fail("no search") });
  assert.deepEqual(direct.sent().map((m) => m.body), [NOT_ALLOWED]);
  const natural = await run("מישהו מכיר סכין קפיצית טובה?", { understand, search: async () => assert.fail("no search") });
  assert.equal(natural.sent().length, 0, "a natural request for a blocked item: silent");
});

test("anonymous admin (posts as the group): any member may press their result's buttons", async () => {
  const ctx = setup({ search: searchSpy([1, 2, 3, 4, 5, 6].map((n) => product(n))).search });
  const u = textUpdate("חפש לי כבל", { userId: 1087968824 }); // GroupAnonymousBot
  Object.assign(u.message, { sender_chat: { id: -100123, type: "supergroup", title: "G" }, from: { id: 1087968824, is_bot: true, first_name: "Group", username: "GroupAnonymousBot" } });
  await ctx.bot.handleUpdate(u);
  await ctx.bot.handleUpdate(callbackUpdate(button(ctx.sent()[0], "🔍 לחפש עוד?").callback_data, { userId: 55 }));
  assert.equal(ctx.sent().length, 2);
});

test("sensitive items are refused even when the AI is down, and through /advice too", async () => {
  const down = await run("חפש לי סכין קפיצית", { understand: async () => null, search: async () => assert.fail("no search") });
  assert.deepEqual(down.sent().map((m) => m.body), [NOT_ALLOWED]);
  const fine = await run("חפש לי סכין שף", { understand: async () => null });
  assert.equal(fine.sent()[0].method, "sendPhoto", "ordinary items still search when the AI is down");
  const advice = await run("/advice מצלמה נסתרת", { understand: async () => intent({ status: "not_allowed", keywords_en: "" }), advise: async () => assert.fail("no advisor") }, { chat: "private" });
  assert.deepEqual(advice.sent().map((m) => m.body), [NOT_ALLOWED]);
});

test("the verb without 'לי' ('חפש מטען') searches when the AI sees a product; otherwise silent, no warning", async () => {
  for (const t of ["חפש מטען", "תמצא אוזניות טובות", "החפש כבל"]) assert.ok(startsWithSearchVerb(t), t);
  for (const t of ["חפשתי אתמול", "מצאתי מטען מעולה", "הפסד גדול", "כפשוטו"]) assert.ok(!startsWithSearchVerb(t), t);
  const ok = await run("חפש מטען", { understand: async () => intent({ keywords_en: "charger" }) });
  assert.equal(ok.sent()[0].method, "sendPhoto");
  const chat = await run("תחפש בגוגל", { understand: async () => intent({ status: "not_product", keywords_en: "" }) });
  assert.equal(chat.sent().length, 0);
});

test("the main search failing still shows the broader search's results; both failing shows the error", async () => {
  const search = async (q) => (q === "primary" ? Promise.reject(new Error("AliExpress glitch")) : SIX);
  const ok = setup({ search, understand: async () => intent({ keywords_en: "primary", fallback_en: "broader" }) });
  await ok.bot.handleUpdate(textUpdate("חפש לי משהו"));
  assert.equal(ok.sent()[0].method, "sendPhoto");
  const both = setup({ search: async () => Promise.reject(new Error("down")), understand: async () => intent({ keywords_en: "primary", fallback_en: "broader" }) });
  const err = console.error;
  console.error = () => {}; // the expected failure log
  await both.bot.handleUpdate(textUpdate("חפש לי משהו"));
  console.error = err;
  assert.equal(both.sent()[0].body, SEARCH_ERROR);
});

test("proven exact first, then proven close ones, then exact ones with a few sales; never-sold ones only fill in", async () => {
  const items = [product(1, { lastest_volume: "0" }), product(2, { lastest_volume: "3" }), product(3, { lastest_volume: "500" }), product(4, { lastest_volume: "400" }), product(5, { lastest_volume: "120" })];
  const relevant = async (_r, p) => ({ exact: p.filter((x) => /_p(1|2|3)$/.test(x.promotion_link)), partial: p.filter((x) => /_p(4|5)$/.test(x.promotion_link)) });
  const ctx = setup({ search: async () => items, relevant, live: true });
  await ctx.bot.handleUpdate(textUpdate("חפש לי משהו"));
  assert.deepEqual(shownIds(ctx.sent()[0]), ["3", "4", "5", "2"], "proven exact, proven partial, then exact with a few sales; the never-sold exact is left out");
  const noProvenExact = setup({ search: async () => items, live: true, relevant: async (_r, p) => ({ exact: p.filter((x) => /_p(1|2)$/.test(x.promotion_link)), partial: p.filter((x) => /_p(3|4|5)$/.test(x.promotion_link)) }) });
  await noProvenExact.bot.handleUpdate(textUpdate("חפש לי משהו"));
  assert.equal(shownIds(noProvenExact.sent()[0])[0], "2", "no proven exact match: the best one that sold still leads");
});

test("an AI verdict of 'nothing fits' on a full pool is asked once more; a second empty verdict stands", async () => {
  const many = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => product(n));
  let calls = 0;
  const flaky = async (_r, p) => (++calls === 1 ? { exact: [], partial: [] } : { exact: p.slice(0, 4), partial: [] });
  const ctx = setup({ search: async () => many, relevant: flaky, live: true });
  await ctx.bot.handleUpdate(textUpdate("חפש לי מתקן למסך"));
  assert.equal(calls, 2);
  assert.equal(shownIds(ctx.sent()[0]).length, 4);
  let empties = 0;
  const empty = setup({ search: async () => many, relevant: async () => (++empties, { exact: [], partial: [] }), live: true });
  await empty.bot.handleUpdate(textUpdate("חפש לי מתקן למסך"));
  assert.equal(empties, 2, "asked twice, no more (no alt wording in this intent)");
});

test("only close (partial) matches -> the card says so under the header; any exact match -> no note", async () => {
  const partialOnly = setup({ search: async () => SIX, relevant: async (_r, p) => ({ exact: [], partial: p }), live: true });
  await partialOnly.bot.handleUpdate(textUpdate("חפש לי בגדים של זארה"));
  assert.equal(partialOnly.sent()[0].caption.split("\n")[1], RLM + CLOSEST_NOTE);
  const mixed = setup({ search: async () => SIX, relevant: async (_r, p) => ({ exact: p.slice(0, 1), partial: p.slice(1) }), live: true });
  await mixed.bot.handleUpdate(textUpdate("חפש לי אוזניות"));
  assert.ok(!mixed.sent()[0].caption.includes(CLOSEST_NOTE));
});

test("only what was found: 3 matching products -> exactly 3 on the card, never filled with rejected ones", async () => {
  const relevant = async (_r, p) => ({ exact: p.slice(0, 2), partial: p.slice(2, 3) });
  const { sent } = await run("חפש לי משהו", { relevant, live: true });
  assert.equal(shownIds(sent()[0]).length, 3);
  assert.doesNotMatch(sent()[0].caption, /4️⃣/);
});

test("same photo = same product from another seller: shown once, the best-ranked one, and the card refills", async () => {
  const bits = (flip) => "0".repeat(64 - flip) + "1".repeat(flip);
  const photo = { 1: bits(0), 2: bits(3), 3: bits(40), 4: bits(0), 5: bits(20), 6: null };
  const hash = async (url) => photo[url.match(/img(\d)/)[1]];
  assert.deepEqual((await dedupeByPhoto(SIX, hash)).map((p) => p.product_title.at(-1)), ["1", "3", "5", "6"], "2 (distance 3) and 4 (0) repeat 1; no photo = kept");
  const ctx = setup({ search: async () => SIX, hash });
  await ctx.bot.handleUpdate(textUpdate("חפש לי מגפיים"));
  assert.deepEqual(shownIds(ctx.sent()[0]), ["1", "3", "5", "6"]);
});

test("the AI's price floor (big-ticket items) filters the search; if it finds nothing, the search reruns without it", async () => {
  const seen = [];
  const search = async (q, o) => (seen.push(o.minIls ?? null), o.minIls ? [] : SIX);
  const ctx = setup({ search, understand: async () => intent({ keywords_en: "robot vacuum", floor_price_ils: 200 }) });
  await ctx.bot.handleUpdate(textUpdate("חפש לי שואב אבק רובוטי"));
  assert.deepEqual(seen, [200, null]);
  assert.equal(ctx.sent()[0].method, "sendPhoto");
});

test("a brand was asked for and found: the brand first; other brands only fill a short card, and the card says so", async () => {
  const first2 = (x) => /_p[12]$/.test(x.promotion_link);
  const relevant = async (_r, p) => ({ exact: p.filter(first2), partial: p.filter((x) => !first2(x)) });
  const brand = setup({ search: async () => SIX, relevant, live: true, understand: async () => intent({ brand: "Xiaomi" }) });
  await brand.bot.handleUpdate(textUpdate("חפש לי אוזניות של שיאומי"));
  assert.deepEqual(shownIds(brand.sent()[0]).slice(0, 2), ["1", "2"], "the brand's items first");
  assert.equal(shownIds(brand.sent()[0]).length, 4, "always 4 (owner, 2026-11-03)");
  assert.match(brand.sent()[0].body, /הוספתי גם דומים ממותגים אחרים/);
  const plain = setup({ search: async () => SIX, relevant, live: true, understand: async () => intent() });
  await plain.bot.handleUpdate(textUpdate("חפש לי אוזניות"));
  assert.equal(shownIds(plain.sent()[0]).length, 4, "without a brand, close matches still fill the card");
  const sameBrand = SIX.map((p, i) => (i === 3 ? { ...p, product_title: `Xiaomi ${p.product_title}` } : p));
  const near = setup({ search: async () => sameBrand, relevant, live: true, understand: async () => intent({ brand: "Xiaomi" }) });
  await near.bot.handleUpdate(textUpdate("חפש לי אוזניות של שיאומי"));
  assert.deepEqual(shownIds(near.sent()[0]), ["1", "2", "4", "3"], "a close item of the same brand still shows, before another brand's fill");
});

test("a named brand: its items go first into the AI pool, ahead of bigger-selling generic ones", async () => {
  const items = Array.from({ length: 30 }, (_, i) => product(i + 1, { lastest_volume: String(30000 - i * 100), product_title: i >= 27 ? `Baseus holder ${i}` : `Generic holder ${i}` }));
  let pool = [];
  const ctx = setup({ search: async () => items, live: true, understand: async () => intent({ brand: "Baseus" }), relevant: async (_r, p) => ((pool = p), { exact: p, partial: [] }) });
  await ctx.bot.handleUpdate(textUpdate("חפש לי מעמד לרכב של Baseus"));
  assert.ok(pool.slice(0, 3).every((p) => /Baseus/.test(p.product_title)), "the 3 Baseus items lead the pool");
});

test("a proven 'near' item is ranked with the exact ones by sales, not after all of them (non-style)", async () => {
  const { pickProducts } = await import("../bot.js");
  const items = [...Array.from({ length: 14 }, (_, i) => product(i + 1, { lastest_volume: String(1400 - i * 50) })), product(99, { lastest_volume: "79513" })];
  const relevant = async (_r, p) => ({ exact: p.filter((x) => !x.promotion_link.endsWith("_p99")), near: p.filter((x) => x.promotion_link.endsWith("_p99")), partial: [] });
  const run = (style) => pickProducts({ search: async () => items, relevant, live: true }, { keywords: "cordless hair clipper", context: "מכונת תספורת אלחוטית", style, limit: 4, extra: 8 });
  assert.equal((await run(false))[0].promotion_link.slice(-4), "_p99", "the 79,513-sold T9 leads");
  assert.ok(!(await run(true)).some((p) => p.promotion_link.endsWith("_p99")), "style: near still waits behind the exact ones");
  const close = [...items.slice(0, 14), product(98, { lastest_volume: "2000" })];
  const relevant2 = async (_r, p) => ({ exact: p.filter((x) => !x.promotion_link.endsWith("_p98")), near: p.filter((x) => x.promotion_link.endsWith("_p98")), partial: [] });
  const out = await pickProducts({ search: async () => close, relevant: relevant2, live: true }, { keywords: "phone stand", context: "מעמד לטלפון", limit: 4, extra: 8 });
  assert.equal(out[0].promotion_link.slice(-4), "_p98", "any proven near ranks by sales with the exact ones (family 1, 2026-11-04); car holders for a desk stand are moved to close by code");
});

test("fake capacity (a ₪18 '2TB' flash drive) goes after the real ones and is marked for the card note", async () => {
  const { pickProducts } = await import("../bot.js");
  const items = [product(1, { product_title: "Lenovo דיסק און קי 2TB USB 3.0", target_sale_price: "18", lastest_volume: "9000" }), ...Array.from({ length: 5 }, (_, i) => product(i + 2, { product_title: `SanDisk דיסק און קי ${64 * (i + 1)}GB`, target_sale_price: "40", lastest_volume: String(3000 - i * 100) }))];
  const out = await pickProducts({ search: async () => items, relevant: async (_r, p) => ({ exact: p, partial: [] }), live: true }, { keywords: "usb flash drive", context: "דיסק און קי", limit: 4, extra: 8 });
  assert.ok(!out.slice(0, 4).some((p) => /2TB/.test(p.product_title)), "the fake is not on the card");
  assert.ok(out.find((p) => /2TB/.test(p.product_title))?.fakeMoved, "marked: it would have led the card");
});

test("one AI call judges both the main and the broader search (no second check)", async () => {
  const checked = [];
  const search = async (q) => (q === "primary" ? [product(1)] : [product(2), product(3), product(4)]);
  const relevant = async (_r, p) => (checked.push(p.length), { exact: p, partial: [] });
  const ctx = setup({ search, relevant, live: true, understand: async () => intent({ keywords_en: "primary", fallback_en: "broader" }) });
  await ctx.bot.handleUpdate(textUpdate("חפש לי משהו"));
  assert.deepEqual(checked, [4], "one call with the pool of both searches");
  assert.equal(shownIds(ctx.sent()[0]).length, 4);
});

test("the same search within 24 hours reuses the products: no new AliExpress or AI call", async () => {
  let t = 0, searches = 0, checks = 0;
  const ctx = setup({ now: () => t, cooldownMs: 0, live: true, search: async () => (searches++, SIX), relevant: async (_r, p) => (checks++, { exact: p, partial: [] }), understand: async () => intent() });
  await ctx.bot.handleUpdate(textUpdate("חפש לי אוזניות", { userId: 1 }));
  t += 60 * 60_000;
  await ctx.bot.handleUpdate(textUpdate("חפש לי אוזניות", { userId: 2 }));
  assert.deepEqual([searches, checks, ctx.sent().length], [2, 1, 2], "2 AliExpress lists once, then memory");
  t += 22 * 60 * 60_000;
  await ctx.bot.handleUpdate(textUpdate("חפש לי אוזניות", { userId: 3 }));
  assert.deepEqual([searches, checks], [2, 1], "still memory after 23 hours");
  t += 2 * 60 * 60_000;
  await ctx.bot.handleUpdate(textUpdate("חפש לי אוזניות", { userId: 4 }));
  assert.deepEqual([searches, checks], [4, 2], "expired after 24 hours");
});

test("advisor: a tap within 1.5 s of the question changing is ignored (the second tap of a double tap)", async () => {
  let t = 0;
  const advise = async () => ({ status: "ask", question_he: "באיזה אורך?", options: [{ label_he: "1 מטר", keywords_en: "cable 1m", max_price_ils: null }, { label_he: "3 מטר", keywords_en: "cable 3m", max_price_ils: null }] });
  const ctx = setup({ now: () => t, doubleTapMs: 1500, search: searchSpy().search, advise, understand: async () => CLARIFY });
  await ctx.bot.handleUpdate(textUpdate("מתנה", { chat: "private" }));
  const first = ctx.sent()[0].reply_markup.inline_keyboard.flat()[0].callback_data;
  t += 5000;
  await ctx.bot.handleUpdate(callbackUpdate(first, { chat: "private" })); // a real choice: next question shows
  const edits = () => ctx.calls.filter((c) => c.method === "editMessageText").length;
  assert.equal(edits(), 1);
  const second = ctx.calls.find((c) => c.method === "editMessageText").payload.reply_markup.inline_keyboard.flat()[1].callback_data;
  t += 300;
  await ctx.bot.handleUpdate(callbackUpdate(second, { chat: "private" })); // the accidental second tap
  assert.equal(edits(), 1, "ignored");
  t += 2000;
  await ctx.bot.handleUpdate(callbackUpdate(second, { chat: "private" })); // a deliberate tap later works
  assert.ok(edits() >= 2);
});

test("links that aren't AliExpress products: a short help in private (or after a mention), silence in the group, never a search", async () => {
  for (const text of ["https://www.google.com", "s.click.aliexpress.com", "google.com"]) {
    const ctx = setup({ search: async () => assert.fail("no search"), understand: async () => assert.fail("no AI") });
    await ctx.bot.handleUpdate(textUpdate(text, { chat: "private" }));
    assert.deepEqual(ctx.sent().map((m) => m.body), [LINK_HELP], text);
  }
  const group = setup({ search: async () => assert.fail("no search"), understand: async () => assert.fail("no AI") });
  await group.bot.handleUpdate(textUpdate("s.click.aliexpress.com"));
  assert.equal(group.sent().length, 0);
  const mention = setup({ search: async () => assert.fail("no search") });
  await mention.bot.handleUpdate(textUpdate("@panda_test_bot www.google.com"));
  assert.deepEqual(mention.sent().map((m) => m.body), [LINK_HELP]);
  const words = await run("חפש לי אוזניות כמו ב-aliexpress.com", {}, { chat: "private" });
  assert.equal(words.sent()[0].method, "sendPhoto", "a real request that mentions a site is still searched");
});

test("private chat: only the owner is served (to try searches unseen); others get an invitation to the group (/myid still works)", async () => {
  const owner = setup({ adminId: "5", privateChat: false, healthChecks: async () => [], search: async () => SIX });
  await owner.bot.handleUpdate(textUpdate("חפש לי אוזניות", { chat: "private", userId: 5 }));
  assert.equal(owner.sent()[0].method, "sendPhoto", "the owner gets real results in private");
  await owner.bot.handleUpdate(textUpdate("/status", { chat: "private", userId: 5 }));
  assert.match(owner.sent().at(-1).body, /מצב הבוט/);
  const ctx = setup({ adminId: "1", privateChat: false, search: async () => assert.fail("no search"), understand: async () => assert.fail("no AI") });
  await ctx.bot.handleUpdate(textUpdate("אוזניות", { chat: "private", userId: 5 }));
  const [invite] = ctx.sent();
  assert.equal(invite.body, PRIVATE_INVITE);
  assert.match(invite.reply_markup.inline_keyboard[0][0].url, /t\.me\/panda_deals_il/);
  await ctx.bot.handleUpdate(textUpdate("/myid", { chat: "private", userId: 5 }));
  assert.match(ctx.sent().at(-1).body, /5/);
  await ctx.bot.handleUpdate(callbackUpdate("q:1:0", { chat: "private", userId: 5 }));
  assert.match(ctx.calls.at(-1).payload.text, /בקבוצת/);
});

test("advisor in the group: the options are buttons in the group (no move to private), for the requester only", async () => {
  const ctx = setup({ search: searchSpy().search, understand: async () => CLARIFY });
  await ctx.bot.handleUpdate(textUpdate("חפש לי מתנה"));
  const buttons = ctx.sent()[0].reply_markup.inline_keyboard.flat();
  assert.ok(buttons.every((b) => b.callback_data && !b.url));
  assert.doesNotMatch(ctx.sent()[0].body, /פרטי/);
  await ctx.bot.handleUpdate(callbackUpdate(buttons[0].callback_data, { userId: 8 }));
  assert.equal(ctx.calls.at(-1).payload.text, "רק מי שביקש יכול לבחור");
});

test("only our group: in any other group the bot does nothing at all", async () => {
  const ctx = setup({ groupId: "-100999", search: async () => assert.fail("no search"), understand: async () => assert.fail("no AI") });
  await ctx.bot.handleUpdate(textUpdate("חפש לי אוזניות", { chatId: -100123 }));
  await ctx.bot.handleUpdate(textUpdate("t.me/spam_channel", { chatId: -100123 }));
  assert.equal(ctx.calls.length, 0);
  const ours = setup({ groupId: "-100123", search: searchSpy().search });
  await ours.bot.handleUpdate(textUpdate("חפש לי אוזניות", { chatId: -100123 }));
  assert.equal(ours.sent()[0].method, "sendPhoto");
});

test("advisor: '⬅️ חזרה' goes one question back; the header lists every choice", async () => {
  const BUDGET_Q = { status: "ask", question_he: "מה התקציב?", options: [{ label_he: "עד 50 ₪", keywords_en: "earrings", max_price_ils: 50 }, { label_he: "מעל 400 ₪", keywords_en: "earrings", min_price_ils: 400, max_price_ils: null }] };
  const ctx = setup({ search: searchSpy().search, understand: async () => CLARIFY, advise: async (s) => (s.history.length === 1 ? BUDGET_Q : null) });
  await ctx.bot.handleUpdate(textUpdate("חפש לי מתנה לאמא"));
  const first = ctx.sent()[0].reply_markup.inline_keyboard.flat();
  assert.ok(!first.some((b) => b.text === "⬅️ חזרה"), "no back on the first question");
  await ctx.bot.handleUpdate(callbackUpdate(first[0].callback_data));
  const edits = () => ctx.calls.filter((c) => c.method === "editMessageText").map((c) => c.payload);
  const back = edits().at(-1).reply_markup.inline_keyboard.flat().find((b) => b.text === "⬅️ חזרה");
  await ctx.bot.handleUpdate(callbackUpdate(back.callback_data));
  assert.match(edits().at(-1).text, /איזו מתנה\?/, "the first question again");
  const again = edits().at(-1).reply_markup.inline_keyboard.flat();
  await ctx.bot.handleUpdate(callbackUpdate(again[0].callback_data));
  const budget = edits().at(-1).reply_markup.inline_keyboard.flat();
  await ctx.bot.handleUpdate(callbackUpdate(budget[0].callback_data));
  const card = ctx.sent().at(-1);
  assert.match(card.caption.split("\n")[0], /מתנה לאמא · תכשיט · עד 50 ₪/);
});

test("help in Hebrew: 'עזרה', 'איך זה עובד?' and the like show the help (same 10-minute group limit); other text doesn't", async () => {
  for (const text of ["עזרה", "איך זה עובד?", "איך מחפשים", "הסבר", "מה הבוט יודע לעשות"]) {
    const ctx = setup({ search: async () => assert.fail("no search"), understand: async () => assert.fail("no AI") });
    await ctx.bot.handleUpdate(textUpdate(text));
    assert.equal(ctx.sent()[0].body, HELP, text);
  }
  const chat = setup({ understand: async () => intent({ status: "not_product", keywords_en: "" }) });
  await chat.bot.handleUpdate(textUpdate("צריך עזרה עם המחשב"));
  assert.notEqual(chat.sent()[0]?.body, HELP);
});

test("trusted sellers first: ≥92% positive feedback, or a big seller (1,000+ sold, 85%+); small 90-91% sellers come after", async () => {
  const items = [product(1, { evaluate_rate: "91%", lastest_volume: "5000" }), product(2, { evaluate_rate: "97%", lastest_volume: "300" }), product(3, { evaluate_rate: "93%", lastest_volume: "2000" }), product(4, { evaluate_rate: "91%", lastest_volume: "400" })];
  const ctx = setup({ search: async () => items, live: true });
  await ctx.bot.handleUpdate(textUpdate("חפש לי משהו"));
  assert.deepEqual(shownIds(ctx.sent()[0]), ["1", "3", "2", "4"], "a 91% item with 5,000 sold is a big seller (owner, 2026-11-03)");
});

test("quality filter: under 90% feedback is left out, unless a big seller (1,000+ sold) with 85%+", async () => {
  const { filterProducts } = await import("../format.js");
  const items = [product(1, { evaluate_rate: "87%", lastest_volume: "19921" }), product(2, { evaluate_rate: "87%", lastest_volume: "900" }), product(3, { evaluate_rate: "80%", lastest_volume: "60000" }), product(4, { evaluate_rate: "92%", lastest_volume: "5" })];
  assert.deepEqual(filterProducts(items).map((p) => p.promotion_link.at(-1)), ["1", "4"]);
});

test("suspiciously cheap and barely sold items are dropped; cheap but proven ones stay", async () => {
  const p = (n, price, sold) => product(n, { target_sale_price: String(price), lastest_volume: String(sold) });
  const items = [p(1, 100, 500), p(2, 110, 400), p(3, 90, 300), p(4, 15, 3), p(5, 20, 9000)];
  const ctx = setup({ search: async () => items, live: true });
  await ctx.bot.handleUpdate(textUpdate("חפש לי משהו"));
  const ids = shownIds(ctx.sent()[0]);
  assert.ok(!ids.includes("4"), "₪15 with 3 sales next to ~₪100 items: suspicious");
  assert.ok(ids.includes("5"), "₪20 with 9,000 sales: a real bargain");
});

test("an empty food search explains that AliExpress barely ships food to Israel", async () => {
  const ctx = setup({ search: async () => [], understand: async () => intent({ corrected_he: "חטיפים יפניים", keywords_en: "Japanese snacks" }) });
  await ctx.bot.handleUpdate(textUpdate("חפש לי חטיפים יפניים"));
  assert.equal(ctx.sent()[0].body, NO_FOOD);
});

test("the fixed 'how to search' message: once per 10 minutes per user, none for admins, links or replies, no AI", async () => {
  let t = 0;
  const ctx = setup({ now: () => t, understand: async () => assert.fail("no AI for chatter") });
  await ctx.bot.handleUpdate(textUpdate("בוקר טוב"));
  t += 60_000;
  await ctx.bot.handleUpdate(textUpdate("מה נשמע"));
  assert.deepEqual(ctx.sent().map((m) => m.body), [HOW_TO_SEARCH]);
  const admin = setup({ admins: [7], understand: async () => assert.fail("no AI") });
  await admin.bot.handleUpdate(textUpdate("דיל חדש בקבוצה! שווה לבדוק"));
  assert.equal(admin.sent().length, 0);
  const link = setup({ understand: async () => assert.fail("no AI") });
  await link.bot.handleUpdate(textUpdate("תראו את זה https://he.aliexpress.com/item/123.html"));
  assert.equal(link.sent().length, 0);
  const reply = setup({ understand: async () => assert.fail("no AI") });
  const u = textUpdate("כן מסכים איתך");
  u.message.reply_to_message = { message_id: 1, date: 0, chat: u.message.chat, text: "x" };
  await reply.bot.handleUpdate(u);
  assert.equal(reply.sent().length, 0);
});

test("advisor: 'תחפש כבר' before any answer searches the AI's English keywords, not the Hebrew request", async () => {
  const spy = searchSpy();
  const ctx = setup({ search: spy.search, understand: async () => ({ ...CLARIFY, keywords_en: "kitchen gadgets" }) });
  await ctx.bot.handleUpdate(textUpdate("חפש לי מוצר למטבח"));
  const go = ctx.sent()[0].reply_markup.inline_keyboard.flat().find((b) => b.text === "🔎 תחפש כבר");
  await ctx.bot.handleUpdate(callbackUpdate(go.callback_data));
  assert.equal(spy.queries[0], "kitchen gadgets");
});

test("a vague request ('מוצר למטבח') opens the advisor even when the AI said 'search'", async () => {
  const advise = async () => ({ status: "ask", question_he: "איזה מוצר למטבח?", options: [{ label_he: "כלי בישול", keywords_en: "cookware", max_price_ils: null }, { label_he: "אחסון", keywords_en: "kitchen storage", max_price_ils: null }] });
  const ctx = setup({ search: async () => assert.fail("no search yet"), advise, understand: async () => intent({ corrected_he: "מוצר למטבח", keywords_en: "kitchen product" }) });
  await ctx.bot.handleUpdate(textUpdate("חפש ךלי מוצר למבטח"));
  assert.match(ctx.sent()[0].body, /איזה מוצר למטבח\?/);
  const specific = await run("חפש לי מוצרי ניקיון לרכב", { understand: async () => intent({ corrected_he: "מוצרי ניקיון לרכב", keywords_en: "car cleaning kit" }) });
  assert.equal(specific.sent()[0].method, "sendPhoto", "'מוצרי ניקיון' is specific: searched");
});

test("live search: best sellers and page 2 for the main words; a style search adds AliExpress's default order", async () => {
  const run = async (style) => {
    const seen = [];
    const search = async (q, o) => (seen.push(o.page ?? o.sort ?? "p1"), o.sort === "relevance" ? [product(9, { lastest_volume: "3" })] : [product(o.page === 2 ? 5 : 1)]);
    const checked = [];
    const ctx = setup({ search, live: true, understand: async () => intent({ style }), relevant: async (_r, p) => (checked.push(...p.map((x) => x.promotion_link.at(-1))), { exact: p, partial: [] }) });
    await ctx.bot.handleUpdate(textUpdate("חפש לי משהו"));
    return { seen: seen.map(String).sort(), checked: checked.sort() };
  };
  assert.deepEqual(await run(false), { seen: ["2", "p1"], checked: ["1", "5"] }, "the default order isn't relevance (EV chargers for 'fast charger', 2026-11-02)");
  const styled = await run(true);
  assert.deepEqual(styled.seen, ["2", "p1", "relevance"]);
  assert.ok(styled.checked.includes("9"), "a style search: the default-order item reaches the AI even with 3 sales");
});

test("with the AI's main category, two more lists search inside it; without a category there are only the 3 lists", async () => {
  const seen = [];
  const search = async (q, o) => (seen.push(`${o.category ?? "-"}/${o.sort ?? o.page ?? "vol"}`), o.category ? [product(7)] : [product(1)]);
  const checked = [];
  const ctx = setup({ search, live: true, understand: async () => intent({ category_id: 6 }), relevant: async (_r, p) => (checked.push(...p.map((x) => x.promotion_link.at(-1))), { exact: p, partial: [] }) });
  await ctx.bot.handleUpdate(textUpdate("חפש לי מיקרוגל"));
  assert.deepEqual(seen.sort(), ["-/2", "-/vol", "6/vol"]);
  assert.ok(checked.includes("7"), "items found only inside the category reach the AI");
});

test("triggers in English, Russian and Arabic; fully glued 'חפשליאוזניות' goes to the AI", () => {
  assert.equal(parseTrigger("find me wireless earbuds", "x"), "wireless earbuds");
  assert.equal(parseTrigger("найди мне чехол для айфона", "x"), "чехол для айфона");
  assert.equal(parseTrigger("ابحث لي عن ساعة ذكية", "x"), "ساعة ذكية");
  assert.equal(parseTrigger("חפשליאוזניות", "x"), "ליאוזניות");
  assert.equal(parseTrigger("finding nemo is great", "x"), null);
});

test("blocked words are refused even when the AI says 'ok' (it did for 'וייפ')", async () => {
  const { sent } = await run("חפש לי וייפ", { understand: async () => intent({ keywords_en: "vape" }), search: async () => assert.fail("no search") });
  assert.deepEqual(sent().map((m) => m.body), [NOT_ALLOWED]);
});

test("the AI's other wording is searched from the start and judged in the same single check", async () => {
  const queries = [], checks = [];
  const search = async (q) => (queries.push(q), q === "silicone pacifier" ? [product(7), product(8), product(9)] : [product(1), product(2)]);
  const relevant = async (r, p) => (checks.push(r.en), { exact: p.filter((x) => /_p[789]$/.test(x.promotion_link)), partial: [] });
  const ctx = setup({ search, relevant, live: true, understand: async () => intent({ keywords_en: "baby pacifier", alt_en: "silicone pacifier" }) });
  await ctx.bot.handleUpdate(textUpdate("חפש לי מוצץ לתינוק"));
  assert.ok(queries.includes("silicone pacifier"));
  assert.deepEqual(checks, ["baby pacifier"], "one AI check: the other wording's items were already in its pool");
  assert.deepEqual(shownIds(ctx.sent()[0]).sort(), ["7", "8", "9"]);
  const strong = setup({ search: async () => SIX, live: true, relevant: async (r, p) => (checks.push(r.en), { exact: p, partial: [] }), understand: async () => intent({ alt_en: "earphones" }) });
  checks.length = 0;
  await strong.bot.handleUpdate(textUpdate("חפש לי אוזניות"));
  assert.equal(checks.length, 1, "enough matches: no second check");
});

test("every seller wording the AI gave is searched at once and judged in the same single check", async () => {
  const queries = [], checks = [];
  const byQuery = { "car air purifier": [product(1)], "car air freshener": [product(7), product(8)], "car aromatherapy diffuser": [product(9)] };
  const search = async (q) => (queries.push(q), byQuery[q] ?? []);
  const relevant = async (r, p) => (checks.push(r.en), { exact: p, partial: [] });
  const ctx = setup({ search, relevant, live: true, understand: async () => intent({ keywords_en: "car air purifier", terms_en: ["car air freshener", "car aromatherapy diffuser"] }) });
  await ctx.bot.handleUpdate(textUpdate("חפש לי מטהר אוויר לרכב"));
  assert.ok(queries.includes("car air freshener") && queries.includes("car aromatherapy diffuser"));
  assert.equal(checks.length, 1);
  assert.deepEqual(shownIds(ctx.sent()[0]).sort(), ["1", "7", "8", "9"]);
});

test("🐼 on a card reports the request and what was shown", async () => {
  const reports = [];
  const stats = { count: () => {}, remember: () => {}, failure: () => {}, report: (n, t) => reports.push([n, t]) };
  const ctx = setup({ search: async () => SIX, stats });
  await ctx.bot.handleUpdate(textUpdate("חפש לי אוזניות"));
  const id = ctx.sent()[0].reply_markup.inline_keyboard[0][1].callback_data.split(":")[1];
  await ctx.bot.handleUpdate(callbackUpdate(`f:${id}:d`, { userId: 99 }));
  assert.equal(reports[0][0], "thumbsDown");
  assert.match(reports[0][1], /לא זה" על: "[^"]+"\nהוצג: .+נמכרו/);
});

test("photo check: a product whose photo isn't the item drops out and the next one moves up; no answer keeps the list", async () => {
  const items = Array.from({ length: 8 }, (_, i) => product(i + 1, { lastest_volume: String(9000 - i * 100) }));
  const looked = [];
  const look = async (_r, p) => (looked.push(p.length), { exact: p.filter((x) => !x.promotion_link.endsWith("_p2")), partial: [] });
  const ctx = setup({ search: async () => items, live: true, look });
  await ctx.bot.handleUpdate(textUpdate("חפש לי ברז"));
  assert.equal(looked[0], 6, "the 4 to show and 2 spare");
  assert.deepEqual(shownIds(ctx.sent()[0]), ["1", "3", "4", "5"]);
  const failed = setup({ search: async () => items, live: true, look: async () => null });
  await failed.bot.handleUpdate(textUpdate("חפש לי ברז"));
  assert.deepEqual(shownIds(failed.sent()[0]), ["1", "2", "3", "4"]);
  const allNo = setup({ search: async () => items, live: true, look: async () => ({ exact: [], partial: [] }) });
  await allNo.bot.handleUpdate(textUpdate("חפש לי ברז"));
  assert.deepEqual(shownIds(allNo.sent()[0]), ["1", "2", "3", "4"], "everything rejected is an odd verdict: keep the list");
});

test("an overpriced item with under 10 sales is dropped; a pricey one people buy stays", async () => {
  const p = (n, price, sold) => product(n, { target_sale_price: String(price), lastest_volume: String(sold) });
  const items = [p(1, 40, 900), p(2, 45, 800), p(3, 50, 700), p(4, 42, 600), p(5, 4000, 0), p(6, 900, 300)];
  const ctx = setup({ search: async () => items, live: true });
  await ctx.bot.handleUpdate(textUpdate("חפש לי סל כביסה"));
  const ids = shownIds(ctx.sent()[0]);
  assert.ok(!ids.includes("5"), "₪4,000 and never sold");
});

test("links are shortened only for the products a card can show (not every search result)", async () => {
  const seen = [];
  const ctx = setup({ search: async (q, o) => (assert.equal(o.shorten, false), SIX), shorten: async (p) => (seen.push(p.length), p) });
  await ctx.bot.handleUpdate(textUpdate("חפש לי אוזניות"));
  assert.ok(seen[0] <= 12, `shortened ${seen[0]}`);
});

test("'הכי זול': the matches are shown cheapest first", async () => {
  const p = (n, price, sold) => product(n, { target_sale_price: String(price), lastest_volume: String(sold) });
  const items = [p(1, 40, 9000), p(2, 25, 300), p(3, 32, 5000), p(4, 28, 800)];
  const cheap = await run("חפש לי את המטען הכי זול", { result: items, live: true });
  assert.deepEqual(shownIds(cheap.sent()[0]), ["2", "4", "3", "1"]);
  const normal = await run("חפש לי מטען", { result: items, live: true });
  assert.notDeepEqual(shownIds(normal.sent()[0]), ["2", "4", "3", "1"], "without 'הכי זול' the usual ranking");
});

test("style items: best sellers and the prettiest take turns (✨ marked), plain-looking ones go last, 16 photos looked at", async () => {
  // 20 straw bags by sales; #2 has 92% feedback and the most sales (a fine pick for style), #3 sold only 5 (left out of the style look).
  const items = Array.from({ length: 20 }, (_, i) => product(i + 1, { lastest_volume: String(i === 2 ? 5 : i === 1 ? 20000 : 9000 - i * 100), evaluate_rate: i === 1 ? "92.4%" : "98.0%" }));
  let asked;
  const look = async (_r, p, opts) => {
    const id = (x) => x.promotion_link.split("_p")[1];
    asked = { n: p.length, pick: opts?.pick, ids: p.map(id) };
    const by = (n) => p.find((x) => id(x) === n);
    return { exact: p, partial: [], pretty: [by("9"), by("1"), by("12")], plain: [by("4")], same: [by("5")] };
  };
  const understand = async () => ({ status: "ok", corrected_he: "תיק קש", keywords_en: "straw bag", max_price_ils: null, style: true });
  const ctx = setup({ search: async () => items, live: true, look, understand });
  await ctx.bot.handleUpdate(textUpdate("חפש לי תיק קש"));
  assert.equal(asked.n, 16);
  assert.equal(asked.pick, 6, "two per card of 4, for the card and both 'עוד' pages");
  assert.ok(asked.ids.includes("2") && !asked.ids.includes("3"), "92% feedback is in; 5 sold is out");
  const caption = ctx.sent()[0].caption ?? ctx.sent()[0].text;
  assert.deepEqual(shownIds(ctx.sent()[0]), ["2", "9", "1", "12"], "seller, prettiest, seller, next prettiest (#1 is both: once, as a seller)");
  assert.equal((caption.match(/✨ מהיפים ביותר/g) ?? []).length, 2);
  assert.deepEqual([...caption.matchAll(/(🥇|🥈|🥉|4️⃣|✨) <b>/gu)].map((m) => m[1]), ["🥇", "✨", "🥈", "✨"], "medals count the sellers only");
  const more = await ctx.bot.handleUpdate(callbackUpdate(ctx.sent()[0].reply_markup.inline_keyboard.flat().find((b) => /עוד/.test(b.text)).callback_data)).then(() => ctx.sent().at(-1));
  assert.ok(!shownIds(more).includes("5"), "a repeat of an earlier item is dropped");
  const plainOnly = setup({ search: async () => items, live: true, understand, look: async (_r, p) => ({ exact: p, partial: [], pretty: [], plain: [p[0]] }) });
  await plainOnly.bot.handleUpdate(textUpdate("חפש לי תיק קש"));
  assert.deepEqual(shownIds(plainOnly.sent()[0]), ["1", "4", "5", "6"], "a plain-looking best seller moves down");
});

test("non-style items keep the usual photo check (4 + 2 spare, no pretty pick)", async () => {
  const items = Array.from({ length: 8 }, (_, i) => product(i + 1, { lastest_volume: String(9000 - i * 100) }));
  let opts;
  const ctx = setup({ search: async () => items, live: true, look: async (_r, p, o) => ((opts = { n: p.length, o }), null) });
  await ctx.bot.handleUpdate(textUpdate("חפש לי מטען"));
  assert.equal(opts.n, 6);
  assert.equal(opts.o, undefined);
});

test("trusted brands: a card without one gets the best brand item second (🏷️), official stores count; badges on the sold line", async () => {
  const items = Array.from({ length: 12 }, (_, i) => product(i + 1, { lastest_volume: String(9000 - i * 500), evaluate_rate: "98%" }));
  items[9] = { ...items[9], product_title: "Baseus car charger 65W" }; // #10, a well-known brand the title check names
  items[11] = { ...items[11], shop_name: "UGREEN Official Store" }; // #12, an official store
  items[2] = { ...items[2], shop_id: 1103573332 }; // #3, AliExpress Choice
  const relevant = async (_r, p) => ({ exact: p, partial: [], brand: p.filter((x) => /Baseus/.test(x.product_title)) });
  const ctx = setup({ search: async () => items, live: true, relevant });
  await ctx.bot.handleUpdate(textUpdate("חפש לי מטען לרכב"));
  const msg = ctx.sent()[0];
  assert.deepEqual(shownIds(msg), ["3", "10", "1", "2"], "Choice (#3, 8,000 sold) edges past 9,000 sold: ≈1.5× the sales");
  const caption = msg.caption ?? msg.text;
  assert.deepEqual([...caption.matchAll(/(🥇|🥈|🥉|4️⃣|✨|🏷️) <b>/gu)].map((m) => m[1]), ["🥇", "🏷️", "🥈", "🥉"]);
  assert.match(caption, /🏷️ מותג מוכר/);
  assert.match(caption, /🛒 נמכרו: [^\n]+ · ✅ Choice/, "badges on the short sold line (on the rating line they wrapped alone on a phone)");
  const more = await ctx.bot.handleUpdate(callbackUpdate(msg.reply_markup.inline_keyboard.flat().find((b) => /עוד/.test(b.text)).callback_data)).then(() => ctx.sent().at(-1));
  assert.deepEqual(shownIds(more).slice(0, 2), ["4", "12"], "the next card gets the official store");
  assert.match(more.caption ?? more.text, /🏷️ חנות רשמית/);
});

test("nothing exact on a full pool is asked once more; a better second answer wins", async () => {
  const items = Array.from({ length: 10 }, (_, i) => product(i + 1));
  let n = 0;
  const relevant = async (_r, p) => (++n === 1 ? { exact: [], partial: p } : { exact: p, partial: [] });
  const ctx = setup({ search: async () => items, live: true, relevant });
  await ctx.bot.handleUpdate(textUpdate("חפש לי מגבת"));
  assert.equal(n, 2);
  assert.doesNotMatch(ctx.sent()[0].caption ?? ctx.sent()[0].text, /לא מצאתי התאמה מדויקת/);
});

test("an ad-banner photo gives way to the listing's next photo; a card never starts with a 🏷️ pick", async () => {
  const items = Array.from({ length: 8 }, (_, i) => product(i + 1, { lastest_volume: String(9000 - i * 100), product_small_image_urls: { string: [`https://ae01.alicdn.com/kf/img${i + 1}.jpg`, `https://ae01.alicdn.com/kf/clean${i + 1}.jpg`] } }));
  let collaged;
  const look = async (_r, p) => ({ exact: p, partial: [], banner: [p[0]] });
  const ctx = setup({ search: async () => items, live: true, look, collage: async (urls) => ((collaged = urls), null) });
  await ctx.bot.handleUpdate(textUpdate("חפש לי מטען"));
  assert.equal(collaged[0], "https://ae01.alicdn.com/kf/clean1.jpg");
  assert.equal(collaged[1], "https://ae01.alicdn.com/kf/img2.jpg");
});

test("a named color: a multi-color listing the photo saw in another color shows its photo in the asked color, with a note", async () => {
  const gallery = (n) => ({ string: [`https://ae01.alicdn.com/kf/img${n}.jpg`, `https://ae01.alicdn.com/kf/blue${n}.jpg`, `https://ae01.alicdn.com/kf/black${n}.jpg`] });
  const items = Array.from({ length: 6 }, (_, i) => product(i + 1, { lastest_volume: String(9000 - i * 100), product_small_image_urls: gallery(i + 1),
    product_title: i === 0 ? "שמלת ערב סאטן, כחול, ירוק, שחור, אדום" : i === 1 ? "שמלת ערב תכלת" : `שמלת ערב שחורה ${i + 1}` }));
  const understand = async () => intent({ corrected_he: "שמלת ערב שחורה", keywords_en: "black evening dress" });
  const look = async (_r, p) => ({ exact: p.slice(2), partial: p.slice(0, 2) }); // 1 and 2 look light blue
  const asked = [];
  const pickPhoto = async (_r, p) => (asked.push(p.map((x) => x.promotion_link.slice(-1))), p.map((x) => x.product_small_image_urls.string[2]));
  let collaged;
  const ctx = setup({ search: async () => items, live: true, understand, look, pickPhoto, collage: async (urls) => ((collaged = urls), null) });
  await ctx.bot.handleUpdate(textUpdate("חפש לי שמלת ערב שחורה"));
  assert.deepEqual(asked, [["1"]], "only the listing whose title names black among other colors");
  assert.ok(collaged.includes("https://ae01.alicdn.com/kf/black1.jpg"));
  assert.ok(!collaged.includes("https://ae01.alicdn.com/kf/img1.jpg"));
  assert.equal(ctx.sent()[0].caption.match(/🎨 חלק מהמוצרים מגיעים במבחר צבעים/g).length, 1, "one line under the title for a color search");
});

test("a named color: no photo in the asked color leaves the card as it was", async () => {
  const items = Array.from({ length: 6 }, (_, i) => product(i + 1, { lastest_volume: String(9000 - i * 100), product_title: i === 0 ? "שמלה כחול, שחור" : `שמלה שחורה ${i}`, product_small_image_urls: { string: [`https://ae01.alicdn.com/kf/img${i + 1}.jpg`, `https://ae01.alicdn.com/kf/x${i + 1}.jpg`] } }));
  const understand = async () => intent({ corrected_he: "שמלה שחורה", keywords_en: "black dress" });
  let collaged;
  const ctx = setup({ search: async () => items, live: true, understand, look: async (_r, p) => ({ exact: p.slice(1), partial: p.slice(0, 1) }), pickPhoto: async (_r, p) => p.map(() => null), collage: async (urls) => ((collaged = urls), null) });
  await ctx.bot.handleUpdate(textUpdate("חפש לי שמלה שחורה"));
  assert.ok(!collaged.some((u) => /\/x\d\.jpg$/.test(u)), "no photo swapped");
});

test("two listings whose banner photos give way to the same second photo show once", async () => {
  const items = Array.from({ length: 8 }, (_, i) => product(i + 1, { lastest_volume: String(9000 - i * 100), product_small_image_urls: { string: [`https://ae01.alicdn.com/kf/img${i + 1}.jpg`, i < 2 ? "https://ae01.alicdn.com/kf/same.jpg" : `https://ae01.alicdn.com/kf/clean${i + 1}.jpg`] } }));
  const look = async (_r, p) => ({ exact: p, partial: [], banner: p.slice(0, 2) });
  const hash = async (url) => (/same/.test(url) ? "0".repeat(64) : url.padEnd(64, "x").slice(-64));
  let collaged;
  const ctx = setup({ search: async () => items, live: true, look, hash, collage: async (urls) => ((collaged = urls), null) });
  await ctx.bot.handleUpdate(textUpdate("חפש לי מנורת טבעת"));
  assert.equal(collaged.filter((u) => /same\.jpg$/.test(u)).length, 1);
});

test("when the photo check drops the leader, the 🏷️ pick doesn't move into first place", async () => {
  const items = Array.from({ length: 12 }, (_, i) => product(i + 1, { lastest_volume: String(9000 - i * 500), evaluate_rate: "98%" }));
  items[9] = { ...items[9], shop_name: "UGREEN Official Store" };
  const look = async (_r, p) => ({ exact: p.filter((x) => !x.promotion_link.endsWith("_p1")), partial: [] });
  const ctx = setup({ search: async () => items, live: true, look });
  await ctx.bot.handleUpdate(textUpdate("חפש לי מטען"));
  const caption = ctx.sent()[0].caption ?? ctx.sent()[0].text;
  assert.deepEqual(shownIds(ctx.sent()[0]), ["2", "10", "3", "4"]);
  assert.deepEqual([...caption.matchAll(/(🥇|🥈|🥉|4️⃣|✨|🏷️) <b>/gu)].map((m) => m[1]), ["🥇", "🏷️", "🥈", "🥉"]);
});

test("real stars replace the % feedback line when the review summary answers", async () => {
  const stars = async (ps) => ps.map((p, i) => (i === 0 ? { ...p, avgStars: 4.9, reviewCount: 319 } : p));
  const ctx = setup({ search: async () => SIX, stars });
  await ctx.bot.handleUpdate(textUpdate("חפש לי אוזניות"));
  const caption = ctx.sent()[0].caption ?? ctx.sent()[0].text;
  assert.match(caption, /⭐ דירוג: 4\.9 \(319 ביקורות\)/);
  assert.match(caption, /👍 משוב חיובי: 97%/, "the others keep the % line");
});

test("variety never moves a close match ahead of a real one", async () => {
  const items = [1, 2, 3, 4, 5].map((n) => product(n, { lastest_volume: String(9000 - n * 100) }));
  const relevant = async (_r, p) => ({ exact: p.slice(0, 4), partial: p.slice(4) });
  const title = async (_q, ps) => ps.map((p) => (p.promotion_link.endsWith("_p5") ? "בקבוק אופניים" : `בקבוק מים ספורט ${p.promotion_link.slice(-1)}00 מ"ל`));
  const ctx = setup({ search: async () => items, live: true, relevant, title });
  await ctx.bot.handleUpdate(textUpdate("חפש לי בקבוק מים"));
  assert.deepEqual(shownIds(ctx.sent()[0]), ["1", "2", "3", "4"]);
});

test("near matches (one judge exact, the other close) come after exact, before close, and don't trigger 'no exact match'", async () => {
  const items = [1, 2, 3, 4].map((n) => product(n, { lastest_volume: String(5000 - n * 100) }));
  const relevant = async (_r, p) => ({ exact: [], near: p.slice(2), partial: p.slice(0, 2) });
  const ctx = setup({ search: async () => items, relevant, live: true });
  await ctx.bot.handleUpdate(textUpdate("חפש לי מוצץ"));
  assert.deepEqual(shownIds(ctx.sent()[0]), ["3", "4", "1", "2"]);
  assert.doesNotMatch(ctx.sent()[0].caption ?? ctx.sent()[0].text, /לא מצאתי התאמה מדויקת/);
});

test("reviews filter the card: gadgets by sales among the well-reviewed; few-review ones follow", async () => {
  const items = Array.from({ length: 12 }, (_, i) => product(i + 1, { lastest_volume: String(9000 - i * 500), evaluate_rate: "98%" }));
  const id = (x) => x.promotion_link.split("_p")[1];
  const reviews = { 1: 5, 2: 300, 3: 40, 4: 900, 5: 60 };
  const stars = async (ps) => ps.map((p) => ({ ...p, avgStars: 4.8, reviewCount: reviews[id(p)] ?? 3 }));
  const gadget = setup({ search: async () => items, live: true, stars });
  await gadget.bot.handleUpdate(textUpdate("חפש לי מטען"));
  assert.deepEqual(shownIds(gadget.sent()[0]), ["2", "3", "4", "5"], "by sales; the 5-review best seller is out of the card");
});

test("only products the photo look saw rise into the card: an unseen one with more reviews stays below them", async () => {
  const items = Array.from({ length: 12 }, (_, i) => product(i + 1, { lastest_volume: String(9000 - i * 500), evaluate_rate: "98%" }));
  const id = (x) => x.promotion_link.split("_p")[1];
  const stars = async (ps) => ps.map((p) => ({ ...p, avgStars: 4.8, reviewCount: id(p) === "10" ? 5000 : 100 + Number(id(p)) }));
  const look = async (_r, ps) => ({ exact: ps, partial: [] }); // sees the first 6
  const ctx = setup({ search: async () => items, live: true, stars, look });
  await ctx.bot.handleUpdate(textUpdate("חפש לי מטען"));
  assert.ok(!shownIds(ctx.sent()[0]).includes("10"), "#10 wasn't photo-checked");
  assert.deepEqual(shownIds(ctx.sent()[0]), ["1", "2", "3", "4"], "the seen ones by sales");
});

test("a named color: the photo look sees 12, a short card gets a second look, only what it saw is shown", async () => {
  const items = Array.from({ length: 20 }, (_, i) => product(i + 1, { lastest_volume: String(9000 - i * 300), evaluate_rate: "98%" }));
  const id = (x) => x.promotion_link.split("_p")[1];
  const seen = [];
  const look = async (_r, ps) => (seen.push(ps.map(id)), { exact: ps.filter((p) => ["2", "11", "15"].includes(id(p))), partial: [] });
  const understand = async () => ({ status: "ok", corrected_he: "מטען שחור", keywords_en: "black charger", max_price_ils: null });
  const ctx = setup({ search: async () => items, live: true, look, understand });
  await ctx.bot.handleUpdate(textUpdate("חפש לי מטען שחור"));
  assert.equal(seen[0].length, 12);
  assert.ok(seen[1]?.length, "fewer than 4 in the right color: the next candidates get a photo look too (owner, 2026-11-03)");
  assert.deepEqual(shownIds(ctx.sent()[0]), ["2", "11", "15"], "only photo-checked right-color products; nothing unchecked fills the card");
});

test("one brand slot per card: when the sales order brings the next card's brand item up, it shows as an ordinary product", async () => {
  const { orderCard } = await import("../bot.js");
  const p = (id, sold, more = {}) => ({ id, match: "exact", lastest_volume: String(sold), evaluate_rate: "98%", reviewCount: Math.round(sold / 10), avgStars: 4.9, ...more });
  const out = orderCard([p("a", 14000), p("b", 2100, { brandSlot: true }), p("c", 7800), p("d", 6100, { brandSlot: true }), p("e", 900)], { context: "מכונת תספורת", limit: 4 });
  assert.equal(out.slice(0, 4).filter((x) => x.brandSlot).length, 1);
  assert.equal(out[1].brandSlot, true, "the card's brand item stays second");
});

test("style cards: ✨ only for 20+ reviews and 4.5+ stars, and a proven seller leads when the card has one (live test, 2026-11-02)", async () => {
  const { orderCard } = await import("../bot.js");
  const p = (id, sold, reviews, more = {}) => ({ product_id: id, product_title: `שמלת ערב ${id}`, match: "exact", lastest_volume: String(sold), evaluate_rate: "98%", reviewCount: reviews, avgStars: 4.9, ...more });
  const out = orderCard([p("new", 13, 4), p("pretty", 110, 3, { pretty: true }), p("proven", 460, 276), p("ok", 220, 24, { pretty: true })], { context: "שמלת ערב שחורה", style: true, limit: 4 });
  assert.equal(out[0].product_id !== "new" && Number(out[0].lastest_volume) >= 50, true, "🥇 is a proven seller, not the 13-sold dress");
  assert.equal(out.find((x) => x.product_id === "pretty").pretty, false, "3 reviews: no ✨");
  assert.equal(out.find((x) => x.product_id === "ok").pretty, true, "24 reviews, 4.9: keeps ✨");
});

test("style cards: a strong seller the AI called 'close' (1,900 sold, 203 reviews) leads over barely-sold exact ones; another color doesn't", async () => {
  const { orderCard } = await import("../bot.js");
  const p = (id, sold, reviews, more = {}) => ({ product_id: id, product_title: `שמלת ערב שחורה ${id}`, match: "exact", lastest_volume: String(sold), evaluate_rate: "98%", reviewCount: reviews, avgStars: 4.8, ...more });
  const found = [p("e1", 79, 5), p("e2", 9, 2), p("e3", 7, 0), p("e4", 6, 0), p("c1", 1900, 203, { match: "partial" }), p("c2", 1100, 146, { match: "partial" }), p("white", 5000, 400, { match: "partial", offColor: true, titleOff: true })];
  const card = orderCard(found, { context: "שמלת ערב שחורה", style: true, limit: 4 }).slice(0, 4).map((x) => x.product_id);
  assert.deepEqual(card.slice(0, 2).sort(), ["c1", "c2"], "the strong sellers lead the first card");
  assert.ok(!card.includes("white"), "a dress in another color doesn't rise");
});

test("style cards: a 510-sold, 96-review dress the photo called 'close' comes before a 79-sold, 5-review one; a title in another color doesn't (owner, 2026-11-02)", async () => {
  const { orderCard } = await import("../bot.js");
  const p = (id, sold, reviews, more = {}) => ({ product_id: id, product_title: `שמלת ערב שחורה ${id}`, match: "exact", lastest_volume: String(sold), evaluate_rate: "98%", reviewCount: reviews, avgStars: 4.9, ...more });
  const found = [p("tight", 1100, 146), p("lace", 110, 17), p("mermaid", 92, 117), p("lucy", 79, 5), p("m9", 9, 2), p("v7", 7, 0), p("big6", 6, 0),
    p("club", 510, 96, { match: "partial", offColor: true }), p("red", 900, 80, { match: "partial", offColor: true, titleOff: true })];
  const card = orderCard(found, { context: "שמלת ערב שחורה", style: true, limit: 4 }).slice(0, 4).map((x) => x.product_id);
  assert.ok(card.includes("club"), `club dress in the first card: ${card}`);
  assert.ok(!card.includes("lucy") && !card.includes("red"), `${card}`);
});

test("advisor buttons: a kind with few best sellers is dropped, the rest go strongest first; budgets and failures stay", async () => {
  const sold = { earrings: [900, 500, 300, 200, 150], scarf: [400, 300, 200, 120, 110, 105], mug: [90, 40, 3] };
  const search = async (q) => (q === "boom" ? Promise.reject(new Error("down")) : (sold[q] ?? []).map((n, i) => ({ product_id: `${q}${i}`, lastest_volume: n })));
  const opt = (k) => ({ label_he: k, keywords_en: k, min_price_ils: null, max_price_ils: null });
  assert.deepEqual((await checkOptions(search, [opt("mug"), opt("earrings"), opt("scarf")])).map((o) => o.label_he), ["scarf", "earrings"]);
  assert.deepEqual((await checkOptions(search, [opt("mug"), opt("boom"), opt("earrings")])).map((o) => o.label_he), ["boom", "earrings"]); // unknown = kept
  assert.deepEqual((await checkOptions(search, [opt("mug"), opt("nothing"), opt("earrings")])).map((o) => o.label_he), ["earrings", "mug"]); // never fewer than 2
  const budget = [{ ...opt("עד 50₪"), max_price_ils: 50 }, opt("50-100 ש״ח")]; // the AI left the second one's prices off
  assert.equal(await checkOptions(async () => assert.fail("no lookup"), budget), budget);
});

test("live advisor: a button whose words find few best sellers is not shown", async () => {
  const sold = { cookware: [500, 400, 300, 200], "kitchen storage": [900, 800, 700, 600, 500], "kitchen magnets": [20] };
  const search = async (q) => (sold[q] ?? []).map((n, i) => ({ product_id: `${q}${i}`, lastest_volume: n }));
  const opt = (label_he, keywords_en) => ({ label_he, keywords_en, max_price_ils: null });
  const advise = async () => ({ status: "ask", question_he: "איזה מוצר למטבח?", options: [opt("כלי בישול", "cookware"), opt("מגנטים", "kitchen magnets"), opt("אחסון", "kitchen storage")] });
  const ctx = setup({ search, live: true, advise, understand: async () => intent({ corrected_he: "מוצר למטבח", keywords_en: "kitchen product" }) });
  await ctx.bot.handleUpdate(textUpdate("חפש לי מוצר למטבח"));
  const buttons = ctx.sent()[0].reply_markup.inline_keyboard.slice(0, -1).map((r) => r[0].text);
  assert.deepEqual(buttons, ["אחסון", "כלי בישול"]);
});

test("judge pool: the top 3 of every list, then the strongest of all lists, products found by more lists first", () => {
  const p = (id, sold) => ({ product_id: id, lastest_volume: String(sold), evaluate_rate: "95%" });
  const strong = p("strong", 25000); // at #5 in both lists: never in by turns of 3, in by strength
  const a = [p("a1", 900), p("a2", 800), p("a3", 700), p("a4", 600), strong, p("a6", 30000)];
  const b = [p("b1", 500), p("b2", 400), p("b3", 300), p("b4", 200), strong];
  const pool = strongPool([a, b], 8).map((x) => x.product_id);
  assert.deepEqual(pool.slice(0, 6), ["a1", "b1", "a2", "b2", "a3", "b3"], "every list keeps a voice");
  assert.deepEqual(pool.slice(6), ["strong", "a6"], "found by 2 lists beats a slightly bigger seller found by one");
});

test("brand and model alone: the words after the brand that are capitalized or carry a digit", () => {
  assert.equal(brandModel("Aruba", "access point Aruba AP22"), "Aruba AP22");
  assert.equal(brandModel("Xiaomi", "Xiaomi Redmi Note 13 phone"), "Xiaomi Redmi Note 13");
  assert.equal(brandModel("Baseus", "Baseus solar security camera"), null, "no model");
  assert.equal(brandModel("Soundcore", "Soundcore Liberty 4 Pro"), null, "already the whole search");
  assert.equal(brandModel(false, "wireless earbuds"), null);
});

test("brand slot: a brand item selling under 10% of the product it would push out of the card doesn't get the slot", async () => {
  const items = Array.from({ length: 8 }, (_, i) => product(i + 1, { lastest_volume: String(16000 - i * 100), evaluate_rate: "98%" }));
  items[6] = { ...items[6], lastest_volume: "430", product_title: "Homefish towel rail" }; // #7: a weak brand item
  const relevant = async (_r, p) => ({ exact: p, partial: [], brand: p.filter((x) => /Homefish/.test(x.product_title)) });
  const ctx = setup({ search: async () => items, live: true, relevant });
  await ctx.bot.handleUpdate(textUpdate("חפש לי מתלה מגבת"));
  assert.ok(!shownIds(ctx.sent()[0]).includes("7"), "430 sold would push out a 15,700-sold rail");
});

test("an explicit search the AI calls 'not a product' gets a second look before 'לא הבנתי'", async () => {
  const calls = [];
  const understand = async (q, o = {}) => (calls.push(o.retry ?? false), o.retry ? intent({ corrected_he: "מוט פינוק", keywords_en: "rain shower system" }) : intent({ status: "not_product", keywords_en: "" }));
  const spy = searchSpy();
  const ctx = setup({ understand, search: spy.search });
  await ctx.bot.handleUpdate(textUpdate("חפש לי מוט פינוק לאינטרפול 4 דרך"));
  assert.deepEqual(calls, [false, true]);
  assert.equal(spy.queries[0], "rain shower system");
  const one = await run("חפש לי עבודה", { understand: async () => intent({ status: "not_product", keywords_en: "" }) });
  assert.equal(one.sent()[0].body, NOT_PRODUCT, "one word: no second look");
});

test("a link AliExpress didn't shorten hides behind a word instead of filling the card", async () => {
  const { formatCard } = await import("../format.js");
  const long = `https://s.click.aliexpress.com/s/${"x".repeat(600)}`;
  const { caption } = formatCard([product(1, { promotion_link: long })], { query: "access point" });
  assert.ok(!caption.includes(`🔗 ${long}`), "not as visible text");
  assert.match(caption, /<a href="https:\/\/s\.click\.aliexpress\.com\/s\/x+">לקנייה בעלי אקספרס<\/a>/);
});

test("the search fails only when every list failed: other wordings carry it when the main words time out", async () => {
  const search = async (q) => (q === "wireless earbuds" ? Promise.reject(new Error("timeout")) : SIX);
  const ctx = setup({ search, live: true, understand: async () => intent({ alt_en: "bluetooth earphones" }) });
  await ctx.bot.handleUpdate(textUpdate("חפש לי אוזניות"));
  assert.equal(ctx.sent()[0].method, "sendPhoto");
});

test("family 6: 'מכונת כביסה' gets a question with buttons for what ships; a weak card gets the note and the digest", async () => {
  const ctx = setup({ search: async () => assert.fail("no search before a button"), understand: async () => intent({ corrected_he: "מכונת כביסה", keywords_en: "washing machine" }) });
  await ctx.bot.handleUpdate(textUpdate("חפש לי מכונת כביסה"));
  assert.match(ctx.sent()[0].body, /כמעט לא שולח מכונות כביסה/);
  assert.deepEqual(ctx.sent()[0].reply_markup.inline_keyboard.slice(0, 2).map((r) => r[0].text), ["מכונת כביסה ניידת", "אביזרים למכונת כביסה"]);
  const { createStats } = await import("../stats.js");
  const stats = createStats();
  const weak = SIX.map((p) => ({ ...p, lastest_volume: "12" }));
  const c2 = setup({ search: async () => weak, stats, understand: async () => intent({ corrected_he: "מפזר חום", keywords_en: "space heater" }) });
  await c2.bot.handleUpdate(textUpdate("חפש לי מפזר חום"));
  assert.match(c2.sent()[0].body, /מעט מוצרים נמכרים/);
  stats.count("search");
  assert.match(stats.digest(), /כרטיס חלש[\s\S]*מפזר חום/);
});

test("stage A (2026-11-04): a fake from a known brand's official store never takes the brand slot", async () => {
  const { pickProducts } = await import("../bot.js");
  const items = [product(1, { product_title: "Lenovo דיסק און קי 1TB", shop_name: "Lenovo Official Store", target_sale_price: "20.82", lastest_volume: "9000" }), ...Array.from({ length: 6 }, (_, i) => product(i + 2, { product_title: `דיסק און קי ${64 * (i + 1)}GB`, target_sale_price: "45", lastest_volume: String(3000 - i * 100) }))];
  const out = await pickProducts({ search: async () => items, relevant: async (_r, p) => ({ exact: p, partial: [] }), live: true }, { keywords: "usb flash drive 1TB", context: "דיסק און קי 1TB", limit: 4, extra: 8 });
  assert.ok(!out.slice(0, 4).some((p) => /Lenovo/.test(p.product_title)), "the fake stays at the end");
  assert.equal(out[0].fakesSkipped, "2TB ב-20 ₪", "the note's example matches the kind skipped");
});
