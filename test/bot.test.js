import { test } from "node:test";
import assert from "node:assert/strict";
import { setup, textUpdate } from "./helpers.js";
import { parseTrigger } from "../bot.js";
import { DISCLOSURE, RLM, EMPTY_QUERY, NO_RESULTS, SEARCH_ERROR, LINK_ERROR, HELP } from "../format.js";

const PRODUCT = {
  product_title: "Wireless Earbuds",
  target_sale_price: "45.90",
  target_sale_price_currency: "ILS",
  evaluate_rate: "96.5%",
  lastest_volume: "1234",
  promotion_link: "https://s.click.aliexpress.com/e/_abc",
};

function searchSpy(result = [PRODUCT]) {
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

test("parseTrigger recognizes Hebrew triggers and mentions only", () => {
  assert.equal(parseTrigger("חפש לי אוזניות", "panda_test_bot"), "אוזניות");
  assert.equal(parseTrigger("חפש מטען מהיר", "panda_test_bot"), "מטען מהיר");
  assert.equal(parseTrigger("חפש לימון סחוט", "panda_test_bot"), "לימון סחוט");
  assert.equal(parseTrigger("חפש", "panda_test_bot"), "");
  assert.equal(parseTrigger("חפשתי אתמול", "panda_test_bot"), null);
  assert.equal(parseTrigger("@panda_test_bot מנורה", "panda_test_bot"), "מנורה");
  assert.equal(parseTrigger("מישהו? @Panda_Test_Bot מנורה", "panda_test_bot"), "מישהו? מנורה");
  assert.equal(parseTrigger("@panda_test_bot_fake מנורה", "panda_test_bot"), null);
  assert.equal(parseTrigger("מה קורה חברים", "panda_test_bot"), null);
  assert.equal(parseTrigger("‏חפש לי אוזניות", "panda_test_bot"), "אוזניות", "leading RLM from copied mobile text");
  assert.equal(parseTrigger("חפש: מטען", "panda_test_bot"), "מטען");
});

test("/search replies once, as a reply, in HTML with results, RLM and disclosure", async () => {
  const { sent, queries } = await run("/search wireless earbuds");
  assert.deepEqual(queries, ["wireless earbuds"]);
  const [msg] = sent();
  assert.equal(sent().length, 1);
  assert.equal(msg.parse_mode, "HTML");
  assert.ok(msg.reply_parameters.message_id > 0);
  assert.ok(msg.text.includes(DISCLOSURE));
  assert.ok(msg.text.includes("96% משוב חיובי"));
  for (const line of msg.text.split("\n")) assert.ok(line.startsWith(RLM));
});

test("/search@thisbot works, /search@otherbot is ignored", async () => {
  assert.deepEqual((await run("/search@panda_test_bot lamp")).queries, ["lamp"]);
  const other = await run("/search@other_bot lamp");
  assert.deepEqual(other.queries, []);
  assert.equal(other.sent().length, 0);
});

test("Hebrew triggers and mention search in a group", async () => {
  assert.deepEqual((await run("חפש לי כוס זכוכית 750 מ\"ל")).queries, ['כוס זכוכית 750 מ"ל']);
  assert.deepEqual((await run("חפש מטען")).queries, ["מטען"]);
  assert.deepEqual((await run("@panda_test_bot מנורת לילה")).queries, ["מנורת לילה"]);
});

test("ordinary group chatter is ignored completely", async () => {
  for (const text of ["מה קורה חברים?", "חפשתי אתמול משהו", "/start@other_bot"]) {
    const { calls, queries } = await run(text);
    assert.deepEqual(queries, [], text);
    assert.equal(calls.length, 0, text);
  }
});

test("any plain text in private chat is a search", async () => {
  assert.deepEqual((await run("earbuds", {}, { chat: "private" })).queries, ["earbuds"]);
});

test("empty query asks what to search, without searching", async () => {
  for (const text of ["/search", "חפש", "חפש לי", "@panda_test_bot"]) {
    const { sent, queries } = await run(text);
    assert.deepEqual(queries, [], text);
    assert.equal(sent()[0].text, EMPTY_QUERY, text);
  }
});

test("products below 90% positive feedback are hidden; nothing left -> no-results message", async () => {
  const { sent } = await run("/search x", { result: [{ ...PRODUCT, evaluate_rate: "80%" }] });
  assert.equal(sent()[0].text, NO_RESULTS);
});

test("an API error shows the error message, never 'no results'", async () => {
  const { sent } = await run("/search x", { result: new Error("AliExpress down") });
  assert.equal(sent()[0].text, SEARCH_ERROR);
});

test("API-supplied titles are HTML-escaped", async () => {
  const { sent } = await run("/search x", { result: [{ ...PRODUCT, product_title: "<b>Bad</b> & co" }] });
  assert.ok(sent()[0].text.includes("&lt;b&gt;Bad&lt;/b&gt; &amp; co"));
});

test("the user's query is HTML-escaped in mock results", async () => {
  const ctx = setup(); // default search, mock mode (no ALI_* env in tests)
  await ctx.bot.handleUpdate(textUpdate("/search <script>"));
  const text = ctx.sent()[0].text;
  assert.ok(text.includes("&lt;script&gt;"));
  assert.doesNotMatch(text, /<script>/);
  assert.match(text, /\[דמו\]/);
  assert.doesNotMatch(text, /דגם 3/, "the 85% demo product is filtered out");
});

test("per-user cooldown of 10 seconds", async () => {
  let t = 100_000;
  const spy = searchSpy();
  const ctx = setup({ search: spy.search, now: () => t });
  await ctx.bot.handleUpdate(textUpdate("/search a", { userId: 1 }));
  t += 3000;
  await ctx.bot.handleUpdate(textUpdate("/search b", { userId: 1 }));
  await ctx.bot.handleUpdate(textUpdate("/search c", { userId: 2 }));
  t += 8000;
  await ctx.bot.handleUpdate(textUpdate("/search d", { userId: 1 }));
  assert.deepEqual(spy.queries, ["a", "c", "d"]);
  assert.match(ctx.sent()[1].text, /בעוד 7 שניות/);
});

test("cooldown warning is sent once per window, then the bot stays silent", async () => {
  let t = 0;
  const spy = searchSpy();
  const ctx = setup({ search: spy.search, now: () => t });
  for (let i = 0; i < 5; i++) await ctx.bot.handleUpdate(textUpdate(`/search ${i}`, { userId: 1 }));
  assert.equal(ctx.sent().length, 2, "one result + one warning");
  t += 10_000;
  await ctx.bot.handleUpdate(textUpdate("/search again", { userId: 1 }));
  assert.deepEqual(spy.queries, ["0", "again"]);
});

test("link conversion shares the per-user cooldown", async () => {
  let t = 0;
  const urls = [];
  const ctx = setup({ now: () => t, convert: async (u) => (urls.push(u), "https://s.click.aliexpress.com/e/_m") });
  for (let i = 0; i < 3; i++) await ctx.bot.handleUpdate(textUpdate(`https://www.aliexpress.com/item/10050000000000${i}.html`, { userId: 1 }));
  assert.equal(urls.length, 1);
});

test("AliExpress link in a group is converted to an affiliate link with disclosure", async () => {
  const urls = [];
  const convert = async (url) => (urls.push(url), "https://s.click.aliexpress.com/e/_mine");
  const { sent, queries } = await run("תראו https://he.aliexpress.com/item/1005001234567890.html?spm=x", { convert });
  assert.deepEqual(urls, ["https://he.aliexpress.com/item/1005001234567890.html?spm=x"]);
  assert.deepEqual(queries, []);
  assert.ok(sent()[0].text.includes("https://s.click.aliexpress.com/e/_mine"));
  assert.ok(sent()[0].text.includes(DISCLOSURE));
});

test("look-alike domains are ignored", async () => {
  const convert = async () => assert.fail("must not convert look-alikes");
  const { calls } = await run("https://aliexpress.com.evil.com/item/1005001234567890.html", { convert });
  assert.equal(calls.length, 0);
});

test("link conversion: API error -> friendly message; unresolvable link -> silent", async () => {
  const failing = await run("https://a.aliexpress.com/_x", { convert: async () => { throw new Error("boom"); } });
  assert.equal(failing.sent()[0].text, LINK_ERROR);
  const unresolved = await run("https://a.aliexpress.com/_x", { convert: async () => null });
  assert.equal(unresolved.calls.length, 0);
});

test("/start and /help show help with the disclosure", async () => {
  for (const cmd of ["/start", "/help"]) {
    const { sent } = await run(cmd, {}, { chat: "private" });
    assert.equal(sent()[0].text, HELP);
    assert.ok(HELP.includes(DISCLOSURE));
  }
});

test("logs never contain message text", async (t) => {
  const logged = [];
  for (const level of ["log", "warn", "error", "info"]) t.mock.method(console, level, (...a) => logged.push(a.join(" ")));
  await run("/search סוד_פרטי_123", { result: new Error("AliExpress down") });
  await run("https://a.aliexpress.com/_x סוד_פרטי_123", { convert: async () => { throw new Error("boom"); } });
  assert.ok(logged.length > 0, "errors are logged");
  for (const line of logged) assert.doesNotMatch(line, /סוד_פרטי_123/);
});
