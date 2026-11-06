# Panda bot roadmap

Updated 2026-11-05. ✅ done · ⬜ next.

## What "perfect" means (checked in the final step)
- In 66 searches across the 33 AliExpress categories, at least 90% of cards show 4 right products that sell well.
- No fake (impossible capacity) on a card, and no empty card for something AliExpress ships to Israel.
- 🐼 "לא זה" on fewer than 10% of real searches.
- An answer in under 15 seconds on average.

## Done
- ✅ Families 1, 3, 4, 5, 6: gadgets and fakes, fits a device or car (now BYD too), per-kind searches, gift questions, big items.
- ✅ 200 slang words, each checked for free against the judges' 72 products. Israeli words, Judaica, hard compounds, tool "guns".
- ✅ Self-check: when the Hebrew titles share nothing with the request, a second reading is tried.
- ✅ A reply to your own search refines it.
- ✅ Look-alikes for 16 brands AliExpress doesn't sell as originals (AirPods, Apple Watch, Lululemon, Crocs, Rolex, LEGO...).
- ✅ Group: one pinned welcome, fixed spam warning. Deals channel: a deal every hour, plus a nightly summary.
- ✅ AirPods/Apple Watch look and wordings; the 11 untested categories (20 of 22 fine, 2 fixed).
- ✅ Fashion (family 2), 2026-11-05, design in `docs/superpowers/specs/2026-11-05-fashion-design.md`:
  - 12 fashion wordings (jeans, shorts, dress, tie, galabiya...)
  - the style judge's taste: clean, classic, elegant
  - a sales floor relative to the search (not for color searches)
  - colors: the item is also searched without the color; best sellers shown only in a photo of the asked color
  - Israeli colors (ניוד, חאקי, נייבי...); the photo trigger no longer fires on bluetooth/wired/credit

## Next, in order (all free: AliExpress checks and unit tests; the owner checks in Telegram)
1. ⬜ **Upload the AirPods/Apple Watch look change.** The owner checks:
   - targets: "איירפודס פרו", "אפל ווטש"
   - control: "כיסוי לאיירפודס"
2. ⬜ **AirPods wordings.** A free check of more sellers' names for AirPods-style earbuds ("Pro 2", "Air 31", "Pro 5", "Air Pro 6", "i12", "TWS Pro"). The 3-4 that bring the best-selling white-stem earbuds into the 72 go into the slang file.
3. ⬜ **Weekly learning loop.**
   - Once a week the owner forwards the digest, the 🐼 reports and the no-result searches.
   - Each failed search is checked for free: the sellers' wording vs the reading's, in the judges' 72.
   - Only clear wins are added to the slang file: a word, or a brand someone actually asked for.
   - The 130 fixed searches are re-checked, then uploaded.
4. ⬜ **The 11 untested categories.** 2-3 searches each, free pool check, fix only real failures:
   - tools, security, motorcycle, sports, bags, hair
   - baby, school, electronic parts, kitchen, books
5. ✅ **Fashion closed 2026-11-06** (127 items checked for free, `docs/fashion-check-2026-11-06.txt`: 102 fine, 3 wording fixes, the rest weak by nature: flannel/chinos/men's dress shoes/blazers/suits/leather jackets/modest dresses/abaya/kaftan/plus size/evening dresses). Earlier leftovers (from the owner's Telegram checks, 2026-11-05):
   - (kept by the owner's choice: 4 products with one weak beats 3 good ones, 2026-11-05)
   - some photos aren't in the asked color (a beige stack for burgundy, an orange dress for nude)
   - in color cards the 🥇 isn't always the best seller (photo-confirmed ones go first)
   - ✅ girls' dresses: baby-only titles move down for a child's request; the hint stays "girls casual dress"
   - evening dresses: few long ones sell well on AliExpress (1 over 1,000 recent sales); short party dresses only if the owner wants them
   - the API's sales count is recent (likely 30 days), not the site's lifetime "1K+ sold"
   - a collage of colors as a coat's main photo
   - ✅ SKU API approved 2026-11-06: color searches use the variants (live; /trace shows the owner how a card was made)
   - ✅ the link opens the asked variant (s.click link keeps skuId and the affiliate parameters; live 2026-11-06)
6. ✅ **Judaica checked 2026-11-06** (102 items, `docs/judaica-check-2026-11-06.txt`: 25 fine, 8 wording fixes, most real Judaica barely sold on AliExpress).
7. ⬜ **Small leftovers:**
   - ✅ the Shabbat lamp: motion/touch/app/screen lights move down for a Shabbat light request (2026-11-06)
   - "כלים למנגל" (a 3-sold set first): kept by design - a real match leads close ones even with few sales (two tests pin it; changing it would put generic earbuds before "noise cancelling" ones)
   - ✅ the heading "משי ק": a cut AI correction falls back to what was typed (2026-11-06)
8. ✅ **Final check of all 33 categories, 2026-11-06** (`docs/final-check-2026-11-06.txt`: 165 searches, basic check 94%; the 66 hardest read by hand 79% right and selling, the rest mostly market limits; 5 fixes). Next: the owner's Telegram check of 15, then the weekly learning loop.
9. ⬜ **Final check of all 33 categories** against the bar above.

## Rules for every change
- One change at a time. Free checks before every upload:
  - unit tests
  - the judges' 72 before vs after
  - the 130 fixed searches untouched
- Broad rules in the AI's fixed instructions are avoided: they are read on every search and can only be checked in Telegram. Words go to the slang file, which acts only when its word appears.
- Look-alikes stay look-alikes: the same style, never a fake logo or a disguised brand name. No brand-by-brand sweep of the whole market; a brand is added only when a real user asked for it.

## Owner actions
- ⬜ Check each upload in Telegram (the list comes with each upload).
- ⬜ Forward the weekly digest and 🐼 reports (step 3).
- ⬜ Follow the AliExpress ticket; say when SKU shows "Active".
- ⬜ Each autumn: update the Black Friday and Cyber Monday dates in deals.js.
