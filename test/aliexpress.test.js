import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { sign, apiCall, isMockMode, searchProducts, generateAffiliateLink, listOrders, skuApproved, skuDetails, shortenLinks } from "../aliexpress.js";

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

  let k = 0;
  const glitch = async () => (++k === 1 ? json({ resp_result: { resp_code: "404", resp_msg: "System Error" } }) : json({ resp_result: { resp_code: "200", result: { ok: 1 } } }));
  assert.deepEqual(await apiCall("m", {}, { fetch: glitch, env: LIVE_ENV, sleep: noSleep }), { ok: 1 }, "a 'System Error' is retried once");

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
  assert.equal(sent.min_sale_price, undefined, "no range: no price params");
  // AliExpress finds nothing when the words hold "%" ("mechanical keyboard 75%": 0, without it 50; 2026-11-07).
  await searchProducts("mechanical keyboard 75%", { fetch, env: LIVE_ENV });
  assert.equal(sent.keywords, "mechanical keyboard 75");

  await searchProducts("earbuds", { fetch, env: LIVE_ENV, minIls: 80, maxIls: 150.5 });
  assert.equal(sent.min_sale_price, "8000", "shekels -> agorot");
  assert.equal(sent.max_sale_price, "15050");

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

// Fake gateway that answers per API method (method name is in the signed form body).
function gateway(handlers) {
  const calls = [];
  const fetch = async (url, init) => {
    const body = Object.fromEntries(new URLSearchParams(init.body));
    calls.push(body);
    return json(handlers[body.method](body));
  };
  return { fetch, calls };
}

test("zero results (resp_code 405 'The result is empty') returns [] instead of an error", async () => {
  const { fetch } = gateway({
    "aliexpress.affiliate.product.query": () => ({ resp_result: { resp_code: "405", resp_msg: "The result is empty" } }),
  });
  assert.deepEqual(await searchProducts("xqzv", { fetch, env: LIVE_ENV, sleep: noSleep }), []);
});

test("a random 405 'empty' is asked once more and its products come back (seen live 2026-11-02)", async () => {
  let n = 0;
  const { fetch, calls } = gateway({
    "aliexpress.affiliate.product.query": () => (++n === 1
      ? { resp_result: { resp_code: "405", resp_msg: "The result is empty" } }
      : { resp_result: { resp_code: "200", result: { products: [{ product_id: "111" }] } } }),
  });
  assert.deepEqual((await searchProducts("iphone 15 case", { fetch, env: LIVE_ENV, sleep: noSleep, shorten: false })).map((p) => p.product_id), ["111"]);
  assert.equal(calls.length, 2);
  const once = gateway({ "aliexpress.affiliate.product.query": () => ({ resp_result: { resp_code: "405", resp_msg: "The result is empty" } }) });
  assert.deepEqual(await searchProducts("QCY white earbuds", { fetch: once.fetch, env: LIVE_ENV, sleep: noSleep, askAgain: false }), []);
  assert.equal(once.calls.length, 1, "askAgain: false (a brand list) asks once");
});

test("live search swaps the very long promotion links for short ones in ONE link.generate call", async () => {
  const { fetch, calls } = gateway({
    "aliexpress.affiliate.product.query": () => ({
      resp_result: { resp_code: "200", result: { products: [
        { product_id: "111", promotion_link: "https://s.click.aliexpress.com/s/" + "x".repeat(1000) },
        { product_id: "222", promotion_link: "https://s.click.aliexpress.com/s/" + "y".repeat(1000) },
      ] } },
    }),
    "aliexpress.affiliate.link.generate": (body) => ({
      resp_result: { resp_code: "200", result: { promotion_links: body.source_values.split(",").map((u, i) => ({ source_value: u, promotion_link: `https://s.click.aliexpress.com/e/_s${i}` })) } },
    }),
  });
  const products = await searchProducts("earbuds", { fetch, env: LIVE_ENV });
  assert.deepEqual(products.map((p) => p.promotion_link), ["https://s.click.aliexpress.com/e/_s0", "https://s.click.aliexpress.com/e/_s1"]);
  const gen = calls.filter((c) => c.method === "aliexpress.affiliate.link.generate");
  assert.equal(gen.length, 1);
  assert.equal(gen[0].source_values, "https://www.aliexpress.com/item/111.html,https://www.aliexpress.com/item/222.html");
  assert.equal(gen[0].tracking_id, "panda_bot");
});

