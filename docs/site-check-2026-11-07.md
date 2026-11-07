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

## Family 2: Jewelry & Accessories (31 sub-categories) and Tools & Home Improvement (65), 192 searches
Before (live bot; colors and sizes credited by SKU variants): OK 93%, weak 6%, miss 1%, 72 right 75%.
After (family 1 fixes + size variants): OK 93%, weak 6%, miss 1%, 72 right 75%. No change: this family was already
strong (plain 99% OK, colors 94%). Jewelry 97% OK, Tools 92%.
Three rows that moved (silver bracelet, LED bulb E27, pink jewelry box) were rerun back to back twice: the differences
are AliExpress's lists changing between calls (a direct pool comparison of the E27 bulb: 20 products without "27" in
the live bot's 72, 8 in the new one).

Bot fix (format.js specOf/hasSpec/sizeVariant, bot.js): a size or spec the request names is checked in the variants.
Problem: "שרשרת עם שם 45 ס\"מ", "חגורה 120 ס\"מ": listings sold in several lengths name none in the title, so the judges
call them close. Cause: the bot read variants only for colors. Fix: for a request with a size or spec (45cm, 300W,
size 43), up to 30 judged candidates without it in the title have their variants read (SKU API, free); one with the
asked size counts as exact and its link opens that size. Measured on the 53 size searches of families 1-2 (variants
counted): OK 70% -> 74%; 120cm belt 16 -> 48 of the 72 right, 45cm necklace 7 -> 32, microfiber 40x40 14 -> 31.
The card order itself is checked by a unit test and in Telegram (the free check doesn't run the judges).

Left weak, by hand: building-automation controllers, Casio engraving, pocket camera detectors, Aqara curtain motors
(few sellers or low sales), a 300W power station (top 68 sold), a green USB water pump (the color rarely sold).

## Family 3: Office & School Supplies (66 sub-categories) and Electronics (37), 204 searches
Check fix: the stub's fallback now drops numbers and, for a brand the check doesn't know (Copic, Jabra, Beelink), the
brand word, as the live reading's fallback_en does.
Before (live bot): OK 95%, weak 2%, miss 3%, 72 right 75%. After (fixes so far): OK 94%, weak 2%, miss 3%, 72 right 75%.
Office 92% -> 92%; Electronics 100% -> 99% (one row: "24 inch monitor", 4 vs 3 right of the 72, AliExpress lists).
No new fix: plain searches 98-99%, colors 100%, brands 95%.
Left weak, by hand: big desktop monitors (shipping: the search brings arms and accessories; a 24" monitor sells little),
Jabra speakerphones and Kensington locks (only "for" accessories), exact sizes sellers rarely title (easel 170cm,
business cards 90x50, cork board 60x40, 850W power supply), a presentation clicker "for MacBook" (no such listing).

## Family 4: Sports & Outdoors (41 sub-categories) and Home & Living (60), 202 searches
Before: OK 89%, weak 10%, miss 1%, 72 right 76%, best-4 sales 3.86M. After: OK 89%, weak 10%, miss 1%, 72 right 77%,
best-4 sales 4.20M (+9%). Sports 85% -> 85% (sales +10%); Home 92% -> 92%.
Four searches looked worse in the first after run (orange cones, olive cushions, black frame 30x40, round tablecloth
150); rerun back to back twice they are identical both ways: the SKU checks time out when several runs share
AliExpress's call limit. Results from parallel runs are rechecked this way before any conclusion.

Bot fixes:
1. The item noun drops a size ("knee brace size L" named "size"). bot.js itemNoun. Knee brace: 58 -> 65 of the 72 right.
2. "מדחום" (thermometer) named no brown: format.js askedColor could add "comes in brown too". The check had the same
   slip (two thermometer searches looked like misses); both fixed.

Left weak, by hand: exact sizes sellers don't title (snowboard 150cm, girls' sportswear 128, furniture cover 200x150,
fire pit 60cm, 30L aquarium), rare colors (orange camping lantern, beige bedding set, blue horse rug), small markets
(bowling shoes, horse helmets, judo gi, beekeeping suits, a sauna suit XL, a kids' Hanukkah menorah).

## Family 5: Beauty & Health (45 sub-categories) and Appliances (40), 170 searches
Before: OK 85%, weak 12%, miss 4%, 72 right 74%, best-4 sales 4.17M. After: OK 86%, weak 11%, miss 4%, 72 right 75%,
best-4 sales 4.29M (+3%). Beauty 83% -> 86%, Appliances 86% -> 86%.
(A first comparison showed brands 39% -> 89%: the before rows had been measured without the brand-free fallback. Rerun
with the same check both ways: 89% -> 89%. The family runner now reruns brand and size rows too.)
No new fix. Left weak, by hand: sex toys and condoms (absent from AliExpress's partner search; the bot already says so
for toys), big appliances (a 12,000 BTU air conditioner, a 55" TV, an 80L boiler, dishwashers, ovens: shipping; the
search brings their accessories), exact sizes rarely titled (back belt L, 560W disposer), rare colors (pink handcuffs,
white foot spa, black range hood), kids' hair straightening cream, an iPhone scalp camera.

## Family 6: Men's Clothing (25 sub-categories) and Toys & Games (45), 137 searches
Before: OK 85%, weak 12%, miss 3%, 72 right 74%. After: OK 89%, weak 9%, miss 2%, 72 right 79%, best-4 sales +4%.
Men's Clothing: 72 right 70% -> 82% (item first for style searches), OK 84% -> 86%. Toys: OK 86% -> 90%.
Gains: men's pajama set weak -> OK (best seller 91 -> 2,142, 72 right 27 -> 47 of 48), magnetic tiles weak -> OK
(94 -> 1,286), red wooden blocks (120 -> 1,686). Two rows that looked worse (DJI Mini, gray tracksuit) are identical
rerun back to back (an English-title list failed under the call limit in the parallel run).
No new fix. Left weak, by hand: Under Armour, Nerf Elite 2.0, Magna-Tiles (absent or accessories only; the fallback
brings the plain item), jalabiya (small market), inflatable bouncers and a 3m bounce house, an 80cm teddy, a 50cm RC
boat, a men's 3XL shapewear shirt, a toddler balance bike (low sales).

## Families 7-9 (fresh runs, both ways with the same check)
- 7, Cell Phones & Accessories (38) and Shoes (21), 118 searches: OK 89% -> 88% (burgundy heels: rerun, identical both
  ways). Phones 84% -> 84%, Shoes 98% -> 95% -> same on rerun.
- 8, Furniture (28) and Pet Supplies (14), 84 searches: OK 81% -> 81%.
- 9, Novelty & Special Use (22) and Hair Extensions & Wigs (15), 74 searches: OK 82% -> 82%. Hair 93%.
Fix: a bare letter size is not the item ("scrubs set M" named "m"); bot.js NOT_NOUN gains xs/s/m.
Left weak, by hand: phone repair parts for one model (flex cables, camera modules, motherboards: tens sold), a Poco X6
Pro (phones barely sold via the partner search), furniture and colored furniture (big items sell few), pet sizes
(a 40cm canary cage, a medium dog cone), uniforms and dirndls in a letter size (the search with "M" finds almost
nothing; the live reading's fallback is the plain item), a red babydoll (dolls crowd it), a 75B bra.

## Families 10-11
- 10, Bags & Luggage (43) and Motorcycles & Powersports (30), 146 searches: OK 88% -> 88% (two rows that looked worse,
  a black hand cart and a 48V battery, rerun back to back: no loss). Bags 94%, Motorcycles 80%.
  Left weak: parts for one bike model (TMAX top case, MT-07 crash bar, Grom seat: tens sold), Minn Kota motors, a pink
  luggage scale, amber turn signals by that name, scooter polish.
- 11, Baby & Maternity (44) and Arts, Crafts & Sewing (11), 110 searches: OK 77% -> 78%. Crafts 100%, Baby 72% -> 73%.
  Kids' European sizes (116, 98, 74) looked like misses: the check wanted "116" in the title; sellers list 5-6Y, 6T or
  120. Read as the bot now reads them (next fix), the 11 kids' size searches are 91% OK both before and after; the fix
  matters on the card: a listing that has the size counts as exact and its link opens that size.

## Family 12: Business, Industry & Science (38) and Books & Media (3), 82 searches
OK 83% -> 83%. Industry 82%, Books 100%. Left weak: workshop furniture and big machines (workbenches, shelving racks,
concrete mixers, three-phase motors: tens sold), Siemens LOGO and Intel NUC (few listings), a 38x38 heat press by size.

## All 12 families (1,735 searches, 869 sub-categories, 24 categories)
Before = the bot live this morning (item first already in it). After = all fixes of the day.
- OK 86% -> 86%, weak 11% -> 11%, miss 3% -> 3%; 72 right 74% -> 75%; best-4 sales 37.97M -> 38.59M (+1.6%).
- By kind (OK): plain 95% -> 95%, color 83% -> 84%, brand 90% -> 90%, size 61% -> 62%, kids 74% -> 74%, fits 59% -> 59%,
  slang 97%, accessory 100%. 13 searches better, 3 worse in the totals; every worse one rerun back to back was the same.
- The day's bigger step came before this check: item first in the 72 (79% -> 94% of the 72 naming the item, 1,784
  searches over 446 sub-categories, right items with 100+ sales +13%).
- Fashion gained most from the family fixes: women's clothing 72 right 63% -> 72%, men's 70% -> 83%.

Fixes of the day (all with unit tests): "%" dropped from the search words; item first in the 72; item first in style
searches too; the item noun skips "assembly", a size, a bare letter size; a general request ("accessories") isn't
reordered; a size or spec read from the variants (SKU), the link opening that size; kids' European sizes read as ages
and heights; "מדחום" names no brown; a size chart or parameter table counts as an ad photo.

What AliExpress search taught (for the next checks):
- The sellers' English titles are the truth; the Hebrew ones are machine-translated (a garlic press is "מגרדת שום").
- Sorted by sales, AliExpress mixes in big sellers that only touch the words: the item named first is the fix.
- Colors and sizes live in the variants, not the titles: read them (SKU API) before calling a listing "close".
- Kids' sizes are ages (5-6Y, 6T) or round heights (120), never the European 116.
- Big brands' originals sell little; the model code without the brand sells far more (F91W, Classic Wayfarer).
- Long, exact searches ("dirndl dress M", "cash box a4 lock") find nothing: the core item as a second search saves them.
- Market limits, not the bot: parts for one car, phone or bike model; big appliances and furniture; Judaica; phones;
  sex toys and condoms (absent from the partner search); brands not sold there (Zara, Shein, Dr. Martens, Levi's 501).
