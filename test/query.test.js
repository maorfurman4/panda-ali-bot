import { test } from "node:test";
import assert from "node:assert/strict";
import { createUnderstander, validateIntent } from "../query.js";

const ENV = { ANTHROPIC_API_KEY: "sk-test" };
const OK = { status: "ok", corrected_he: "אוזניות", keywords_en: "wireless earbuds", max_price_ils: null };

// Fake Anthropic Messages API: returns `intent` as the JSON text block and records every request.
function anthropic(intent, { status = 200, stop_reason = "end_turn", text } = {}) {
  const requests = [];
  const fetch = async (url, init) => {
    requests.push({ url, init, body: JSON.parse(init.body) });
    return { ok: status < 400, status, json: async () => ({ stop_reason, content: [{ type: "text", text: text ?? JSON.stringify(intent) }] }) };
  };
  return { fetch, requests };
}

test("sends only the query text to Claude Haiku 5.5 with a JSON schema, no thinking, low effort", async () => {
  const api = anthropic(OK);
  const result = await createUnderstander({ fetch: api.fetch, env: ENV })("אושניות");
  assert.deepEqual(result, OK);
  const [req] = api.requests;
  assert.equal(req.url, "https://api.anthropic.com/v1/messages");
  assert.equal(req.init.headers["x-api-key"], "sk-test");
  assert.equal(req.init.headers["anthropic-version"], "2023-06-01");
  assert.deepEqual(Object.keys(req.body).sort(), ["max_tokens", "messages", "model", "output_config", "system", "thinking"]);
  assert.equal(req.body.model, "claude-haiku-5-5");
  assert.ok(req.body.max_tokens <= 300);
  assert.deepEqual(req.body.thinking, { type: "disabled" });
  assert.equal(req.body.output_config.effort, "low");
  assert.equal(req.body.output_config.format.type, "json_schema");
  assert.deepEqual(req.body.messages, [{ role: "user", content: "אושניות" }]);
});

test("fail-open: returns null on missing key, HTTP error, timeout, bad JSON, schema violations, refusal/truncation", async (t) => {
  const warnings = [];
  t.mock.method(console, "warn", (...a) => warnings.push(a.join(" ")));

  let called = false;
  assert.equal(await createUnderstander({ fetch: async () => (called = true), env: {} })("אושניות"), null);
  assert.equal(called, false, "no key -> no request");

  const cases = [
    anthropic(OK, { status: 500 }).fetch,
    async () => { throw Object.assign(new Error("timed out"), { name: "TimeoutError" }); },
    anthropic(null, { text: "not json {" }).fetch,
    anthropic({ ...OK, keywords_en: "" }).fetch,
    anthropic({ status: "clarify", corrected_he: "מתנה", keywords_en: "", max_price_ils: null, clarify_question_he: "למי?", options: [{ label_he: "א", keywords_en: "a" }] }).fetch,
    anthropic({ ...OK, status: "maybe" }).fetch,
    anthropic(OK, { stop_reason: "max_tokens" }).fetch,
    anthropic(OK, { stop_reason: "refusal" }).fetch,
  ];
  for (const fetch of cases) assert.equal(await createUnderstander({ fetch, env: ENV })("אושניות סוד_123"), null);
  assert.equal(warnings.length, cases.length, "one warning per failure");
  for (const w of warnings) assert.doesNotMatch(w, /סוד_123|אושניות/);
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
  const api = anthropic(OK);
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
  const fetch = async () => ({ ok: ++n > 1, status: n > 1 ? 200 : 500, json: async () => ({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(OK) }] }) });
  const understand = createUnderstander({ fetch, env: ENV });
  assert.equal(await understand("אושניות"), null);
  assert.deepEqual(await understand("אושניות"), OK);
});

test("validateIntent normalizes and checks each status", () => {
  assert.deepEqual(validateIntent({ ...OK, status: "OK", max_price_ils: 50 }), { ...OK, max_price_ils: 50 });
  assert.equal(validateIntent({ ...OK, max_price_ils: -5 }), null);
  assert.deepEqual(validateIntent({ status: "not_product", corrected_he: "תודה", keywords_en: "", max_price_ils: null }), {
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
