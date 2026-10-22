# Panda Deals bot — status

Bot: `@panda_ali_deals_bot` · Last updated: 2026-10-22 · Research and roadmap: [research.md](research.md)

## 1. Current state

- **Code:** Phase 1.1. Commits: `233a220` (MVP), `8518425` (research fix + roadmap), `2fe940d` (this file), then the Phase 1.1 commit (group trigger fixes + photo result card). Local git only, no remote.
- **Tests:** 59/59 pass (`npm test`, no token, no network).
- **`.env`:** `BOT_TOKEN` and `ALI_TRACKING_ID` filled. `ALI_APP_KEY` and `ALI_APP_SECRET` empty, so the bot runs in **mock mode** (`[דמו]` products, fake links).
- **Telegram:** privacy mode OFF in BotFather. The bot was removed and re-added to the test group after the change.
- **Runtime:** local only (`npm start`, long polling). No hosting yet.
- **AliExpress:** the Open Platform app is pending approval. No API keys yet.

## 2. Live test results

Phase 1 (text format, old triggers). **Phase 1.1 is not live-tested yet.**

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
- Caption: header `🔎 <b>query</b>` (+ ` [דמו]` in mock mode only). Each product has:
  - a medal + title line (one line, ≤ 40 chars, cut at a word boundary)
  - `💰 <b>₪39.90</b>  <s>₪69.90</s>  🔥 43%-`; the original price and badge appear only for 5% ≤ discount < 80%
  - `⭐ 4.8 (1,234 ביקורות)` or `👍 97% משוב חיובי`, then `· 🛒 5,200+ נמכרו לאחרונה`; the line is dropped if both are missing
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
| 2 | AI query parsing + relevance filter (fail-open), AI short Hebrew titles, trust score (Wilson/Bayesian), IQR price sanity, Hebrew trigger variants (תחפש / חפשו; מצא לי is done) |
| 3 | sharp 2×2 collage (replaces the single photo), "עוד" pagination / reply-to-bot actions, grammY runner / ratelimiter / auto-retry, lru-cache |
| 4 | Advanced API, DS API (real source for `avgStars` / `reviewCount`), image search |

Kept as is on purpose: edited messages are ignored (this avoids double replies).

**Why deferred:** we first verify the real Affiliate API data on the simple text format, which already meets "one message per search".

**Flag:** if the first real results show spammy machine-translated Hebrew titles, AI short titles may move up to early Phase 2. Not decided.

## 4. Decisions log (closed)

- **Stack:** Node.js ESM + Express + grammY. `ae_sdk` not used (v0.6.0, last published 2025-03-30); own signing with tests.
- **Triggers (Phase 1.1):** `/search`, `/search@bot`, `חפש לי`, `מצא לי`, `@bot`, all only at the start of the message. Bare `חפש` was removed. Private chat: any text is a search. Group chatter, a mid-message mention and plain links: silence.
- **Stars / review counts:** never scraped, and the undocumented feedback endpoint is not used. Their source will be the DS API (the owner's call).
- **Disclosure:** none on cards or link replies (owner decision); the full sentence only in private `/start`.
- **Group access:** privacy mode OFF (not admin).
- **Logs:** no message text, no user names.
- **Location:** `~/Desktop/panda-ali-bot`, local git only.
- **Reviewer findings rejected:**
  - #5 (`resp_code 405` on empty results): verify live.
  - #6 (a local run deletes the server webhook): use a separate test bot.
- **API applications:** none made on the owner's behalf. Advanced API and DS API are the owner's call, later.
- **Hosting:** Railway is the candidate, after real keys work.

## 5. Keys-day checklist

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
