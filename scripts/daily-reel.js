// The morning style-2 Reel (by .github/workflows/daily-reel.yml): picks a product the deals bot already posted, writes the
// captions (one AI call), renders the video (reels/style2.py) with the next house track, and sends the owner, through the
// Reels approve bot: (1) the video with its post text and the publish / skip buttons, (2) every caption in order, (3) the
// private message for commenters. A press on "publish" is handled by the server (reels.js), as for any preview.
// Nothing good today, or captions that fail the checks twice: a short note instead of a video.
// Env: REELS_BOT_TOKEN, DEALS_OWNER_ID (or ADMIN_USER_ID), OPENAI_API_KEY (ANTHROPIC_API_KEY: backup), ALI_APP_KEY,
// ALI_APP_SECRET, ALI_TRACKING_ID. DEALS_STATE (deals-state.json, read only), REELS_STATE (reels-state.json),
// REEL_PRODUCT: this product id instead of the pick; REEL_DRY=true: build, send nothing, keep the state; REEL_OUT: work dir.
// Usage: node scripts/daily-reel.js
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Api, InputFile } from "grammy";
import { apiCall, skuDetails, generateAffiliateLink } from "../aliexpress.js";
import { aiSpend } from "../query.js";
import { previewExtra } from "../reels.js";
import { pickProduct, photoChoices, writeSpec, nextTrack, markUsed, captionList, dmText } from "../reel-style2.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const env = process.env;
const dry = env.REEL_DRY === "true";
const owner = env.DEALS_OWNER_ID || env.ADMIN_USER_ID;
const api = env.REELS_BOT_TOKEN ? new Api(env.REELS_BOT_TOKEN) : null;
const out = env.REEL_OUT || join(ROOT, "reel-out");
const readJson = (f) => { try { return JSON.parse(readFileSync(f, "utf8")); } catch { return {}; } };
const deals = readJson(env.DEALS_STATE || "deals-state.json");
const stateFile = env.REELS_STATE || "reels-state.json";
const state = readJson(stateFile);
if (!dry && (!api || !owner)) throw new Error("sending needs REELS_BOT_TOKEN and DEALS_OWNER_ID (or REEL_DRY=true)");
const note = async (text) => (console.log(`note: ${text}`), dry ? null : api.sendMessage(owner, `🎬 סרטון הבוקר (סגנון 2): ${text}`));

