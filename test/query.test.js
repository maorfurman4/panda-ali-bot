import { test } from "node:test";
import assert from "node:assert/strict";
import { createUnderstander, validateIntent, statedPrice } from "../query.js";

const ENV = { OPENAI_API_KEY: "sk-test" };
const OK = { status: "ok", corrected_he: "אוזניות", keywords_en: "wireless earbuds", max_price_ils: null };
const STRICT_OK = { ...OK, clarify_question_he: null, options: null }; // strict mode: every field present, unused ones null

// Fake OpenAI Responses API: returns `intent` as the output_text part and records every request.
function openai(intent, { status = 200, responseStatus = "completed", text, part, usage = { input_tokens: 600, output_tokens: 40 } } = {}) {
  const requests = [];
  const fetch = async (url, init) => {
    requests.push({ url, init, body: JSON.parse(init.body) });
    const content = [part ?? { type: "output_text", text: text ?? JSON.stringify(intent) }];
    return {
      ok: status < 400,
      status,
      json: async () => ({ status: responseStatus, output: [{ type: "reasoning", summary: [] }, { type: "message", content }], usage }),
    };
  };
  return { fetch, requests };
}

test("sends only the query text to OpenAI Responses with a strict schema, storage off, small output", async () => {
  const api = openai(STRICT_OK);
  const result = await createUnderstander({ fetch: api.fetch, env: ENV })("אושניות");
  assert.deepEqual(result, OK);
  const [req] = api.requests;
  assert.equal(req.url, "https://api.openai.com/v1/responses");
  assert.equal(req.init.headers.authorization, "Bearer sk-test");
  assert.deepEqual(Object.keys(req.body).sort(), ["input", "instructions", "max_output_tokens", "model", "reasoning", "store", "text"]);
  assert.equal(req.body.model, "gpt-5.4-nano", "gpt-4.1-nano was deprecated by OpenAI on 2026-10-23; gpt-5.4-nano scored 16/16");
  assert.deepEqual(req.body.reasoning, { effort: "none" });
  assert.equal(req.body.store, false);
  assert.ok(req.body.max_output_tokens <= 300);
  assert.equal(req.body.text.format.type, "json_schema");
  assert.equal(req.body.text.format.strict, true);
  assert.deepEqual(req.body.input, [{ role: "user", content: "אושניות" }]);
});

test("strict schema: every property is required and objects forbid extra keys", async () => {
  const api = openai(STRICT_OK);
  await createUnderstander({ fetch: api.fetch, env: ENV })("אושניות");
  const { schema } = api.requests[0].body.text.format;
  assert.deepEqual(schema.required.sort(), Object.keys(schema.properties).sort());
  assert.equal(schema.additionalProperties, false);
  const item = schema.properties.options.items;
  assert.deepEqual(item.required.sort(), Object.keys(item.properties).sort());
  assert.equal(item.additionalProperties, false);
});

test("OPENAI_MODEL overrides the default; reasoning models get reasoning effort none", async () => {
  const api = openai(STRICT_OK);
  await createUnderstander({ fetch: api.fetch, env: { ...ENV, OPENAI_MODEL: "gpt-6-luna" } })("אושניות");
  assert.equal(api.requests[0].body.model, "gpt-6-luna");
  assert.deepEqual(api.requests[0].body.reasoning, { effort: "none" });
});

