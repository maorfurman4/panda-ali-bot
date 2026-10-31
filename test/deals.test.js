import { test } from "node:test";
import assert from "node:assert/strict";
import { candidates, formatDeal, postDeal, runDeals, activeSale, saleBanner, israelTime, TOPICS } from "../deals.js";

const item = (id, extra = {}) => ({
  product_id: id,
  product_title: `מנורת לילה LED חכמה ${id}`,
  evaluate_rate: "97.5%",
  lastest_volume: 8000,
  promotion_link: `https://s.click.aliexpress.com/e/${id}`,
  product_main_image_url: `https://ae01.alicdn.com/${id}.jpg`,
  target_sale_price: "29.90",
  target_sale_price_currency: "ILS",
  ...extra,
});

test("candidates: only proven, complete, not-yet-posted items", () => {
  const list = [
    item("ok"),
    item("lowfb", { evaluate_rate: "91%" }),
    item("nofb", { evaluate_rate: "" }),
    item("few", { lastest_volume: 2500 }),
    item("nolink", { promotion_link: "" }),
    item("part", { product_title: "חלקי חילוף לשואב רובוטי" }),
    item("old"),
  ];
  assert.deepEqual(candidates(list, ["old"]).map((p) => p.product_id), ["ok"]);
  assert.deepEqual(candidates([item("few", { lastest_volume: 2500 })], [], 500).map((p) => p.product_id), ["few"], "sale lists use a lower floor");
});

test("candidates: most sold first; feedback is only a floor", () => {
  const list = [item("a", { lastest_volume: 4900, evaluate_rate: "98%" }), item("b", { lastest_volume: 6600, evaluate_rate: "95%" }), item("c", { lastest_volume: 30000 })];
  assert.deepEqual(candidates(list).map((p) => p.product_id), ["c", "b", "a"]);
});

test("formatDeal: AI headline, name, benefits and warning, price, trust, short link and the search group link", () => {
  const ai = { emoji: "💡", headline: "נמאס לכם מחושך?", name: "מנורת לילה חכמה", benefits: ["נדלקת לבד בתנועה", "אור רך לחדר הילדים", "נטענת ב-USB"], warning: "לא לשימוש בחוץ" };
  const text = formatDeal(item("a", { target_original_price: "59.90" }), ai);
  assert.match(text, /💡 <b>נמאס לכם מחושך\?<\/b>/);
  assert.match(text, /<b>מנורת לילה חכמה<\/b>/);
  assert.equal(text.match(/✅/g).length, 3);
  assert.match(text, /⚠️ לא לשימוש בחוץ/);
  assert.match(text, /👍 משוב חיובי: 98%\n\u200f📦 נמכרו: מעל 8,000/, "sold on its own line under the feedback");
  assert.match(text, /₪29\.90/);
  assert.match(text, /50% הנחה/);
  assert.match(text, /🛒 <a href="https:\/\/s\.click\.aliexpress\.com\/e\/a">לרכישה בעלי אקספרס ←<\/a>/);
  assert.match(text, /<a href="https:\/\/t\.me\/panda_deals_il">מחפשים משהו אחר\? הבוט שלנו ימצא לכם<\/a>/);
  const plain = formatDeal(item("b"));
  assert.match(plain, /🔥 <b>הדיל של עכשיו<\/b>/, "no AI -> the plain card");
  assert.match(plain, /מנורת לילה LED חכמה b/, "no AI name -> the seller title");
  assert.doesNotMatch(plain, /✅|⚠️|undefined|null/);
});

test("postDeal: next topic in turn, the AI's pick, remembers what it posted", async () => {
  const sent = [];
  const searches = [];
  const api = { sendPhoto: async (...a) => sent.push(a) };
  const search = async (words, deps) => (searches.push([words, deps.category]), [item("1"), item("2"), item("3")]);
  const state = await postDeal({ topic: 0, posted: ["9"] }, { api, chatId: -100, search, shorten: async (ps) => ps, pick: async () => ({ i: 1, name: "מנורה", benefits: [] }), log: () => {} });
  assert.deepEqual(searches, [TOPICS[1], [TOPICS[1][0], undefined]], "in the category and anywhere");
  assert.equal(sent[0][0], -100);
  assert.equal(sent[0][1], "https://ae01.alicdn.com/2.jpg");
  assert.deepEqual(sent[0][2].reply_markup.inline_keyboard, [[{ text: "🛒 לקנייה בעלי אקספרס", url: "https://s.click.aliexpress.com/e/2" }]], "a buy button under the post");
  assert.deepEqual(state, { topic: 1, posted: ["9", "2"] });
});

