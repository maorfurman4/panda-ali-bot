// Daily-deals bot: a separate Telegram bot that posts one hot AliExpress product to its own channel, a few times a day.
// It has no server: scripts/daily-deal.js runs it from a scheduled GitHub Action (see .github/workflows/daily-deals.yml).
import { searchProducts, shortenLinks } from "./aliexpress.js";
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
const MIN_SOLD = 50;
const TO_AI = 20; // candidates the AI chooses from
const KEEP_POSTED = 500; // product ids remembered so a deal isn't posted twice

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
export function formatDeal(p, { name, emoji, headline, benefits = [], warning } = {}) {
  const sold = soldText(p.lastest_volume);
  const trust = [ratingText(p), sold && `🛒 נמכרו: ${sold}`].filter(Boolean).join(" · ");
  const lines = [
    `${emoji || "🔥"} <b>${esc(headline || "הדיל של עכשיו")}</b>`,
    `<b>${esc(name || shortTitle(p.product_title) || "מוצר")}</b>`,
    ...(benefits.length ? ["", ...benefits.map((b) => `✅ ${esc(b)}`)] : []),
    warning && `⚠️ ${esc(warning)}`,
    "",
    priceLine(p),
    discountLine(p),
    vatLine(p),
    trust,
    `🛒 לרכישה: ${esc(p.promotion_link)}`,
    "",
    `🔎 מחפשים משהו אחר? 👈 ${esc(GROUP_LINK)}`,
  ].filter((l) => typeof l === "string" && (l === "" || l.trim()));
  return lines.map((l) => RLM + l).join("\n");
}

// One post. state = { posted: [product ids], topic: index of the last topic used }; returns the new state, or the old one
// (and posts nothing) when no topic gives a good item.
export async function postDeal(state, { api, chatId, search = searchProducts, shorten = shortenLinks, pick = defaultPick, log = console.log } = {}) {
  const posted = state.posted ?? [];
  for (let step = 1; step <= TOPICS.length; step++) {
    const topic = ((state.topic ?? -1) + step) % TOPICS.length;
    const [words, category] = TOPICS[topic];
    let list = candidates(await search(words, { hot: true, category, shorten: false }), posted);
    if (list.length < 3) list = candidates(await search(words, { hot: true, shorten: false }), posted); // the category may be wrong
    if (!list.length) {
      log(`no good hot item for "${words}", trying the next topic`);
      continue;
    }
    list = list.slice(0, TO_AI);
    const choice = await pick(list);
    const [p] = await shorten([list[choice?.i ?? 0]]); // hot-list links are ~1 KB; on failure the long one is kept
    const caption = formatDeal(p, choice ?? {});
    if (api) {
      try {
        await api.sendPhoto(chatId, p.product_main_image_url, { caption, parse_mode: "HTML" });
      } catch (e) {
        log(`photo failed (${e.description ?? e.message}), sending text`);
        await api.sendMessage(chatId, caption, { parse_mode: "HTML" });
      }
    } else log(`[dry run, nothing sent]\n${caption}`);
    log(`posted "${words}": product ${p.product_id}`);
    return { topic, posted: [...posted, String(p.product_id)].slice(-KEEP_POSTED) };
  }
  log("no topic gave a good item; nothing posted");
  return state;
}
