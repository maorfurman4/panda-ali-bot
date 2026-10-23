import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { sign, apiCall, isMockMode, searchProducts, generateAffiliateLink } from "../aliexpress.js";

const LIVE_ENV = { ALI_APP_KEY: "123", ALI_APP_SECRET: "s3cret", ALI_TRACKING_ID: "panda_bot" };
const noSleep = async () => {};
const json = (body, status = 200) => ({ status, json: async () => body });

test("sign: HMAC-SHA256 over sorted key+value pairs, uppercase hex", () => {
  const expected = createHmac("sha256", "s3cret").update("a1b2c3").digest("hex").toUpperCase();
  assert.equal(sign({ c: 3, a: 1, b: 2 }, "s3cret"), expected);
  assert.match(expected, /^[0-9A-F]{64}$/);
});

test("apiCall sends signed system params and returns resp_result.result (string resp_code)", async () => {
  let sent;
  const fetch = async (url, init) => {
    sent = Object.fromEntries(new URLSearchParams(init.body));
    return json({ code: "0", resp_result: { resp_code: "200", resp_msg: "success", result: { ok: 1 } } });
  };
  const result = await apiCall("aliexpress.affiliate.product.query", { keywords: "mp3" }, { fetch, env: LIVE_ENV, now: () => 1700000000000 });
  assert.deepEqual(result, { ok: 1 });
  assert.equal(sent.app_key, "123");
  assert.equal(sent.method, "aliexpress.affiliate.product.query");
  assert.equal(sent.sign_method, "sha256");
  assert.equal(sent.timestamp, "1700000000000");
  const { sign: signature, ...rest } = sent;
  assert.equal(signature, sign(rest, "s3cret"));
});

test("apiCall also accepts the non-simplified response wrapper", async () => {
  const fetch = async () => json({ aliexpress_affiliate_link_generate_response: { resp_result: { resp_code: 200, result: { x: 1 } } } });
  assert.deepEqual(await apiCall("m", {}, { fetch, env: LIVE_ENV }), { x: 1 });
});

test("apiCall retries once on ApiCallLimit with a fresh timestamp and signature", async () => {
  const calls = [];
  let t = 1000;
  const fetch = async (url, init) => {
    calls.push(Object.fromEntries(new URLSearchParams(init.body)));
    return calls.length === 1
      ? json({ error_response: { code: "ApiCallLimit", msg: "Api access frequency exceeds the limit. this ban will last 1 seconds" } })
      : json({ resp_result: { resp_code: "200", result: { done: true } } });
  };
  let slept = 0;
  const result = await apiCall("m", {}, { fetch, env: LIVE_ENV, now: () => (t += 1500), sleep: async (ms) => { slept = ms; } });
  assert.deepEqual(result, { done: true });
  assert.equal(calls.length, 2);
  assert.ok(slept >= 1000 && slept <= 1500, `slept ${slept}`);
  assert.notEqual(calls[0].timestamp, calls[1].timestamp);
  assert.notEqual(calls[0].sign, calls[1].sign);
});

test("apiCall retries once on HTTP 401", async () => {
  let n = 0;
  const fetch = async () => (++n === 1 ? json({}, 401) : json({ resp_result: { resp_code: 200, result: { ok: true } } }));
  assert.deepEqual(await apiCall("m", {}, { fetch, env: LIVE_ENV, sleep: noSleep }), { ok: true });
  assert.equal(n, 2);
});

test("apiCall throws (never returns empty) when the retry also fails or on other errors", async () => {
  let n = 0;
  const limited = async () => { n++; return json({ error_response: { code: "ApiCallLimit", msg: "limit" } }); };
  await assert.rejects(apiCall("m", {}, { fetch: limited, env: LIVE_ENV, sleep: noSleep }), /ApiCallLimit/);
  assert.equal(n, 2);

  let m = 0;
  const invalid = async () => { m++; return json({ error_response: { code: "isv.invalid-parameter", msg: "bad" } }); };
  await assert.rejects(apiCall("m", {}, { fetch: invalid, env: LIVE_ENV, sleep: noSleep }), /invalid-parameter/);
  assert.equal(m, 1, "no retry for non-transient errors");

  const badResp = async () => json({ resp_result: { resp_code: "405", resp_msg: "TrackingId input parameter error" } });
  await assert.rejects(apiCall("m", {}, { fetch: badResp, env: LIVE_ENV, sleep: noSleep }), /TrackingId/);
});

