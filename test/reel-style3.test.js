import { test } from "node:test";
import assert from "node:assert/strict";
import {
  weakness, pickProduct, soldWords, proofSay, checkScript, sentences, sentenceEnds, timingProblems, cleanTail, nextTrack, markUsed,
  queriesFor, QUERIES, END_SAY, POST_CTA,
} from "../reel-style3.js";

const P = { product_id: 1, product_title: "Mini Spoon Scale Digital Kitchen Scale 0.1-500g", lastest_volume: "12934", evaluate_rate: "98.0%", target_sale_price: "14.09", product_video_url: "https://video.aliexpress-media.com/x.mp4" };
const good = () => ({
  keep_top: 0, keep_bottom: 0.8,
  hooks: [
    { text: "עוד מנחשים כמה גרם יש בכף?", frontload: 5, specific: 5, address: 5, stakes: 3 },
    { text: "כמה זה כף?", frontload: 3, specific: 2, address: 1, stakes: 1 },
    { text: "המתכון יוצא לא טוב?", frontload: 4, specific: 2, address: 3, stakes: 4 },
  ],
  hook_shot: { a: 21, b: 23.4 },
  scenes: [
    { say: "הכף הזאת היא גם משקל.", pill: "כף שהיא גם משקל", step: false, a: 5, b: 8.8, half: "full" },
    { say: "גורפים, והמשקל מופיע מיד.", pill: "גורפים, והמשקל מופיע מיד", step: true, a: 10.4, b: 13, half: "full" },
    { say: "היא שוקלת גם אבקה וגם נוזלים.", pill: "גם אבקה, גם נוזלים", step: true, a: 17.5, b: 20.2, half: "bottom" },
    { say: "הראש שלה מתפרק לשטיפה.", pill: "הראש מתפרק לשטיפה", step: true, a: 32.75, b: 35.4, half: "full" },
  ],
  it: "אותה",
  proof_shot: { a: 25.6, b: 29 }, end_shot: { a: 0, b: 3 },
  hashtags: ["מטבח", "אפייה", "#גאדג'טים למטבח"], dm_name: "כף",
});

test("style 3: only a proven hit with the seller's own video qualifies", () => {
  assert.equal(weakness(P), null);
  assert.equal(weakness({ ...P, product_video_url: "" }), "no seller video");
  assert.equal(weakness({ ...P, product_video_url: "https://evil.example/x.mp4" }), "no seller video");
  assert.match(weakness({ ...P, lastest_volume: "9000" }), /sold/);
  assert.match(weakness({ ...P, evaluate_rate: "93.1%" }), /rating/);
});

test("style 3: the pick is the best seller that qualifies and wasn't used, searching on until one is found", async () => {
  const lists = { a: [{ ...P, product_id: 7, lastest_volume: "50000" }], b: [{ ...P, product_id: 8, lastest_volume: "20000" }, { ...P, product_id: 9, lastest_volume: "30000" }, { ...P, product_id: 10, lastest_volume: "90000", evaluate_rate: "80%" }] };
  const p = await pickProduct(["a", "b"], { used: ["7"], search: async (q) => lists[q] });
  assert.equal(p.product_id, 9);
  assert.equal(await pickProduct(["a"], { used: [7], search: async (q) => lists[q] }), null);
  assert.equal(new Set(queriesFor(3)).size, QUERIES.length);
  assert.notEqual(queriesFor(3)[0], queriesFor(4)[0]);
});

test("style 3: the buyers line is code's, rounded the honest way", () => {
  assert.equal(soldWords(12934), "כמעט 13 אלף");
  assert.equal(soldWords(16967), "כמעט 17 אלף");
  assert.equal(soldWords(12100), "יותר מ-12 אלף");
  assert.equal(soldWords(21232), "יותר מ-21 אלף");
  assert.equal(proofSay(12934, "אותה"), "כמעט 13 אלף אנשים כבר קנו אותה.");
});

