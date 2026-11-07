# Site-category check: the plan (2026-11-07)

Goal: before launch, every AliExpress category and sub-category the owner sent (from the site's own menu) is checked,
fixed where the bot is weak, and measured before and after.

## Scope
- 26 categories, ~870 sub-categories, 2 searches each (owner, 2026-11-07: 8 each was too many): the item bought most
  there, and one edge case (color, budget, size, brand, fits a car/phone/device, Israeli slang or a typo, gift, kids, or
  an accessory FOR the item; the kind varies across sub-categories). About 1,740 searches. Lists of 8 per sub-category
  were written; the first plain one and the first edge case are run.
- Left out on purpose: weapons, vapes and medicines (blocked by the owner's rules).

## Method (free: AliExpress's partner search, no paid AI)
- The real search pipeline runs on each request (all wordings, the 72 for the judges, item-first, brand step). The paid
  steps are stood in for: the reading = the English given; the judges keep everything.
- A strict automatic judge reads the sellers' English titles: the item named (not "for" it), every number the request
  names, the asked color (in the title or a variant photo), the price under the budget.
- Per search: OK (4 right items, 3+ with 100+ recent sales), weak (4 right, fewer strong), miss (under 4 right);
  "pool right" = the share of the 72 that is the right item; the best 4 sellers among the right items.
- Before = the bot as live now. Each fix is measured on the searches it touches, before and after. At the end the whole
  set runs again (after).
- 2 runs at a time: 3 hit AliExpress's call limit (AppCallLimit). Rows that still hit it are rerun one by one.

## Each fix
- Problem, cause, fix, measured gain (on the searches it touches, free); unit tests; one change at a time.
- Wording fixes go to slang.json (acts only when its word appears). Rules in the AI's fixed instructions only when no
  word-level fix works: they are read on every search and can only be checked in Telegram.
- Upload only after the owner says "תעלה".

## Report (docs/site-check-2026-11-07.md)
1. Accuracy before and after: all, per category, per sub-category, per edge-case kind.
2. Top sellers: did the strongest right items reach the 72 and the card, any lost.
3. Every fix: problem, cause, fix, gain.
4. How AliExpress sellers name things: from the plainest item to the oddest (the search vocabulary learned).
5. Conclusions.
6. What changed, how much the bot improved, what mattered most, what didn't, what could have been done otherwise.
7. Tips and the remaining steps to finish the bot.

## Limits to know
- The paid judges, the photo look and the reading aren't run: the final card is checked by the owner in Telegram.
- The automatic judge is strict on wording; misses are read by hand before any conclusion.
- Work state is saved in the scratchpad (site/STATUS.md) so a stopped session continues where it left off.
