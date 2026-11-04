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
  assert.deepEqual(Object.keys(req.body).sort(), ["input", "instructions", "max_output_tokens", "model", "reasoning", "store", "temperature", "text"]); // the first reading is steady
  assert.equal(req.body.model, "gpt-5.4-mini", "nano wrote weak search words on real requests (2026-10-29)");
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

test("plain English queries go through the AI too (look description, other wording, Hebrew header)", async () => {
  const api = openai({ ...STRICT_OK, corrected_he: "לוח אדוונט", keywords_en: "christmas advent calendar box", looks_like: "a box with 24 numbered doors" });
  const r = await createUnderstander({ fetch: api.fetch, env: ENV })(" advent calendar gift box ");
  assert.equal(api.requests.length, 3, "three readings at once");
  assert.equal(api.requests[0].body.input[0].content, "advent calendar gift box");
  assert.equal(r.looks_like, "a box with 24 numbered doors");
});

test("relevance: the other wordings reach the check as 'Also searched as'", async () => {
  const api = openai({ exact: [0], partial: [] });
  await createRelevanceFilter({ fetch: api.fetch, env: ENV })({ he: "מטהר אוויר לרכב", en: "car air purifier", terms: ["car air freshener", "car aromatherapy diffuser"] }, [{ product_title: "Car air freshener jar" }]);
  assert.match(api.requests[0].body.input[0].content, /^Request: "מטהר אוויר לרכב" \(car air purifier\)\nAlso searched as: car air freshener; car aromatherapy diffuser\n0\. /);
});

test("relevance: temperature 0 only for a steady (non-style) request", async () => {
  const api = openai({ exact: [0], partial: [] });
  const check = createRelevanceFilter({ fetch: api.fetch, env: ENV });
  await check({ he: "מטען לרכב", en: "car charger", steady: true }, [{ product_title: "Car charger" }]);
  await check({ he: "שמלה", en: "dress" }, [{ product_title: "Dress" }]);
  assert.deepEqual(api.requests.map((r) => r.body.temperature), [0, undefined]);
});

test("relevance with photos: one photo per product goes along, even without a color in the request", async () => {
  const api = openai({ exact: [0], partial: [] });
  await createRelevanceFilter({ fetch: api.fetch, env: ENV })({ he: "ברז למטבח", en: "kitchen faucet" }, [{ product_title: "Kitchen faucet", product_main_image_url: "https://ae01.alicdn.com/x.jpg" }], { photos: true });
  const content = api.requests[0].body.input[0].content;
  assert.ok(Array.isArray(content) && content.some((c) => c.type === "input_image" && c.image_url.endsWith("x.jpg_350x350.jpg")));
});

test("validateIntent keeps up to 3 more seller wordings, without repeats of the main or other wording", () => {
  const r = validateIntent({ ...STRICT_OK, keywords_en: "car air purifier", alt_en: "car air cleaner", terms_en: ["car air freshener", "Car Air Purifier", "car aromatherapy diffuser", "car air freshener", "car negative ion purifier", "x5"] });
  assert.deepEqual(r.terms_en, ["car air freshener", "car aromatherapy diffuser", "car negative ion purifier"]);
  assert.equal(validateIntent({ ...STRICT_OK, terms_en: [] }).terms_en, undefined);
});

test("cache: two identical (normalized) queries make one AI call; it expires after 24 h", async () => {
  let t = 0;
  const api = openai(STRICT_OK);
  const understand = createUnderstander({ fetch: api.fetch, env: ENV, now: () => t });
  await understand("אושניות");
  await understand("  אושניות ");
  assert.equal(api.requests.length, 3);
  t += 24 * 60 * 60_000 + 1;
  await understand("אושניות");
  assert.equal(api.requests.length, 6);
});

test("failures are not cached", async (t) => {
  t.mock.method(console, "warn", () => {});
  let n = 0;
  const good = openai(STRICT_OK).fetch;
  const fetch = async (...args) => (++n <= 4 ? { ok: false, status: 500, json: async () => ({}) } : good(...args)); // 3 readings + the retry fail
  const understand = createUnderstander({ fetch, env: ENV });
  assert.equal(await understand("אושניות"), null);
  assert.deepEqual(await understand("אושניות"), OK);
});

