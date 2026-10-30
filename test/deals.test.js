import { test } from "node:test";
import assert from "node:assert/strict";
import { candidates, formatDeal, postDeal, runDeals, activeSale, saleBanner, israelTime, TOPICS } from "../deals.js";

const item = (id, extra = {}) => ({
  product_id: id,
  product_title: `מנורת לילה LED חכמה ${id}`,
  evaluate_rate: "97.5%",
  lastest_volume: 800,
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
    item("few", { lastest_volume: 10 }),
    item("nolink", { promotion_link: "" }),
    item("part", { product_title: "חלקי חילוף לשואב רובוטי" }),
    item("old"),
  ];
  assert.deepEqual(candidates(list, ["old"]).map((p) => p.product_id), ["ok"]);
});

test("formatDeal: AI headline, name, benefits and warning, price, trust, short link and the search group link", () => {
  const ai = { emoji: "💡", headline: "נמאס לכם מחושך?", name: "מנורת לילה חכמה", benefits: ["נדלקת לבד בתנועה", "אור רך לחדר הילדים", "נטענת ב-USB"], warning: "לא לשימוש בחוץ" };
  const text = formatDeal(item("a", { target_original_price: "59.90" }), ai);
  assert.match(text, /💡 <b>נמאס לכם מחושך\?<\/b>/);
  assert.match(text, /<b>מנורת לילה חכמה<\/b>/);
  assert.equal(text.match(/✅/g).length, 3);
  assert.match(text, /⚠️ לא לשימוש בחוץ/);
  assert.match(text, /👍 משוב חיובי: 98%\n\u200f📦 נמכרו: מעל 800/, "sold on its own line under the feedback");
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
  assert.deepEqual(searches, [TOPICS[1]]);
  assert.equal(sent[0][0], -100);
  assert.equal(sent[0][1], "https://ae01.alicdn.com/2.jpg");
  assert.deepEqual(sent[0][2].reply_markup.inline_keyboard, [[{ text: "🛒 לקנייה בעלי אקספרס", url: "https://s.click.aliexpress.com/e/2" }]], "a buy button under the post");
  assert.deepEqual(state, { topic: 1, posted: ["9", "2"] });
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
