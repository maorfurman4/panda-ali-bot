# Panda Deals bot — status

Bot: `@panda_ali_deals_bot` · Last updated: 2026-10-22 · Research and roadmap: [research.md](research.md)

## 1. Current state

- **Code:** Phase 2a. Commits: `233a220` (MVP), `8518425` (research fix), `2fe940d` (this file), `675041a` (Phase 1.1), then the Phase 2a commit (AI query understanding + card fixes). Local git only, no remote.
- **Tests:** 78/78 pass (`npm test`, no token, no network; the Anthropic API is mocked).
- **AI:** OpenAI `gpt-4.1-nano` (override with `OPENAI_MODEL`). `OPENAI_API_KEY` is filled. When it's empty, the AI is off (fail-open: raw queries are searched). `npm run eval:query [-- --model <id>]` checks the AI alone.
- **`.env`:** `BOT_TOKEN` and `ALI_TRACKING_ID` filled. `ALI_APP_KEY` and `ALI_APP_SECRET` empty, so the bot runs in **mock mode** (`[דמו]` products, fake links).
- **Telegram:** privacy mode OFF in BotFather. The bot was removed and re-added to the test group after the change.
- **Bot profile (set 2026-10-23 via Bot API):** commands `/search`, `/help`; description and About say "not an official AliExpress bot" and include the affiliate disclosure.
- **Runtime (2026-10-23):** Render free web service `panda-ali-bot` (Oregon), **webhook mode**, `https://panda-ali-bot.onrender.com/webhook` (verified via getWebhookInfo). Deploys from the private GitHub repo `maorfurman4/panda-ali-bot` (branch `main`, auto-deploy on push). Env vars live in Render: BOT_TOKEN, OPENAI_API_KEY, ALI_TRACKING_ID, WEBHOOK_URL, WEBHOOK_SECRET.
  - The free instance sleeps after 15 min without traffic: the first message after that waits ~50 s, and in-memory state (cooldowns, clarify buttons, AI cache) resets.
  - The 750 free hours/month are shared with the workspace's other services, so no keep-alive ping for now.
  - **Do not run `npm start` locally with the same BOT_TOKEN**: local polling calls deleteWebhook and disconnects the server. Use a separate test bot for local work.
  - Lesson: switching a live service from polling to webhook deleted the webhook (the old polling instance restarted during the overlap); one manual restart fixed it.
- **AliExpress:** the Open Platform app is pending approval. No API keys yet.

## 2. Live test results

Phase 1 (text format, old triggers) below. Phase 1.1 live test (2026-10-22 20:41): the card, 3 products, 3 price buttons and RTL all PASS; findings fed into Phase 2a. **Phase 2a is not live-tested yet.**

2026-10-22, 20:13–20:15 IDT, test group, Telegram Desktop, real Telegram + mock AliExpress.

| Input (group) | Result | Status |
|---|---|---|
| `/start` | Hebrew help, correct RTL, disclosure line, sent as a reply | PASS |
| `אוזניות` (plain text) | Silence | PASS |
| AliExpress item link | `🔗 הנה הקישור [דמו]:` + mock link + disclosure | PASS |
| `חפש לי אוזניות` | 5 mock products | PASS |
| `@panda_ali_deals_bot מנורה` | 5 mock products | PASS |
| `/search earbuds` ~1 s after a search | `⏳ … בעוד 2 שניות` | PASS (cooldown) |
| `/search` (empty) | `מה לחפש? …` | PASS |
| `/search earbuds` after the cooldown | 5 mock products | PASS |
| `שלום לכולם` | Silence | PASS |
| `חפש לי כבל` twice | Results, then one cooldown warning | PASS |

**Rendering:** RTL is correct on every line, and prices, `%`, order counts and Latin words don't flip. The <90% filter works (mock "דגם 3" is hidden). A missing rating omits the 👍 part instead of showing 0.

**Not tested live yet:**
- private-chat search
- Telegram iOS/Android
- anything against the real AliExpress API (signing, response shapes, currency, error codes are UNVERIFIED)
- webhook mode on a real server

## 3. Message format: current vs planned

**Current (Phase 1.1):** one photo card per search, sent as a reply to the requester.
- `sendPhoto` with product #1's image, an HTML caption (≤ 1024 parsed chars; trailing products are dropped if needed), and one URL button per product (`🥇 ₪39.90`, 3 per row). If `sendPhoto` fails or there is no image, the same caption and buttons go out via `sendMessage`.
- Group: top 3. Private: top 5 (ranks `4️⃣ 5️⃣`).
- Caption: header `🔎 <b>{corrected Hebrew query}</b>` (+ ` [דמו – תוצאות קבועות]` in mock mode only). Each product has:
  - a medal + title line (one line, ≤ 30 chars, cut at a word boundary; photo captions are only as wide as the photo)
  - `💰 <b>₪39.90</b>  <s>₪69.90</s>  🔥 43%-`; the original price and badge appear only for 5% ≤ discount < 80%
  - `⭐ 4.8 (1,234)` or `👍 97% משוב חיובי`, then `· 🛒 5,200+ נמכרו`; the line is dropped if both are missing. The private /help explains the sold count is AliExpress's recent-period figure.
- `avgStars` / `reviewCount` are optional model fields for the future DS API. They are undefined for real Affiliate data and appear only in mock data.
- Every line is prefixed with RLM (U+200F). No "לקנייה" text links.
- **Disclosure:** by owner decision (2026-10-22), there is no disclosure line on result cards or link replies. The full disclosure sentence stays only in the private `/start` help (and the BotFather description). Owner is aware of the Israeli-disclosure risk noted in research.md.
- Group behavior:
  - triggers only at the start of the message: `/search`, `/search@bot`, `חפש לי`, `מצא לי`, `@bot`
  - links are converted only after a leading mention (private: always)
  - group `/start` and `/help` give one line + a deep-link button, at most once per 10 minutes per chat