test("understand: a failed reading leaves the other two; all three failing get one more try", async (t) => {
  t.mock.method(console, "warn", () => {});
  const good = openai(STRICT_OK).fetch;
  const failing = (k) => { let n = 0; const fetch = async (...args) => (++n <= k ? { ok: false, status: 500, json: async () => ({}) } : good(...args)); return { fetch, calls: () => n }; };
  const one = failing(1);
  assert.deepEqual(await createUnderstander({ fetch: one.fetch, env: ENV })("אושניות"), OK);
  assert.equal(one.calls(), 3);
  const all = failing(3);
  assert.deepEqual(await createUnderstander({ fetch: all.fetch, env: ENV })("אושניות"), OK);
  assert.equal(all.calls(), 4);
});

test("understand: the three readings' words are combined on non-style searches; a style search keeps the first reading's", async () => {
  const answers = [
    { ...STRICT_OK, keywords_en: "men grooming kit", alt_en: "male grooming set", terms_en: ["beard care kit"] },
    { ...STRICT_OK, keywords_en: "men grooming kit", alt_en: "men grooming set", terms_en: ["beard care kit", "multi grooming kit 5 in 1"] },
    { ...STRICT_OK, keywords_en: "Men Grooming Set", alt_en: null, terms_en: ["male grooming set"] },
  ];
  const by = (list) => { let i = 0; return async () => ({ ok: true, status: 200, json: async () => ({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(list[i++ % 3]) }] }] }) }); };
  const r = await createUnderstander({ fetch: by(answers), env: ENV })("ערכת טיפוח לגבר");
  assert.equal(r.keywords_en, "men grooming kit");
  assert.equal(r.alt_en, "male grooming set");
  assert.deepEqual(r.terms_en, ["beard care kit", "men grooming set", "multi grooming kit 5 in 1"]);
  const styled = answers.map((a) => ({ ...a, style: true }));
  assert.deepEqual((await createUnderstander({ fetch: by(styled), env: ENV })("שמלה")).terms_en, ["beard care kit"]);
});

test("understand: the first reading (the main words) runs at temperature 0, the other two vary", async () => {
  const temps = [];
  const fetch = async (_url, init) => (temps.push(JSON.parse(init.body).temperature), { ok: true, status: 200, json: async () => ({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(STRICT_OK) }] }] }) });
  await createUnderstander({ fetch, env: ENV })("אושניות");
  assert.deepEqual(temps, [0, undefined, undefined]);
});

test("understand: the fashion (style) mode is the majority of the three readings, not the first one", async () => {
  const by = (styles) => { let i = 0; return async () => ({ ok: true, status: 200, json: async () => ({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ ...STRICT_OK, style: styles[i++ % 3] }) }] }] }) }); };
  assert.equal((await createUnderstander({ fetch: by([true, false, false]), env: ENV })("סרטי קישוט")).style, undefined, "one of three");
  assert.equal((await createUnderstander({ fetch: by([false, true, true]), env: ENV })("חזייה")).style, true, "two of three");
});

test("onUsage receives token counts for each AI call (used by the eval for cost)", async () => {
  const seen = [];
  const api = openai(STRICT_OK, { usage: { input_tokens: 612, output_tokens: 37 } });
  await createUnderstander({ fetch: api.fetch, env: ENV, onUsage: (u) => seen.push(u) })("אושניות");
  assert.deepEqual(seen, Array(3).fill({ input_tokens: 612, output_tokens: 37 }));
});

