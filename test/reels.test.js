import { test } from "node:test";
import assert from "node:assert/strict";
import { createReelsHandler, POST_TEXT } from "../reels.js";

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
