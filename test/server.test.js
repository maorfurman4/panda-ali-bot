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