test("postDeal: skips a topic whose best sellers aren't its item (the AI says none)", async () => {
  const sent = [];
  const topics = [];
  const pick = async (_l, words) => (topics.push(words), topics.length === 1 ? { none: true } : { i: 0, name: "מנורה", benefits: [] });
  const search = async () => [item("a"), item("b"), item("c")];
  const state = await postDeal({ topic: 0 }, { api: { sendPhoto: async (...a) => sent.push(a) }, chatId: 1, search, shorten: async (ps) => ps, pick, log: () => {} });
  assert.deepEqual(topics, [TOPICS[1][0], TOPICS[2][0]]);
  assert.equal(state.topic, 2);
  assert.equal(sent.length, 1);
});

test("postDeal: skips a topic with nothing good, falls back to text when the photo fails, posts nothing when every topic is empty", async () => {
  const sent = [];
  const api = { sendPhoto: async () => { throw new Error("bad photo"); }, sendMessage: async (...a) => sent.push(a) };
  let calls = 0;
  const search = async () => (++calls <= 2 ? [] : [item("x")]); // first topic: empty with and without the category
  const state = await postDeal({}, { api, chatId: 1, search, shorten: async (ps) => ps, pick: async () => null, log: () => {} });
  assert.equal(state.topic, 1);
  assert.match(sent[0][1], /מנורת לילה/);
  const empty = { topic: 3, posted: [] };
  assert.equal(await postDeal(empty, { api, search: async () => [], log: () => {} }), empty);
});

const SALE = ["1101-1118 11.11 Sale - Bestsellers", "1101-1118 11.11 Sale - Big Save", "Some other list"];
const at = (iso) => new Date(iso); // UTC; Israel is UTC+2 in winter

test("israelTime, activeSale and saleBanner: Israel's clock, the dated sale lists, the countdown and the peak day", () => {
  assert.deepEqual(israelTime(at("2026-11-03T07:30:00Z")), { day: "2026-11-03", md: "11-03", hour: 9 });
  assert.equal(activeSale(SALE, "10-31"), null);
  assert.deepEqual(activeSale(SALE, "11-03"), { label: "11.11", lists: SALE.slice(0, 2) });
  assert.equal(saleBanner(activeSale(SALE, "11-03"), { day: "2026-11-03", md: "11-03" }), "🛍️ מבצעי 11.11 · עוד 8 ימים!");
  assert.equal(saleBanner(activeSale(SALE, "11-10"), { day: "2026-11-10", md: "11-10" }), "🛍️ מבצעי 11.11 · מחר!");
  assert.equal(saleBanner(activeSale(SALE, "11-11"), { day: "2026-11-11", md: "11-11" }), "🔥 היום זה 11.11!");
  assert.equal(saleBanner(null, { day: "2026-11-27", md: "11-27" }), "🔥 היום זה בלאק פריידיי!", "a peak day without a sale list");
  assert.equal(saleBanner(null, { day: "2026-10-30", md: "10-30" }), null);
});

// Fresh items on every call (3, so no second call without the category); used = the lists searched, repeats collapsed.
function deps({ sale = [], promoEmpty = false } = {}) {
  const sent = [];
  const used = [];
  let n = 0;
  const fresh = () => [item(`i${++n}`), item(`i${++n}`), item(`i${++n}`)];
  const use = (name) => used.at(-1) !== name && used.push(name);
  return {
    sent,
    used,
    opts: {
      api: { sendPhoto: async (_c, _ph, o) => sent.push(o.caption) },
      chatId: 1,
      names: async () => sale,
      promo: async (list) => (use(list), promoEmpty ? [] : fresh()),
      search: async () => (use("search"), fresh()),
      shorten: async (ps) => ps,
      pick: async () => null,
      log: () => {},
    },
  };
}

test("runDeals: posts only at the day's hours and once per hour; a manual run posts at once", async () => {
  const d = deps();
  const state = { posted: [] };
  assert.equal(await runDeals(state, { ...d.opts, now: at("2026-10-30T08:05:00Z") }), state, "10:00 on a normal day");
  const next = await runDeals(state, { ...d.opts, now: at("2026-10-30T07:05:00Z") });
  assert.equal(next.slot, "2026-10-30 9");
  assert.equal(await runDeals(next, { ...d.opts, now: at("2026-10-30T07:40:00Z") }), next, "a late duplicate run in the same hour");
  assert.notEqual(await runDeals(next, { ...d.opts, now: at("2026-10-30T08:05:00Z"), force: true }), next);
  assert.equal(d.sent.length, 2);
  assert.doesNotMatch(d.sent[0], /מבצעי|היום זה/);
});

