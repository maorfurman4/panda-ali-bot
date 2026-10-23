import { test } from "node:test";
import assert from "node:assert/strict";
import { setup, textUpdate, callbackUpdate } from "./helpers.js";
import { parseTrigger, isSoftRequest } from "../bot.js";
import { RLM, EMPTY_QUERY, NO_RESULTS, SEARCH_ERROR, LINK_ERROR, HELP, GROUP_HELP, NOT_PRODUCT } from "../format.js";

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
  for (const text of ["תודה @panda_test_bot", "חפש בגוגל", "חפש מטען", "חפש", "חפשתי אתמול", "@panda_test_bot_fake כבל", "מה קורה"]) {
    assert.equal(parseTrigger(text, u), null, text);
  }
});

test("group /search sends ONE photo card: top 4, buttons 2×2, as a reply", async () => {
  const { sent, queries, calls } = await run("/search wireless earbuds");
  assert.deepEqual(queries, ["wireless earbuds"]);
  assert.equal(sent().length, 1);
  const [msg] = sent();
  assert.equal(msg.method, "sendPhoto");
  assert.equal(msg.photo, "https://ae01.alicdn.com/kf/img1.jpg");
  assert.equal(msg.parse_mode, "HTML");
  assert.ok(msg.reply_parameters.message_id > 0);
  assert.equal(msg.reply_parameters.allow_sending_without_reply, true);
  const rows = msg.reply_markup.inline_keyboard;
  assert.deepEqual(rows.map((r) => r.length), [2, 2]);
  assert.deepEqual(rows.flat().map((b) => b.text), ["🥇 ₪11.00", "🥈 ₪12.00", "🥉 ₪13.00", "4️⃣ ₪14.00"]);
  assert.equal(rows.flat()[0].url, "https://s.click.aliexpress.com/e/_p1");
  assert.match(msg.caption, /4️⃣/);
  assert.doesNotMatch(msg.caption, /5️⃣/);
  assert.ok(calls.some((c) => c.method === "sendChatAction" && c.payload.action === "typing"));
});

