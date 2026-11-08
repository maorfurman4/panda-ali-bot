// Daily-deals bot: a separate Telegram bot that posts one best-selling AliExpress product to its own channel, a few times a day.
// It has no server: scripts/daily-deal.js runs it from a scheduled GitHub Action (see .github/workflows/daily-deals.yml).
import { readFileSync } from "node:fs";
import { InputFile } from "grammy";
import { searchProducts, shortenLinks, promoNames } from "./aliexpress.js";
import { makeCollage } from "./collage.js";
import { pickDeal as defaultPick } from "./query.js";
import { RLM, esc, shortTitle, soldText, priceLine, formatPrice, discountLine, vatLine, ratingText, parseEvaluateRate, dedupeProducts, isPartFor, GROUP_LINK, couponLine } from "./format.js";

// One topic per post, in turn. Every topic was measured on 2026-10-30: the median sales of its top 3 items that pass our
// filters were at least ~9,000 (weak topics such as building blocks at 3,000 were dropped; 150 topics tested). Each row
// mixes kinds so the channel doesn't see three gadgets in a row. [English search words, AliExpress main category]
export const TOPICS = [
  ["wireless earbuds", 44], ["kitchen storage organizer", 15], ["car trunk organizer", 34], ["night light", 39], ["makeup brush set", 66],
  ["fast charger usb c", 509], ["resistance bands", 18], ["tool set", 1420], ["travel organizer bag", 1524], ["fidget toy", 26],
  ["bluetooth speaker", 44], ["oil sprayer", 15], ["windshield sun shade", 34], ["led flashlight", 39], ["nail clipper set", 66],
  ["usb c cable", 509], ["bike light", 18], ["screwdriver bits set", 1420], ["card holder wallet", 1524], ["hair clip", 200000297],
  ["micro sd memory card", 7], ["vegetable chopper", 15], ["car air freshener", 34], ["solar garden light", 39], ["teeth whitening", 66],
  ["smart plug", 13], ["hiking backpack", 1524], ["socks", 200574005], ["gel pen", 21], ["cutting board", 15],
  ["wireless mouse", 7], ["knife sharpener", 15], ["tire inflator", 34], ["string lights", 39], ["massager", 66],
  ["usb hub", 7], ["cleaning mop", 15], ["usb fan", 6], ["nail art", 66], ["storage box", 15],
  ["shower head", 13], ["kitchen gadgets", 15], ["sleep eye mask", 66], ["clothes hanger", 15], ["door seal strip", 13],
  ["umbrella", 15], ["thermometer", 66], ["cat toy", 15],
];


// The 33 categories of the search-bot studies: AliExpress id (null: searched anywhere only) and the hours they suit
// (owner, 2026-11-08: product by hour; a first guess per category, to be tuned from the owner's feedback).
// morning 7-10: commute, car, coffee; noon 11-14: gadgets, office; afternoon 15-18: kids, sport, going out;
// evening 19-23: home, beauty, sleep, fashion.
export const WINDOW_HOURS = { morning: [7, 10], noon: [11, 14], afternoon: [15, 18], evening: [19, 23] };
export const CATS = {
  "Consumer Electronics": { id: 44, windows: ["noon", "evening"] },
  "Phones & Accessories": { id: 509, windows: ["morning", "noon"] },
  "Computer & Office": { id: 7, windows: ["noon"] },
  "Home Appliances": { id: 6, windows: ["morning", "evening"] },
  "Home & Garden": { id: 15, windows: ["evening", "afternoon"] },
  "Home Improvement": { id: 13, windows: ["noon", "evening"] },
  Tools: { id: 1420, windows: ["noon", "afternoon"] },
  "Lights & Lighting": { id: 39, windows: ["evening"] },
  Furniture: { id: 1503, windows: ["evening"] },
  "Security & Protection": { id: 30, windows: ["noon", "evening"] },
  Automobiles: { id: 34, windows: ["morning", "afternoon"] },
  Motorcycle: { id: 201355758, windows: ["morning", "afternoon"] },
  "Sports & Entertainment": { id: 18, windows: ["morning", "afternoon"] },
  "Sports Clothing & Shoes": { id: 201768104, windows: ["morning", "afternoon"] },
  Shoes: { id: 322, windows: ["afternoon", "evening"] },
  "Women's Clothing": { id: 200000345, windows: ["evening"] },
  "Men's Clothing": { id: 200000343, windows: ["evening"] },
  Underwear: { id: 200574005, windows: ["evening"] },
  "Apparel Accessories": { id: 200000297, windows: ["afternoon", "evening"] },
  Jewelry: { id: 36, windows: ["evening"] },
  Watches: { id: 1511, windows: ["noon", "evening"] },
  "Luggage & Bags": { id: 1524, windows: ["morning", "afternoon"] },
  "Beauty & Health": { id: 66, windows: ["evening"] },
  "Hair & Wigs": { id: null, windows: ["evening"] },
  "Mother & Kids": { id: 1501, windows: ["afternoon"] },
  "Toys & Hobbies": { id: 26, windows: ["afternoon"] },
  "Office & School": { id: 21, windows: ["morning", "noon"] },
  "Weddings & Events": { id: 320, windows: ["afternoon"] },
  "Novelty & Gifts": { id: null, windows: ["afternoon", "evening"] },
  "Electronic Components": { id: null, windows: ["noon"] },
  Food: { id: null, windows: ["morning", "afternoon"] },
  "Books & Culture": { id: 202228412, windows: ["afternoon"] },
  Kitchen: { id: 15, windows: ["morning", "evening"] },
};

// The main rotation's topics: deal-topics.json (built by scripts/build-deal-topics.js), else the 48 TOPICS. Each is
// [English search words, category id or null, category name or null, time windows or null].
export function loadTopics(file = new URL("./deal-topics.json", import.meta.url)) {
  try {
    const list = JSON.parse(readFileSync(file, "utf8"));
    return Array.isArray(list) && list.length ? list.map((t) => [t.words, t.category ?? null, t.cat ?? null, t.windows ?? null]) : null;
  } catch {
    return null;
  }
}

