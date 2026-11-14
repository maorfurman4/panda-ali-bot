import { test } from "node:test";
import assert from "node:assert/strict";
import { createReelsHandler, POST_TEXT } from "../reels.js";

const OWNER = 42;
function fakeApi() {
  const calls = [];
  let id = 100;
  const api = new Proxy({}, { get: (_t, method) => async (...args) => (calls.push({ method, args }), method === "sendVideo" || method === "sendMessage" ? { message_id: ++id } : true) });
  return { api, calls, of: (m) => calls.filter((c) => c.method === m) };
}
const video = (from = OWNER, extra = {}) => ({ update_id: 1, message: { message_id: 5, from: { id: from }, chat: { id: from, type: "private" }, video: { file_id: "F1", file_size: 10_000_000, mime_type: "video/mp4" }, ...extra } });
const press = (data, from = OWNER, update_id = 2) => ({ update_id, callback_query: { id: "q", from: { id: from }, data, message: { message_id: 101, chat: { id: from } } } });

test("reels: a video from the owner comes back as a preview with the post text and two buttons", async () => {
  const { api, of } = fakeApi();
  const handle = createReelsHandler({ api, ownerId: OWNER, publish: async () => ({}), download: async () => Buffer.alloc(1) });
  const state = await handle([video()], {});
  const [v] = of("sendVideo");
  assert.equal(String(v.args[0]), String(OWNER));
  assert.equal(v.args[1], "F1");
  assert.ok(v.args[2].caption.includes(POST_TEXT));
  assert.deepEqual(v.args[2].reply_markup.inline_keyboard[0].map((b) => b.callback_data), ["pub:1", "skip:1"]);
  assert.equal(state.offset, 2);
  assert.equal(state.items[1].status, "pending");
});

test("reels: no link in the post text (owner, 2026-11-13: comments get the link instead)", () => {
  assert.doesNotMatch(POST_TEXT, /https?:|t\.me|www\./i);
  assert.match(POST_TEXT, /פנדה/);
});

test("reels: 'publish' downloads the video, publishes it once, reports each platform and closes the buttons", async () => {
  const { api, of } = fakeApi();
  const published = [];
  const publish = async (bytes, caption, opts) => (published.push({ bytes, caption, opts }), { instagram: { ok: true }, facebook: { ok: true } });
  const handle = createReelsHandler({ api, ownerId: OWNER, publish, download: async (id) => Buffer.from(id) });
  let state = await handle([video()], {});
  state = await handle([press("pub:1")], state);
  assert.equal(published.length, 1);
  assert.equal(published[0].bytes.toString(), "F1");
  assert.equal(published[0].caption, POST_TEXT);
  assert.equal(state.items[1].status, "published");
  assert.match(of("sendMessage").at(-1).args[1], /אינסטגרם: פורסם[\s\S]*פייסבוק: פורסם/);
  assert.equal(of("editMessageReplyMarkup").at(-1).args[2].reply_markup.inline_keyboard[0][0].text, "✅ פורסם");
  state = await handle([press("pub:1", OWNER, 3)], state); // a second press: nothing new goes out
  assert.equal(published.length, 1);
});

test("reels: one platform failing: the other stays published, and 'try again' only retries the failed one", async () => {
  const { api, of } = fakeApi();
  const asks = [];
  let n = 0;
  const publish = async (_b, _c, opts) => (asks.push(opts.skip), n++ ? { facebook: { ok: true } } : { instagram: { ok: true }, facebook: { ok: false, error: "facebook start: (#100) bad id" } });
  const handle = createReelsHandler({ api, ownerId: OWNER, publish, download: async () => Buffer.alloc(1) });
  let state = await handle([video()], {});
  state = await handle([press("pub:1")], state);
  assert.equal(state.items[1].status, "partial");
  assert.match(of("sendMessage").at(-1).args[1], /אינסטגרם: פורסם[\s\S]*פייסבוק: נכשל/);
  assert.equal(of("editMessageReplyMarkup").at(-1).args[2].reply_markup.inline_keyboard[0][0].callback_data, "pub:1");
  state = await handle([press("pub:1", OWNER, 3)], state);
  assert.deepEqual(asks[1], { instagram: true });
  assert.equal(state.items[1].status, "published");
});

test("reels: 'skip' publishes nothing; others are ignored; a file over 20 MB gets an explanation", async () => {
  const { api, calls, of } = fakeApi();
  let published = 0;
  const handle = createReelsHandler({ api, ownerId: OWNER, publish: async () => (published++, {}), download: async () => Buffer.alloc(1) });
  let state = await handle([video()], {});
  state = await handle([press("skip:1")], state);
  assert.equal(state.items[1].status, "skipped");
  assert.equal(published, 0);
  const before = calls.filter((c) => c.method !== "answerCallbackQuery").length;
  state = await handle([video(7), press("pub:1", 7, 4)], state);
  assert.equal(published, 0);
  assert.equal(calls.filter((c) => c.method !== "answerCallbackQuery").length, before, "a stranger's video and press do nothing");
  await handle([video(OWNER, { video: { file_id: "BIG", file_size: 25_000_000 } })], state);
  assert.match(of("sendMessage").at(-1).args[1], /20MB/);
});
