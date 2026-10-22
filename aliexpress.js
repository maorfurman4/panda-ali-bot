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
const PAGE_SIZE = 20; // more than 5, so the <90% feedback filter still leaves enough results

export const isMockMode = (env = process.env) => !env.ALI_APP_KEY || !env.ALI_APP_SECRET || !env.ALI_TRACKING_ID;

// Sort params by key, concatenate key+value, HMAC-SHA256 with the app secret, uppercase hex.
export function sign(params, secret) {
  const base = Object.keys(params).sort().map((k) => k + params[k]).join("");
  return createHmac("sha256", secret).update(base, "utf8").digest("hex").toUpperCase();
}

const sleepMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const isTransient = (status, err) => status === 401 || /ApiCallLimit|frequency exceeds/i.test(`${err.code} ${err.msg ?? err.message}`);

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
  if (out.err) throw new Error(`AliExpress ${method} failed: ${out.err.code}: ${out.err.msg ?? out.err.message ?? ""}`);
  return out.result;
}

export async function searchProducts(query, deps = {}) {
  const env = deps.env ?? process.env;
  if (isMockMode(env)) return mockProducts(query);
  const result = await apiCall(
    "aliexpress.affiliate.product.query",
    {
      keywords: query,
      tracking_id: env.ALI_TRACKING_ID,
      ship_to_country: "IL",
      target_currency: "ILS",
      target_language: "HE",
      sort: "LAST_VOLUME_DESC",
      page_size: String(PAGE_SIZE),
    },
    { ...deps, env },
  );
  const products = result.products;
  return Array.isArray(products) ? products : (products?.product ?? []);
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

function mockProducts(query) {
  const rows = [
    ["39.90", "97.8%", "5230"],
    ["24.50", "95.1%", "1874"],
    ["12.90", "85.0%", "990"], // below 90% on purpose: the filter should hide it
    ["59.00", "93.4%", "642"],
    ["18.30", "", "310"],
    ["31.70", "91.0%", "155"],
  ];
  return rows.map(([price, rate, volume], i) => ({
    product_id: `demo${i + 1}`,
    product_title: `[דמו] ${query} – דגם ${i + 1}`,
    target_sale_price: price,
    target_sale_price_currency: "ILS",
    evaluate_rate: rate,
    lastest_volume: volume,
    promotion_link: `https://example.com/demo-link/${i + 1}`,
  }));
}