export const DEAL_TOPICS = loadTopics() ?? TOPICS.map(([w, c]) => [w, c, null, null]);

// The order to try the main topics in, best first (owner, 2026-11-08: product by hour, no repeat within 7 days):
// 1. rested 7+ days and the hour is in its window; 2. rested, any hour; 3. the rest, the longest unused first.
// Inside 1 and 2: a category not among the last posts first, then a shuffle that changes every day.
const REST_MS = 7 * 864e5;
const mixOf = (text) => [...text].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261);
export function topicOrder(topics, { used = {}, recentCats = [], hour, now = Date.now() } = {}) {
  const day = Math.floor(now / 864e5);
  const fits = (windows) => !windows || windows.some((w) => hour >= WINDOW_HOURS[w][0] && hour <= WINDOW_HOURS[w][1]);
  const info = topics.map(([words, , cat, windows], i) => {
    const last = used[words] ?? 0;
    const rested = now - last >= REST_MS;
    return { i, last, rank: rested ? (fits(windows) ? 0 : 1) : 2, again: recentCats.includes(cat) ? 1 : 0, mix: mixOf(`${words}|${day}`) };
  });
  return info.sort((a, b) => a.rank - b.rank || (a.rank < 2 ? a.again - b.again || a.mix - b.mix : a.last - b.last)).map((x) => x.i);
}
const MAIN_TRIES = 12; // topics tried before an hour gives up (each try is 2 searches and maybe an AI call)
const KEEP_USED_MS = 30 * 864e5;

const MIN_FEEDBACK = 93; // ≈4.7 stars; 95 (≈4.8) left out 45% of strong sellers (2026-11-01)
// The regular search sorted by sales holds the real best sellers: 10x the sales of the "hot products" list (earbuds:
// top 28,689 vs 3,045, median 10,789 vs 401; checked 2026-10-30), for 7% commission instead of ~8%.
const MIN_SOLD = 3000; // owner: only the strongest products
const MIN_SOLD_SALE = 500; // AliExpress's sale lists sell less (median ~1,300) and are curated by AliExpress itself
const MIN_SOLD_HOLIDAY = 300; // holiday items (menorahs, costumes) are seasonal and sell less than everyday best sellers
const TO_AI = 5; // best sellers the AI sees; it takes the first that IS the topic's item (told to pick "appealing", it took #8 of 8)
export const BUY_LABEL = "🛒 לקנייה בעלי אקספרס";
const KEEP_POSTED = 500; // product ids remembered so a deal isn't posted twice

// Posting hours (Israel time) by kind of day (owner: more posts on sale days, the most on the big shopping days).
// 07:00 is the first post and 23:00 the last of every day (owner, 2026-10-30/31).
// Every hour, 07:00-23:00, on every kind of day (owner, 2026-11-04: a deal every hour; every half hour would flood the
// channel and use up the strong products). Sale and peak days keep their banners and sale lists.
const HOURLY = Array.from({ length: 17 }, (_, i) => 7 + i);
export const SCHEDULE = { normal: HOURLY, sale: HOURLY, peak: HOURLY };
// The big shopping days (MM-DD). shortcut: Black Friday and Cyber Monday move every year (these are 2026); update each autumn.
export const PEAK_DAYS = { "11-11": "11.11", "11-27": "בלאק פריידיי", "11-30": "סייבר מאנדיי", "12-12": "12.12" };

export function israelTime(now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit", hour: "numeric", hourCycle: "h23", weekday: "short" })
      .formatToParts(now)
      .map((x) => [x.type, x.value]),
  );
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday);
  return { day: `${parts.year}-${parts.month}-${parts.day}`, md: `${parts.month}-${parts.day}`, hour: Number(parts.hour), wd };
}

// Holidays by their Hebrew date (Intl's Hebrew calendar), so the dates never need updating; back to school by the civil
// date. From LEAD_DAYS before, one post a day is a holiday item (owner: a month ahead, for AliExpress delivery times).
// shortcut: the holiday topics are a first guess; check their sales like TOPICS when a holiday comes close.
const LEAD_DAYS = 30;
export const HOLIDAYS = [
  { month: /^Kislev$/, day: 25, name: "חנוכה", emoji: "🕎", topics: [["hanukkah menorah", null], ["led candle lights", 39], ["kids board game", 26], ["string lights", 39]] },
  { month: /^Adar( II)?$/, day: 14, name: "פורים", emoji: "🎭", topics: [["kids costume", 26], ["party mask", 26], ["face paint kids", 66], ["party wig", null]] },
  { month: /^Nisan$/, day: 15, name: "פסח", emoji: "🍷", topics: [["kitchen storage containers", 15], ["tablecloth", 15], ["cleaning brush set", 15], ["wine glasses", 15]] },
  { month: /^Sivan$/, day: 6, name: "שבועות", emoji: "🌾", topics: [["flower crown", 200000297], ["picnic blanket", 18], ["cheese board", 15]] },
  { month: /^Tishri$/, day: 1, name: "ראש השנה", emoji: "🍎", topics: [["honey dish", 15], ["table decoration", 15], ["gift box set", 15]] },
  { month: /^Tishri$/, day: 15, name: "סוכות", emoji: "🌿", topics: [["string lights", 39], ["hanging decoration", 15], ["camping chair", 18]] },
  { month: /^Shevat$/, day: 15, name: "ט״ו בשבט", emoji: "🌳", topics: [["plant pot", 15], ["garden tools set", 15], ["seed starter kit", 15]] },
  { civil: "09-01", name: "החזרה ללימודים", emoji: "🎒", topics: [["school backpack", 1524], ["pencil case", 21], ["lunch box", 15], ["gel pen", 21]] },
];
const hebrewDate = new Intl.DateTimeFormat("en-u-ca-hebrew", { timeZone: "Asia/Jerusalem", month: "long", day: "numeric" });
const civilDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", month: "2-digit", day: "2-digit" });

