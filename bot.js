// Telegram handlers: search triggers, link conversion, per-user cooldown, Hebrew replies.
// Privacy: logs contain only update IDs and error messages, never message text or user names.
import { Bot } from "grammy";
import { searchProducts, convertToAffiliate, isMockMode } from "./aliexpress.js";
import { findAliExpressUrl } from "./links.js";
import {
  filterProducts,
  formatResults,
  formatLinkReply,
  cooldownMessage,
  HELP,
  EMPTY_QUERY,
  NO_RESULTS,
  SEARCH_ERROR,
  LINK_ERROR,
} from "./format.js";

const MAX_RESULTS = 5;

// Query for a group trigger ("" when the trigger has no query), or null when the text isn't addressed to the bot.
export function parseTrigger(text, username) {
  const clean = text.replace(/[‎‏‪-‮⁦-⁩]/g, ""); // bidi marks from copied mobile text
  const hebrew = clean.match(/^\s*חפש(?:\s+לי(?=[\s:]|$))?(?=[\s:]|$)[\s:]*([\s\S]*)$/);
  if (hebrew) return hebrew[1].trim();
  const mention = new RegExp(`(^|\\s)@${username}(?![A-Za-z0-9_])`, "i");
  if (mention.test(clean)) return clean.replace(mention, " ").replace(/\s+/g, " ").trim();
  return null;
}

export function createBot({ token, botInfo, search = searchProducts, convert = convertToAffiliate, now = Date.now, cooldownMs = 10_000 }) {
  const bot = new Bot(token, botInfo ? { botInfo } : {});
  const cooldowns = new Map(); // shortcut: in-memory, resets on restart; fine for a single instance

  const reply = (ctx, html) =>
    ctx.reply(html, {
      parse_mode: "HTML",
      reply_parameters: { message_id: ctx.msg.message_id, allow_sending_without_reply: true },
      link_preview_options: { is_disabled: true },
    });

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

    ctx.replyWithChatAction("typing").catch(() => {});
    let products;
    try {
      products = await search(query);
    } catch (e) {
      console.error(`update ${ctx.update.update_id}: search failed: ${e.message}`);
      return reply(ctx, SEARCH_ERROR);
    }
    const shown = filterProducts(products).slice(0, MAX_RESULTS);
    return reply(ctx, shown.length ? formatResults(shown, { demo: isMockMode() }) : NO_RESULTS);
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

  bot.command(["start", "help"], (ctx) => reply(ctx, HELP));
  bot.command("search", (ctx) => runSearch(ctx, ctx.match));

  bot.on("message:text", async (ctx) => {
    const text = ctx.msg.text;
    if (text.startsWith("/")) return; // commands for other bots, or unknown commands
    const url = findAliExpressUrl(text);
    if (url) return runConvert(ctx, url);
    const query = parseTrigger(text, ctx.me.username);
    if (query !== null) return runSearch(ctx, query);
    if (ctx.chat.type === "private") return runSearch(ctx, text);
  });

  bot.catch((err) => console.error(`update ${err.ctx.update.update_id} failed: ${err.error?.message ?? err.error}`));
  return bot;
}