// The public review feed, buyer photos only, 2 pages (same source as fetchReviews in aliexpress.js).
const FEEDBACK = "https://feedback.aliexpress.com/pc/searchEvaluation.do";
async function photoReviews(id) {
  let stats = null;
  const reviews = [];
  for (const page of [1, 2]) {
    const url = `${FEEDBACK}?productId=${id}&lang=en_US&country=IL&page=${page}&pageSize=20&filter=image&sort=complex_default`;
    const d = await fetch(url, { headers: { "user-agent": "Mozilla/5.0", referer: "https://www.aliexpress.com/" }, signal: AbortSignal.timeout(8000) }).then((r) => r.json()).catch(() => null);
    stats ??= d?.data?.productEvaluationStatistic ?? null;
    for (const r of d?.data?.evaViewList ?? [])
      reviews.push({ stars: Number(r.buyerEval) / 20, country: String(r.buyerCountry ?? ""), date: r.evalDate, text: String(r.buyerTranslationFeedback || r.buyerFeedback || "").trim(), photos: (r.images ?? []).filter((u) => /^https:\/\//.test(u ?? "")) });
  }
  // The number AliExpress shows: every star count added up (same rule as addStars in aliexpress.js).
  const ratings = stats ? ["five", "four", "three", "two", "one"].reduce((n, k) => n + (Number(stats[`${k}StarNum`]) || 0), 0) : null;
  return { stats, ratings, reviews };
}
const details = async (ids) => {
  const r = await apiCall("aliexpress.affiliate.productdetail.get", { product_ids: ids.join(","), target_currency: "ILS", target_language: "EN", country: "IL", tracking_id: env.ALI_TRACKING_ID });
  return [].concat(r.products?.product ?? []);
};

// Photos arrive as WebP whatever the extension: saved as PNG so ffmpeg and Chrome read them alike.
async function savePhoto(dir, { id, url }) {
  const png = join(dir, `${id}.png`), raw = join(dir, `${id}.src`);
  const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(25000) });
  if (!res.ok) throw new Error(`photo ${id}: HTTP ${res.status}`);
  writeFileSync(raw, Buffer.from(await res.arrayBuffer()));
  execFileSync("ffmpeg", ["-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i", raw, "-frames:v", "1", png]);
  rmSync(raw);
}

async function main() {
  const posted = [...(deals.posted ?? [])].reverse(); // newest first
  const ids = env.REEL_PRODUCT ? [env.REEL_PRODUCT] : posted;
  console.log(env.REEL_PRODUCT ? `forced product ${env.REEL_PRODUCT}` : `${posted.length} posted products in the deals state`);
  const picked = await pickProduct(ids, { used: env.REEL_PRODUCT ? [] : (state.used ?? []).map((u) => u.id), details, reviews: photoReviews, log: (l) => console.log(`  skip ${l}`) });
  if (!picked) return note(ids.length ? "לא מצאתי היום מוצר שעבר את התנאים (10,000+ נמכרו, 4.8 כוכבים, 3 ביקורות 5 כוכבים עם תמונות). אין סרטון היום." : "לא מצאתי את רשימת המוצרים של ערוץ הדילים. אין סרטון היום.");
  const id = String(picked.product.product_id);
  const { promotion_link, ...product } = picked.product;
  const variants = (await skuDetails([id]).catch(() => new Map())).get(id) ?? [];
  const data = { fetchedAt: new Date().toISOString(), product, variants, stats: picked.stats, ratings: picked.ratings, reviews: picked.reviews };
  console.log(`product ${id}: ${product.product_title}\n  ₪${product.target_sale_price} (was ₪${product.target_original_price}), sold ${product.lastest_volume}, ${data.stats?.evarageStar}★ ${data.ratings} ratings, ${data.reviews.length} photo reviews, ${variants.length} variants`);

  const work = join(out, id);
  mkdirSync(join(work, "img"), { recursive: true });
  writeFileSync(join(work, "data.json"), JSON.stringify(data, null, 1));
  const choices = photoChoices(data);
  await Promise.all(choices.photos.map((p) => savePhoto(join(work, "img"), p)));

  const cost = { usd: 0 };
  const written = await aiSpend.run(cost, () => writeSpec(data, choices, { log: console.log, onAnswer: (n, raw) => writeFileSync(join(work, `ai-try${n}.json`), JSON.stringify(raw, null, 1)) }));
  console.log(`AI: ${written.tries} ${written.tries === 1 ? "try" : "tries"}, $${cost.usd.toFixed(4)} (${(cost.usd * 100).toFixed(2)}¢) ${JSON.stringify(cost.parts ?? {})}`);
  if (written.errors) return note(`הכיתובים שה-AI כתב ל${product.product_title.slice(0, 60)} לא עברו את הבדיקות פעמיים, אז לא בניתי סרטון. (${written.errors.slice(0, 3).join("; ")})`);

  const beats = JSON.parse(readFileSync(join(ROOT, "reels", "music", "beats.json"), "utf8"));
  const track = nextTrack(state, Object.keys(beats));
  const spec = { ...written.spec, track: { file: track, bpm: beats[track].bpm, start: beats[track].start } };
  writeFileSync(join(work, "spec.json"), JSON.stringify(spec, null, 1));
  const video = join(out, `reel-${id}.mp4`);
  execFileSync("python3", [join(ROOT, "reels", "style2.py"), work, video], { stdio: "inherit" });

  const link = await generateAffiliateLink(`https://www.aliexpress.com/item/${id}.html`);
  const captions = captionList(spec, data), dm = dmText(written.dmName, link);
  writeFileSync(join(out, "post.txt"), written.post);
  writeFileSync(join(out, "captions.txt"), captions);
  writeFileSync(join(out, "dm.txt"), dm);
  console.log(`track ${track}\n\n${captions}\n\n--- post ---\n${written.post}\n\n--- dm ---\n${dm}`);
  if (dry) return console.log("dry run: nothing sent, state unchanged");

  await api.sendDocument(owner, new InputFile(video, `reel-${id}.mp4`), previewExtra(written.post));
  await api.sendMessage(owner, captions);
  await api.sendMessage(owner, dm, { link_preview_options: { is_disabled: true } });
  writeFileSync(stateFile, JSON.stringify(markUsed(state, id, track))); // only after the owner has it
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, "sent=true\n"); // the workflow saves the reel state only then
  console.log(`sent to the owner; reel state saved (${(state.used ?? []).length + 1} products used)`);
}

try {
  await main();
} catch (e) {
  console.error(e);
  await note(`נכשל: ${String(e.message).slice(0, 300)}`).catch(() => {});
  process.exit(1);
}