test("if shortening fails, the original promotion links are kept (search still works)", async (t) => {
  t.mock.method(console, "warn", () => {});
  const { fetch } = gateway({
    "aliexpress.affiliate.product.query": () => ({ resp_result: { resp_code: "200", result: { products: [{ product_id: "111", promotion_link: "https://s.click.aliexpress.com/s/long" }] } } }),
    "aliexpress.affiliate.link.generate": () => ({ error_response: { code: "isv.error", msg: "boom" } }),
  });
  const products = await searchProducts("earbuds", { fetch, env: LIVE_ENV, sleep: async () => {} });
  assert.equal(products[0].promotion_link, "https://s.click.aliexpress.com/s/long");
});

test("listOrders asks every live status (one per call), treats 405 as none, and throws on real errors", async () => {
  const asked = [];
  const fetch = async (url, init) => {
    const { status } = Object.fromEntries(new URLSearchParams(init.body));
    asked.push(status);
    if (status === "Payment Completed") return json({ resp_result: { resp_code: 200, result: { orders: { order: [{ order_id: 1 }, { order_id: 2 }] } } } });
    return json({ resp_result: { resp_code: 405, resp_msg: "The result is empty" } });
  };
  assert.deepEqual(await listOrders("2026-10-01 00:00:00", "2026-10-31 23:59:59", { fetch, env: LIVE_ENV }), [{ order_id: 1 }, { order_id: 2 }]);
  assert.deepEqual(asked.sort(), ["Buyer Confirmed Receipt", "Completed Settlement", "Payment Completed"]);
  const broken = async () => json({ error_response: { code: "IncompleteSignature", msg: "bad" } });
  await assert.rejects(listOrders("a", "b", { fetch: broken, env: LIVE_ENV, sleep: noSleep }), /IncompleteSignature/);
});

test("skuApproved: false on InsufficientPermission, true on success, null when the check fails", async () => {
  const answer = (body) => async () => json(body);
  assert.equal(await skuApproved({ fetch: answer({ error_response: { code: "InsufficientPermission", msg: "no" } }), env: LIVE_ENV }), false);
  assert.equal(await skuApproved({ fetch: answer({ resp_result: { resp_code: 200, result: {} } }), env: LIVE_ENV }), true);
  assert.equal(await skuApproved({ fetch: async () => { throw new Error("network down"); }, env: LIVE_ENV }), null);
});

test("addStars: stars and review count from the review summary; any failure keeps the product as it was", async () => {
  const { addStars } = await import("../aliexpress.js");
  const fetch = async (url) => (url.includes("productId=1") ? { json: async () => ({ data: { productEvaluationStatistic: { evarageStar: 4.9, totalNum: 319 } } }) } : url.includes("productId=2") ? { json: async () => ({ data: {} }) } : Promise.reject(new Error("blocked")));
  const out = await addStars([{ product_id: "1" }, { product_id: "2" }, { product_id: "3" }], { fetch });
  assert.deepEqual(out, [{ product_id: "1", avgStars: 4.9, reviewCount: 319 }, { product_id: "2" }, { product_id: "3" }]);
});

test("addStars: the review count is every rating (the star counts), not only totalNum", async () => {
  const { addStars } = await import("../aliexpress.js");
  const stat = { evarageStar: 4.9, totalNum: 202, fiveStarNum: 424, fourStarNum: 22, threeStarNum: 0, twoStarNum: 0, oneStarNum: 0 };
  const [p] = await addStars([{ product_id: "1" }], { fetch: async () => ({ json: async () => ({ data: { productEvaluationStatistic: stat } }) }) });
  assert.equal(p.reviewCount, 446);
});

// The live answer shape (2026-11-06): no resp_code, the data under result.result.
const skuAnswer = (variants) => ({ aliexpress_affiliate_product_sku_detail_get_response: { result: { result: { ae_item_info: { product_id: "1", review_number: "2594" }, ae_item_sku_info: { traffic_sku_info_list: variants } } } } });
const v = (sku, props, extra = {}) => ({ sku_id: sku, sku_properties: JSON.stringify(props), sku_image_link: `https://ae01.alicdn.com/kf/${sku}.jpg`, price_with_tax: "90.85", sale_price_with_tax: "41.79", link: `https://he.aliexpress.com/item/1.html?sku=${sku}`, currency: "ILS", ...extra });

