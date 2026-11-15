import { test } from "node:test";
import assert from "node:assert/strict";
import { pickProduct, weakness, checkSpec, writeSpec, photoChoices, nextTrack, markUsed, dmText, captionList, WINNER, POST_CTA } from "../reel-style2.js";

const review = (stars, country = "ES", text = "Works great, chops garlic in seconds, very happy", photos = ["https://x/a.jpg", "https://x/b.jpg"]) => ({ stars, country, text, photos });
const product = (id, over = {}) => ({ product_id: id, product_title: "500/900ML Manual Garlic Chopper Vegetable Onion Cutter", lastest_volume: 12836, evaluate_rate: "98.0%", target_sale_price: "21.90", target_original_price: "43.81", product_small_image_urls: { string: ["https://s/0.jpg", "https://s/1.jpg", "https://s/2.jpg", "https://s/3.jpg", "https://s/4.jpg"] }, ...over });
const good = { stats: { evarageStar: 4.9 }, ratings: 7510, reviews: [review(5), review(5, "US"), review(5, "FR"), review(3, "IN", "Okay but 2 parts broke after a week"), review(4, "BR", "Good, 500 ml is enough for 2 people")] };

test("reel pick: the newest posted product that is a proven hit; used and weak ones are skipped", async () => {
  const items = {
    1: product("1"), // used already
    2: product("2", { lastest_volume: 9000 }), // not enough sales
    3: product("3", { evaluate_rate: "93.0%" }), // weak rating
    4: product("4", { product_title: "Earbuds for AirPods Pro case" }), // look-alike brand
    5: product("5"), // only two five-star photo reviews
    6: product("6"), // the one
    7: product("7"),
  };
  const feeds = { 3: { ...good, stats: { evarageStar: 4.5 } }, 5: { ...good, reviews: good.reviews.slice(1) } };
  const asked = [];
  const got = await pickProduct(["1", "2", "3", "4", "5", "6", "7"], {
    used: ["1"],
    details: async (ids) => ids.map((id) => items[id]),
    reviews: async (id) => (asked.push(id), feeds[id] ?? good),
    batch: 3,
  });
  assert.equal(got.product.product_id, "6");
  assert.deepEqual(asked, ["3", "5", "6"]); // the review feed is asked only for products that pass the free listing checks
  assert.equal(weakness(product("3", { evaluate_rate: "96.5%" }), { evarageStar: 4.5 }, good.reviews), null); // 96%+ positive is enough
});

test("reel pick: nothing qualifies -> null (the script then sends the owner a note instead of a video)", async () => {
  const got = await pickProduct(["1", "2"], { details: async (ids) => ids.map((id) => product(id, { lastest_volume: 500 })), reviews: async () => good });
  assert.equal(got, null);
  assert.equal(await pickProduct([], { details: async () => [], reviews: async () => good }), null);
});

// ---------------- the guards ----------------
const data = {
  product: product("1005006678217266"),
  variants: [{ props: { Color: "900ml-Green" }, salePrice: 33.79 }, { props: { Color: "500ml-Blue" }, salePrice: 21.9 }],
  stats: { evarageStar: 4.9 },
  ratings: 7510,
  reviews: good.reviews,
};
const choices = photoChoices(data);
const answer = (over = {}) => ({
  hook: { img: "s0", line1: "צריכים בצל ושום קצוצים?", line2: "דק, תוך שניות", accent: "תוך שניות" },
  winner_img: "s2",
  result: { before: "s1", after: "s3", line1: "כמה משיכות בחוט,", line2: "והכול קצוץ", accent: "קצוץ" },
  benefits: [{ img: "s4", line1: "שום, בצל, ירקות", line2: "ואפילו בשר", accent: "ואפילו בשר" }, { img: "r04_0", line1: "בלי חשמל", line2: "ובלי רעש", accent: "ובלי רעש" }],
  quotes: [{ review: 0, img: "r00_0", line1: "קוצץ מעולה,", line2: "חוסך המון זמן" }, { review: 1, img: "r01_1", line1: "עובד כל כך טוב.", line2: "ממש מרוצה" }, { review: 4, img: "r04_0", line1: "500 מ״ל מספיק", line2: "ל-2 אנשים" }],
  price_img: "s3",
  price_label: "בגודל 500 מ״ל",
  post_lines: ["🧅 בצל ושום קצוצים דק תוך כמה שניות.", "קונים נותנים לו 4.9 כוכבים מ-7,510 דירוגים."],
  hashtags: ["מטבח", "#בישול", "עלי_אקספרס", "bad tag!"],
  dm_name: "קוצץ",
  ...over,
});

