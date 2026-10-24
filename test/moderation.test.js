import { test } from "node:test";
import assert from "node:assert/strict";
import { setup, textUpdate, joinUpdate } from "./helpers.js";
import { spamReason } from "../moderation.js";

const methods = (calls) => calls.map((c) => c.method).filter((m) => m !== "getChatAdministrators" && m !== "sendChatAction");

test("spamReason: links to other Telegram groups/channels, links from new members, our own group is fine", () => {
  assert.ok(spamReason({ text: "הצטרפו אלינו https://t.me/joinchat/abc" }));
  assert.ok(spamReason({ text: "ערוץ מבצעים t.me/some_channel" }));
  assert.ok(spamReason({ text: "קנו כאן", entities: [{ type: "text_link", url: "https://t.me/other" }] }));
  assert.equal(spamReason({ text: "הקבוצה שלנו https://t.me/panda_deals_il" }), null);
  assert.ok(spamReason({ text: "www.cheap-deals.xyz" }, { newMember: true }));
  assert.equal(spamReason({ text: "www.cheap-deals.xyz" }, { newMember: false }), null, "old members may share links");
  assert.equal(spamReason({ text: "https://he.aliexpress.com/item/1005001234567890.html" }, { newMember: true }), null, "AliExpress links are fine");
  assert.equal(spamReason({ text: "שלום לכולם" }, { newMember: true }), null);
});

test("a bot added by a regular member is removed immediately with a notice", async () => {
  const ctx = setup({ admins: [1] });
  await ctx.bot.handleUpdate(joinUpdate([{ id: 555, is_bot: true, first_name: "SpamBot", username: "spam_bot" }], { byUserId: 7 }));
  const ban = ctx.calls.find((c) => c.method === "banChatMember");
  assert.equal(ban.payload.user_id, 555);
  assert.match(ctx.sent()[0].body, /בוט/);
});

test("a bot added by an admin is allowed; our own bot joining is ignored", async () => {
  const ctx = setup({ admins: [1] });
  await ctx.bot.handleUpdate(joinUpdate([{ id: 555, is_bot: true, first_name: "Helper" }], { byUserId: 1 }));
  await ctx.bot.handleUpdate(joinUpdate([{ id: 42, is_bot: true, first_name: "Panda" }], { byUserId: 7 }));
  assert.equal(ctx.calls.filter((c) => c.method === "banChatMember").length, 0);
});

test("spam: delete + warning 1/2, delete + warning 2/2, then removal", async () => {
  const ctx = setup({ admins: [1] });
  const spam = () => ctx.bot.handleUpdate(textUpdate("ערוץ מבצעים t.me/some_channel", { userId: 9 }));
  await spam();
  assert.deepEqual(methods(ctx.calls), ["deleteMessage", "sendMessage"]);
  assert.match(ctx.sent()[0].body, /אזהרה 1 מתוך 2/);
  await spam();
  assert.match(ctx.sent()[1].body, /אזהרה 2 מתוך 2/);
  await spam();
  const ban = ctx.calls.find((c) => c.method === "banChatMember");
  assert.equal(ban.payload.user_id, 9);
  assert.ok(ctx.calls.some((c) => c.method === "unbanChatMember"), "kicked (can rejoin), not banned forever");
  assert.match(ctx.sent()[2].body, /הוצא/);
});

test("admins are never moderated", async () => {
  const ctx = setup({ admins: [9] });
  await ctx.bot.handleUpdate(textUpdate("ערוץ שלי t.me/some_channel", { userId: 9 }));
  assert.equal(ctx.calls.filter((c) => c.method === "deleteMessage").length, 0);
});

test("a member who joined recently and posts an outside link is moderated; AliExpress links are not", async () => {
  const ctx = setup({ admins: [1] });
  await ctx.bot.handleUpdate(joinUpdate([{ id: 9, is_bot: false, first_name: "New" }], { byUserId: 9 }));
  await ctx.bot.handleUpdate(textUpdate("https://he.aliexpress.com/item/1005001234567890.html", { userId: 9 }));
  assert.equal(ctx.calls.filter((c) => c.method === "deleteMessage").length, 0);
  await ctx.bot.handleUpdate(textUpdate("מבצע www.cheap-deals.xyz", { userId: 9 }));
  assert.equal(ctx.calls.filter((c) => c.method === "deleteMessage").length, 1);
});

