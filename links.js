// AliExpress link detection and normalization. Only real AliExpress hosts are trusted (no look-alikes).
const ALI_DOMAINS = ["aliexpress.com", "aliexpress.us"];
const FETCH_TIMEOUT_MS = 8000;
const MAX_HOPS = 5;

export function isAliExpressHost(hostname) {
  const h = hostname.toLowerCase();
  return ALI_DOMAINS.some((d) => h === d || h.endsWith(`.${d}`));
}

function parseUrl(s) {
  try {
    return new URL(s);
  } catch {
    return null;
  }
}

export function findAliExpressUrl(text) {
  for (const raw of text.match(/https?:\/\/[^\s<>"']+/gi) ?? []) {
    const candidate = raw.replace(/[).,!?;:\]]+$/, "");
    const url = parseUrl(candidate);
    if (url && isAliExpressHost(url.hostname)) return candidate;
  }
  return null;
}

export function extractProductId(url) {
  return parseUrl(url)?.pathname.match(/\/(?:item|i)\/(\d{6,})\.html/)?.[1] ?? null;
}

// Returns a clean https://www.aliexpress.com/item/{id}.html URL, following short links (a.aliexpress.com/_xxx) if needed.
// Redirects are followed by hand so a hop to a non-AliExpress host is never requested (no SSRF).
export async function resolveProductUrl(url, { fetch = globalThis.fetch } = {}) {
  const parsed = parseUrl(url);
  if (!parsed || !isAliExpressHost(parsed.hostname)) return null;
  let id = extractProductId(url);
  try {
    for (let hop = 0, current = url; !id && hop < MAX_HOPS; hop++) {
      const res = await fetch(current, { redirect: "manual", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      res.body?.cancel?.().catch(() => {}); // only the Location header matters, not the page
      const location = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
      if (!location) return null;
      const next = new URL(location, current);
      if (next.protocol !== "https:" || !isAliExpressHost(next.hostname)) return null;
      current = next.href;
      id = extractProductId(current);
    }
  } catch {
    return null;
  }
  return id ? `https://www.aliexpress.com/item/${id}.html` : null;
}
