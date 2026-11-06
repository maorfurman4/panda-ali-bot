# Variant data (SKU API) in the bot: design, 2026-11-06

Approved by the owner in chat on 2026-11-06 (four choices answered; see the end).

## Why
AliExpress approved the SKU Dimension API on 2026-11-06. Until now the bot saw one listing as one product: one photo, one
"from" price, one title. A best seller sold in ten colors, five sizes or three capacities looked like whatever its first
photo and cheapest variant showed. That caused:
- the rare-color misses (burgundy sweater)
- the wrong-color cards (a pink "15 colors" puffer for navy)
- the AI photo guessing that costs ≈0.45¢ per color search
- "from" prices that belong to the smallest size

## What the API gives (verified live, free, 2026-11-06)
Per product:
- every variant, with:
  - its properties (color, size, capacity, model)
  - its own photo
  - price and sale price
  - its own link
- the item's review count and score

Checked on 62 best sellers across 10 searches:
- **Color names:** with `target_language: EN`, real names ("Burgundy", "Navy", "SAKURA PINK") in 29 of 32 fashion and gadget best sellers. 3 use codes ("A", "F").
- **Photos:** every variant has its own photo.
- **Other properties:** models ("Compatibility by Model: iPhone 16"), shoe sizes ("EU43-44"), capacities ("1TB", "401-500ml"), plug types.
- **Price spread:** a 1TB drive listing spans ₪137-852 across capacities; a travel mug ₪34-69 across sizes.
- **Speed:** 6 products in parallel took 1.5 s, with no rate-limit error.
- **Limit:** at most 20 variants come back per product. So a missing variant is not proof it doesn't exist. Only a positive match counts.
- **Empty answer:** error 15 / sub_code 405 means no data for that product.
- **Wrapper bug:** the answer has no `resp_code`, so today's `skuApproved()` reports null. It needs a fix.

## Goals
- A color search shows best sellers that really come in that color, in that color's photo, with no AI guessing.
- The card stays at least as good as today on every search (the only-add rule from fashion).

## Non-goals
- Delivery time (the owner declined it, 2026-11-05).
- Changing how searches with no variant detail are ranked.

## Anti-goals
- Dropping a product because its variant wasn't in the first 20.
- A slower bot: SKU calls run in parallel with the existing star lookup, only for the products about to be shown.
- Any new paid AI call.

## Constraints
- Free checks only, plus unit tests. The owner tests in Telegram. Upload only on "תעלה".
- Every SKU failure (timeout, empty, error) leaves the card exactly as today.

## Steps (one upload each, in this order)
0. **Foundation, no visible change.**
   - `skuDetails(productIds)` in `aliexpress.js`:
     - parallel
     - English names, with `tracking_id`
     - variants parsed into `{ props, photo, price, salePrice, link }`
     - 3 s timeout
     - fails open
   - Fix `skuApproved()`.
   - Unit tests with a stubbed fetch.
1. **Colors from variants.**
   - The color-free best sellers (today up to 6, picked by AI photos) are checked against their variant color names.
   - A match shows that variant's own photo.
   - Listings whose colors are codes fall back to the photo picker (today's behavior).
   - The listings already shown whose first photo is another color get the same check and the right photo.
   - The price stays "החל מ" (the owner's choice).
2. **The link opens the asked variant**, only if a free check shows that a link made by `link.generate` for the variant URL is a normal affiliate link and keeps the variant after the redirect. Otherwise the regular link stays.
3. **Fakes by variant price (later, owner's call).** A capacity variant priced impossibly (a "2TB" variant at ₪16) is caught by the same rule as titles. The card's price display doesn't change.
4. **Reviews from the API (maybe).** First a free comparison with today's unofficial review lookup on 50 products. Switch only if it agrees and is faster.

## Fixed test set (the owner, in Telegram, for every step)
- **Color searches:** סוודר בורדו, מעיל נייבי, שמלה ניוד, אוזניות אלחוטיות ורודות, כוס תרמית שחורה, שמלה שחורה
- **Controls:** שמלה, ג'ינס לגבר, מטען מהיר

## The owner's choices (2026-11-06)
1. A color match shows the variant's own photo.
2. The price stays "החל מ" with the lowest variant price, always.
3. The link opens the asked variant only if the commission is kept; otherwise the regular link.
4. Colors first.