test("fail-open: returns null on missing key, HTTP error, timeout, bad JSON, schema violations, incomplete, refusal", async (t) => {
  const warnings = [];
  t.mock.method(console, "warn", (...a) => warnings.push(a.join(" ")));

  let called = false;
  assert.equal(await createUnderstander({ fetch: async () => (called = true), env: {} })("אושניות"), null);
  assert.equal(called, false, "no key -> no request");

  const cases = [
    openai(STRICT_OK, { status: 500 }).fetch,
    async () => { throw Object.assign(new Error("timed out"), { name: "TimeoutError" }); },
    openai(null, { text: "not json {" }).fetch,
    openai({ ...STRICT_OK, keywords_en: "" }).fetch,
    openai({ ...STRICT_OK, status: "clarify", keywords_en: "", clarify_question_he: "למי?", options: [{ label_he: "א", keywords_en: "a" }] }).fetch,
    openai({ ...STRICT_OK, status: "maybe" }).fetch,
    openai(STRICT_OK, { responseStatus: "incomplete" }).fetch,
    openai(null, { part: { type: "refusal", refusal: "no" } }).fetch,
  ];
  for (const fetch of cases) assert.equal(await createUnderstander({ fetch, env: ENV })("אושניות סוד_123"), null);
  assert.equal(warnings.length, cases.length, "one warning per failure");
  for (const w of warnings) assert.doesNotMatch(w, /סוד_123|אושניות|sk-test/);
});

test("plain English queries skip the AI", async () => {
  const fetch = async () => assert.fail("English needs no AI call");
  assert.deepEqual(await createUnderstander({ fetch, env: ENV })(" wireless earbuds "), {
    status: "ok",
    corrected_he: "wireless earbuds",
    keywords_en: "wireless earbuds",
    max_price_ils: null,
  });
});

test("cache: two identical (normalized) queries make one AI call; it expires after 24 h", async () => {
  let t = 0;
  const api = openai(STRICT_OK);
  const understand = createUnderstander({ fetch: api.fetch, env: ENV, now: () => t });
  await understand("אושניות");
  await understand("  אושניות ");
  assert.equal(api.requests.length, 1);
  t += 24 * 60 * 60_000 + 1;
  await understand("אושניות");
  assert.equal(api.requests.length, 2);
});

test("failures are not cached", async (t) => {
  t.mock.method(console, "warn", () => {});
  let n = 0;
  const good = openai(STRICT_OK).fetch;
  const fetch = async (...args) => (++n <= 2 ? { ok: false, status: 500, json: async () => ({}) } : good(...args)); // both tries fail
  const understand = createUnderstander({ fetch, env: ENV });
  assert.equal(await understand("אושניות"), null);
  assert.deepEqual(await understand("אושניות"), OK);
});

test("understand: one failed AI call is retried once", async (t) => {
  t.mock.method(console, "warn", () => {});
  let n = 0;
  const good = openai(STRICT_OK).fetch;
  const fetch = async (...args) => (++n === 1 ? { ok: false, status: 500, json: async () => ({}) } : good(...args));
  assert.deepEqual(await createUnderstander({ fetch, env: ENV })("אושניות"), OK);
  assert.equal(n, 2);
});

test("onUsage receives token counts for each AI call (used by the eval for cost)", async () => {
  const seen = [];
  const api = openai(STRICT_OK, { usage: { input_tokens: 612, output_tokens: 37 } });
  await createUnderstander({ fetch: api.fetch, env: ENV, onUsage: (u) => seen.push(u) })("אושניות");
  assert.deepEqual(seen, [{ input_tokens: 612, output_tokens: 37 }]);
});

