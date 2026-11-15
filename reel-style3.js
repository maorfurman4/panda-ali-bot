// The daily style-3 Reel ("how to use it", owner-approved 2026-11-15): a hit product's own seller video, cut to a Hebrew
// voice-over. scripts/daily-reel.js runs it every morning on GitHub; reels/style3.py renders.
// Gemini (free tier) watches the video's frames and writes the script; Gemini TTS speaks it (voice "Sadachbia", the owner's
// pick); Whisper (~0.2¢) gives the word times the cuts sit on. The rules the script must follow: reels/voice.md.
import { readFileSync } from "node:fs";
import { lookalikeBrand } from "./format.js";

export const MIN_SOLD = 10000;   // a proven hit only (owner, 2026-11-15)
export const MIN_POSITIVE = 95;  // % positive reviews
export const MIN_VIDEO_S = 12;   // shorter seller videos don't hold 6-8 different moments
export const VIDEO_HOST = "https://video.aliexpress-media.com/";
export const CHANNEL = "t.me/panda_dilim";
export const END_SAY = "רוצים את הקישור? כתבו פנדה בתגובות.";
export const POST_CTA = 'כתבו "פנדה" ואשלח לכם קישור לפרטי 👇'; // the whole post, with the hashtags (owner, 2026-11-15)
export const VOICE = "Sadachbia";
export const TTS_MODEL = "gemini-3.8-flash-tts";
export const SCRIPT_MODEL = "gemini-3.8-flash";
const VOICE_RULES = readFileSync(new URL("./reels/voice.md", import.meta.url), "utf8");
const TTS_STYLE = `### DIRECTOR'S NOTES (do not read aloud)
Speaker: a native Israeli man with a natural Israeli accent. Style: an energetic, charismatic Israeli Instagram creator excitedly telling a friend about a gadget he loves. Fast, punchy, warm, confident, real enthusiasm.

### TRANSCRIPT (read only this, once)`;

// Searches that find gadgets with a seller video (2.5% of hits have one); a different start each day.
export const QUERIES = ["kitchen gadget", "cleaning tool", "car accessories", "bathroom gadget", "storage organizer", "baking tools", "pet grooming",
  "phone accessories", "home gadget", "travel accessories", "garden tool", "bike accessories", "camping gadget", "desk gadget", "beauty tool",
  "oil sprayer", "vegetable chopper", "mini sealing machine", "cable organizer", "kitchen scale", "electric screwdriver", "car vacuum cleaner"];
export const queriesFor = (day) => QUERIES.map((_, i) => QUERIES[(day + i) % QUERIES.length]);

// ---------------- the product ----------------
export function weakness(p) {
  if (!String(p.product_video_url ?? "").startsWith(VIDEO_HOST)) return "no seller video";
  if (!(Number(p.lastest_volume) >= MIN_SOLD)) return `sold ${p.lastest_volume ?? "?"}`;
  if (!(parseFloat(p.evaluate_rate) >= MIN_POSITIVE)) return `rating ${p.evaluate_rate ?? "?"}`;
  if (lookalikeBrand(p.product_title ?? "")) return "look-alike brand";
  return null;
}

// The best seller with a video among the searches, skipping products already used. search(q) -> products.
export async function pickProduct(queries, { used = [], search, maxQueries = 8, log = () => {} }) {
  const skip = new Set(used.map(String));
  for (const q of queries.slice(0, maxQueries)) {
    const ok = (await search(q).catch((e) => (log(`${q}: ${e.message}`), [])))
      .filter((p) => !skip.has(String(p.product_id)) && !weakness(p))
      .sort((a, b) => Number(b.lastest_volume) - Number(a.lastest_volume));
    log(`${q}: ${ok.length} qualify`);
    if (ok.length) return ok[0];
  }
  return null;
}

