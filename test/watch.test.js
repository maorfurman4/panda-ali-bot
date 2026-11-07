import { test } from "node:test";
import assert from "node:assert/strict";
import { decideWatch } from "../scripts/watch-bot.js";

test("watch: one alert when the bot goes down, a reminder every 3 hours, one message when it is back", () => {
  const h = 60 * 60_000;
  const up = decideWatch({}, null, 0);
  assert.equal(up.message, null, "up and was up: quiet");
  const down = decideWatch(up.state, "השרת לא ענה תוך דקה", 1 * h);
  assert.match(down.message, /^🚨 בוט החיפוש לא עונה: השרת לא ענה/);
  assert.equal(decideWatch(down.state, "x", 2 * h).message, null, "an hour later: no repeat");
  assert.match(decideWatch(down.state, "x", 4 * h).message, /\(עדיין\)/, "3 hours later: a reminder");
  assert.equal(decideWatch(down.state, null, 5 * h).message, "✅ בוט החיפוש חזר לענות");
});
