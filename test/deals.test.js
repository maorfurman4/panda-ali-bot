import { test } from "node:test";
import assert from "node:assert/strict";
import { candidates, formatDeal, pickReviews, nextTemplate, TEMPLATES, CLOSINGS, topicOrder, loadTopics, CATS, postDeal, postSet, runDeals, activeSale, saleBanner, israelTime, upcomingHoliday, specialFor, TOPICS, SETS } from "../deals.js";

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
  const { log: posts, closingTurn, closings, headlines, ...rest } = state;
  assert.deepEqual(rest, { topic: 1, posted: ["9", "2"] });
  assert.equal(closingTurn, 0, "no AI closing: the first of the 60 lines");
  assert.equal(posts.length, 1, "the post is logged for the nightly status");
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
  assert.deepEqual(israelTime(at("2026-11-03T07:30:00Z")), { day: "2026-11-03", md: "11-03", hour: 9, wd: 2 });
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
  assert.equal(await runDeals(state, { ...d.opts, now: at("2026-10-30T04:05:00Z") }), state, "06:00, before the first post");
  const next = await runDeals(state, { ...d.opts, now: at("2026-10-30T07:05:00Z") });
  assert.equal(next.slot, "2026-10-30 9");
  assert.equal(await runDeals(next, { ...d.opts, now: at("2026-10-30T07:40:00Z") }), next, "a late duplicate run in the same hour");
  assert.notEqual(await runDeals(next, { ...d.opts, now: at("2026-10-30T08:05:00Z"), force: true }), next);
  assert.equal(d.sent.length, 2);
  assert.doesNotMatch(d.sent[0], /מבצעי|היום זה/);
});

test("runDeals: on sale days every post is a best seller with the sale banner; the sale lists themselves aren't searched", async () => {
  const d = deps({ sale: SALE });
  let state = { posted: [] };
  for (const hour of [7, 9, 11]) state = await runDeals(state, { ...d.opts, now: at(`2026-11-03T${String(hour).padStart(2, "0")}:05:00Z`) }); // 9, 11, 13 Israel
  assert.deepEqual(d.used, ["search"]);
  assert.equal(d.sent.length, 3);
  assert.ok(d.sent.every((c) => c.includes("🛍️ מבצעי 11.11 · עוד 8 ימים!")));
});