test("reel guards: a good answer becomes the builder's spec, in the hand-written spec's shape", () => {
  const { spec, post, dmName, errors } = checkSpec(answer(), data, choices);
  assert.equal(errors, undefined);
  assert.equal(spec.hook.text, "צריכים בצל ושום קצוצים?<br>דק, <b>תוך שניות</b>");
  assert.equal(spec.winner.text, WINNER); // fixed, never the AI's
  assert.deepEqual(spec.quotes.map((q) => q.who), ["מספרד", "מארה״ב", "מברזיל"]);
  assert.equal(spec.price.variant, "500ml-Blue");
  assert.ok(post.includes(POST_CTA) && post.endsWith("#מטבח #בישול #עלי_אקספרס #bad_tag"), post);
  assert.equal(dmName, "קוצץ");
});

test("reel guards: a number that is not in the product data is rejected", () => {
  const { errors } = checkSpec(answer({ hook: { img: "s0", line1: "קוצץ ב-3 שניות", line2: "בלי מאמץ", accent: "בלי מאמץ" } }), data, choices);
  assert.ok(errors.some((e) => /hook: the number 3 /.test(e)), errors.join("\n"));
  // a quote may only use its own buyer's numbers (or the title's): review 0 did not write 2
  const q = checkSpec(answer({ quotes: [{ review: 0, img: "r00_0", line1: "מספיק ל-2", line2: "מושלם" }, answer().quotes[1], answer().quotes[2]] }), data, choices);
  assert.ok(q.errors.some((e) => /quote 0: the number 2 /.test(e)), q.errors.join("\n"));
  assert.ok(!checkSpec(answer({ post_lines: ["🧅 קוצץ מעולה", "נמכר 20,000 פעמים"] }), data, choices).post.includes("20,000")); // the post: the line is dropped
});

test("reel guards: a quote from a 3-star review, or with another review's photo, is rejected", () => {
  const three = checkSpec(answer({ quotes: [{ review: 3, img: "r03_0", line1: "בסדר גמור", line2: "ממש טוב" }, answer().quotes[1], answer().quotes[2]] }), data, choices);
  assert.ok(three.errors.some((e) => /quote 0: review 3 is not a 4-5 star/.test(e)), three.errors.join("\n"));
  const other = checkSpec(answer({ quotes: [{ review: 0, img: "r01_0", line1: "קוצץ מעולה,", line2: "חוסך המון זמן" }, answer().quotes[1], answer().quotes[2]] }), data, choices);
  assert.ok(other.errors.some((e) => /photo "r01_0" is not from review 0/.test(e)));
});

test("reel guards: a photo that doesn't exist, an emoji, a long line or a stray accent are rejected", () => {
  const { errors } = checkSpec(answer({ winner_img: "s9", benefits: [{ img: "s4", line1: "שום, בצל וירקות 🧄", line2: "ואפילו בשר ודגים ועוד המון דברים", accent: "גבינה" }, answer().benefits[1]] }), data, choices);
  for (const want of [/winner: photo "s9"/, /benefit 0: no emoji/, /benefit 0: .* longer than 24/, /benefit 0: accent "גבינה"/]) assert.ok(errors.some((e) => want.test(e)), `${want}\n${errors.join("\n")}`);
});

// ---------------- the AI call: one retry, then give up ----------------
const openai = (bodies) => {
  let n = 0;
  const fetch = async () => ({ ok: true, json: async () => ({ status: "completed", usage: { input_tokens: 1000, output_tokens: 500 }, output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(bodies[n++]) }] }] }) });
  return { fetch, calls: () => n };
};

test("reel AI: a rejected answer is asked once more, then the spec is used", async () => {
  const ai = openai([answer({ winner_img: "nope" }), answer()]);
  const got = await writeSpec(data, choices, { fetch: ai.fetch, env: { OPENAI_API_KEY: "k" } });
  assert.equal(got.tries, 2);
  assert.ok(got.spec);
});

test("reel AI: two rejected answers -> errors, no spec (the owner gets a note, not a bad video)", async () => {
  const ai = openai([answer({ winner_img: "nope" }), answer({ winner_img: "nope" }), answer()]);
  const got = await writeSpec(data, choices, { fetch: ai.fetch, env: { OPENAI_API_KEY: "k" } });
  assert.equal(ai.calls(), 2);
  assert.equal(got.spec, undefined);
  assert.ok(got.errors.length);
});

