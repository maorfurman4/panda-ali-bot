// AliExpress Affiliate API client with a mock mode used while credentials are missing.
// Official docs (checked 2026-10-22):
//   https://openservice.aliexpress.com/doc/api.htm#/api?cid=21407&path=aliexpress.affiliate.product.query
//   https://openservice.aliexpress.com/doc/api.htm#/api?cid=21407&path=aliexpress.affiliate.link.generate
// UNVERIFIED live: gateway + sha256 signing match the ae_sdk v0.6.0 source, but no real call has been made yet.
import { createHmac } from "node:crypto";
import { resolveProductUrl } from "./links.js";

const GATEWAY = "https://api-sg.aliexpress.com/sync";
const TIMEOUT_MS = 10_000;
const RETRY_DELAY_MS = 1200;
const PAGE_SIZE = 50; // the API maximum: a bigger pool for the quality, relevance and ranking steps

export const isMockMode = (env = process.env) => !env.ALI_APP_KEY || !env.ALI_APP_SECRET || !env.ALI_TRACKING_ID;

// Sort params by key, concatenate key+value, HMAC-SHA256 with the app secret, uppercase hex.
export function sign(params, secret) {
  const base = Object.keys(params).sort().map((k) => k + params[k]).join("");
  return createHmac("sha256", secret).update(base, "utf8").digest("hex").toUpperCase();
}

const sleepMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// Retried once: rate limit, a stale signature (401), server errors, and "resp_code 404: System Error" (seen live 2026-10-24, gone on retry).
const isTransient = (status, err) => status === 401 || status >= 500 || /ApiCallLimit|frequency exceeds|System Error/i.test(`${err.code} ${err.msg ?? err.message}`);

