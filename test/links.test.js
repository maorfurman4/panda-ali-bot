import { test } from "node:test";
import assert from "node:assert/strict";
import { findAliExpressUrl, extractProductId, resolveProductUrl } from "../links.js";

test("finds real AliExpress links inside text", () => {
  assert.equal(
    findAliExpressUrl("תראו https://he.aliexpress.com/item/1005001234567890.html?spm=x מגניב"),
    "https://he.aliexpress.com/item/1005001234567890.html?spm=x",
  );
  assert.equal(findAliExpressUrl("https://a.aliexpress.com/_mKa1b2c"), "https://a.aliexpress.com/_mKa1b2c");
  assert.equal(findAliExpressUrl("https://aliexpress.com/item/123456789.html"), "https://aliexpress.com/item/123456789.html");
  assert.equal(findAliExpressUrl("(https://www.aliexpress.com/item/123456789.html)."), "https://www.aliexpress.com/item/123456789.html");
});

test("ignores look-alike and foreign domains", () => {
  for (const text of [
    "https://aliexpress.com.evil.com/item/123456789.html",
    "https://evilaliexpress.com/item/123456789.html",
    "https://aliexpress.co/item/123456789.html",
    "https://amazon.com/item/123456789.html",
    "https://evil.com/?u=https:aliexpress.com",
    "no links here",
  ]) {
    assert.equal(findAliExpressUrl(text), null, text);
  }
});

test("extracts product IDs from item URLs", () => {
  assert.equal(extractProductId("https://he.aliexpress.com/item/1005001234567890.html?spm=1"), "1005001234567890");
  assert.equal(extractProductId("https://m.aliexpress.com/i/1005001234567890.html"), "1005001234567890");
  assert.equal(extractProductId("https://a.aliexpress.com/_mKa1b2c"), null);
});

test("normalizes a full item URL to a clean /item/{id}.html URL without network", async () => {
  const fetch = () => assert.fail("must not fetch when the ID is in the URL");
  assert.equal(
    await resolveProductUrl("https://he.aliexpress.com/item/1005001234567890.html?spm=a&aff=other", { fetch }),
    "https://www.aliexpress.com/item/1005001234567890.html",
  );
});

// Fake fetch that serves a redirect map and records every URL actually requested.
function redirects(map) {
  const requested = [];
  const fetch = async (url, init) => {
    assert.equal(init.redirect, "manual", "redirects must be followed manually");
    requested.push(url);
    const location = map[url];
    return { status: location ? 302 : 200, headers: new Headers(location ? { location } : {}), body: null };
  };
  return { fetch, requested };
}

test("follows short-link redirects hop by hop to find the product", async () => {
  const { fetch } = redirects({
    "https://a.aliexpress.com/_mKa1b2c": "https://s.click.aliexpress.com/e/_x",
    "https://s.click.aliexpress.com/e/_x": "/item/1005009999999999.html?srcSns=x",
  });
  assert.equal(
    await resolveProductUrl("https://a.aliexpress.com/_mKa1b2c", { fetch }),
    "https://www.aliexpress.com/item/1005009999999999.html",
  );
});

test("never requests a redirect target outside AliExpress (no SSRF)", async () => {
  const { fetch, requested } = redirects({ "https://a.aliexpress.com/_x": "http://169.254.169.254/item/1005009999999999.html" });
  assert.equal(await resolveProductUrl("https://a.aliexpress.com/_x", { fetch }), null);
  assert.deepEqual(requested, ["https://a.aliexpress.com/_x"]);
});

test("rejects short links with no product, redirect loops, or network errors", async () => {
  assert.equal(await resolveProductUrl("https://a.aliexpress.com/_x", redirects({ "https://a.aliexpress.com/_x": "https://www.aliexpress.com/" })), null);
  const loop = redirects({ "https://a.aliexpress.com/_x": "https://a.aliexpress.com/_y", "https://a.aliexpress.com/_y": "https://a.aliexpress.com/_x" });
  assert.equal(await resolveProductUrl("https://a.aliexpress.com/_x", loop), null);
  assert.ok(loop.requested.length <= 5);
  assert.equal(await resolveProductUrl("https://a.aliexpress.com/_x", { fetch: async () => { throw new Error("timeout"); } }), null);
});