test("the same message 3 times in 2 minutes is spam; flooding 6 messages in 10 s is spam", async () => {
  let t = 0;
  const ctx = setup({ admins: [1], now: () => t });
  for (let i = 0; i < 3; i++) { t += 1000; await ctx.bot.handleUpdate(textUpdate("מכירה! הכי זול!!!", { userId: 9 })); }
  assert.equal(ctx.calls.filter((c) => c.method === "deleteMessage").length, 1);
  const flood = setup({ admins: [1], now: () => t });
  for (let i = 0; i < 6; i++) { t += 500; await flood.bot.handleUpdate(textUpdate(`הודעה ${i}`, { userId: 8 })); }
  assert.equal(flood.calls.filter((c) => c.method === "deleteMessage").length, 1);
});

test("private chats are not moderated", async () => {
  const ctx = setup({ admins: [] });
  const update = textUpdate("t.me/some_channel", { chat: "private", userId: 9 });
  await ctx.bot.handleUpdate(update);
  assert.equal(ctx.calls.filter((c) => c.method === "deleteMessage" && c.payload.message_id === update.message.message_id).length, 0);
});

test("missing admin rights are logged once, without message text, and the bot keeps working", async (t) => {
  const logged = [];
  t.mock.method(console, "error", (...a) => logged.push(a.join(" ")));
  const ctx = setup({ admins: [1], failMethods: ["deleteMessage"] });
  await ctx.bot.handleUpdate(textUpdate("סוד_123 t.me/some_channel", { userId: 9 }));
  assert.ok(logged.length >= 1);
  for (const line of logged) assert.doesNotMatch(line, /סוד_123/);
});

test("short repeated chatter (חחח, תודה, 👍) is never treated as spam", async () => {
  let t = 0;
  const ctx = setup({ admins: [1], now: () => t });
  for (const text of ["חחח", "חחח", "חחח", "תודה", "תודה", "תודה"]) { t += 3000; await ctx.bot.handleUpdate(textUpdate(text, { userId: 9 })); }
  assert.equal(ctx.calls.filter((c) => c.method === "deleteMessage").length, 0);
});

const asChannel = (text, channelId = -1009) => {
  const u = textUpdate(text);
  Object.assign(u.message, { sender_chat: { id: channelId, type: "channel", title: "Deals Spam" }, from: { id: 136817688, is_bot: true, first_name: "Channel" } });
  return u;
};

test("posting as a channel doesn't bypass spam rules: delete + warnings, then that channel identity is blocked", async () => {
  const ctx = setup({ admins: [] });
  for (let i = 0; i < 3; i++) await ctx.bot.handleUpdate(asChannel(`מבצע ${i} www.cheap-deals.xyz`));
  assert.equal(ctx.calls.filter((c) => c.method === "deleteMessage").length, 3);
  assert.equal(ctx.calls.find((c) => c.method === "banChatSenderChat").payload.sender_chat_id, -1009);
  assert.ok(!ctx.calls.some((c) => c.method === "banChatMember"), "the person behind it isn't kicked");
  assert.match(ctx.sent()[0].body, /Deals Spam/);
});

test("the group's anonymous admins and the linked channel's posts are not moderated", async () => {
  const ctx = setup({ admins: [] });
  const anon = textUpdate("t.me/some_channel");
  Object.assign(anon.message, { sender_chat: { id: -100123, type: "supergroup", title: "G" }, from: { id: 1087968824, is_bot: true, first_name: "Group" } });
  await ctx.bot.handleUpdate(anon);
  const linked = asChannel("t.me/some_channel");
  linked.message.is_automatic_forward = true;
  await ctx.bot.handleUpdate(linked);
  assert.equal(ctx.calls.filter((c) => c.method === "deleteMessage").length, 0);
});