test("skuApproved: true when the SKU answer has data and no resp_code", async () => {
  assert.equal(await skuApproved({ fetch: async () => json(skuAnswer([v(1, [{ Color: "Red" }])])), env: LIVE_ENV }), true);
});

test("skuDetails: parses colors, photos, prices and links per variant", async () => {
  const asked = [];
  const fetch = async (_u, o) => (asked.push(Object.fromEntries(o.body)), json(skuAnswer([v(11, [{ Color: "Burgundy" }, { Size: "M" }]), v(12, [{ "Color Name": " Navy " }])])));
  const out = await skuDetails(["1"], { fetch, env: LIVE_ENV });
  const list = out.get("1");
  assert.deepEqual(list.map((x) => x.color), ["Burgundy", "Navy"]);
  assert.deepEqual(list[0].props, { Color: "Burgundy", Size: "M" });
  assert.equal(list[0].photo, "https://ae01.alicdn.com/kf/11.jpg");
  assert.equal(list[0].salePrice, 41.79);
  assert.equal(list[0].skuId, "11");
  assert.equal(asked[0].target_language, "EN");
  assert.equal(asked[0].tracking_id, "panda_bot");
});

test("skuDetails: a product answered with error 15 is missing, the others stay", async () => {
  const fetch = async (_u, o) => json(new URLSearchParams(o.body).get("product_id") === "2" ? { error_response: { code: "15", sub_code: "405" } } : skuAnswer([v(1, [{ Color: "Black" }])]));
  const out = await skuDetails(["1", "2"], { fetch, env: LIVE_ENV, sleep: async () => {} });
  assert.ok(out.has("1"));
  assert.ok(!out.has("2"));
});

test("shortenLinks: a product with a matched variant gets the link made for its variant, so the page opens on that color", async () => {
  let sources;
  const fetch = async (_u, o) => {
    sources = new URLSearchParams(o.body).get("source_values").split(",");
    return json({ resp_result: { resp_code: 200, result: { promotion_links: { promotion_link: sources.map((s, i) => ({ source_value: s, promotion_link: `https://s.click.aliexpress.com/e/_v${i}` })) } } } });
  };
  const out = await shortenLinks([
    { product_id: "11", promotion_link: "https://s.click.aliexpress.com/s/long1", variant: { skuId: "999" } },
    { product_id: "12", promotion_link: "https://s.click.aliexpress.com/s/long2" },
  ], { fetch, env: LIVE_ENV });
  assert.deepEqual(sources, ["https://www.aliexpress.com/item/11.html?skuId=999", "https://www.aliexpress.com/item/12.html"]);
  assert.deepEqual(out.map((p) => p.promotion_link), ["https://s.click.aliexpress.com/e/_v0", "https://s.click.aliexpress.com/e/_v1"]);
});

test("fetchReviews: text, stars 1-5, country and photos from the review list; any failure is []", async () => {
  const { fetchReviews } = await import("../aliexpress.js");
  const list = [
    { buyerEval: 100, buyerCountry: "IL", buyerTranslationFeedback: "Great", buyerFeedback: "מעולה", images: ["https://a/1.jpg", "bad"] },
    { buyerEval: 80, buyerCountry: "KR", buyerFeedback: "Nice and small" },
    { buyerEval: 100, buyerCountry: "GB", buyerFeedback: "" },
  ];
  const out = await fetchReviews("1", { fetch: async () => ({ json: async () => ({ data: { evaViewList: list } }) }) });
  assert.deepEqual(out, [{ stars: 5, country: "IL", text: "Great", photos: ["https://a/1.jpg"] }, { stars: 4, country: "KR", text: "Nice and small", photos: [] }]);
  assert.deepEqual(await fetchReviews("1", { fetch: async () => { throw new Error("blocked"); } }), []);
  assert.deepEqual(await fetchReviews("1", { fetch: async () => ({ json: async () => "<html>" }) }), []);
});
