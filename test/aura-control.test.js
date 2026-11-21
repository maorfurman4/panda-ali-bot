// AURA control (stage 5): Maor's pause flag and settings overrides. No override rows -> exactly today's values.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { config } from "../aura-report.js";
import { candidates, postingHours, runDeals } from "../deals.js";
import { createDealPicker, createRelevanceFilter } from "../query.js";
import { weakness, reelsPerDay, VIDEO_HOST } from "../reel-style3.js";

// The reporter caches a bot's config for 60 s: each call moves the clock past that and loads `value` from a fake office.
const realNow = Date.now;
let shift = 0;
async function settings(bot, value) {
  shift += 61_000;
  Date.now = () => realNow() + shift;
  const saved = { fetch: globalThis.fetch, env: { ...process.env } };
  globalThis.fetch = async () => new Response(JSON.stringify(value));
  Object.assign(process.env, { AURA_SUPABASE_URL: "http://office.test", AURA_SUPABASE_KEY: "test-key" });
  delete process.env.AURA_REPORT;
  try {
    await config(bot);
  } finally {
    globalThis.fetch = saved.fetch;
    process.env = saved.env;
  }
}
const set = (bot, s) => settings(bot, { paused: false, settings: s });

const item = (id, extra = {}) => ({ product_id: id, product_title: `מנורת לילה ${id}`, evaluate_rate: "97.5%", lastest_volume: 8000, promotion_link: `https://s.click.aliexpress.com/e/${id}`, product_main_image_url: `https://ae01.alicdn.com/${id}.jpg`, ...extra });
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

test("deals: with no settings, today's hours, sales floor and rating floor", async () => {
  await set("panda", {});
  assert.deepEqual(postingHours(), range(7, 23));
  const ids = candidates([item("ok"), item("few", { lastest_volume: 2000 }), item("low", { evaluate_rate: "90%" })]).map((p) => p.product_id);
  assert.deepEqual(ids, ["ok"]);
});

test("deals: valid overrides are used (POST_HOURS, MIN_SOLD, MIN_FEEDBACK)", async () => {
  await set("panda", { POST_HOURS: [9, 21], MIN_SOLD: 1000, MIN_FEEDBACK: 85 });
  assert.deepEqual(postingHours(), range(9, 21));
  const ids = candidates([item("ok"), item("few", { lastest_volume: 2000 }), item("low", { evaluate_rate: "90%" })]).map((p) => p.product_id).sort();
  assert.deepEqual(ids, ["few", "low", "ok"]);
  // 08:00 Israel time (UTC+2 in November) is not a posting hour any more
  const logs = [];
  await runDeals({}, { now: new Date("2026-11-23T06:00:00Z"), names: async () => [], log: (l) => logs.push(l) });
  assert.match(logs.join("\n"), /no post at 8:00/);
});

test("deals: overrides of the wrong type or shape are ignored", async () => {
  for (const bad of ["9-21", [9], [21, 9], [9.5, 21], [-1, 30], [9, 21, 23], ["9", "21"]]) {
    await set("panda", { POST_HOURS: bad, MIN_SOLD: "1000", MIN_FEEDBACK: 85.5 });
    assert.deepEqual(postingHours(), range(7, 23), JSON.stringify(bad));
    assert.deepEqual(candidates([item("ok"), item("few", { lastest_volume: 2000 })]).map((p) => p.product_id), ["ok"]);
  }
});

// Fake OpenAI Responses API: answers `answer` and records each request body.
const openai = (answer) => {
  const bodies = [];
  const fetch = async (_url, init) => (bodies.push(JSON.parse(init.body)), { ok: true, status: 200, json: async () => ({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(answer) }] }], usage: { input_tokens: 1, output_tokens: 1 } }) });
  return { fetch, bodies };
};

test("DEAL_MODEL: the deal-fit pick only; default gpt-5.4-mini, a string instead of a list is ignored", async () => {
  const products = [{ product_title: "Wireless earbuds" }];
  const pick = async (s) => {
    await set("panda", s);
    const api = openai({ fits: [false] });
    await createDealPicker({ fetch: api.fetch, env: { OPENAI_API_KEY: "sk-test" } })(products, "earbuds");
    return api.bodies[0].model;
  };
  assert.equal(await pick({}), "gpt-5.4-mini");
  assert.equal(await pick({ DEAL_MODEL: ["gpt-5.5"] }), "gpt-5.5");
  assert.equal(await pick({ DEAL_MODEL: "gpt-5.5" }), "gpt-5.4-mini");
});

