# Telegram group product-search bot (grammY / Node.js): Telegram side, collage, photo search, hosting, caching, compliance

Research date: 2026-10-22. Current Bot API version on core.telegram.org: **Bot API 10.3 (August 24, 2026)** — [Telegram Bot API](https://core.telegram.org/bots/api).

## 1. Telegram Bot API limits and features relevant to "one collage + ranked list" replies

### Takeaway
A single `sendPhoto` (the 2x2 collage) caps the caption at 1024 characters after entity parsing. A ranked list of 4 products with titles, prices and links will often overflow that. The two realistic designs are (a) a short caption plus an inline keyboard of URL buttons (one per product), or (b) a photo plus a separate text message (4096 chars). Both are sent as a reply via `reply_parameters`. In a group, the hard limit is 20 bot messages per minute, so each search should cost 1 message (or at most 2).

### Cited Findings
- `sendPhoto` caption: "0-1024 characters after entities parsing". Photo must be at most 10 MB, width + height must not exceed 10000 in total, and the width/height ratio must be at most 20 — [Bot API](https://core.telegram.org/bots/api)
- `sendMessage` text: "1-4096 characters after entities parsing" — [Bot API](https://core.telegram.org/bots/api)
- `sendMediaGroup` albums "must include 2-10 items". Supported types are photos, live photos, videos, documents and audios — [Bot API](https://core.telegram.org/bots/api)
- `ReplyParameters` fields: `message_id`, `chat_id`, `allow_sending_without_reply` (send even if the replied-to message is not found), `quote`, `quote_parse_mode`, `quote_entities`, `quote_position`, plus newer `ephemeral_message_id`, `checklist_task_id`, `poll_option_id` — [Bot API](https://core.telegram.org/bots/api)
- `show_caption_above_media`: when True, the caption is shown above the media — [Bot API](https://core.telegram.org/bots/api)
- `InlineKeyboardButton.url`: "HTTP or tg:// URL to be opened when the button is pressed". `InlineKeyboardMarkup.inline_keyboard` is an array of button rows — [Bot API](https://core.telegram.org/bots/api)
- `LinkPreviewOptions`: `is_disabled`, `url` (defaults to the first URL in the text), `prefer_small_media`, `prefer_large_media`, `show_above_text` — [Bot API](https://core.telegram.org/bots/api)
- HTML parse mode supports only these tags: `<b>/<strong>`, `<i>/<em>`, `<u>/<ins>`, `<s>/<strike>/<del>`, `<tg-spoiler>`, `<a href>`, `<tg-emoji>`, `<tg-time>`, `<code>`, `<pre>`, `<blockquote>`, `<blockquote expandable>`. Every `<`, `>` and `&` outside a tag must be escaped as `&lt; &gt; &amp;`. Only those named entities plus `&quot;` are supported (all numeric entities work) — [Bot API](https://core.telegram.org/bots/api)
- `sendChatAction`: "The status is set for 5 seconds or less". Actions include `typing` and `upload_photo` — [Bot API](https://core.telegram.org/bots/api)
- Flood limits from the FAQ: in a single chat, "avoid sending more than one message per second". In a group, bots are not able to send "more than 20 messages per minute". Bulk broadcasting is limited to about 30 messages per second, and exceeding it returns 429 — [Bots FAQ](https://core.telegram.org/bots/faq)
- Paid broadcasts allow up to 1000 msg/s at 0.1 Stars per message beyond the free 30/s. The FAQ requires at least 100,000 Stars and 100,000 MAU — [Bots FAQ](https://core.telegram.org/bots/faq). This conflicts with grammY's docs, which cite 10,000 Stars — [grammY flood](https://grammy.dev/advanced/flood). Not relevant to group replies.
- Privacy mode: with privacy mode enabled, a bot in a group receives only commands explicitly for it (e.g. `/command@this_bot`), general commands if it was the last bot to post, messages sent via the bot, and **replies to its own messages**. With privacy mode disabled, or as an admin, it receives all messages except those from other bots — [Bots FAQ](https://core.telegram.org/bots/faq)
- `Message.photo` is an array of `PhotoSize` objects (one per available size), each with `file_id`, `file_unique_id`, `width`, `height` and optional `file_size`. `caption` and `caption_entities` carry text and commands attached to media — [Bot API](https://core.telegram.org/bots/api)
- A webhook and long polling are mutually exclusive: "it's not possible to get updates via long polling while an outgoing Webhook is set" — [Bots FAQ](https://core.telegram.org/bots/faq)

### Inferences
- **Recommended layout:** one `sendPhoto` with `reply_parameters: { message_id, allow_sending_without_reply: true }`. Put a compact ranked list in the caption (number, short Hebrew title truncated to about 40 chars, price) and attach an inline keyboard with 4 URL buttons ("1 · ₪45" and so on), or 2 rows of 2. URL buttons keep long affiliate links out of the 1024-char caption budget. This costs 1 message per search, so a group can absorb about 20 searches per minute before throttling.
- Prefer a single collage over `sendMediaGroup`. An album of 4 counts as several messages toward the 20/min group limit (this is how Telegram is widely understood to count albums, but I found no official statement). Album captions also show only on one item, and albums can't carry an inline keyboard.
- **Photo search under privacy mode:** a plain photo posted to the group is not delivered to the bot. Practical triggers are a reply to the bot's message, a photo whose caption contains `/find@botname`, or a command sent as a reply to a photo (`/find` replying to someone's photo; the bot then reads `reply_to_message.photo`). The alternative is to disable privacy mode or make the bot an admin. That means receiving every message, which raises the data-minimization obligations under Telegram's developer ToS (section 5).
- **Hebrew/RTL:** Telegram clients pick paragraph direction from the first strong character. A caption that starts with a digit or a Latin brand name ("1. Xiaomi ...") may render LTR. Starting each line with a Hebrew word, or a Right-to-Left Mark (U+200F), is the common workaround. This comes from general Unicode bidi behavior; I found no Telegram-official doc on it.
- Prices like `₪45.90` and Latin model numbers embedded in Hebrew lines can reorder visually. Isolating them (U+2066–U+2069 isolates, or putting the price at line end) reduces scrambling. This needs testing on iOS, Android and Desktop.
- Keep `link_preview_options: { is_disabled: true }` on any text message with AliExpress links. Otherwise the first link generates a large preview that competes with the collage. Previews don't apply to photo captions.
- Send `upload_photo` via `sendChatAction` immediately, and re-send every about 4 s while the search and collage run, since it expires after 5 s.

### Gaps
- No official Telegram statement found on how many "messages" a media group counts as toward the 20/min group limit.
- No official Telegram doc on bidi/RTL rendering of mixed Hebrew/Latin captions. Needs empirical testing.
- I did not verify whether URL buttons on group messages count against any limit, or the maximum number of buttons; none was stated in the sections read.

## 2. Generating a 2x2 collage with number badges in Node.js

### Takeaway
Use **sharp** (libvips). Resize 4 fetched product images to e.g. 400x400 tiles, `composite()` them onto a `create` canvas of 800x800, and overlay number badges as small SVG or `text` inputs. Output JPEG at quality about 80 (typically well under 200 KB; this is an estimate). Jimp is far slower. @napi-rs/canvas (Skia) suits rich drawing, but is unnecessary for digits-only badges.

### Cited Findings
- sharp `composite()` accepts Buffer/file inputs, `create` (blank canvas with width, height, channels, background), `text` (with `font`, `fontfile`, `width`, `align`, `dpi`, `rgba`), and `raw` inputs. Placement is by `top`/`left` (which take precedence over `gravity`), with blend modes and a `density` option "for vector overlay image" — [sharp composite docs](https://sharp.pixelplumbing.com/api-composite)
- sharp `text` input "can contain Pango markup". `rgba: true` is "useful for colour emoji rendering" — [sharp composite docs](https://sharp.pixelplumbing.com/api-composite)
- Resize ops are applied to the base image before composition. The default `limitInputPixels` is 268402689 — [sharp composite docs](https://sharp.pixelplumbing.com/api-composite)
- Informal 2020 benchmark: resizing about 41 MB of images took about 28 s with Jimp versus about 1.3 s with sharp — [Peter Bengtsson, sharp vs jimp](https://peterbe.com/plog/sharp-vs-jimp). sharp publishes its own benchmark including jimp (vendor-run) — [sharp performance](https://sharp.pixelplumbing.com/performance)
- I found no benchmark comparing @napi-rs/canvas directly to sharp. The only one found compares it with skia-canvas and node-canvas — [@napi-rs/canvas on yarn](https://classic.yarnpkg.com/en/package/@napi-rs/canvas)

### Inferences
- Pipeline: fetch 4 image URLs in parallel (`Promise.allSettled`, about 3 s timeout each, fall back to a grey placeholder tile on failure). Then `sharp(buf).resize(400,400,{fit:'cover'})` per tile, then `sharp({create:{width:800,height:800,channels:3,background:'#fff'}}).composite([...tiles, ...badges]).jpeg({quality:80})`. Send the resulting Buffer directly via grammY `new InputFile(buffer)`. No disk I/O is needed.
- **Badges:** a 64x64 SVG circle with a digit (`<svg><circle/><text>1</text></svg>`) composited at each tile's top-right corner (on the right side for an RTL reading order). Digits avoid any Hebrew shaping issue. If Hebrew text is ever needed in the image, sharp's `text` input uses Pango, which handles bidi and shaping, but you must ship a Hebrew-capable font file (e.g. Noto Sans Hebrew, Heebo) via `fontfile`. Minimal Docker images lack Hebrew fonts.
- **Reading order for Hebrew users:** number tiles right-to-left (1 top-right, 2 top-left, 3 bottom-right, 4 bottom-left), matching the RTL list order.
- **AliExpress thumbnails:** AliExpress CDN URLs (ae01.alicdn.com) commonly accept size suffixes like `_220x220.jpg` or `_350x350.jpg`, and a trailing `_.webp`, to get a smaller resized variant. Requesting about `_350x350.jpg` (or the closest available size) reduces download time. sharp decodes WebP natively. This is not verified from an official source; see Gaps.
- At 800x800 JPEG, the output is far below Telegram's 10 MB photo limit. Telegram recompresses photos anyway, so higher quality settings add little.
- sharp ships prebuilt binaries for linux-x64/arm64, which works on Railway, Fly, Render and VPS. Jimp avoids native deps but is about 20x slower per the benchmark above.

### Gaps
- No authoritative documentation found on the AliExpress/alicdn image resizing suffixes (`_220x220.jpg_.webp`). Behavior is empirical; test which sizes return 200 rather than 404.
- No measured latency for a 4-tile sharp composite was found. My estimate is tens of milliseconds on a small VM, dominated by image download time, but this is unmeasured.

## 3. Photo-based search flow (getFile → vision LLM)

### Takeaway
Take the largest `PhotoSize` that is at most about 1000 px, `getFile` it (the link is valid at least 1 hour, files up to 20 MB), download the bytes, and send them base64 (or by URL) to a cheap vision model. The model returns a short English/Chinese search query plus a category, which then drives the normal keyword search. At these image sizes, cost per photo search is a fraction of a US cent on Gemini Flash-Lite or Claude Haiku. Do not pass the raw `api.telegram.org/file/bot<token>/...` URL to a third-party LLM, because it contains the bot token.

### Cited Findings
- `getFile`: bots can download files up to 20 MB. The download link format is `https://api.telegram.org/file/bot<token>/<file_path>`, and "It is guaranteed that the link will be valid for at least 1 hour" — [Bot API](https://core.telegram.org/bots/api); [Bots FAQ](https://core.telegram.org/bots/faq)
- Gemini paid pricing per 1M tokens: 2.5 Flash-Lite at $0.10 input / $0.40 output, 2.5 Flash at $0.30 / $2.50, 3.1 Flash-Lite at $0.25 / $1.50. All have free tiers, and batch pricing is 50% lower — [Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing)
- Gemini image tokens: an image with both dimensions at or below 384 px costs 258 tokens. Larger images are tiled into 768x768 tiles of 258 tokens each. The inline request limit is 20 MB, and JPEG, PNG, WEBP and HEIC are supported — [Gemini image understanding](https://ai.google.dev/gemini-api/docs/image-understanding)
- Claude vision: tokens = ⌈w/28⌉×⌈h/28⌉. A 1000x1000 image is 1,296 tokens, a 200x200 image is 64 tokens. At Claude Haiku 4.5's $1 per million input tokens, a 1000x1000 image costs about $1.30 per thousand images. Images can be sent by base64, URL or Files API. Max 10 MB per image on the direct API. Supported formats are JPEG, PNG, GIF and WebP. Accuracy degrades for very small images under 200 px — [Claude vision docs](https://platform.claude.com/docs/en/build-with-claude/vision)

### Inferences
- Telegram's `Message.photo` array always includes several sizes. Choosing a mid-size (around 800 px long edge) balances recognition and cost. A 1024x768 photo is roughly 4 Gemini tiles (about 1k tokens), costing about $0.0001 on 2.5 Flash-Lite, or about 1,000 Claude tokens (about $0.001 on Haiku 4.5). These are my calculations from the cited rates.
- Ask the model for strict JSON (`{query_en, query_he, category, confidence}`) with a small `max_tokens` (about 100). Output cost is then negligible and latency is dominated by the model round trip (typically 1–3 s for Flash-class models; not measured here).
- Download the file server-side and send base64 so the bot token never leaves your server. Cache by `file_unique_id` so a re-posted photo doesn't trigger a second LLM call.
- With a photo caption like `/find@bot`, or a reply to a photo, grammY's `ctx.msg.photo ?? ctx.msg.reply_to_message?.photo` covers both trigger styles.
- AliExpress also has its own image-search capabilities (third-party scrapers advertise "search by image") — [Apify AliExpress Image Search](https://apify.com/bokgoon/aliexpress-image-search/api). Whether the official Affiliate API exposes image search is out of my scope and unverified.

### Gaps
- No measured end-to-end latency figures for Gemini Flash-Lite or Claude Haiku vision calls were found in official sources.
- OpenAI vision pricing was not checked.

## 4. Group etiquette, anti-abuse, concurrency

### Takeaway
grammY's official guidance is: don't pre-throttle outgoing calls. Install `@grammyjs/auto-retry` to honor 429 `retry_after`, and use `@grammyjs/ratelimiter` (or a hand-rolled per-user cooldown) to drop spammy incoming requests. Because `bot.start()` processes updates sequentially, use grammY runner (or fire-and-forget with a concurrency cap) so one slow search doesn't block the whole group.

### Cited Findings
- auto-retry intercepts failed API calls with `retry_after`, waits and retries. It also retries 5xx and network errors with exponential backoff (starting at 3 s, capped at 1 h). Options are `maxRetryAttempts`, `maxDelaySeconds`, `rethrowInternalServerErrors` and `rethrowHttpErrors`. Install with `bot.api.config.use(autoRetry())` — [grammY auto-retry](https://grammy.dev/plugins/auto-retry)
- grammY on flood limits: "hitting rate limits does not lead to bans. Ignoring them does." It advises against artificial delays. Send as fast as possible and let auto-retry handle 429s. It notes the 20 msg/min group limit and about 1 msg/s per chat with short bursts allowed — [grammY flood limits](https://grammy.dev/advanced/flood)
- ratelimiter limits incoming updates per user (`from.id` by default). Defaults are `timeFrame` 1000 ms and `limit` 1. `keyGenerator` can key by `chat.id`. `onLimitExceeded` can reply with a warning and runs at most once per timeframe. The default store is in-memory, with Redis optional for clusters — [grammY ratelimiter](https://grammy.dev/plugins/ratelimiter)
- `bot.start()` long polling "processes all updates sequentially". For concurrency, grammY points to the runner plugin — [grammY deployment types](https://grammy.dev/guide/deployment-types)
- Telegram developer ToS 5.2(b): "Your TPA must not harass or spam users with unsolicited messages". 5.2(f): it "must not attempt to circumvent or otherwise undermine Telegram rate limits and moderation" — [Telegram Bot Developer ToS](https://telegram.org/tos/bot-developers)

### Inferences
- **Per-user cooldown:** ratelimiter's default of 1 request/second is too permissive for a search bot. Something like `limit: 3, timeFrame: 60_000` per user, plus a per-group budget of about 15 searches per minute (leaving headroom under 20/min), suits a busy group. Use `onLimitExceeded` to send one short Hebrew notice ("רגע, אפשר לחפש שוב בעוד דקה ⏳"), at most once per window, so the notice itself doesn't eat the 20/min budget.
- **Concurrency:** use `@grammyjs/runner` (`run(bot)`) for parallel updates, or keep `bot.start()` but don't `await` the heavy search in the handler. Either way, cap total in-flight searches (e.g. p-limit 5) to protect the AliExpress API quota and RAM.
- **Error UX:** on failure, reply once in Hebrew with a friendly message and no stack traces. Log the error with chat_id/user_id hashed.
- **Cleanup:** optionally delete the bot's own "searching…" placeholder (if used) after the result arrives. A cleaner pattern is no placeholder and only `sendChatAction('upload_photo')`. Deleting other users' messages requires admin rights.
- **Admin commands:** `/stats`, `/pause`, `/resume` (per chat) and `/cooldown N`, gated by checking `getChatMember` status `administrator`/`creator`, or a hard-coded owner user ID from an env var.
- Register a `bot.catch()` global error handler so one bad update doesn't crash the polling loop.

### Gaps
- I did not fetch the grammY runner or transformer-throttler pages. Runner's `sequentialize` behavior for per-chat ordering is not cited here.

## 5. Hosting a long-polling bot 24/7 cheaply (2025–2026 pricing)

### Takeaway
A long-polling grammY bot needs one always-on small process (256–512 MB RAM) and no public URL. The cheapest dependable options as of October 2026:
- **Fly.io** shared-cpu-1x: about $2.19/mo at 256 MB or $3.69/mo at 512 MB in the cheapest US regions, with no free tier.
- **Railway Hobby:** $5/mo including $5 usage. A small idle bot fits inside it.
- **Hetzner VPS:** about €5.49/mo for CX23 after the 2026 price increases, with availability problems reported.

Render's free tier is unsuitable: background workers aren't free, and free web services spin down after 15 minutes without inbound traffic. Koyeb's free tier now requires a card and its future is uncertain after the Mistral acquisition.

### Cited Findings
- **Railway:** Free Trial gives a $5 one-time credit (30 days). The Free plan is $0 with $1/month usage (1 vCPU / 0.5 GB max per service). Hobby is $5/mo including $5 usage (7-day logs). Pro is $20/mo including $20. Usage rates are about $10 per GB-RAM-month, about $20 per vCPU-month and $0.05/GB egress, billed per second — [Railway pricing](https://railway.com/pricing)
- **Fly.io:** "New organizations don't have a free tier or a monthly free usage allowance". The trial is up to 2 hours of machine runtime or 7 days. shared-cpu-1x always-on costs $2.19 (256 MB), $3.69 (512 MB) and $6.70 (1 GB) per month in iad/ewr, more in other regions (1 GB is $7.73 in fra). A dedicated IPv4 is $2/mo; shared IPv4 and IPv6 are free. Egress is $0.02/GB in North America and Europe — [Fly.io pricing](https://docs.fly.io/about/pricing)
- **Render:** free instances are available for web services, Postgres and Key Value. "Other service types don't support Free instances" (i.e. no free background workers). A free web service spins down after 15 minutes without inbound traffic. The workspace gets 750 free hours per month. Render "might restart a Free web service at any time" — [Render free docs](https://render.com/docs/free)
- **Koyeb:** the current pricing page lists Pro at $29/mo plus compute, and no free compute instance appears on it — [Koyeb pricing](https://www.koyeb.com/pricing). Mistral AI agreed to acquire Koyeb on 17 Feb 2026. Koyeb reportedly now requires a card ($29 pre-auth hold) and keeps one free web service per org — [SnapDeploy (competitor; potential bias)](https://snapdeploy.dev/state-of-free-hosting). A Kuberns blog claims the free tier closed to new users — [Kuberns](https://kuberns.com/blogs/koyeb-alternatives/). These sources conflict.
- **Hetzner:** CX23 (2 vCPU / 4 GB / 40 GB / 20 TB) was €3.49, then €3.99 from 1 April 2026, then reportedly €5.49 for new orders from 15 June 2026 in DE/FI. CX/CAX lines were shown as "Currently not available" on 17 Aug 2026. IPv4 is about €0.50/mo extra — [privatedevops](https://privatedevops.com/news/hetzner-june-2026-cloud-price-increase-what-to-do); [wz-it](https://wz-it.com/en/blog/hetzner-price-increase-june-2026-cpx-ccx-alternatives/); [findstack](https://findstack.com/resources/hetzner-price-increase-2026). These are secondary sources.
- **Polling vs webhook:** grammY recommends long polling unless you have a specific reason. Polling needs no public URL or SSL. Webhooks are cheaper and allow scale-to-zero on serverless. With webhooks, `webhookCallback` has a 10 s default timeout, and long-running middleware causes Telegram to re-send updates (duplicates), so long work should go to a queue — [grammY deployment types](https://grammy.dev/guide/deployment-types)

### Inferences
- **Recommendation:** Railway Hobby ($5 flat in practice) for easiest deploy-from-GitHub, env-var UI, logs and auto-restart. Fly.io (about $2–4/mo) is cheapest if you're comfortable with `fly.toml` and a Dockerfile. A VPS (Hetzner or similar) is cheapest per resource but you manage pm2/systemd, updates and security yourself.
- Avoid webhooks on serverless (Vercel/Netlify functions) for this bot. A photo search with an LLM call, 4 image downloads and a sharp composite can exceed the 10 s webhook window and cause duplicate replies.
- **Only one instance may poll a bot token.** Two replicas (or a rolling deploy overlap) produce `409 Conflict: terminated by other getUpdates request`. Set replicas to 1, and on SIGTERM call `bot.stop()` (or `runner.stop()`) so the new deploy takes over cleanly. This is my inference from Telegram's single-consumer getUpdates model; the shutdown pattern is standard grammY practice but not cited above.
- **Secrets:** keep `BOT_TOKEN`, the AliExpress app key/secret, tracking ID and LLM API key in platform env vars, never in the repo. Rotate the bot token via @BotFather if it leaks.
- **Logging:** structured JSON logs to stdout (pino). Railway Hobby keeps 7 days and Free 3 days — [Railway pricing](https://railway.com/pricing). Add a daily summary message to the owner's private chat for monitoring.

### Gaps
- Render's paid background-worker price was not retrievable (the pricing page rendered without figures).
- Koyeb's current free-tier status is unverified against its own docs.
- Hetzner's live pricing and availability for new orders were not confirmed on hetzner.com directly.

## 6. Caching search results and simple stats

### Takeaway
For a single-instance bot, an in-memory LRU with a TTL (e.g. `lru-cache`, 15–60 min, a few thousand entries) is enough and costs nothing. Redis only becomes worthwhile with multiple instances or if you want the cache to survive restarts. Store stats in SQLite (on a volume) or a free Postgres. Telegram's ToS requires minimizing and deleting user data.

### Cited Findings
- grammY ratelimiter's default MemoryStore "suits most bots". Redis is only needed for clustered bots — [grammY ratelimiter](https://grammy.dev/plugins/ratelimiter)
- Telegram developer ToS 4.3: don't "collect, store, aggregate or process data beyond what is essential". 4.2(b): delete user data "when retention thereof becomes unnecessary". 4.4(a): user data must be "encrypted at rest and stored separately from its encryption key". Section 4: a privacy policy must be "easily accessible to their users" — [Telegram Bot Developer ToS](https://telegram.org/tos/bot-developers)
- Railway volumes cost about $0.15/GB-month — [Railway pricing](https://railway.com/pricing). Render offers free Postgres and Key Value instances — [Render free docs](https://render.com/docs/free)

### Inferences
- Cache key: normalized query (lowercase, trimmed, Hebrew→English translation result) and sort mode, with a value of the top-N product objects and the rendered collage's Telegram `file_id`. After the first send, re-sending the same collage by `file_id` is instant and needs no re-upload. Prices change, so keep the TTL short (about 30 min).
- Photo searches can be cached by `file_unique_id`.
- **Stats:** count searches per day per chat, plus top queries and click-through if you use your own redirect, which is optional. Store chat IDs, not user names. Hash user IDs if they're needed for per-user caps. This keeps you within ToS 4.3's data minimization.
- Use BotFather's standard privacy policy if it fits, or publish a short Hebrew privacy page linked from `/start` and `/privacy`.

### Gaps
- No benchmark comparison of LRU versus Redis for this workload. The choice is architectural, not performance-driven at this scale.

## 7. Legal and compliance: Israeli affiliate disclosure, AliExpress terms, Telegram ToS

### Takeaway
Israeli law requires paid or compensated promotional content to be marked clearly and prominently, in Hebrew, at first view, without further action. Affiliate commissions plausibly count as compensation, so every result message should carry a short disclosure like "קישורי שותפים – ייתכן שנקבל עמלה". Telegram's developer ToS bans unsolicited spam and requires a privacy policy. I could not retrieve AliExpress Portals' official traffic-source rules; third-party listings conflict on whether social media and messaging traffic is allowed.

### Cited Findings
- Per an Attorney General opinion described by Barnea Jaffa Lande lawyers (Calcalist, 5 June 2023): in paid publicity, the advertiser and endorser must make clear, explicitly and unambiguously, in Hebrew for an Israeli audience, that it is an ad. The disclosure must be prominent at first view, without requiring further action. Otherwise the content may be considered misleading under the Consumer Protection Law. The rule covers not just payment but benefits such as free products and discounts. Exposure is mainly class actions. The article does not specifically address commissions — [Calcalist](https://www.calcalist.co.il/local_news/article/r1i11ewsin)
- The Consumer Protection and Fair Trade Authority drafted guidelines for endorsers (ממליצים) that were open to public comment, with sanctions under law for violators. The article's date and final status are unclear — [ynet](https://www.ynet.co.il/economy/article/SyzEMeG0w)
- A covert-advertising bill (הצעת חוק פרסום סמוי) would define proper disclosure as "clear and prominent" so a reasonable person understands the content is advertising. Its enactment status is unclear — [law.co.il bill PDF](https://www.law.co.il/media/computer-law/concealed_advertising_bill.pdf); [IDI position paper](https://www.idi.org.il/media/3219/covert_advertising.pdf)
- Telegram ToS for bot developers:
  - 5.2(b): no unsolicited spam.
  - 5.2(d): the bot's name, username and branding must not misrepresent its functions.
  - 5.2(h): it must not link to illegal or questionable goods.
  - Section 4: a privacy policy is required.
  - Section 10: violations "may result in a temporary or a permanent ban".
  - 6.1: "Telegram does not process payments for physical goods and services".
  — [Telegram Bot Developer ToS](https://telegram.org/tos/bot-developers)
- Telegram's own Affiliate Program terms prohibit "spamming or flooding chats with your affiliate link". They cover Telegram Stars mini-app affiliates, not AliExpress, but show Telegram's stance — [Telegram Affiliate Program ToS](https://telegram.org/tos/affiliate-program)
- AliExpress affiliate rules (via networks):
  - An Awin-listed AliExpress program bans pop-ups, cookie stuffing and Alibaba/AliExpress trademark use without authorization. It also restricts using rewards to induce actions.
  - One network listing says social media is accepted. Cuelinks marks social media disallowed for some regions (FR/BR).
  - The official source is the Portals help center (portals.aliexpress.com/help.htm), which I could not retrieve.
  — [search summary of Awin / Cuelinks listings](https://www.cuelinks.com/campaigns/aliexpress-affiliate-program); [Awin AliExpress FR terms](https://ui.awin.com/merchant-profile-terms/26009)

### Inferences
- **Disclosure UX:** add a fixed final caption line, e.g. `ℹ️ קישורי שותפים: רכישה דרכם עשויה לזכות אותנו בעמלה, ללא עלות נוספת לך.` Also add it to `/start`, `/help` and the bot description in BotFather. Put it in the caption itself (visible at first view), not behind a button. That matches the "prominent, at first view, in Hebrew" standard.
- **Don't name the bot or use the AliExpress logo** in a way that implies official affiliation, e.g. "AliExpress Official Bot". This risks both Telegram ToS 5.2(d) and AliExpress trademark rules. A name like "מחפש דילים" plus "לא קשור רשמית לעליאקספרס" is safer.
- **Respond only on explicit request** (command, mention or reply). Never auto-post deals into groups uninvited. That keeps you clear of Telegram 5.2(b) spam rules, and likely of Israel's Communications Law section 30A ("חוק הספאם") on unsolicited advertising. Whether 30A applies to Telegram messages was not researched; see Gaps.
- Show prices as "approximately", with a timestamp. Consumer protection law also targets misleading prices, and AliExpress prices and shipping change often.
- Consult an Israeli lawyer before monetizing at scale. This research is not legal advice.

### Gaps
- The official Israeli Consumer Protection Authority endorser/influencer guideline text, and whether it is final as of 2026, was not found on gov.il.
- No Israeli source explicitly addresses affiliate links or commissions. Applying the disclosure rule to them is an inference.
- The AliExpress Portals official terms (help.htm / Portals agreement) on bots, messaging apps, Telegram and price-comparison tools were not retrievable. Third-party listings conflict.
- Whether Israel's Communications Law 30A (spam) covers Telegram group messages was not researched.