// The nearest holiday from tomorrow to LEAD_DAYS ahead, with the days left, or null.
export function upcomingHoliday(now = new Date(), lead = LEAD_DAYS) {
  for (let days = 1; days <= lead; days++) {
    const d = new Date(now.getTime() + days * 864e5);
    const heb = Object.fromEntries(hebrewDate.formatToParts(d).map((x) => [x.type, x.value]));
    const [month, day] = civilDate.format(d).split("-");
    const h = HOLIDAYS.find((x) => (x.civil ? x.civil === `${month}-${day}` : x.month.test(heb.month) && Number(heb.day) === x.day));
    if (h) return { ...h, days };
  }
  return null;
}

// The weekly series, one post on its day (owner, 2026-10-31): [weekday 0 = Sunday, banner, topic filter, max price].
const SERIES = [
  { wd: 0, banner: "💸 מתחת ל-10 ₪", maxIls: 10 },
  { wd: 3, banner: "⚡ גאדג'ט השבוע", categories: [44, 509, 7, 6, 39] },
  { wd: 5, banner: "🕯️ לבית לשבת", categories: [15, 13, 39] },
];

// "The perfect set" on Thursday: three best sellers that go together, in one post (owner, 2026-10-31), in turn.
export const SETS = [
  { name: "טעינה", emoji: "⚡", topics: [["fast charger usb c", 509], ["usb c cable", 509], ["car phone holder", 34]] },
  { name: "מטבח", emoji: "🍳", topics: [["kitchen storage organizer", 15], ["oil sprayer", 15], ["vegetable chopper", 15]] },
  { name: "לרכב", emoji: "🚗", topics: [["car trunk organizer", 34], ["car air freshener", 34], ["tire inflator", 34]] },
  { name: "טיפוח", emoji: "💄", topics: [["makeup brush set", 66], ["nail clipper set", 66], ["sleep eye mask", 66]] },
  { name: "שולחן עבודה", emoji: "💻", topics: [["wireless mouse", 7], ["usb hub", 7], ["micro sd memory card", 7]] },
  { name: "ספורט ויציאה", emoji: "🏃", topics: [["resistance bands", 18], ["bike light", 18], ["hiking backpack", 1524]] },
];
const SET_DAY = 4; // Thursday
const CHEAP_MAX_ILS = 20;

// What one post of the day is: the holiday item (the day's second-to-last post) and the weekly series (its third post).
export function specialFor(t, kind, holiday) {
  const hours = SCHEDULE[kind];
  if (holiday && t.hour === hours.at(-2)) {
    return { key: "holidayTopic", topics: holiday.topics, minSold: MIN_SOLD_HOLIDAY, banner: `${holiday.emoji} לקראת ${holiday.name} · עוד ${holiday.days} ימים · מזמינים עכשיו שיגיע בזמן` };
  }
  if (t.wd === SET_DAY && t.hour === hours[2]) return { set: true };
  // "Really worth it / trending" twice a day (the 6th and 12th posts): ranked by the data, not by sales alone.
  if (t.hour === hours[5] || t.hour === hours[11]) return { worth: true };
  // "3 things under 20 ₪" once a day, not on the days that already have a cheap or a set post (Sunday, Thursday).
  if (t.hour === hours[3] && t.wd !== 0 && t.wd !== SET_DAY) return { cheap: { maxIls: CHEAP_MAX_ILS } };
  const series = SERIES.find((x) => x.wd === t.wd);
  if (series && t.hour === hours[2]) {
    const topics = series.categories ? DEAL_TOPICS.filter(([, c]) => series.categories.includes(c)) : DEAL_TOPICS;
    return { key: `series${series.wd}Topic`, topics, maxIls: series.maxIls ?? null, banner: series.banner };
  }
  return null;
}

// AliExpress dates its sale lists in the name: "1101-1118 11.11 Sale - Bestsellers" runs 1 to 18 November.
// shortcut: a sale that crosses New Year is never active; fine while the dated lists are 11.11-style.
export function activeSale(names, md) {
  const lists = names.filter((n) => {
    const m = n.match(/^(\d\d)(\d\d)-(\d\d)(\d\d)\s/);
    return m && `${m[1]}-${m[2]}` <= md && md <= `${m[3]}-${m[4]}`;
  });
  return lists.length ? { label: lists[0].replace(/^\S+\s+/, "").replace(/\s*sale\b.*$/i, "").replace(/\s+-.*$/, "").trim(), lists } : null;
}

// The line above every post on a sale or peak day: "🔥 היום זה 11.11!", "🛍️ מבצעי 11.11 · עוד 9 ימים!".
export function saleBanner(sale, { day, md }) {
  if (PEAK_DAYS[md]) return `🔥 היום זה ${PEAK_DAYS[md]}!`;
  if (!sale) return null;
  const m = sale.label.match(/^(\d{1,2})\.(\d{1,2})$/); // "11.11" is 11 November
  const days = m ? Math.round((Date.UTC(+day.slice(0, 4), +m[2] - 1, +m[1]) - Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10))) / 864e5) : 0;
  return `🛍️ מבצעי ${sale.label}${days === 1 ? " · מחר!" : days > 1 ? ` · עוד ${days} ימים!` : ""}`;
}

// Proven, complete, not-yet-posted items, most sold first (feedback is only a floor: 6,600 sold beats 4,900).
export function candidates(products, posted = [], minSold = MIN_SOLD) {
  const seen = new Set(posted.map(String));
  const good = products.filter(
    (p) =>
      parseEvaluateRate(p.evaluate_rate) >= MIN_FEEDBACK &&
      Number(p.lastest_volume) >= minSold &&
      /^https:\/\//.test(p.promotion_link ?? "") &&
      p.product_main_image_url &&
      !seen.has(String(p.product_id)) &&
      !isPartFor(p.product_title),
  );
  return dedupeProducts(good.toSorted((a, b) => Number(b.lastest_volume) - Number(a.lastest_volume)));
}

