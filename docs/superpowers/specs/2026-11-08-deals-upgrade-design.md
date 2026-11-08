# Daily-deals channel upgrade: design, 2026-11-08

The owner asked for this in chat on 2026-11-08 after reading 4 live posts (umbrella, door seal, shower hook, eye mask).

## Why
The owner feels the channel is "not at its best". His three complaints:
- It repeats products.
- It is not convincing enough.
- It looks too much like a bot.

The code explains each one:
- **Repetition.** There are 48 topics (`TOPICS` in `deals.js`) and 17 posts a day (07:00-23:00, every hour). So every
  topic comes back about every 3 days. The same product id never repeats (`KEEP_POSTED` = 500), but the same kind of
  item does.
- **One template.** Every post has the same shape: banner, a "question? answer" headline, the name, 3 ✅, then price,
  discount, rating, sold and link. After three posts a reader sees a bot.
- **Generic copy.** The AI writes only from the seller's title (`DEAL_WRITE_SYSTEM` in `query.js`). The benefits are
  bland ("מתאימה לשמש ולגשם"), and there is no real reason to buy.
- **Seller photos.** The collage is 4 seller images full of English text and infographics, so it looks like an
  AliExpress screenshot.

## Goals (the owner's choices)
1. **Real buyer reviews** in the post: a short Hebrew quote and a buyer's own photo.
2. **Varied post types and templates**, so the channel reads like something worth reading and doesn't bore people.
3. **Topics from all the sub-categories studied for the search bot**, instead of 48.
4. **Product by hour of day** (an eye mask at night, not at noon).
5. **Discount**
   - Always show the discount line, as today.
   - When the discount is unusual, the post may talk about it.
6. **"Really worth it" / trending items**
   - Show the most worthwhile, trending things.
   - Owner's example: costs a lot in Israel, here almost nothing.
   - See the constraints for how this is done without invented numbers.
7. **All tests go to the owner's private chat** with the deals bot (`DEALS_OWNER_ID`), never to the channel. The channel
   changes only after the owner says "תעלה".

## Non-goals
- **Polls.** The owner said not now: "only once I have lots of members".
- **No change to the search bot** (`bot.js`, `query.js` search parts, `index.js`).
- **No change to the posting hours or the number of posts a day** (17, hourly). The owner decided this on 2026-11-04.
- **Israeli store prices are not in this round.** See step 6.

## Anti-goals (a failure even if it works)
- **A number or claim the data doesn't have.** No invented Israeli price, no invented spec. The 2026-10-30 launch posted a
  wrong name and a number from another product. The existing guards stay:
  - only numbers from the title
  - no device the title doesn't name
- **A translated review that says more than the buyer wrote,** or a review from a 1-3 star buyer shown as praise.
- **A post that breaks** when reviews, photos or AI are missing. Every new part is optional and falls back to today's post.
- **Changing what works.** The owner's rule: additive, one step at a time, each one tested in Telegram before the next.
  The stable parts stay as they are:
  - picking: two AI calls, fits then write
  - the sale, holiday, series and set logic
  - the nightly owner summary
  - the down alert

## Constraints
- **Cost.** He watches AI cost.
  - The deal post uses gpt-5.4-mini: about 0.09¢ for the two calls today, measured 2026-10-30.
  - New AI work rides in the existing write call where possible. No new paid model.
- **Free-only rule for me (2026-11-05).** I run free AliExpress checks and unit tests myself. Any run that calls the AI
  (a private preview post) is said with its cost first, and runs only with the owner's OK.
- **Release flow** (`CLAUDE.md`): work on branch `fashion`.
  - Preview in the owner's private chat through the workflow.
  - Upload (`git push origin fashion:main`) only on the owner's "תעלה".
- **Unofficial review endpoint.**
  - Reviews come from `https://feedback.aliexpress.com/pc/searchEvaluation.do`, the source `addStars` already uses for
    stars.
  - Checked live 2026-11-08: the top umbrella returned 10 reviews with text, a translation and buyer photos (`filter=image`).
  - Any failure means the post goes out without a review.
- **State.**
  - Lives in `deals-state.json`, carried by the workflow cache.
  - New memory (prices seen, sales seen, last post per topic) must stay small. Cap it as `KEEP_POSTED` does.

## The steps, in order (owner-approved order)

### Step 1: private preview
A manual workflow run can send the post to `DEALS_OWNER_ID` instead of the channel.
- The preview must not change the channel's state: no posted id is recorded and the rotation does not advance.
- Every later step is checked this way.

### Step 2: buyer reviews
**Fetching**
- After the product is picked, fetch up to 20 of its reviews from the endpoint above.
- Keep 5-star reviews, or 4-star when there are none, whose text is a real sentence (not just "good").
- Prefer buyers from Israel (`buyerCountry` = IL), then reviews with photos.

**Writing**
- The write call that exists today also gets up to 3 of these reviews.
- It returns one chosen review as a Hebrew quote of up to ~15 words, using only what the buyer wrote.
- The post shows a line such as `💬 קונה מישראל: ...` or `💬 קונה כתב/ה: ...`.
- The same number guard applies: a number not in the review or the title drops the line.