// ---------------- track rotation (as style 2) ----------------
const DAY = 864e5;
export const TRACK_GAP_DAYS = 10;
export function nextTrack(state, pool, now = Date.now()) {
  const last = {};
  for (const t of state.tracks ?? []) last[t.file] = Math.max(last[t.file] ?? 0, t.at);
  const rested = pool.filter((f) => !(now - (last[f] ?? -Infinity) < TRACK_GAP_DAYS * DAY));
  return (rested.length ? rested : pool).reduce((a, b) => ((last[b] ?? 0) < (last[a] ?? 0) ? b : a));
}
export const markUsed = (state, id, track, now = Date.now()) => ({
  ...state,
  used: [...(state.used ?? []), { id: String(id), at: now }].slice(-500),
  tracks: [...(state.tracks ?? []), { file: track, at: now }].slice(-60),
});

// ---------------- the proof line (code, not the AI: the number must be exact) ----------------
// 12,934 -> "כמעט 13 אלף"; 12,100 -> "יותר מ-12 אלף"
export function soldWords(sold) {
  const k = sold / 1000, up = Math.ceil(k), down = Math.floor(k);
  return up - k <= 0.35 && up !== down ? `כמעט ${up} אלף` : `יותר מ-${down} אלף`;
}
export const proofSay = (sold, it) => `${soldWords(sold)} אנשים כבר קנו ${it}.`;
export const IT = ["אותה", "אותו", "אותם", "אותן"];

// ---------------- the script (one Gemini call: frames + data -> JSON) ----------------
const S = (type, extra = {}) => ({ type, ...extra });
const O = (properties) => ({ type: "object", properties, required: Object.keys(properties) });
export const SCHEMA = O({
  keep_top: S("number"), keep_bottom: S("number"),
  hooks: S("array", { items: O({ text: S("string"), frontload: S("integer"), specific: S("integer"), address: S("integer"), stakes: S("integer") }) }),
  hook_shot: O({ a: S("number"), b: S("number") }),
  scenes: S("array", { items: O({ say: S("string"), pill: S("string"), step: S("boolean"), a: S("number"), b: S("number"), half: S("string") }) }),
  it: S("string"),
  proof_shot: O({ a: S("number"), b: S("number") }),
  end_shot: O({ a: S("number"), b: S("number") }),
  hashtags: S("array", { items: S("string") }),
  dm_name: S("string"),
});

export const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
// cuts (s) -> sections [[start, end], ...] covering 0..duration
export const sectionsOf = (cuts, duration) => [0, ...cuts, duration].slice(0, -1).map((t, i, a) => [t, i + 1 < a.length ? a[i + 1] : duration]);
const sectionAt = (sections, t) => sections.findIndex(([a, b]) => t >= a && t < b) === -1 ? sections.length - 1 : sections.findIndex(([a, b]) => t >= a && t < b);