// The reviews worth showing: 5 stars (4 when no 5), a real sentence, buyers from Israel first, then with a photo, then the
// longer text; at most 3 go to the AI, which picks one and quotes it in Hebrew.
export function pickReviews(reviews = []) {
  const real = reviews.filter((r) => (r.text.match(/\p{L}/gu) ?? []).length >= 25 && r.text.split(/\s+/).length >= 4);
  const top = real.some((r) => r.stars === 5) ? 5 : 4;
  return real
    .filter((r) => r.stars === top)
    .toSorted((a, b) => (b.country === "IL") - (a.country === "IL") || (b.photos.length > 0) - (a.photos.length > 0) || b.text.length - a.text.length)
    .slice(0, 3);
}

// The post styles in turn (owner, 2026-11-08: vary them so the channel reads like something, not a bot). Never the same
// style twice in a row; "buyers" needs a review and "reviews3" two. Specials keep "classic".
export const TEMPLATES = ["classic", "why", "numbers", "short", "buyers", "beforeafter", "reasons", "reviews3"];
const NEEDS_REVIEWS = { buyers: 1, reviews3: 2 };
const NUMBERS_MIN_SOLD = 10000; // "2,800 bought it" on top makes an item look small (2026-11-08 preview)
export function nextTemplate(last, reviewCount = 0, sold = Infinity) {
  const from = TEMPLATES.indexOf(last);
  for (let k = 1; k <= TEMPLATES.length; k++) {
    const t = TEMPLATES[(from + k) % TEMPLATES.length];
    if (t !== last && Number(reviewCount) >= (NEEDS_REVIEWS[t] ?? 0) && (t !== "numbers" || Number(sold) >= NUMBERS_MIN_SOLD)) return t;
  }
  return "classic";
}

// The line before the buy link when the AI's own closing is missing or was used lately: 60 lines in turn (owner,
// 2026-11-08: "different closing lines for 60 days"). No numbers, no price, no fake urgency; they fit any product.
export const CLOSINGS = [
  "שווה להציץ 👀", "אחד השימושיים שראינו לאחרונה", "קטן, זול, ועושה את העבודה", "מהדברים שקונים פעם אחת ושמחים",
  "נראה לנו שתאהבו", "הקונים כבר הצביעו בארנק", "בדקנו, וזה שווה", "מושלם גם כמתנה קטנה",
  "עוד אחד לרשימת \"למה לא קניתי קודם\"", "פתרון קטן לעניין של כל יום", "תשמרו לעצמכם, או תשלחו למי שצריך",
  "מהמוצרים שפשוט עובדים", "בלי הרבה מילים: שווה", "מישהו בבית עוד יודה לכם", "לפעמים לא צריך יותר מזה",
  "מהרכישות שלא מתחרטים עליהן", "הדבר הקטן שעושה הבדל", "שימושי יותר ממה שנראה", "תעשו לעצמכם טובה",
  "קנייה חכמה, בלי לחשוב פעמיים", "אהבנו, ואנחנו לא לבד", "תוסיפו לסל ותודו לנו אחר כך", "עוד מציאה ששווה לשמור",
  "לפעמים הדברים הפשוטים הם הכי טובים", "מאלה שלא מבינים איך הסתדרו בלעדיהם", "תשלחו למי שתמיד מחפש כאלה",
  "זה בדיוק מה שהיה חסר", "הפנדה מאשר 🐼", "קונים אחד, ואז עוד אחד למתנה", "סגרנו לכם את החיפוש", "שווה כל שקל",
  "עובד, נוח, וזהו", "כזה שמשתמשים בו כל יום", "יאללה, מגיע לכם", "הקלה קטנה לשגרה", "מהמוצרים שכולם שואלים \"מאיפה זה?\"",
  "תנו לזה צ'אנס", "מציאה אמיתית, לא עוד פרסומת", "המלצה חמה מהערוץ", "ממליצים בחום", "מזמינים, שוכחים, ושמחים כשזה מגיע",
  "פשוט, יעיל, משתלם", "עוד דרך קטנה לחסוך כאב ראש", "בחירה בטוחה", "בשביל זה יש עלי אקספרס", "מאיתנו, באהבה 💛",
  "קטן בגודל, גדול בתועלת", "לא תצטערו", "שמים בסל, ממשיכים בחיים", "מתנה טובה גם לעצמכם", "ההמלצה שלנו להיום",
  "מהדברים שעושים את היום קצת יותר קל", "קונים רבים כבר נהנים ממנו", "שווה לפחות הצצה", "מה שצריך, במחיר שנעים לשלם",
  "מהקניות הקטנות ששמחים עליהן הכי הרבה", "בשביל השקט הנפשי", "עוד אחד ששווה לשמור במועדפים", "תודו שחשבתם על זה גם",
  "טוב שמצאנו את זה",
];
const KEEP_CLOSINGS = 100; // the AI's closing lines remembered, so one that came back lately is not used again

// A country code as its flag (IL -> 🇮🇱); anything else a speech bubble.
const flag = (code) => (/^[A-Z]{2}$/.test(code ?? "") ? String.fromCodePoint(...[...code].map((c) => 0x1f1a5 + c.charCodeAt(0))) : "💬");