**Photo**
- One of the 4 collage photos becomes a buyer photo from a 4-5 star review.
- With no buyer photo, the collage stays as today.

### Step 3: varied post types
About 5 templates rotate, and the same template never appears twice in a row:
1. **Short**: one sharp line, then the price block and link.
2. **"Why we picked it"**: 2-3 sentences like a friend recommending it, with the review.
3. **"Buyers say"**: the review is the heart of the post.
4. **"3 things under X ₪"**: three cheap best sellers in one post, like the existing Thursday set, with a price cap.
5. **Today's post, improved**: the headline no longer always follows the "question? answer" pattern.

Rules for every template:
- The data lines stay in every post: price, discount, rating, sold, buy link and the search-bot link at the bottom.
- The voice is one consistent human voice, the channel's "panda", in plain spoken Hebrew.
- Copy must pass the `hebrew-content-writer` and `avoid-ai-writing` rules.

### Step 4: all sub-categories, and product by hour
**Topics**
- Build the topic list from the search-bot studies: the 1,000 and 1,500 checks (2,512 rows).
  - They live in my scratchpad as `words/r1000_*.jsonl` and `words/r1500_*.jsonl`, with fields `cat`, `he`, `kw` and
    `top` (top sellers with sales).
  - Copy the needed data into the repo first: the scratchpad is temporary.
- Keep a term when a free AliExpress check shows its top items pass `candidates()` with strong sales, at the same bar as
  today (`MIN_SOLD` 3,000).
- Expect 150-300 topics.
- Store them in a data file in the repo, not inline in `deals.js`.
- Fashion is included, following the owner's taste: clean classic, model photo, a best seller only if it looks good.

**Rules**
- A topic does not come back within 7 days.
- Every topic gets one or more time windows:
  - morning: commute, coffee, car
  - noon: gadgets, office
  - afternoon: kids, sport
  - evening: home, beauty, sleep
- The hourly run picks the next unused topic whose window fits the hour.

### Step 5: unusual discounts, and "really worth it" / trending
- **Discount line**: always shown, as today.
- **Unusual discount**
  - The state remembers the price of each product the bot has seen.
  - When today's price is clearly below what was seen before, or the discount is above ~70%, the headline may say so
    ("המחיר הכי נמוך שראינו").
- **Really worth it**: very high sales at a very low price.
- **Trending**
  - Sales that jumped since the bot last saw the item.
  - `lastest_volume` is read on every run, so the bot can compare against its own past readings.
- Both are real data, with no invented numbers.

### Step 6, optional, later: Israeli prices
- A free check of whether a public Israeli price source (Zap) can be read reliably.
- Only if it can, a line such as `בזאפ מ-₪89`.
- If not, this stays out.

## Expected cost per post (gpt-5.4-mini, $0.75 / $4.5 per 1M tokens in / out)
- **Today:** about 0.09¢ (US cents) a post, measured.
- **With a review:** about 0.12-0.15¢. That is about 400 more input tokens and about 40 more output tokens.
- **"Why we picked it" / "buyers say":** about 0.15-0.2¢ (longer text).
- **"3 under X ₪":** about 0.3¢ (three picks).
- **Per day (17 posts):** about 2.5-3¢, about ₪0.10 a day, about ₪3 a month.
- **Private preview:** the same as one post.
- **Reviews, topic measuring and price memory:** free (no AI).
- These are estimates. The real cost is measured on the first previews and reported.

## Calls made after the builder check (mine, not the owner's; he can override)
- **Step 5 changes the pick, but only for its own posts.** About 2-3 posts a day are "really worth it" or "trending"
  posts, picked by that score. Every other post keeps today's pick: the most sold item the AI says fits.
- **When topics run short, the rules give way in this order:**
  1. The time window is a preference. With no unused topic in the window, any unused topic is taken.
  2. Then the 7-day rule gives way: the topic unused for the longest time is taken.
  3. A post is never skipped for lack of a topic.
- **"3 things under X ₪" is once a day,** not one of the equal rotation. Each of its 3 items uses up its topic.
- **Special posts keep their exact shape today** and stay outside the template rotation: holiday, weekly series,
  Thursday set and sale-list posts.
- **The new topic file carries the numeric AliExpress category id per topic.** Map it from the study's category name,
  so the Sunday and Wednesday series keep filtering by category.
- **Release flow is the one used in this project since October.**
  - Work on `fashion`.
  - Previews come from a manual workflow run on that branch (`--ref fashion`) with the private-preview flag.
  - Upload is `git push origin fashion:main` only on the owner's "תעלה".
- **Risk to check in step 2:** the review endpoint was tested from the Mac, not from GitHub's runners.
  - The deals run logs whether reviews came back: a count only, no AI.
  - A silent fallback on every run would then show in the log before any paid preview.

## Left to the builder
- Exact template copy and emoji, within the voice and the rules above.
- Collage layout (where the buyer photo goes).
- The exact unusual-discount threshold and the trend formula, measured on real data.
- How the state is shaped and capped.
- The window assigned to each topic (a first guess per category, fixed later from the owner's feedback).