test("validateIntent normalizes and checks each status (nulls from strict mode are fine)", () => {
  assert.deepEqual(validateIntent({ ...STRICT_OK, status: "OK", max_price_ils: 50 }), { ...OK, max_price_ils: 50 });
  assert.equal(validateIntent({ ...STRICT_OK, max_price_ils: -5 }), null);
  assert.deepEqual(validateIntent({ ...STRICT_OK, min_price_ils: 80, max_price_ils: 150 }), { ...OK, min_price_ils: 80, max_price_ils: 150 });
  assert.deepEqual(validateIntent({ ...STRICT_OK, min_price_ils: 200, max_price_ils: 150 }), { ...OK, max_price_ils: 150 }, "min above max is dropped");
  assert.deepEqual(validateIntent({ ...STRICT_OK, floor_price_ils: 200 }), { ...OK, floor_price_ils: 200 }, "AI price floor for big-ticket items");
  assert.deepEqual(validateIntent({ ...STRICT_OK, brand: "Xiaomi" }), { ...OK, brand: "Xiaomi" });
  assert.deepEqual(validateIntent({ ...STRICT_OK, alt_en: "bluetooth earphones" }), { ...OK, alt_en: "bluetooth earphones" });
  assert.equal(validateIntent({ ...STRICT_OK, corrected_he: "ש充ן אייפון" }).corrected_he, "", "a broken header is dropped");
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
import { createAdvisor, createExplainer, createTitler, createDealPicker } from "../query.js";

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

test("titler: names matched by product number; numbering and task talk dropped per product; a mostly failed answer is retried", async (t) => {
  t.mock.method(console, "warn", () => {});
  const products = [{ product_title: "Water Filter for Krups Melitta" }, { product_title: "Microwave" }, { product_title: "Cable" }];
  const api = openai({ names: [{ i: 2, name: "כבל USB ל-Type C" }, { i: 0, name: "מסנן מים - מתאים למליטה" }, { i: 1, name: "מיקרוגל; השם צריך לשמור את הנפח" }] });
  assert.deepEqual(await createTitler({ fetch: api.fetch, env: ENV })("פילטר למליטה", products), ["מסנן מים - מתאים למליטה", null, "כבל USB ל-Type C"]);
  assert.equal(api.requests.length, 1, "2 of 3 names is enough");
  const thin = openai({ names: [{ i: 0, name: "מסנן" }] });
  assert.deepEqual(await createTitler({ fetch: thin.fetch, env: ENV })("x", products), ["מסנן", null, null]);
  assert.equal(thin.requests.length, 2, "1 of 3 names -> asked once more");
  assert.equal(await createTitler({ fetch: openai({}, { status: 500 }).fetch, env: ENV })("x", products), null);
  assert.equal(await createTitler({ fetch: async () => assert.fail("no key"), env: {} })("x", products), null);
});

test("validateIntent keeps the look description for the product check", () => {
  assert.equal(validateIntent({ ...STRICT_OK, looks_like: "a rigid C-shaped hoop worn over the head; not an elastic hair tie" }).looks_like, "a rigid C-shaped hoop worn over the head; not an elastic hair tie");
  assert.equal(validateIntent({ ...STRICT_OK, looks_like: null }).looks_like, undefined);
});

test("validateIntent keeps a known AliExpress main category and drops an unknown number", () => {
  assert.equal(validateIntent({ ...STRICT_OK, category_id: 6 }).category_id, 6);
  assert.equal(validateIntent({ ...STRICT_OK, category_id: 999 }).category_id, undefined);
  assert.equal(validateIntent({ ...STRICT_OK, category_id: null }).category_id, undefined);
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
  assert.equal(validateIntent({ ...ask, corrected_he: "מוצר למטבח", keywords_en: "kitchen gadgets" }).status, "clarify", "'a product for the kitchen' is vague");
});

test("deal picker: the most sold product the AI says is the topic's item, written from its own title only", async () => {
  const products = [{ product_title: "Cable organizer winder" }, { product_title: "SoundPEATS wireless earbuds" }, { product_title: "Lenovo LP40 earbuds" }];
  // The fake answers every call with the same object: step 1 reads `fits`, step 2 the post fields.
  const answer = { fits: [false, true, true], emoji: "🎧", headline: "סוף לכבלים מסתבכים", name: "SoundPEATS אוזניות אלחוטיות", benefits: ["חיבור Bluetooth יציב", "קלות ונוחות", "השם צריך להיות קצר"], warning: null };
  const api = openai(answer);
  assert.deepEqual(await createDealPicker({ fetch: api.fetch, env: ENV })(products, "wireless earbuds"), {
    i: 1, name: "SoundPEATS אוזניות אלחוטיות", emoji: "🎧", headline: "סוף לכבלים מסתבכים", benefits: ["חיבור Bluetooth יציב", "קלות ונוחות"], warning: null,
  });
  assert.equal(api.requests.length, 2);
  assert.equal(api.requests[0].body.input[0].content, "Topic: wireless earbuds\n3 products:\n0. Cable organizer winder\n1. SoundPEATS wireless earbuds\n2. Lenovo LP40 earbuds");
  assert.equal(api.requests[1].body.input[0].content, "SoundPEATS wireless earbuds", "the post is written from the chosen title alone");
  assert.equal(api.requests[0].body.max_output_tokens, 800, "a whole post needs more room than a search answer");
  assert.deepEqual(await createDealPicker({ fetch: openai({ ...answer, fits: [false, false, false] }).fetch, env: ENV })(products, "x"), { none: true });
  assert.equal((await createDealPicker({ fetch: openai({ ...answer, fits: [false, true] }).fetch, env: ENV })(products)).i, 1, "a short answer still picks");
  assert.deepEqual(await createDealPicker({ fetch: openai({ ...answer, fits: [false] }).fetch, env: ENV })(products), { none: true }, "missing answers count as no");
  assert.equal((await createDealPicker({ fetch: openai({ ...answer, emoji: "x" }).fetch, env: ENV })(products)).emoji, null, "not an emoji");
  assert.deepEqual(await createDealPicker({ fetch: openai({ ...answer, name: "השם צריך להיות קצר" }).fetch, env: ENV })(products), { i: 1 }, "a bad name keeps the pick, drops the text");
  const gun = await createDealPicker({ fetch: openai({ ...answer, fits: [true], benefits: ["4 ראשים מתחלפים", "סוללה ל-60 שעות", "קלות"] }).fetch, env: ENV })([{ product_title: "Massage gun 8 heads, 60 hours battery" }]);
  assert.deepEqual(gun.benefits, ["סוללה ל-60 שעות", "קלות"], "a number the title doesn't have is dropped");
  const cable = await createDealPicker({ fetch: openai({ ...answer, fits: [true], benefits: ["לסמסונג, אייפון ומקבוק", "מתאים לגלקסי", "טעינה מהירה"] }).fetch, env: ENV })([{ product_title: "כבל USB-C עבור סמסונג גלקסי S24" }]);
  assert.deepEqual(cable.benefits, ["מתאים לגלקסי", "טעינה מהירה"], "a device the title doesn't name is dropped");
  assert.equal((await createDealPicker({ fetch: openai({ ...answer, headline: "הגאדג'ט שכל מטבח צריך" }).fetch, env: ENV })(products)).headline, "הגאדג'ט שכל מטבח צריך", "ad Hebrew kept");
  assert.equal(await createDealPicker({ fetch: openai({}, { status: 500 }).fetch, env: ENV })(products), null);
  assert.equal(await createDealPicker({ fetch: async () => assert.fail("no key"), env: {} })(products), null);
});

test("style: validateIntent keeps style only when true; the pick asks for pretty and plain, kept items only", async () => {
  assert.equal(validateIntent({ ...STRICT_OK, style: true }).style, true);
  assert.equal(validateIntent({ ...STRICT_OK, style: false }).style, undefined);
  const api = openai({ exact: [0, 1], partial: [2], pretty: [1, 3, 1, 0], plain: [2], same: [0, 2] });
  const out = await createRelevanceFilter({ fetch: api.fetch, env: ENV })({ he: "תיק קש", en: "straw bag" }, items, { photos: true, pick: 2 });
  assert.deepEqual(out.pretty.map((p) => p.product_id), ["1", "0"], "unknown (3) dropped, repeats once, at most 2");
  assert.deepEqual(out.plain.map((p) => p.product_id), ["2"]);
  assert.deepEqual(out.same.map((p) => p.product_id), ["2"], "the first product is never a repeat");
  const body = api.requests[0].body;
  assert.deepEqual(body.text.format.schema.required, ["exact", "partial", "brand", "banner", "pretty", "plain", "same"]);
  assert.match(body.instructions, /pretty = up to 2 products/);
  const plainApi = openai({ exact: [0], partial: [] });
  const plainOut = await createRelevanceFilter({ fetch: plainApi.fetch, env: ENV })({ he: "מטען", en: "charger" }, items);
  assert.equal(plainOut.pretty, undefined);
  assert.doesNotMatch(plainApi.requests[0].body.instructions, /pretty =/);
});

test("honestName: gold under ₪300 is plated, impossible charger watts go; real claims stay", async () => {
  const { honestName } = await import("../query.js");
  const at = (price) => ({ target_sale_price: String(price) });
  assert.equal(honestName("שרשרת זהב 18 קראט", at(5.39)), "שרשרת מצופה זהב");
  assert.equal(honestName("שרשרת מצופה זהב 18K", at(7)), "שרשרת מצופה זהב");
  assert.equal(honestName("טבעת זהב 14 קראט", at(900)), "טבעת זהב 14 קראט");
  assert.equal(honestName("מטען רכב 350W USB C", at(5.96)), "מטען רכב USB C");
  assert.equal(honestName("מטען רכב 100W QC3.0 PD", at(4.93)), "מטען רכב QC3.0 PD");
  assert.equal(honestName("מטען רכב Baseus 100W", at(65)), "מטען רכב Baseus 100W");
  assert.equal(honestName("כבל USB ל-Type C ‏100W", at(9)), "כבל USB ל-Type C ‏100W", "a cable's rating is not a charger's output");
});

test("seasonNote: the understanding is told the season in Israel", async () => {
  const { seasonNote } = await import("../query.js");
  assert.match(seasonNote(Date.parse("2026-11-01T10:00:00Z")), /winter/);
  assert.match(seasonNote(Date.parse("2026-07-15T10:00:00Z")), /summer/);
});

test("a slow AI call is sent once more after 4 s and the first answer wins; a fast failure isn't duplicated", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let calls = 0;
  const ok = { status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ exact: [0], partial: [] }) }] }] };
  const fetch = (_u, init) => new Promise((resolve, reject) => {
    const n = ++calls;
    if (n === 1) init.signal.addEventListener("abort", () => reject(Object.assign(new Error("t"), { name: "TimeoutError" })));
    else resolve({ ok: true, json: async () => ok });
  });
  const pending = createRelevanceFilter({ fetch, env: ENV })({ he: "מגבת", en: "towel" }, [{ product_title: "Towel" }]);
  t.mock.timers.tick(4000);
  const out = await pending;
  assert.equal(calls, 2);
  assert.equal(out.exact.length, 1);
});