// AI parts (headline, benefits, warning, review, why) are optional: without them the post is the plain card under
// "הדיל של עכשיו". The data lines (price to the search-bot link) are the same in every style.
export function formatDeal(p, { name, emoji, headline, benefits = [], warning, review, why, before, after, quotes = [], closing, tag, template = "classic" } = {}, banner = null) {
  const sold = soldText(p.lastest_volume);
  const title = `<b>${esc(name || shortTitle(p.product_title) || "מוצר")}</b>`;
  const head = `${emoji || "🔥"} <b>${esc(headline || "הדיל של עכשיו")}</b>`;
  const quote = review?.quote && `💬 ${review.country === "IL" ? "קונה מישראל" : "מהביקורות"}: "${esc(review.quote)}"`;
  const ready = { buyers: review?.quote, why, numbers: sold && Number(p.lastest_volume) >= NUMBERS_MIN_SOLD, beforeafter: before && after, reasons: benefits.length >= 2, reviews3: quotes.length >= 2 };
  const style = template in ready && !ready[template] ? "classic" : template;
  const top = {
    classic: [head, title, ...(benefits.length ? ["", ...benefits.map((b) => `✅ ${esc(b)}`)] : []), warning && `⚠️ ${esc(warning)}`, quote],
    short: [head, title, warning && `⚠️ ${esc(warning)}`],
    why: [head, title, "", esc(why ?? ""), warning && `⚠️ ${esc(warning)}`, quote && ["", quote]].flat(),
    buyers: [`💬 <b>"${esc(review?.quote ?? "")}"</b>`, `— ${review?.country === "IL" ? "קונה מישראל" : "מהביקורות של הקונים"}`, "", `${emoji || "🛍️"} ${title}`, ...benefits.map((b) => `✅ ${esc(b)}`), warning && `⚠️ ${esc(warning)}`],
    numbers: [`📦 <b>${sold} קנו את זה</b>`, ratingText(p), "", head, title, ...(benefits.length ? ["", ...benefits.map((b) => `✅ ${esc(b)}`)] : []), warning && `⚠️ ${esc(warning)}`],
    beforeafter: [head, title, "", `❌ ${esc(before ?? "")}`, `✅ ${esc(after ?? "")}`, warning && `⚠️ ${esc(warning)}`, quote],
    reasons: [head, title, "", ...benefits.map((b, n) => `${["1️⃣", "2️⃣", "3️⃣"][n]} ${esc(b)}`), warning && `⚠️ ${esc(warning)}`, quote],
    reviews3: [head, title, "", `${quotes.length} קונים מספרים:`, ...quotes.map((q) => `${flag(q.country)} "${esc(q.quote)}"`), warning && `⚠️ ${esc(warning)}`],
  }[style] ?? [];
  const lines = [
    banner && `<b>${esc(banner)}</b>`,
    tag && `<b>${esc(tag)}</b>`,
    ...top,
    "",
    priceLine(p),
    discountLine(p),
    couponLine(p),
    vatLine(p),
    style !== "numbers" && ratingText(p), // the numbers style shows these two at the top
    style !== "numbers" && sold && `📦 נמכרו: ${sold}`, // 🛒 is the buy line
    ...(closing ? ["", `<i>${esc(closing)}</i>`] : []), // its own line, so it doesn't read as one of the numbers
    // Short clickable text, not the bare URL (it wrapped over two lines); the same link is also the button under the post.
    `🛒 <a href="${esc(p.promotion_link)}">לרכישה בעלי אקספרס ←</a>`,
    "",
    `🔎 <a href="${esc(GROUP_LINK)}">מחפשים משהו אחר? הבוט שלנו ימצא לכם</a>`,
  ].filter((l) => typeof l === "string" && (l === "" || l.trim()));
  return lines.map((l) => RLM + l).join("\n");
}

// The seller's video when there is one (about 1 in 10 top sellers, 2026-10-31; owner: a video shows the real thing), else
// one collage of 4 of the product's own photos (a single photo keeps the caption and the buy button, an album can't), else
// the main photo, else text. Every step falls back to the next.
async function sendDeal(api, chatId, p, caption, { collage, log, buyerPhoto = null }) {
  const extra = { caption, parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: BUY_LABEL, url: p.promotion_link }]] } };
  if (/^https:\/\//.test(p.product_video_url ?? "")) {
    try {
      return await api.sendVideo(chatId, p.product_video_url, extra);
    } catch (e) {
      log(`video failed (${e.description ?? e.message}), sending photos`);
    }
  }
  const photos = [...new Set([p.product_main_image_url, ...(p.product_small_image_urls?.string ?? [])])].filter((u) => /^https:\/\//.test(u ?? "")).slice(0, 4);
  // A buyer's own photo takes the last place (owner, 2026-11-08); if it can't be used, the seller's 4 photos.
  const withBuyer = /^https:\/\//.test(buyerPhoto ?? "") && photos.length >= 3 ? [...photos.slice(0, 3), buyerPhoto] : null;
  const image = (withBuyer && (await collage(withBuyer, { badges: false }).catch(() => null))) || (photos.length === 4 ? await collage(photos, { badges: false }).catch(() => null) : null);
  try {
    return await api.sendPhoto(chatId, image ? new InputFile(image, "panda-deal.jpg") : p.product_main_image_url, extra);
  } catch (e) {
    log(`photo failed (${e.description ?? e.message}), sending text`);
    const { caption: text, ...rest } = extra;
    return api.sendMessage(chatId, text, { ...rest, link_preview_options: { is_disabled: true } });
  }
}

// Step 5 (owner, 2026-11-08: show what is really worth it, talk about an unusual discount, trends). Real data only:
// seen = { [product id]: { price: the lowest price seen, sold, at } } from every list the bot searched (free). A
// product's (sold, at) reading is kept up to 14 days, so a topic that comes back a week later can be compared.
const KEEP_SEEN = 2000;
const READING_MS = 14 * 864e5;
export function rememberSeen(seen = {}, products = [], now = Date.now()) {
  const next = { ...seen };
  for (const p of products) {
    const id = String(p.product_id), price = Number(p.target_sale_price), sold = Number(p.lastest_volume);
    if (!(price > 0) || !(sold >= 0)) continue;
    const old = next[id];
    next[id] = old ? { price: Math.min(old.price, price), ...(now - old.at < READING_MS ? { sold: old.sold, at: old.at } : { sold, at: now }) } : { price, sold, at: now };
  }
  const ids = Object.keys(next);
  return ids.length <= KEEP_SEEN ? next : Object.fromEntries(Object.entries(next).sort((a, b) => b[1].at - a[1].at).slice(0, KEEP_SEEN));
}