test("style 3: a good script becomes the voice text, the post is only the call to action, the best-scored hook wins (owner, 2026-11-15)", () => {
  const r = checkScript(good(), P, 47);
  assert.equal(r.errors, undefined);
  assert.equal(r.script.hook.say, "עוד מנחשים כמה גרם יש בכף?");
  assert.equal(r.script.hook.pill, "עוד מנחשים כמה גרם יש בכף?", "the hook on screen is the spoken words");
  assert.deepEqual(r.script.scenes.map((s) => s.step), [null, 1, 2, 3]);
  assert.deepEqual(sentences(r.script).slice(-2), ["כמעט 13 אלף אנשים כבר קנו אותה.", END_SAY]);
  assert.equal(r.post.split("\n")[0], POST_CTA);
  assert.doesNotMatch(r.post, /\d{2},\d{3}|קנו/, "no buyer count in the post (owner, 2026-11-15)");
  assert.equal(r.dmName, "כף");
});

test("style 3: what the owner rejected never passes: a different sentence on screen, banned phrases, invented numbers, long lines", () => {
  const bad = (f) => { const o = good(); f(o); return checkScript(o, P, 47).errors?.join(" | ") ?? ""; };
  assert.match(bad((o) => { o.scenes[1].pill = "המתכון אומר 15 גרם"; }), /pill/);
  assert.match(bad((o) => { o.scenes[0].say = "אל תפספסו את הכף הזאת."; }), /banned/);
  assert.match(bad((o) => { o.scenes[0].say = "שוקלת עד 3000 גרם."; }), /3000/);
  assert.match(bad((o) => { o.scenes[0].say = "הכף הזאת היא גם משקל קטן וחכם ונוח מאוד."; }), /more than 8 words/);
  assert.match(bad((o) => { o.hooks.pop(); }), /hooks/);
  assert.match(bad((o) => { o.scenes[2].b = 60; }), /shot/);
  assert.match(bad((o) => { o.keep_bottom = 0.4; }), /keep/);
  assert.match(bad((o) => { o.it = "אותך"; }), /it/);
});

test("style 3: each sentence's end is found in Whisper's words, though Whisper spells words its own way", () => {
  const says = ["עוד מנחשים כמה גרם יש בכף?", "הכף הזאת היא גם משקל.", "גורפים, והמשקל מופיע מיד.", "כמעט 13 אלף אנשים כבר קנו אותה.", END_SAY];
  const heard = "עוד מנחשים כמה גרם יש בקף? הקף הזאת היא גם משקל גורפים והמשקל מופיע מיד כמעט 13,000 אנשים כבר קנו אותה רוצים את הכישור? כתבו פנדה בתגובות"
    .split(" ").map((word, i) => ({ word, start: i * 0.3, end: i * 0.3 + 0.28 }));
  const ends = sentenceEnds(says, heard);
  assert.deepEqual(ends, [5, 10, 14, 20, 26]); // "13,000" is one word to Whisper
  assert.deepEqual(timingProblems(ends, heard, says), []);
  const slow = heard.map((w, i) => ({ ...w, start: i * 0.6, end: i * 0.6 + 0.5 }));
  assert.match(timingProblems(ends, slow, says).join(" "), /hook .*max 3/);
});

test("style 3: Gemini's end-of-take noise burst is cut, a clean take is left alone", () => {
  const sr = 24000, speech = Array.from({ length: sr }, (_, i) => Math.round(8000 * Math.sin(i / 7)));
  const silence = new Array(Math.round(0.25 * sr)).fill(0), burst = Array.from({ length: Math.round(0.15 * sr) }, (_, i) => (i === 100 ? 0 : (i % 2 ? 32000 : -32000)));
  const pcm = (a) => Buffer.from(Int16Array.from(a).buffer);
  const cleaned = cleanTail(pcm([...speech, ...silence, ...burst]));
  assert.ok(cleaned.length / 2 < speech.length + silence.length, "the burst is gone");
  assert.ok(cleaned.length / 2 > speech.length, "the speech is kept");
  const clean = pcm([...speech, ...silence]);
  assert.ok(cleanTail(clean).length / 2 >= speech.length + 0.1 * sr - 1, "a clean take keeps all its speech (only trailing silence over 0.1 s goes)");
  const noisy = pcm(speech);
  assert.equal(cleanTail(noisy).length, noisy.length, "no silence at the end: nothing is cut");
});

test("style 3: a different house track each day, none again within 10 days", () => {
  const day = 864e5, pool = ["a", "b", "c"];
  let s = {};
  const got = [];
  for (let d = 0; d < 4; d++) { const t = nextTrack(s, pool, d * day); got.push(t); s = markUsed(s, d, t, d * day); }
  assert.deepEqual(got.slice(0, 3).sort(), pool);
  assert.equal(got[3], "a");
});