const claudeAnswer = (obj) => ({ ok: true, json: async () => ({ content: [{ type: "text", text: JSON.stringify(obj) }], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 5 } }) });
const openaiAnswer = (obj) => ({ ok: true, json: async () => ({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(obj) }] }] }) });
const CLAUDE_ENV = { ...ENV, ANTHROPIC_API_KEY: "test-anthropic" };

test("two judges: exact needs both; what only one calls exact is close; Claude gets Sonnet, JSON output and thinking off", async () => {
  const sent = [];
  const fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    sent.push({ url, body });
    return url.includes("anthropic") ? claudeAnswer({ exact: [0], partial: [1], brand: [], banner: [] }) : openaiAnswer({ exact: [0, 2], partial: [], brand: [], banner: [] });
  };
  const items = [{ product_title: "Drinking glass" }, { product_title: "Coffee mug" }, { product_title: "Whiskey glass" }];
  const out = await createRelevanceFilter({ fetch, env: CLAUDE_ENV })({ he: "כוס", en: "drinking glass" }, items);
  assert.deepEqual(out.exact.map((p) => p.product_title), ["Drinking glass"]);
  assert.deepEqual(out.partial.map((p) => p.product_title), ["Coffee mug", "Whiskey glass"]);
  const claude = sent.find((s) => s.url.includes("anthropic")).body;
  assert.equal(claude.model, "claude-sonnet-5-5");
  assert.deepEqual(claude.thinking, { type: "between_tools" });
  assert.equal(claude.output_config.format.type, "json_schema");
});

