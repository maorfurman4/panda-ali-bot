import { test } from "node:test";
import assert from "node:assert/strict";
import { candidates, formatDeal, postDeal, TOPICS } from "../deals.js";

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
  assert.match(text, /👍 משוב חיובי: 98% · 🛒 נמכרו: מעל 800/);
  assert.match(text, /₪29\.90/);
  assert.match(text, /50% הנחה/);
  assert.match(text, /s\.click\.aliexpress\.com\/e\/a/);
  assert.match(text, /t\.me\/panda_deals_il/);
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
