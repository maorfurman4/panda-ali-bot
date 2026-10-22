import { test } from "node:test";
import assert from "node:assert/strict";
import { setup, textUpdate } from "./helpers.js";
import { parseTrigger } from "../bot.js";
import { RLM, EMPTY_QUERY, NO_RESULTS, SEARCH_ERROR, LINK_ERROR, HELP, GROUP_HELP } from "../format.js";

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

test("group /search sends ONE photo card: top 3, buttons in one row, as a reply", async () => {
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
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].map((b) => b.text), ["🥇 ₪11.00", "🥈 ₪12.00", "🥉 ₪13.00"]);
  assert.deepEqual(rows[0].map((b) => b.url), ["https://s.click.aliexpress.com/e/_p1", "https://s.click.aliexpress.com/e/_p2", "https://s.click.aliexpress.com/e/_p3"]);
  assert.doesNotMatch(msg.caption, /4️⃣/);
  assert.ok(calls.some((c) => c.method === "sendChatAction" && c.payload.action === "upload_photo"));
});

test("private search shows top 5 with buttons in two rows", async () => {
  const { sent } = await run("earbuds", {}, { chat: "private" });
  const [msg] = sent();
  assert.match(msg.caption, /4️⃣/);
  assert.match(msg.caption, /5️⃣/);
  assert.deepEqual(msg.reply_markup.inline_keyboard.map((r) => r.length), [3, 2]);
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
  assert.match(lines[0], /\[דמו\]/);
  assert.equal(caption.match(/\[דמו\]/g).length, 1);
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