test("two judges: a failed second judge leaves the first one's answer; without the Claude key there is one judge", async () => {
  const fetch = async (url) => (url.includes("anthropic") ? { ok: false, status: 529, json: async () => ({}) } : openaiAnswer({ exact: [0, 2], partial: [], brand: [], banner: [] }));
  const items = [{ product_title: "a" }, { product_title: "b" }, { product_title: "c" }];
  const out = await createRelevanceFilter({ fetch, env: CLAUDE_ENV })({ he: "כוס", en: "glass" }, items);
  assert.equal(out.exact.length, 2);
  let calls = 0;
  await createRelevanceFilter({ fetch: async () => (calls++, openaiAnswer({ exact: [0], partial: [], brand: [], banner: [] })), env: ENV })({ he: "כוס", en: "glass" }, items);
  assert.equal(calls, 1);
});

test("backup: when OpenAI fails at once and the Claude key is set, the same request goes to Claude (Haiku for mini)", async () => {
  const urls = [];
  const fetch = async (url) => (urls.push(url), url.includes("anthropic") ? claudeAnswer({ ...STRICT_OK, keywords_en: "car charger" }) : { ok: false, status: 503, json: async () => ({}) });
  const r = await createUnderstander({ fetch, env: CLAUDE_ENV })("מטען לרכב");
  assert.equal(r.keywords_en, "car charger");
  assert.equal(urls.length, 6, "each of the three readings: OpenAI, then Claude");
  assert.equal(urls.filter((u) => /anthropic/.test(u)).length, 3);
});

