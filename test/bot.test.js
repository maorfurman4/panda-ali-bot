import { test } from "node:test";
import assert from "node:assert/strict";
import { setup, textUpdate, callbackUpdate } from "./helpers.js";
import { parseTrigger, isSoftRequest, startsWithSearchVerb, dedupeByPhoto } from "../bot.js";
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

test("max price: ILS products above the cap are dropped; non-ILS results ignore the cap", async () => {
  const ils = await run("חפש לי אוזניות עד 13 שקל", { understand: async () => intent({ max_price_ils: 13 }) });
  assert.deepEqual(shownIds(ils.sent()[0]), ["1", "2", "3"]);
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

test("relevance filter decides which products are shown, using the corrected Hebrew and English keywords", async () => {
  const calls = [];
  const relevant = async (req, products) => (calls.push(req), products.filter((p) => /model (2|5)/.test(p.product_title)));
  const ctx = setup({ search: async () => SIX, understand: async () => intent(), relevant, live: true });
  await ctx.bot.handleUpdate(textUpdate("חפש לי אושניות"));
  assert.deepEqual(calls, [{ he: "אוזניות", en: "wireless earbuds" }]);
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

test("enough relevant results -> the early broader search is never AI-checked or shown", async () => {
  const queries = [];
  const checked = [];
  const relevant = async (r, p) => (checked.push(r.en), { exact: p, partial: [] });
  const ctx = setup({ search: async (q) => (queries.push(q), q === "earphones" ? [product(9)] : SIX), relevant, live: true, understand: async () => intent({ fallback_en: "earphones" }) });
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


test("at most 36 candidates go to the relevance check (keeps it fast)", async () => {
  const many = Array.from({ length: 60 }, (_, i) => product(i + 1, { lastest_volume: String(1000 - i) }));
  let sentToAi = 0;
  const ctx = setup({ search: async () => many, relevant: async (_r, p) => ((sentToAi = p.length), p), live: true });
  await ctx.bot.handleUpdate(textUpdate("/search x"));
  assert.equal(sentToAi, 36);
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

test("proven products (≥10 sold) lead the card, then exact ones that sold at least once; never-sold ones only fill in", async () => {
  const items = [product(1, { lastest_volume: "0" }), product(2, { lastest_volume: "3" }), product(3, { lastest_volume: "500" }), product(4, { lastest_volume: "40" }), product(5, { lastest_volume: "12" })];
  const relevant = async (_r, p) => ({ exact: p.filter((x) => /_p(1|2|3)$/.test(x.promotion_link)), partial: p.filter((x) => /_p(4|5)$/.test(x.promotion_link)) });
  const ctx = setup({ search: async () => items, relevant, live: true });
  await ctx.bot.handleUpdate(textUpdate("חפש לי משהו"));
  assert.deepEqual(shownIds(ctx.sent()[0]), ["3", "2", "4", "5"], "proven exact, exact with a few sales, then proven partial; the never-sold exact is left out");
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

test("a brand was asked for and found: only that brand is shown (even 2), no other brands as 'close'", async () => {
  const relevant = async (_r, p) => ({ exact: p.slice(0, 2), partial: p.slice(2) });
  const brand = setup({ search: async () => SIX, relevant, live: true, understand: async () => intent({ brand: "Xiaomi" }) });
  await brand.bot.handleUpdate(textUpdate("חפש לי אוזניות של שיאומי"));
  assert.equal(shownIds(brand.sent()[0]).length, 2);
  const plain = setup({ search: async () => SIX, relevant, live: true, understand: async () => intent() });
  await plain.bot.handleUpdate(textUpdate("חפש לי אוזניות"));
  assert.equal(shownIds(plain.sent()[0]).length, 4, "without a brand, close matches still fill the card");
  const sameBrand = SIX.map((p, i) => (i === 3 ? { ...p, product_title: `Xiaomi ${p.product_title}` } : p));
  const near = setup({ search: async () => sameBrand, relevant, live: true, understand: async () => intent({ brand: "Xiaomi" }) });
  await near.bot.handleUpdate(textUpdate("חפש לי אוזניות של שיאומי"));
  assert.deepEqual(shownIds(near.sent()[0]), ["1", "2", "4"], "a close item of the same brand still shows");
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

test("the same search within 6 hours reuses the products: no new AliExpress or AI call", async () => {
  let t = 0, searches = 0, checks = 0;
  const ctx = setup({ now: () => t, cooldownMs: 0, live: true, search: async () => (searches++, SIX), relevant: async (_r, p) => (checks++, { exact: p, partial: [] }), understand: async () => intent() });
  await ctx.bot.handleUpdate(textUpdate("חפש לי אוזניות", { userId: 1 }));
  t += 60 * 60_000;
  await ctx.bot.handleUpdate(textUpdate("חפש לי אוזניות", { userId: 2 }));
  assert.deepEqual([searches, checks, ctx.sent().length], [3, 1, 2], "3 AliExpress lists once, then memory");
  t += 6 * 60 * 60_000;
  await ctx.bot.handleUpdate(textUpdate("חפש לי אוזניות", { userId: 3 }));
  assert.deepEqual([searches, checks], [6, 2], "expired after 6 hours");
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

test("private chat: nobody is served, the owner included; an invitation to the group (/myid and the owner's /status still work)", async () => {
  const owner = setup({ adminId: "5", privateChat: false, healthChecks: async () => [], search: async () => assert.fail("no search"), understand: async () => assert.fail("no AI") });
  await owner.bot.handleUpdate(textUpdate("חפש לי אוזניות", { chat: "private", userId: 5 }));
  assert.equal(owner.sent()[0].body, PRIVATE_INVITE, "the owner too");
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

test("trusted sellers first: ≥10 sold AND ≥95% positive feedback lead; 90-94% sellers come after", async () => {
  const items = [product(1, { evaluate_rate: "91%", lastest_volume: "5000" }), product(2, { evaluate_rate: "97%", lastest_volume: "300" }), product(3, { evaluate_rate: "96%", lastest_volume: "200" })];
  const ctx = setup({ search: async () => items, live: true });
  await ctx.bot.handleUpdate(textUpdate("חפש לי משהו"));
  assert.deepEqual(shownIds(ctx.sent()[0]), ["2", "3", "1"]);
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

test("live search fetches 3 AliExpress lists for the main words (best-sellers, page 2, relevance) and mixes them", async () => {
  const seen = [];
  const search = async (q, o) => (seen.push(o.page ?? o.sort ?? "p1"), o.sort === "relevance" ? [product(9, { lastest_volume: "3" })] : [product(o.page === 2 ? 5 : 1)]);
  const checked = [];
  const ctx = setup({ search, live: true, relevant: async (_r, p) => (checked.push(...p.map((x) => x.promotion_link.at(-1))), { exact: p, partial: [] }) });
  await ctx.bot.handleUpdate(textUpdate("חפש לי משהו"));
  assert.deepEqual(seen.map(String).sort(), ["2", "p1", "relevance"]);
  assert.deepEqual(checked.sort(), ["1", "5", "9"], "the relevance-ordered item reaches the AI even with 3 sales");
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

test("second chance: too few matches -> the AI's other wording is searched and only new candidates get one more check", async () => {
  const queries = [], checks = [];
  const search = async (q) => (queries.push(q), q === "silicone pacifier" ? [product(7), product(8), product(9)] : [product(1), product(2)]);
  const relevant = async (r, p) => (checks.push(r.en), { exact: p.filter((x) => /_p[789]$/.test(x.promotion_link)), partial: [] });
  const ctx = setup({ search, relevant, live: true, understand: async () => intent({ keywords_en: "baby pacifier", alt_en: "silicone pacifier" }) });
  await ctx.bot.handleUpdate(textUpdate("חפש לי מוצץ לתינוק"));
  assert.deepEqual(checks, ["baby pacifier", "silicone pacifier"]);
  assert.deepEqual(shownIds(ctx.sent()[0]).sort(), ["7", "8", "9"]);
  const strong = setup({ search: async () => SIX, live: true, relevant: async (r, p) => (checks.push(r.en), { exact: p, partial: [] }), understand: async () => intent({ alt_en: "earphones" }) });
  checks.length = 0;
  await strong.bot.handleUpdate(textUpdate("חפש לי אוזניות"));
  assert.equal(checks.length, 1, "enough matches: no second check");
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
