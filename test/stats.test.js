import { test } from "node:test";
import assert from "node:assert/strict";
import { createStats } from "../stats.js";
import { setup, textUpdate } from "./helpers.js";

test("stats: counters and last error per kind", () => {
  const stats = createStats({ now: () => 1000 });
  stats.count("search");
  stats.count("search");
  stats.failure("aliexpress", "IncompleteSignature");
  const snap = stats.snapshot();
  assert.equal(snap.counters.search, 2);
  assert.equal(snap.counters["fail:aliexpress"], 1);
  assert.deepEqual(snap.lastError.aliexpress, { detail: "IncompleteSignature", at: 1000 });
});

test("alerts: 3 failures of one kind within 10 minutes alert the owner once per hour", () => {
  let t = 0;
  const alerts = [];
  const stats = createStats({ now: () => t, notify: async (text) => alerts.push(text) });
  for (let i = 0; i < 2; i++) { t += 60_000; stats.failure("ai", "HTTP 404"); }
  assert.equal(alerts.length, 0, "two failures are not enough");
  t += 60_000; stats.failure("ai", "HTTP 404");
  assert.equal(alerts.length, 1);
  assert.match(alerts[0], /ai/);
  assert.match(alerts[0], /HTTP 404/);
  for (let i = 0; i < 5; i++) { t += 60_000; stats.failure("ai", "HTTP 404"); }
  assert.equal(alerts.length, 1, "no spam within the hour");
  t += 61 * 60_000;
  for (let i = 0; i < 3; i++) { t += 1000; stats.failure("ai", "HTTP 404"); }
  assert.equal(alerts.length, 2);
});

test("alerts: failures spread out over time do not alert", () => {
  let t = 0;
  const alerts = [];
  const stats = createStats({ now: () => t, notify: async (x) => alerts.push(x) });
  for (let i = 0; i < 5; i++) { t += 6 * 60_000; stats.failure("ai", "timeout"); }
  assert.equal(alerts.length, 0);
});

test("the bot counts searches, no-results and search errors", async () => {
  const stats = createStats();
  const ctx = setup({ stats, search: async () => { throw new Error("boom"); } });
  await ctx.bot.handleUpdate(textUpdate("/search x"));
  const ok = setup({ stats, search: async () => [] });
  await ok.bot.handleUpdate(textUpdate("/search y", { userId: 8 }));
  const { counters } = stats.snapshot();
  assert.equal(counters.search, 2);
  assert.equal(counters.noResults, 1);
  assert.equal(counters["fail:aliexpress"], 1);
});

test("/myid tells anyone their numeric Telegram id in private", async () => {
  const ctx = setup();
  await ctx.bot.handleUpdate(textUpdate("/myid", { chat: "private", userId: 123456 }));
  assert.match(ctx.sent()[0].body, /123456/);
});

test("/status is for the owner only (private), with version, counters and live checks", async () => {
  const stats = createStats();
  stats.count("search");
  const ctx = setup({ stats, adminId: "777", version: "abc1234", healthChecks: async () => ["AI: ✅", "עלי אקספרס: ✅"] });
  await ctx.bot.handleUpdate(textUpdate("/status", { chat: "private", userId: 777 }));
  const body = ctx.sent()[0].body;
  assert.match(body, /abc1234/);
  assert.match(body, /חיפושים: 1/);
  assert.match(body, /AI: ✅/);
  const stranger = setup({ stats, adminId: "777", healthChecks: async () => [] });
  await stranger.bot.handleUpdate(textUpdate("/status", { chat: "private", userId: 5 }));
  assert.ok(!stranger.sent().some((m) => /מצב הבוט/.test(m.body ?? "")), "no report for anyone else");
});

test("nightly digest: the day's counts and 🐼 searches since the previous digest; nothing on a day without searches", () => {
  let t = 1000;
  const stats = createStats({ now: () => t });
  t += 1; stats.count("search"); stats.count("search"); stats.count("thumbsDown"); stats.remember("thumbsDown", "מגפיים לבנות");
  const text = stats.digest();
  assert.match(text, /חיפושים: 2/);
  assert.match(text, /🐼 לא זה: 1/);
  assert.match(text, /• מגפיים לבנות/);
  t += 1;
  assert.equal(stats.digest(), null, "no new searches since the last digest");
  t += 1; stats.count("search");
  assert.doesNotMatch(stats.digest(), /מגפיים לבנות/, "only new 🐼 searches");
});