// What the data says about a product, from what was seen before this search: a new lowest price (10%+ under the lowest
// seen), the sales growth since a reading 3+ days old (ratio), and the discount from AliExpress's own price.
export function dealSignals(p, seen = {}, now = Date.now()) {
  const old = seen[String(p.product_id)];
  const price = Number(p.target_sale_price), sold = Number(p.lastest_volume), original = Number(p.target_original_price);
  return {
    lowest: Boolean(old && price > 0 && price <= old.price * 0.9),
    trend: old && old.sold > 0 && now - old.at >= 3 * 864e5 ? sold / old.sold : null,
    discount: original > price && price > 0 ? Math.round((1 - price / original) * 100) : 0,
  };
}

// The line on top that says why this one, from the data alone; null when nothing stands out.
const TREND_RATIO = 1.25;
export function signalTag(p, signals, worth = false) {
  if (signals.trend >= TREND_RATIO) return "📈 טרנד: המכירות שלו קפצו לאחרונה";
  if (signals.lowest) return "📉 המחיר הכי נמוך שראינו עליו";
  if (signals.discount >= 70 && signals.discount < 80) return `🔥 הנחה חריגה: ${signals.discount}%`; // 80%+ is hidden as a fake price
  if (worth) return `💎 שווה במיוחד: ${soldText(p.lastest_volume)} קנו, ב-${formatPrice(p.target_sale_price, p.target_sale_price_currency ?? "ILS")} בלבד`;
  return null;
}

// "Worth it" posts rank a topic's best sellers by trend first, then by sales for each shekel (owner's "costs nothing here").
export function worthRank(list, seen = {}, now = Date.now()) {
  const score = (p) => {
    const t = dealSignals(p, seen, now).trend;
    return [t >= TREND_RATIO ? t : 0, Number(p.lastest_volume) / Math.max(Number(p.target_sale_price), 1)];
  };
  return list.map((p) => [p, score(p)]).sort((a, b) => b[1][0] - a[1][0] || b[1][1] - a[1][1]).map(([p]) => p);
}

// The main rotation's memory after a post: when each topic was last used (30 days kept) and the last 3 categories.
function markUsed(state, done, now = Date.now()) {
  const used = Object.fromEntries(Object.entries(state.used ?? {}).filter(([, at]) => now - at < KEEP_USED_MS));
  for (const [words] of done) used[words] = now;
  return { used, recentCats: [...(state.recentCats ?? []), ...done.map(([, cat]) => cat).filter(Boolean)].slice(-3) };
}

// One post. state = { posted: [product ids], topic: index of the last topic used, ... }; returns the new state, or the
// same object (and posts nothing) when none of the next `steps` topics gives a good item.
// topics/topicKey: a holiday or series post walks its own list with its own place in state; maxIls: a price cap.
// stars: real stars and review counts for the chosen product (scripts/daily-deal.js passes addStars; tests leave it out).
export async function postDeal(state, { api, chatId, search = searchProducts, shorten = shortenLinks, stars = null, reviews = null, pick = defaultPick, collage = makeCollage, banner = null, topics = TOPICS, topicKey = "topic", order = null, usedAt = Date.now(), worth = false, steps = Math.min(topics.length, order ? MAIN_TRIES : topics.length), minSold = MIN_SOLD, maxIls = null, rotate = false, log = console.log } = {}) {
  const posted = state.posted ?? [];
  const cap = maxIls ? { maxIls } : {};
  let seenNow = null; // every searched best seller is remembered for the price and trend signals
  for (let step = 1; step <= steps; step++) {
    // A series' first post starts half a list away from the main rotation, so the two don't land on the same topic;
    // the main rotation and a holiday start at their first topic.
    const start = state[topicKey] ?? (topicKey.startsWith("series") ? (state.topic ?? -1) + Math.floor(topics.length / 2) : -1);
    // order: the main rotation's own order (topicOrder); otherwise the next topic in turn.
    const topic = order ? order[step - 1] : (start + step) % topics.length;
    if (topic === undefined) break;
    const [words, category, cat] = topics[topic];
    // With and without the category: the strongest USB-C cable (54,790 sold) is listed outside "Phones" (2026-10-30).
    const [inCategory, anywhere] = await Promise.all([category ? search(words, { category, shorten: false, ...cap }) : Promise.resolve([]), search(words, { shorten: false, ...cap })]);
    let list = candidates([...inCategory, ...anywhere], posted, minSold);
    if (!list.length) {
      log(`no good item for "${words}", trying the next topic`);
      continue;
    }
    const seen = state.seen ?? {};
    seenNow = rememberSeen(seenNow ?? seen, list, usedAt);
    list = (worth ? worthRank(list, seen, usedAt) : list).slice(0, TO_AI);
    // A failed AI call (null) is tried once more: it timed out once at 30 s, and the post then went out without its text.
    // reviews: the chosen product's buyer reviews (scripts/daily-deal.js passes fetchReviews); a failure is no reviews.
    const reviewsFor = reviews
      ? async (p) => {
          const r = pickReviews(await Promise.resolve().then(() => reviews(p.product_id)).catch(() => []));
          log(`reviews: ${r.length}`);
          return r;
        }
      : null;
    // rotate: the post styles take turns (state.template is the last one); otherwise the classic post.
    // A worth post already has its numbers in the tag on top, so it never takes the numbers style (sweatband preview, 2026-11-08).
    const template = rotate ? (reviewCount, product) => nextTemplate(state.template, reviewCount, worth ? 0 : product?.lastest_volume) : "classic";
    // recent: the last posts' headlines and closing lines, so the AI opens differently (2026-11-08: 5 of 15 began "רוצים/מחפשים").
    const recent = { headlines: (state.headlines ?? []).slice(-6), closings: (state.closings ?? []).slice(-6) };
    let choice = await pick(list, words, { reviews: reviewsFor, template, recent });
    if (choice === null) choice = await pick(list, words, { reviews: reviewsFor, template, recent });
    if (choice?.none) {
      log(`none of the best sellers for "${words}" is that item, trying the next topic`); // AliExpress search noise
      continue;
    }
    const chosen = list[choice?.i ?? 0];
    const [[short], rated] = await Promise.all([shorten([chosen]), stars ? stars([chosen]).catch(() => null) : null]); // search links are ~1 KB; on failure the long one is kept
    const p = rated?.[0]?.reviewCount ? { ...short, avgStars: rated[0].avgStars, reviewCount: rated[0].reviewCount } : short;
    // The AI's closing line unless it came back lately; else the next of the 60 lines.
    const fresh = choice?.closing && !(state.closings ?? []).includes(choice.closing) ? choice.closing : null;
    const turn = fresh ? state.closingTurn ?? -1 : ((state.closingTurn ?? -1) + 1) % CLOSINGS.length;
    const closing = fresh ?? CLOSINGS[turn];
    const tag = signalTag(p, dealSignals(p, state.seen ?? {}, usedAt), worth);
    if (tag) log(`signal: ${tag}`);
    const caption = formatDeal(p, { ...(choice ?? {}), closing, tag }, banner);
    if (api) await sendDeal(api, chatId, p, caption, { collage, log, buyerPhoto: choice?.review?.photo });
    else log(`[dry run, nothing sent]\n${caption}`);
    log(`posted "${words}": product ${p.product_id}`);
    const entry = { at: Date.now(), name: choice?.name || shortTitle(p.product_title), price: p.target_sale_price };
    log(`style: ${choice?.template ?? "plain"}`);
    const usage = order ? markUsed(state, [[words, cat]], usedAt) : {};
    return { ...state, [topicKey]: topic, ...usage, seen: seenNow, ...(rotate && choice?.template ? { template: choice.template } : {}), closingTurn: turn, closings: fresh ? [...(state.closings ?? []), fresh].slice(-KEEP_CLOSINGS) : state.closings ?? [], headlines: [...(state.headlines ?? []), ...(choice?.headline ? [choice.headline] : [])].slice(-6), posted: [...posted, String(p.product_id)].slice(-KEEP_POSTED), log: [...(state.log ?? []), entry].slice(-40) };
  }
  log("no topic gave a good item; nothing posted");
  return state;
}