test("RELEVANCE_MODEL: default gpt-5.4; env beats the constant, the AURA override beats the env", async () => {
  const model = async (s, env = {}) => {
    await set("panda", s);
    const api = openai({ exact: [0], partial: [] });
    await createRelevanceFilter({ fetch: api.fetch, env: { OPENAI_API_KEY: "sk-test", ...env } })({ he: "כרית", en: "pillow" }, [{ product_title: "Pillow" }]);
    return api.bodies[0].model;
  };
  assert.equal(await model({}), "gpt-5.4");
  assert.equal(await model({}, { OPENAI_RELEVANCE_MODEL: "gpt-env" }), "gpt-env");
  assert.equal(await model({ RELEVANCE_MODEL: ["gpt-5.5"] }, { OPENAI_RELEVANCE_MODEL: "gpt-env" }), "gpt-5.5");
  assert.equal(await model({ RELEVANCE_MODEL: [5] }), "gpt-5.4", "wrong type ignored");
});

test("reels: REELS_PER_DAY, MIN_SOLD and MIN_POSITIVE under bot id 'reels'", async () => {
  const p = { product_video_url: `${VIDEO_HOST}x.mp4`, lastest_volume: 600, evaluate_rate: "92%", product_title: "Garden sprayer" };
  await set("reels", {});
  assert.equal(reelsPerDay(), 2);
  assert.equal(weakness(p), "sold 600");
  await set("reels", { REELS_PER_DAY: 3, MIN_SOLD: 500, MIN_POSITIVE: 90 });
  assert.equal(reelsPerDay(), 3);
  assert.equal(weakness(p), null);
  await set("reels", { REELS_PER_DAY: "3", MIN_SOLD: [500], MIN_POSITIVE: true });
  assert.equal(reelsPerDay(), 2);
  assert.equal(weakness(p), "sold 600");
  await set("panda", { REELS_PER_DAY: 5 });
  assert.equal(reelsPerDay(), 2, "a panda setting never reaches the reels");
});

// A paused bot: the scheduled script exits 0 after asking AURA, before any report (no 'start' row, no Telegram).
async function runPaused(script, env) {
  const hits = [];
  const office = createServer((req, res) => {
    hits.push(req.url);
    res.setHeader("content-type", "application/json");
    res.end(req.url.endsWith("/rpc/aura_config") ? JSON.stringify({ paused: true, settings: {} }) : "[]");
  });
  await new Promise((r) => office.listen(0, "127.0.0.1", r));
  const dir = mkdtempSync(join(tmpdir(), "aura-paused-"));
  const child = spawn(process.execPath, [script], {
    cwd: dir,
    env: { PATH: process.env.PATH, HOME: dir, AURA_SUPABASE_URL: `http://127.0.0.1:${office.address().port}`, AURA_SUPABASE_KEY: "test-key", ...env },
  });
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (out += d));
  const timer = setTimeout(() => child.kill(), 20_000);
  const code = await new Promise((r) => child.on("close", r));
  clearTimeout(timer);
  office.close();
  return { code, hits, out };
}

test("paused: the deals script exits quietly before any report", async () => {
  const r = await runPaused(new URL("../scripts/daily-deal.js", import.meta.url).pathname, { DEALS_BOT_TOKEN: "1:fake", DEALS_CHAT_ID: "-100", DEALS_STATE: "s.json" });
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(r.hits, ["/rest/v1/rpc/aura_config"], "only the pause check reached the office");
  assert.match(r.out, /paused in AURA/);
});

test("paused: the reels script exits quietly before any report", async () => {
  const r = await runPaused(new URL("../scripts/daily-reel.js", import.meta.url).pathname, { REELS_BOT_TOKEN: "1:fake", DEALS_OWNER_ID: "42", GEMINI_API_KEY: "x", REEL_AUTO: "true", REELS_STATE: "s.json" });
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(r.hits, ["/rest/v1/rpc/aura_config"]);
  assert.match(r.out, /paused in AURA/);
});