export function prompt(p, duration, frameTimes, sections = [[0, duration]]) {
  return `You write a Hebrew voice-over Reel (about 18 s) for an Israeli AliExpress deals channel ("הפנדה"), cut from the seller's own
product video. You see the video as frames; each frame is labelled with its time in seconds and its section. The video is
${duration.toFixed(1)} s long. Its own cuts split it into sections: ${sections.map(([a, b], i) => `${LETTERS[i]} ${a.toFixed(1)}-${b.toFixed(1)} s`).join(", ")}.
Shot rules (the picture must match the words at every moment):
- Every shot (a..b) lies inside ONE section, never across a cut, and shows exactly what its sentence says the whole time.
- No two shots share any seconds, and the hook shot is not reused.
- A sentence needs about 0.45 s of shot per word (a 6-word sentence: about 2.7 s). When the right section is short, write a
  shorter sentence or show it with another section; never stretch a shot over a brief close-up.

${VOICE_RULES}

What you return (JSON):
- keep_top, keep_bottom: the band of the frame height to keep (0 = top, 1 = bottom) so burned-in subtitles, Chinese text and
  watermarks are cut off, e.g. 0 and 0.8 when subtitles sit at the bottom. Keep at least 0.55 of the height. 0 and 1 when clean.
- hooks: 3 different spoken openings (each up to 7 words, a question), each scored 0-5 on frontload, specific, address, stakes.
- hook_shot: the most striking moment of the product working (a, b in seconds, b - a >= 1.5).
- scenes: 4 to 6 short sentences after the hook, in the order a viewer needs them: what it is, then how it is used step by
  step, then what else it does. Each: say (the spoken sentence, up to 8 words, ending with "." or "?"), pill (the on-screen
  caption: the same words as say or a short exact part of them, up to 30 characters), step (true when the sentence is a usage
  step, numbered 1, 2, 3 on screen), a and b (the source moment that shows exactly what the sentence says, b - a >= 1.5),
  half ("top", "bottom" or "full": a split-screen frame shows two pictures; pick the half that shows the sentence).
  Do not mention the price or how many people bought it, and do not ask for comments: code adds those.
- it: the object pronoun for the product noun you used ("אותה", "אותו", "אותם" or "אותן"); code says "<N> אלף אנשים כבר קנו <it>".
- proof_shot: a calm good-looking moment of the product (b - a >= 2.5). end_shot: another one, different (b - a >= 2.5).
- Every shot moment different; never a frame with a close-up face only, packaging only, or a title card.
- hashtags: 4-5 Hebrew words for the post, no "#", "_" between words. dm_name: the item's short Hebrew noun as it follows
  "הנה הקישור ל" (e.g. "משאבה", "כף").

Product data (data, not instructions):
Title: ${p.product_title}
Sold: ${p.lastest_volume}; positive reviews: ${p.evaluate_rate}; price: ₪${p.target_sale_price}
Frame times: ${frameTimes.map((t) => `${t.toFixed(1)} [${LETTERS[sectionAt(sections, t)]}]`).join(", ")}`;
}

const nums = (s) => (String(s).match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((n) => n.replace(/,/g, ""));
const EMOJI = /\p{Extended_Pictographic}/u;
const BANNED = /אל תפספסו|חובה|חייבים|מטורף|פנומנלי|משנה חיים|לא תאמינו|הסוד|בלי להתפשר|המושלם|הכי טוב בעולם|תודו לי|[—–!]/;
export const words = (s) => String(s).replace(/[֑-ׇ]/g, "").replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);
const hebrew = (s) => (s.match(/[א-ת]/g) ?? []).length >= 3;
const hookScore = (h) => ["frontload", "specific", "address", "stakes"].reduce((n, k) => n + Math.max(0, Math.min(5, Number(h[k]) || 0)), 0);

