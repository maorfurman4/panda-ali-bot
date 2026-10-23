// Telegram handlers: search triggers, link conversion, cooldowns, Hebrew photo result cards.
// Privacy: logs contain only update IDs and error messages, never message text or user names.
import { Bot, InputFile } from "grammy";
import { searchProducts, convertToAffiliate, isMockMode } from "./aliexpress.js";
import { findAliExpressUrl } from "./links.js";
import { understandQuery, filterRelevant } from "./query.js";
import { makeCollage } from "./collage.js";
import { createModeration } from "./moderation.js";
import {
  filterProducts,
  withinPrice,
  formatCard,
  formatLinkReply,
  clarifyText,
  chosenText,
  cooldownMessage,
  HELP,
  GROUP_HELP,
  EMPTY_QUERY,
  NO_RESULTS,
  NOT_PRODUCT,
  SEARCH_ERROR,
  LINK_ERROR,
  SEARCH_AS_TYPED,
  CLARIFY_NOT_YOURS,
  CLARIFY_EXPIRED,
} from "./format.js";

const GROUP_RESULTS = 3;
const PRIVATE_RESULTS = 5;
const HELP_COOLDOWN_MS = 10 * 60_000;
const CLARIFY_TTL_MS = 10 * 60_000;
const BIDI_MARKS = /[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g; // copied mobile text often starts with one
const TRIGGER = /^\s*(?:ת?חפש|ת?מצא|חפשו|מצאו|חפשי|מצאי)\s+לי(?=[\s:]|$)[\s:]*([\s\S]*)$/;
// Natural shopping phrases that may appear anywhere in a group message. Only these messages are sent to the AI,
// and the bot answers only if the AI confirms a product request (otherwise it stays silent).
const SOFT_PHRASES = [
  "מחפש", "מחפשת", "מחפשים", "מחפשות",
  "מישהו מכיר", "מישהי מכירה", "מישהו יודע איפה", "מכירים",
  "יש המלצה", "יש למישהו המלצה", "יש לכם המלצה", "המלצה על", "ממליצים על", "תמליצו", "מה מומלץ",
  "איפה קונים", "איפה אפשר לקנות", "איפה מוצאים", "איפה משיגים",
  "רוצה לקנות", "בא לי לקנות", "צריך לקנות", "צריכה לקנות", "שווה לקנות",
];
const SOFT = new RegExp(`(?:^|[\\s,.!?"'(])(?:${SOFT_PHRASES.join("|")})(?=$|[\\s,.!?])`);
const SOFT_MAX_LENGTH = 200;

export const isSoftRequest = (text) => text.length <= SOFT_MAX_LENGTH && SOFT.test(text.replace(BIDI_MARKS, ""));

// Text after a leading "@username", or null when the message doesn't start with the mention.
function mentionRest(text, username) {
  const m = text.replace(BIDI_MARKS, "").match(new RegExp(`^\\s*@${username}(?![A-Za-z0-9_])[\\s:,]*([\\s\\S]*)$`, "i"));
  return m ? m[1].trim() : null;
}

// Query for a start-of-message trigger ("" when it has no query), or null when the text isn't addressed to the bot.
export function parseTrigger(text, username) {
  const m = text.replace(BIDI_MARKS, "").match(TRIGGER);
  return m ? m[1].trim() : mentionRest(text, username);
}

export function createBot({
  token,
  botInfo,
  search = searchProducts,
  convert = convertToAffiliate,
  understand = understandQuery,
  relevant = filterRelevant,
  collage = makeCollage,
  live, // tests only: force the live (non-mock) path
  typingEveryMs = 4000,
  now = Date.now,
  cooldownMs = 10_000,
}) {
  const bot = new Bot(token, botInfo ? { botInfo } : {});
  const moderation = createModeration({ now });
  bot.use(moderation.middleware); // runs first: spam is removed before any search logic sees it
  bot.on("message:new_chat_members", moderation.onJoin);
  const cooldowns = new Map(); // shortcut: in-memory, resets on restart; fine for a single instance
  const groupHelpAt = new Map();
  const pending = new Map(); // clarify questions waiting for a button press, by short id (same shortcut as above)
  let clarifySeq = 0;

  const replyParams = (messageId) => ({ reply_parameters: { message_id: messageId, allow_sending_without_reply: true } });
  const replyTo = (ctx) => replyParams(ctx.msg.message_id);
  const reply = (ctx, html, extra = {}) =>
    ctx.reply(html, { parse_mode: "HTML", link_preview_options: { is_disabled: true }, ...replyTo(ctx), ...extra });

  const coolingDown = (ctx) => {
    const entry = cooldowns.get(ctx.from?.id ?? ctx.chat.id);
    return Boolean(entry && entry.at + cooldownMs > now());
  };

  // Per-user cooldown shared by searches and link conversions; warns once per window, then stays silent.
  async function allow(ctx) {
    const userId = ctx.from?.id ?? ctx.chat.id;
    const entry = cooldowns.get(userId);
    const wait = entry ? entry.at + cooldownMs - now() : 0;
    if (wait > 0) {
      if (!entry.warned) {
        entry.warned = true;
        await reply(ctx, cooldownMessage(Math.ceil(wait / 1000)));
      }
      return false;
    }
    cooldowns.set(userId, { at: now(), warned: false });
    if (cooldowns.size > 1000) for (const [id, e] of cooldowns) if (now() - e.at > cooldownMs) cooldowns.delete(id);
    return true;
  }

  // Telegram shows a chat action for ~5 s only, so "typing…" is refreshed until the work is done.
  async function withTyping(ctx, work) {
    const send = () => ctx.replyWithChatAction("typing").catch(() => {});
    send();
    const timer = setInterval(send, typingEveryMs);
    try {
      return await work();
    } finally {
      clearInterval(timer);
    }
  }

  async function runSearch(ctx, rawQuery) {
    const query = rawQuery.trim();
    if (!query) return reply(ctx, EMPTY_QUERY);
    if (!(await allow(ctx))) return;

    return withTyping(ctx, async () => {
      const intent = await understand(query).catch(() => null); // null = AI unavailable: search the raw query
      if (intent?.status === "not_product") return reply(ctx, NOT_PRODUCT);
      if (intent?.status === "clarify") return askClarify(ctx, query, intent);
      return showResults(ctx, {
        keywords: intent?.keywords_en || query,
        header: intent?.corrected_he || query,
        maxPriceIls: intent?.max_price_ils ?? null,
        replyToId: ctx.msg.message_id,
      });
    });
  }

  // A natural group request ("מישהו מכיר מטען טוב?"): silent unless the AI confirms a product request.
  async function runSoftSearch(ctx, text) {
    if (coolingDown(ctx)) return;
    const intent = await understand(text).catch(() => null);
    if (intent?.status !== "ok" && intent?.status !== "clarify") return;
    await allow(ctx); // starts the cooldown only for requests the bot actually answers
    if (intent.status === "clarify") return askClarify(ctx, text, intent);
    return withTyping(ctx, () =>
      showResults(ctx, { keywords: intent.keywords_en, header: intent.corrected_he || text, maxPriceIls: intent.max_price_ils ?? null, replyToId: ctx.msg.message_id }),
    );
  }

  async function showResults(ctx, { keywords, header, maxPriceIls, replyToId }) {
    let products;
    try {
      products = await search(keywords);
    } catch (e) {
      console.error(`update ${ctx.update.update_id}: search failed: ${e.message}`);
      return ctx.reply(SEARCH_ERROR, { parse_mode: "HTML", ...replyParams(replyToId) });
    }
    const limit = ctx.chat.type === "private" ? PRIVATE_RESULTS : GROUP_RESULTS;
    let candidates = withinPrice(filterProducts(products), maxPriceIls);
    // Demo products always match, so the AI relevance check runs only on real AliExpress results.
    if (live ?? !isMockMode()) candidates = await relevant({ he: header, en: keywords }, candidates).catch(() => candidates);
    const shown = candidates.slice(0, limit);
    if (!shown.length) return ctx.reply(NO_RESULTS, { parse_mode: "HTML", ...replyParams(replyToId) });

    const { caption, buttons } = formatCard(shown, { query: header, demo: isMockMode() });
    const extra = { parse_mode: "HTML", ...replyParams(replyToId), ...(buttons.length ? { reply_markup: { inline_keyboard: buttons } } : {}) };
    const collageImage = await collage(shown.map((p) => p.product_main_image_url)).catch(() => null);
    const image = collageImage ? new InputFile(collageImage, "panda-results.jpg") : shown[0].product_main_image_url;
    if (collageImage || /^https:\/\//i.test(image ?? "")) {
      try {
        return await ctx.replyWithPhoto(image, { caption, ...extra });
      } catch (e) {
        console.error(`update ${ctx.update.update_id}: sendPhoto failed, sending text instead: ${e.message}`);
      }
    }
    return ctx.reply(caption, { ...extra, link_preview_options: { is_disabled: true } });
  }

  // Asks the requester to pick an option; the choice arrives as a callback "q:<id>:<n|raw>".
  function askClarify(ctx, query, intent) {
    const id = (++clarifySeq).toString(36);
    for (const [key, e] of pending) if (now() - e.at > CLARIFY_TTL_MS) pending.delete(key);
    pending.set(id, { userId: ctx.from?.id, query, options: intent.options, maxPriceIls: intent.max_price_ils, replyToId: ctx.msg.message_id, at: now() });
    const rows = intent.options.map((o, n) => [{ text: o.label_he, callback_data: `q:${id}:${n}` }]);
    rows.push([{ text: SEARCH_AS_TYPED, callback_data: `q:${id}:raw` }]);
    return reply(ctx, clarifyText(intent.clarify_question_he), { reply_markup: { inline_keyboard: rows } });
  }

  async function runConvert(ctx, url) {
    if (!(await allow(ctx))) return;
    let link;
    try {
      link = await convert(url);
    } catch (e) {
      console.error(`update ${ctx.update.update_id}: link conversion failed: ${e.message}`);
      return reply(ctx, LINK_ERROR);
    }
    if (link) return reply(ctx, formatLinkReply(link, { demo: isMockMode() }));
  }

  // Private: full help. Group: one line + deep link, at most once per 10 minutes per chat (silent otherwise).
  bot.command(["start", "help"], (ctx) => {
    if (ctx.chat.type === "private") return reply(ctx, HELP);
    const last = groupHelpAt.get(ctx.chat.id);
    if (last !== undefined && now() - last < HELP_COOLDOWN_MS) return;
    groupHelpAt.set(ctx.chat.id, now());
    const button = { text: "להסבר המלא", url: `https://t.me/${ctx.me.username}?start=help` };
    return reply(ctx, GROUP_HELP, { reply_markup: { inline_keyboard: [[button]] } });
  });
  bot.command("search", (ctx) => runSearch(ctx, ctx.match));

  // Clarify choice. Only the requester may choose; the search cooldown was already counted for the request.
  bot.callbackQuery(/^q:([0-9a-z]+):(\d|raw)$/, async (ctx) => {
    const [, id, choice] = ctx.match;
    const entry = pending.get(id);
    if (!entry || now() - entry.at > CLARIFY_TTL_MS) {
      pending.delete(id);
      return ctx.answerCallbackQuery({ text: CLARIFY_EXPIRED });
    }
    if (ctx.from.id !== entry.userId) return ctx.answerCallbackQuery({ text: CLARIFY_NOT_YOURS });
    const option = choice === "raw" ? { label_he: entry.query, keywords_en: entry.query } : entry.options[Number(choice)];
    if (!option) return ctx.answerCallbackQuery();
    pending.delete(id);
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(chosenText(option.label_he), { parse_mode: "HTML" }).catch(() => {}); // no reply_markup = buttons removed
    return withTyping(ctx, () => showResults(ctx, { keywords: option.keywords_en, header: option.label_he, maxPriceIls: entry.maxPriceIls, replyToId: entry.replyToId }));
  });
  bot.on("callback_query:data", (ctx) => ctx.answerCallbackQuery()); // never leave a button spinning

  bot.on("message:text", async (ctx) => {
    const text = ctx.msg.text;
    if (text.startsWith("/")) return; // commands for other bots, or unknown commands
    const username = ctx.me.username;
    const isPrivate = ctx.chat.type === "private";
    // Groups: links are converted only when the message starts with the bot mention; plain links stay untouched.
    if (isPrivate || mentionRest(text, username) !== null) {
      const url = findAliExpressUrl(text);
      if (url) return runConvert(ctx, url);
    }
    const query = parseTrigger(text, username);
    if (query !== null) return runSearch(ctx, query);
    if (isPrivate) return runSearch(ctx, text);
    if (isSoftRequest(text)) return runSoftSearch(ctx, text);
  });

  bot.catch((err) => console.error(`update ${err.ctx.update.update_id} failed: ${err.error?.message ?? err.error}`));
  return bot;
}
