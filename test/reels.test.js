import { test } from "node:test";
import assert from "node:assert/strict";
import { createReelsHandler, POST_TEXT, supabaseApprovals } from "../reels.js";

const OWNER = 42;
function fakeApi() {
  const calls = [];
  let id = 100;
  const api = new Proxy({}, { get: (_t, method) => async (...args) => (calls.push({ method, args }), /^send/.test(method) ? { message_id: ++id } : true) });
  return { api, calls, of: (m) => calls.filter((c) => c.method === m) };
}
const msg = (extra, from = OWNER) => ({ update_id: 1, message: { message_id: 5, from: { id: from }, chat: { id: from, type: "private" }, ...extra } });
const asVideo = (from) => msg({ video: { file_id: "V1", file_size: 9_000_000, mime_type: "video/mp4" } }, from);
const asFile = () => msg({ document: { file_id: "D1", file_size: 12_000_000, mime_type: "video/mp4" } });
// A press carries the preview message itself, so the bot needs no memory between presses (Render may restart it).
const press = (data, preview = { video: { file_id: "V1" } }, from = OWNER) => ({ update_id: 2, callback_query: { id: "q", from: { id: from }, data, message: { message_id: 101, chat: { id: from }, ...preview } } });
const handler = (api, publish = async () => ({ instagram: { ok: true }, facebook: { ok: true } }), download = async (id) => Buffer.from(id)) => createReelsHandler({ api, ownerId: OWNER, publish, download });

test("reels: a video from the owner comes back as a preview with the post text and two buttons", async () => {
  const { api, of } = fakeApi();
  await handler(api)(asVideo());
  const [v] = of("sendVideo");
  assert.equal(String(v.args[0]), String(OWNER));
  assert.equal(v.args[1], "V1");
  assert.ok(v.args[2].caption.includes(POST_TEXT));
  assert.deepEqual(v.args[2].reply_markup.inline_keyboard[0].map((b) => b.callback_data), ["pub", "skip"]);
});

test("reels: a video sent as a FILE keeps its full quality: the preview is the same file and the original is published (owner, 2026-11-14)", async () => {
  const { api, of } = fakeApi();
  const got = [];
  const run = handler(api, async (bytes) => (got.push(bytes.toString()), { instagram: { ok: true }, facebook: { ok: true } }));
  await run(asFile());
  assert.equal(of("sendVideo").length, 0, "not re-sent as a (compressed) video");
  assert.equal(of("sendDocument")[0].args[1], "D1");
  await run(press("pub", { document: { file_id: "D1" } }));
  assert.deepEqual(got, ["D1"]);
});

test("reels: the post text is only the bio line, no link and no hashtags (owner, 2026-11-16)", () => {
  assert.equal(POST_TEXT, "🔗 הקישור לערוץ הדילים בביו 👆");
});

test("reels: 'publish' shows it is working at once, publishes, reports each platform and closes the buttons", async () => {
  const { api, of } = fakeApi();
  const published = [];
  await handler(api, async (bytes, caption, opts) => (published.push({ bytes: bytes.toString(), caption, opts }), { instagram: { ok: true }, facebook: { ok: true } }))(press("pub"));
  assert.deepEqual(published, [{ bytes: "V1", caption: POST_TEXT, opts: { only: null } }]);
  const edits = of("editMessageReplyMarkup").map((c) => c.args[2].reply_markup.inline_keyboard[0][0].text);
  assert.deepEqual(edits, ["⏳ מפרסם...", "✅ פורסם"]);
  assert.match(of("sendMessage").at(-1).args[1], /אינסטגרם: פורסם[\s\S]*פייסבוק: פורסם/);
});

test("reels: a second press while publishing does nothing; a press on a finished one says so", async () => {
  const { api } = fakeApi();
  let release, n = 0;
  const run = handler(api, async () => (n++, await new Promise((r) => (release = r)), { instagram: { ok: true }, facebook: { ok: true } }));
  const first = run(press("pub"));
  await new Promise((r) => setTimeout(r, 5));
  await run(press("pub"));
  release();
  await first;
  await run(press("done"));
  assert.equal(n, 1);
});

