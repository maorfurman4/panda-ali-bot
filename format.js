// Hebrew message texts and formatting (HTML parse mode).
// Every line starts with RLM so lines that begin with a digit, a price or a Latin brand still render right-to-left.
import COUPONS from "./coupons.json" with { type: "json" };

export const RLM = "‏";
const MIN_FEEDBACK = 90;
const LONG_LINK = 80;
const TITLE_MAX = 40; // photo captions are only as wide as the photo
const QUERY_MAX = 80; // the header lists every advisor choice
// Seller filler at the start of machine-translated titles ("2022 חדש", "NEW", "1 יחידה").
const TITLE_JUNK = /^(?:(?:20\d\d|new|חדש(?:ה|ים|ות)?|hot|1\s*(?:יחידה|יחידות|pcs?)|מקורי(?:ת)?|לשנת)[\s,:-]*)+/i;
// Also drops a leading "–" and seller coupon codes ("(קוד קופון: HOT888)"), which we can't verify.
const cleanTitle = (title) =>
  oneLine(title).replace(/\([^)]*(?:קופון|coupon|code)[^)]*\)/gi, "").trim().replace(TITLE_JUNK, "").replace(/^[\s\-–—|,.:;*•]+/, "");
const CAPTION_MAX = 1024; // Telegram photo caption limit, counted after HTML parsing
const MEDALS = ["🥇", "🥈", "🥉", "4️⃣", "5️⃣"];
const GROUP_URL = process.env.GROUP_URL || "https://t.me/panda_deals_il"; // shown under "🐼 פנדה אקספרס" at the end of each result

export const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const rtl = (lines) => lines.map((l) => RLM + l).join("\n");
const oneLine = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const clip = (s, max) => ([...s].length > max ? [...s].slice(0, max - 1).join("") + "…" : s);

// Length as Telegram counts it: text after HTML parsing, in UTF-16 code units.
export const parsedLength = (html) =>
  html.replace(/<[^>]*>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&").length;

// evaluate_rate is the positive-feedback percentage as a string, e.g. "96.5%". It is NOT a star rating.
export function parseEvaluateRate(value) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const m = String(value).trim().match(/^(\d+(?:\.\d+)?)%?$/);
  const n = m ? Number(m[1]) : NaN;
  return n >= 0 && n <= 100 ? n : null;
}

// Best first: recent sales (log scale) weighted by positive feedback; ties keep the API order.
// AliExpress Choice items come from this one store in the API ("Stone's Store"; the item page says "Choice · AliExpress
// commitment": fast delivery, free returns, refund if late; checked 2026-11-01). They get a small push (≈1.5× the sales).
export const CHOICE_SHOP_ID = "1103573332";
export const isChoice = (p) => String(p.shop_id ?? "") === CHOICE_SHOP_ID;
// Choice (AliExpress's fast shipping): a big boost (owner, 2026-11-01), worth about 4x the sales on the log score.
export const CHOICE_BOOST = 1.2;
export const strength = (p) => Math.log10((Number(p.lastest_volume) || 0) + 1) * ((parseEvaluateRate(p.evaluate_rate) ?? 90) / 100) * (isChoice(p) ? CHOICE_BOOST : 1);
export function rankProducts(products) {
  return products.map((p, i) => ({ p, i, s: strength(p) })).sort((a, b) => b.s - a.s || a.i - b.i).map((x) => x.p);
}

// Reviews prove a product, read with its rating (owner's spec, 2026-11-01): trusted = 20+ reviews and 4.5+ stars; a 4.9
// from 5 reviews can be the seller's own. Order: trusted real matches, trusted close ones (a close match with 500 reviews
// beats an exact one with 5), then the rest as they were, shown only when the card needs them. bySales (gadgets): the
// trusted ones by sales, Choice boosted, and only with real sales (200+): gadgets people buy sell a lot (owner: the 29,621-sold
// earbuds fell to 4th when gadgets went by review count, 2026-11-01); style items
// keep their order among the trusted (best sellers and ✨ prettiest in turn). look (a named color or pattern): the right
// color first, even barely reviewed, then close ones; a product shown in another color (offColor: by its photo or title)
// comes last.
// No counts at all (the lookup failed): the order stays.
const TRUSTED_REVIEWS = 20;
const MIN_STARS = 4.5;
const GADGET_MIN_SOLD = 200;
const UNREAD_PROVEN_SALES = 1000;
export function trustedFirst(products, { bySales = false, look = false } = {}) {
  if (!products.some((p) => p.reviewCount)) return products;
  // No count for one product while others have one is a failed lookup, not "no reviews": 1,000+ sales is proof enough
  // (a 13,482-sold charger showed none, 2026-11-01); it goes last among the trusted.
  const sold = (p) => Number(p.lastest_volume) || 0;
  const trusted = (p) => (p.reviewCount ? p.reviewCount >= TRUSTED_REVIEWS && p.avgStars >= MIN_STARS && (!bySales || sold(p) >= GADGET_MIN_SOLD) : sold(p) >= UNREAD_PROVEN_SALES);
  const off = (p) => look && p.offColor;
  const most = (list) => (bySales ? rankProducts(list) : list);
  const pick = (ok) => products.filter((p) => !off(p) && ok(p));
  const real = pick((p) => trusted(p) && p.match !== "partial"), close = pick((p) => trusted(p) && p.match === "partial");
  // A named color: every right-color match before any close one, which is often another color (three white dresses with
  // hundreds of reviews passed green ones, 2026-11-01).
  const top = look ? [...most(real), ...pick((p) => !trusted(p) && p.match !== "partial"), ...most(close)] : [...most(real), ...most(close)];
  return [...top, ...products.filter((p) => !top.includes(p) && !off(p)), ...products.filter(off)];
}

