import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../server.js";
import { setup, textUpdate } from "./helpers.js";

async function listen(app) {
  const server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  return { base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) };
}

const post = (base, body, headers = {}) =>
  fetch(`${base}/webhook`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

test("webhook rejects requests without the correct secret header and accepts the right one", async () => {
  const { bot, sent } = setup();
  const srv = await listen(createApp({ bot, mode: "webhook", webhookSecret: "s3cr3t_Token-1" }));
  try {
    const update = textUpdate("/help", { chat: "private" });
    assert.equal((await post(srv.base, update)).status, 401);
    assert.equal((await post(srv.base, update, { "X-Telegram-Bot-Api-Secret-Token": "wrong" })).status, 401);
    assert.equal(sent().length, 0, "rejected updates are not processed");

    const ok = await post(srv.base, update, { "X-Telegram-Bot-Api-Secret-Token": "s3cr3t_Token-1" });
    assert.equal(ok.status, 200);
    assert.equal(sent().length, 1, "accepted update was handled");
  } finally {
    await srv.close();
  }
});

test("/health returns JSON with mode and mock flag", async () => {
  const { bot } = setup();
  const srv = await listen(createApp({ bot, mode: "polling" }));
  try {
    const res = await fetch(`${srv.base}/health`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type"), /application\/json/);
    assert.deepEqual(await res.json(), { ok: true, mode: "polling", mock: true });
  } finally {
    await srv.close();
  }
});

test("polling mode exposes no /webhook route", async () => {
  const { bot } = setup();
  const srv = await listen(createApp({ bot, mode: "polling" }));
  try {
    assert.equal((await post(srv.base, textUpdate("/help"))).status, 404);
  } finally {
    await srv.close();
  }
});

test("keep-awake window: 05:00-03:00 Israel time", async () => {
  const { isAwakeHour } = await import("../server.js");
  const at = (iso) => isAwakeHour(new Date(iso));
  assert.equal(at("2026-10-29T08:00:00+02:00"), true);
  assert.equal(at("2026-10-29T02:30:00+02:00"), true);
  assert.equal(at("2026-10-29T03:30:00+02:00"), false);
  assert.equal(at("2026-10-29T04:59:00+02:00"), false);
  assert.equal(at("2026-10-29T05:00:00+02:00"), true);
});

test("digest time: 02:30-02:39 Israel time only", async () => {
  const { isDigestTime } = await import("../server.js");
  assert.equal(isDigestTime(new Date("2026-10-29T02:35:00+02:00")), true);
  assert.equal(isDigestTime(new Date("2026-10-29T02:45:00+02:00")), false);
  assert.equal(isDigestTime(new Date("2026-10-29T14:35:00+02:00")), false);
});

test("/reels: the Reels bot's webhook needs the secret header, answers at once and hands the update over (2026-11-14)", async () => {
  const { bot } = setup();
  const got = [];
  let release;
  const reels = (u) => (got.push(u.update_id), new Promise((r) => (release = r))); // publishing takes minutes
  const srv = await listen(createApp({ bot, mode: "webhook", webhookSecret: "s3cr3t_Token-1", reels }));
  try {
    const send = (headers) => fetch(`${srv.base}/reels`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ update_id: 9 }) });
    assert.equal((await send({})).status, 401);
    assert.deepEqual(got, []);
    assert.equal((await send({ "X-Telegram-Bot-Api-Secret-Token": "s3cr3t_Token-1" })).status, 200, "answered before the work ends");
    assert.deepEqual(got, [9]);
    release();
  } finally {
    await srv.close();
  }
});

test("/reels is off without the Reels bot", async () => {
  const { bot } = setup();
  const srv = await listen(createApp({ bot, mode: "webhook", webhookSecret: "s3cr3t_Token-1" }));
  try {
    const res = await fetch(`${srv.base}/reels`, { method: "POST", headers: { "content-type": "application/json", "X-Telegram-Bot-Api-Secret-Token": "s3cr3t_Token-1" }, body: "{}" });
    assert.equal(res.status, 404);
  } finally {
    await srv.close();
  }
});

test("/reels/decide: AURA's approve needs x-aura-key (missing env 503, wrong or missing key 403) and goes through decide", async () => {
  const { bot } = setup();
  const calls = [];
  const reels = Object.assign(async () => {}, { decide: async (row, action, by, { answer } = {}) => (calls.push([row, action, by]), row.id === 2 ? { already: true } : (await answer?.("מפרסם..."), { ok: true })) });
  const open = async (decideSecret) => listen(createApp({ bot, mode: "webhook", webhookSecret: "s3cr3t_Token-1", reels, decideSecret }));
  const send = (base, body, headers = {}) => fetch(`${base}/reels/decide`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  let srv = await open(undefined);
  try {
    assert.equal((await send(srv.base, { id: 1, action: "approve" }, { "x-aura-key": "anything" })).status, 503);
  } finally {
    await srv.close();
  }
  srv = await open("a-long-random-test-secret");
  try {
    assert.equal((await send(srv.base, { id: 1, action: "approve" })).status, 403);
    assert.equal((await send(srv.base, { id: 1, action: "approve" }, { "x-aura-key": "wrong" })).status, 403);
    assert.deepEqual(calls, [], "rejected before decide");
    const key = { "x-aura-key": "a-long-random-test-secret" };
    assert.equal((await send(srv.base, { id: "x", action: "approve" }, key)).status, 400);
    assert.equal((await send(srv.base, { id: 1, action: "publish" }, key)).status, 400);
    const ok = await send(srv.base, { id: 1, action: "approve" }, key);
    assert.deepEqual([ok.status, await ok.json()], [200, { ok: true }]);
    assert.deepEqual(await (await send(srv.base, { id: 2, action: "reject" }, key)).json(), { ok: true, already: true });
    assert.deepEqual(calls, [[{ id: 1 }, "approve", "aura"], [{ id: 2 }, "reject", "aura"]]);
  } finally {
    await srv.close();
  }
});
