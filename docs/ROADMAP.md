# Panda bot roadmap

Status as of 2026-11-04. Each item starts as ⬜ and becomes ✅ when done.

## What "perfect" means (measured in the final check, step 9)
- In 66 searches across all 33 AliExpress categories, at least 90% of cards show 4 right products that sell well.
- No card shows a fake (impossible capacity) or an empty result for something AliExpress ships to Israel.
- 🐼 "לא זה" on fewer than 10% of real searches (from the nightly digest).
- An answer in under 15 seconds on average.

## Done (so far)
- ✅ Families 1, 3, 4, 5, 6: gadgets and fakes, fits a device, per-kind searches, gifts, big items.
- ✅ Fixes from the owner's Telegram tests: brand slot, long cards, sizes note, cables, mouse, LED, towel rack, power bank.
- ✅ Group: new texts, fixed spam warning, a single pinned welcome via /pin_welcome.
- ✅ Deals channel: a deal every hour, plus a nightly summary to the owner.

## Next, in order
1. ⬜ **Real user reports.** The owner forwards a week of 🐼, no-results and digest messages; fix by frequency. Then repeat weekly.
2. ⬜ **Measure the 11 untested categories.** 22 searches, about 85¢; fix only real failures. The categories:
   - tools, security, motorcycle, sports, bags, hair
   - mother and kids, school, electronic parts, kitchen, books
3. ⬜ **Fashion (family 2).** Women, men, shoes, sportswear, underwear, accessories: close colors, sizes, stable results.
4. ⬜ **Apple look-alikes.** Search AirPods and Apple Watch by sellers' names ("Air Pro", "Pro 6 TWS"); look-alikes count as matches.
5. ⬜ **Exact price and shipping per variant (SKU API).** Waiting on AliExpress: ticket opened and Apply Online sent, 2026-11-04.
6. ⬜ **Speed.** Measure the time per search, then cut it without losing accuracy.
7. ⬜ **Small leftovers.**
   - The Shabbat night lamp still admits a monitor light bar.
   - "רעיון למתנה ליום הולדת" asks 3 questions.
8. ⬜ **Deals channel growth.** A separate tracking ID for the channel (owner creates it in the AliExpress portal) shows its orders and commission in the nightly summary.
9. ⬜ **Final check of all 33 categories.** 66 searches, about $2.3, against the "perfect" bar above. Then one check a month.

## Owner actions
- ⬜ Forward a week of 🐼 / no-results / digest messages (item 1).
- ⬜ Follow the AliExpress ticket; say when SKU shows "Active" (item 5).
- ⬜ Press Start in the deals bot so the nightly summary can reach you.
- ⬜ Optional: create a channel tracking ID in the AliExpress portal (item 8).
- ⬜ Each autumn: update the Black Friday and Cyber Monday dates in deals.js (PEAK_DAYS).