// ---------------- tracks ----------------
test("reel tracks: one reel a day for 60 days never repeats a track within 10 days", () => {
  const pool = ["03.m4a", "04.m4a", "05.m4a", "07.m4a", "08.m4a", "09.m4a", "10.m4a", "11.m4a", "12.m4a", "13.m4a"];
  let state = {};
  const seen = {};
  for (let day = 0; day < 60; day++) {
    const now = Date.UTC(2026, 10, 16, 3) + day * 864e5;
    const t = nextTrack(state, pool, now);
    if (seen[t] !== undefined) assert.ok(day - seen[t] >= 10, `${t} on day ${seen[t]} and ${day}`);
    seen[t] = day;
    state = markUsed(state, `p${day}`, t, now);
  }
  assert.equal(state.used.length, 60);
});

test("reel tracks: when every track was used in the last 10 days, the one used longest ago", () => {
  const now = Date.UTC(2026, 10, 16);
  const state = { tracks: [{ file: "a", at: now - 3 * 864e5 }, { file: "b", at: now - 1 * 864e5 }, { file: "c", at: now - 5 * 864e5 }] };
  assert.equal(nextTrack(state, ["a", "b", "c"], now), "c");
  assert.equal(nextTrack(state, ["a", "b", "c", "d"], now), "d"); // never used: first
});

// ---------------- what the owner gets ----------------
test("reel DM: the product link first, then the deals channel (owner, 2026-11-14)", () => {
  assert.equal(dmText("קוצץ", "https://s.click.aliexpress.com/e/_abc"), "הנה הקישור לקוצץ 👇\nhttps://s.click.aliexpress.com/e/_abc\n\nואם אתם אוהבים דילים כאלה, יש לי ערוץ עם דילים חדשים כל יום:\nt.me/panda_dilim");
});

test("reel captions: every caption in the order it plays, as plain text", () => {
  const { spec } = checkSpec(answer(), data, choices);
  const list = captionList(spec, data);
  assert.ok(!/<b>|<br>/.test(list));
  const order = ["צריכים בצל ושום קצוצים? דק, תוך שניות", "הפנדה בדק עשרות מוצרים. זה המנצח", "כמה משיכות בחוט, והכול קצוץ", "ואפילו בשר", "ובלי רעש", "חוסך המון זמן", "ממש מרוצה", "ל-2 אנשים", "₪21.90, בגודל 500 מ״ל", "רוצים את הקישור? כתבו פנדה בתגובות, ואשלח לכם בפרטי"];
  let at = 0;
  for (const s of order) { const i = list.indexOf(s, at); assert.ok(i >= at, `${s} missing or out of order`); at = i; }
});

test("reel guards: a bad price label is dropped, a Latin model name is kept", () => {
  assert.equal(checkSpec(answer({ price_label: "בגודל 900 מ״ל" }), data, choices).spec.price.label, ""); // 900 is not the shown variant's
  const phone = { ...data, variants: [{ props: { Model: "iPhone 16" }, salePrice: 21.9 }] };
  assert.equal(checkSpec(answer({ price_label: "ל-iPhone 16" }), phone, choices).spec.price.label, "ל-iPhone 16");
});

test("reel guards: post extras never block a video: bad tags are cleaned or filled, a bad DM name falls back, a line with an invented number is dropped", () => {
  const got = checkSpec(answer({ hashtags: ["עלי אקספרס", "טעינה-מהירה", "!!"], dm_name: "a very long english name here", post_lines: ["⚡ טעינה מהירה ברכב", "נמכר 99,999 פעמים"] }), data, choices);
  assert.equal(got.errors, undefined);
  assert.ok(got.post.endsWith("#עלי_אקספרס #טעינה_מהירה #דילים"), got.post);
  assert.ok(!got.post.includes("99,999"));
  assert.equal(got.dmName, "מוצר");
});

test("reel guards: no period at a caption's end; the post never repeats the call to action and loses its dashes (first GitHub run, 2026-11-15)", () => {
  const got = checkSpec(answer({ hook: { img: "s0", line1: "צריכים בצל קצוץ?", line2: "יש פתרון פשוט.", accent: "פתרון פשוט" }, post_lines: ["🔒 מצאתי קוצץ מעולה — באמת", "יש לו 4.9 כוכבים", "אם רוצים את הקישור, כתבו לי."] }), data, choices);
  assert.equal(got.spec.hook.text, "צריכים בצל קצוץ?<br>יש <b>פתרון פשוט</b>");
  assert.ok(got.post.startsWith("🔒 מצאתי קוצץ מעולה, באמת\nיש לו 4.9 כוכבים\n\n"), got.post);
});