async function callOnce(method, params, { fetch, env, now }) {
  const all = { app_key: env.ALI_APP_KEY, method, timestamp: String(now()), sign_method: "sha256", simplify: "true", ...params };
  all.sign = sign(all, env.ALI_APP_SECRET);
  const res = await fetch(GATEWAY, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=utf-8" },
    body: new URLSearchParams(all),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const data = await res.json().catch(() => ({}));
  const err = data.error_response ?? (data.code && String(data.code) !== "0" ? data : null);
  if (err || res.status === 401) return { status: res.status, err: err ?? { code: `HTTP ${res.status}` } };
  // Simplified responses put resp_result at the top; non-simplified wrap it in "<method>_response".
  const resp = data.resp_result ?? Object.values(data).find((v) => v?.resp_result)?.resp_result;
  // The SKU API answers without resp_code, its data under result.result (live, 2026-11-06).
  const bare = !resp && Object.values(data).find((v) => v?.result?.result)?.result.result;
  if (bare) return { result: bare };
  if (Number(resp?.resp_code) !== 200) return { status: res.status, err: { code: `resp_code ${resp?.resp_code}`, msg: resp?.resp_msg } };
  return { result: resp.result ?? {} };
}

// Throws on any failure (never returns "empty"), so callers can't mistake an error for "no results".
export async function apiCall(method, params, { fetch = globalThis.fetch, env = process.env, now = Date.now, sleep = sleepMs } = {}) {
  let out = await callOnce(method, params, { fetch, env, now });
  if (out.err && isTransient(out.status, out.err)) {
    await sleep(RETRY_DELAY_MS);
    out = await callOnce(method, params, { fetch, env, now }); // fresh timestamp + signature
  }
  if (out.err) throw Object.assign(new Error(`AliExpress ${method} failed: ${out.err.code}: ${out.err.msg ?? out.err.message ?? ""}`), { code: out.err.code });
  return out.result;
}

// deps.page / deps.sort ("relevance") / deps.category: other result lists for the same words (see pickProducts).
// deps.minIls / deps.maxIls: optional shekel range, filtered by AliExpress itself (in agorot, on the sale price;
// verified live 2026-10-24: 40 of 50 knife sets in 300–600 ₪ vs 0 without). The caller still post-filters exactly.
export async function searchProducts(query, deps = {}) {
  const env = deps.env ?? process.env;
  if (isMockMode(env)) return mockProducts(query);
  const ask = () => apiCall(
    "aliexpress.affiliate.product.query",
    {
      keywords: query.replace(/\s*%/g, ""), // "mechanical keyboard 75%" finds nothing, "... 75" 50 (2026-11-07)
      tracking_id: env.ALI_TRACKING_ID,
      ship_to_country: "IL",
      target_currency: "ILS",
      target_language: deps.lang ?? "HE", // "EN": the sellers' own titles, for the item check (bot.js itemNoun)
      ...(deps.sort === "relevance" ? {} : { sort: "LAST_VOLUME_DESC" }), // no sort param = AliExpress's own relevance order
      ...(deps.page > 1 ? { page_no: String(deps.page) } : {}),
      ...(deps.category ? { category_ids: String(deps.category) } : {}), // a main category: an extra list, never the only one
      page_size: String(PAGE_SIZE),
      ...(deps.minIls ? { min_sale_price: String(Math.round(deps.minIls * 100)) } : {}),
      ...(deps.maxIls ? { max_sale_price: String(Math.round(deps.maxIls * 100)) } : {}),
    },
    { ...deps, env },
  );
  let result;
  try {
    result = await ask().catch(async (e) => {
      // A 405 "empty" is sometimes random: 3 of ~10 live calls on 2026-11-02, all 50 on a re-ask. One more try.
      if (e.code !== "resp_code 405" || deps.askAgain === false) throw e;
      console.warn(`search empty, asking again: ${query}`);
      await (deps.sleep ?? sleepMs)(RETRY_DELAY_MS);
      return ask();
    });
  } catch (e) {
    if (e.code === "resp_code 405") return []; // AliExpress answers "The result is empty" with 405 (verified live 2026-10-23)
    throw e;
  }
  const products = Array.isArray(result.products) ? result.products : (result.products?.product ?? []);
  // The bot passes shorten:false and shortens only the products it shows (each link.generate call adds ~1 s, 2026-10-29).
  return deps.shorten === false ? products : shortenLinks(products, { ...deps, env });
}

// AliExpress's own curated lists ("featured promos"), e.g. "1101-1118 11.11 Sale - Bestsellers" (checked 2026-10-30).
export async function promoNames(deps = {}) {
  const result = await apiCall("aliexpress.affiliate.featuredpromo.get", {}, deps);
  return (result.promos?.promo ?? []).map((p) => p.promo_name).filter(Boolean);
}

// One page of a featured promo for Israel, optionally in one main category. The API ignores its sort, so callers rank.
export async function promoProducts(name, deps = {}) {
  const env = deps.env ?? process.env;
  try {
    const result = await apiCall(
      "aliexpress.affiliate.featuredpromo.products.get",
      {
        promotion_name: name,
        tracking_id: env.ALI_TRACKING_ID,
        country: "IL",
        ship_to_country: "IL",
        target_currency: "ILS",
        target_language: "HE",
        page_size: String(PAGE_SIZE),
        ...(deps.category ? { category_id: String(deps.category) } : {}),
      },
      { ...deps, env },
    );
    return result.products?.product ?? [];
  } catch (e) {
    if (e.code === "resp_code 405") return []; // "the result is empty"
    throw e;
  }
}

// Affiliate orders created between two "YYYY-MM-DD HH:mm:ss" times, on the clock created_time shows (checked live
// 2026-10-31). The API needs exactly one status per call, so every live status is asked at once.
// shortcut: first 50 orders per status; add page_no when sales pass that.
const ORDER_STATUSES = ["Payment Completed", "Buyer Confirmed Receipt", "Completed Settlement"];
export async function listOrders(start, end, deps = {}) {
  const lists = await Promise.all(
    ORDER_STATUSES.map((status) =>
      apiCall("aliexpress.affiliate.order.list", { start_time: start, end_time: end, status, page_size: "50" }, deps).then(
        (r) => [].concat(r.orders?.order ?? []),
        (e) => {
          if (e.code === "resp_code 405") return []; // "the result is empty"
          throw e;
        },
      ),
    ),
  );
  return lists.flat();
}

// Whether the SKU Dimension API (per-variant "from ₪X" prices) is approved yet: true / false, null if the check failed.
// The product is a real one from our first orders; the permission error comes before any product check.
export const skuApproved = (deps = {}) =>
  apiCall("aliexpress.affiliate.product.sku.detail.get", { product_id: "1005009775708321", ship_to_country: "IL", target_currency: "ILS", target_language: "HE" }, deps).then(
    () => true,
    (e) => (e.code === "InsufficientPermission" ? false : null),
  );

// Every variant of each product (color, size, capacity, model), with its own photo, price and link (SKU API, approved
// 2026-11-06). English names: real color names ("Burgundy", "Navy") in 29 of 32 best sellers checked. At most 20 variants
// come back, so a missing one isn't proof it doesn't exist. A product with no answer (error 15 / 405, timeout) is left out.
const SKU_TIMEOUT_MS = 3000;
export async function skuDetails(productIds, deps = {}) {
  const env = deps.env ?? process.env;
  if (isMockMode(env)) return new Map();
  const props = (s) => { try { return Object.assign({}, ...JSON.parse(s ?? "[]")); } catch { return {}; } };
  const one = async (id) => {
    const call = apiCall("aliexpress.affiliate.product.sku.detail.get", { product_id: String(id), ship_to_country: "IL", target_currency: "ILS", target_language: "EN", tracking_id: env.ALI_TRACKING_ID }, { ...deps, env });
    const r = await Promise.race([call, new Promise((_, no) => setTimeout(no, SKU_TIMEOUT_MS, new Error("sku timeout")).unref())]);
    return (r?.ae_item_sku_info?.traffic_sku_info_list ?? []).map((v) => {
      const p = props(v.sku_properties);
      const colorKey = Object.keys(p).find((k) => /colou?r/i.test(k));
      return { skuId: String(v.sku_id), props: p, color: colorKey ? String(p[colorKey]).trim() : null, photo: v.sku_image_link ?? null, price: Number(v.price_with_tax) || 0, salePrice: Number(v.sale_price_with_tax) || 0, link: v.link ?? null };
    });
  };
  const got = await Promise.all(productIds.map((id) => one(id).then((l) => [String(id), l], () => null)));
  return new Map(got.filter((x) => x && x[1].length));
}

// Stars and review count from the public review summary the item page uses (no API has them: the DS API can't be added to
// an affiliate account). shortcut: unofficial and may change or block; every failure just leaves the % feedback line.
const FEEDBACK_URL = "https://feedback.aliexpress.com/pc/searchEvaluation.do";
// Up to 20 buyer reviews of one product, English text (AliExpress's own translation), stars 1-5 and the buyer's photos.
// Same unofficial source as addStars; any failure is [] (owner, 2026-11-08: real reviews in the deal posts).
export async function fetchReviews(productId, { fetch = globalThis.fetch, timeoutMs = 4500 } = {}) {
  const url = `${FEEDBACK_URL}?productId=${encodeURIComponent(productId)}&lang=en_US&country=IL&page=1&pageSize=20&filter=all&sort=complex_default`;
  try {
    const d = await fetch(url, { headers: { "user-agent": "Mozilla/5.0", referer: "https://www.aliexpress.com/" }, signal: AbortSignal.timeout(timeoutMs) }).then((r) => r.json());
    const list = Array.isArray(d?.data?.evaViewList) ? d.data.evaViewList : [];
    return list
      .map((r) => ({ stars: Number(r.buyerEval) / 20, country: String(r.buyerCountry ?? ""), text: String(r.buyerTranslationFeedback || r.buyerFeedback || "").trim(), photos: (Array.isArray(r.images) ? r.images : []).filter((u) => /^https:\/\//.test(u ?? "")) }))
      .filter((r) => r.stars >= 1 && r.stars <= 5 && r.text);
  } catch {
    return [];
  }
}
export async function addStars(products, { fetch = globalThis.fetch, timeoutMs = 4500 } = {}) { // 12 at once take ~2.5-4 s (2026-11-02)
  const one = async (p) => {
    const url = `${FEEDBACK_URL}?productId=${encodeURIComponent(p.product_id)}&lang=en_US&country=IL&page=1&pageSize=1&filter=all&sort=complex_default`;
    const s = await fetch(url, { headers: { "user-agent": "Mozilla/5.0", referer: "https://www.aliexpress.com/" }, signal: AbortSignal.timeout(timeoutMs) })
      .then((r) => r.json())
      .then((d) => d?.data?.productEvaluationStatistic, () => null);
    // totalNum counts only some reviews (202 for an e-reader rated 446 times: 424 five-star + 22 four-star); the star
    // counts add up to every rating, the number AliExpress and the competitor show (owner's comparison, 2026-11-02).
    const rated = ["five", "four", "three", "two", "one"].reduce((n, k) => n + (Number(s?.[`${k}StarNum`]) || 0), 0);
    const stars = Number(s?.evarageStar ?? s?.averageStar), reviews = Math.max(Number(s?.totalNum) || 0, rated);
    return stars > 0 && stars <= 5 && reviews > 0 ? { ...p, avgStars: stars, reviewCount: reviews } : p;
  };
  return Promise.all(products.map((p) => (p.product_id ? one(p).catch(() => p) : p)));
}

// A color-matched product links to its variant: the page opens on that color, and the link stays a normal affiliate link
// (free check 2026-11-06: link.generate's s.click link redirects with skuId and the aff_ parameters kept).
const itemUrl = (p) => `https://www.aliexpress.com/item/${p.product_id}.html${p.variant?.skuId ? `?skuId=${p.variant.skuId}` : ""}`;

// product.query promotion links are ~1 KB long (risky for Telegram URL buttons): swap them for short
// s.click links in ONE link.generate call (max 50 per call). On failure the original links are kept.
export async function shortenLinks(products, deps = {}) {
  deps = { ...deps, env: deps.env ?? process.env };
  if (isMockMode(deps.env)) return products;
  const targets = products.filter((p) => p.product_id && p.promotion_link);
  if (!targets.length) return products;
  try {
    const result = await apiCall(
      "aliexpress.affiliate.link.generate",
      { promotion_link_type: "0", source_values: targets.map(itemUrl).join(","), tracking_id: deps.env.ALI_TRACKING_ID },
      deps,
    );
    const links = result.promotion_links;
    const list = Array.isArray(links) ? links : (links?.promotion_link ?? []);
    const bySource = new Map(list.map((l) => [l.source_value, l.promotion_link]));
    return products.map((p) => (bySource.get(itemUrl(p)) ? { ...p, promotion_link: bySource.get(itemUrl(p)) } : p));
  } catch (e) {
    console.warn(`link shortening failed (${e.message}); keeping original links`);
    return products;
  }
}

export async function generateAffiliateLink(url, deps = {}) {
  const env = deps.env ?? process.env;
  if (isMockMode(env)) return `https://example.com/demo-affiliate-link?item=${encodeURIComponent(url)}`;
  const result = await apiCall(
    "aliexpress.affiliate.link.generate",
    { promotion_link_type: "0", source_values: url, tracking_id: env.ALI_TRACKING_ID },
    { ...deps, env },
  );
  const links = result.promotion_links;
  const link = (Array.isArray(links) ? links : (links?.promotion_link ?? []))[0]?.promotion_link;
  if (!link) throw new Error("AliExpress link.generate returned no link");
  return link;
}

// Returns null when the text link isn't a resolvable AliExpress product; throws on API errors.
export async function convertToAffiliate(url, deps = {}) {
  const clean = await resolveProductUrl(url, deps);
  return clean ? generateAffiliateLink(clean, deps) : null;
}

// Demo data covering every display branch. avgStars/reviewCount are optional and absent from the Affiliate API;
// their future source is the DS API, so real products leave them undefined.
function mockProducts(query) {
  // The title starts with the searched keywords (what the AI sent), so a demo search looks related to the request.
  const rows = [
    // title suffix, sale, original, evaluate_rate, lastest_volume, avgStars, reviewCount
    ["דגם Pro עם סוללה ל-30 שעות", "39.90", "69.90", "97.8%", "5230", 4.8, 1234], // 43% badge
    ["דגם Lite קומפקטי", "24.50", undefined, "95.1%", "1874"], // no original, % only
    ["דגם בסיסי", "12.90", "15.90", "85.0%", "990"], // <90%: filtered out
    ["דגם Max 2025 במארז מתנה", "59.00", "399.00", "93.4%", "642", 4.6, 87], // ≥80% "discount": no badge
    ["דגם Mini", "18.30", "21.00", undefined, "87"], // no rating at all, exact sold
    ["דגם Plus מאלומיניום", "31.70", "33.00", "98.0%", "155", 4.9, 12034], // <5%: no badge
    ["דגם Eco", "12.00", undefined, undefined, undefined], // neither rating nor sold
  ];
  return rows.map(([suffix, sale, original, rate, volume, avgStars, reviewCount], i) => ({
    product_id: `demo${i + 1}`,
    product_title: `${query} ${suffix}`,
    product_main_image_url: `https://placehold.co/600x600.png?text=Demo+${i + 1}`,
    target_sale_price: sale,
    target_original_price: original,
    target_sale_price_currency: "ILS",
    evaluate_rate: rate,
    lastest_volume: volume,
    avgStars,
    reviewCount,
    promotion_link: `https://example.com/demo-link/${i + 1}`,
  }));
}
