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

export function setup(opts = {}) {
  const calls = [];
  const bot = createBot({ token: "123:TEST", botInfo: BOT_INFO, ...opts });
  bot.api.config.use(async (_prev, method, payload) => {
    calls.push({ method, payload });
    const result = method === "sendMessage" ? { message_id: 999, date: 0, chat: { id: payload.chat_id, type: "supergroup" }, text: payload.text } : true;
    return { ok: true, result };
  });
  const sent = () => calls.filter((c) => c.method === "sendMessage").map((c) => c.payload);
  return { bot, calls, sent };
}

let nextId = 1;
export function textUpdate(text, { chat = "group", userId = 7 } = {}) {
  const id = nextId++;
  const chatObj = chat === "private" ? { id: userId, type: "private", first_name: "U" } : { id: -100123, type: "supergroup", title: "G" };
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