test("reels: one platform failing: the other stays published, and 'try again' retries only the failed one", async () => {
  const { api, of } = fakeApi();
  const asks = [];
  const run = handler(api, async (_b, _c, opts) => (asks.push(opts.only), opts.only ? { [opts.only]: { ok: true } } : { instagram: { ok: true }, facebook: { ok: false, error: "(#100) bad id" } }));
  await run(press("pub"));
  assert.match(of("sendMessage").at(-1).args[1], /אינסטגרם: פורסם[\s\S]*פייסבוק: נכשל \(\(#100\) bad id\)/);
  assert.equal(of("editMessageReplyMarkup").at(-1).args[2].reply_markup.inline_keyboard[0][0].callback_data, "pub:facebook");
  await run(press("pub:facebook"));
  assert.deepEqual(asks, [null, "facebook"]);
  assert.equal(of("editMessageReplyMarkup").at(-1).args[2].reply_markup.inline_keyboard[0][0].text, "✅ פורסם");
});

test("reels: 'skip' publishes nothing; a stranger's video and press do nothing; a file over 20 MB gets an explanation", async () => {
  const { api, calls, of } = fakeApi();
  let published = 0;
  const run = handler(api, async () => (published++, {}));
  await run(press("skip"));
  assert.equal(published, 0);
  assert.equal(of("editMessageReplyMarkup").at(-1).args[2].reply_markup.inline_keyboard[0][0].text, "⏭ דולג");
  const before = calls.length;
  await run(asVideo(7));
  await run(press("pub", undefined, 7));
  assert.equal(calls.length, before);
  assert.equal(published, 0);
  await run(msg({ document: { file_id: "BIG", file_size: 25_000_000, mime_type: "video/mp4" } }));
  assert.match(of("sendMessage").at(-1).args[1], /20MB/);
});

test("reels: each video is published with the text shown in its own preview, so style 2 and 3 get their own post text (owner, 2026-11-14)", async () => {
  const { previewExtra } = await import("../reels.js");
  const { api } = fakeApi();
  const own = "🧅 בצל ושום קצוצים דק תוך שניות.\nכתבו \"פנדה\" בתגובות ואשלח לכם בפרטי 👇";
  const texts = [];
  const run = handler(api, async (_b, caption) => (texts.push(caption), { instagram: { ok: true }, facebook: { ok: true } }));
  await run(press("pub", { document: { file_id: "D1" }, caption: previewExtra(own).caption }));
  await run(press("pub", { video: { file_id: "V1" }, caption: "something else" }));
  assert.deepEqual(texts, [own, POST_TEXT], "an unknown caption falls back to the fixed style-1 text");
});

test("reels: a press tells AURA HQ: approved, uploading, published (1/1); a failed upload is an error and the owner still hears it; a skip says so", async () => {
  const seen = [];
  const report = (...a) => seen.push(a);
  const run = (api, publish, download = async (id) => Buffer.from(id)) => createReelsHandler({ api, ownerId: OWNER, publish, download, report });
  await run(fakeApi().api, async () => ({ instagram: { ok: true }, facebook: { ok: true } }))(press("pub"));
  assert.deepEqual(seen.map((r) => r.slice(0, 2)), [["approve", "done"], ["publish", "working"], ["publish", "done"]]);
  assert.equal(seen[0][2], "אושר לפרסום");
  assert.deepEqual(seen[2][3], { instagram: 1, facebook: 1 });

  seen.length = 0;
  const { api, of } = fakeApi();
  await run(api, async () => ({ instagram: { ok: true }, facebook: { ok: true } }), async () => { throw new Error("download failed"); })(press("pub"));
  assert.deepEqual(seen.at(-1).slice(0, 2), ["publish", "error"]);
  const { where, ...counts } = seen.at(-1)[3];
  assert.deepEqual(counts, { instagram: 0, facebook: 0 });
  assert.equal(where.file, "test/reels.test.js", "the error says where in our own code it was thrown");
  assert.ok(where.line > 0 && where.trace.length >= 1);
  assert.match(of("sendMessage").at(-1).args[1], /נכשל \(download failed\)/, "the failure reaches the owner as before");

  seen.length = 0;
  await run(fakeApi().api, async () => undefined)(press("pub")); // a publisher that answers nothing: the press throws inside
  assert.deepEqual(seen.at(-1).slice(0, 2), ["publish", "error"], "a throw between 'working' and the result never leaves it on working");
  assert.equal(seen.at(-1)[3].where.file, "reels.js", "and it says where in the bot's own file");

  seen.length = 0;
  await run(fakeApi().api, async () => ({ facebook: { ok: true } }))(press("pub:facebook"));
  assert.deepEqual(seen.map((r) => r.slice(0, 2)), [["publish", "working"], ["publish", "done"]]);
  assert.deepEqual(seen[1][3], { facebook: 1 });

  seen.length = 0;
  await run(fakeApi().api, async () => assert.fail("a skip publishes nothing"))(press("skip"));
  assert.deepEqual(seen, [["approve", "done", "דילגת על הרילס"]]);
});

// ---- AURA approvals (aura_approvals in Supabase): the Telegram button and AURA share decide(), so they never disagree ----
// A fake PostgREST for aura_approvals: POST inserts, PATCH ?id=eq.N&status=eq.waiting claims (only a waiting row).
function fakeSupabase({ down = false } = {}) {
  const rows = [];
  const requests = [];
  const fetch = async (url, init) => {
    const body = init.body ? JSON.parse(init.body) : null;
    requests.push({ url, method: init.method, headers: init.headers, body });
    if (down) throw new TypeError("fetch failed");
    const u = new URL(url);
    assert.equal(u.pathname, "/rest/v1/aura_approvals");
    assert.equal(init.headers.Prefer, "return=representation");
    const json = (x) => ({ ok: true, status: 200, json: async () => x });
    if (init.method === "POST") return rows.push({ id: rows.length + 1, status: "waiting", ...body }), json([rows.at(-1)]);
    if (init.method === "PATCH") {
      const id = Number(u.searchParams.get("id").replace("eq.", ""));
      assert.equal(u.searchParams.get("status"), "eq.waiting");
      const row = rows.find((r) => r.id === id && r.status === "waiting");
      return json(row ? [Object.assign(row, body)] : []);
    }
    throw new Error(`unexpected ${init.method}`);
  };
  return { rows, requests, fetch, approvals: supabaseApprovals({ fetch, env: { SUPABASE_URL: "http://sb.test", SUPABASE_SERVICE_KEY: "test-key" } }) };
}
const withApprovals = (api, approvals, publish) => createReelsHandler({ api, ownerId: OWNER, publish, download: async (id) => Buffer.from(id), approvals, report: () => {} });
const counter = () => {
  const done = [];
  return { done, publish: async (bytes, caption, opts) => (done.push({ bytes: bytes.toString(), caption, only: opts.only }), { instagram: { ok: true }, facebook: { ok: true } }) };
};

test("approvals: a preview from the bot is stored as a waiting row and its buttons carry the row id", async () => {
  const { api, of } = fakeApi();
  const sb = fakeSupabase();
  await withApprovals(api, sb.approvals, counter().publish)(asVideo());
  assert.equal(sb.rows.length, 1);
  const [row] = sb.rows;
  assert.deepEqual({ bot: row.bot, kind: row.kind, status: row.status }, { bot: "reels", kind: "publish", status: "waiting" });
  assert.deepEqual(row.payload, { chat_id: String(OWNER), message_id: 101, file_id: "V1", caption: POST_TEXT });
  assert.equal(JSON.stringify(row).includes("test-key"), false, "no secret in the row");
  const edit = of("editMessageReplyMarkup").at(-1);
  assert.equal(edit.args[1], 101);
  assert.deepEqual(edit.args[2].reply_markup.inline_keyboard[0].map((b) => b.callback_data), ["pub#1", "skip#1"]);
});

test("approvals: the insert failing leaves the Telegram flow exactly as today", async () => {
  const { api, of } = fakeApi();
  const sb = fakeSupabase({ down: true });
  const c = counter();
  const run = withApprovals(api, sb.approvals, c.publish);
  await run(asVideo());
  assert.equal(of("editMessageReplyMarkup").length, 0, "the plain pub / skip buttons stay");
  assert.deepEqual(of("sendVideo")[0].args[2].reply_markup.inline_keyboard[0].map((b) => b.callback_data), ["pub", "skip"]);
  await run(press("pub"));
  assert.equal(c.done.length, 1);
});

test("approvals: the Telegram press claims the row, publishes once; AURA approving after it publishes nothing", async () => {
  const { api } = fakeApi();
  const sb = fakeSupabase();
  const c = counter();
  const run = withApprovals(api, sb.approvals, c.publish);
  await run(asVideo());
  await run(press("pub#1"));
  assert.deepEqual(c.done, [{ bytes: "V1", caption: POST_TEXT, only: null }]);
  const patch = sb.requests.find((r) => r.method === "PATCH");
  assert.match(patch.url, /\/rest\/v1\/aura_approvals\?id=eq\.1&status=eq\.waiting$/);
  assert.deepEqual([patch.body.status, patch.body.decided_by], ["approved", "telegram"]);
  assert.ok(!Number.isNaN(Date.parse(patch.body.decided_at)));
  assert.deepEqual(await run.decide({ id: 1 }, "approve", "aura"), { already: true });
  await run(press("pub#1"));
  assert.equal(c.done.length, 1, "published once");
});

test("approvals: AURA approves a waiting row: published once from the row's payload, the preview closes like a press", async () => {
  const { api, of } = fakeApi();
  const sb = fakeSupabase();
  const c = counter();
  const run = withApprovals(api, sb.approvals, c.publish);
  await run(asFile());
  assert.deepEqual(await run.decide({ id: 1 }, "approve", "aura"), { ok: true });
  assert.deepEqual(c.done, [{ bytes: "D1", caption: POST_TEXT, only: null }]);
  assert.deepEqual([sb.rows[0].status, sb.rows[0].decided_by], ["approved", "aura"]);
  const edits = of("editMessageReplyMarkup").slice(1).map((e) => [e.args[1], e.args[2].reply_markup.inline_keyboard[0][0].text]);
  assert.deepEqual(edits, [[101, "⏳ מפרסם..."], [101, "✅ פורסם"]]);
  assert.match(of("sendMessage").at(-1).args[1], /אינסטגרם: פורסם/);
  assert.deepEqual(await run.decide({ id: 1 }, "approve", "aura"), { already: true });
  await run(press("pub#1", { document: { file_id: "D1" } }));
  assert.equal(c.done.length, 1, "a second decide and a late press publish nothing");
});

test("approvals: AURA rejecting skips like the button; a press with no row (old preview) keeps today's behaviour", async () => {
  const { api, of } = fakeApi();
  const sb = fakeSupabase();
  const c = counter();
  const run = withApprovals(api, sb.approvals, c.publish);
  await run(asVideo());
  assert.deepEqual(await run.decide({ id: 1 }, "reject", "aura"), { ok: true });
  assert.equal(sb.rows[0].status, "rejected");
  assert.equal(of("editMessageReplyMarkup").at(-1).args[2].reply_markup.inline_keyboard[0][0].text, "⏭ דולג");
  assert.equal(c.done.length, 0);
  const before = sb.requests.length;
  await run(press("pub"));
  assert.equal(c.done.length, 1);
  assert.equal(sb.requests.length, before, "no row, no claim");
});

test("approvals: Supabase down at the press: Maor's button still publishes; AURA's decide fails loudly", async () => {
  const { api } = fakeApi();
  const c = counter();
  const run = withApprovals(api, fakeSupabase({ down: true }).approvals, c.publish);
  await run(press("pub#7"));
  assert.equal(c.done.length, 1);
  await assert.rejects(run.decide({ id: 7 }, "approve", "aura"));
  assert.equal(c.done.length, 1);
});