test("two judges: one exact + one close is 'near'", async () => {
  const fetch = async (url) => (url.includes("anthropic") ? claudeAnswer({ exact: [0], partial: [1], brand: [], banner: [] }) : openaiAnswer({ exact: [0, 1], partial: [], brand: [], banner: [] }));
  const out = await createRelevanceFilter({ fetch, env: CLAUDE_ENV })({ he: "מוצץ", en: "pacifier" }, [{ product_title: "a" }, { product_title: "b" }]);
  assert.deepEqual(out.exact.map((p) => p.product_title), ["a"]);
  assert.deepEqual(out.near.map((p) => p.product_title), ["b"]);
  assert.equal(out.partial.length, 0);
});

test("the final photo look: two judges for a named color (350 px photos), one judge otherwise; the color title check stays one judge", async () => {
  const run = async (he, opts) => {
    const urls = [];
    const fetch = async (url) => (urls.push(url), url.includes("anthropic") ? claudeAnswer({ exact: [0], partial: [1], brand: [], banner: [] }) : openaiAnswer({ exact: [0, 1], partial: [], brand: [], banner: [] }));
    const items = [{ product_title: "a", product_main_image_url: "https://x/a.jpg" }, { product_title: "b", product_main_image_url: "https://x/b.jpg" }];
    const out = await createRelevanceFilter({ fetch, env: CLAUDE_ENV })({ he, en: "dress" }, items, opts);
    return { claude: urls.some((u) => u.includes("anthropic")), out };
  };
  const color = await run("שמלת ערב שחורה", { photos: true });
  assert.equal(color.claude, true);
  assert.deepEqual(color.out.near.map((p) => p.product_title), ["b"], "one judge saw another shade: near, shown as close");
  assert.equal((await run("שמלת ערב", { photos: true })).claude, false);
  assert.equal((await run("שמלת ערב שחורה", {})).claude, false, "the 48-product color title check: gpt alone");
});

test("namesLook: 'לבנות'/'לבנים' alone isn't a color (can mean for girls/boys); 'לבן', 'לבנה', 'בצבע לבן' are", async () => {
  const { namesLook } = await import("../query.js");
  for (const t of ["נעלי ספורט לבנות", "חולצות לבנים"]) assert.equal(namesLook(t), false, t);
  for (const t of ["חולצה לבנה", "תיק לבן", "נעלי ספורט לבנות · בצבע לבן"]) assert.equal(namesLook(t), true, t);
});

test("explainer: a reason that argues against the product is dropped (no 💡 for it), the others stay", async () => {
  const products = [{ product_title: "מחזיק מפתחות" }, { product_title: "טבעת פותחן בקבוקים" }];
  const api = openai({ reasons: ["גאדג'ט קטן ושימושי", "פתיחת בקבוקים, פחות מתאים לאווירה"] });
  assert.deepEqual(await createExplainer({ fetch: api.fetch, env: ENV })({ request: "מתנה לגבר", history: [] }, products), ["גאדג'ט קטן ושימושי", null]);
});

test("validateIntent: 'נעלי ספורט לבנות' asks white or for girls (two buttons); clear cases are searched", async () => {
  const { whiteOrKids } = await import("../query.js");
  const out = validateIntent({ status: "ok", corrected_he: "נעלי ספורט לבנות", keywords_en: "white sneakers women" });
  assert.equal(out.status, "clarify");
  assert.deepEqual(out.options.map((o) => o.label_he), ["בצבע לבן", "לילדות"]);
  assert.match(out.options[0].keywords_en, /white sneakers/);
  assert.match(out.options[1].keywords_en, /girls sneakers/);
  assert.equal(whiteOrKids("מגפיים לבנים"), "לבנים");
  assert.equal(whiteOrKids("חולצות לבנים"), null, "shirts can't be 'לבנים' white: for boys, no question (2026-11-04)");
  assert.equal(whiteOrKids("תיק לעבודה לבנות"), null, "a bag can't be 'לבנות' white: a women's bag");
  for (const t of ["נעלי ספורט בצבע לבן", "שמלה לבנה", "נעליים לבנות בנות 8", "מתנה לבנות", "בלונים לבנים", "נעלי ספורט לבנות קטנות"]) assert.equal(whiteOrKids(t), null, t);
});

