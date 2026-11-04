// Builds one JPEG collage of the result images with rank badges (gold/silver/bronze/blue), so a search
// shows every product's picture in a single Telegram photo. Returns null when no image could be loaded.
import sharp from "sharp";

const TILE = 400;
const FETCH_TIMEOUT_MS = 5000;
const BADGE_COLORS = ["#F5B700", "#A8A9AD", "#CD7F32", "#2F6FED", "#2F6FED"];

// shortcut: badge digits use the system sans-serif font; if the server has no fonts the colored circle still shows the rank.
const badge = (n, color) =>
  Buffer.from(
    `<svg width="84" height="84" xmlns="http://www.w3.org/2000/svg">` +
      `<circle cx="42" cy="42" r="36" fill="${color}" stroke="#ffffff" stroke-width="5"/>` +
      `<text x="42" y="56" font-family="sans-serif" font-size="40" font-weight="bold" fill="#ffffff" text-anchor="middle">${n}</text>` +
      `</svg>`,
  );

// 64-bit difference hash of a product photo (small 220px thumbnail), or null. Listings of one product by different
// sellers usually reuse the same photo: distance 0, while different products measured ≥ 24 (UGG boots, 2026-10-25).
export async function photoHash(url, { fetch = globalThis.fetch } = {}) {
  if (!/^https:\/\//i.test(url ?? "")) return null;
  try {
    const res = await fetch(`${url}_220x220.jpg`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return null;
    const px = await sharp(Buffer.from(await res.arrayBuffer())).grayscale().resize(9, 8, { fit: "fill" }).raw().toBuffer();
    let bits = "";
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += px[y * 9 + x] > px[y * 9 + x + 1] ? "1" : "0";
    return bits;
  } catch {
    return null;
  }
}

async function loadTile(url, fetch) {
  if (!/^https:\/\//i.test(url ?? "")) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) return null;
    return await sharp(Buffer.from(await res.arrayBuffer()))
      // Light gray, not white: a white item on a see-through photo looked like an empty tile (owner's test, 2026-11-04).
      .resize(TILE, TILE, { fit: "contain", background: "#f2f2f2" })
      .flatten({ background: "#f2f2f2" })
      .png()
      .toBuffer();
  } catch {
    return null;
  }
}

// badges: false for one product's own photos (the deals channel), where rank numbers would mean nothing.
export async function makeCollage(urls, { fetch = globalThis.fetch, badges = true } = {}) {
  if (!urls.length) return null;
  const tiles = await Promise.all(urls.map((u) => loadTile(u, fetch)));
  if (!tiles.some(Boolean)) return null;

  const cols = urls.length === 4 ? 2 : Math.min(urls.length, 3);
  const rows = Math.ceil(urls.length / cols);
  const layers = [];
  // Hebrew reads right to left, so rank 1 sits in the top-right corner.
  tiles.forEach((tile, i) => {
    const left = (cols - 1 - (i % cols)) * TILE;
    const top = Math.floor(i / cols) * TILE;
    if (tile) layers.push({ input: tile, left, top });
    if (badges) layers.push({ input: badge(i + 1, BADGE_COLORS[i]), left: left + TILE - 96, top: top + 12 });
  });

  return sharp({ create: { width: cols * TILE, height: rows * TILE, channels: 3, background: "#ffffff" } })
    .composite(layers)
    .jpeg({ quality: 82 })
    .toBuffer();
}