test("validateIntent normalizes and checks each status (nulls from strict mode are fine)", () => {
  assert.deepEqual(validateIntent({ ...STRICT_OK, status: "OK", max_price_ils: 50 }), { ...OK, max_price_ils: 50 });
  assert.equal(validateIntent({ ...STRICT_OK, max_price_ils: -5 }), null);
  assert.deepEqual(validateIntent({ ...STRICT_OK, min_price_ils: 80, max_price_ils: 150 }), { ...OK, min_price_ils: 80, max_price_ils: 150 });
  assert.deepEqual(validateIntent({ ...STRICT_OK, min_price_ils: 200, max_price_ils: 150 }), { ...OK, max_price_ils: 150 }, "min above max is dropped");
  assert.deepEqual(validateIntent({ ...STRICT_OK, floor_price_ils: 200 }), { ...OK, floor_price_ils: 200 }, "AI price floor for big-ticket items");
  assert.deepEqual(validateIntent({ ...STRICT_OK, brand: "Xiaomi" }), { ...OK, brand: "Xiaomi" });
  assert.deepEqual(validateIntent({ ...STRICT_OK, min_price_ils: 80, floor_price_ils: 200 }), { ...OK, min_price_ils: 80 }, "the shopper's own price wins");
  assert.deepEqual(validateIntent({ ...STRICT_OK, status: "not_allowed", corrected_he: "אקדח", keywords_en: "gun" }), { status: "not_allowed", corrected_he: "אקדח", keywords_en: "", max_price_ils: null });
  assert.deepEqual(validateIntent({ ...STRICT_OK, status: "not_product", corrected_he: "תודה", keywords_en: "" }), {
    status: "not_product",
    corrected_he: "תודה",
    keywords_en: "",
    max_price_ils: null,
  });
  const clarify = validateIntent({
    status: "clarify",
    corrected_he: "מתנה לאמא",
    keywords_en: "",
    max_price_ils: null,
    clarify_question_he: "איזה סוג מתנה?",
    options: [
      { label_he: "תכשיט", keywords_en: "women necklace" },
      { label_he: "לבית", keywords_en: "home decor" },
      { label_he: "", keywords_en: "bad" },
    ],
  });
  assert.equal(clarify.options.length, 2, "invalid option dropped");
  assert.equal(validateIntent(null), null);
});

// ---- AI relevance filter (Phase 2b) ----
import { createRelevanceFilter } from "../query.js";

const items = ["כרית משענת ראש לרכב", "עוגן פחמן למושב", "מחזיק טאבלט לרכב", "כרית צוואר לרכב"].map((t, i) => ({ product_id: String(i), product_title: t }));

function openaiRelevant(exact, partial = [], opts = {}) {
  return openai({ exact, partial }, opts);
}
const ids = (r) => ({ exact: r.exact.map((p) => p.product_id), partial: r.partial.map((p) => p.product_id) });

test("relevance: titles only by default (gpt-5.4); photos only when the request names a color or pattern", async () => {
  const api = openaiRelevant([3, 0], [2]);
  const withPhoto = items.map((p, i) => (i === 0 ? { ...p, product_main_image_url: "https://ae01.alicdn.com/kf/a.jpg" } : i === 1 ? { ...p, product_main_image_url: "http://x/b.jpg" } : p));
  const out = await createRelevanceFilter({ fetch: api.fetch, env: ENV })({ he: "משענת לאוטו", en: "car headrest pillow" }, withPhoto);
  assert.deepEqual(ids(out), { exact: ["0", "3"], partial: ["2"] });
  const body = api.requests[0].body;
  assert.equal(body.model, "gpt-5.4", "mini accepted look-alikes (keychains for 'keyboard'), 2026-10-25");
  assert.deepEqual(body.reasoning, { effort: "none" });
  assert.equal(body.store, false);
  assert.equal(body.text.format.strict, true);
  assert.deepEqual(body.input, [{ role: "user", content: 'Request: "משענת לאוטו" (car headrest pillow)\n0. כרית משענת ראש לרכב\n1. עוגן פחמן למושב\n2. מחזיק טאבלט לרכב\n3. כרית צוואר לרכב' }]);

  const colored = openaiRelevant([0]);
  await createRelevanceFilter({ fetch: colored.fetch, env: ENV })({ he: "שטיח לסלון אפור", en: "gray rug" }, withPhoto);
  const text = (t) => ({ type: "input_text", text: t });
  assert.deepEqual(colored.requests[0].body.input[0].content, [
    text('Request: "שטיח לסלון אפור" (gray rug)'),
    text("0. כרית משענת ראש לרכב"),
    { type: "input_image", image_url: "https://ae01.alicdn.com/kf/a.jpg_220x220.jpg", detail: "low" },
    text("1. עוגן פחמן למושב"), // not https: no photo
    text("2. מחזיק טאבלט לרכב"),
    text("3. כרית צוואר לרכב"),
  ]);
});

