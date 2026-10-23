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
