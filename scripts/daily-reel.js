// The morning style-3 Reel (by .github/workflows/daily-reel.yml): finds a hit product with the seller's own video, has
// Gemini watch it and write the Hebrew script (free tier), speaks it (Gemini TTS, free), times the words (Whisper, ~0.2¢),
// renders the video (reels/style3.py) with the next house track, and sends the owner, through the Reels approve bot:
// (1) the video with its post text and the publish / skip buttons, (2) what is said, in order, (3) the private message for
// commenters. A press on "publish" is handled by the server (reels.js), as for any preview.
// Nothing good today, or a script that fails the checks twice: a short note instead of a video.
// Env: REELS_BOT_TOKEN, DEALS_OWNER_ID (or ADMIN_USER_ID), GEMINI_API_KEY, OPENAI_API_KEY (Whisper), ALI_APP_KEY,
// ALI_APP_SECRET, ALI_TRACKING_ID. REELS_STATE (reels-state.json), REEL_PRODUCT: this product id instead of the pick;
// REEL_DRY=true: build, send nothing, keep the state; REEL_OUT: work dir.
// Usage: node scripts/daily-reel.js
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Api, InputFile } from "grammy";
import { apiCall, searchProducts, generateAffiliateLink } from "../aliexpress.js";
import { previewExtra } from "../reels.js";
import {
  pickProduct, queriesFor, weakness, writeScript, sentences, speak, wordTimes, sentenceEnds, timingProblems, nextTrack, markUsed,
  captionList, sectionsOf, sentToday, REELS_PER_DAY, VIDEO_HOST, MIN_VIDEO_S, MIN_PICTURE_H, wordTimeline, lookFor, PRICE_ASKS,
} from "../reel-style3.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const env = process.env;
const dry = env.REEL_DRY === "true";
const auto = env.REEL_AUTO === "true"; // a morning start (cron-job.org or GitHub's schedule): at most REELS_PER_DAY a day
const owner = env.DEALS_OWNER_ID || env.ADMIN_USER_ID;
const api = env.REELS_BOT_TOKEN ? new Api(env.REELS_BOT_TOKEN) : null;
const out = env.REEL_OUT || join(ROOT, "reel-out");
const readJson = (f) => { try { return JSON.parse(readFileSync(f, "utf8")); } catch { return {}; } };
const stateFile = env.REELS_STATE || "reels-state.json";
const state = readJson(stateFile);
if (!dry && (!api || !owner)) throw new Error("sending needs REELS_BOT_TOKEN and DEALS_OWNER_ID (or REEL_DRY=true)");
if (!env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is missing");
const note = async (text) => (console.log(`note: ${text}`), dry ? null : api.sendMessage(owner, `🎬 סרטון הבוקר: ${text}`));
const log = (l) => console.log(`  ${l}`);
const ff = (args) => execFileSync("ffmpeg", ["-nostdin", "-hide_banner", "-loglevel", "error", "-y", ...args]);
const duration = (f) => Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).toString());

async function product() {
  if (env.REEL_PRODUCT) {
    const r = await apiCall("aliexpress.affiliate.productdetail.get", { product_ids: env.REEL_PRODUCT, target_currency: "ILS", target_language: "EN", country: "IL", tracking_id: env.ALI_TRACKING_ID });
    const p = [].concat(r.products?.product ?? [])[0];
    if (!p) throw new Error(`product ${env.REEL_PRODUCT} not found`);
    log(`forced product: ${weakness(p) ?? "qualifies"}`);
    return p;
  }
  const day = Math.floor(Date.now() / 864e5);
  return pickProduct(queriesFor(day), { used: (state.used ?? []).map((u) => u.id), search: async (q) => (await Promise.all([1, 2].map((page) => searchProducts(q, { lang: "EN", shorten: false, page }).catch(() => [])))).flat(), log,
    accept: async (p) => {
      const s = await sellerVideo(p);
      return s.dur < MIN_VIDEO_S ? `seller video only ${s.dur.toFixed(1)} s` : s.probe.area[3] < MIN_PICTURE_H ? `seller video too small (${s.probe.area[2]}x${s.probe.area[3]})` : true;
    } });
}

