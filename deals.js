// Daily-deals bot: a separate Telegram bot that posts one best-selling AliExpress product to its own channel, a few times a day.
// It has no server: scripts/daily-deal.js runs it from a scheduled GitHub Action (see .github/workflows/daily-deals.yml).
import { searchProducts, shortenLinks, promoNames, promoProducts } from "./aliexpress.js";
import { pickDeal as defaultPick } from "./query.js";
import { RLM, esc, shortTitle, soldText, priceLine, discountLine, vatLine, ratingText, parseEvaluateRate, dedupeProducts, isPartFor, GROUP_LINK } from "./format.js";

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

const MIN_FEEDBACK = 95;
// The regular search sorted by sales holds the real best sellers: 10x the sales of the "hot products" list (earbuds:
// top 28,689 vs 3,045, median 10,789 vs 401; checked 2026-10-30), for 7% commission instead of ~8%.
const MIN_SOLD = 3000; // owner: only the strongest products
const MIN_SOLD_SALE = 500; // AliExpress's sale lists sell less (median ~1,300) and are curated by AliExpress itself
const TO_AI = 3; // the AI chooses among the 3 best sellers only (it picked #8 of 8 when given 8; owner: the strongest products)
export const BUY_LABEL = "🛒 לקנייה בעלי אקספרס";
const KEEP_POSTED = 500; // product ids remembered so a deal isn't posted twice

// Posting hours (Israel time) by kind of day (owner: more posts on sale days, the most on the big shopping days).
export const SCHEDULE = { normal: [9, 12, 15, 18, 21], sale: [9, 11, 13, 15, 17, 19, 21], peak: [9, 10, 11, 12, 14, 16, 18, 19, 20, 21] };
// The big shopping days (MM-DD). shortcut: Black Friday and Cyber Monday move every year (these are 2026); update each autumn.
export const PEAK_DAYS = { "11-11": "11.11", "11-27": "בלאק פריידיי", "11-30": "סייבר מאנדיי", "12-12": "12.12" };

export function israelTime(now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit", hour: "numeric", hourCycle: "h23" })
      .formatToParts(now)
      .map((x) => [x.type, x.value]),
  );
  return { day: `${parts.year}-${parts.month}-${parts.day}`, md: `${parts.month}-${parts.day}`, hour: Number(parts.hour) };
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

// One post. state = { posted: [product ids], topic: index of the last topic used, ... }; returns the new state, or the
// same object (and posts nothing) when none of the next `steps` topics gives a good item.
export async function postDeal(state, { api, chatId, search = searchProducts, shorten = shortenLinks, pick = defaultPick, banner = null, steps = TOPICS.length, minSold = MIN_SOLD, log = console.log } = {}) {
  const posted = state.posted ?? [];
  for (let step = 1; step <= steps; step++) {
    const topic = ((state.topic ?? -1) + step) % TOPICS.length;
    const [words, category] = TOPICS[topic];
    let list = candidates(await search(words, { category, shorten: false }), posted, minSold);
    if (list.length < 3) list = candidates(await search(words, { shorten: false }), posted, minSold); // the category may be wrong
    if (!list.length) {
      log(`no good item for "${words}", trying the next topic`);
      continue;
    }
    list = list.slice(0, TO_AI);
    const choice = await pick(list, words);
    if (choice?.none) {
      log(`none of the best sellers for "${words}" is that item, trying the next topic`); // AliExpress search noise
      continue;
    }
    const [p] = await shorten([list[choice?.i ?? 0]]); // search links are ~1 KB; on failure the long one is kept
    const caption = formatDeal(p, choice ?? {}, banner);
    if (api) {
      const extra = { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: BUY_LABEL, url: p.promotion_link }]] } };
      try {
        await api.sendPhoto(chatId, p.product_main_image_url, { caption, ...extra });
      } catch (e) {
        log(`photo failed (${e.description ?? e.message}), sending text`);
        await api.sendMessage(chatId, caption, { ...extra, link_preview_options: { is_disabled: true } });
      }
    } else log(`[dry run, nothing sent]\n${caption}`);
    log(`posted "${words}": product ${p.product_id}`);
    return { ...state, topic, posted: [...posted, String(p.product_id)].slice(-KEEP_POSTED) };
  }
  log("no topic gave a good item; nothing posted");
  return state;
}

// One hourly run: posts only at this kind of day's hours (force: post now). On sale days every other post comes from
// AliExpress's sale list (in turn when there are several), falling back to the best sellers; every post gets the banner.
export async function runDeals(state, { now = new Date(), force = false, names = promoNames, promo = promoProducts, log = console.log, ...deps } = {}) {
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
  if (sale && turn % 2 === 0) {
    const list = sale.lists[(turn / 2) % sale.lists.length];
    next = await postDeal(state, { ...deps, log, banner, steps: 3, minSold: MIN_SOLD_SALE, search: (_words, d) => promo(list, d) });
    if (next !== state) log(`from the sale list "${list}"`);
  }
  if (next === state) next = await postDeal(state, { ...deps, log, banner });
  return next === state ? state : { ...next, slot, ...(sale ? { saleTurn: turn + 1 } : {}) };
}