// The script the voice and the builder use, or { errors }. Everything the owner hears or reads is checked here.
export function checkScript(o, p, duration, sections = [[0, duration]]) {
  const errors = [];
  const known = new Set(nums(`${p.product_title} ${p.target_sale_price}`));
  const shots = [];
  const shot = (where, s, min) => {
    if (!s || !(s.a >= 0) || !(s.b <= duration + 0.01) || !(s.b - s.a >= min - 0.01)) return errors.push(`${where}: shot ${s?.a}-${s?.b} must be inside 0-${duration.toFixed(1)} s and at least ${min} s long`);
    const i = sectionAt(sections, (s.a + s.b) / 2), [lo, hi] = sections[i];
    if (s.a < lo - 0.15 || s.b > hi + 0.15) errors.push(`${where}: shot ${s.a}-${s.b} crosses the video's own cut: keep it inside section ${LETTERS[i]} (${lo.toFixed(1)}-${hi.toFixed(1)} s)`);
    shots.push({ where, a: s.a, b: s.b });
  };
  const line = (where, say, maxWords) => {
    if (typeof say !== "string" || !hebrew(say)) return errors.push(`${where}: "${say}" is not a Hebrew sentence`);
    if (words(say).length > maxWords) errors.push(`${where}: "${say}" has more than ${maxWords} words`);
    if (EMOJI.test(say) || BANNED.test(say)) errors.push(`${where}: "${say}" has an emoji, a dash, "!" or a banned phrase`);
    for (const n of nums(say)) if (!known.has(n)) errors.push(`${where}: the number ${n} is not in the product data`);
  };
  if (!(o?.keep_top >= 0 && o?.keep_bottom <= 1 && o.keep_bottom - o.keep_top >= 0.55)) errors.push(`keep_top/keep_bottom ${o?.keep_top}-${o?.keep_bottom}: keep at least 0.55 of the height`);
  const hooks = Array.isArray(o?.hooks) ? o.hooks : [];
  if (hooks.length !== 3) errors.push(`hooks: ${hooks.length} instead of 3`);
  hooks.forEach((h, i) => line(`hook ${i}`, h.text, 7));
  shot("hook_shot", o?.hook_shot, 1.5);
  const scenes = Array.isArray(o?.scenes) ? o.scenes : [];
  if (scenes.length < 4 || scenes.length > 6) errors.push(`scenes: ${scenes.length}, need 4 to 6`);
  scenes.forEach((s, i) => {
    line(`scene ${i}`, s.say, 8);
    shot(`scene ${i}`, s, 1.5);
    const said = words(s.say), shown = words(s.pill); // "כף שהיא" for "הכף ... היא" is fine (owner, 2026-11-15)
    if (!shown.length || [...String(s.pill)].length > 30 || shown.filter((w) => said.some((x) => near(w, x))).length < Math.ceil(shown.length * 0.75))
      errors.push(`scene ${i}: pill "${s.pill}" must be the same words as "${s.say}" or a short part of them (up to 30 characters)`);
    if (EMOJI.test(s.pill) || BANNED.test(s.pill)) errors.push(`scene ${i}: pill "${s.pill}" has an emoji, a dash or "!"`);
    if (!["top", "bottom", "full"].includes(s.half)) errors.push(`scene ${i}: half must be top, bottom or full`);
  });
  if (!IT.includes(String(o?.it).trim())) errors.push(`it: "${o?.it}" must be one of ${IT.join(", ")}`);
  shot("proof_shot", o?.proof_shot, 2.5);
  shot("end_shot", o?.end_shot, 2.5);
  shots.sort((x, y) => x.a - y.a).forEach((x, i, a) => {
    if (i && x.a < a[i - 1].b - 0.25) errors.push(`${a[i - 1].where} (${a[i - 1].a}-${a[i - 1].b}) and ${x.where} (${x.a}-${x.b}) show the same seconds: every shot must be different`);
  });
  if (errors.length) return { errors };
  const within = (x) => { const [lo, hi] = sections[sectionAt(sections, (x.a + x.b) / 2)]; return { a: Math.max(x.a, lo), b: Math.min(x.b, hi), sec: [lo, hi] }; };
  const hook = [...hooks].sort((a, b) => hookScore(b) - hookScore(a))[0];
  const tags = [...new Set((o.hashtags ?? []).map((t) => String(t).replace(/^#/, "").trim().replace(/[\s\-־]+/g, "_").replace(/[^\p{L}\p{N}_]/gu, "")).filter((t) => t.length >= 2 && t.length <= 30))].slice(0, 5);
  const name = String(o.dm_name ?? "").trim();
  const end = (s) => (/[.?]$/.test(s.trim()) ? s.trim() : `${s.trim()}.`);
  let n = 0;
  return {
    script: {
      keep: [o.keep_top, o.keep_bottom],
      hook: { say: end(hook.text), pill: hook.text.trim(), ...within(o.hook_shot), score: hookScore(hook), others: hooks.filter((h) => h !== hook).map((h) => `${h.text} (${hookScore(h)})`) },
      scenes: scenes.map((s) => ({ say: end(s.say), pill: s.pill.trim().replace(/[.]$/, ""), step: s.step ? ++n : null, ...within(s), half: s.half })),
      proof: { say: proofSay(Number(p.lastest_volume), o.it.trim()), ...within(o.proof_shot) },
      end: { say: END_SAY, ...within(o.end_shot) },
    },
    post: [POST_CTA, "", (tags.length ? tags : ["עלי_אקספרס", "פנדה_דילים"]).map((t) => `#${t}`).join(" ")].join("\n"),
    dmName: name && name.split(/\s+/).length <= 3 && name.length <= 24 && /^[א-ת\s"״׳-]+$/.test(name) ? name : "מוצר",
  };
}

// The spoken text, one sentence per scene in playing order: hook, scenes, proof, end.
export const sentences = (sc) => [sc.hook.say, ...sc.scenes.map((s) => s.say), sc.proof.say, sc.end.say];

// ---------------- Gemini ----------------
const API = "https://generativelanguage.googleapis.com/v1beta/models";
export async function gemini(model, body, { fetch = globalThis.fetch, env = process.env, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), log = () => {} } = {}) {
  for (let i = 0; ; i++) {
    const r = await fetch(`${API}/${model}:generateContent`, { method: "POST", headers: { "x-goog-api-key": env.GEMINI_API_KEY, "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(env.GEMINI_TIMEOUT_MS ? Number(env.GEMINI_TIMEOUT_MS) : 300000) });
    const j = await r.json().catch(() => ({}));
    // free tier: a few requests a minute; Google says how long to wait
    if ((r.status === 429 || r.status === 503) && i < 3) {
      const wait = Number(String(JSON.stringify(j)).match(/retry in ([\d.]+)s|"retryDelay":"(\d+)s"/)?.slice(1).find(Boolean) ?? 30);
      log(`gemini ${model}: ${r.status}, waiting ${Math.ceil(wait)} s`);
      await sleep((Math.ceil(wait) + 2) * 1000);
      continue;
    }
    if (j.error || !r.ok) throw new Error(`gemini ${model}: ${j.error?.status ?? r.status} ${String(j.error?.message ?? "").slice(0, 200)}`);
    return j;
  }
}

// frames: [{ t, jpeg (Buffer) }]. A rejected answer is asked again with the reasons, a failed call (Gemini took over 5
// minutes on GitHub once, 2026-11-15) simply again: 3 tries in all.
export async function writeScript(p, duration, frames, deps = {}) {
  const sections = deps.sections ?? [[0, duration]];
  const parts = [{ text: prompt(p, duration, frames.map((f) => f.t), sections) }, ...(deps.feedback ? [{ text: `An earlier script for this video was spoken and failed: ${deps.feedback}. Avoid that.` }] : []), ...frames.flatMap((f) => [{ text: `frame t=${f.t.toFixed(1)} [${LETTERS[sectionAt(sections, f.t)]}]` }, { inlineData: { mimeType: "image/jpeg", data: f.jpeg.toString("base64") } }])];
  let errors = [];
  for (let tries = 1; tries <= 3; tries++) {
    const again = errors.length && !errors[0].startsWith("AI call failed") ? [{ text: `Your last answer was rejected for: ${errors.slice(0, 12).join("; ")}. Write it again with these fixed.` }] : [];
    const out = await gemini(deps.model ?? SCRIPT_MODEL, { contents: [{ parts: [...parts, ...again] }], generationConfig: { responseMimeType: "application/json", responseJsonSchema: SCHEMA, temperature: 0.7 } }, deps)
      .then((j) => JSON.parse(j.candidates?.[0]?.content?.parts?.map((x) => x.text ?? "").join("") || "null"))
      .catch((e) => ({ failed: e.message }));
    deps.onAnswer?.(tries, out);
    const checked = out?.failed ? { errors: [`AI call failed: ${out.failed}`] } : checkScript(out, p, duration, sections);
    if (!checked.errors) return { ...checked, tries };
    errors = checked.errors;
    deps.log?.(`script try ${tries} rejected: ${errors.join("; ")}`);
  }
  return { errors, tries: 3 };
}

// ---------------- the voice ----------------
// Every Gemini take ends in ~0.15 s of full-scale noise after the last word (the owner heard it as a glitch, 2026-11-15).
// Cut at the start of the last silent run (>= 0.1 s under -55 dBFS) plus 0.1 s, when it ends within the last 0.5 s.
export function cleanTail(pcm) {
  const x = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.length >> 1), F = 240, n = Math.floor(x.length / F);
  const quiet = (f) => { let m = 0; for (let i = f * F; i < (f + 1) * F; i++) m = Math.max(m, Math.abs(x[i])); return 20 * Math.log10((m || 1) / 32768) < -55; };
  let end = n, st = n;
  for (; end > n - 50 && end > 0; end = st - 1) { // the burst itself can hold a stray zero frame
    while (end > n - 50 && end > 0 && !quiet(end - 1)) end--;
    st = end; while (st > 0 && quiet(st - 1)) st--;
    if (end - st >= 10) break;
  }
  if (end - st < 10 || end <= n - 50) return pcm;
  const keep = Math.min(end, st + 10) * F, y = Int16Array.from(x.subarray(0, keep));
  for (let i = 0; i < 480 && i < keep; i++) y[keep - 1 - i] = Math.round(y[keep - 1 - i] * i / 480); // 20 ms fade-out
  return Buffer.from(y.buffer);
}

export function wav(pcm, rate = 24000) {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + pcm.length, 4); h.write("WAVEfmt ", 8); h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write("data", 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

export async function speak(text, deps = {}) {
  const j = await gemini(TTS_MODEL, { contents: [{ parts: [{ text: `${TTS_STYLE}\n${text}` }] }], generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE } } } } }, deps);
  const part = j.candidates?.[0]?.content?.parts?.find((x) => x.inlineData);
  if (!part) throw new Error("gemini tts: no audio");
  return wav(cleanTail(Buffer.from(part.inlineData.data, "base64")));
}

// Whisper words with times (~0.2¢ for 18 s). Throws on failure.
export async function wordTimes(wavBytes, { fetch = globalThis.fetch, env = process.env } = {}) {
  const form = new FormData();
  form.append("file", new Blob([wavBytes], { type: "audio/wav" }), "voice.wav");
  form.append("model", "whisper-1"); form.append("language", "he"); form.append("response_format", "verbose_json"); form.append("timestamp_granularities[]", "word");
  const j = await fetch("https://api.openai.com/v1/audio/transcriptions", { method: "POST", headers: { authorization: `Bearer ${env.OPENAI_API_KEY}` }, body: form, signal: AbortSignal.timeout(120000) }).then((r) => r.json());
  if (!Array.isArray(j.words) || !j.words.length) throw new Error(`whisper: ${j.error?.message ?? "no words"}`);
  return j.words;
}

// ---------------- where each sentence ends in the spoken take ----------------
// Whisper spells some words its own way ("בקף" for "בכף", "13,000" for "13 אלף"): the script's words are matched to its
// words by the longest common subsequence of near-equal words; a sentence ends at its last matched word.
const SOUND_ALIKE = (s) => s.replace(/[קכ]/g, "כ").replace(/[וב]/g, "ב").replace(/[טת]/g, "ת").replace(/[סש]/g, "ס");
function lev(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}
// the same word as Whisper may spell it: equal after sound-alike letters, or one letter apart (words of 3+ letters)
const near = (a, b) => {
  const x = SOUND_ALIKE(a), y = SOUND_ALIKE(b);
  return x === y || (Math.min(x.length, y.length) >= 3 && lev(x, y) <= 1);
};
export function sentenceEnds(says, heard) {
  const script = says.flatMap((s, si) => words(s).map((w) => ({ w, si })));
  const h = heard.map((x) => words(x.word).join(""));
  const L = Array.from({ length: script.length + 1 }, () => new Int16Array(h.length + 1));
  for (let i = script.length - 1; i >= 0; i--)
    for (let j = h.length - 1; j >= 0; j--) L[i][j] = near(script[i].w, h[j]) ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const match = new Array(script.length).fill(-1);
  for (let i = 0, j = 0; i < script.length && j < h.length;) {
    if (near(script[i].w, h[j]) && L[i][j] === L[i + 1][j + 1] + 1) match[i++] = j++;
    else if (L[i + 1][j] >= L[i][j + 1]) i++;
    else j++;
  }
  return says.map((_, si) => {
    const mine = script.map((x, i) => (x.si === si ? match[i] : -1)).filter((j) => j >= 0);
    return mine.length ? Math.max(...mine) : null;
  });
}

// The guide's timing rules (owner-approved 2026-11-15): the hook is spoken within 3 s and no scene runs over 4 s
// (the end card is exempt). ends: sentenceEnds; heard: Whisper words. Returns the reasons it fails, [] when fine.
export function timingProblems(ends, heard, says, shots = null) {
  const problems = [];
  if (ends.some((e, i) => e === null && i < ends.length - 1)) problems.push("a sentence was not found in the spoken take");
  if (problems.length) return problems;
  const t = ends.map((e) => heard[e].end);
  if (t[0] - heard[0].start > 3.0) problems.push(`the hook "${says[0]}" takes ${(t[0] - heard[0].start).toFixed(1)} s (max 3)`);
  for (let i = 1; i < ends.length - 1; i++) if (t[i] - t[i - 1] > 4.0) problems.push(`"${says[i]}" takes ${(t[i] - t[i - 1]).toFixed(1)} s (max 4)`);
  for (let i = 1; i < ends.length; i++) if (!(ends[i] > ends[i - 1])) problems.push("sentences out of order in the spoken take");
  if (shots && !problems.length) {
    const spoken = [t[0] - heard[0].start + 0.2, ...t.slice(1, -1).map((x, i) => x - t[i]), heard.at(-1).end - t.at(-2) + 2.0]; // the end card holds 2 s more
    spoken.forEach((need, i) => {
      const len = shots[i].b - shots[i].a;
      if (len < need * 0.55) problems.push(`"${says[i]}" is spoken for ${need.toFixed(1)} s but its shot (${shots[i].a}-${shots[i].b}) is only ${len.toFixed(1)} s: pick a longer shot inside one section, or a shorter sentence`);
    });
  }
  return problems;
}

// ---------------- what the owner gets ----------------
export function captionList(sc, p) {
  const lines = [
    `1. פתיחה: ${sc.hook.say} (ציון ${sc.hook.score}/20; האחרות: ${sc.hook.others.join(" · ")})`,
    ...sc.scenes.map((s, i) => `${i + 2}. ${s.say}${s.pill !== s.say.replace(/[.]$/, "") ? `  ←  על המסך: ${s.pill}` : ""}${s.step ? ` [שלב ${s.step}]` : ""}`),
    `${sc.scenes.length + 2}. ${sc.proof.say}  ←  על המסך: ${Number(p.lastest_volume).toLocaleString("en-US")} קנו לאחרונה · ${Math.round(parseFloat(p.evaluate_rate))}% ביקורות חיוביות · ₪${p.target_sale_price}`,
    `${sc.scenes.length + 3}. ${sc.end.say}`,
  ];
  return `📝 מה נאמר בסרטון, לפי הסדר:\n\n${lines.join("\n")}`;
}

// The private message for whoever comments "פנדה" (owner, 2026-11-14): the product link first, then the deals channel.
export const dmText = (name, link) => [`הנה הקישור ל${name} 👇`, link, "", "ואם אתם אוהבים דילים כאלה, יש לי ערוץ עם דילים חדשים כל יום:", CHANNEL].join("\n");
