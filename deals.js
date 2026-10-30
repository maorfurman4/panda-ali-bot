// Daily-deals bot: a separate Telegram bot that posts one best-selling AliExpress product to its own channel, a few times a day.
// It has no server: scripts/daily-deal.js runs it from a scheduled GitHub Action (see .github/workflows/daily-deals.yml).
import { searchProducts, shortenLinks, promoNames, promoProducts } from "./aliexpress.js";
import { pickDeal as defaultPick } from "./query.js";
import { RLM, esc, shortTitle, soldText, priceLine, discountLine, vatLine, ratingText, parseEvaluateRate, rankProducts, dedupeProducts, isPartFor, GROUP_LINK } from "./format.js";

// One topic per post, in turn. Neighbours differ in kind so the channel doesn't see three gadgets in a row.
// [English search words, AliExpress main category]
export const TOPICS = [
  ["wireless earbuds", 44], ["kitchen gadgets", 15], ["car phone holder", 34], ["led strip lights", 39], ["massage gun", 66],
  ["power bank", 509], ["camping lantern", 18], ["electric screwdriver", 1420], ["laptop backpack", 1524], ["building blocks toy", 26],
  ["smart watch", 44], ["kitchen storage organizer", 15], ["car vacuum cleaner", 34], ["night light", 39], ["hair clipper", 66],
  ["fast charger usb c", 509], ["resistance bands", 18], ["tool set", 1420], ["travel organizer bag", 1524], ["rc car", 26],
  ["bluetooth speaker", 44], ["silicone baking mold", 15], ["dash cam", 34], ["smart plug", 13], ["makeup brush set", 66],
  ["magsafe phone case", 509], ["bike light", 18], ["wifi security camera", 30], ["wireless mouse", 7], ["baby toys", 1501],
  ["mini projector", 44], ["electric milk frother", 6], ["shower head", 13], ["mechanical keyboard", 7], ["handheld vacuum", 6],
];

const MIN_FEEDBACK = 95;
// The regular search sorted by sales holds the real best sellers: 10x the sales of the "hot products" list (earbuds:
// top 28,689 vs 3,045, median 10,789 vs 401; checked 2026-10-30), for 7% commission instead of ~8%.
const MIN_SOLD = 500;
const TO_AI = 8; // the AI chooses among the 8 best sellers only, so every post is a top seller
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

// Proven, complete, not-yet-posted items, best first.
export function candidates(products, posted = []) {
  const seen = new Set(posted.map(String));
  const good = products.filter(
    (p) =>
      parseEvaluateRate(p.evaluate_rate) >= MIN_FEEDBACK &&
      Number(p.lastest_volume) >= MIN_SOLD &&
      /^https:\/\//.test(p.promotion_link ?? "") &&
      p.product_main_image_url &&
      !seen.has(String(p.product_id)) &&
      !isPartFor(p.product_title),
  );
  return dedupeProducts(rankProducts(good));
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
    sold && `🛒 נמכרו: ${sold}`,
    `🛒 לרכישה: ${esc(p.promotion_link)}`,
    "",
    `🔎 מחפשים משהו אחר? 👈 ${esc(GROUP_LINK)}`,
  ].filter((l) => typeof l === "string" && (l === "" || l.trim()));
  return lines.map((l) => RLM + l).join("\n");
}

// One post. state = { posted: [product ids], topic: index of the last topic used, ... }; returns the new state, or the
// same object (and posts nothing) when none of the next `steps` topics gives a good item.
export async function postDeal(state, { api, chatId, search = searchProducts, shorten = shortenLinks, pick = defaultPick, banner = null, steps = TOPICS.length, log = console.log } = {}) {
  const posted = state.posted ?? [];
  for (let step = 1; step <= steps; step++) {
    const topic = ((state.topic ?? -1) + step) % TOPICS.length;
    const [words, category] = TOPICS[topic];
    let list = candidates(await search(words, { category, shorten: false }), posted);
    if (list.length < 3) list = candidates(await search(words, { shorten: false }), posted); // the category may be wrong
    if (!list.length) {
      log(`no good item for "${words}", trying the next topic`);
      continue;
    }
    list = list.slice(0, TO_AI);
    const choice = await pick(list);
    const [p] = await shorten([list[choice?.i ?? 0]]); // search links are ~1 KB; on failure the long one is kept
    const caption = formatDeal(p, choice ?? {}, banner);
    if (api) {
      try {
        await api.sendPhoto(chatId, p.product_main_image_url, { caption, parse_mode: "HTML" });
      } catch (e) {
        log(`photo failed (${e.description ?? e.message}), sending text`);
        await api.sendMessage(chatId, caption, { parse_mode: "HTML" });
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
    next = await postDeal(state, { ...deps, log, banner, steps: 3, search: (_words, d) => promo(list, d) });
    if (next !== state) log(`from the sale list "${list}"`);
  }
  if (next === state) next = await postDeal(state, { ...deps, log, banner });
  return next === state ? state : { ...next, slot, ...(sale ? { saleTurn: turn + 1 } : {}) };
}
