# Fashion cards: the best sellers that look elegant (design, 2026-11-05)

Approved by the owner in chat on 2026-11-05.

## Why
Fashion is the hardest and most important family. A fashion card must show what people actually buy and what looks
good. The owner's word for a bad result is "ugly": low sales plus a dated, messy, not elegant look.

## The owner's taste (his 10 answers, 2026-11-05)
1. Ugly = low sales plus a dated, messy ("מקושקש") look that is not elegant.
2. 🥇 is the best seller, if it looks pretty (today's rule, unchanged).
3. Audience: everyone equally (women, men, kids).
4. Revealing or sexy items in a general search get no special handling.
5. Elegant, when no style is named, means clean and classic: one or two colors, no loud prints, a good cut.
6. No season guessing. Only what the shopper wrote.
7. A color was asked, and a best seller is pictured in another color: show its photo in the asked color. If none is
   found but the title shows it comes in that color, show it as it is, with a line saying it comes in that color too.
8. A photo on a model is preferred.
9. Minimum sales are relative to the search itself. The goal is as many sales in the card as possible.
10. Extra cost per fashion search: at most ½¢.

## Goals
- Every fashion card is led by proven best sellers that look clean, classic and elegant.
- A requested color is never lost just because the listing's first photo shows another variant.

## Non-goals
- Season, modesty or age guessing beyond what the request says.
- New AI calls for searches with no color named.

## Anti-goals (a failure even if it "works")
- More cost than ½¢ per fashion search.
- A card that says "comes in black" with no evidence of it.
- Cards emptier than today on searches that are already good (coats, sneakers, pajamas, swimwear, socks).

## Constraints
- Free checks only: AliExpress API, the pool code with stub judges, unit tests. No paid AI runs. The owner tests in
  Telegram.
- One change per upload. Each step is verified on the same fixed Telegram set before the next one starts.
- Upload only after the owner says "תעלה". Push `fashion` to main only if `npm test` shows `fail 0`.

## Steps (in this order)
0. **Upload what is ready.** The 12 fashion wording hints and the color-trigger fix (whole English words, so bluetooth,
   wired and credit searches no longer send photos). Hold the new Israeli colors (ניוד, חאקי, נייבי, טורקיז, פוקסיה,
   לילך and their English names) until step 3: with them, the photo look would drop variant listings.
1. **The judge's taste** (`styleNote` in `query.js`). pretty = clean, classic and elegant (one or two colors, a good cut,
   well made, nicely photographed; on a model is a plus). plain = loud or busy prints, heavy decoration, dated, cheap
   fabric, or a bad photo. Zero cost. Verified only in Telegram.
   *My call:* `styleNote` also serves bags, jewelry and decor. The same "clean and classic" taste applies there too.
2. **Relative sales floor** (`STYLE_MIN_SOLD` in `bot.js`, today a fixed 100). Floor = a share of the search's own top
   seller (start at 10%), falling back to 100 when too few pass. Measure the share free, on the fashion pools, before
   choosing it. Zero cost.
3. **Colors** (`bot.js` color pick, `format.js` COLORS). A listing the photo look dropped, which the title judges called
   exact and which has more photos, goes to the photo picker (at most 4 listings, about 5 photos each, low detail,
   about 0.3¢, color searches only). If the picker finds a photo, it shows in the asked color. If not, and the title
   names the asked color among several, it shows as it is with "🎨 מגיע גם ב<color>". Otherwise it stays out. Then the
   Israeli colors come back, in both `VISUAL_WORDS` and `COLORS`.

## Fixed Telegram test set (the same for every step)
1. שמלה
2. שמלה שחורה
3. שמלת ערב
4. חולצה לנשים
5. סוודר לנשים
6. מעיל חורף לאישה
7. נעלי ספורט לנשים
8. ג'ינס לגבר
9. חולצה מכופתרת לגבר
10. מכנסיים קצרים לגברים
11. שמלה לילדה
12. מעיל נייבי

## Left to the builder
- The exact prompt wording in step 1, kept short (it is paid on every style search).
- The exact share in step 2, from the free measurement.
- The wording of the per-product color line in step 3, in the voice of the existing notes.