**Planned (deferred, not rejected).** Details in [research.md](research.md#הארכיטקטורה-המומלצת).

| Phase | Scope |
|---|---|
| next round | Hosting (Railway), so the bot runs without the owner's computer |
| 2a ✅ | AI query understanding (OpenAI gpt-4.1-nano; built on Claude Haiku 5.5, then switched): typo fix, Hebrew → English keywords, shekel price cap, clarify buttons, not_product; fail-open; English queries skip the AI |
| 2b | AI relevance filter + AI short Hebrew titles (need real AliExpress data), trust score (Wilson/Bayesian), IQR price sanity, Hebrew trigger variants (תחפש / חפשו) |
| 3 | sharp 2×2 collage (replaces the single photo), "עוד" pagination / reply-to-bot actions, grammY runner / ratelimiter / auto-retry, lru-cache |
| 4 | Advanced API, DS API (real source for `avgStars` / `reviewCount`), image search |

Kept as is on purpose: edited messages are ignored (this avoids double replies).

Open (not decided): the photo takes most of a phone screen. Options are a smaller image or the Phase 3 collage.

**Why deferred:** we first verify the real Affiliate API data on the simple text format, which already meets "one message per search".

**Flag:** if the first real results show spammy machine-translated Hebrew titles, AI short titles may move up to early Phase 2. Not decided.

## 3b. Card v2 (2026-10-23, after the first live Telegram test)

Owner feedback fixed:
- **One collage photo:** all result images in one photo (sharp; 3 → 1×3, 4 → 2×2, 5 → 3+2), with rank badges and rank 1 at the top right.
- **Layout:** each detail on its own line (מחיר / לפני הנחה / משוב חיובי or דירוג / נמכרו).
- **Links:** a visible short link under each product, plus the price buttons.
- **Group link:** "🐼 פנדה אקספרס" and the group link (`GROUP_URL`, default `https://t.me/panda_deals_il`) at the end of each result (moved from the top at the owner's request).
- **Relevance:** an AI filter (`gpt-6-luna`, fail-open) runs on real results only. In the live comparison gpt-4.1-nano dropped real chargers; gpt-6-luna kept 6 headrest pillows and dropped seat hooks, tablet holders and cables.

Latency is now about 6–8 s per search (AI + search + link shortening + relevance + collage), plus ~50 s on a cold start.

Risk: badge digits use the server's sans-serif font. If Render has no fonts, only the colored circles show.

## 3c. Natural group requests (2026-10-23)

The bot now also answers group messages without "חפש לי". It reacts to natural shopping phrases anywhere in a message of up to 200 characters, for example "מחפש", "מישהו מכיר", "יש המלצה על", "איפה קונים" or "רוצה לקנות".
- Only those messages are sent to the AI, and the bot answers only if the AI says the message asks for a product. Not a product, AI unavailable, or the user cooling down → complete silence.
- A cooldown starts only when the bot actually answers.
- Extra explicit command forms: תחפש / תמצא / חפשו / מצאו / חפשי / מצאי לי.
- Live eval: 16/16, including "מחפש עבודה" and "מישהו מכיר את דני?" → silence. Results vary slightly between runs (one earlier run gave 15/16).

## 3d. Typing, feature-aware relevance, group protection (2026-10-23)

- **Typing:** "typing…" is refreshed every 4 s until the answer is sent. It replaced `upload_photo`.
- **Relevance:** the filter keeps only products that show a named feature ("עם מסנן", "for kids", "750 ml"). Lesson: the 30-character titles can hide the feature that matched (the "בקבוק עם מסנן" results did have filters).
- **Moderation (`moderation.js`):**
  - A bot added by a non-admin is banned at once. Telegram never delivers other bots' messages, so joins are the only way to catch bots.
  - Member spam gets delete + warning 1/2, delete + warning 2/2, then a kick (ban + unban, so the person can rejoin). It counts as spam when a message has:
    - a link to another Telegram group or channel;
    - an outside link from someone who joined in the last 24 h (AliExpress links are fine);
    - the same text of 15+ chars sent 3× in 2 min;
    - 6 messages in 10 s.
  - Admins are exempt.
  - Requires admin rights: delete messages + ban users. Without them it only logs once per chat.
  - State is in memory, so strikes reset when the free server sleeps.

## 3e. Shopping advisor + accuracy round (2026-10-23 evening)

- **Incident:** OpenAI deprecated `gpt-4.1-nano` (404). Since then every AI step failed open, so raw Hebrew was searched. That explains many of the bad results Eden saw.
  - All AI steps now use `gpt-5.4-nano`: 16/16 on the eval, p50 1.3 s.
  - `gpt-6-luna` kept hitting the 5 s timeout, which skipped the relevance filter.
- **Advisor:**
  - Up to 3 questions with buttons, a "🔎 תחפש כבר" button, and a "💡 why it fits" line per product. `/advice <text>` starts it.
  - In groups only the first question is shown; its options are deep links (`/start q_<id>_<n>`) that continue in private chat. Anyone else who clicks gets their own copy.
  - Sessions are in memory with a 10-minute timeout.
- **Accuracy:**
  - 4 results everywhere (2×2 collage and buttons).
  - A 50-product pool; ranking by log(sales) × positive feedback.
  - Relevance runs on the top 24 only, with the full request and answers as context.
  - A broader AI `fallback_en` search fills up when fewer than 4 remain.
  - Brands AliExpress doesn't sell (Zara…) are searched as similar unbranded items.
  - Stricter item-type rules.
- **Live re-run:**
  - Good now: work bag → laptop/business bags; Zara → similar clothing; iPad case → iPad cases; toothbrush, drone and car charger all relevant.
  - Still weak: "מגפיים לנשים" also returns winter shoes and slippers.

## 4. Decisions log (closed)

- **Stack:** Node.js ESM + Express + grammY. `ae_sdk` not used (v0.6.0, last published 2025-03-30); own signing with tests.
- **Triggers (Phase 1.1):** `/search`, `/search@bot`, `חפש לי`, `מצא לי`, `@bot`, all only at the start of the message. Bare `חפש` was removed. Private chat: any text is a search. Group chatter, a mid-message mention and plain links: silence.
- **Stars / review counts:** never scraped, and the undocumented feedback endpoint is not used. Their source will be the DS API (the owner's call).
- **Disclosure:** none on cards or link replies (owner decision); the full sentence only in private `/start`.
- **AI provider (2026-10-22):** OpenAI Responses API via raw `fetch`. Strict JSON schema validated in code, `store: false`, `reasoning.effort: none` on reasoning models, 5 s timeout, max 300 output tokens, 24 h per-process cache (500 entries). Only the query text is sent. API data is not used for training by default (OpenAI docs) and is kept up to 30 days for abuse monitoring. Max price is filtered in code on ILS results only.
- **Model choice (eval, 12 Hebrew queries, 1 run each):**

  | Model | Accuracy | p50 latency | Max | Cost (12 queries) |
  |---|---|---|---|---|
  | gpt-4.1-nano ✅ | 12/12 | 1181 ms | 2225 ms | $0.00072 |
  | gpt-5.4-nano | 12/12 | 1143 ms | 2322 ms | $0.00185 |
  | gpt-6-luna | 12/12 | 2082 ms | 3706 ms | $0.00083 |

  All three were accurate. gpt-6-luna missed the p50 < 2 s target; gpt-4.1-nano is the cheaper of the two fast ones. Risk: gpt-4.1-nano is an older generation (no deprecation notice found); switching only needs `OPENAI_MODEL`.
- **Group access:** privacy mode OFF (not admin).
- **Logs:** no message text, no user names.
- **Location:** `~/Desktop/panda-ali-bot`, local git only.
- **Reviewer findings rejected:**
  - #5 (`resp_code 405` on empty results): verify live.
  - #6 (a local run deletes the server webhook): use a separate test bot.
- **API applications:** none made on the owner's behalf. Advanced API and DS API are the owner's call, later.
- **Hosting:** Railway is the candidate, after real keys work.

## 5. Keys-day results (2026-10-23, live, local script — not via Telegram)

App `Panda Deals Bot` (Affiliates API, status **Test**, 1000 calls/min, Standard API for Publishers active).

| Check | Result |
|---|---|
| Signature (sha256, /sync, POST form) | ✅ accepted |
| English query "wireless earbuds" | ✅ 19 relevant products, ~2 s |
| Hebrew raw query "אוזניות" (no AI) | ❌ irrelevant (squishy toys) → AI translation is required |
| AI + search "אושניות" → "headphones, earbuds" | ✅ relevant |
| Currency | ✅ ILS (`target_sale_price_currency`) |
| Titles | Hebrew (machine-translated, long, e.g. "Lenovo gm2 pro tws אלחוטי hifi…") → cut to 30 chars; AI titles still Phase 2b |
| `lastest_volume` | arrives as a number (handled) |
| Zero results | `resp_code 405 "The result is empty"` → now returns [] → "לא מצאתי" (fixed) |
| product.query promotion links | ~1065 chars → now shortened in one link.generate call to `s.click…/e/_x` (~42 chars) |
| link.generate, full item URL | ✅ short link |
| Pasted he.aliexpress item link → affiliate | ✅ |
| Real a.aliexpress.com short link | not tested yet |
| ApiCallLimit retry | not observed |
| Relevance | "iPhone charger" top 3 included a USB-C cable and a cable organizer → Phase 2b relevance filter |

## 5b. Keys-day checklist (original plan)

Run these once `ALI_APP_KEY` / `ALI_APP_SECRET` are in `.env` (via `./set-key.sh`). Then restart `npm start`. The startup line must **not** show the mock-mode warning.

Errors appear in the terminal as `update <id>: search failed: <code>: <message>` (no message text is logged).

| # | Check | How to verify | If it fails |
|---|---|---|---|
| 1 | Signature accepted | `/search earbuds` returns products without `[דמו]`. The terminal shows no `search failed`. | Note the exact error code from the terminal (e.g. `IncompleteSignature`, `InvalidApiPath`). Compare our base string with the official IOP SDK: sort order, `simplify`, POST body vs query string. Fix in `aliexpress.js` with a test. |
| 2 | Hebrew query works | `חפש לי אוזניות אלחוטיות` returns products | If an English query works but Hebrew returns nothing or junk, AI query translation moves up to early Phase 2. |
| 3 | English query works | `/search wireless earbuds` returns products | If this fails, treat it as check 1. |
| 4 | Returned currency | Price shows `₪` (ILS) or `$`/other | Not ILS: acceptable for now (we show what the API returns). Decide later whether to convert. |
| 5 | Hebrew title quality | Paste 3 real titles from a result into the status notes | Spammy or broken titles: consider AI short titles in early Phase 2 (see §3 flag), or `target_language=EN`. |
| 6 | Zero-result query (#5) | `/search xqzvbnm123456` | The bot shows `לא מצאתי…`: OK. It shows `הייתה תקלה…` and the terminal shows `resp_code 405` (or similar): map that code to "no results" in `apiCall`, with a test. |
| 7 | `link.generate`, full URL | Paste `https://www.aliexpress.com/item/<real id>.html` | Expect an `s.click.aliexpress.com` link. On error, note the code and check `source_values` / `tracking_id`. |
| 8 | `link.generate`, short link | Paste a real `a.aliexpress.com/_xxx` link from the AliExpress app's Share button | Silence means redirect resolution found no product ID. Note where the link redirects and adjust `resolveProductUrl` (hosts / path patterns) with a test. |
| 9 | ApiCallLimit retry | Several searches from 2–3 users within a few seconds; watch the terminal | **Retries are not logged today**, so only a final failure (`ApiCallLimit` in `search failed`) is visible. If you need to see retries, add one log line in a code round. |
| 10 | Private-chat search | In a private chat with the bot, send `earbuds` | Expect results. If not, check that the bot isn't blocked or muted, then the logs. |
| 11 | Phone rendering | Repeat one search on iOS or Android | If RTL or the numbers flip on mobile, record a screenshot and revisit the RLM/LRM placement in `format.js`. |

Before keys day, run only **one** instance of the bot (two pollers cause `409 Conflict`).

## 3f. Telegram check round (2026-10-24)

The owner ran 9 searches in the group. Fixes:
- **Visible progress:** a "🔎 מחפש לכם… רגע ⏳" reply appears while searching and is deleted when the card is sent. Telegram only shows "typing" in the chat header.
- **Relevance sees photos:** the model is now `gpt-5.4-mini`, and each title is sent with its photo (220px, low detail). Products that contradict the request are dropped: another color (a brown rug when gray was asked), the other gender (men's safety shoes for "women boots"), or another use (sport earbuds for "gaming"). If the photo call fails, one retry runs with titles only, which also covers a slow first call after a cold start.
  - eval:search: every requested feature 73% → 84%; right item 89% (the judge now sees photos too); p50 4.1 s → 5.8 s.
- **Unclear requests:** gibberish gets a clear "לא הבנתי… נסו לכתוב שוב: חפש לי + שם המוצר" reply, and "no results" suggests rewording too. A missing space ("חפש ליהדום") now works, because the AI fixes it to "הדום".

## 3g. Second Telegram round + cost (2026-10-24 afternoon)

- **Cost:** relevance moved to `gpt-6-luna` with photos: $0.0006 per search, was $0.0032 on gpt-5.4-mini, with the same accuracy on the 45-search eval. Understanding stays on `gpt-5.4-nano`, about $0.0002 per new query, cached for 24 h. Most of the spend so far came from eval runs during development.
- **Clarify/advisor:** named products ("מפיץ ריח איכותי לבית") are searched directly. Options must fit the request. Advisor budgets carry min and max (80–150 ₪ now filters both sides), and the header shows "request · option" instead of a bare "80–150 ₪".
- **Ages:** "לבנות/לבנים/לילדים" means kids, not babies, in both understanding and relevance.
- **Bare product names in groups** ("שרוול מרינו מחמם"): if the AI sees a product, the bot replies once with a hint: 'כתבו "חפש לי" ואחריו שם המוצר'. It does this at most once per 10 minutes per user. The cooldown is checked before the AI call, and replies to other messages are ignored.
- **Card:** titles are the first clause without seller filler ("2022 חדש") and up to 40 characters. "נמכרו: מעל 2,100" replaces "2,100+", which flipped in RTL. Discount reads "במקום ₪x · 50% הנחה 🔥". The same product from several sellers is shown once.
- **No results:** a warmer message that asks to rephrase.
- Research and ideas: `docs/IDEAS.md`.

## 3h. More results + votes (2026-10-24)

- **🔍 לחפש עוד?** (owner chose the wording): each search keeps up to 8 more checked products (relevance and dedupe already applied). The button sends the next 4 as a new card. No new search and no AI cost. Only the requester can press it, for 10 minutes. The button appears only when products are left.
- **🎯 בול! / 🐼 לא זה** (our own style instead of thumbs): can vote, once per card (deduplicated for 24 h). `/status` shows the counts and the last 10 searches that got 🐼. Turn those into `eval:search` cases.
- State is in memory (cards map, max 500), like the other shortcuts.
- **Layout (owner request, same day):** the medal/price buttons are gone, since every product has its visible link. The keyboard is "🎯 בול!" and "🐼 לא זה" side by side, with "🔍 לחפש עוד?" below them on every card. With nothing left, a press answers "אין עוד תוצאות לחיפוש הזה".

## 3i. Edge-case round (2026-10-24 night)

A probe of 38 unusual messages found 4 issues. All fixed:
- **Trigger typos:** "חפשלי" (no space), "חפס לי", "חפש לי, …", "חפש-לי", "חפש לי🎧" now trigger. "חפשליד" and "מצאתי לי" still don't.
- **Sensitive items:** new AI status `not_allowed` (owner approved the policy): weapons (switchblade, brass knuckles, guns, tasers), drugs, medicines and diet pills, vapes, adult products, and hidden cameras or trackers for watching people. A direct request gets "🙏 את זה אני לא מחפש בקבוצה". Natural requests and bare names stay silent. Toy guns, chef knives, multitools, security and dash cams, and key trackers are still searched. Limits: if the AI is down, the raw query is searched, and `/advice` doesn't use this check.
- **Brands:** perfume, fashion and luxury brands (Dior, Chanel, Gucci, LV, Rolex) are searched as similar unbranded items, never copies.
- **Anonymous admins** (posting as the group): anyone may press their result and advisor buttons, because Telegram hides who wrote the request.
- eval:query is still 16/16. The understanding prompt is now over 1,024 tokens, so OpenAI's automatic prompt caching applies, and repeated calls cost 10% for that part.

## 3j. Brands, off-topic, advisor accuracy, limitations (2026-10-24 late)

- **Brands (owner decision):** a requested brand stays in the search ("נייקי אייר מקס" -> "Nike Air Max"; AliExpress has real Nike listings). Items showing the brand are exact, others partial. fallback_en = the same item without the brand (Dior returns nothing, so the fallback fills in).
- **Off-topic natural requests** ("מחפש עבודה", "יש המלצה על רופא?"): a warning-style hint, "🐼 שימו לב: הקבוצה מיועדת למוצרים ודילים מעלי אקספרס…". It shares a once-per-10-minutes-per-user limit with the bare-name hint. Plain chat stays silent, and the AI is called only for messages that were already sent to it.
- **Advisor accuracy:** new `npm run eval:advice` plays out 10 advisor conversations. Before: 4/10 ended with no results. After: 0/10, and the price range was kept in 10/10. Fixes:
  - The price range is passed to AliExpress itself (`min_sale_price`/`max_sale_price` in agorot; verified live: 40/50 in range vs 0).
  - Advisor keywords are shorter (2-4 words, no budget words).
  - The first answer's search is the broader fallback.
- **Limitations closed:**
  - Members posting as their own channel are now moderated: the message is deleted with warnings, and the third time that channel identity is blocked (`banChatSenderChat`).
  - Sensitive items are refused through `/advice`, and through a backup word list when the AI is down.
- **Still open (owner decisions):**
  - Cold start and memory reset when the free server sleeps.
  - The `a.aliexpress.com` short link (to test with a real link from the app).
- **Speed:** the broader (fallback) search now starts in parallel with the first search. Only its AI check waits. This saves ~2 s whenever the fallback is needed, at no AI cost. Stage timings measured: understanding ~1.2 s, AliExpress ~2.2 s, relevance ~2 s.
- eval:search after this round (judge gpt-5.4-mini): 95% right item, 77% every feature (was 94% / 75%). The eval's cost label was fixed: it had priced luna calls at mini rates.
- **Keep-awake (2026-10-24):** cron-job.org (owner's free account) calls `/health` with `*/10 8-23 * * *` (Asia/Jerusalem). No cold start and no memory reset from 08:00 to 24:00; the server sleeps at night. About 480 of the 750 free Render hours per month, shared with 2 other services (7 h used by the 24th).

## 3k. Full test, step 1 (2026-10-24, 23:25)

- **Every way of writing the command** (owner request):
  - Letter swaps (ח/כ/ה, ש/ס, א/ה/ע, extra or missing י/ו).
  - A stray first letter (החפש/וחפש/לחפש).
  - Polite openers (בבקשה/אפשר/תוכל/פנדה), "ליי/לנו", and "jpa kh" (English keyboard).
  - The verb without "לי" ("חפש מטען"): searched if the AI sees a product.
  - A short message the AI corrects into "חפש לי …": searched, never answered with "write חפש לי". (Step 1 showed "חפש לי חפש לי…".)
- **AI rule:** a question about a buyable item ("מישהו מכיר מטען טוב לרכב?") is "ok". It was flaky (2/3 not_product, even in older prompts), which mattered more since off-topic messages now get a warning. Now 3/3 ok, and services, jobs and people are still not_product. eval:query 16/16.
- **Brands, from the owner's brand searches:**
  - Nike, UGG and Starbucks return the real brand.
  - Zara has few items, so fallback_en must always drop the brand ("Zara men clothing" -> "men casual clothing").
  - Titles lose a leading "–".
  - The dedupe key ignores seller filler, so "2025 – מגפי…" and "2026 – מגפי…" are the same product.

## 3l. Max-accuracy round (2026-10-24/25 night): measured, not guessed

- **English vs Hebrew titles for the AI check:** same 15 hard searches, same products, same judge. Hebrew 53/55, English 52/55, so no gain: the photos carry the signal. Kept Hebrew, and removed the experiment.
- **Chinese keywords:** the affiliate search returns unrelated items (a medicine bag for "星巴克杯子"). English keywords stay.
- **The "lottery" in results:** the same request + the same 24 products, 4 runs each.
  - gpt-6-luna averaged 4.4 s and often hit the 5 s timeout, and a timeout shows UNFILTERED results. That was the junk (pajamas for Zara, slippers for UGG).
  - With low reasoning effort, both luna and mini got slower still and timed out.
  - **gpt-5.4-mini (no reasoning): 1.5 s, no timeouts, the most consistent. Now the relevance model** (~$0.003 per search).
- **Short searches:** AliExpress returns 0 for long queries ("merino arm warmers thumb holes"). keywords_en is now 2-4 words, and fallback_en is the core item ("arm warmers"). Examples were fixed: "שרוול מחמם" means arm warmers, "נעליים של UGG" means UGG boots.
- **Brands:** never drop an item for lacking the brand, and merchandise of a namesake person ("Zara Larsson" tees) isn't the brand.
- **Proven first:** products with ≥10 sales lead the card (exact, then partial), and unknown listings only fill in after them.
- **AliExpress glitches:** "resp_code 404: System Error" (seen once, gone on retry) and 5xx are retried once. If the main search still fails, the broader search's results are shown instead of an error.
- Dry run of 8 hard group messages after this round: 31/32 right item (was 10/20 in the luna run).
- Full eval:search with an independent, stricter judge (gpt-5.4): 87% right item, **81% every feature** (best so far), 0/45 with fewer than 4 results, p50 6.2 s, $0.003 per search.

## 3m. Honest cards (2026-10-25, owner approved)

- **"לא מצאתי התאמה מדויקת, אלה הכי קרובים 👇"** under the header when no shown product is an exact match (e.g. Zara, which AliExpress doesn't carry).
- ~~AI-marked repeats ("same" groups)~~ removed the same night: the model merged different products that merely look alike (smartwatches, robot vacuums), and a robot-vacuum search came out empty. The deterministic photo check covers repeats.
- **A better broader search:** fallback_en must be a good standalone search ("men casual shirts", never "clothing" alone).
- **Only what was found:** 3 matching products means exactly 3 on the card, never filled with rejected ones (now locked by a test).
- **Duplicate detection by identical photo (dHash, on):** sellers of one product reuse the same photo. Distance 0 means the same product; different products measured ≥ 24, and the cutoff is ≤ 6. Focused check on the owner's UGG card: 7 listings -> 4 different ones, and the 3 copies in the screenshot collapsed into one. It runs on the top candidates (2× what can be shown), so the card refills; ~0.5 s, no AI cost.
- **UGG on AliExpress:** no real UGG-branded boots in the affiliate catalog ("UGG Australia"/"Tasman": 0 results; "Uggs" in titles is mostly cleaning spray, socks and pins). UGG-style boots without the logo are plentiful. Nike, by contrast, has authentic listings.

## 3n. Step 3 fixes (2026-10-25, ~01:00)

- **Spare parts:** a robot-vacuum search showed bags and brushes. The model kept them as "partial" despite the rule, and also when asked as a separate question. Now a deterministic title check (`isPartFor`) drops parts for the item, unless the shopper asked for parts: "חלקי חילוף", "חלופי", "אביזרים ל…", titles starting with "ל…"/"עבור…" or with a part noun (brush/bag/filter/pads/mop cloth). Phone cases are unaffected. Limit: AliExpress's top robot-vacuum results are mostly parts, so only 1-2 real robots may show (only what was found).
- **No silence on unrelated messages (owner request):** any other group message is classified by the AI. A product gets the "write חפש לי" hint (or a search if the AI fixed a mistyped command). Something unrelated gets the off-topic warning. Exempt:
  - Admins (their posts and deals).
  - Messages with links (shared deals).
  - Replies.
  - The AI being down.

  Each hint kind is limited to once per 10 minutes per user, checked before the AI call. A reply that says "חפש לי" or asks naturally is still searched (locked by a test).

## 3o. Catalog bias fixes (2026-10-25 morning, owner approved)

- **Diagnosis:** the server was awake (/health 0.5 s); the 6-9 s wait is the search itself. Typos: 20/20 right on 5 misspelled searches. The real problem is that AliExpress's best-sellers skew cheap: 42/49 "robot vacuum" results are spare parts, and "picnic basket" returns mostly flower baskets. Sellers also mislabel (a WD8 window robot titled "robot vacuum") and put coupon codes in titles.
- **A: AI price floor** (`floor_price_ils`) for big-ticket items whose cheap listings are parts or toys (robot vacuum -> 200 ₪, e-scooter -> 500 ₪), null for ordinary items. Used only when the shopper gave no price, and passed to AliExpress as the minimum. If it finds nothing, the search reruns without it. Live: robot vacuum went from 1 window robot to 4 real robot vacuums (₪646-901); earbuds get no floor.
- **B: Photo beats title** in the relevance prompt (the window robot titled "vacuum").
- **C: Coupon codes stripped from titles** ("(קוד קופון: HOT888)"), since we can't verify them.
- **Known left:** the same model with different photos and titles (ABIR K30 ×3 in the robot-vacuum card) isn't merged; the photo check only catches identical photos.
- **Pinned group message:** written for the owner (how to search, prices, /advice, buttons, group rules; no affiliate wording).

## 3p. Step 4 fixes (2026-10-25 morning, owner approved)

- **Prices read by code** (`statedPrice`): "עד 30 ש"ח", "עד 20 דולר" (×3.7), "$25", "מתחת ל-50", "בין 80 ל-150", "מעל 100 שקל". Units like kg, m and ml aren't prices. This fills in what the AI missed ("keyboard 20dollar" with no cap), and price words are stripped from keywords_en.
- **Part detection by first word:** a title starting with a part or accessory word (battery, cable, stand, wrist rest, wheel, tire, charger, cover, guard, strap, mount, riser, adapter) is dropped, unless the request names that word (3-letter stem). "סט של 2"/"N יחידות" prefixes are ignored.
- **Brand only:** the AI returns `brand` (a device something is FOR isn't a brand). When a brand is requested and ≥1 exact match is found, partials (other brands) are dropped, even if that leaves 1-2 products.
- **Root cause found:** the in-bot relevance model (gpt-5.4-mini) accepts look-alikes: keyboard-shaped keychains for "keyboard", scooter batteries for "electric scooter", flower baskets for "picnic basket", a window robot titled "vacuum". gpt-5.4 rejected all of them in one test (and was faster: 1.7 s vs 2.0 s), but costs ~$0.008/search vs ~$0.0025. Waiting on the owner's decision.

## 3q. Accurate and cheap (2026-10-25 morning, owner approved)

- **Relevance on gpt-5.4, titles only** (photos only when the request names a color or pattern). In a 6-search test it picked the same products as with photos, rejected the look-alikes mini accepted (keyboard keychains, scooter batteries, flower baskets, a window robot titled "vacuum"), and did it at ~$0.004/search in 1.5 s.
- **One AI call for both searches:** the main and broader searches run together. The pool is the main search's best plus at least a third from the broader one, judged in ONE call. The second relevance call is gone (cost, ~1.5 s).
- **Repeated searches reuse the products for 6 h** (same keywords, price and brand), with no AliExpress or AI cost. `/status` counts them as "♻️ מהזיכרון".
- **Honest failure:** if the AI check fails, nothing is called exact. Products come back as close matches minus spare parts, and the card says "לא מצאתי התאמה מדויקת". Before, it showed unfiltered results as if they were exact.
- **Evals:** the default judge is gpt-5.5 (stronger than the bot's gpt-5.4, so the score isn't self-graded). eval-search prices include gpt-5.4/5.5.
- **Eval after this round (45 searches, independent gpt-5.5 judge): 97% right item (best so far), 82% every feature.** 5/45 had fewer than 4 results (honest: only real matches), p50 5.7 s, $0.0054/search with no cache. One 58 s outlier didn't repeat (8.5 s on rerun).

## 3r. Full test steps 5-7 (2026-10-25 afternoon)

- Step 5 (sensitive) and step 6 (advisor) passed. Step 7 buttons passed ("לחפש עוד?", "אין עוד תוצאות", the memory).
- **"חפש לי כבל" asked "which cable?"** 4/4 times, despite the prompt. A named product the model asks about is now searched directly with the English keywords it already gave. Vague requests (gift/"משהו…"/no keywords) keep the question.
- **Double tap:** the second tap landed on the next question's button ("3 מטר" seemed chosen by itself). A tap within 1.5 s of a question changing is ignored (`doubleTapMs`; tests use 0).
- **Gifts:** the advisor asks the budget within its questions (₪5 necklaces felt like a poor gift for mom).

## 3s. Full test step 8: links (2026-10-25)

- Passed:
  - An s.click link in private, and in the group after a mention, converts to our affiliate link.
  - A plain link in the group gets silence.
- Fixed:
  - A bare web address ("s.click.aliexpress.com", "google.com") was searched as a product, and in the group it got "write חפש לי s.click…". Bare domains now count as links: silence in the group, and in private (or after a mention) a short help, "אני ממיר רק קישורים של מוצרים מעלי אקספרס…", only when the message is basically just a link.
  - AliExpress links pasted without "https://" (with a path) are converted.
- Still untested: an `a.aliexpress.com` link shared from the app.

## 3t. The bot lives in the group (owner decision, 2026-10-25)

- **Private chat:** only the owner (`ADMIN_USER_ID`) is served (/status, tests). Anyone else gets an invitation to the group with a join button. `/myid` stays open, and old private buttons answer "החיפוש עובד בקבוצת פנדה אקספרס".
- **Advisor fully in the group:** callback buttons in the group, requester only, with no deep links and no "continue in private". `continueInPrivate`, `GROUP_HELP` and `ADVICE_EXPIRED` were removed.
- **/start and /help in the group** show the full help (10-minute cooldown per chat). The help text has no private-chat or affiliate wording (the DISCLOSURE line was removed, by owner decision).
- **Same day, stricter (owner):** the bot serves ONLY our group (`OUR_GROUP_ID` -1004397097299 = @panda_deals_il, from getChat; override with `GROUP_CHAT_ID`). Other groups are ignored completely, moderation included. In private nobody is served, the owner included, except `/status` (owner) and `/myid`. Tests run with `groupId: null, privateChat: true`.
- **Advisor:** a "⬅️ חזרה" button goes one question back (a snapshot per answer). The result header lists every choice ("מתנה לאמא · תכשיט · עד 50 ₪"; QUERY_MAX 80). Only the requester can press, as before.
- **Help:** "עזרה", "הסבר", "איך זה עובד?", "איך מחפשים", "מה הבוט יודע לעשות" show the help, with the same 10-minute group limit. The help text is short: the slogan, how to search with one example, "the more details, the more accurate", the gift advisor, the buttons. The link-conversion line was removed.

## 3u. Research round (2026-10-25 evening)

- **Category map** (`npm run eval:categories`, 33 categories × 2 searches, judged by gpt-5.5):
  - gpt-5.4 got 97% right at $0.005/search; gpt-5.4-mini got 91% at $0.0015. Mini equals 5.4 (100%) in 22 categories and is weaker in home appliances, furniture, shoes, watches, hair, kitchen and food. That's the basis for per-category model routing (to confirm with a second run).
  - Weak spots: furniture (60%) and food (AliExpress barely ships food to Israel).
- **Locked APIs:** `product.shipping.get` (delivery to Israel), `sku.detail.get` and `hotproduct.query` answer "InsufficientPermission" (they need Advanced API access, which the owner requests in Portals). The `ds.*` methods need an OAuth access token. The affiliate `product.query` has no stars, review count, delivery time or store rating.
- **Built from the research (owner approved):**
  - Trusted sellers first (≥10 sold AND ≥95% positive feedback).
  - Suspiciously cheap, barely sold items dropped (under ¼ of the matches' median price with <100 sales).
  - A VAT note on items over $75 (≈₪277): "🧾 מעל 75$: יתווסף מע״מ 18% בקופה" (the cap has been back at $75 since June 2026).
  - An empty food search gets an explanation.
  - Gaming chair price floor 250: 4 real chairs, up from 1 cover.
  - The part check's stem is 4 letters ("כיסוי" ≠ "כיסא").
  - The understanding step retries once on failure (2/66 had failed).
- **Keep-awake:** the owner extends it to `*/10 0-2,5-23 * * *` (awake 05:00-03:00 ≈ 682 of 750 h; 24/7 would exceed the shared 750 h and stop every free service until month end).
- **Group check (owner, 20:35):** robot vacuum shows real robots with the VAT note, gaming chairs are real, "עזרה" works, and the advisor shows "⬅️ חזרה" and a full header. Fixed afterwards:
  - "חפש לי מוצר למטבח" searched right away; "מוצר/ציוד/אביזרים" now count as vague, so the bot asks.
  - "מבטח" was read as security; the AI now considers two swapped letters ("מבטח" -> "מטבח").
- **Known:** the same model with different photos and titles (ABIR K30 ×2) isn't merged. Merging by model code alone would join different products (IP68, USB3…).

## 3v. Root causes from the owner's group test (2026-10-29)

- **Weak understanding:** the request-understanding model (gpt-5.4-nano) wrote bad search words on anything non-trivial: "מאצה" became matzo/bread kit, "ערכת…" lost the "kit" ("matcha" alone finds cardigans in a matcha color), "קלאפר" became a brand. All understanding, advisor and explainer calls now use **gpt-5.4-mini**: 9/9 right in ~1 s, ~$0.0015 per new request (cached 24 h). The prompt also says to keep the item's noun and kind, and that an unknown word is a product, not a brand. Live recheck: 22/26 right (matcha set 4/4, green screen 4/4, clapperboard 3/3, probe thermometer 4/4).
- **"תחפש כבר" before any answer** searched the raw Hebrew request (no results). The advisor session now carries the AI's English keywords.
- **Non-search group messages:** one fixed message, "🐼 כאן מחפשים מוצרים מעלי אקספרס. כתבו "חפש לי"…", with no AI call. Once per 10 minutes per user; admins, links and replies exempt.
- **Server slept** at 11:06 despite the cron window (21 s to wake). The server now pings its own /health every 10 minutes within 05:00-03:00 (`isAwakeHour`). The owner should check that the cron-job.org job is still enabled (failed runs on cold start can disable it).
- **Known left:** Gucci shoes (AliExpress has none) falls back to cheap slippers, shown with the "no exact match" note. Very specific requests (car-shaped alarm clock with engine sound under ₪70) may find nothing. One webhook 500 on 26.10 22:12 (no logs here).
- **Nightly digest (owner request):** at 02:30 Israel time, before the nightly sleep resets memory, the owner gets a private summary: searches, no-results, cached, 🎯/🐼/more since the last digest, and the searches that got 🐼. A weekly report isn't possible without a database, since memory resets each night and on each deploy. Clearing the cache on 🐼 was dropped (owner).
- **Cost after the understanding upgrade:** ~$0.0066 per search, up from ~$0.0055 (+20%; understanding ~$0.0015 per new request, relevance ~$0.005), before the 6 h results memory.

## 3w. 50-persona simulation (2026-10-29, `npm run eval:personas`)

50 different "members" write to the real bot (real AI + AliExpress), and gpt-5.5 judges each card.
- **Before the fixes**, among the failures:
  - English/Russian/Arabic speakers got the "write חפש לי" hint.
  - "חפשליאוזניות" went unrecognized; "וייפ" was searched, not refused.
  - Adjustable desk, PS5 controller, Chanel bag and pacifier found nothing.
  - Men's down coat and e-bike showed 1 product; "two products in one message" got 1/4 right.
- **Root cause of the empty searches:** AliExpress's best-seller order buries the real item under accessories that sell more (desk -> phone stands, PS5 controller -> thumb grips, pacifier -> clips). The real ones sit on page 2 or in AliExpress's relevance order.
- **Fixes:**
  - The main words now fetch 3 lists in parallel (best-sellers, page 2, relevance), each ranked and mixed round-robin into a 36-title AI pool, ~$0.006 per check on gpt-5.4 titles.
  - More price floors (desk 150, controller 60, e-bike 1200).
  - Triggers in English/Russian/Arabic ("find me", "найди мне", "ابحث لي عن"), and fully glued "חפשלי…".
  - Blocked words win even when the AI says ok.
- **After:** foreign languages, luxury brand (3/3), furniture, PS5, coat (4/4), glued and combined requests all work. Still weak: pacifier (no results), cat toys (2/4), e-bike (2/4). Some cards show 2-3 products (only real matches). Latency p50 ~7 s, a few at 12-15 s.

## 3x. Second chance + faster links (2026-10-29 noon)

- **Second wording:** the AI returns `alt_en` (another seller-style wording). If the first pass finds fewer than 4 matches, the bot searches `alt_en` (2 lists) and checks only the new candidates in one more AI call. That happens only on weak searches.
- **Parts rule:** e-bike conversion kits, batteries and motors, and pacifier clips, aren't the item.
- **Emoji alone** is the product it shows.
- **Links shortened only for shown products:** searches pass `shorten:false`, and `shortenLinks` runs on the ≤12 products a card can use. That's ~1 s and 3 AliExpress calls fewer per search (measured: link.generate adds ~0.9-1.1 s per list).
- **eval:personas after:** pacifier 4/4 (was nothing), e-bike 4/4 (was 2/4), desk 4/4, PS5 4/4, 12V screwdriver 4/4, emoji 3/4, cat toy 3/4. Russian shows correct iPhone 15 cases (the judge scores 0 because it reads the Russian request). Still weak: a Fortnite skin request (not a physical product) got a wrong 1-item card. Two outliers took 18-24 s (second chance + slow AliExpress).
- **Virtual items** (game skins, game coins, digital codes, gift cards, subscriptions, apps) are `not_product` ("סקין לפורטנייט", "כרטיס מתנה לאמזון"). Plain-ASCII requests skip the AI, so "V-Bucks" is still searched.
- **Second-chance budget:** the extra wording runs only if the search took under 7 s so far (avoids the 18-24 s outliers on slow AliExpress days).

## 3y. Second 50-persona set (2026-10-29, `npm run eval:personas -- --set 2`)

A new set of 50 edge cases (number words, "הכי זול", negation, model numbers, abbreviations, transliterated brands, quantities, cm sizes, feminine/plural verbs, urgency, slang, complaints, Amazon links, phone numbers, Spanish, mixed Arabic, final-letter typos, tripled letters, extra spaces, newlines, costumes, fishing, garden, health, medicine, toy guns, lingerie, specific car models). Most passed. Fixed:
- Leading words before the command: "דחוף!!!", "אחי", "יאללה", "חברים", and a mention ("היי @בוט תמצא לי…").
- Tripled letters ("חפששש").
- "חכה לדייג" was read as "wait" and is now a fishing rod.
- Negated features ("לא שקוף") count against matches.
- A broken AI header with CJK characters (seen on an Arabic request) falls back to the shopper's words.
- Novelty/prank versions (mustache pacifiers) are partial unless asked, so regular items come first.

Live recheck of the fixed cases: 31/32 right. Honest few-item cards remain for bridal dresses, classical guitars and car-model seat covers (2 each).

## 3z. Market check + cheapest first (2026-10-29)

- **Market (quick):** WebDigital builds similar custom bots (4 products, ChatGPT). Others convert links (Affiracle), track prices (@aliexpress_price_bot), sort by discount (@discount_livebot) or do coupons and seller analysis (AliSmart). Ours leads on Hebrew understanding, per-product AI relevance, honesty, the group advisor and Israel specifics (VAT, ₪). Gaps: coupons, delivery time (need Advanced API), price-drop alerts and price history (need a database), sort options.
- **"הכי זול" / "הזול ביותר" / cheapest** (also Russian/Arabic) shows the matches cheapest first, exact before partial. The quality filters still apply.


## 4a. Head-to-head with "דילים AI - בוב" + better picking (2026-10-29)

- **Comparison** on the owner's 9 searches against a competing group bot (19k members): before, Bob won 5, we won 1, 3 ties. The right products were in our AliExpress pool; our picking and titles lost.
- **Relevance:** a feature counts only if the item really has it ("ergonomic" = vertical/trackball/contoured); "for <device/brand>" is exact only if the title names it; commercial versions are partial for home shoppers.
- **Ranking:** an exact match that sold at least once now comes before a popular close match. A brand search keeps that brand's close items and drops other brands.
- **Short Hebrew names:** the cheap model rewrites the shown products' titles (≈0.1¢, in parallel with link shortening). Each bad label falls back to the seller title.
- **Second-chance wording keeps the brand**; appliance price floors (microwave 150, fridge 400, washer 500, AC 600, coffee machine 120).
- **Owner cost line:** the nightly digest and /status show the day's AI cost and cents per search. "מצא ךי" is a trigger.
- eval:search after: 100% right item (was 97%), 87% every feature, p50 5.9 s, $0.0082 per search.