test("runDeals: the peak day has its banner", async () => {
  const d = deps({ sale: SALE });
  await runDeals({ posted: [] }, { ...d.opts, now: at("2026-11-11T09:05:00Z") });
  assert.match(d.sent[0], /🔥 היום זה 11\.11!/);
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

test("upcomingHoliday: by the Hebrew calendar, from 30 days ahead; back to school by the civil date", () => {
  assert.equal(upcomingHoliday(at("2026-10-31T10:00:00Z")), null);
  assert.deepEqual([upcomingHoliday(at("2026-11-06T10:00:00Z")).name, upcomingHoliday(at("2026-11-06T10:00:00Z")).days], ["חנוכה", 29]);
  assert.equal(upcomingHoliday(at("2027-02-25T10:00:00Z")).name, "פורים", "14 Adar II in a leap year");
  assert.equal(upcomingHoliday(at("2027-08-10T10:00:00Z")).name, "החזרה ללימודים");
});

test("specialFor: the holiday item is the day's second-to-last post, the weekly series its third", () => {
  const holiday = { name: "חנוכה", emoji: "🕎", days: 12, topics: [["hanukkah menorah", null]] };
  const tue = { hour: 22, wd: 2 }; // hourly from 2026-11-04: second-to-last is 22:00, third is 09:00
  assert.match(specialFor(tue, "normal", holiday).banner, /🕎 לקראת חנוכה · עוד 12 ימים/);
  assert.equal(specialFor({ hour: 22, wd: 2 }, "peak", holiday).key, "holidayTopic", "peak days: 22:00");
  assert.equal(specialFor({ hour: 12, wd: 2 }, "normal", holiday), null, "Tuesday has no series");
  const sunday = specialFor({ hour: 9, wd: 0 }, "normal", null);
  assert.deepEqual([sunday.banner, sunday.maxIls], ["💸 מתחת ל-10 ₪", 10]);
  const wed = specialFor({ hour: 9, wd: 3 }, "sale", null);
  assert.equal(wed.banner, "⚡ גאדג'ט השבוע");
  assert.ok(wed.topics.every(([, c]) => [44, 509, 7, 6, 39].includes(c)));
});

test("runDeals: the holiday post walks its own topics with a price floor of its own and the holiday banner", async () => {
  const d = deps();
  const searched = [];
  d.opts.search = async (w, o) => (searched.push([w, o.maxIls]), [item("h1"), item("h2"), item("h3")]);
  const state = await runDeals({ posted: [] }, { ...d.opts, now: at("2026-11-20T20:05:00Z") }); // Friday 22:00, Hanukkah in 15 days
  assert.equal(searched[0][0], "hanukkah menorah");
  assert.match(d.sent[0], /🕎 לקראת חנוכה · עוד 15 ימים/);
  assert.equal(state.holidayTopic, 0);
  assert.equal(state.topic, undefined, "the main rotation keeps its place");
});

test("postSet: the most sold fitting item of each of the set's 3 topics, one collage with badges, a buy button each", async () => {
  const sent = [];
  let n = 0;
  const search = async (w) => [item(`${w}-a`, { lastest_volume: 9000 + ++n, target_sale_price: "10.00" }), item(`${w}-b`), item(`${w}-c`)];
  const collage = async (urls, o) => (sent.push(["collage", urls.length, o?.badges]), Buffer.from("jpg"));
  const api = { sendPhoto: async (...a) => sent.push(["photo", ...a]) };
  const state = await postSet({ posted: [] }, { api, chatId: 1, search, shorten: async (ps) => ps, pick: async (_l, w) => ({ i: 0, name: `שם ${w}` }), collage, log: () => {} });
  assert.deepEqual(sent[0], ["collage", 3, undefined], "3 photos with the rank badges");
  const extra = sent[1][3];
  assert.match(extra.caption, new RegExp(`הסט המושלם: ${SETS[0].name}`));
  assert.match(extra.caption, /1️⃣[\s\S]*2️⃣[\s\S]*3️⃣/);
  assert.match(extra.caption, /הכל ביחד: <b>₪30\.00<\/b>/);
  assert.deepEqual(extra.reply_markup.inline_keyboard[0].map((b) => b.text), ["🛒 1", "🛒 2", "🛒 3"]);
  assert.equal(state.setIndex, 0);
  assert.equal(state.posted.length, 3);
  const none = await postSet({ posted: [] }, { api, chatId: 1, search, shorten: async (ps) => ps, pick: async () => ({ none: true }), collage, log: () => {} });
  assert.deepEqual(none, { posted: [] }, "a missing item: no set");
});

test("specialFor: Thursday's third post is the perfect set", () => {
  assert.deepEqual(specialFor({ hour: 9, wd: 4 }, "normal", null), { set: true });
  assert.equal(specialFor({ hour: 15, wd: 4 }, "normal", null), null);
});

test("runDeals: a manual run can choose a special post any day", async () => {
  const d = deps();
  const searched = [];
  d.opts.search = async (w, o) => (searched.push([w, o.maxIls]), [item("s1"), item("s2"), item("s3")]);
  await runDeals({ posted: [] }, { ...d.opts, now: at("2026-11-03T08:05:00Z"), force: true, special: "sun" }); // a Tuesday
  assert.match(d.sent[0], /💸 מתחת ל-10 ₪/);
  assert.equal(searched[0][1], 10);
  const h = deps();
  await runDeals({ posted: [] }, { ...h.opts, now: at("2026-10-31T08:05:00Z"), force: true, special: "holiday" }); // Hanukkah is 35 days away
  assert.match(h.sent[0], /🕎 לקראת חנוכה/);
});

test("a deal post shows real stars when the review summary answers", async () => {
  const { postDeal } = await import("../deals.js");
  const p = { product_id: "9", product_title: "Car charger 30W", lastest_volume: "9000", evaluate_rate: "98%", target_sale_price: "20", target_sale_price_currency: "ILS", promotion_link: "https://s.click.aliexpress.com/e/_x", product_main_image_url: "https://ae01.alicdn.com/kf/x.jpg" };
  const sent = [];
  const api = { sendPhoto: async (_c, _p, o) => sent.push(o.caption), sendMessage: async (_c, t) => sent.push(t), sendVideo: async () => {} };
  await postDeal({}, { api, chatId: 1, search: async () => [p], shorten: async (l) => l, pick: async () => ({ i: 0, headline: "x", name: "מטען לרכב" }), collage: async () => null, stars: async (l) => l.map((x) => ({ ...x, avgStars: 4.8, reviewCount: 1200 })), topics: [["car charger", 34]], log: () => {} });
  assert.match(sent[0], /⭐ דירוג: 4\.8 \(1,200 ביקורות\)/);
});

test("nightly status (owner, 2026-11-04): once after the 23:00 post, members and change, the day's posts; needs the owner id", async () => {
  const { sendDailyStatus, statusText } = await import("../deals.js");
  const sent = [];
  const api = { getChatMemberCount: async () => 1250, sendMessage: async (id, text) => sent.push({ id, text }) };
  const at23 = new Date("2026-11-04T21:05:00Z"); // 23:05 Israel (winter)
  const state = { members: 1200, log: [{ at: Date.parse("2026-11-04T05:02:00Z"), name: "אוזניות אלחוטיות", price: "45.90" }, { at: Date.parse("2026-11-03T19:02:00Z"), name: "אתמול" }] };
  const next = await sendDailyStatus(state, { api, chatId: "-100", ownerId: "7", now: at23, log: () => {} });
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /חברים בערוץ: 1,250 \(\+50 מאתמול\)/);
  assert.match(sent[0].text, /פוסטים היום: 1/);
  assert.match(sent[0].text, /07:02 · אוזניות אלחוטיות · ₪45.90/);
  assert.doesNotMatch(sent[0].text, /אתמול ·/);
  assert.equal(next.members, 1250);
  assert.equal((await sendDailyStatus(next, { api, chatId: "-100", ownerId: "7", now: at23, log: () => {} })), next, "once a day");
  assert.equal(sent.length, 1);
  const noon = new Date("2026-11-04T10:00:00Z");
  assert.equal(await sendDailyStatus(state, { api, chatId: "-100", ownerId: "7", now: noon, log: () => {} }), state, "only at 23:00");
  assert.equal(await sendDailyStatus(state, { api, chatId: "-100", ownerId: null, now: at23, log: () => {} }), state, "no owner id: nothing");
  assert.match(statusText({ day: "2026-11-04", members: null, prevMembers: null, posts: [] }), /לא ידוע/);
});

test("pickReviews: 5 stars (4 when no 5), a real sentence, Israel first, then with a photo, at most 3", () => {
  const r = (stars, country, text, photos = []) => ({ stars, country, text, photos });
  const long = "Very light and small, fits in any bag easily";
  const out = pickReviews([r(3, "IL", long), r(5, "KR", "good"), r(5, "GB", long, ["https://p"]), r(5, "IL", long), r(5, "US", long + " and more"), r(5, "FR", long)]);
  assert.deepEqual(out.map((x) => x.country), ["IL", "GB", "US"]);
  assert.deepEqual(pickReviews([r(4, "KR", long), r(3, "IL", long)]).map((x) => x.country), ["KR"], "4 stars when no 5");
  assert.deepEqual(pickReviews([]), []);
});

test("formatDeal: the buyer's quote, 'קונה מישראל' for Israel; no line without a review", () => {
  const p = item("1");
  assert.match(formatDeal(p, { name: "מטריה", review: { quote: "קלה וקטנה", country: "IL" } }), /💬 קונה מישראל: "קלה וקטנה"/);
  assert.match(formatDeal(p, { name: "מטריה", review: { quote: "קלה וקטנה", country: "KR" } }), /💬 מהביקורות: "קלה וקטנה"/);
  assert.doesNotMatch(formatDeal(p, { name: "מטריה" }), /💬/);
});

test("postDeal reviews: the chosen product's reviews reach the pick, the buyer photo is the 4th in the collage, failures still post", async () => {
  const photos = { string: ["https://ae01.alicdn.com/s1.jpg", "https://ae01.alicdn.com/s2.jpg", "https://ae01.alicdn.com/s3.jpg"] };
  const product = item("a", { product_small_image_urls: photos, lastest_volume: 90000 });
  const long = "Very light and small, fits in any bag easily";
  const logs = [];
  const run = async ({ reviews, collage }) => {
    const sent = [];
    let got = null;
    const pick = async (list, _w, opts) => ((got = await opts.reviews?.(list[0])), { i: 0, name: "מטריה", review: got?.length ? { quote: "קלה", country: "KR", photo: got[0].photos[0] } : null });
    await postDeal({}, { api: { sendPhoto: async (...a) => sent.push(a) }, chatId: 1, search: async () => [product], shorten: async (ps) => ps, pick, reviews, collage, log: (l) => logs.push(l) });
    return { sent, got };
  };
  const urls = [];
  const ok = await run({ reviews: async (id) => (assert.equal(id, "a"), [{ stars: 5, country: "KR", text: long, photos: ["https://buyer/1.jpg"] }]), collage: async (u) => (urls.push(u), Buffer.from("jpg")) });
  assert.equal(ok.got.length, 1);
  assert.equal(urls[0][3], "https://buyer/1.jpg");
  assert.match(ok.sent[0][2].caption, /💬 מהביקורות: "קלה"/);
  assert.ok(logs.includes("reviews: 1"));
  const tries = [];
  const fallback = await run({ reviews: async () => [{ stars: 5, country: "KR", text: long, photos: ["https://buyer/bad.jpg"] }], collage: async (u) => (tries.push(u), u[3].includes("buyer") ? Promise.reject(new Error("404")) : Buffer.from("jpg")) });
  assert.equal(tries.length, 2, "the buyer collage failed, the seller collage was tried");
  assert.ok(fallback.sent[0][1] instanceof Object);
  const broken = await run({ reviews: () => { throw new Error("blocked"); }, collage: async () => Buffer.from("jpg") });
  assert.deepEqual(broken.got, []);
  assert.equal(broken.sent.length, 1, "no reviews: the post still goes out");
  assert.ok(logs.includes("reviews: 0"));
});

test("nextTemplate: the styles take turns, never the same twice in a row, 'buyers' only with a review", () => {
  let last = null;
  const seen = [];
  for (let n = 0; n < 20; n++) {
    const reviews = n % 4 === 3 ? 0 : 3;
    const t = nextTemplate(last, reviews);
    assert.notEqual(t, last);
    if (!reviews) assert.ok(t !== "buyers" && t !== "reviews3");
    seen.push((last = t));
  }
  assert.deepEqual([...new Set(seen)].toSorted(), [...TEMPLATES].toSorted(), "every style shows up");
  assert.notEqual(nextTemplate("short", 0), "buyers");
  assert.notEqual(nextTemplate("beforeafter", 1), "reviews3", "3 buyers needs 2 reviews");
});

test("formatDeal styles: each keeps price, sold, the buy link and the search-bot link; empty parts fall back to classic", () => {
  const p = item("1", { lastest_volume: 31000 });
  const choice = { name: "מטריה", emoji: "☂️", headline: "קטנה כמו בקבוק", benefits: ["קלה", "UV"], review: { quote: "קלה וקטנה", country: "IL" }, why: "נכנסת לכל תיק ולא מתהפכת ברוח.",
    before: "מטריה ענקית שלא נכנסת לתיק", after: "קטנה כמו בקבוק מים", quotes: [{ quote: "קלה וקטנה", country: "IL" }, { quote: "שורדת רוח", country: "GB" }] };
  for (const template of TEMPLATES) {
    const post = formatDeal(p, { ...choice, template });
    assert.match(post, /💰|מחיר/, template);
    assert.match(post, template === "numbers" ? /קנו את זה/ : /נמכרו/, template);
    assert.match(post, /לרכישה בעלי אקספרס/, template);
    assert.match(post, /הבוט שלנו ימצא לכם/, template);
  }
  assert.doesNotMatch(formatDeal(p, { ...choice, template: "short" }), /✅|💬/, "short: headline and data only");
  assert.match(formatDeal(p, { ...choice, template: "why" }), /נכנסת לכל תיק/);
  assert.doesNotMatch(formatDeal(p, { ...choice, template: "why" }), /✅/);
  assert.match(formatDeal(p, { ...choice, template: "buyers" }), /^‏💬 <b>"קלה וקטנה"<\/b>\n‏— קונה מישראל/);
  assert.match(formatDeal(p, { ...choice, review: null, template: "buyers" }), /✅ קלה/, "buyers without a review is classic");
  assert.match(formatDeal(p, { ...choice, why: null, template: "why" }), /✅ קלה/, "why without its text is classic");
});

test("postDeal rotate: the pick is told the next style and the state keeps it; without rotate it is classic", async () => {
  const asked = [];
  const pick = async (_l, _w, opts) => (asked.push(typeof opts.template === "function" ? opts.template(false) : opts.template), { i: 0, name: "מנורה", template: typeof opts.template === "function" ? opts.template(false) : opts.template });
  const base = { api: { sendPhoto: async () => {} }, chatId: 1, search: async () => [item("a")], shorten: async (ps) => ps, pick, log: () => {} };
  const s1 = await postDeal({ template: "classic" }, { ...base, rotate: true });
  assert.equal(s1.template, "why");
  const s2 = await postDeal({ template: "why" }, { ...base, rotate: false });
  assert.equal(s2.template, "why", "a special leaves the turn alone");
  assert.deepEqual(asked, ["why", "classic"]);
});

test("postSet cheap: 3 best sellers under the cap from the next topics, skipping topics without one; the main turn moves on", async () => {
  const sent = [];
  const searched = [];
  const search = async (w, d) => (searched.push(d.maxIls), w === TOPICS[2][0] ? [] : [item(`${w}-a`, { target_sale_price: "12.00" }), item(`${w}-x`, { target_sale_price: "35.00", lastest_volume: 99000 })]);
  const api = { sendPhoto: async (...a) => sent.push(a) };
  const topics = TOPICS.map(([w, c]) => [w, c, `cat-${w}`, null]);
  const state = await postSet({ topic: 0, posted: [] }, { api, chatId: 1, search, shorten: async (ps) => ps, pick: async () => ({ i: 0, name: "שם" }), collage: async () => Buffer.from("jpg"), cheap: { maxIls: 20 }, topics, order: [1, 2, 3, 4, 5], usedAt: 1000, log: () => {} });
  assert.ok(searched.every((m) => m === 20), "searched with the cap");
  assert.match(sent[0][2].caption, /3 דברים שווים מתחת ל-20 ₪/);
  assert.doesNotMatch(sent[0][2].caption, /35/);
  assert.equal(state.posted.length, 3);
  assert.deepEqual(Object.keys(state.used), [TOPICS[1][0], TOPICS[3][0], TOPICS[4][0]], "topics 1, 3, 4 used (2 had nothing)");
  assert.equal(state.topic, 0, "the old turn index is left alone");
  assert.equal(state.setIndex, undefined, "the Thursday sets keep their own turn");
  const few = await postSet({ topic: 0, posted: [] }, { api, chatId: 1, search: async () => [], shorten: async (ps) => ps, pick: async () => ({ i: 0 }), collage: async () => null, cheap: { maxIls: 20 }, log: () => {} });
  assert.deepEqual(few, { topic: 0, posted: [] }, "fewer than 3: nothing posted");
});

test("specialFor: '3 under 20 ₪' is the 4th post, except Sunday and Thursday", () => {
  assert.deepEqual(specialFor({ hour: 10, wd: 1 }, "normal", null), { cheap: { maxIls: 20 } });
  assert.equal(specialFor({ hour: 10, wd: 0 }, "normal", null), null);
  assert.equal(specialFor({ hour: 10, wd: 4 }, "normal", null), null);
  assert.equal(specialFor({ hour: 11, wd: 1 }, "normal", null), null);
});

test("formatDeal new styles: numbers on top, before/after, numbered reasons, 3 buyers with flags; the closing line", () => {
  const p = item("1", { lastest_volume: 31000 });
  const choice = { name: "מטריה", emoji: "☂️", headline: "קטנה כמו בקבוק", benefits: ["קלה מאוד", "הגנה מ-UV", "נכנסת לתיק"], before: "מטריה שלא נכנסת לתיק", after: "קטנה כמו בקבוק", quotes: [{ quote: "קלה וקטנה", country: "IL" }, { quote: "שורדת רוח", country: "GB" }], closing: "שווה להציץ 👀" };
  const numbers = formatDeal(p, { ...choice, template: "numbers" });
  assert.match(numbers, /^‏📦 <b>מעל 31,000 קנו את זה<\/b>/);
  assert.doesNotMatch(numbers, /נמכרו:/, "not twice");
  assert.match(formatDeal(p, { ...choice, template: "beforeafter" }), /❌ מטריה שלא נכנסת לתיק\n‏✅ קטנה כמו בקבוק/);
  assert.match(formatDeal(p, { ...choice, template: "reasons" }), /1️⃣ קלה מאוד\n‏2️⃣ הגנה מ-UV\n‏3️⃣ נכנסת לתיק/);
  const three = formatDeal(p, { ...choice, template: "reviews3" });
  assert.match(three, /2 קונים מספרים:\n‏🇮🇱 "קלה וקטנה"\n‏🇬🇧 "שורדת רוח"/);
  assert.match(formatDeal(p, { ...choice, quotes: choice.quotes.slice(0, 1), template: "reviews3" }), /✅ קלה מאוד/, "one quote: classic");
  assert.match(formatDeal(p, { ...choice, before: null, template: "beforeafter" }), /✅ קלה מאוד/, "no before: classic");
  assert.match(formatDeal(p, choice), /<i>שווה להציץ 👀<\/i>\n‏🛒/, "the closing line sits above the buy link");
  assert.match(formatDeal(p, choice), /נמכרו: מעל 31,000\n\u200f\n\u200f<i>/, "with an empty line before it, apart from the numbers");
});

test("postDeal closing: the AI's own line when fresh; one used lately or missing takes the next of the 60", async () => {
  const captions = [];
  const run = (state, closing) => postDeal(state, { api: { sendPhoto: async (_c, _p, x) => captions.push(x.caption) }, chatId: 1, search: async () => [item(`p${captions.length}`)], shorten: async (ps) => ps, pick: async () => ({ i: 0, name: "מנורה", closing }), log: () => {} });
  const s1 = await run({}, "אור נעים לכל חדר");
  assert.match(captions[0], /<i>אור נעים לכל חדר<\/i>/);
  assert.deepEqual(s1.closings, ["אור נעים לכל חדר"]);
  const s2 = await run(s1, "אור נעים לכל חדר");
  assert.match(captions[1], new RegExp(`<i>${CLOSINGS[0]}</i>`), "a repeat: the list instead");
  const s3 = await run(s2, null);
  assert.match(captions[2], new RegExp(`<i>${CLOSINGS[1]}</i>`));
  assert.equal(s3.closingTurn, 1);
  assert.equal(CLOSINGS.length, 60);
  assert.equal(new Set(CLOSINGS).size, 60, "60 different lines");
  assert.ok(CLOSINGS.every((c) => !/\d|רק היום|אחרונים|אחרונות|נגמר|מוגבל|מהרו/.test(c)), "no numbers or fake urgency");
});

test("topicOrder: rested topics in the hour's window first, then rested ones, then the longest unused; no category twice in a row", () => {
  const day = 864e5, now = 100 * day;
  const topics = [
    ["night lamp", 39, "Lights", ["evening"]],
    ["car holder", 34, "Cars", ["morning"]],
    ["mug", 15, "Home", ["morning", "evening"]],
    ["earbuds", 44, "Electronics", ["noon"]],
    ["eye mask", 66, "Beauty", ["evening"]],
  ];
  const morning = topicOrder(topics, { hour: 8, now });
  assert.deepEqual(morning.slice(0, 2).toSorted(), [1, 2], "the morning topics first");
  const used = { "car holder": now - 2 * day, mug: now - 30 * day };
  const order = topicOrder(topics, { used, hour: 8, now });
  assert.equal(order[0], 2, "car holder was used 2 days ago; the mug rested");
  assert.equal(order.at(-1), 1, "inside 7 days: last");
  const all = { "night lamp": now - 1 * day, "car holder": now - 3 * day, mug: now - 2 * day, earbuds: now - 5 * day, "eye mask": now - 4 * day };
  assert.deepEqual(topicOrder(topics, { used: all, hour: 20, now }), [3, 4, 1, 2, 0], "all used lately: the longest unused first, window or not");
  const evening = topicOrder(topics, { hour: 20, now, recentCats: ["Lights"] });
  assert.notEqual(evening[0], 0, "the last post's category waits");
  assert.deepEqual(topicOrder(topics, { hour: 20, now }).slice(0, 3).toSorted(), [0, 2, 4]);
});

test("loadTopics: the built file as [words, id, category, windows]; missing or empty is null (TOPICS then)", async () => {
  const { writeFileSync, mkdtempSync } = await import("node:fs");
  const dir = mkdtempSync(`${(await import("node:os")).tmpdir()}/deal-topics-`);
  const file = `${dir}/t.json`;
  writeFileSync(file, JSON.stringify([{ words: "mug", category: 15, cat: "Kitchen", windows: ["morning"] }]));
  assert.deepEqual(loadTopics(file), [["mug", 15, "Kitchen", ["morning"]]]);
  writeFileSync(file, "[]");
  assert.equal(loadTopics(file), null);
  assert.equal(loadTopics(`${dir}/none.json`), null);
  assert.equal(Object.keys(CATS).length, 33);
});

test("runDeals: the main post follows the topic order and remembers the topic and its category", async () => {
  const searched = [];
  const state = await runDeals({}, {
    now: new Date("2026-11-02T06:30:00Z"), // 08:30 Israel time, a Monday, no sale
    force: true,
    names: async () => [],
    api: { sendPhoto: async () => {} },
    chatId: 1,
    search: async (w) => (searched.push(w), [item(`${w}-1`)]),
    shorten: async (ps) => ps,
    pick: async () => ({ i: 0, name: "x" }),
    log: () => {},
  });
  assert.equal(Object.keys(state.used).length, 1);
  assert.equal(Object.keys(state.used)[0], searched[0]);
  assert.ok(Array.isArray(state.recentCats));
});

test("numbers style needs 10,000 sold: the rotation skips it below, and the layout falls back to classic", () => {
  assert.notEqual(nextTemplate("why", 3, 4900), "numbers");
  assert.equal(nextTemplate("why", 3, 31000), "numbers");
  const post = formatDeal(item("1", { lastest_volume: 4900 }), { name: "x", benefits: ["a", "b"], template: "numbers" });
  assert.doesNotMatch(post, /קנו את זה/);
  assert.match(post, /נמכרו: מעל 4,900/);
});

test("postDeal recent: the last headlines and closing lines go to the pick, and the new headline is remembered (6 kept)", async () => {
  let seen = null;
  const pick = async (_l, _w, opts) => ((seen = opts.recent), { i: 0, name: "x", headline: "כותרת חדשה", closing: "שורה חדשה" });
  const state = { headlines: ["h1", "h2", "h3", "h4", "h5", "h6", "h7"], closings: ["c1"] };
  const next = await postDeal(state, { api: { sendPhoto: async () => {} }, chatId: 1, search: async () => [item("a")], shorten: async (ps) => ps, pick, log: () => {} });
  assert.deepEqual(seen, { headlines: ["h2", "h3", "h4", "h5", "h6", "h7"], closings: ["c1"] });
  assert.deepEqual(next.headlines, ["h3", "h4", "h5", "h6", "h7", "כותרת חדשה"]);
});