test("runDeals: on sale days more hours, every other post from the sale lists in turn, all with the banner", async () => {
  const d = deps({ sale: SALE });
  let state = { posted: [] };
  for (const hour of [7, 9, 11]) state = await runDeals(state, { ...d.opts, now: at(`2026-11-03T${String(hour).padStart(2, "0")}:05:00Z`) }); // 9, 11, 13 Israel
  assert.deepEqual(d.used, [SALE[0], "search", SALE[1]]);
  assert.equal(d.sent.length, 3);
  assert.ok(d.sent.every((c) => c.includes("🛍️ מבצעי 11.11 · עוד 8 ימים!")));
  assert.equal(state.saleTurn, 3);
});

test("runDeals: a sale list with nothing good falls back to the best sellers; the peak day posts at its extra hours", async () => {
  const d = deps({ sale: SALE, promoEmpty: true });
  const state = await runDeals({ posted: [] }, { ...d.opts, now: at("2026-11-11T08:05:00Z") }); // 10:00 on 11.11
  assert.deepEqual(d.used, [SALE[0], "search"]);
  assert.match(d.sent[0], /🔥 היום זה 11\.11!/);
  assert.equal(state.saleTurn, 1);
});

test("postDeal: a failed AI call is tried once more", async () => {
  let calls = 0;
  const pick = async () => (++calls === 1 ? null : { i: 0, name: "מנורה", benefits: ["אור רך"] });
  const sent = [];
  await postDeal({}, { api: { sendPhoto: async (...a) => sent.push(a) }, chatId: 1, search: async () => [item("a"), item("b"), item("c")], shorten: async (ps) => ps, pick, log: () => {} });
  assert.equal(calls, 2);
  assert.match(sent[0][2].caption, /✅ אור רך/);
});

test("postDeal media: the seller's video first, else a collage of 4 of the product's photos, else the main photo", async () => {
  const run = async (product, { videoFails = false } = {}) => {
    const sent = [];
    const api = {
      sendVideo: async (...a) => (sent.push(["video", ...a]), videoFails ? Promise.reject(new Error("too big")) : true),
      sendPhoto: async (...a) => sent.push(["photo", ...a]),
    };
    const collage = async (urls, o) => (sent.push(["collage", urls.length, o.badges]), Buffer.from("jpg"));
    await postDeal({}, { api, chatId: 1, search: async () => [product, item("b"), item("c")], shorten: async (ps) => ps, pick: async () => null, collage, log: () => {} });
    return sent;
  };
  const photos = { string: ["https://ae01.alicdn.com/1.jpg", "https://ae01.alicdn.com/2.jpg", "https://ae01.alicdn.com/3.jpg", "https://ae01.alicdn.com/4.jpg"] };
  const video = await run(item("a", { product_video_url: "https://video.aliexpress-media.com/a.mp4", lastest_volume: 90000 }));
  assert.deepEqual(video.map((s) => s[0]), ["video"]);
  assert.equal(video[0][2], "https://video.aliexpress-media.com/a.mp4");
  assert.match(video[0][3].caption, /מנורת לילה/);
  assert.equal(video[0][3].reply_markup.inline_keyboard[0][0].text, "🛒 לקנייה בעלי אקספרס");
  const collage = await run(item("a", { product_small_image_urls: photos, lastest_volume: 90000 }));
  assert.deepEqual(collage.map((s) => s[0]), ["collage", "photo"]);
  assert.deepEqual(collage[0].slice(1), [4, false], "4 photos, no rank badges");
  assert.equal(collage[1][2].constructor.name, "InputFile");
  const fallback = await run(item("a", { product_video_url: "https://video.aliexpress-media.com/a.mp4", product_small_image_urls: photos, lastest_volume: 90000 }), { videoFails: true });
  assert.deepEqual(fallback.map((s) => s[0]), ["video", "collage", "photo"], "a failed video falls back to the collage");
  const plain = await run(item("a", { lastest_volume: 90000 }));
  assert.deepEqual(plain.map((s) => s[0]), ["photo"]);
  assert.equal(plain[0][2], "https://ae01.alicdn.com/a.jpg", "too few photos for a collage: the main photo");
});
