# Daily-deals upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the deals channel varied, convincing and less bot-like: buyer reviews, rotating templates, many more topics
by hour of day, and real "worth it / trending" picks. Every step is tested in the owner's private chat first.

**Architecture:** Additive changes to `deals.js` (picking, rotation, formatting), plus small helpers:
- `aliexpress.js`: reviews
- `query.js`: the deal write call

New data lives in `deal-topics.json` (built by a free script). New memory lives in `deals-state.json`, capped.

**Tech Stack:** Node 24 ESM, grammy Api, `node --test`, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-11-08-deals-upgrade-design.md`

## Global Constraints
- Search bot untouched: `bot.js`, `index.js`, and the search parts of `query.js`.
- 17 posts a day, hourly 07:00-23:00, unchanged. Specials (holiday, series, set, sale lists) keep their shape.
- No number or claim that isn't in the title or the review. The existing number and device guards cover every new
  AI field.
- Every new part is optional. On any failure the post is today's post.
- AI model for deals stays gpt-5.4-mini (`OPENAI_MODEL` default). New AI work rides in the existing write call. The only
  extra call is the "3 under X" post (3 picks).
- Any run that calls the AI is announced with its cost and run only with the owner's OK.
- Upload (`git push origin fashion:main`) only on the owner's "תעלה". One task per upload.

## Review Focus
1. A preview run must never post to the channel or change the channel's state (posted ids, rotation, slot).
2. The review endpoint returns nothing, HTML or an error from GitHub's runners. The post goes out without a review, and
   the log says `reviews: 0`.
3. A review in Russian or Korean with a number in it ("arrived in 12 days"). The Hebrew quote keeps only numbers the buyer
   wrote, else the line is dropped.
4. A buyer photo that fails to download. The collage falls back to seller photos, and from there to the main photo.
5. The topic file is missing or empty. The bot falls back to `TOPICS`.

---

### Task 1: Private preview
**Files:** Modify `scripts/daily-deal.js`, `.github/workflows/daily-deals.yml`.

- [ ] **Workflow:** add the input `preview` (boolean, default false, description "Send to the owner's private chat only,
  not the channel"). Pass it as `DEALS_PREVIEW`. Skip "Watch the search bot" when `inputs.preview` is true.
- [ ] **Script, when `DEALS_PREVIEW === "true"`:**
  - send to `DEALS_OWNER_ID`, with force
  - skip `sendDailyStatus`
  - do not write the state file
  - log `preview: sent to the owner, state unchanged`
- [ ] **Free check:** a dry run with no token and no OpenAI key, `DEALS_PREVIEW=true DEALS_STATE=<scratch file>`. It prints
  a post and the scratch state file is not created.
- [ ] **Commit:** `feat: a preview run of the deals bot goes to the owner's private chat and leaves the channel's state alone`

### Task 2: Buyer reviews
**Files:** `aliexpress.js`, `query.js`, `deals.js`; tests in `test/aliexpress.test.js`, `test/query.test.js`,
`test/deals.test.js`.

**Interfaces, produced:**
- `fetchReviews(productId, { fetch, timeoutMs = 4500 }) -> Promise<Review[]>`, where
  `Review = { stars: 1..5, country: "IL"|..., text: string, photos: string[] }`.
  - Endpoint as in `addStars`, with `pageSize=20`.
  - Text: `buyerTranslationFeedback || buyerFeedback`.
  - Stars: `buyerEval / 20`.
  - Photos: from `images`.
  - Returns `[]` on any failure.
- `pickReviews(reviews) -> Review[]` (up to 3).
  - Keep 5 stars, or 4 when there is no 5.
  - Text must have at least 25 letters and 4 words.
  - Sort: IL first, then with a photo, then longer text.
- `pickDeal(products, topic, { reviews })`: the write call also gets the reviews. The schema adds
  `review: { index: integer|null, quote: string|null }`.
  - The result adds `review: { quote, country, photo } | null`.
  - `quote` is up to 90 characters.
  - Numbers must appear in that review's text (the same rule as `short()`).
- `formatDeal`: after the benefits, a line `💬 קונה מישראל: …` when the country is IL, else `💬 קונה כתב/ה: …`.
- `sendDeal`: the review's first photo replaces the 4th collage photo.

**Tests**
- [ ] `pickReviews` drops 3-star reviews and short texts, and puts IL first.
- [ ] `fetchReviews` maps the fields and returns `[]` when fetch throws or the JSON is odd.
- [ ] The write guard drops a quote whose number isn't in the review.
- [ ] `formatDeal` shows the IL and the non-IL line, and no line without a review.
- [ ] `postDeal` with a reviews stub that throws still posts.
- [ ] `postDeal` logs `reviews: N`.

**Then**
- [ ] Full `npm test` green.
- [ ] Commit.
- [ ] Owner preview: one AI run, ≈0.15¢, after his OK.

### Task 3: Rotating templates
**Files:** `deals.js`, `query.js`, tests.

**Interfaces, produced:**
- `TEMPLATES = ["short", "why", "buyers", "classic"]`.
- `nextTemplate(state, hasReview) -> name`. Rules:
  - never the same as `state.template`
  - `"buyers"` only when there is a review
  - otherwise in turn
- `pickDeal(..., { template })`: the write instructions change by template.
  - short: headline only, no benefits.
  - why: `why`, 2-3 sentences up to 220 characters, under the same guards.
  - buyers: the quote leads.
  - classic: today's post, without the fixed "question?" headline shape.
- `formatDeal(p, choice, banner, template)`: lays out each template. The data lines are the same in all of them.
- **"3 under X ₪"**
  - Once a day at the 4th posting hour: `specialFor` returns `{ cheap3: true, maxIls: 20 }`.
  - It reuses `postSet`'s layout over 3 unused topics, with the price cap.
  - Each of the 3 items marks its topic as used.

**Tests**
- [ ] No template twice in a row over 20 runs.
- [ ] Never "buyers" without a review.
- [ ] Each template's caption holds price, sold and the buy link.
- [ ] The cheap3 slot posts 3 items, all at or under 20 ₪.

**Then**
- [ ] Full `npm test` green.
- [ ] Commit.
- [ ] Owner previews: each template once, about 0.6¢ in all, after his OK.

### Task 4: All sub-categories and product by hour
**Files:**
- Create `scripts/build-deal-topics.js` (free: AliExpress only).
- Create `deal-topics.json`.
- Modify `deals.js`, tests.

**Building the topics**
- Input: the 1,000 and 1,500 check rows (`cat`, `he`, `kw`).
  - Copy them from the scratchpad's `words/r1000_*.jsonl` and `words/r1500_*.jsonl` into
    `research_notes/deal-terms.jsonl` first.
- For each `kw`, search with and without the category, the same way as `postDeal`.
- Keep the term if `candidates()` gives 3 or more items.
- Write `[{ words, category, cat, windows }]` to `deal-topics.json`.
  - `category` is the numeric AliExpress id, mapped from `cat`.
  - `windows` is a first guess per `cat`.
- Windows: `morning` 7-10, `noon` 11-14, `afternoon` 15-18, `evening` 19-23.

**Interfaces, produced:** `nextTopic(state, hour, topics, now) -> index`.
- An unused topic whose window fits and that is 7 days or more since its last use.
- Else any topic 7 days or more since its last use.
- Else the one unused the longest.
- `state.used = { [words]: at }`, capped at the topic count.
- `postDeal` uses it when `topicKey === "topic"`. Specials keep their own lists.
- If `deal-topics.json` is missing or empty, the bot falls back to `TOPICS`.

**Tests**
- [ ] The window is respected when possible.
- [ ] No repeat inside 7 days while unused topics exist.
- [ ] The fallback order is as above.
- [ ] A missing file falls back to `TOPICS`.
- [ ] The Sunday and Wednesday series still filter by category id.

**Then**
- [ ] Run the builder (free), and report the topic count and the count per window to the owner.
- [ ] Commit.
- [ ] Owner preview at two different hours, after his OK.

### Task 5: Unusual discounts, worth-it and trending
**Files:** `deals.js`, `query.js`, tests.

**Interfaces, produced:**
- `state.seen = { [productId]: { price, sold, at } }`, the last 2,000, updated from every searched list (free).
- `dealSignals(p, seen) -> { lowest: boolean, jump: number|null }`.
  - `lowest`: the price is 10% or more under the seen price.
  - `jump`: sales growth per day since `at`, only if `at` is 2 or more days ago.
- `worthScore(p) = sold / price`.
- Slots: 2 posts a day, at the 6th and 12th posting hours, pick the best `worthScore` or `jump` item that the AI says fits.
  All others keep the most sold.
- The write call gets `signals`. The headline may say "המחיר הכי נמוך שראינו" only when `lowest` is true, or when the
  discount is 70% or more. Otherwise it gets no price talk, as today.

**Tests**
- [ ] `dealSignals` reports `lowest` only with a 10% or bigger drop.
- [ ] `jump` is null before 2 days.
- [ ] The worth slot picks the higher score.
- [ ] The headline guard rejects price talk without the signal.
- [ ] `seen` stays capped.

**Then**
- [ ] Full `npm test` green.
- [ ] Commit.
- [ ] Owner preview, after his OK.