test("relevance: a failed photo call retries once with titles only", async () => {
  const good = openaiRelevant([1]);
  const requests = [];
  const fetch = async (url, init) => (requests.push(JSON.parse(init.body)), requests.length === 1 ? { ok: false, status: 400 } : good.fetch(url, init));
  const out = await createRelevanceFilter({ fetch, env: ENV })({ he: "x", en: "y" }, items);
  assert.deepEqual(ids(out), { exact: ["1"], partial: [] });
  assert.equal(requests[1].input[0].content, 'Request: "x" (y)\n0. כרית משענת ראש לרכב\n1. עוגן פחמן למושב\n2. מחזיק טאבלט לרכב\n3. כרית צוואר לרכב');
});

test("relevance: nothing matched -> empty; out-of-range numbers ignored; a product in both lists counts as exact", async () => {
  assert.deepEqual(ids(await createRelevanceFilter({ fetch: openaiRelevant([]).fetch, env: ENV })({ he: "x", en: "x" }, items)), { exact: [], partial: [] });
  const out = await createRelevanceFilter({ fetch: openaiRelevant([1, 99, -1], [1, 2]).fetch, env: ENV })({ he: "x", en: "x" }, items);
  assert.deepEqual(ids(out), { exact: ["1"], partial: ["2"] });
});

test("relevance failure: nothing is called exact; products come back as close matches (the card says so); no key = dev mode", async (t) => {
  t.mock.method(console, "warn", () => {});
  assert.equal((await createRelevanceFilter({ fetch: async () => assert.fail("no key, no call"), env: {} })({ he: "x", en: "x" }, items)).exact.length, 4);
  for (const fetch of [
    openaiRelevant([0], [], { status: 500 }).fetch,
    async () => { throw Object.assign(new Error("t"), { name: "TimeoutError" }); },
    openai(null, { text: "nope" }).fetch,
    openai({ exact: "0,1", partial: [] }).fetch,
  ]) {
    const out = await createRelevanceFilter({ fetch, env: ENV })({ he: "x", en: "x" }, items);
    assert.deepEqual([out.exact.length, out.partial.length], [0, 4]);
  }
});

test("relevance: no products -> no AI call", async () => {
  assert.deepEqual(ids(await createRelevanceFilter({ fetch: async () => assert.fail("no call"), env: ENV })({ he: "x", en: "x" }, [])), { exact: [], partial: [] });
});

// ---- shopping advisor (multi-step questions) + "why it fits" ----
import { createAdvisor, createExplainer } from "../query.js";

const ASK = {
  status: "ask",
  question_he: "מה התקציב?",
  options: [
    { label_he: "עד 50 ₪", keywords_en: "women necklace", max_price_ils: 50 },
    { label_he: "עד 150 ₪", keywords_en: "women necklace", max_price_ils: 150 },
  ],
  keywords_en: null,
  max_price_ils: null,
};

test("advisor: sends only the request and the answers so far; returns the next question", async () => {
  const api = openai(ASK);
  const next = await createAdvisor({ fetch: api.fetch, env: ENV })({ request: "מתנה לאמא", history: [{ q: "איזה סוג?", a: "תכשיט" }] });
  assert.equal(next.status, "ask");
  assert.equal(next.options.length, 2);
  assert.equal(next.options[0].max_price_ils, 50);
  const body = api.requests[0].body;
  assert.equal(body.store, false);
  assert.equal(body.text.format.strict, true);
  assert.deepEqual(body.input, [{ role: "user", content: 'Request: "מתנה לאמא"\nAnswers so far:\n1. איזה סוג? → תכשיט' }]);
});

test("advisor: 'done' carries the final keywords; bad output and failures return null", async (t) => {
  t.mock.method(console, "warn", () => {});
  const done = await createAdvisor({ fetch: openai({ status: "done", question_he: null, options: null, keywords_en: "silver necklace for women", min_price_ils: 80, max_price_ils: 150 }).fetch, env: ENV })({ request: "x", history: [] });
  assert.deepEqual(done, { status: "done", keywords_en: "silver necklace for women", min_price_ils: 80, max_price_ils: 150 });
  for (const fetch of [
    openai({ ...ASK, options: [ASK.options[0]] }).fetch, // one option is not a question
    openai({ status: "done", question_he: null, options: null, keywords_en: "", max_price_ils: null }).fetch,
    openai(ASK, { status: 500 }).fetch,
  ]) {
    assert.equal(await createAdvisor({ fetch, env: ENV })({ request: "x", history: [] }), null);
  }
  assert.equal(await createAdvisor({ fetch: async () => assert.fail("no key"), env: {} })({ request: "x", history: [] }), null);
});

