// Test helpers: a bot with a preset botInfo and all outgoing Telegram API calls intercepted (no token, no network).
import { createBot } from "../bot.js";

export const BOT_INFO = {
  id: 42,
  is_bot: true,
  first_name: "Panda Deals",
  username: "panda_test_bot",
  can_join_groups: true,
  can_read_all_group_messages: true,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
};

// failMethods: Telegram methods that should answer with a 400 error (e.g. ["sendPhoto"]).
// understand defaults to "AI unavailable" (null), i.e. the raw query is searched.
// Network-free defaults: no collage (single photo URL) and no relevance filtering.
// admins: user ids returned by getChatAdministrators.
export function setup({ failMethods = [], admins = [], understand = async () => null, collage = async () => null, relevant = async (_r, p) => ({ exact: p, partial: [] }), advise = async () => null, explain = async () => null, ...opts } = {}) {
  const calls = [];
  const bot = createBot({ token: "123:TEST", botInfo: BOT_INFO, understand, collage, relevant, advise, explain, ...opts });
  bot.api.config.use(async (_prev, method, payload) => {
    calls.push({ method, payload });
    if (failMethods.includes(method)) return { ok: false, error_code: 400, description: "Bad Request: wrong file identifier/HTTP URL specified" };
    const isSend = method === "sendMessage" || method === "sendPhoto";
    const result = isSend
      ? { message_id: 999, date: 0, chat: { id: payload.chat_id, type: "supergroup" } }
      : method === "getChatAdministrators"
        ? admins.map((id) => ({ status: "administrator", user: { id, is_bot: false, first_name: "A" } }))
        : true;
    return { ok: true, result };
  });
  const sends = () => calls.filter((c) => c.method === "sendMessage" || c.method === "sendPhoto");
  const sent = () => sends().map((c) => ({ ...c.payload, method: c.method, body: c.payload.text ?? c.payload.caption }));
  return { bot, calls, sent };
}

let nextId = 1;

export function joinUpdate(members, { byUserId = 7, chatId = -100123 } = {}) {
  const id = nextId++;
  return {
    update_id: id,
    message: {
      message_id: id,
      date: 0,
      chat: { id: chatId, type: "supergroup", title: "G" },
      from: { id: byUserId, is_bot: false, first_name: "U" },
      new_chat_members: members,
    },
  };
}

export function callbackUpdate(data, { userId = 7, chatId = -100123, messageId = 500, chat = "group" } = {}) {
  const id = nextId++;
  return {
    update_id: id,
    callback_query: {
      id: `cb${id}`,
      from: { id: userId, is_bot: false, first_name: "U" },
      chat_instance: "ci",
      data,
      message: { message_id: messageId, date: 0, chat: chat === "private" ? { id: userId, type: "private", first_name: "U" } : { id: chatId, type: "supergroup", title: "G" }, text: "question" },
    },
  };
}

export function textUpdate(text, { chat = "group", userId = 7, chatId = -100123 } = {}) {
  const id = nextId++;
  const chatObj = chat === "private" ? { id: userId, type: "private", first_name: "U" } : { id: chatId, type: "supergroup", title: "G" };
  const command = text.match(/^\/\S+/);
  return {
    update_id: id,
    message: {
      message_id: id,
      date: 0,
      chat: chatObj,
      from: { id: userId, is_bot: false, first_name: "U" },
      text,
      ...(command ? { entities: [{ type: "bot_command", offset: 0, length: command[0].length }] } : {}),
    },
  };
}
