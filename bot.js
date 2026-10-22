// Telegram handlers: search triggers, link conversion, cooldowns, Hebrew photo result cards.
// Privacy: logs contain only update IDs and error messages, never message text or user names.
import { Bot } from "grammy";
import { searchProducts, convertToAffiliate, isMockMode } from "./aliexpress.js";
import { findAliExpressUrl } from "./links.js";
import {
  filterProducts,
  formatCard,
  formatLinkReply,
  cooldownMessage,
  HELP,
  GROUP_HELP,
  EMPTY_QUERY,
  NO_RESULTS,
  SEARCH_ERROR,
  LINK_ERROR,
} from "./format.js";

const GROUP_RESULTS = 3;
const PRIVATE_RESULTS = 5;
const HELP_COOLDOWN_MS = 10 * 60_000;
const BIDI_MARKS = /[‎‏‪-‮⁦-⁩]/g; // copied mobile text often starts with one
const TRIGGER = /^\s*(?:חפש|מצא)\s+לי(?=[\s:]|$)[\s:]*([\s\S]*)$/;

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

export function createBot({ token, botInfo, search = searchProducts, convert = convertToAffiliate, now = Date.now, cooldownMs = 10_000 }) {
  const bot = new Bot(token, botInfo ? { botInfo } : {});
  const cooldowns = new Map(); // shortcut: in-memory, resets on restart; fine for a single instance
  const groupHelpAt = new Map();

  const replyTo = (ctx) => ({ reply_parameters: { message_id: ctx.msg.message_id, allow_sending_without_reply: true } });
  const reply = (ctx, html, extra = {}) =>
    ctx.reply(html, { parse_mode: "HTML", link_preview_options: { is_disabled: true }, ...replyTo(ctx), ...extra });

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

  async function runSearch(ctx, rawQuery) {
    const query = rawQuery.trim();
    if (!query) return reply(ctx, EMPTY_QUERY);
    if (!(await allow(ctx))) return;

    ctx.replyWithChatAction("upload_photo").catch(() => {});
    let products;
    try {
      products = await search(query);
    } catch (e) {
      console.error(`update ${ctx.update.update_id}: search failed: ${e.message}`);
      return reply(ctx, SEARCH_ERROR);
    }
    const shown = filterProducts(products).slice(0, ctx.chat.type === "private" ? PRIVATE_RESULTS : GROUP_RESULTS);
    if (!shown.length) return reply(ctx, NO_RESULTS);

    const { caption, buttons } = formatCard(shown, { query, demo: isMockMode() });
    const extra = { parse_mode: "HTML", ...replyTo(ctx), ...(buttons.length ? { reply_markup: { inline_keyboard: buttons } } : {}) };
    const image = shown[0].product_main_image_url;
    if (/^https:\/\//i.test(image ?? "")) {
      try {
        return await ctx.replyWithPhoto(image, { caption, ...extra });
      } catch (e) {
        console.error(`update ${ctx.update.update_id}: sendPhoto failed, sending text instead: ${e.message}`);
      }
    }
    return ctx.reply(caption, { ...extra, link_preview_options: { is_disabled: true } });
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
  });

  bot.catch((err) => console.error(`update ${err.ctx.update.update_id} failed: ${err.error?.message ?? err.error}`));
  return bot;
}