// The perfect set: the most sold item of each of the set's three topics that the AI says IS that item, one collage with
// rank badges, and a buy button for each. Returns the old state (nothing posted) when any of the three is missing.
// cheap ({ maxIls }): "3 things under X ₪" instead (owner, 2026-11-08): the next main topics that have a best seller under
// the cap, up to CHEAP_TRIES of them; each topic used moves the main rotation on.
const CHEAP_TRIES = 8;
export async function postSet(state, { api, chatId, search = searchProducts, shorten = shortenLinks, pick = defaultPick, collage = makeCollage, cheap = null, topics = DEAL_TOPICS, order = null, usedAt = Date.now(), log = console.log } = {}) {
  const index = ((state.setIndex ?? -1) + 1) % SETS.length;
  const tries = cheap ? (order ?? topics.map((_, k) => k)).slice(0, CHEAP_TRIES).map((k) => topics[k]) : [];
  const set = cheap ? { name: `3 מתחת ל-${cheap.maxIls} ₪`, topics: tries } : SETS[index];
  const cap = cheap ? { maxIls: cheap.maxIls } : {};
  const posted = state.posted ?? [];
  const items = [];
  const usedTopics = [];
  for (const [words, category, cat] of set.topics) {
    if (items.length === 3) break;
    const [inCategory, anywhere] = await Promise.all([category ? search(words, { category, shorten: false, ...cap }) : Promise.resolve([]), search(words, { shorten: false, ...cap })]);
    // The cap filters before the duplicates are merged, so a dearer look-alike can't push out the cheap one.
    const found = [...inCategory, ...anywhere].filter((p) => !cheap || Number(p.target_sale_price) <= cheap.maxIls);
    const list = candidates(found, [...posted, ...items.map((x) => String(x.p.product_id))]).slice(0, TO_AI);
    let choice = list.length ? await pick(list, words) : { none: true };
    if (choice === null) choice = await pick(list, words);
    if (!list.length || choice?.none) {
      if (cheap) continue;
      return log(`set "${set.name}": nothing good for "${words}", no set today`), state;
    }
    items.push({ p: list[choice?.i ?? 0], name: choice?.name || shortTitle(list[choice?.i ?? 0].product_title) });
    usedTopics.push([words, cat]);
  }
  if (items.length < 3) return log(`"${set.name}": only ${items.length} items, not posted`), state;
  const shortened = await shorten(items.map((x) => x.p));
  const total = shortened.reduce((sum, p) => sum + Number(p.target_sale_price ?? 0), 0);
  const lines = [
    ...(cheap ? [`💸 <b>3 דברים שווים מתחת ל-${cheap.maxIls} ₪</b>`, "רבי מכר אמיתיים, כל אחד במחיר של קפה 👇"] : [`${set.emoji} <b>הסט המושלם: ${esc(set.name)}</b>`, "3 רבי מכר שעובדים מעולה ביחד 👇"]),
    ...shortened.flatMap((p, i) => [
      "",
      `${["1️⃣", "2️⃣", "3️⃣"][i]} <b>${esc(items[i].name)}</b>`,
      [priceLine(p), soldText(p.lastest_volume) && `📦 ${soldText(p.lastest_volume)}`].filter(Boolean).join(" · "),
      `🛒 <a href="${esc(p.promotion_link)}">לרכישה ←</a>`,
    ]),
    "",
    `💰 הכל ביחד: <b>${esc(formatPrice(total, "ILS"))}</b>`,
    "",
    `🔎 <a href="${esc(GROUP_LINK)}">מחפשים משהו אחר? הבוט שלנו ימצא לכם</a>`,
  ].filter((l) => typeof l === "string");
  const caption = lines.map((l) => RLM + l).join("\n");
  const extra = { caption, parse_mode: "HTML", reply_markup: { inline_keyboard: [shortened.map((p, i) => ({ text: `🛒 ${i + 1}`, url: p.promotion_link }))] } };
  if (api) {
    const image = await collage(shortened.map((p) => p.product_main_image_url)).catch(() => null);
    try {
      await api.sendPhoto(chatId, image ? new InputFile(image, "panda-set.jpg") : shortened[0].product_main_image_url, extra);
    } catch (e) {
      log(`set photo failed (${e.description ?? e.message}), sending text`);
      const { caption: text, ...rest } = extra;
      await api.sendMessage(chatId, text, { ...rest, link_preview_options: { is_disabled: true } });
    }
  } else log(`[dry run, nothing sent]\n${caption}`);
  log(`posted the set "${set.name}": ${shortened.map((p) => p.product_id).join(", ")}`);
  return { ...state, ...(cheap ? markUsed(state, usedTopics, usedAt) : { setIndex: index }), posted: [...posted, ...shortened.map((p) => String(p.product_id))].slice(-KEEP_POSTED), log: [...(state.log ?? []), { at: Date.now(), name: `סט של ${shortened.length} מוצרים` }].slice(-40) };
}

