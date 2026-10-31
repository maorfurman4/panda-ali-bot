// Daily-deals bot: a separate Telegram bot that posts one best-selling AliExpress product to its own channel, a few times a day.
// It has no server: scripts/daily-deal.js runs it from a scheduled GitHub Action (see .github/workflows/daily-deals.yml).
import { InputFile } from "grammy";
import { searchProducts, shortenLinks, promoNames, promoProducts } from "./aliexpress.js";
import { makeCollage } from "./collage.js";
import { pickDeal as defaultPick } from "./query.js";
import { RLM, esc, shortTitle, soldText, priceLine, formatPrice, discountLine, vatLine, ratingText, parseEvaluateRate, dedupeProducts, isPartFor, GROUP_LINK } from "./format.js";

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
export const SCHEDULE = { normal: [7, 9, 12, 15, 18, 21, 23], sale: [7, 9, 11, 13, 15, 17, 19, 21, 23], peak: [7, 9, 10, 11, 12, 14, 16, 18, 19, 20, 21, 22, 23] };
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

// What one post of the day is: the holiday item (the day's second-to-last post) and the weekly series (its third post).
export function specialFor(t, kind, holiday) {
  const hours = SCHEDULE[kind];
  if (holiday && t.hour === hours.at(-2)) {
    return { key: "holidayTopic", topics: holiday.topics, minSold: MIN_SOLD_HOLIDAY, banner: `${holiday.emoji} לקראת ${holiday.name} · עוד ${holiday.days} ימים · מזמינים עכשיו שיגיע בזמן` };
  }
  if (t.wd === SET_DAY && t.hour === hours[2]) return { set: true };
  const series = SERIES.find((x) => x.wd === t.wd);
  if (series && t.hour === hours[2]) {
    const topics = series.categories ? TOPICS.filter(([, c]) => series.categories.includes(c)) : TOPICS;
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

// AI parts (headline, benefits, warning) are optional: without them the post is the plain card under "הדיל של עכשיו".
export function formatDeal(p, { name, emoji, headline, benefits = [], warning } = {}, banner = null) {
  const sold = soldText(p.lastest_volume);
  const lines = [
    banner && `<b>${esc(banner)}</b>`,
    `${emoji || "🔥"} <b>${esc(headline || "הדיל של עכשיו")}</b>`,
    `<b>${esc(name || shortTitle(p.product_title) || "מוצר")}</b>`,
    ...(benefits.length ? ["", ...benefits.map((b) => `✅ ${esc(b)}`)] : []),
    warning && `⚠️ ${esc(warning)}`,
    "",
    priceLine(p),
    discountLine(p),
    vatLine(p),
    ratingText(p),
    sold && `📦 נמכרו: ${sold}`, // 🛒 is the buy line
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
async function sendDeal(api, chatId, p, caption, { collage, log }) {
  const extra = { caption, parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: BUY_LABEL, url: p.promotion_link }]] } };
  if (/^https:\/\//.test(p.product_video_url ?? "")) {
    try {
      return await api.sendVideo(chatId, p.product_video_url, extra);
    } catch (e) {
      log(`video failed (${e.description ?? e.message}), sending photos`);
    }
  }
  const photos = [...new Set([p.product_main_image_url, ...(p.product_small_image_urls?.string ?? [])])].filter((u) => /^https:\/\//.test(u ?? "")).slice(0, 4);
  const image = photos.length === 4 ? await collage(photos, { badges: false }).catch(() => null) : null;
  try {
    return await api.sendPhoto(chatId, image ? new InputFile(image, "panda-deal.jpg") : p.product_main_image_url, extra);
  } catch (e) {
    log(`photo failed (${e.description ?? e.message}), sending text`);
    const { caption: text, ...rest } = extra;
    return api.sendMessage(chatId, text, { ...rest, link_preview_options: { is_disabled: true } });
  }
}

// One post. state = { posted: [product ids], topic: index of the last topic used, ... }; returns the new state, or the
// same object (and posts nothing) when none of the next `steps` topics gives a good item.
// topics/topicKey: a holiday or series post walks its own list with its own place in state; maxIls: a price cap.
export async function postDeal(state, { api, chatId, search = searchProducts, shorten = shortenLinks, pick = defaultPick, collage = makeCollage, banner = null, topics = TOPICS, topicKey = "topic", steps = topics.length, minSold = MIN_SOLD, maxIls = null, log = console.log } = {}) {
  const posted = state.posted ?? [];
  const cap = maxIls ? { maxIls } : {};
  for (let step = 1; step <= steps; step++) {
    // A series' first post starts half a list away from the main rotation, so the two don't land on the same topic;
    // the main rotation and a holiday start at their first topic.
    const start = state[topicKey] ?? (topicKey.startsWith("series") ? (state.topic ?? -1) + Math.floor(topics.length / 2) : -1);
    const topic = (start + step) % topics.length;
    const [words, category] = topics[topic];
    // With and without the category: the strongest USB-C cable (54,790 sold) is listed outside "Phones" (2026-10-30).
    const [inCategory, anywhere] = await Promise.all([category ? search(words, { category, shorten: false, ...cap }) : Promise.resolve([]), search(words, { shorten: false, ...cap })]);
    let list = candidates([...inCategory, ...anywhere], posted, minSold);
    if (!list.length) {
      log(`no good item for "${words}", trying the next topic`);
      continue;
    }
    list = list.slice(0, TO_AI);
    // A failed AI call (null) is tried once more: it timed out once at 30 s, and the post then went out without its text.
    let choice = await pick(list, words);
    if (choice === null) choice = await pick(list, words);
    if (choice?.none) {
      log(`none of the best sellers for "${words}" is that item, trying the next topic`); // AliExpress search noise
      continue;
    }
    const [p] = await shorten([list[choice?.i ?? 0]]); // search links are ~1 KB; on failure the long one is kept
    const caption = formatDeal(p, choice ?? {}, banner);
    if (api) await sendDeal(api, chatId, p, caption, { collage, log });
    else log(`[dry run, nothing sent]\n${caption}`);
    log(`posted "${words}": product ${p.product_id}`);
    return { ...state, [topicKey]: topic, posted: [...posted, String(p.product_id)].slice(-KEEP_POSTED) };
  }
  log("no topic gave a good item; nothing posted");
  return state;
}

// The perfect set: the most sold item of each of the set's three topics that the AI says IS that item, one collage with
// rank badges, and a buy button for each. Returns the old state (nothing posted) when any of the three is missing.
export async function postSet(state, { api, chatId, search = searchProducts, shorten = shortenLinks, pick = defaultPick, collage = makeCollage, log = console.log } = {}) {
  const index = ((state.setIndex ?? -1) + 1) % SETS.length;
  const set = SETS[index];
  const posted = state.posted ?? [];
  const items = [];
  for (const [words, category] of set.topics) {
    const [inCategory, anywhere] = await Promise.all([search(words, { category, shorten: false }), search(words, { shorten: false })]);
    const list = candidates([...inCategory, ...anywhere], posted).slice(0, TO_AI);
    let choice = list.length ? await pick(list, words) : { none: true };
    if (choice === null) choice = await pick(list, words);
    if (!list.length || choice?.none) return log(`set "${set.name}": nothing good for "${words}", no set today`), state;
    items.push({ p: list[choice?.i ?? 0], name: choice?.name || shortTitle(list[choice?.i ?? 0].product_title) });
  }
  const shortened = await shorten(items.map((x) => x.p));
  const total = shortened.reduce((sum, p) => sum + Number(p.target_sale_price ?? 0), 0);
  const lines = [
    `${set.emoji} <b>הסט המושלם: ${esc(set.name)}</b>`,
    "3 רבי מכר שעובדים מעולה ביחד 👇",
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
  return { ...state, setIndex: index, posted: [...posted, ...shortened.map((p) => String(p.product_id))].slice(-KEEP_POSTED) };
}

// One hourly run: posts only at this kind of day's hours (force: post now). One post a day may be a holiday or series
// item (specialFor). On sale days every other post comes from
// AliExpress's sale list (in turn when there are several), falling back to the best sellers; every post gets the banner.
// special: a manual run's choice of post ("set", "sun", "wed", "fri", "holiday"), to see one in the channel any day.
export async function runDeals(state, { now = new Date(), force = false, special: forced = null, names = promoNames, promo = promoProducts, log = console.log, ...deps } = {}) {
  const t = israelTime(now);
  const sale = activeSale(await names().catch((e) => (log(`sale lists unavailable (${e.message})`), [])), t.md);
  const kind = PEAK_DAYS[t.md] ? "peak" : sale ? "sale" : "normal";
  const slot = `${t.day} ${t.hour}`;
  if (!force && (!SCHEDULE[kind].includes(t.hour) || state.slot === slot)) {
    log(`${kind} day: no post at ${t.hour}:00`);
    return state;
  }
  const banner = saleBanner(sale, t);
  const turn = state.saleTurn ?? 0;
  let next = state;
  // One post a day for the coming holiday and one for the weekly series; if nothing fits, the usual post goes out.
  const wd = { sun: 0, wed: 3, fri: 5, set: SET_DAY }[forced];
  const special = forced === "holiday"
    ? specialFor({ ...t, hour: SCHEDULE[kind].at(-2) }, kind, upcomingHoliday(now, 365))
    : forced && wd != null
      ? specialFor({ ...t, wd, hour: SCHEDULE[kind][2] }, kind, null)
      : specialFor(t, kind, upcomingHoliday(now));
  if (special?.set) {
    next = await postSet(state, { ...deps, log });
    if (next !== state) return { ...next, slot };
  } else if (special) {
    const { key, ...opts } = special;
    next = await postDeal(state, { ...deps, log, ...opts, topicKey: key });
    if (next !== state) return { ...next, slot };
  }
  if (sale && turn % 2 === 0) {
    const list = sale.lists[(turn / 2) % sale.lists.length];
    next = await postDeal(state, { ...deps, log, banner, steps: 3, minSold: MIN_SOLD_SALE, search: (_words, d) => promo(list, d) });
    if (next !== state) log(`from the sale list "${list}"`);
  }
  if (next === state) next = await postDeal(state, { ...deps, log, banner });
  return next === state ? state : { ...next, slot, ...(sale ? { saleTurn: turn + 1 } : {}) };
}