test("private search also shows 4 products", async () => {
  const { sent } = await run("earbuds", {}, { chat: "private" });
  const [msg] = sent();
  assert.match(msg.caption, /4️⃣/);
  assert.doesNotMatch(msg.caption, /5️⃣/);
  assert.deepEqual(msg.reply_markup.inline_keyboard.map((r) => r.length), [2, 2]);
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

test("group chatter and look-alike triggers stay silent", async () => {
  for (const text of ["תודה @panda_test_bot", "חפש בגוגל", "חפש מטען", "אוזניות", "שלום לכולם", "/start@other_bot"]) {
    const { calls, queries } = await run(text);
    assert.deepEqual(queries, [], text);
    assert.equal(calls.length, 0, text);
  }
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

test("/start and /help in a group: one line + deep-link button, 10-minute per-chat cooldown", async () => {
  let t = 0;
  const ctx = setup({ now: () => t });
  await ctx.bot.handleUpdate(textUpdate("/start"));
  const [first] = ctx.sent();
  assert.equal(first.body, GROUP_HELP);
  assert.deepEqual(first.reply_markup.inline_keyboard, [[{ text: "להסבר המלא", url: "https://t.me/panda_test_bot?start=help" }]]);

  t += 60_000;
  await ctx.bot.handleUpdate(textUpdate("/help", { userId: 8 }));
  assert.equal(ctx.sent().length, 1, "silent while cooling down, for any member");

  t += 10 * 60_000;
  await ctx.bot.handleUpdate(textUpdate("/help"));
  assert.equal(ctx.sent().length, 2);
});

test("/start and /help in private show the full help", async () => {
  for (const cmd of ["/start", "/help", "/start help"]) {
    const { sent } = await run(cmd, {}, { chat: "private" });
    assert.equal(sent()[0].body, HELP);
  }
  assert.match(HELP, /מצא לי/);
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
  assert.deepEqual(ils.sent()[0].reply_markup.inline_keyboard.flat().map((b) => b.text), ["🥇 ₪11.00", "🥈 ₪12.00", "🥉 ₪13.00"]);
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
  assert.deepEqual(next.map((b) => b.text), ["עד 50 ₪", "עד 150 ₪", "🔎 תחפש כבר"]);
  assert.deepEqual(ctx.spy.queries, []);

  await press(ctx, next[1]);
  assert.deepEqual(ctx.sessions[1].history.map((h) => h.a), ["תכשיט", "עד 150 ₪"]);
  assert.deepEqual(ctx.spy.queries, ["silver necklace"]);
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

test("advisor (group): only the first question in the group; options open the private chat", async () => {
  const ctx = await adviceSetup({ chat: "group" });
  assert.match(ctx.question.body, /פרטי/);
  const [opt0, opt1, go] = ctx.buttons;
  assert.match(opt0.url, /^https:\/\/t\.me\/panda_test_bot\?start=q_[0-9a-z]+_0$/);
  assert.match(opt1.url, /_1$/);
  assert.match(go.callback_data, /:go$/);
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

test("advisor (group → private): the deep link continues the advice in private chat", async () => {
  const ctx = await adviceSetup({ chat: "group", advise: async () => BUDGET });
  const start = new URL(ctx.buttons[0].url).searchParams.get("start");
  await ctx.bot.handleUpdate(textUpdate(`/start ${start}`, { userId: 7, chat: "private" }));
  assert.deepEqual(ctx.sessions[0].history, [{ q: "איזו מתנה?", a: "תכשיט" }]);
  const q2 = ctx.sent().at(-1);
  assert.equal(q2.chat_id, 7, "next question goes to the private chat");
  assert.match(q2.body, /מה התקציב\?/);
  assert.match(q2.reply_markup.inline_keyboard.flat()[0].callback_data, /^q:/);
});

test("advisor (group → private): someone else's link starts their own copy; an expired link says so", async () => {
  const ctx = await adviceSetup({ chat: "group", advise: async () => BUDGET });
  const start = new URL(ctx.buttons[1].url).searchParams.get("start");
  await ctx.bot.handleUpdate(textUpdate(`/start ${start}`, { userId: 55, chat: "private" }));
  assert.equal(ctx.sent().at(-1).chat_id, 55);
  ctx.tick(10 * 60_000 + 1);
  await ctx.bot.handleUpdate(textUpdate(`/start ${start}`, { userId: 7, chat: "private" }));
  assert.match(ctx.sent().at(-1).body, /פג/);
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
  assert.deepEqual(ctx.sent()[0].reply_markup.inline_keyboard.flat().map((b) => b.text), ["🥇 ₪12.00", "🥈 ₪15.00"]);
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

test("natural request the AI rejects (not a product, or AI unavailable) stays silent", async () => {
  for (const understand of [async () => intent({ status: "not_product", keywords_en: "" }), async () => null, async () => { throw new Error("x"); }]) {
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
  assert.equal(ctx.sent()[0].method, "sendPhoto", "the explicit search right after still runs");
});

test("natural request that needs clarifying shows the question", async () => {
  const ctx = setup({ search: searchSpy().search, understand: async () => CLARIFY });
  await ctx.bot.handleUpdate(textUpdate("מישהו מכיר מתנה טובה לאמא?"));
  assert.match(ctx.sent()[0].body, /איזו מתנה\?/);
});

test("private chat and help text are unaffected / mention natural phrases", async () => {
  assert.deepEqual((await run("מישהו מכיר אוזניות?", {}, { chat: "private" })).queries, ["מישהו מכיר אוזניות?"]);
  assert.match(HELP, /מישהו מכיר/);
});


test("'typing…' is refreshed while a slow search runs, and stops after the reply", async () => {
  const slow = async () => (await new Promise((r) => setTimeout(r, 250)), SIX);
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
  assert.equal(ctx.sent()[0].reply_markup.inline_keyboard.flat().length, 4);
});

test("enough relevant results -> no second search", async () => {
  const queries = [];
  const ctx = setup({ search: async (q) => (queries.push(q), SIX), understand: async () => intent({ fallback_en: "earphones" }) });
  await ctx.bot.handleUpdate(textUpdate("חפש לי אוזניות"));
  assert.deepEqual(queries, ["wireless earbuds"]);
});

test("results are ranked by sales × positive feedback, best first", async () => {
  const items = [
    product(1, { lastest_volume: "50", evaluate_rate: "99%" }),
    product(2, { lastest_volume: "20000", evaluate_rate: "95%" }),
    product(3, { lastest_volume: "3000", evaluate_rate: "98%" }),
  ];
  const { sent } = await run("/search x", { result: items });
  assert.deepEqual(sent()[0].reply_markup.inline_keyboard.flat().map((b) => b.text.slice(0, 2)), ["🥇", "🥈", "🥉"]);
  assert.deepEqual(sent()[0].reply_markup.inline_keyboard.flat().map((b) => b.url.at(-1)), ["2", "3", "1"]);
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


test("only the 24 best-ranked candidates go to the relevance check (keeps it fast)", async () => {
  const many = Array.from({ length: 40 }, (_, i) => product(i + 1, { lastest_volume: String(1000 - i) }));
  let sentToAi = 0;
  const ctx = setup({ search: async () => many, relevant: async (_r, p) => ((sentToAi = p.length), p), live: true });
  await ctx.bot.handleUpdate(textUpdate("/search x"));
  assert.equal(sentToAi, 24);
});