// A title that names only other colors than the one asked for ("שמלת ערב חומה" for "שמלת ערב שחורה": the judge called it
// exact, 2026-11-01). Main colors only: gold and silver are often a trim or a metal, and a title listing the asked color
// among others (black/white/red variants) keeps it.
const COLORS = {
  black: /שחור|\bblack\b/i, white: /לבן|לבנ|\bwhite\b/i, red: /אדום|אדומ|בורדו|\bred\b|burgundy/i, blue: /כחול|נייבי|טורקיז|\bblue\b|\bnavy\b|turquoise/i,
  green: /ירוק|\bgreen\b/i, yellow: /צהוב|\byellow\b/i, pink: /ורוד|פוקסיה|\bpink\b|fuchsia/i, purple: /סגול|לילך|\bpurple\b|lilac/i,
  brown: /חומה|חומים|חומות|\bbrown\b|\bcoffee\b/i, beige: /בז'|ניוד|חאקי|\bbeige\b|\bkhaki\b|\bnude\b/i, gray: /אפור|\bgr[ae]y\b/i, orange: /כתו[םמ]|\borange\b/i,
};
// "רעש לבן" (white noise) names no color: a white noise machine search got the color note (owner's test, 2026-11-02).
const NOT_A_COLOR = /רעש\s+לבן|white\s+noise/gi;
// "לבנות" is the color only after a feminine plural item ("נעליים לבנות"), "לבנים" only after a masculine plural one
// ("בלונים לבנים"); otherwise it says who the item is for: "תיק לעבודה לבנות" (a bag can't be "לבנות" white) is a women's
// bag. The bot read it as white and showed men's black laptop bags (owner's test, 2026-11-04).
const FEM_PLURAL = /^(?:נעליים|נעלי|סניקרס)$|ות$/;
const MASC_PLURAL = /^(?:סניקרס)$|(?<!^נעל)(?:ים|י)$/;
const WHO_WORD = /(?<![א-ת])(לבנות|לבנים)(?![א-ת])/;
export function forWhom(text = "") {
  const m = WHO_WORD.exec(text);
  if (!m) return null;
  const item = text.slice(0, m.index).replace(/^\s*(?:חפש|תחפש|מצא|תמצא)\s+לי\s+/, "").trim().split(/\s+/)[0] ?? "";
  if (m[1] === "לבנות" ? FEM_PLURAL.test(item) : MASC_PLURAL.test(item)) return null; // the color fits: ambiguous
  const adult = /עבודה|משרד|אירוע|חתונה|ערב|נשף|כלה|אמא|אבא|אישה|נשים|גבר/.test(text);
  return m[1] === "לבנות" ? (adult ? "women" : "girls") : adult ? "men" : "boys";
}
const named = (text) => {
  const t = (text ?? "").replace(NOT_A_COLOR, "");
  return Object.keys(COLORS).filter((c) => COLORS[c].test(forWhom(t) ? t.replace(WHO_WORD, "") : t));
};
// A listing in several colors, the asked one among them ("כחול, ירוק, שחור, צהוב…" for "שחורה", 2026-11-02).
export const inColors = (title, request) => named(request).some((c) => named(title).includes(c)) && named(title).length > 1;
// The asked color in the shopper's own word, for a listing shown in another color whose title says it comes in that one
// too (owner, 2026-11-05: "show it in red and write it comes in black too").
const COLOR_WORDS = [[/שחור/, "שחור"], [/לבן|לבנה/, "לבן"], [/אדו[םמ]/, "אדום"], [/בורדו/, "בורדו"], [/נייבי/, "נייבי"], [/טורקיז/, "טורקיז"], [/תכלת/, "תכלת"], [/כחול/, "כחול"], [/ירוק/, "ירוק"], [/צהוב/, "צהוב"], [/פוקסיה/, "פוקסיה"], [/ורוד/, "ורוד"], [/לילך/, "לילך"], [/סגול/, "סגול"], [/ניוד/, "ניוד"], [/חאקי/, "חאקי"], [/בז'/, "בז'"], [/חום|חומ/, "חום"], [/אפור/, "אפור"], [/כתו[םמ]/, "כתום"]];
const askedColor = (request = "") => {
  const t = request.replace(NOT_A_COLOR, "");
  return COLOR_WORDS.find(([re]) => re.test(forWhom(t) ? t.replace(WHO_WORD, "") : t))?.[1] ?? null;
};
export function colorAlsoLine(request = "") {
  const w = askedColor(request);
  return w ? `🎨 מגיע גם ב${w}, בוחרים בדף המוצר` : null;
}
// The shopper's color in the English names sellers give variants (SKU API). "Wine Red" is burgundy, not red.
const VARIANT_EN = {
  שחור: /\bblack\b/i, לבן: /\bwhite\b/i, אדום: /^(?!.*(?:wine|burgundy|claret)).*\bred\b/i, בורדו: /burgundy|\bwine\b|claret|maroon|bordeaux/i,
  נייבי: /\bnavy\b|dark\s*blue/i, כחול: /\bblue\b|\bnavy\b/i, תכלת: /(?:light|sky|baby)\s*blue/i, ירוק: /\bgreen\b/i, צהוב: /\byellow\b/i,
  ורוד: /\bpink\b/i, סגול: /purple|violet|lavender/i, חום: /\bbrown\b|coffee|camel/i, "בז'": /beige|apricot|khaki/i,
  ניוד: /\bnude\b|beige|apricot|\bskin\b/i, חאקי: /khaki/i, אפור: /\bgr[ae]y\b/i, כתום: /\borange\b/i,
};
const CODE = /^[A-Z]\d?$|^\d+$|colou?r\s*\d/i;
const SKU_CAP = 20; // the API returns at most 20 variants
// decided: real color names, a known color, and either a match or a full list seen (fewer than 20 variants). Otherwise
// the photo picker decides, as before.
export function colorVariant(variants = [], request = "") {
  const re = VARIANT_EN[askedColor(request)];
  const named = variants.filter((v) => v.color);
  if (!re || !named.length || named.some((v) => CODE.test(v.color))) return { variant: null, decided: false };
  const variant = named.find((v) => re.test(v.color)) ?? null;
  return { variant, decided: Boolean(variant) || variants.length < SKU_CAP };
}
// A request for a child (ילדה, בנות, kids) and a title for a baby: "שמלה לילדה" showed three baby dresses, the judges let
// them in (owner's test, 2026-11-05). Machine-translated baby titles name girls too ("לתינוקות בנות", "שמלת ילדה בת
// תינוק", free check of 30 titles), so an age range decides when there is one (up to 3 years is a baby's), and otherwise
// the title is a baby's when it names babies more often than children ("תינוק בנות" counts as a baby); a tie stays.
const CHILD = /(?<![א-ת])[ולהבמשכ]{0,2}(?:ילדה|ילדות|ילד|ילדים|בנות|בנים|נער|נערה|נוער)(?![א-ת])|\b(?:kids?|girls?|boys?|children)\b/i;
const BABY = /תינוק|פעוט|יילוד|\b(?:baby|babies|newborn|infant|toddler)\b/i;
const CHILD_WORDS = /(?<![א-ת])[ולהבמשכ]{0,2}(?:ילדה|ילדות|ילד|ילדים|בנות|בנים|נוער)(?![א-ת])|\b(?:kids?|children)\b/gi;
const BABY_WORDS = /תינוק|פעוט|יילוד|\b(?:baby|babies|newborn|infant|toddler)\b/gi;
const BABY_GIRL = /תינוק\S*\s+(?:בנות|בנים|ילדה|ילדות|ילד|בת|בן)(?![א-ת])|(?<![א-ת])(?:ילדת|ילדה|בת|בן)\s+תינוק\S*|\bbaby\s+(?:girls?|boys?)\b/gi;
const AGES = /(\d{1,2})\s*[-–]\s*(\d{1,2})\s*(שנ|חודש|years?|months?|[mM](?![a-z]))/;
export function babyOnly(title = "", request = "") {
  if (!CHILD.test(request) || BABY.test(request)) return false;
  if (/(?<![\d.])0\s*[-–]\s*\d{1,2}(?!\d)/.test(title)) return true; // "0-3", "0-24 חודשים": from birth
  const age = AGES.exec(title);
  if (age) return Number(age[2]) / (/^(?:חודש|month|m)/i.test(age[3]) ? 12 : 1) <= 3;
  const t = title.replace(BABY_GIRL, " תינוק ");
  return (t.match(BABY_WORDS)?.length ?? 0) > (t.match(CHILD_WORDS)?.length ?? 0);
}
export function offColor(title, request) {
  const asked = named(request);
  if (!asked.length) return false;
  const has = named(title);
  return has.length > 0 && !asked.some((c) => has.includes(c));
}

// The same product listed twice: the same review count and stars from 100 reviews up (one GaN charger, 4,926 reviews, from
// two listings, 2026-11-01).
export function sameReviews(products) {
  return products.filter((p, i) => !(p.reviewCount >= 100) || products.findIndex((q) => q.reviewCount === p.reviewCount && q.avgStars === p.avgStars) === i);
}

// A card is led by its 🥇, never a 🏷️ or ✨ pick. strip (cards ordered by reviews): the most reviewed stays first and shows
// as the 🥇; otherwise a pick that moved up trades places with the next best seller.
export function sellerFirst(shown, limit, { strip = false } = {}) {
  const pick = (p) => p?.brandSlot || p?.pretty;
  if (strip) return shown.map((p, i) => (i % limit === 0 && pick(p) ? { ...p, brandSlot: false, pretty: false } : p));
  shown = [...shown];
  for (let start = 0; start < shown.length; start += limit) {
    if (!pick(shown[start])) continue;
    const j = shown.findIndex((p, i) => i > start && i < start + limit && !pick(p));
    if (j > 0) [shown[start], shown[j]] = [shown[j], shown[start]];
  }
  return shown;
}

// The same product from several sellers counts once (the first, i.e. best-ranked, stays). Three keys: brand + model
// ("BINNUNE BW06", "Lenovo GM2"), the start of the normalized title, and one store's listings with the same sales count
// (a straw bag listed twice by one store, 2,835 sold each, 2026-11-01). From 300 sold: two different items of one store
// share a small count (52 and 52 seen).
const TWIN_MIN_SOLD = 300;
export function dedupeProducts(products) {
  const seen = new Set();
  return products.filter((p) => {
    const t = cleanTitle(p.product_title).toLowerCase(); // "2025 – מגפי…" and "2026 – מגפי…" are the same product
    const model = t.match(/\b[a-z]{3,}\s+(?:[a-z]+\d|\d+[a-z])[a-z0-9]*\b/)?.[0];
    const twin = p.shop_id && Number(p.lastest_volume) >= TWIN_MIN_SOLD && `s:${p.shop_id}:${p.lastest_volume}`;
    const keys = [model && `m:${model}`, `t:${t.replace(/[^\p{L}\p{N}]+/gu, "").slice(0, 24)}`, twin].filter(Boolean);
    if (keys.some((k) => seen.has(k))) return false;
    keys.forEach((k) => seen.add(k));
    return true;
  });
}

// A spare part / accessory FOR the item rather than the item (robot vacuum bags and brushes), unless parts were asked for.
const PART_REQUEST = /חלק|חילוף|אביזר|מברש|שקי|מסנן|פילטר|רפיד|מטלי|ציר|דמפר|ראש|להב|filter|brush|bag|spare|replacement|accessor|hinge|damper|blade/i;
// Hinges and dampers for a toilet seat came in for "מושב אסלה שנסגר לאט" (2026-11-02); shaver heads for a grooming kit (2026-11-01).
const PART_TITLE = /(?:חלקי|חלק) חילוף|חלופי|spare parts?|replacement|^(?:\d+\s*יחידות,?\s*)?(?:צירים|ציר|ערכת דמפר|דמפר|hinges?|damper)\s|^(?:\d+\s*יחידות,?\s*)?(?:ראשי|ראש) (?:גילוח|החלפה|מכונת)|^(?:\d+\s*יחידות,?\s*)?להבי?ם?\s|shaver heads?|replacement (?:heads?|blades?)|אביזר\S*\s+ל|^עבור\s|^(?:מברשת|מברשות|שקית|שקיות|מסנן|מסננים|פילטר|רפידות|מטלית|מטליות)\s/i;
// A title that STARTS with a part/accessory word ("כבל מקלדת", "סוללת קטנוע", "משענות יד") is a part, unless the request
// itself names that word ("כיסוי לאייפון" still finds covers, "מטען" still finds chargers). Matched by a 3-letter stem.
const PART_FIRST_WORDS = /^(?:סוללת|סוללה|סוללות|כבל|כבלי|מעמד|משענת|משענות|גלגל|גלגלים|צמיג|צמיגים|מטען|כיסוי|כיסויים|מגן|מגני|רצועה|רצועת|תושבת|ידית|הרמת|מתאם)$/;
// A phone/tablet case under any of its names (title's first word / the request).
const HOLDER_WORDS = /^(?:מחזיק|מחזיקי|מעמד|מעמדי|תושבת|תושבות)$/;
const HOLDER_REQUEST = /מחזיק|מעמד|תושב/;
const CASE_WORDS = /^(?:כיסוי|כיסויים|מגן|מגני|נרתיק|נרתיקים|קייס|קייסים)$/;
const CASE_REQUEST = /כיסו|מגן|מגני|נרתיק|קייס|\bcase\b|\bcover\b/i;
const BUNDLE_PREFIX =/^(?:סט(?: של)?\s*\d*|\d+\s*(?:יחידות|יח'|pcs)|זוג)\s+/i;
// The same model under two names ("Lenovo LP40 Pro אוזניות TWS" and "Lenovo LP40 Pro אוזניות", 2026-11-01): the first
// run of Latin words that holds a model number (brand + model), else the whole name.
// A run without a digit counts when it starts with a capitalized brand ("KZ EDX Pro X"), not a spec ("USB C", "Type C").
// Version words at the end are dropped, so "KZ EDX Pro X" and "KZ EDX Pro" are one model (2026-11-01).
const SPEC_WORDS = /^(?:usb|led|rgb|tws|pd|qc|hd|uv|dc|ac|gan|anc|type|ipx\d*)$/i;
const VERSION_WORDS = /^(?:x|s|pro|max|plus|lite|se|mini|ultra|\+)$/i;
// Two model keys name one model when one holds the other ("xiaomiredmibuds6active" and "redmibuds6active": the parent brand
// is often left out, 2026-11-02). Only for keys with a model number, so plain names never merge.
export const sameModel = (a, b) => Boolean(a && b) && (a === b || (/\d/.test(a) && /\d/.test(b) && Math.min(a.length, b.length) >= 6 && (a.includes(b) || b.includes(a))));

// request: a run that holds a model number the shopper named is the device the item is FOR, not the item's model
// (every "כיסוי שקוף ל-Samsung S24" collapsed into one, 2026-11-02).
// plainNames false (non-style cards): a name without a model code or brand is a kind, never one model: three different
// chargers (50,540, 39,546 and 13,303 sold) were all "מטען רכב USB-C" and two were dropped (2026-11-02). Style cards keep
// it: there the same plain name is the same dress in another color's listing (a cream one came back, 2026-11-02).
export function modelKey(name = "", request = "", { plainNames = true } = {}) {
  const asked = new Set((request.match(/[A-Za-z]*\d+[A-Za-z]*/g) ?? []).map((w) => w.toLowerCase()));
  const runs = (name.match(/[A-Za-z0-9][\w.-]*(?:\s+[A-Za-z0-9][\w.-]*)*/g) ?? []).filter((run) => !run.split(/\s+/).some((w) => asked.has(w.toLowerCase())));
  const brandLed = (run) => { const [first, ...rest] = run.split(/\s+/); return rest.length > 0 && /^[A-Z][A-Za-z]+$/.test(first) && !SPEC_WORDS.test(first); };
  const model = runs.find((run) => /[a-z]/i.test(run) && (/\d/.test(run) || brandLed(run)));
  if (!model) return plainNames ? name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "") : "";
  const words = model.split(/\s+/);
  while (words.length > 2 && VERSION_WORDS.test(words.at(-1))) words.pop();
  return words.join("").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

// A card holds at most 2 near-identical items (3 motion-sensor night lights of 4, 2026-11-01); the third waits for the
// next card. Alike = a shared word (3-letter stem) beyond the request's own words: four "צעיף מרובע" in one card
// shared only "מרובע" (2026-11-01).
const STOP_WORDS = new Set(["עם", "של", "לכל", "for", "and", "wit"]);
export function varied(products, request = "", limit = 4) {
  const stem = (w) => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "").slice(0, 3);
  const asked = new Set(request.split(/\s+/).map(stem));
  const words = (p) => new Set((p.short_he ?? "").split(/\s+/).map(stem).filter((s) => s.length === 3 && !STOP_WORDS.has(s) && !asked.has(s)));
  const alike = (a, b) => [...a].some((w) => b.has(w));
  const rest = products.map((p) => ({ p, w: words(p) }));
  const out = [];
  while (rest.length) {
    const card = [];
    // A skipped look-alike real match is never passed by a close one (a cycling bottle took 4th place over a third sport
    // bottle, 2026-11-02): only an item of the same or a better grade may move up past it.
    const grade = (c) => (c.p.match === "partial" ? 1 : 0);
    let skipped = Infinity;
    for (let i = 0; i < rest.length && card.length < limit; ) {
      if (card.filter((c) => alike(c.w, rest[i].w)).length >= 2) skipped = Math.min(skipped, grade(rest[i++]));
      else if (grade(rest[i]) > skipped) i++;
      else card.push(...rest.splice(i, 1));
    }
    while (card.length < limit && rest.length) card.push(rest.shift()); // only alike ones left: better than a short card
    out.push(...card.map((c) => c.p));
  }
  return out;
}

// Holiday-themed items the AI sometimes keeps as "close" (Halloween and Snoopy covers for "כרית נוי לסלון", 2026-11-01):
// left out unless the request names the same holiday. A title that names the asked holiday among others stays (sellers list
// "חג המולד, ליל כל הקדושים, יום הולדת"); a Halloween-only calendar for "לוח אדוונט לחג המולד" goes (owner, 2026-11-02).
// Asking for an advent calendar is asking for Christmas ("לוח אדוונט של נידו" lost every NeeDoh calendar "…לחג המולד"
// without it); in a title "advent" alone says nothing, since Halloween advent calendars exist too.
// Jewish holidays and Judaica too (owner, 2026-11-02). Words that are also everyday Hebrew are matched whole or left out:
// "לשבת" is also "to sit", "סדר" "order", "פמוט" any candle holder, "רעשן" a baby rattle, "מנורה" a lamp; whole words
// only, since "טלית" hides in "דיגיטלית", "שופר" in "משופרת", "סופגני" in "סופגנית" (absorbent), "פורים" in "סיפורים"
// (35 of 1,867 best sellers were left out before that, 2026-11-02). A "טלית סאטן" scarf is a shawl: no Hebrew טלית.
const W = (word, prefix = "") => `(?<![א-ת])${prefix}(?:${word})(?![א-ת])`;
const HALLOWEEN = /halloween|ליל כל הקדושים|האלווין|הלווין/i;
const PURIM = new RegExp(`${W("פורים", "[לבו]?")}|משלוח מנות|מגילת אסתר|אוזני המן|purim`, "i");
const JEWISH = [
  new RegExp(`חנוכ|סביבון|${W("סופגני(?:ה|יה|ות|יות)")}|hanukk?ah|chanukk?ah|menorah|dreidel`, "i"),
  new RegExp(`פסח(?!א)|ליל הסדר|קערת (?:ה)?סדר|הגדה של פסח|${W("מצות?")}|passover|pesach|seder plate|matzah?|matzo`, "i"),
  new RegExp(`ראש השנה|שנה טובה|${W("שופר(?:ות)?")}|rosh hashana|shofar`, "i"),
  /יום (?:ה)?כיפור|yom kippur/i,
  new RegExp(`סוכות|${W("סוכה")}|לולב|אתרוג|ארבעת המינים|שמחת תורה|sukkot|sukkah|lulav|etrog`, "i"),
  /ט["״]ו בשבט|tu bishvat/i,
  PURIM,
  /ל["״]ג בעומר|lag baomer/i,
  /חג השבועות|shavuot/i,
  new RegExp(`${W("שבת", "ב?")}|קידוש|כיסוי חלה|קרש חלה|מגש חלה|נר הבדלה|ערכת הבדלה|shabbat|sabbath|kiddush|challah|havdalah`, "i"),
];
const JUDAICA = /מגן דוד|מזוזה|מזוזות|תפילין|כיפה סרוגה|יודאיקה|star of david|mezuzah|tallit|tefillin|kippah|yarmulke|judaica/i;
const HOLIDAYS = [HALLOWEEN, /christmas|xmas|חג המולד|כריסמס|סנטה|santa/i, /easter|פסחא/i, /thanksgiving/i, ...JEWISH, JUDAICA];
const holidaysIn = (text) => HOLIDAYS.filter((h) => h.test(text ?? ""));
function askedHolidays(request) {
  const asked = holidaysIn(request.replace(/advent|אדוונט/gi, "christmas").replace(new RegExp(W("לשבת"), "g"), "שבת"));
  // Costumes and costume props are sold as Halloween ones: for Purim, and for "כובע קסם" (magician hats "…להלווין", 2026-11-02)
  if (asked.includes(PURIM) || /תחפוש|קוסם|קסם|מכשפ|מסכה|מסכות|שרביט|costume|magician|wizard|witch/i.test(request)) asked.push(HALLOWEEN);
  if (asked.some((h) => JEWISH.includes(h))) asked.push(JUDAICA); // a Star of David gift fits any Jewish holiday
  return asked;
}
export const offTheme = (title, request = "") => {
  const asked = askedHolidays(request), named = holidaysIn(title);
  return named.length > 0 && !named.some((h) => asked.includes(h));
};

// Specialized kinds a general request doesn't mean; the AI still called gaming mice exact for "עכבר אלחוטי" (2026-11-01),
// so the code moves them to "close" unless the request names the kind.
// 2026-11-01 (30 general searches): cycling bottles, camping and tamagoyaki pans, a citronella candle, DIY sticker clocks,
// party tablecloths and whiskey glasses came in as "exact" too.
const SPECIAL_KINDS = [
  /gaming|gamer|e-?sports|גיימינג|גיימר|(?:מקלדת|מקלדות|עכבר|אוזניות|כיסא)[^,]{0,25}?\s(?:ל)?משחק/i,
  /shower speaker|(?:רמקול|speaker)[^,]{0,25}(?:מקלחת|אמבטיה|shower)/i, // a speaker only: towels say "אמבטיה" too
  /hydroponic|הידרופוני/i,
  /keffiyeh|kufiya|כאפי|קפיה/i,
  /tesla|טסלה/i,
  /cycling|bicycle|\bbike\b|אופניים|רכיבה על אופניים/i,
  /camping|מחנאות|קמפינג|קמפינג/i,
  /tamagoyaki|טמאגויאקי/i,
  /citronella|mosquito|ציטרונלה|יתושים/i,
  /\bdiy\b|עשה זאת בעצמך/i,
  /disposable|חד[ -]?פעמי|למסיבה|לקישוט חתונה/i,
  /whisk(?:e)?y|ויסקי|כוסות שוט|shot glass/i,
  // A vertical mouse is an ergonomic special kind: it led "עכבר אלחוטי" (owner's test, 2026-11-04).
  /(?:עכבר|mouse)[^,]{0,25}?(?:אנכי|vertical)|vertical\s+mouse/i,
  /measuring|כוס מדידה|כלי מדידה/i,
  /personali[sz]ed|custom photo|your (?:own )?photo|(?:תמונה|פוסטר|הדפס|קנבס|כרית|ציפית|ספל)[^,]{0,20}בהתאמה אישית/i,
];
export const specialKind = (title, request = "") => SPECIAL_KINDS.some((k) => k.test(title ?? "") && !k.test(request)) || carCharger(title, request);
// A car charger or a car phone holder is close unless the request is about a car at all (a car charger sat 4th for
// "מטען מהיר"; car holders led "מעמד לטלפון", a desk stand; live tests 2026-11-02).
const CAR_CHARGER = /(?:מטען|מחזיק|מעמד|מתקן|תושבת|charger|holder|mount)[^,]{0,45}?(?:\sל?רכב|\bcar\b|מצית|למזגן|למיזוג)|\bcar\s+(?:fast\s+)?(?:charger|phone\s+(?:holder|mount))/i;
const carCharger = (title, request) => CAR_CHARGER.test(title ?? "") && !/רכב|\bcar\b|מצית/i.test(request);

// Luxury brands AliExpress sells only as fakes (a ₪127 "Diptyque" candle, 2026-11-01): left out unless the shopper names
// the brand (then the search handles it as a brand request).
const LUXURY = /diptyque|דיפיקס|dior|דיור|chanel|שאנל|gucci|גוצ'י|louis vuitton|לואי ויטון|herm[eè]s|הרמס|prada|פראדה|rolex|רולקס|cartier|קרטייה|versace|ורסצ'ה|balenciaga|ysl|yves saint|burberry|ברברי|fendi|tiffany|טיפאני|jo malone|ג'ו מלון/i;
// A set or kit was asked for ("סט מברגים", "ערכת מאצ'ה", "ערכת טיפוח לגבר"): a title that doesn't say it's a set is a single
// tool (one screwdriver, one whisk, one nose trimmer, 2026-11-02) and goes after the real sets (owner: last, not out).
const SET_REQUEST = /(?:^|\s)(?:סט|סטים|ערכה|ערכת|ערכות)(?:\s|$)|\b(?:set|kit)\b/i;
const SET_TITLE = /סט|ערכ|מארז|חלקים|יחידות|ב-?\s?1|\b\d+\s*(?:in|ב)\s*1\b|\bset\b|\bkit\b|\bpcs\b|\d+\s*(?:pcs|יח)/i;
export const singleForSet = (title, request = "") => SET_REQUEST.test(request) && !SET_TITLE.test(title ?? "");

// Self-check (owner: understand every term, not word by word, 2026-11-05): AliExpress titles come in Hebrew, so a wrong
// reading shows as top products whose titles share no word with the Hebrew request ("נטילת ידיים" read as "hand washing":
// soap). Free check on 2026-11-05: under 0.2 caught 9 of 20 wrong readings and 1 of 25 everyday searches.
const SELF_STOP = new Set("חפש תחפש מצא תמצא לי של עם את על בשביל עבור גם כולל איכותי איכותית איכותיים מעוצב מעוצבת חדש חדשה זול זולה הכי טוב טובה יפה גדול גדולה קטן קטנה שיכול להכיל או וגם".split(" "));
const unsuffix = (w) => (w.length > 4 ? w.replace(/(יות|ים|ות|ית)$/, "") : w).replace(/(?<=..[א-ת])[הת]$/, "");
// Both the word and the word without a one-letter prefix (ו/ל/ה/ב from 4 letters, מ/ש/כ from 5), suffixes trimmed.
const roots = (w) => { const c = w.replace(/["'׳״]/g, ""); const bare = c.length >= 5 || (c.length >= 4 && /^[ולהב]/.test(c)) ? c.replace(/^[ולהבמשכ]/, "") : c; return [...new Set([unsuffix(c), unsuffix(bare)])].filter((r) => r.length >= 3); };
export function titleShare(request = "", products = [], top = 30) {
  const ws = request.split(/[\s,.\-/]+/).filter((w) => /^[א-ת"'׳״]{2,}$/.test(w) && !SELF_STOP.has(w)).map(roots);
  const list = products.slice(0, top);
  if (!ws.length || !list.length) return 1; // nothing to compare (an English request, no products): never alarms
  return list.filter((p) => ws.some((rs) => rs.some((r) => (p.product_title ?? "").includes(r)))).length / list.length;
}
export const SELF_CHECK = 0.2;
// The request's item (its first word) near the start of the title. The color-free best sellers skip the judges, and a
// variant color proves the color, not the kind: "Beige" Lolita shoes for "שמלה ניוד", a "Black" bottle bag for "כוס
// תרמית שחורה" (free check, 2026-11-06).
export function namesItem(title = "", request = "") {
  const w = request.split(/[\s,.\-/]+/).find((x) => /^[א-ת"'׳״]{2,}$/.test(x) && !SELF_STOP.has(x));
  return Boolean(w) && roots(w).some((r) => title.slice(0, 30).includes(r)); // lingerie titles name a dress later on
}

export const fakeLuxury = (title, request = "") => LUXURY.test(title ?? "") && !LUXURY.test(request);

// Capacity the price rules out: a ₪20 "2TB" flash drive, a ₪25 "50,000mAh" power bank, a ₪6 "350W" car charger sell a lot
// but hold far less (owner, 2026-11-04: moved after the real ones, and the card says why). A title listing several sizes is
// judged by its smallest (a real "SanDisk 64GB 128GB 1TB" listing shows the 64GB price).
// shortcut: fixed ₪-per-unit lines from AliExpress prices in 2026-11; raise them if real items get caught.
const STORAGE = /דיסק\s?און\s?קי|disk\s?on\s?key|זיכרון\s?נייד|כונן|כרטיס\s?זיכרון|כרטיס\s?SD|micro\s?sd|\bTF\b|\bSSD\b|flash\s?drive|pen\s?drive|usb\s?stick|memory\s?card/i;
const POWER_BANK = /סוללה\s?ניידת|סוללת\s?גיבוי|מטען\s?נייד|power\s?bank|powerbank/i;
const smallest = (title, re) => Math.min(...[...title.matchAll(re)].map((m) => Number(m[1].replace(",", "")) * (m[2] && /tb/i.test(m[2]) ? 1024 : 1)));
export function fakeCapacity(title = "", price) {
  const n = Number(price);
  if (!(n > 0)) return false;
  const t = title ?? "";
  // Hebrew titles write "2 טרה-בייט" / "512 ג'יגה" too (a ₪12.69 "2 טרה" drive, 2026-11-04).
  const size = /(\d+(?:\.\d+)?)\s*-?\s*(GB|TB|טרה|ג['׳]?יגה|גיגה)(?![a-z])/gi;
  if (STORAGE.test(t) && t.search(size) >= 0) return smallest(t.replace(/טרה/g, "TB"), size) / n > 8; // over 8GB per ₪: 1TB under ₪128
  if (POWER_BANK.test(t) && /\d\s*mAh/i.test(t)) return smallest(t, /(\d{1,3}(?:,\d{3})|\d{4,6})\s*(mAh)/gi) / n > 800; // 20,000mAh under ₪25
  // A cable says "מטען" too ("כבל ... מטען מהיר"): a real ₪10 Baseus 100W cable was moved down (owner's test, 2026-11-04).
  // The item is whichever word comes first; a charger "כולל כבל" is still a charger.
  const cable = t.search(/כבל|cable|(?:^|\s)(?:to|עד)\s+(?:usb|type|lightning)/i), charger = t.search(/מטען|charger/i);
  if (charger >= 0 && !(cable >= 0 && cable < charger) && !POWER_BANK.test(t) && /\d{2,3}\s*W\b/i.test(t)) {
    const w = smallest(t, /(\d{2,3})\s*(W)\b/gi);
    // Under ₪1 per 4W: a ₪4.26 "65W" led "מטען מהיר" (a real 65W GaN costs ₪40+; owner's test, 2026-11-04).
    return w >= 40 && n < w / 4;
  }
  return false;
}

// Items mostly sold as their cover: for "כרית נוי" a cushion cover IS the item (45x45 covers were dropped, 2026-11-01).
const SOLD_AS_COVER = /^(?:כיסוי|כיסויי|ציפית|ציפיות)\s+ל?(כרית|כריות|שמיכ|פוך|דובה)/;
export function isPartFor(title, request = "") {
  if (PART_REQUEST.test(request)) return false;
  const t = cleanTitle(title);
  if (PART_TITLE.test(t)) return true;
  // "לרובוט השואב… תיק אבק" is FOR the requested item: a part. Only when the word after ל is the item itself; any title
  // starting with ל was a part before, so "לוח שנה של NeeDoh", "לגו" and "לד" were all dropped (2026-11-02).
  const forItem = t.match(/^ל([א-ת]{3,})/);
  if (forItem && request.includes(forItem[1].slice(0, 3))) return true;
  const cover = t.replace(BUNDLE_PREFIX, "").match(SOLD_AS_COVER);
  if (cover && request.includes(cover[1].slice(0, 3))) return false;
  const body = t.replace(BUNDLE_PREFIX, "");
  const first = body.split(/[\s,]/)[0];
  // "מגן לאייפון" and "כיסוי לאייפון" are the same item: AliExpress titles every case "כיסוי…", so a request for a "מגן"
  // dropped them all as parts (0 results for "מגן לאייפון", 1 for "מגן לסמסונג s24", 2026-11-02). A screen protector
  // ("מגן מסך") is still a part for a case request.
  const screen = /^(?:מגן|מגני)\s+מסך/.test(body) && !/מסך/.test(request);
  if (CASE_WORDS.test(first) && CASE_REQUEST.test(request) && !screen) return false;
  // מחזיק / מעמד / תושבת are one item for a holder request: AliExpress titles most car phone holders "תושבת…", and every
  // one, Baseus too, was dropped as a part for "מחזיק טלפון לרכב" and "מעמד טלפון לרכב של Baseus" (2026-11-02).
  if (HOLDER_WORDS.test(first) && HOLDER_REQUEST.test(request)) return false;
  return PART_FIRST_WORDS.test(first) && !request.includes(first.slice(0, 4)); // 4 letters: "כיסוי" isn't "כיסא"
}

// A best seller with 85-90% positive feedback stays (owner, 2026-11-03): the 90% bar alone left out 14% of the top-20 best
// sellers in 50 common searches, 118 of them sold 1,000+ times (a 19,921-sold charger at 87%); the competitor shows them.
const BIG_SELLER_SOLD = 1000;
const BIG_SELLER_FEEDBACK = 85;
export const bigSeller = (p) => Number(p.lastest_volume) > BIG_SELLER_SOLD && parseEvaluateRate(p.evaluate_rate) >= BIG_SELLER_FEEDBACK;

export function filterProducts(products) {
  return products.filter((p) => {
    const rate = parseEvaluateRate(p.evaluate_rate);
    return rate === null || rate >= MIN_FEEDBACK || bigSeller(p);
  });
}

export function formatPrice(value, currency) {
  const n = Number(value);
  if (value == null || value === "" || !Number.isFinite(n)) return null;
  return currency === "ILS" ? `₪${n.toFixed(2)}` : `${currency ?? ""} ${n.toFixed(2)}`.trim();
}

// The title's first clause without seller filler, one line, cut at a word boundary so brand/model words stay intact.
export function shortTitle(title) {
  const full = cleanTitle(title);
  const first = full.split(/\s*[,،|;]\s*|\s+[-–]\s+/)[0];
  const t = [...first].length >= 12 ? first : full; // a too-short first clause ("נעלי נשים") says too little
  if ([...t].length <= TITLE_MAX) return t;
  let out = "";
  for (const word of t.split(" ")) {
    const next = out ? `${out} ${word}` : word;
    if ([...next].length > TITLE_MAX - 1) break;
    out = next;
  }
  return (out || [...t].slice(0, TITLE_MAX - 1).join("")) + "…";
}

// Exact below 100; from 100, rounded down to 2 significant digits after "מעל" (a trailing "+" flips to the left in RTL).
export function soldText(volume) {
  const n = Math.floor(Number(volume));
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n < 100) return String(n);
  const step = 10 ** (String(n).length - 2);
  return `מעל ${(Math.floor(n / step) * step).toLocaleString("en-US")}`;
}

// Stars + review count (future DS API data) first, else the positive-feedback %, else nothing. Never shows 0.
export function ratingText(p) {
  const stars = Number(p.avgStars);
  const reviews = Math.round(Number(p.reviewCount));
  if (stars > 0 && reviews > 0) return `⭐ דירוג: ${stars.toFixed(1)} (${reviews.toLocaleString("en-US")} ביקורות)`;
  const rate = parseEvaluateRate(p.evaluate_rate);
  return rate > 0 ? `👍 משוב חיובי: ${Math.round(rate)}%` : null;
}

const salePrice = (p) => formatPrice(p.target_sale_price ?? p.sale_price, p.target_sale_price_currency ?? p.sale_price_currency);

// from: the search price is the cheapest variant (a ₪15.59 rug is the 60 cm one, 2026-11-01), so the card says "החל מ".
// AliExpress promo codes the owner copies from Portals into coupons.json: [{ "code", "off" (USD), "min" (USD, the cart
// total it needs), "until" ("YYYY-MM-DD", last valid day) }]. A card shows the biggest code the item's price reaches.
// shortcut: fixed dollar rate, like the price parser in query.js.
const COUPON_USD_ILS = 3.7;
export function couponLine(p, coupons = COUPONS, now = Date.now()) {
  const usd = Number(p.target_sale_price ?? p.sale_price) / COUPON_USD_ILS;
  const today = new Date(now).toISOString().slice(0, 10);
  const best = coupons
    .filter((c) => c?.code && c.off > 0 && (!c.until || c.until >= today) && usd >= (c.min ?? 0))
    .sort((a, b) => b.off - a.off)[0];
  return best ? `🎟️ קופון <code>${esc(best.code)}</code>: $${best.off} הנחה${best.min ? ` מעל $${best.min}` : ""}` : null;
}

export function priceLine(p, { from = false } = {}) {
  const price = salePrice(p);
  return price ? `💰 מחיר: ${from ? "החל מ-" : ""}<b>${esc(price)}</b>` : null;
}

// Original price + 🔥 badge only for 5% ≤ discount < 80% (higher means an inflated "original").
export function discountLine(p) {
  const s = Number(p.target_sale_price ?? p.sale_price);
  const original = p.target_original_price ?? p.original_price;
  const o = Number(original);
  if (!(s > 0 && o > s)) return null;
  const discount = Math.round((1 - s / o) * 100);
  if (discount < 5 || discount >= 80) return null;
  return `🏷️ במקום <s>${esc(formatPrice(original, p.target_sale_price_currency ?? p.sale_price_currency))}</s> · ${discount}% הנחה 🔥`;
}

export const CLOSEST_NOTE = "לא מצאתי התאמה מדויקת, אלה הכי קרובים 👇";
// Almost nothing found (real wall mirrors: only acrylic stickers, 2026-11-01): AliExpress often doesn't ship it to Israel.
// A color search: many listings come in several colors and the photo may show another one (a faucet titled black,
// pictured silver, black on the product page; owner, 2026-11-02). One line under the title says so.
export const OVER_BUDGET_NOTE = "קצת מעל התקציב";
// A search for something that fits a named device or car ("כיסוי לאייפון 17", "שטיחונים לטסלה"): most listings cover many
// models at once (70-100% of the top sellers for cases, protectors, bands, key covers; free study, 2026-11-04), so the card
// says the model is picked on the product page (owner, 2026-11-04). Chinese makes added from the owner's AliExpress feed
// (BYD Atto 3, Seagull, MG..., 2026-11-05).
const DEVICES = /(?:אייפון|iphone|גלקסי|galaxy|סמסונג|samsung|שיאומי|xiaomi|רדמי|redmi|פיקסל|pixel|וואווי|huawei|אייפד|ipad|אפל\s?ווטש|apple\s?watch|שעון\s?אפל|איירפודס|airpods|מקבוק|macbook|טויוטה|toyota|קורולה|corolla|מאזדה|mazda|יונדאי|hyundai|קיה|kia|טסלה|tesla|סקודה|skoda|פולקסווגן|volkswagen|ניסאן|nissan|הונדה|honda|שברולט|chevrolet|סובארו|subaru|מיצובישי|mitsubishi|פיג'ו|peugeot|רנו|renault|סוזוקי|suzuki|מרצדס|mercedes|אאודי|audi|פורד|ford|bmw|ב\.?מ\.?וו|byd|בי ?וואי ?די|ביי ?די|אטו ?3|atto ?3|סיגל|seagull|דולפין|dolphin|יואן|yuan|ג'יקו|jaecoo|אומודה|omoda|צ'רי|chery|טיגו|tiggo|ג'ילי|geely|זיקר|zeekr|אקספנג|xpeng|\bmg\b|אם ג'י)/;
export const namesModel = (text = "") => new RegExp(`(?:(?<![א-ת])ל-?|של\\s+|\\bfor\\s+)${DEVICES.source}`, "i").test(text); // "ל-BYD" too
export const MODELS_NOTE = "📱 רוב המוצרים מגיעים לכמה דגמים: בדף המוצר בחרו את הדגם שלכם";
export const COLORS_NOTE = "🎨 חלק מהמוצרים מגיעים במבחר צבעים: בדף המוצר בחרו את הצבע שביקשתם";
// A brand search with few items of the brand: other brands fill the card, and the card says so (owner: always 4, 2026-11-03).
export const FILL_NOTE = "מצאתי מעט מוצרים של המותג שביקשתם, הוספתי גם דומים ממותגים אחרים 👇";
// Big items AliExpress hardly ships to Israel: a search returns only their accessories (fridge glue, washing machine
// bags, sofa covers; free check, 2026-11-04). The shopper gets buttons for what does ship (owner, 2026-11-04). A request
// that already asks for the small kind ("מכונת כביסה ניידת") is searched as is.
// An accessory named after the machine ("מכונת כביסה מחזיק דלת", the owner's washer door prop, 2026-11-05) is searched too.
const SMALL_KIND = /מיני|נייד|קטן|לרכב|מתנפח|מתקפל|לבובות|צעצוע|כיסוי|מגן|מארגן|אביזר|חלק|מסנן|פילטר|מחזיק|מעמד|ידית|מגנט|צינור|ברז|רגלי|גומי|אטם|שטיח|כרית|ציפ|סדין|שקית|טבליות|אבקה|ניקוי|מנקה|נוזל|שלט/;
const BIG_ITEMS = [
  { re: /^(?:מכונת|מכונות)\s+כביסה/, he: "מכונות כביסה", alts: [["מכונת כביסה ניידת", "portable washing machine"], ["אביזרים למכונת כביסה", "washing machine accessories"]] },
  { re: /^(?:מייבש|מייבשי)\s+כביסה/, he: "מייבשי כביסה", alts: [["מתקן ייבוש כביסה", "clothes drying rack"], ["חבל כביסה מתקפל", "retractable clothesline"]] },
  { re: /^(?:מדיח|מדיחי)(?:\s|$)/, he: "מדיחי כלים", alts: [["מתקן ייבוש כלים", "dish drying rack"], ["אביזרים למדיח", "dishwasher accessories"]] },
  { re: /^(?:ספה|ספות)(?:\s|$)/, he: "ספות", alts: [["ספה מתנפחת", "inflatable sofa"], ["כיסוי לספה", "sofa cover"]] },
  { re: /^(?:מיטה|מיטות)(?:\s|$)/, he: "מיטות", alts: [["מזרון מתנפח", "inflatable air mattress"], ["מצעים", "bed sheet set"]] },
  { re: /^(?:מזגן|מזגנים)(?:\s|$)/, he: "מזגנים", alts: [["מצנן אוויר נייד", "portable air cooler"], ["מאוורר נטען", "rechargeable fan"]] },
  { re: /^(?:טלוויזיה|טלויזיה|טלוויזיות)(?:\s|$)/, he: "טלוויזיות", alts: [["מקרן נייד", "portable projector"], ["סטרימר לטלוויזיה", "android tv box"]] },
];
export function bigItem(text = "") {
  const t = text.trim();
  if (SMALL_KIND.test(t)) return null;
  const b = BIG_ITEMS.find((x) => x.re.test(t));
  return b ? { question: `עלי אקספרס כמעט לא שולחת ${b.he} לישראל. אפשר למצוא:`, options: b.alts.map(([label_he, keywords_en]) => ({ label_he, keywords_en, max_price_ils: null })) } : null;
}
// A weak card (its best product sold under WEAK_SOLD times, or fewer than 4): the shopper is told it is AliExpress, not the bot.
export const WEAK_SOLD = 50;
// Fakes moved down (fakeCapacity): the card says why the cheap big ones aren't first, or warns when one is still shown.
// The example matches the kind skipped ("2TB" on a charger card read oddly; owner's test, 2026-11-04).
export const fakeExample = (title = "") => (STORAGE.test(title) ? "2TB ב-20 ₪" : POWER_BANK.test(title) ? "50,000mAh ב-25 ₪" : "240W ב-8 ₪");
export const fakeSkippedNote = (example = "2TB ב-20 ₪") => `⚠️ דילגתי על מוצרים זולים שמבטיחים נפח או הספק לא אמיתיים (כמו ${example}): הם נמכרים הרבה אבל מאכזבים. כאן מוצרים אמינים`;
export const FAKE_SKIPPED_NOTE = fakeSkippedNote();
export const FAKE_SHOWN_NOTE = "⚠️ חלק מהמוצרים כאן זולים מדי לנפח או להספק שהם מבטיחים: הנפח האמיתי כנראה קטן יותר";
// A listing sold in several sizes ("SanDisk 32GB ... 1TB" at the 32GB price, owner's test 2026-11-04): AliExpress shows the
// smallest one's price, so the card says prices change with the size (owner: general wording, buyers know this).
const SIZE = /(\d+(?:[.,]\d+)?)\s*-?\s*(GB|TB|mAh|W|ml|מ"ל|ליטר|L|cm|ס"מ|מ'|מטר|m|mm|מ"מ|inch|אינץ')(?![a-zא-ת])/gi;
export const manySizes = (title = "") => new Set([...(title ?? "").matchAll(SIZE)].map((m) => `${m[1]}${m[2].toLowerCase()}`)).size >= 3;
export const SIZES_NOTE = "💡 המחיר עשוי להשתנות לפי הנפח או הגודל שבוחרים בדף המוצר";
// The 16 brands of the look-alike research (2026-11-05): the card says the original isn't sold on AliExpress. A request FOR
// the brand ("כיסוי לאיירפודס", "קישוטים לקרוקס") is an accessory and gets no note.
const LOOKALIKE = /(?<![א-ת])(?:של\s+|[ו]?)(איירפודס|אייר פודס|אירפודס|airpods|אפל ווטש|שעון אפל|apple watch|איירטאג|אייר טאג|airtag|אפל פנסיל|apple pencil|לולולמון|לולו למון|lululemon|קרוקס|crocs|ריי באן|רייבן|ray-?ban|רולקס|rolex|לגו|lego|תרגאן|theragun|אוואלה|owala|ugg|סקימס|skims|מייבש שיער (?:של )?דייסון|dyson hair dryer|לואי ויטון|louis vuitton|טבעת אורה|oura)(?![א-ת])/i;
export const lookalikeBrand = (text = "") => LOOKALIKE.test(text);
export const LOOKALIKE_NOTE = "ℹ️ את המותג המקורי כמעט אין בעלי אקספרס, אז אלה דגמים בסגנון דומה";
export const WEAK_NOTE = "ℹ️ בעלי אקספרס יש מעט מוצרים נמכרים מהסוג הזה לישראל: כדאי לבדוק דירוג וביקורות לפני קנייה";
export const RARE_NOTE = "לא מצאתי התאמה מדויקת (ייתכן שעלי אקספרס לא שולחת את זה לישראל), אלה הכי קרובים 👇";

// Israel: personal imports above $75 pay 18% VAT, collected by AliExpress at checkout (the $75 cap is back since June 2026).
// shortcut: compares the item price only, at a fixed rate; the real check is the whole order's value.
const VAT_FREE_ILS = 75 * 3.7;
export function vatLine(p) {
  const n = Number(p.target_sale_price ?? p.sale_price);
  return (p.target_sale_price_currency ?? p.sale_price_currency) === "ILS" && n > VAT_FREE_ILS ? "🧾 מעל 75$: יתווסף מע״מ 18% בקופה" : null;
}

const badgesOf = (p) => [isChoice(p) && "✅ Choice", p.brandTag === "official" ? "🏷️ חנות רשמית" : p.brandTag === "known" && "🏷️ מותג מוכר"].filter(Boolean);
// [rating, sold]: the badges join the sold line, else the rating line; with neither, they get their own.
function withBadges(p, [rating, sold]) {
  const badges = badgesOf(p);
  if (!badges.length) return [rating, sold];
  if (sold) return [rating, [sold, ...badges].join(" · ")];
  return rating ? [[rating, ...badges].join(" · ")] : [badges.join(" · ")];
}

function buildCard(products, query, demo, reasons, closest, rare, weak, fakes) {
  const fill = !closest && products.some((p) => p.brandFill);
  const fake = products.some((p) => p.fakeCap) ? FAKE_SHOWN_NOTE : fakes ? fakeSkippedNote(typeof fakes === "string" ? fakes : undefined) : null;
  const sizes = products.some((p) => manySizes(p.product_title)) ? SIZES_NOTE : null;
  const lines = [`🔎 <b>${esc(clip(oneLine(query), QUERY_MAX))}</b>${demo ? " [דמו – תוצאות קבועות]" : ""}`, ...(closest ? [rare ? RARE_NOTE : CLOSEST_NOTE] : []), ...(fill ? [FILL_NOTE] : []), ...(fake ? [fake] : []), ...(sizes ? [sizes] : []), ...(weak && !closest ? [WEAK_NOTE] : []), ...(named(query).length ? [COLORS_NOTE] : []), ...(namesModel(query) ? [MODELS_NOTE] : []), ...(lookalikeBrand(query) ? [LOOKALIKE_NOTE] : [])];
  products.forEach((p, i) => {
    const link = /^https?:\/\//i.test(p.promotion_link ?? "") ? p.promotion_link : null;
    const sold = soldText(p.lastest_volume);
    lines.push(
      "",
      ...[
        // A ✨ or 🏷️ pick isn't ranked by sales, so it has no medal; the medals count the best sellers only (🥇 ✨ 🥈 ✨).
        `${p.pretty ? "✨" : p.brandSlot ? "🏷️" : MEDALS[products.slice(0, i).filter((q) => !q.pretty && !q.brandSlot).length]} <b>${esc(p.short_he || shortTitle(p.product_title) || "מוצר")}</b>`,
        p.pretty && "✨ מהיפים ביותר בחיפוש",
        p.colorAlso && colorAlsoLine(query),
        reasons?.[i] && `💡 ${esc(reasons[i])}`,
        [priceLine(p, { from: true }), p.overBudget && OVER_BUDGET_NOTE].filter(Boolean).join(" · "),
        discountLine(p),
        couponLine(p),
        vatLine(p),
        // Trust badges ride on the short sold line (a line each would push the 4th product past the caption limit; on the long
        // rating line "✅ Choice" wrapped onto a line of its own on a phone, live test 2026-11-02).
        ...withBadges(p, [ratingText(p), sold ? `🛒 נמכרו: ${sold}` : `${p.lastest_volume}` === "0" && "🆕 עוד לא נקנה"]), // never-sold come last; the buyer should know (unknown: no line)
        // A link AliExpress didn't shorten (a 900-character "/s/" link filled the card, 2026-11-03) hides behind a word.
        link && (link.length > LONG_LINK ? `🔗 <a href="${esc(link)}">לקנייה בעלי אקספרס</a>` : `🔗 ${esc(link)}`),
      ].filter(Boolean),
    );
  });
  lines.push("", "🐼 פנדה אקספרס", esc(GROUP_URL)); // group link at the end (owner request)
  return { caption: rtl(lines) }; // links are in the text; the keyboard holds only the bot's own buttons (owner request)
}

// Result card for up to 5 products; drops trailing products until the caption fits Telegram's limit.
// Too long (the advisor's 💡 lines pushed the 4th product out while the collage still showed it, owner's test 2026-11-04):
// the 💡 lines, then the names, are shortened first. count = the products in the caption, so the collage shows the same.
export function formatCard(products, { query, demo = false, reasons = null, closest = false, rare = false, weak = false, fakes = false }) {
  const short = (list, max) => list?.map((r) => (r && r.length > max ? `${r.slice(0, max - 1).trim()}…` : r)) ?? null;
  const named = (max) => products.map((p) => (p.short_he && p.short_he.length > max ? { ...p, short_he: `${p.short_he.slice(0, max - 1).trim()}…` } : p));
  const n0 = Math.min(products.length, MEDALS.length);
  for (const [list, why] of [[products, reasons], [products, short(reasons, 45)], [named(28), short(reasons, 30)], [named(28), null]]) {
    const card = buildCard(list.slice(0, n0), query, demo, why, closest, rare, weak, fakes);
    if (parsedLength(card.caption) <= CAPTION_MAX) return { ...card, count: n0 };
  }
  let n = n0 - 1;
  let card;
  do card = buildCard(named(28).slice(0, n), query, demo, null, closest, rare, weak, fakes);
  while (n-- > 1 && parsedLength(card.caption) > CAPTION_MAX);
  return { ...card, count: n + 1 };
}

// Price range from the AI: applies only to ILS prices; other currencies ignore it.
export function withinPrice(products, maxIls, minIls = null) {
  if (!maxIls && !minIls) return products;
  return products.filter((p) => {
    if ((p.target_sale_price_currency ?? p.sale_price_currency) !== "ILS") return true;
    const n = Number(p.target_sale_price ?? p.sale_price);
    return (!maxIls || n <= maxIls) && (!minIls || n >= minIls);
  });
}

export const questionText = (question) => rtl([`🤔 ${esc(question)}`]);
export const chosenText = (label) => rtl([`🔎 ${esc(label)}`]);

export function formatLinkReply(link, { demo = false } = {}) {
  return rtl([`🔗 הנה הקישור${demo ? " [דמו]" : ""}:`, esc(link)]);
}

export const GROUP_LINK = GROUP_URL;
export const HELP = rtl([
  "🐼 <b>פנדה אקספרס: אתם אומרים מה צריך, אני מוצא את הכי שווה בעלי אקספרס</b>",
  "",
  '🔎 כתבו בקבוצה "חפש לי" ואחריו מה שאתם מחפשים:',
  'חפש לי אוזניות אלחוטיות עד 100 ש"ח',
  "",
  "💡 ככל שתפרטו יותר (סוג, צבע, מידה, תקציב), התוצאות מדויקות יותר.",
  "🎁 לא בטוחים מה לקנות? כתבו: חפש לי מתנה לאמא, ואשאל כמה שאלות קצרות.",
  "👇 מתחת לכל תוצאה: 🎯 בול! / 🐼 לא זה, ו-🔍 לחפש עוד?",
]);

// The group's one pinned welcome (owner approved the wording, 2026-11-04); sent and pinned by /pin_welcome.
export const WELCOME_PIN = rtl([
  "🐼 <b>ברוכים הבאים לפנדה אקספרס!</b>",
  "אתם כותבים מה צריך, והבוט מוצא את המוצרים הכי שווים בעלי אקספרס.",
  "",
  "🔎 <b>איך מחפשים?</b>",
  'כותבים "חפש לי" ואחריו המוצר, למשל:',
  '• חפש לי אוזניות אלחוטיות עד 100 ש"ח',
  "• חפש לי כיסוי לאייפון 16",
  "• חפש לי את המטען הכי זול",
  "",
  "💡 <b>טיפים</b>",
  "• ככל שתפרטו יותר (סוג, צבע, מידה, תקציב), התוצאות מדויקות יותר",
  '• לא בטוחים מה לקנות? כתבו "חפש לי מתנה לאמא", והבוט ישאל כמה שאלות קצרות',
  "• מתחת לכל תוצאה: 🎯 בול! / 🐼 לא זה / 🔍 לחפש עוד?",
  "• 🔥 דיל חם כל שעה בערוץ שלנו: t.me/panda_dilim",
  "",
  "📌 <b>כללי הקבוצה</b>",
  "• רק מוצרים ודילים, בשיח מכבד",
  "• בלי פרסום, ספאם או קישורים לקבוצות וערוצים אחרים",
  "• לא מחפשים נשק, סמים, תרופות ומוצרים למבוגרים",
  "• ספאם נמחק: 2 אזהרות, ובפעם השלישית הסרה מהקבוצה",
  "",
  "⚠️ <b>חשוב לדעת</b>",
  "• אנחנו לא מוכרים מוצרים: רק מפנים לעלי אקספרס, ואין לנו אחריות על המוצר, המשלוח או המוכר",
  '• מעל 75$ עלי אקספרס מוסיפה מע"מ 18% בקופה',
  "",
  "קניות מהנות! 🛍️",
]);

export const PRIVATE_INVITE = rtl([
  "🐼 היי! אני עובד בקבוצת <b>פנדה אקספרס</b>.",
  'שם כותבים "חפש לי" ואחריו שם המוצר, ומקבלים את המוצרים הכי שווים מעלי אקספרס.',
  "מחכים לכם בקבוצה 👇",
]);
export const PRIVATE_BUTTON = "החיפוש עובד בקבוצת פנדה אקספרס 🐼";

export const NOT_PRODUCT = rtl(["🤔 לא הבנתי מה לחפש.", 'כתבו "חפש לי" ואחריו שם המוצר, למשל: חפש לי אוזניות אלחוטיות']);
export const OFF_TOPIC = rtl(["🐼 שימו לב: הקבוצה מיועדת למוצרים ודילים מעלי אקספרס.", 'לחיפוש מוצר כתבו "חפש לי" ואחריו שם המוצר, למשל: חפש לי מטען לרכב']);
export const LINK_HELP = rtl(["🔗 אני ממיר רק קישורים של מוצרים מעלי אקספרס.", "באפליקציה: נכנסים למוצר ← שיתוף ← העתקת קישור, ומדביקים כאן."]);
export const NOT_ALLOWED = rtl(["🙏 את זה אני לא מחפש בקבוצה.", "אשמח לעזור עם כל מוצר אחר, למשל: חפש לי אוזניות אלחוטיות"]);
export const SEARCHING = rtl(["🔎 מחפש לכם… רגע ⏳"]);
export const SEARCH_NOW = "🔎 תחפש כבר";
export const BACK_LABEL = "⬅️ חזרה";
export const MORE_LABEL = "🔍 לחפש עוד?";
export const GOOD_LABEL = "🎯 בול!";
export const BAD_LABEL = "🐼 לא זה";
export const NO_MORE = "אין עוד תוצאות לחיפוש הזה";
export const MORE_NOT_YOURS = "רק מי שחיפש יכול לבקש עוד";
export const VOTE_THANKS = "תודה על המשוב 🙏";
export const VOTED = "כבר הצבעת, תודה 🙂";
export const ADVICE_EMPTY = rtl(["על מה להתייעץ? לדוגמה: /advice מתנה לאמא"]);
export const CLARIFY_NOT_YOURS = "רק מי שביקש יכול לבחור";
export const CLARIFY_EXPIRED = "הבקשה פגה, חפשו שוב";
export const EMPTY_QUERY = rtl(["מה לחפש? לדוגמה: חפש לי אוזניות אלחוטיות"]);
export const NO_FOOD = rtl(["😕 עלי אקספרס כמעט לא שולחת מזון לישראל, ולכן אין תוצאות.", "אפשר לחפש אביזרים, למשל: חפש לי מטחנת קפה ידנית"]);
export const NO_RESULTS = rtl(["🙈 לא מצאתי משהו שמתאים בדיוק, אבל אני כאן בשבילכם!", "נסו לכתוב את זה קצת אחרת או כללי יותר, למשל: חפש לי מטען לאייפון 😊"]);
export const HOW_TO_SEARCH = rtl(["🐼 היי! הקבוצה מיועדת לדילים ולמוצרים מעלי אקספרס בלבד.", 'מחפשים משהו? כתבו "חפש לי" ואחריו שם המוצר, למשל: חפש לי אוזניות אלחוטיות']);
export const guideText = (name) => rtl(['🙂 כדי שאוכל לעזור בצורה הכי טובה, כתבו "חפש לי" ואחריו שם המוצר.', `למשל: חפש לי ${esc(name)}`]);
export const SEARCH_ERROR = rtl(["😕 הייתה תקלה בחיבור לעלי אקספרס. נסו שוב בעוד דקה."]);
export const LINK_ERROR = rtl(["😕 לא הצלחתי ליצור קישור כרגע. נסו שוב בעוד דקה."]);
export const cooldownMessage = (seconds) => rtl([`⏳ רגע… אפשר לחפש שוב בעוד ${seconds} שניות.`]);
