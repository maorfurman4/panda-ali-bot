// The group serves only people who joined the deals channel (owner, 2026-11-13): nothing is deleted, a non-member gets
// the join notice instead of an answer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { setup, textUpdate, joinUpdate } from "./helpers.js";
import { JOIN_CHANNEL } from "../format.js";

const SEARCH = "חפש לי אוזניות";
const STRANGER = 50;

function gated(opts = {}) {
  const queries = [];
  const ctx = setup({ channel: "@panda_dilim", search: async (q) => (queries.push(q), []), ...opts });
  const say = (text, updateOpts = {}) => ctx.bot.handleUpdate(textUpdate(text, { userId: STRANGER, ...updateOpts }));
  const notices = () => ctx.sent().filter((m) => m.body === JOIN_CHANNEL).length;
  return { ...ctx, queries, say, notices };
}

test("channel rule: a non-member gets the join notice instead of a search, and the message stays", async () => {
  const { say, sent, queries, calls } = gated();
  await say(SEARCH);
  assert.deepEqual(sent().map((m) => m.body), [JOIN_CHANNEL]);
  assert.match(JOIN_CHANNEL, /https:\/\/t\.me\/panda_dilim/);
  assert.equal(queries.length, 0);
  assert.equal(calls.some((c) => c.method === "deleteMessage"), false);
});

test("channel rule: a channel member is served as usual", async () => {
  const { say, notices, queries } = gated({ members: [STRANGER] });
  await say(SEARCH);
  assert.equal(notices(), 0);
  assert.equal(queries.length > 0, true);
});

test("channel rule: any text gets the notice, at most once per 10 minutes per person", async () => {
  let t = 0;
  const { say, notices } = gated({ now: () => t });
  await say("תודה רבה");
  await say(SEARCH);
  assert.equal(notices(), 1);
  await say(SEARCH, { userId: 51 });
  assert.equal(notices(), 2, "another person gets their own notice");
  t = 10 * 60_000 + 1;
  await say(SEARCH);
  assert.equal(notices(), 3);
});

test("channel rule: joining the channel works at once, also within the 10 minutes", async () => {
  const members = [];
  const { say, notices, queries } = gated({ members });
  await say(SEARCH);
  members.push(STRANGER);
  await say(SEARCH);
  assert.equal(notices(), 1);
  assert.equal(queries.length > 0, true);
});

test("channel rule: seen in the channel once is enough, also after leaving it", async () => {
  const members = [STRANGER];
  let t = 0;
  const { say, notices } = gated({ members, now: () => t });
  await say(SEARCH);
  members.length = 0;
  t = 60_000; // past the search cooldown, when a notice could be sent
  await say("חפש לי מטען");
  assert.equal(notices(), 0);
});

test("channel rule: the owner, group admins and anonymous admins are exempt", async () => {
  const { bot, notices, calls } = gated({ admins: [8] });
  await bot.handleUpdate(textUpdate(SEARCH, { userId: 7 })); // the owner (adminId in the helpers)
  await bot.handleUpdate(textUpdate(SEARCH, { userId: 8 }));
  const anonymous = textUpdate(SEARCH, { userId: 1087968824 });
  anonymous.message.sender_chat = anonymous.message.chat;
  await bot.handleUpdate(anonymous);
  const channelPost = textUpdate(SEARCH, { userId: 777000 }); // a linked channel's post, forwarded into the group by Telegram
  Object.assign(channelPost.message, { sender_chat: { id: -100999, type: "channel", title: "C" }, is_automatic_forward: true });
  await bot.handleUpdate(channelPost);
  assert.equal(notices(), 0);
  assert.equal(calls.some((c) => c.method === "getChatMember"), false);
});

test("channel rule: when Telegram can't answer the check the message goes through, and the person is checked again later", async () => {
  const failMethods = ["getChatMember"];
  let t = 0;
  const { say, notices, queries } = gated({ failMethods, now: () => t });
  await say(SEARCH);
  assert.equal(notices(), 0);
  assert.equal(queries.length > 0, true);
  failMethods.length = 0;
  t = 60_000; // past the search cooldown of the message that went through
  await say("חפש לי מטען");
  assert.equal(notices(), 1);
});

test("channel rule: joining the group or pressing nothing is not a message, no notice", async () => {
  const { bot, notices } = gated();
  await bot.handleUpdate(joinUpdate([{ id: STRANGER, is_bot: false, first_name: "U" }], { byUserId: STRANGER }));
  assert.equal(notices(), 0);
});

test("channel rule: /join in private shows the owner the notice and whether the bot can read the channel", async () => {
  const ok = gated({ members: [7] });
  await ok.bot.handleUpdate(textUpdate("/join", { chat: "private", userId: 7 }));
  assert.equal(ok.sent()[0].body, JOIN_CHANNEL);
  assert.match(ok.sent()[1].body, /✅/);
  const broken = gated({ failMethods: ["getChatMember"] });
  await broken.bot.handleUpdate(textUpdate("/join", { chat: "private", userId: 7 }));
  assert.match(broken.sent()[1].body, /❌/);
});
