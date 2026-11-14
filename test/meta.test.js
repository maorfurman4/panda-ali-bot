import { test } from "node:test";
import assert from "node:assert/strict";
import { publishReel } from "../meta.js";

const TOKEN = "PAGE-TOKEN-SECRET";
// A fake Meta: records each call, answers like the docs (IG container -> upload -> status -> publish; FB start -> upload -> finish).
function fakeMeta({ igStatus = ["IN_PROGRESS", "FINISHED"], fail = null } = {}) {
  const calls = [];
  const statuses = [...igStatus];
  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    calls.push({ url: u.origin + u.pathname, method: init.method ?? "GET", headers: init.headers ?? {}, body: init.body });
    const reply = (status, json) => ({ ok: status < 400, status, json: async () => json });
    if (fail && u.pathname.includes(fail)) return reply(400, { error: { message: "(#100) bad id", code: 100 } });
    if (u.pathname.endsWith("/IG/media")) return reply(200, { id: "C1", uri: "https://rupload.facebook.com/ig-api-upload/v27.0/C1" });
    if (u.pathname.includes("/ig-api-upload/")) return reply(200, { success: true });
    if (u.pathname.endsWith("/C1")) return reply(200, { status_code: statuses.shift() ?? "FINISHED" });
    if (u.pathname.endsWith("/IG/media_publish")) return reply(200, { id: "M1" });
    if (u.pathname.endsWith("/PAGE/video_reels")) return reply(200, JSON.parse(init.body).upload_phase === "start" ? { video_id: "V1", upload_url: "https://rupload.facebook.com/video-upload/v27.0/V1" } : { success: true });
    if (u.pathname.includes("/video-upload/")) return reply(200, { success: true });
    return reply(404, { error: { message: "unexpected" } });
  };
  return { fetch, calls };
}
const opts = (fetch) => ({ fetch, token: TOKEN, igId: "IG", pageId: "PAGE", sleep: async () => {} });

test("meta: a Reel goes to Instagram (container, upload, wait, publish) and to the Facebook Page (start, upload, finish)", async () => {
  const { fetch, calls } = fakeMeta();
  const video = Buffer.from("mp4-bytes");
  const out = await publishReel(video, "caption #tag", opts(fetch));
  assert.deepEqual(out, { instagram: { ok: true, id: "M1" }, facebook: { ok: true, id: "V1" } });
  const ig = calls.filter((c) => /IG|ig-api|C1/.test(c.url)).map((c) => `${c.method} ${c.url.split("/").slice(-2).join("/")}`);
  assert.deepEqual(ig, ["POST IG/media", "POST v27.0/C1", "GET v27.0/C1", "GET v27.0/C1", "POST IG/media_publish"]);
  const create = JSON.parse(calls[0].body.toString?.() ?? calls[0].body);
  assert.equal(create.media_type, "REELS");
  assert.equal(create.upload_type, "resumable");
  assert.equal(create.caption, "caption #tag");
  const upload = calls.find((c) => c.url.includes("/ig-api-upload/"));
  assert.equal(upload.headers.Authorization, `OAuth ${TOKEN}`);
  assert.equal(upload.headers.offset, "0");
  assert.equal(upload.headers.file_size, String(video.length));
  const finish = calls.filter((c) => c.url.endsWith("/PAGE/video_reels")).map((c) => JSON.parse(c.body));
  assert.deepEqual(finish.map((b) => b.upload_phase), ["start", "finish"]);
  assert.equal(finish[1].video_state, "PUBLISHED");
  assert.equal(finish[1].description, "caption #tag");
  assert.ok(calls.every((c) => c.url.startsWith("https://graph.facebook.com/v27.0/") || c.url.startsWith("https://rupload.facebook.com/")));
});

test("meta: one platform failing leaves the other published, and the error never holds the token", async () => {
  const { fetch } = fakeMeta({ fail: "/PAGE/video_reels" });
  const out = await publishReel(Buffer.from("x"), "c", opts(fetch));
  assert.equal(out.instagram.ok, true);
  assert.equal(out.facebook.ok, false);
  assert.match(out.facebook.error, /bad id/);
  assert.doesNotMatch(JSON.stringify(out), new RegExp(TOKEN));
});

test("meta: Instagram processing that ends in ERROR is a failure; a retry of one platform leaves the other alone", async () => {
  const { fetch, calls } = fakeMeta({ igStatus: ["IN_PROGRESS", "ERROR"] });
  const out = await publishReel(Buffer.from("x"), "c", { ...opts(fetch), only: "instagram" });
  assert.equal(out.instagram.ok, false);
  assert.match(out.instagram.error, /ERROR/);
  assert.equal(out.facebook, undefined);
  assert.ok(!calls.some((c) => c.url.includes("video_reels")));
});

test("meta: missing secrets fail plainly, with nothing sent", async () => {
  const { fetch, calls } = fakeMeta();
  const out = await publishReel(Buffer.from("x"), "c", { ...opts(fetch), token: "" });
  assert.equal(out.instagram.ok, false);
  assert.match(out.instagram.error, /META_PAGE_TOKEN/);
  assert.equal(calls.length, 0);
});
