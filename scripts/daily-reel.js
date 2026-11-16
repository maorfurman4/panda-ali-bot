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
  captionList, dmText, sectionsOf, sentToday, VIDEO_HOST, MIN_VIDEO_S,
} from "../reel-style3.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const env = process.env;
const dry = env.REEL_DRY === "true";
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
  return pickProduct(queriesFor(day), { used: (state.used ?? []).map((u) => u.id), search: (q) => searchProducts(q, { lang: "EN", shorten: false }), log });
}

// 2 frames a second (at most 90), 384 px wide: what Gemini watches
function frames(video, dir, dur) {
  mkdirSync(dir, { recursive: true });
  const fps = Math.min(2, 90 / dur);
  ff(["-i", video, "-vf", `fps=${fps},scale=384:-2`, "-q:v", "4", join(dir, "f%03d.jpg")]);
  return readdirSync(dir).filter((f) => f.endsWith(".jpg")).sort().map((f, i) => ({ t: i / fps, jpeg: readFileSync(join(dir, f)) }));
}

async function main() {
  if (!env.REEL_PRODUCT && !dry && sentToday(state)) return console.log("today's reel already reached the owner: nothing to do");
  const p = await product();
  if (!p) return note("לא מצאתי היום מוצר שעבר את התנאים (סרטון של המוכר, 10,000+ נמכרו, 95%+ ביקורות חיוביות). אין סרטון היום.");
  const id = String(p.product_id);
  console.log(`product ${id}: ${p.product_title}\n  ₪${p.target_sale_price}, sold ${p.lastest_volume}, ${p.evaluate_rate} positive`);
  const work = join(out, id);
  mkdirSync(work, { recursive: true });
  writeFileSync(join(work, "product.json"), JSON.stringify(p, null, 1));

  if (!String(p.product_video_url ?? "").startsWith(VIDEO_HOST)) return note(`למוצר ${id} אין סרטון של המוכר.`);
  const video = join(work, "seller.mp4");
  const res = await fetch(p.product_video_url, { signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`seller video: HTTP ${res.status}`);
  writeFileSync(video, Buffer.from(await res.arrayBuffer()));
  const dur = duration(video);
  if (dur < MIN_VIDEO_S) return note(`הסרטון של המוכר ל${id} קצר מדי (${dur.toFixed(1)} שניות). אין סרטון היום.`);

  // the seller video's own cuts: a shot never runs across one (it showed the next, unrelated shot, owner 2026-11-15)
  const probe = JSON.parse(execFileSync("python3", [join(ROOT, "reels", "style3.py"), "--probe", video]).toString());
  const sections = sectionsOf(probe.cuts, dur);
  const fr = frames(video, join(work, "frames"), dur);
  console.log(`seller video ${dur.toFixed(1)} s, picture ${probe.area}, cuts ${probe.cuts.join(", ") || "none"}; ${fr.length} frames to Gemini`);
  let written, heard, ends, voice, feedback = "";
  for (let round = 1; round <= 2; round++) { // a take that breaks the timing rules: the script is written once more
    written = await writeScript(p, dur, fr, { log, sections, feedback, onAnswer: (n, raw) => writeFileSync(join(work, `script-r${round}-try${n}.json`), JSON.stringify(raw, null, 1)) });
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
    shots: [sc.hook, ...sc.scenes, sc.proof, sc.end].map(({ a, b, half, sec }) => ({ a, b, sec, half: half ?? "full" })),
    pills: { hook: sc.hook.pill, scenes: sc.scenes.map((s) => ({ text: s.pill, step: s.step })) },
    proof: { sold: Number(p.lastest_volume), rate: `${Math.round(parseFloat(p.evaluate_rate))}%`, price: p.target_sale_price },
    track: { file: join(ROOT, "reels", "music", track), bpm: beats[track].bpm, start: beats[track].start },
  };
  writeFileSync(join(work, "spec.json"), JSON.stringify(spec, null, 1));
  const reel = join(out, `reel-${id}.mp4`);
  execFileSync("python3", [join(ROOT, "reels", "style3.py"), join(work, "spec.json"), reel], { stdio: "inherit" });

  const link = await generateAffiliateLink(`https://www.aliexpress.com/item/${id}.html`);
  const captions = captionList(sc, p), dm = dmText(written.dmName, link);
  writeFileSync(join(out, "post.txt"), written.post);
  writeFileSync(join(out, "captions.txt"), captions);
  writeFileSync(join(out, "dm.txt"), dm);
  console.log(`track ${track}\n\n${captions}\n\n--- post ---\n${written.post}\n\n--- dm ---\n${dm}`);
  if (dry) return console.log("dry run: nothing sent, state unchanged");

  await api.sendDocument(owner, new InputFile(reel, `reel-${id}.mp4`), previewExtra(written.post));
  await api.sendMessage(owner, captions);
  await api.sendMessage(owner, dm, { link_preview_options: { is_disabled: true } });
  writeFileSync(stateFile, JSON.stringify(markUsed(state, id, track))); // only after the owner has it
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
