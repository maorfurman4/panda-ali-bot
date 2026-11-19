// Group protection. Telegram never shows a bot the messages of other bots, so bots are caught when they join:
// a bot added by a non-admin is removed at once. Spam from member accounts gets: delete + warning 1/2,
// delete + warning 2/2, then removal. Needs the bot to be a group admin with "delete messages" + "ban users".
// Privacy: message texts are kept only as hashes in memory (for repeat detection) and never logged.
import { createHash } from "node:crypto";
import { esc, RLM } from "./format.js";
import { isAliExpressHost } from "./links.js";
import { station } from "./aura-report.js";

const NEW_MEMBER_MS = 24 * 60 * 60_000;
const STRIKE_TTL_MS = 24 * 60 * 60_000;
const ADMIN_TTL_MS = 10 * 60_000;
const REPEAT = { windowMs: 120_000, count: 3, minLength: 15 }; // short chatter like "חחח" or "תודה" is never "spam"
const FLOOD = { windowMs: 10_000, count: 6 };
const OWN_GROUP = (process.env.GROUP_URL || "https://t.me/panda_deals_il").split("/").pop().toLowerCase();
const TG_LINK = /(?:t\.me|telegram\.me|telegram\.dog)\/(\+?[\w-]+)/gi;
const URL_LIKE = /(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(?:com|net|org|io|co|me|ly|link|xyz|info|biz|ru|top|site|online|shop|store|click|app)\b\S*/gi;

function isAliLink(raw) {
  try {
    return isAliExpressHost(new URL(/^https?:/i.test(raw) ? raw : `https://${raw}`).hostname);
  } catch {
    return false;
  }
}

// Returns a short Hebrew reason when the message looks like spam, otherwise null.
export function spamReason(msg, { newMember = false } = {}) {
  const hidden = (msg.entities ?? msg.caption_entities ?? []).filter((e) => e.type === "text_link").map((e) => e.url);
  const all = [msg.text ?? msg.caption ?? "", ...hidden].join(" ");
  for (const m of all.matchAll(TG_LINK)) if (m[1].toLowerCase() !== OWN_GROUP) return "קישור לקבוצה או ערוץ אחר";
  if (newMember && [...all.matchAll(URL_LIKE)].some((m) => !isAliLink(m[0]))) return "קישור ממצטרף חדש";
  return null;
}

export function createModeration({ now = Date.now } = {}) {
  // shortcut: all state is in memory and resets when the free server sleeps/restarts; move to a database for lasting strikes.
  const joins = new Map();
  const strikes = new Map();
  const recent = new Map();
  const admins = new Map();
  const reported = new Set();

  const say = (ctx, text) => ctx.reply(RLM + text, { parse_mode: "HTML" }).catch(() => {});
  const report = (ctx, method, e) => {
    const key = `${ctx.chat.id}:${method}`;
    if (reported.has(key)) return;
    reported.add(key);
    console.error(`chat ${ctx.chat.id}: moderation ${method} failed (${e.message}); make the bot an admin with delete + ban rights`);
  };

  async function isAdmin(ctx, userId) {
    const cached = admins.get(ctx.chat.id);
    if (cached && now() - cached.at < ADMIN_TTL_MS) return cached.ids.has(userId);
    try {
      const list = await ctx.getChatAdministrators();
      const ids = new Set(list.map((m) => m.user.id));
      admins.set(ctx.chat.id, { ids, at: now() });
      return ids.has(userId);
    } catch {
      return true; // can't check: never punish by mistake
    }
  }

  function burstReason(key, msg, t) {
    const text = (msg.text ?? msg.caption ?? "").trim().toLowerCase();
    const h = text ? createHash("sha1").update(text).digest("hex") : "";
    const list = (recent.get(key) ?? []).filter((x) => t - x.t < REPEAT.windowMs);
    list.push({ h, t });
    recent.set(key, list);
    if (recent.size > 5000) recent.clear();
    if (text.length >= REPEAT.minLength && list.filter((x) => x.h === h).length >= REPEAT.count) return "אותה הודעה שוב ושוב";
    if (list.filter((x) => t - x.t < FLOOD.windowMs).length >= FLOOD.count) return "הצפת הודעות";
    return null;
  }

  async function punish(ctx, key, reason, channel = null) {
    try {
      await ctx.deleteMessage();
    } catch (e) {
      return report(ctx, "deleteMessage", e); // without delete rights the bot neither warns nor removes
    }
    recent.delete(key);
    const prev = strikes.get(key);
    const count = (prev && now() - prev.at < STRIKE_TTL_MS ? prev.count : 0) + 1;
    const name = esc(channel?.title || ctx.from.first_name || "משתמש");
    console.log(`chat ${ctx.chat.id}: moderation deleted a message (strike ${count})`);
    void station("panda", "guard", "done", `הוסרה הודעת ספאם (${reason})`); // AURA HQ status, not awaited; the reason is one of our fixed texts
    if (count <= 2) {
      strikes.set(key, { count, at: now() });
      // The first warning said "next time you're out", but the next time is the 2nd warning (owner's review, 2026-11-04).
      return say(ctx, count === 1 ? `⚠️ ${name}, ההודעה נמחקה (${reason}). זו אזהרה ראשונה מתוך 2.` : `⚠️ ${name}, ההודעה נמחקה (${reason}). זו אזהרה אחרונה: בפעם הבאה תוצאו מהקבוצה.`);
    }
    strikes.delete(key);
    try {
      if (channel) {
        await ctx.banChatSenderChat(channel.id); // that channel identity can't post here anymore; the person still can
        return say(ctx, `🚫 ${name} נחסם/ה בקבוצה אחרי 2 אזהרות.`);
      }
      await ctx.banChatMember(ctx.from.id);
      await ctx.unbanChatMember(ctx.from.id, { only_if_banned: true }); // kick, not a permanent ban
    } catch (e) {
      return report(ctx, "banChatMember", e);
    }
    return say(ctx, `🚫 ${name} הוצא/ה מהקבוצה אחרי 2 אזהרות.`);
  }

  async function middleware(ctx, next) {
    const msg = ctx.message;
    const type = ctx.chat?.type;
    // A member posting as one of their channels (not the group's own anonymous admins, not the linked channel's posts).
    const channel = msg?.sender_chat?.type === "channel" && !msg.is_automatic_forward ? msg.sender_chat : null;
    if (!msg || (type !== "group" && type !== "supergroup") || msg.new_chat_members || (msg.sender_chat && !channel) || !ctx.from || (ctx.from.is_bot && !channel)) return next();
    const key = channel ? `${ctx.chat.id}:c${channel.id}` : `${ctx.chat.id}:${ctx.from.id}`;
    const t = now();
    const newMember = Boolean(channel) || (joins.has(key) && t - joins.get(key) < NEW_MEMBER_MS); // a channel identity gets the new-member link rules
    const reason = spamReason(msg, { newMember }) ?? burstReason(key, msg, t);
    if (!reason || (!channel && (await isAdmin(ctx, ctx.from.id)))) return next();
    return punish(ctx, key, reason, channel);
  }

  async function onJoin(ctx) {
    for (const member of ctx.message.new_chat_members) {
      if (member.id === ctx.me.id) continue;
      if (!member.is_bot) {
        joins.set(`${ctx.chat.id}:${member.id}`, now());
        continue;
      }
      if (await isAdmin(ctx, ctx.from.id)) continue; // admins may add helper bots
      try {
        await ctx.banChatMember(member.id);
      } catch (e) {
        report(ctx, "banChatMember", e);
        continue;
      }
      void station("panda", "guard", "done", "הוסר בוט שצורף לקבוצה");
      await say(ctx, `🤖 זוהה בוט שהצטרף (${esc(member.username ? `@${member.username}` : member.first_name)}). הוא הוסר מהקבוצה.`);
    }
    if (joins.size > 5000) joins.clear();
  }

  return { middleware, onJoin, isAdmin };
}
