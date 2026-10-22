# Trust/Quality Scoring and LLM-in-the-loop Selection for an AliExpress Telegram Search Bot

## Which AliExpress data can a bot actually score? (data availability, read first)

### Takeaway
The official affiliate `aliexpress.affiliate.product.query` returns a positive-feedback rate (`evaluate_rate`), recent sales (`lastest_volume`), prices and discount, and `shop_id`/`shop_url`. It does **not** return a store rating, a star average or a review count. A scoring formula therefore has to run on feedback % plus volume plus price, and treat stars, review count and store metrics as optional enrichment.

### Cited Findings
- Per-product response fields include `product_title`, `sale_price`, `original_price`, `target_sale_price` (converted to `target_currency`), `app_sale_price`, `discount` (e.g. "50%"), `commission_rate`, `evaluate_rate` (positive feedback rate; the doc doesn't say whether it is product- or store-level), `lastest_volume` (recent sales volume, spelled that way in the API), `platform_product_type` (e.g. TMALL), first/second-level category id/name, `shop_id`, `shop_url`, `promotion_link`, `ship_to_days`, and `promo_code_info` — [AliExpress Open Platform, aliexpress.affiliate.product.query](https://open.alitrip.com/docs/api.htm?apiId=45803)
- The doc returns no store rating, only `shop_id` and `shop_url` — [same doc](https://open.alitrip.com/docs/api.htm?apiId=45803)
- Request params: `keywords`, `category_ids`, `min_sale_price`, `max_sale_price`, `sort` ∈ {SALE_PRICE_ASC, SALE_PRICE_DESC, LAST_VOLUME_ASC, LAST_VOLUME_DESC}, `platform_product_type` ∈ {ALL, PLAZA, TMALL}, `target_currency` (list includes USD, EUR; ILS is **not** in the listed currencies), `target_language` (includes HE and IW), `ship_to_country`, `delivery_days` ∈ {3,5,7,10}, `page_size` (default 50), `fields` (comma-separated output fields) — [same doc](https://open.alitrip.com/docs/api.htm?apiId=45803)
- The field names `lastest_volume`, `evaluate_rate`, `shop_id`, `target_sale_price` also appear in sibling hot-product endpoint samples, which confirms the spelling — [AliExpress Open Platform search results (hotproduct samples)](https://developer.alibaba.com/docs/api.htm?apiId=45803)

### Inferences
- Request USD with `ship_to_country=IL` and convert to ILS in the bot, since ILS is not in the documented `target_currency` list. Price caps such as "עד 100 ש"ח" must be converted to USD before going into `max_sale_price`.
- Use `sort=LAST_VOLUME_DESC` to fetch candidates (popularity pre-filter), then re-score locally. Fetch 1–2 pages (50–100 items) per query.
- The doc doesn't say whether `evaluate_rate` is product- or store-level. Treat it as the main quality proxy, but verify empirically by comparing it with what the product page shows.

### Gaps
- Could not confirm an official affiliate endpoint that returns star average, review count, store rating or store open date. `aliexpress.affiliate.productdetail.get` was not verified. Those signals likely need a page fetch or scraper, and third-party scrapers such as [Apify actors](https://apify.com/viralanalyzer/aliexpress-affiliate-products) are unofficial.
- `lastest_volume` window (30 days? 180 days?) is undocumented.

## Proven statistical methods for ranking with few reviews (Bayesian average, Wilson, log-sales)

### Takeaway
Never sort by the raw average. Use the Wilson lower bound for a positive/negative signal (feedback %), or a Bayesian/Dirichlet-shrunk mean for 1–5 stars, plus log-scaled sales. All three shrink low-evidence items toward a prior, so "5.0★ from 2 reviews" stops beating "4.8★ from 3,000".

### Cited Findings
- **Wilson score lower bound** for positive fraction p̂ over n ratings: `(p̂ + z²/(2n) − z·√((p̂(1−p̂) + z²/(4n))/n)) / (1 + z²/n)`, with z = 1.96 for 95% confidence — [Evan Miller, How Not To Sort By Average Rating](https://www.evanmiller.org/how-not-to-sort-by-average-rating.html)
- Failure modes Miller cites: the average ranks 2 positive / 0 negative above 100 positive / 1 negative. Positive-minus-negative ranks 5,500/4,500 (55%) above 600/400 (60%) — [Evan Miller](https://www.evanmiller.org/how-not-to-sort-by-average-rating.html)
- **Star ratings (K levels), approximate Bayesian with a Dirichlet(1,…,1) prior** (one pseudo-vote per star level): `S = Σ s_k(n_k+1)/(N+K) − z·√( [Σ s_k²(n_k+1)/(N+K) − (Σ s_k(n_k+1)/(N+K))²] / (N+K+1) )`. Miller sorts with z = 1.65 (α = 0.10) and uses z = 1.96 for display — [Evan Miller, Ranking Items With Star Ratings](https://www.evanmiller.org/ranking-items-with-star-ratings.html)
- Only show an average when the interval is narrow: require `2z·√(...) < 0.5` for half-star display (or < 1 for whole stars) — [Evan Miller, Ranking Items With Star Ratings](https://www.evanmiller.org/ranking-items-with-star-ratings.html)
- **IMDb weighted rating** (Bayesian average): `WR = (v/(v+m))·R + (m/(v+m))·C`, where v = votes, R = item mean, m = minimum-votes threshold, C = global mean. Low-vote items get pulled toward the mean. Published m/C values vary by date (m = 1,300 / 3,000 / 25,000 with C ≈ 6.7–7.0), so they are historical examples, not constants — [Neurobiology Substack, How IMDb determines the Top 250](https://neurobiology.substack.com/p/how-imdb-determines-top-250_27); [TASVideos forum](https://tasvideos.org/Forum/Posts/243892)

### Inferences (recommended implementation, not sourced as a standard)
- **Stars (if available):** Bayesian average `R_adj = (v·R + m·C)/(v + m)` with C = 4.5 (typical AliExpress mean, needs validation on your own data) and m ≈ 50. Normalize as `starScore = clamp((R_adj − 4.0)/1.0, 0, 1)`, since nearly all listings sit at 4.0–5.0.
- **Feedback % (`evaluate_rate`):** Wilson lower bound with n = review count if known. If unknown, use `lastest_volume` as a crude n proxy (assume ~5–10% of orders leave feedback), or fall back to a Bayesian shrink `(p·n + 0.9·20)/(n + 20)`.
- **Sales:** `salesScore = log10(1 + orders) / log10(1 + 10000)`, clamped to [0,1], so 10 → 0.26, 100 → 0.50, 1,000 → 0.75, 10k+ → 1. Log scaling stops 50k-order items from swamping everything.
- **Composite (starting weights, tune via evaluation):**
  `trust = 0.35·feedbackWilson + 0.25·starScore + 0.25·salesScore + 0.15·storeScore`
  `final = relevanceGate × (0.7·trust + 0.3·priceScore)`
  When a signal is missing, drop its term and renormalize the remaining weights. Don't impute 0.
- **Hard filters before scoring:** feedback < 90%, orders < 10 (unless the store is "official"/TMALL), and price-outlier flags (next section).

### Gaps
- No authoritative source found for AliExpress-specific prior values (global mean stars, typical review/order ratio). Compute these from your own candidate pools.

## Price sanity: overpriced outliers and suspiciously cheap items

### Takeaway
Compute robust statistics (median, IQR) over the price distribution of the **relevance-filtered** candidates for one query. Flag above Q3 + 1.5·IQR as overpriced, and penalize below roughly 0.3× median as "too good to be true". Fake-capacity storage is the textbook case of too-cheap.

### Cited Findings
- Tukey fences: outliers below Q1 − 1.5·IQR or above Q3 + 1.5·IQR. Beyond 3·IQR counts as "extreme". 1.5 is a convention, not a derived constant, and lowering it flags more — [CodeSignal lesson on IQR outliers](https://codesignal.com/learn/courses/measuring-spread-with-range-and-iqr/lessons/outliers-and-spread-measures); [MetricGate IQR docs](https://metricgate.com/docs/interquartile-range-outlier/)
- IQR and MAD are rank-based, so the outliers themselves cannot inflate them. The Hampel filter is the MAD analogue — [r-statistics.co outlier calculator](https://r-statistics.co/tools/outlier-detection-calculator.html)
- Pricing software applies Tukey's Q3 + 1.5·IQR to flag pricing anomalies, and recommends review over automatic removal — [Pricefx docs](https://knowledge.pricefx.com/accelerators-documentation-2/latest/accelerators/accelerate-agents/business-user-reference-agents/configure-deployed-agents-agents/definition-step-agents/measures-best-practices-agents/outliers-too-high-values)
- Fake-capacity storage: drives report a far larger capacity than the chip holds and lose data past the real capacity. Reported AliExpress cases include a "32TB" SSD for £21 with 98GB real, and a "4TB" SSD writing at 0.84 MB/s. Price far below market is the main red flag — [SlashGear, cheap 2TB flash drives](https://www.slashgear.com/2247483/cheap-2tb-usb-flash-drive-think-twice-before-buying/); [TechRadar, fake 64TB/128TB SSDs](https://www.techradar.com/news/buyers-beware-fake-64tb-128tb-ssds-flooding-online-marketplaces); [PetaPixel, 30TB scam SSD](https://petapixel.com/2022/09/01/walmart-sold-a-super-cheap-scam-ssd-that-fakes-a-30tb-capacity)
- **Variant-price bait:** listings advertise the cheapest variant's price (e.g. a cable) while showing a pricier product (e.g. a power bank), and the real price appears at checkout — [ExpressVPN, AliExpress scams](https://expressvpn.com/blog/aliexpress-scams/); [Norton](https://us.norton.com/blog/online-scams/is-aliexpress-legit)

### Inferences
- `priceScore`: 1.0 between Q1 and median, decaying linearly to 0 at the upper fence. Give a heavy penalty (or exclude) below `max(Q1 − 1.5·IQR, 0.3·median)`.
- Need at least ~8 relevant candidates for quartiles to mean anything. Below that, skip price scoring.
- Compute stats **after** LLM relevance filtering. Otherwise accessories (cases, cables) drag the median down and make the real product look overpriced.
- Category hard rules: for storage queries (flash drive, SSD, microSD, "TB"), exclude listings with capacity ≥ 2TB priced under a sane floor, or with no brand. Hand variant bait to the LLM: flag a title/price mismatch (e.g. "power station" at $2).
- Large `discount` (e.g. ≥ 80% off `original_price`) usually means an inflated "original" price. Don't reward it.

### Gaps
- No published AliExpress-specific "too cheap" threshold. The 0.3× median cutoff is a heuristic to tune.

## AliExpress-specific trust signals and scams to filter

### Takeaway
Experienced buyers look for ≥ 95% recent positive feedback, a substantial feedback count/order history, a store open more than 1 year (3+ preferred), real buyer photos, and Choice or official/brand stores. Red flags: new stores, review bursts, too-low prices, variant bait, and off-platform payment requests.

### Cited Findings
- Benchmarks: 95%+ positive feedback is the common floor in guides (some accept above 90%). A feedback score around 2,000 is a common volume benchmark. Feedback % is based on recent windows (1/3/6 months) — [itigic, choosing reliable AliExpress sellers](https://itigic.com/how-to-choose-the-most-reliable-aliexpress-sellers/); [Wise, finding AliExpress suppliers 2026](https://wise.com/us/blog/how-to-find-aliexpress-suppliers); [AliDrop blog](https://www.alidrop.co/blogs/aliexpress-dropshipping-suppliers)
- Store age: sources disagree. One says at least 1 year, another says 3+ years signals trustworthiness. Sellers delete and reopen stores after accumulating negatives, so recently opened stores deserve scrutiny — [itigic](https://itigic.com/how-to-choose-the-most-reliable-aliexpress-sellers/); [Wise](https://wise.com/us/blog/how-to-find-aliexpress-suppliers)
- Detailed seller scores ("item as described", communication, shipping speed) and official stores are recommended checks. Strong suppliers do well across multiple signals, not just one — [itigic](https://itigic.com/how-to-choose-the-most-reliable-aliexpress-sellers/); [Wise](https://wise.com/us/blog/how-to-find-aliexpress-suppliers)
- One guide suggests > 90% feedback and at least 100 completed orders. Choice (launched 2023) is AliExpress-controlled logistics with equal or stronger money-back guarantees. The source is a VPN vendor blog, so it has commercial interest — [Proton VPN blog](https://protonvpn.com/da/blog/aliexpress)
- Review red flags: many reviews posted the same day, broken English, heavy emoji, no real photos, copy-paste wording. New profiles with few fulfilled orders are risky. Off-platform payment requests and pressure to close disputes are scams. Dispute within 15 days of order completion — [SlashGear, how to spot a scam on AliExpress](https://www.slashgear.com/1924110/how-to-spot-scam-on-aliexpress-warning-signs)
- Brushing (fake orders to inflate ratings), professional or AI-generated photos, and words like "toy", "replica" or "imitation" in descriptions are warning signs — [ExpressVPN](https://expressvpn.com/blog/aliexpress-scams/); [ESET](https://eset.com/blog/en/home-topics/privacy-and-identity-protection/is-aliexpress-safe/)

### Inferences
- `storeScore` (if the store page is fetched): feedback ≥ 97% → 1, 95–97% → 0.7, 90–95% → 0.3, < 90% → exclude. Store age ≥ 3y adds +0.2, < 1y subtracts 0.3. Add a bonus for `platform_product_type=TMALL` or "Official Store" in the store name.
- Title keyword blocklist, case-insensitive: "replica", "1:1", "copy", "toy", "model" (for electronics), "compatible for" (when the user asked for an original brand item), "for parts", and unrealistic capacities ("16TB", "30TB", "128TB" on flash/SSD). Have the LLM catch the softer cases.
- Brand-name queries (e.g. "AirPods", "Xiaomi"): prefer official brand stores and warn that non-official listings are likely clones.
- Choice can't be confirmed from the documented affiliate fields. If not exposed, skip it rather than guessing.

### Gaps
- No Reddit r/Aliexpress threads surfaced in search. Community tips here come from blogs and security-vendor articles, which are anecdotal.
- No source documents an API field for "Choice" status or store open date.
- No public data on how common fake reviews are on AliExpress.

## LLM-in-the-loop: query translation, constraint extraction, relevance judging, Hebrew titles (prompts, JSON, cost, latency, caching)

### Takeaway
Use two small-model calls per search: (1) a parse/translate call that returns strict JSON (English keywords, constraints, ambiguity flag), and (2) a listwise relevance + Hebrew-title call over about 30–50 compact candidate lines. Both should use Claude structured outputs. On Haiku-class pricing this costs well under one cent per search. Cache parsed queries and results in memory.

### Cited Findings
- **Pricing (USD per million tokens):** Claude Haiku 5.5 (prompts ≤ 100k tokens) costs $0.10 input / $0.50 output, with cache hits at $0.01. Claude Haiku 4.5 costs $1 input / $5 output, with cache hits at $0.10. The Batch API gives 50% off, but it is asynchronous, so it doesn't fit live bot queries — [Claude pricing docs](https://platform.claude.com/docs/en/docs/about-claude/pricing)
- **Prompt caching:** the minimum cacheable prompt is 512 tokens on Haiku 5.5 and 4,096 tokens on Haiku 4.5. Shorter prompts silently skip caching. TTL is 5 min by default or 1 h (`"ttl": "1h"`). A 5m write costs 1.25×, a 1h write 2×, and a read 0.1× base input — [Claude prompt caching docs](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
- **Structured outputs:** pass `output_config.format` with `type: "json_schema"`. The old `output_format` is deprecated. Supported models include `claude-haiku-5-5` and `claude-haiku-4-5-20251001`. Objects need `additionalProperties: false`. Unsupported: `minimum`/`maximum`, `minLength`/`maxLength`, recursive schemas, `minItems` > 1. The TS SDK offers `zodOutputFormat()` with `client.messages.parse()` → `parsed_output` — [Claude structured outputs docs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)
- **Listwise vs pointwise:** product-search reranking work uses listwise LLM prompts over chunks of 10 products, since listwise needs one call while pairwise needs many — [Hint-Augmented Re-ranking, arXiv 2511.13994](https://arxiv.org/pdf/2511.13994). Listwise captures cross-item judgments but suffers from context limits and positional bias — [Amazon Science, iterative reranking](https://assets.amazon.science/53/7f/0bdb3680470faf1cb21f49a5998f/scipub-approval152129-43245875-iterative-reranking-as-a-computescaling-method-for-llmbased-rankers.pdf). Guidance: use listwise when candidates fit one context window, and pointwise when you need standalone scores for thresholding — [llmranker on PyPI](https://pypi.org/project/llmranker/)
- An off-the-shelf MS MARCO reranker reportedly did worse than no reranker on product pools, while an ESCI-tuned one helped (self-reported model card) — [Hugging Face, ecommerce-product-search-reranker](https://huggingface.co/albertobarnabo/ecommerce-product-search-reranker)
- LLMs agreed with human evaluators 85–89% on nDCG@10/@5/@1 in a product-search relevance study — [LLMs for Relevance Judgment in Product Search, arXiv 2406.00247](https://arxiv.org/pdf/2406.00247)

### Inferences (design for a small Node.js bot)
- **Call 1, parse (Hebrew → JSON).** Suggested schema fields: `keywords_en` (string, 2–6 words, AliExpress-style, no brand unless given), `alt_keywords_en` (array), `must_have` (array, e.g. "500ml", "USB-C"), `exclude` (array, e.g. "case", "cover" when the user wants the device itself), `max_price_ils` (number|null), `min_price_ils` (number|null), `color`, `size`, `category_hint`, `is_ambiguous` (bool), `clarify_question_he` (string|null). The system prompt should cover unit normalization ("מ"ל" → ml, "ליטר" → L, "ס"מ" → cm, "אינץ'" → inch, "ג'יגה" → GB), price phrases ("עד 100 ש"ח" → max 100, "בסביבות 50" → about 35–65, "זול" → no cap but sort by value), and a few Hebrew few-shot examples. Convert ILS to USD in code, not in the LLM, so the exchange rate stays deterministic.
- **Call 2, judge + title (listwise).** Send compact lines such as `id|title(truncated to ~120 chars)|price_usd`. Ask for `[{id, relevance: 0|1|2, issue: "accessory"|"wrong_item"|"variant_bait"|"replica"|null, title_he}]`, but only for relevance ≥ 1. Use an enum (0/1/2) instead of numeric min/max, because numeric constraints aren't supported in the schema. Gate: keep relevance 2, use 1 only to fill gaps. Hebrew titles: at most ~6 words, include the key spec (capacity/size), and leave Latin-script brand/model names untranslated.
- Positional bias mitigation: pre-sort candidates by local trust score (not by the API's order) before sending. To reduce position effects, split 50+ candidates into chunks of 10–25.
- **Cost per search (rough):** Call 1 ≈ 600 in / 120 out tokens. Call 2 with 40 candidates ≈ 1,800 in / 600 out (Hebrew output takes more tokens per word). Haiku 4.5: ~(2,400 × $1 + 720 × $5)/1M ≈ **$0.006/search**. Haiku 5.5: ~(2,400 × $0.10 + 720 × $0.50)/1M ≈ **$0.0006/search**. Output tokens dominate, so keep Hebrew titles short and skip titles for rejected items.
- **Caching:** a ~600-token system prompt only caches on Haiku 5.5 (512-token minimum), not on Haiku 4.5 (4,096). App-level caching matters more. Key a Map/LRU by normalized Hebrew query → parsed JSON (TTL days), and by `keywords_en+constraints` → API results (TTL ~1–6 h, since prices change). Repeat queries are common in Telegram groups.
- Latency: run the AliExpress API call(s) for `keywords_en` and `alt_keywords_en` in parallel right after call 1. Set `max_tokens` tight. Stream nothing; Telegram needs the full message. Show a "typing" chat action while waiting.
- Failure fallback: if the LLM errors or times out, send the user the top-N by trust score, with the original API titles.

### Gaps
- No published latency figures for Haiku 4.5/5.5 were retrieved. Measure p50/p95 in your own deployment.
- No source benchmarked Hebrew → English e-commerce query translation quality for small models.
- The model cutoff and the existence of Haiku 5.5 come from the live pricing page (Oct 2026). Check model IDs against the docs at build time.

## Ambiguous queries (gifts, vague items) and image queries

### Takeaway
Have the parse call output an `is_ambiguous` flag plus one Hebrew clarifying question, or 3–4 concrete sub-queries for gift-type requests that the bot offers as inline buttons. For images, a vision call returns the same JSON schema as the text parse. A 1000×1000 image costs about 1,300 input tokens, roughly $0.0013 on Haiku 4.5.

### Cited Findings
- Image token cost is `⌈width/28⌉ × ⌈height/28⌉` visual tokens. A 1000×1000 image is 1,296 tokens, about $1.30 per 1,000 images on Haiku 4.5 at $1/MTok. Standard tier caps at 1,568 px long edge / 1,568 tokens. Images under 200 px risk hallucination. Formats: JPEG, PNG, GIF, WebP. Put the image before the text — [Claude vision docs](https://platform.claude.com/docs/en/build-with-claude/vision)
- Images can be sent as base64, as a URL, or as a Files API `file_id` — [Claude vision docs](https://platform.claude.com/docs/en/build-with-claude/vision)
- Query decomposition into hints/sub-queries improved LLM reranking efficiency in product search — [Hint-Augmented Re-ranking, arXiv 2511.13994](https://arxiv.org/pdf/2511.13994)

### Inferences
- Gift or vague requests ("מתנה לאבא שאוהב לבשל עד 150"): the parse call returns `mode: "gift"` with 3–4 `{keywords_en, label_he}` options. The bot shows them as inline keyboard buttons, or searches all of them and shows 1–2 best per idea. Ask a clarifying question only when no reasonable default exists (e.g. "כבל" with no connector type), since one extra round trip costs less than irrelevant results.
- Image queries: download Telegram's largest photo size, downscale to ≤ 1,000 px on the long edge in code (caps cost at ~1,300 tokens), and ask for the same schema plus `visible_text` (brand/model printed on the item). If the user adds a caption, merge it as constraints.
- Confirm that the chosen Haiku version supports vision before relying on it.

### Gaps
- The vision docs' example uses Haiku 4.5 pricing. Haiku 5.5 vision support and resolution tier were not explicitly confirmed in what I read.

## Evaluation: how to test ranking quality

### Takeaway
Build a fixed test set of ~50–100 real Hebrew queries, label the top-10 results for each as 0/1/2 (with an LLM judge plus human spot-checks), and track nDCG@5/@10 plus a "bad item in top-3" rate across versions of the formula and prompts. LLM judges track human system rankings well, even though agreement on individual labels is only fair.

### Cited Findings
- In product search, LLMs agreed with human evaluators 85–89% on nDCG@10, @5 and @1 — [arXiv 2406.00247](https://arxiv.org/pdf/2406.00247)
- Bing (Thomas et al.) has used LLM relevance labeling since late 2022 alongside expert labelers. Reported human-vs-LLM Cohen's kappa ranges 0.20–0.64 depending on task. UMBRELA (open reproduction with GPT-4o) found fair label-level agreement, ~75% accuracy on non-relevant labels and lower on graded ones, but high correlation of system rankings on nDCG@10 — [UMBRELA, arXiv 2406.06519](https://arxiv.org/pdf/2406.06519); [A Large-Scale Study of Relevance Assessments with LLMs, arXiv 2411.08275](https://arxiv.org/html/2411.08275v1)
- Pointwise judging (binary or UMBRELA-style graded) gave the highest agreement with human-based system rankings in a 2025 benchmark — [Benchmarking LLM-based Relevance Judgment Methods, arXiv 2504.12558](https://arxiv.org/pdf/2504.12558)
- Amazon's ESCI dataset (Exact/Substitute/Complement/Irrelevant labels) is the standard product-search relevance benchmark used to evaluate rerankers — [Rec-R1, arXiv 2503.24289](https://arxiv.org/pdf/2503.24289)

### Inferences
- Label scheme modeled on ESCI: 2 = exact, 1 = substitute, 0 = complement/accessory or irrelevant. Run the judge as a **separate, pointwise** call, ideally with a stronger model than the production reranker, so the model doesn't grade its own homework.
- Metrics per version: nDCG@5, precision@3 (relevance 2), "scam/replica/outlier in top-3" rate, and mean trust score of the top-3. Add user signals in production: link click-through per position and "/more" requests.
- Write a regression script (plain Node and assert) that re-runs the test set after any change to weights or prompts and fails if nDCG@5 drops more than ~0.03.

### Gaps
- No public AliExpress- or Hebrew-specific relevance benchmark found. The test set must be built in-house.
