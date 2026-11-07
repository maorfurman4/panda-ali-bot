# Site-category check, 2026-11-07 (free; plan: docs/site-check-plan-2026-11-07.md; list: docs/site-check-list-2026-11-07.md)

## Family 1: Automotive (65 sub-categories) and Women's Clothing (44), 218 searches
Check fixes before measuring (the check, not the bot): the stub reading now gives fallback_en (the item without brand,
size or color, as the live reading does); the biggest pool the judges saw is kept (color searches ask twice); a car or
phone a part is FOR is not passed as the shopper's brand.

Bot fixes (bot.js):
1. Item first for style searches too. Problem: junk in fashion pools (an electric shaver, 8,852 sold, in the 48 for
   "black women bikini"; tops in a cardigan pool). Cause: item-first was off for style searches. Fix: on.
   Women's Clothing: 72 right 63% -> 72%, OK 69% -> 73%, miss 5% -> 3%.
2. The item noun skips "assembly" and a general request ("accessories", "parts", "gadget") gets no reordering.
   Problem: "car headlight assembly" put headlights last (titles say "LED Headlight"). Fix: noun "headlight".
   That search: weak -> OK, best seller 622 -> 4,198, 72 right 4 -> 71.
    ALL (218): OK 75% · weak 22% · miss 3% · 72 right 71% · top4 sales 3678059
         → OK 76% · weak 21% · miss 2% · 72 right 75% · top4 sales 3742145
    == Automotive (130): OK 78% · weak 20% · miss 2% · 72 right 75% · top4 sales 3111141
                   → OK 79% · weak 20% · miss 2% · 72 right 76% · top4 sales 3183333
    == Women's Clothing (88): OK 69% · weak 26% · miss 5% · 72 right 63% · top4 sales 566918
                         → OK 73% · weak 24% · miss 3% · 72 right 72% · top4 sales 558812
    
    by kind:
      plain (109): OK 93% · weak 6% · miss 1% · 72 right 86% · top4 sales 2698388
             → OK 94% · weak 5% · miss 1% · 72 right 90% · top4 sales 2753252
      color (57): OK 56% · weak 37% · miss 7% · 72 right 37% · top4 sales 229709
             → OK 60% · weak 35% · miss 5% · 72 right 42% · top4 sales 238904
      size (26): OK 69% · weak 27% · miss 4% · 72 right 65% · top4 sales 198968
            → OK 68% · weak 28% · miss 4% · 72 right 66% · top4 sales 195015
      brand (9): OK 100% · weak 0% · miss 0% · 72 right 76% · top4 sales 524555
             → OK 100% · weak 0% · miss 0% · 72 right 76% · top4 sales 528506
      slang (1): OK 100% · weak 0% · miss 0% · 72 right 100% · top4 sales 13569
             → OK 100% · weak 0% · miss 0% · 72 right 100% · top4 sales 13569
      gift (1): OK 0% · weak 100% · miss 0% · 72 right 94% · top4 sales 402
            → OK 0% · weak 100% · miss 0% · 72 right 99% · top4 sales 431
      fits (15): OK 13% · weak 87% · miss 0% · 72 right 78% · top4 sales 12468
            → OK 13% · weak 87% · miss 0% · 72 right 78% · top4 sales 12468
Back-to-back reruns of the 3 searches that looked worse (car battery, Lululemon leggings, black kimono): no loss; the
before runs themselves differ that much (AliExpress lists change between calls).

What is left, and why (by hand):
- Fits a car model (timing belt for Octavia, shocks for Kia Rio, pads for Corolla): 78% of the 72 is right, but these
  parts sell tens, not hundreds, on AliExpress -> weak. Market.
- Colors: the check credits a color only by title or a variant on the card; the live bot also checks variants and photos
  for the candidates. Measured conservatively.
- Modest/traditional wear (abaya, modest sets, prayer dress, burkini): right items, low sales. Market.
- GPS navigators: phones replaced them; the best sells 480. Market.
- Brands absent from AliExpress (Shein, Zara, Meguiar's, Motul, Sparco, North Face): the fallback brings the plain item.

Colors measured with the SKU API (the check now reads every pool candidate's variants, as the live bot does), the 56
color searches of family 1:
- title only (as first measured): OK 55%, weak 38%, miss 7%, 72 right 35%
- with variants, before the fixes:  OK 82%, weak 16%, miss 2%, 72 right 51%
- with variants, after the fixes:   OK 84%, weak 14%, miss 2%, 72 right 57%
Still weak: burgundy pajamas/swimsuit, khaki poncho, mint bridesmaid dress, beige abaya, black burkini, white prayer
garment, olive modest set, black Tesla Model 3 mats: few sellers or low sales in that color.