// The seller's video, downloaded and measured once per product (picture area inside black bars, its own cuts).
const videos = new Map();
async function sellerVideo(p) {
  const id = String(p.product_id);
  if (videos.has(id)) return videos.get(id);
  if (!String(p.product_video_url ?? "").startsWith(VIDEO_HOST)) throw new Error("no seller video");
  const dir = join(out, id);
  mkdirSync(dir, { recursive: true });
  const video = join(dir, "seller.mp4");
  const res = await fetch(p.product_video_url, { headers: { "user-agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`seller video: HTTP ${res.status}`);
  writeFileSync(video, Buffer.from(await res.arrayBuffer()));
  const s = { video, dur: duration(video), probe: JSON.parse(execFileSync("python3", [join(ROOT, "reels", "style3.py"), "--probe", video]).toString()) };
  videos.set(id, s);
  return s;
}

// 2 frames a second (at most 90), 384 px wide: what Gemini watches
function frames(video, dir, dur) {
  mkdirSync(dir, { recursive: true });
  const fps = Math.min(2, 90 / dur);
  ff(["-i", video, "-vf", `fps=${fps},scale=384:-2`, "-q:v", "4", join(dir, "f%03d.jpg")]);
  return readdirSync(dir).filter((f) => f.endsWith(".jpg")).sort().map((f, i) => ({ t: i / fps, jpeg: readFileSync(join(dir, f)) }));
}

async function main() {
  if (auto && !env.REEL_PRODUCT && !dry && sentToday(state) >= REELS_PER_DAY) return console.log(`today's ${REELS_PER_DAY} automatic reels already reached the owner: nothing to do`);
  const p = await product();
  if (!p) return note("לא מצאתי היום מוצר שעבר את התנאים (סרטון של המוכר באיכות טובה, 1,000+ נמכרו, 95%+ ביקורות חיוביות). אין סרטון היום.");
  const id = String(p.product_id);
  console.log(`product ${id}: ${p.product_title}\n  ₪${p.target_sale_price}, sold ${p.lastest_volume}, ${p.evaluate_rate} positive`);
  const work = join(out, id);
  mkdirSync(work, { recursive: true });
  writeFileSync(join(work, "product.json"), JSON.stringify(p, null, 1));

  if (!String(p.product_video_url ?? "").startsWith(VIDEO_HOST)) return note(`למוצר ${id} אין סרטון של המוכר.`);
  const { video, dur, probe } = await sellerVideo(p);
  if (dur < MIN_VIDEO_S) return note(`הסרטון של המוכר ל${id} קצר מדי (${dur.toFixed(1)} שניות). אין סרטון היום.`);

  // the seller video's own cuts: a shot never runs across one (it showed the next, unrelated shot, owner 2026-11-15)
  const sections = sectionsOf(probe.cuts, dur);
  const fr = frames(video, join(work, "frames"), dur);
  console.log(`seller video ${dur.toFixed(1)} s, picture ${probe.area}, cuts ${probe.cuts.join(", ") || "none"}; ${fr.length} frames to Gemini`);
  let written, heard, ends, voice, feedback = "";
  for (let round = 1; round <= 2; round++) { // a take that breaks the timing rules: the script is written once more
    written = await writeScript(p, dur, fr, { log, sections, feedback, priceAsk: PRICE_ASKS[(state.used ?? []).length % PRICE_ASKS.length], onAnswer: (n, raw) => writeFileSync(join(work, `script-r${round}-try${n}.json`), JSON.stringify(raw, null, 1)) });
    if (written.errors) return note(written.errors.every((e) => e.startsWith("AI call failed"))
      ? `Gemini לא ענה הבוקר (עומס אצל גוגל, ניסיתי 3 מודלים), אז אין סרטון. אפשר ללחוץ Run workflow ב-GitHub מאוחר יותר. (${written.errors[0].slice(0, 160)})`
      : `התסריט ש-Gemini כתב ל${p.product_title.slice(0, 50)} לא עבר את הבדיקות, אז לא בניתי סרטון. (${written.errors.slice(0, 3).join("; ")})`);
    const says = sentences(written.script);
    voice = join(work, "voice.wav");
    writeFileSync(voice, await speak(says.join(" "), { log }));
    heard = await wordTimes(readFileSync(voice));
    writeFileSync(join(work, "words.json"), JSON.stringify(heard));
    ends = sentenceEnds(says, heard);
    const sc0 = written.script;
    const problems = timingProblems(ends, heard, says, [sc0.hook, ...sc0.scenes, sc0.proof, sc0.end]);
    console.log(`round ${round}: ${says.join(" ")}\n  heard: ${heard.map((w) => w.word).join(" ")}\n  ends ${JSON.stringify(ends)} ${problems.join("; ") || "timing ok"}`);
    if (!problems.length) break;
    feedback = problems.slice(0, 4).join("; ");
    if (round === 2) return note(`הקריינות ל${p.product_title.slice(0, 50)} לא עמדה בכללי הזמנים פעמיים (${problems.slice(0, 2).join("; ")}). אין סרטון היום.`);
  }

  const sc = written.script;
  const beats = JSON.parse(readFileSync(join(ROOT, "reels", "music", "beats.json"), "utf8"));
  const track = nextTrack(state, Object.keys(beats));
  const spec = {
    video, voice, words: heard, ends, keep: sc.keep,
    shots: [sc.hook, ...sc.scenes, sc.proof, sc.end].map(({ a, b, half, sec, pos }) => ({ a, b, sec, half: half ?? "full", pos })),
    // the bold look (owner's 14 answers, 2026-11-16): word-by-word captions, a giant opening word, the price counting down
    ...lookFor(state, sc, wordTimeline(sentences(sc), heard), p),
    pills: { hook: sc.hook.pill, scenes: sc.scenes.map((s) => ({ text: s.pill, step: s.step })) },
    proof: { price: p.target_sale_price, old_price: p.target_original_price },
    track: { file: join(ROOT, "reels", "music", track), bpm: beats[track].bpm, start: beats[track].start },
  };
  writeFileSync(join(work, "spec.json"), JSON.stringify(spec, null, 1));
  const reel = join(out, `reel-${id}.mp4`);
  execFileSync("python3", [join(ROOT, "reels", "style3.py"), join(work, "spec.json"), reel], { stdio: "inherit" });

  const link = await generateAffiliateLink(`https://www.aliexpress.com/item/${id}.html`);
  const captions = `${captionList(sc, p)}\n\n🔗 קישור שותפים למוצר (אם מישהו שואל): ${link}`;
  writeFileSync(join(out, "post.txt"), written.post);
  writeFileSync(join(out, "captions.txt"), captions);
  console.log(`track ${track}\n\n${captions}\n\n--- post ---\n${written.post}`);
  if (dry) return console.log("dry run: nothing sent, state unchanged");

  await api.sendDocument(owner, new InputFile(reel, `reel-${id}.mp4`), previewExtra(written.post));
  await api.sendMessage(owner, captions);
  writeFileSync(stateFile, JSON.stringify(markUsed(state, id, track, Date.now(), auto))); // only after the owner has it
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, "sent=true\n");
  console.log(`sent to the owner; reel state saved (${(state.used ?? []).length + 1} products used)`);
}

try {
  await main();
} catch (e) {
  console.error(e);
  await note(`נכשל: ${String(e.message).slice(0, 300)}`).catch(() => {});
  process.exit(1);
}