// One hourly run: posts only at this kind of day's hours (force: post now). One post a day may be a holiday or series
// item (specialFor). On sale days every other post comes from
// AliExpress's sale list (in turn when there are several), falling back to the best sellers; every post gets the banner.
// special: a manual run's choice of post ("set", "sun", "wed", "fri", "holiday"), to see one in the channel any day.
export async function runDeals(state, { now = new Date(), force = false, special: forced = null, names = promoNames, log = console.log, ...deps } = {}) {
  const t = israelTime(now);
  const sale = activeSale(await names().catch((e) => (log(`sale lists unavailable (${e.message})`), [])), t.md);
  const kind = PEAK_DAYS[t.md] ? "peak" : sale ? "sale" : "normal";
  const slot = `${t.day} ${t.hour}`;
  if (!force && (!SCHEDULE[kind].includes(t.hour) || state.slot === slot)) {
    log(`${kind} day: no post at ${t.hour}:00`);
    return state;
  }
  const banner = saleBanner(sale, t);
  const order = topicOrder(DEAL_TOPICS, { used: state.used, recentCats: state.recentCats, hour: t.hour, now: now.getTime() });
  let next = state;
  // One post a day for the coming holiday and one for the weekly series; if nothing fits, the usual post goes out.
  const wd = { sun: 0, wed: 3, fri: 5, set: SET_DAY }[forced];
  const special = forced === "worth"
    ? { worth: true }
    : forced === "cheap"
    ? specialFor({ ...t, wd: 1, hour: SCHEDULE[kind][3] }, kind, null)
    : forced === "holiday"
    ? specialFor({ ...t, hour: SCHEDULE[kind].at(-2) }, kind, upcomingHoliday(now, 365))
    : forced && wd != null
      ? specialFor({ ...t, wd, hour: SCHEDULE[kind][2] }, kind, null)
      : specialFor(t, kind, upcomingHoliday(now));
  if (special?.worth) {
    next = await postDeal(state, { ...deps, log, banner, rotate: true, topics: DEAL_TOPICS, order, usedAt: now.getTime(), worth: true });
    if (next !== state) return { ...next, slot };
  }
  if (special?.set || special?.cheap) {
    next = await postSet(state, { ...deps, log, cheap: special.cheap ?? null, order, usedAt: now.getTime() });
    if (next !== state) return { ...next, slot };
  } else if (special) {
    const { key, ...opts } = special;
    next = await postDeal(state, { ...deps, log, ...opts, topicKey: key });
    if (next !== state) return { ...next, slot };
  }
  // AliExpress's sale lists are no longer tried first (2026-11-08): in 12 live runs they posted nothing, and in previews only
  // a loose match under the 3,000-sold floor (markers for "gel pens", 2,800 sold). The sale banner stays on every post.
  if (next === state) next = await postDeal(state, { ...deps, log, banner, rotate: true, topics: DEAL_TOPICS, order, usedAt: now.getTime() });
  return next === state ? state : { ...next, slot };
}

// The owner's nightly summary (owner, 2026-11-04), sent once a day after the last post (23:00 Israel time): members and the
// change since yesterday, and the day's posts. Who clicked a link Telegram never tells a bot; views per post show in the
// channel itself. The owner must have pressed Start in this bot once, or Telegram refuses the message.
export function statusText({ day, members, prevMembers, posts }) {
  const diff = prevMembers == null ? "" : ` (${members - prevMembers >= 0 ? "+" : ""}${(members - prevMembers).toLocaleString("en-US")} מאתמול)`;
  const hhmm = (at) => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit" }).format(new Date(at));
  return [
    `📊 <b>סיכום יומי: פנדה דילים יומיים</b> (${day.split("-").reverse().join(".")})`,
    "",
    `👥 חברים בערוץ: ${members == null ? "לא ידוע" : members.toLocaleString("en-US")}${members == null ? "" : diff}`,
    `📮 פוסטים היום: ${posts.length}`,
    ...posts.map((x) => `• ${hhmm(x.at)} · ${esc(x.name)}${x.price ? ` · ₪${x.price}` : ""}`),
    "",
    "👁 צפיות לכל פוסט רואים בערוץ עצמו, מתחת לפוסט",
  ].map((l) => RLM + l).join("\n");
}

export async function sendDailyStatus(state, { api, chatId, ownerId, now = new Date(), log = console.log }) {
  const t = israelTime(now);
  if (!api || !ownerId || t.hour !== 23 || state.statusDay === t.day) return state;
  const members = await api.getChatMemberCount(chatId).catch((e) => (log(`member count failed (${e.description ?? e.message})`), null));
  const posts = (state.log ?? []).filter((x) => israelTime(new Date(x.at)).day === t.day);
  try {
    await api.sendMessage(ownerId, statusText({ day: t.day, members, prevMembers: state.members ?? null, posts }), { parse_mode: "HTML" });
  } catch (e) {
    log(`daily status failed (${e.description ?? e.message}): the owner must press Start in this bot once`);
    return state;
  }
  return { ...state, statusDay: t.day, ...(members == null ? {} : { members }) };
}