test("mock mode is on when any credential is empty", () => {
  assert.equal(isMockMode({}), true);
  assert.equal(isMockMode({ ...LIVE_ENV, ALI_TRACKING_ID: "" }), true);
  assert.equal(isMockMode(LIVE_ENV), false);
});

test("searchProducts in mock mode returns demo products with images and fake links, without network", async () => {
  const fetch = () => assert.fail("mock mode must not call the API");
  const products = await searchProducts("אוזניות", { fetch, env: {} });
  assert.ok(products.length >= 6);
  for (const p of products) {
    assert.match(p.product_main_image_url, /^https:\/\/placehold\.co\//);
    assert.match(p.promotion_link, /^https:\/\/example\.com\/demo-link\//);
  }
  assert.ok(products.some((p) => p.avgStars && p.reviewCount), "some have stars + reviews");
  assert.ok(products.some((p) => !p.avgStars && p.evaluate_rate), "some have only evaluate_rate");
  assert.ok(products.some((p) => !p.avgStars && !p.evaluate_rate), "one has neither");
});

test("mock titles show the searched keywords, so demo results look related to the request", async () => {
  const products = await searchProducts("wireless earbuds", { env: {} });
  for (const p of products) assert.match(p.product_title, /^wireless earbuds /);
});

test("searchProducts live: requests IL/ILS/HE sorted by orders and reads both product shapes", async () => {
  let sent;
  const fetch = async (url, init) => {
    sent = Object.fromEntries(new URLSearchParams(init.body));
    return json({ resp_result: { resp_code: "200", result: { products: [{ product_id: "1" }] } } });
  };
  assert.deepEqual(await searchProducts("earbuds", { fetch, env: LIVE_ENV }), [{ product_id: "1" }]);
  assert.equal(sent.keywords, "earbuds");
  assert.equal(sent.ship_to_country, "IL");
  assert.equal(sent.target_currency, "ILS");
  assert.equal(sent.target_language, "HE");
  assert.equal(sent.sort, "LAST_VOLUME_DESC");
  assert.equal(sent.tracking_id, "panda_bot");

  const wrapped = async () => json({ resp_result: { resp_code: 200, result: { products: { product: [{ product_id: "2" }] } } } });
  assert.deepEqual(await searchProducts("x", { fetch: wrapped, env: LIVE_ENV }), [{ product_id: "2" }]);
});

test("generateAffiliateLink: mock returns a demo link; live reads both link shapes", async () => {
  assert.match(await generateAffiliateLink("https://www.aliexpress.com/item/123456789.html", { env: {} }), /demo/);

  let sent;
  const flat = async (url, init) => {
    sent = Object.fromEntries(new URLSearchParams(init.body));
    return json({ resp_result: { resp_code: "200", result: { promotion_links: [{ promotion_link: "https://s.click.aliexpress.com/e/_a" }] } } });
  };
  assert.equal(await generateAffiliateLink("https://www.aliexpress.com/item/1.html", { fetch: flat, env: LIVE_ENV }), "https://s.click.aliexpress.com/e/_a");
  assert.equal(sent.source_values, "https://www.aliexpress.com/item/1.html");
  assert.equal(sent.promotion_link_type, "0");

  const nested = async () => json({ resp_result: { resp_code: 200, result: { promotion_links: { promotion_link: [{ promotion_link: "https://s.click.aliexpress.com/e/_b" }] } } } });
  assert.equal(await generateAffiliateLink("u", { fetch: nested, env: LIVE_ENV }), "https://s.click.aliexpress.com/e/_b");
});