test("pickColorPhotos: the photo number per listing becomes its URL; bad numbers and failures give null", async () => {
  const { createPhotoPicker } = await import("../query.js");
  const listing = (n) => ({ product_title: `dress ${n}`, product_small_image_urls: { string: [`https://a/${n}-0.jpg`, `https://a/${n}-1.jpg`, `https://a/${n}-2.jpg`] } });
  const api = openai({ picks: [{ listing: 0, photo: 2 }, { listing: 1, photo: 9 }] });
  const out = await createPhotoPicker({ fetch: api.fetch, env: ENV })({ he: "שמלה שחורה", en: "black dress" }, [listing(0), listing(1)]);
  assert.deepEqual(out, ["https://a/0-2.jpg", null]);
  const sent = api.requests[0].body;
  assert.equal(sent.temperature, 0);
  assert.ok(sent.input[0].content.some((c) => c.type === "input_image" && c.image_url === "https://a/0-1.jpg_350x350.jpg"), "photos after the first");
  assert.ok(!sent.input[0].content.some((c) => c.image_url === "https://a/0-0.jpg_350x350.jpg"), "never the first, already seen");
  assert.deepEqual(await createPhotoPicker({ fetch: api.fetch, env: {} })({ he: "x", en: "x" }, [listing(0)]), [null], "no key: nothing");
});

test("slang: a known Israeli word adds its meaning to the request; whole words only", async () => {
  const { slangHints } = await import("../query.js");
  assert.match(slangHints("חפש לי מוט פינוק לאינטרפוץ 4 דרך").join(" "), /rain shower system.*concealed shower mixer/);
  assert.deepEqual(slangHints("מגבת לים"), [], "מגב is not מגבת");
  assert.match(slangHints("סקוטש לבגדים").join(" "), /velcro/);
  const bodies = [];
  const fetch = async (_u, init) => (bodies.push(JSON.parse(init.body)), { ok: true, status: 200, json: async () => ({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(STRICT_OK) }] }] }) });
  await createUnderstander({ fetch, env: ENV })("מגב לרצפה");
  assert.match(bodies[0].input[0].content, /^מגב לרצפה\n\nNote: "מגב" \(Israeli usage\) = floor squeegee/);
});

test("forWhom: 'לבנות'/'לבנים' is the color only after a matching plural item; otherwise who it is for", async () => {
  const { forWhom } = await import("../format.js");
  assert.equal(forWhom("תיק לעבודה לבנות"), "women");
  assert.equal(forWhom("מתנה לבנות"), "girls");
  assert.equal(forWhom("חולצות לבנים"), "boys");
  for (const t of ["נעלי ספורט לבנות", "נעליים לבנות", "בלונים לבנים", "מגפיים לבנים", "שמלה לבנה"]) assert.equal(forWhom(t), null, t);
  const bodies = [];
  const fetch = async (_u, init) => (bodies.push(JSON.parse(init.body)), { ok: true, status: 200, json: async () => ({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(STRICT_OK) }] }] }) });
  await createUnderstander({ fetch, env: ENV })("תיק לעבודה לבנות");
  assert.match(bodies[0].input[0].content, /means for women, not the color white/);
});

test("slang: 'לדים' is LED strip lights", async () => {
  const { slangHints } = await import("../query.js");
  assert.match(slangHints("לדים לחדר").join(" "), /LED strip lights/);
});

test("family 3: the judges see up to 250 characters of the title on a device search, 120 otherwise", async () => {
  const bodies = [];
  const fetch = async (_u, init) => (bodies.push(JSON.parse(init.body)), { ok: true, status: 200, json: async () => ({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ exact: [0], partial: [], brand: [], banner: [] }) }] }] }) });
  const long = `Case for iPhone 11 12 13 14 15 16 Pro Max Plus Mini magnetic silicone shockproof cover with camera protection ring and stand 17`;
  const judge = createRelevanceFilter({ fetch, env: ENV });
  await judge({ he: "כיסוי לאייפון 17", en: "iphone 17 case" }, [{ product_title: long }]);
  assert.match(JSON.stringify(bodies.at(-1)), /stand 17/);
  await judge({ he: "כיסוי סיליקון", en: "silicone case" }, [{ product_title: long }]);
  assert.doesNotMatch(JSON.stringify(bodies.at(-1)), /stand 17/);
});
