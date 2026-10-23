import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { makeCollage } from "../collage.js";

const png = (r, g, b) => sharp({ create: { width: 220, height: 180, channels: 3, background: { r, g, b } } }).png().toBuffer();

async function fakeFetch(failUrls = []) {
  const images = { a: await png(255, 0, 0), b: await png(0, 255, 0), c: await png(0, 0, 255), d: await png(9, 9, 9), e: await png(99, 99, 99) };
  const requested = [];
  const fetch = async (url) => {
    requested.push(url);
    if (failUrls.includes(url)) throw new Error("network");
    return { ok: true, arrayBuffer: async () => images[url.at(-1)] };
  };
  return { fetch, requested };
}

const meta = async (buf) => sharp(buf).metadata();

test("3 images -> one row of 3 square tiles, JPEG", async () => {
  const { fetch } = await fakeFetch();
  const out = await makeCollage(["https://x/a", "https://x/b", "https://x/c"], { fetch });
  const m = await meta(out);
  assert.equal(m.format, "jpeg");
  assert.deepEqual([m.width, m.height], [1200, 400]);
});

test("4 images -> 2x2; 5 images -> 3+2", async () => {
  const { fetch } = await fakeFetch();
  const four = await meta(await makeCollage(["https://x/a", "https://x/b", "https://x/c", "https://x/d"], { fetch }));
  assert.deepEqual([four.width, four.height], [800, 800]);
  const five = await meta(await makeCollage(["https://x/a", "https://x/b", "https://x/c", "https://x/d", "https://x/e"], { fetch }));
  assert.deepEqual([five.width, five.height], [1200, 800]);
});

test("a failed image becomes a blank tile; all images failing returns null", async () => {
  const some = await fakeFetch(["https://x/b"]);
  const out = await makeCollage(["https://x/a", "https://x/b", "https://x/c"], { fetch: some.fetch });
  assert.deepEqual([(await meta(out)).width, (await meta(out)).height], [1200, 400]);
  const none = await fakeFetch(["https://x/a", "https://x/b"]);
  assert.equal(await makeCollage(["https://x/a", "https://x/b"], { fetch: none.fetch }), null);
  assert.equal(await makeCollage([], { fetch: none.fetch }), null);
});

test("only https image URLs are fetched", async () => {
  const { fetch, requested } = await fakeFetch();
  await makeCollage(["http://x/a", "javascript:alert(1)", "https://x/c"], { fetch });
  assert.deepEqual(requested, ["https://x/c"]);
});