test("explainer: one short reason per product, same order; anything else is null", async (t) => {
  t.mock.method(console, "warn", () => {});
  const products = [{ product_title: "שרשרת כסף" }, { product_title: "צמיד זהב" }];
  const api = openai({ reasons: ["כסף עדין, מתאים לתקציב", "צמיד אלגנטי ליום יום"] });
  assert.deepEqual(await createExplainer({ fetch: api.fetch, env: ENV })({ request: "מתנה לאמא", history: [{ q: "סוג?", a: "תכשיט" }] }, products), ["כסף עדין, מתאים לתקציב", "צמיד אלגנטי ליום יום"]);
  assert.match(api.requests[0].body.input[0].content, /0\. שרשרת כסף\n1\. צמיד זהב/);
  assert.equal(await createExplainer({ fetch: openai({ reasons: ["רק אחד"] }).fetch, env: ENV })({ request: "x", history: [] }, products), null);
  assert.equal(await createExplainer({ fetch: openai({}, { status: 500 }).fetch, env: ENV })({ request: "x", history: [] }, products), null);
});


test("validateIntent keeps an optional broader fallback search", () => {
  assert.equal(validateIntent({ ...STRICT_OK, fallback_en: "ipad case" }).fallback_en, "ipad case");
  assert.equal(validateIntent({ ...STRICT_OK, fallback_en: null }).fallback_en, undefined);
});

test("statedPrice: prices written in the request are read by code (shekels, dollars, ranges); units like kg or meters are not prices", () => {
  assert.deepEqual(statedPrice("מקלדת עד 20 דולר"), { max: 74 });
  assert.deepEqual(statedPrice("אוזניות עד $25"), { max: 93 });
  assert.deepEqual(statedPrice('אוזניות עד 30 ש"ח'), { max: 30 });
  assert.deepEqual(statedPrice("שעון חכם בין 80 ל-150"), { min: 80, max: 150 });
  assert.deepEqual(statedPrice("מטען מתחת ל-50"), { max: 50 });
  assert.deepEqual(statedPrice("בושם מעל 100 שקל"), { min: 100 });
  for (const t of ["משקולות יד עד 5 קילו", "כבל באורך עד 2 מטר", "כוס תרמית 500 מל", "מטען 65W"]) assert.deepEqual(statedPrice(t), {}, t);
});

test("understand: a price the AI missed is filled in from the text, and price words leave the search words", async () => {
  const api = openai({ ...STRICT_OK, keywords_en: "keyboard 20dollar", max_price_ils: null });
  const out = await createUnderstander({ fetch: api.fetch, env: ENV })("מקלדת עד 20 דולר");
  assert.equal(out.max_price_ils, 74);
  assert.equal(out.keywords_en, "keyboard");
});

test("validateIntent: a named product the model still asks about is searched directly; vague requests keep their question", () => {
  const ask = { ...STRICT_OK, status: "clarify", clarify_question_he: "איזה כבל?", options: [{ label_he: "USB", keywords_en: "usb cable" }, { label_he: "HDMI", keywords_en: "hdmi cable" }] };
  assert.equal(validateIntent({ ...ask, corrected_he: "כבל", keywords_en: "cable" }).status, "ok");
  assert.equal(validateIntent({ ...ask, corrected_he: "מתנה לאמא", keywords_en: "gift for mom" }).status, "clarify", "gifts keep the advisor");
  assert.equal(validateIntent({ ...ask, corrected_he: "כבל", keywords_en: "" }).status, "clarify", "no keywords: ask");
});
