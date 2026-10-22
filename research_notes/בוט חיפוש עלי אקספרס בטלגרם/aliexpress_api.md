# AliExpress Open Platform APIs for an approved affiliate developer (2025-2026)

Method note: the official docs at openservice.aliexpress.com are a JavaScript single-page app. WebFetch only got "loading..." back, so I could not read them directly. Field names and parameters below are cross-checked against three sources:
1. **ae_sdk v0.6.0**, a TypeScript SDK on npm. Its type definitions copy the official doc descriptions. I downloaded and read it: [index.d.ts](https://unpkg.com/ae_sdk@0.6.0/dist/index.d.ts), [index.js](https://unpkg.com/ae_sdk@0.6.0/dist/index.js), [README](https://unpkg.com/ae_sdk@0.6.0/README.md).
2. **sergioteula/python-aliexpress-api**, which bundles the official AliExpress Python SDK in `skd/`: [api.py](https://raw.githubusercontent.com/sergioteula/python-aliexpress-api/master/aliexpress_api/api.py), [models/product.py](https://raw.githubusercontent.com/sergioteula/python-aliexpress-api/master/aliexpress_api/models/product.py), [skd/api/base.py](https://raw.githubusercontent.com/sergioteula/python-aliexpress-api/master/aliexpress_api/skd/api/base.py).
3. **Older official Alibaba/Taobao doc mirrors** for the same methods (open.fliggy.com, open.alitrip.com). These give field descriptions in Chinese. They may be older than the current AliExpress portal.

GitHub code search hit its rate limit (HTTP 403), so I could not sweep many independent repos by code search.

## Q1. Full list of affiliate methods and which need extra ("Advanced API") permission

### Takeaway
There are 12 `aliexpress.affiliate.*` methods. Product search is covered by `product.query`, `productdetail.get` and `link.generate`, which come with a standard affiliate app. `hotproduct.query`, `hotproduct.download` and `smartmatch` are reported to need an "Advanced API" permission request. There is **no** affiliate image-search method; image search exists only as `aliexpress.ds.image.search` in the Dropshipping API.

### Cited Findings
- The full affiliate method list in ae_sdk: `aliexpress.affiliate.link.generate`, `category.get`, `featuredpromo.get`, `featuredpromo.products.get`, `hotproduct.download`, `hotproduct.query`, `order.get`, `order.list`, `order.listbyindex`, `productdetail.get`, `product.query`, `product.smartmatch` — [ae_sdk index.d.ts](https://unpkg.com/ae_sdk@0.6.0/dist/index.d.ts)
- The DS (dropshipping) methods in the same SDK: `aliexpress.ds.product.get`, `ds.image.search`, `ds.recommend.feed.get`, `ds.feedname.get`, `ds.category.get`, `ds.order.create`, `trade.ds.order.get`, `ds.add.info`, `ds.commissionorder.listbyindex`, `ds.member.orderdata.submit`, `logistics.buyer.freight.get`/`.calculate`, `logistics.ds.trackinginfo.query`. No `aliexpress.ds.text.search` is listed — [ae_sdk index.d.ts](https://unpkg.com/ae_sdk@0.6.0/dist/index.d.ts)
- python-aliexpress-api wraps these methods: `productdetail.get`, `link.generate`, `hotproduct.query`, `product.query`, `category.get`, `product.smartmatch` and `order.list` — [api.py](https://raw.githubusercontent.com/sergioteula/python-aliexpress-api/master/aliexpress_api/api.py)
- Botize says the Hot Product catalog needs AliExpress "Advanced API" access, requested from console.aliexpress.com → App Management → "Apply for Permissions". The application needs a description of at least 100 words covering usage scenarios and added value. Without it the error is "App does not have permission to access this api" — [Botize hotproduct](https://botize.com/en/method/aliexpress_associates/search_hotproduct)
- Botize says the same about Smart Match: it needs Advanced API access — [Botize smartmatch](https://botize.com/en/method/aliexpress_associates/search_smartmatch_product)
- Contradiction: the old Alibaba doc mirror marks smartmatch and productdetail.get as free APIs needing no authorization ("不需要授权") — [open.alitrip smartmatch](https://open.alitrip.com/docs/api.htm?apiId=46010), [open.fliggy productdetail.get](https://open.fliggy.com/docs/api.htm?apiId=48595). "No authorization" in Taobao terms means no user OAuth session, which is a different thing from the app-level permission package, so the two claims can both be true.
- A search-result summary says Botize reports the AliExpress Influencer program blocks Affiliate API access, and that you have to contact support to be removed. I did not see this on the page I fetched, so treat it as unverified — [Botize app page](https://botize.com/en/app/aliexpress_associates)

### Inferences
- A Telegram search bot needs `product.query` (keyword search), `productdetail.get` (when a user pastes a link or ID) and `link.generate` (to turn a link into a tracked affiliate link). These are the standard tier. Request Advanced API early anyway, to get hot products and their higher commission.
- `featuredpromo.products.get` is the only affiliate method whose sort options include **rating** (`ratingAsc`/`ratingDesc`) and `commissionDesc`. It searches promo collections, not arbitrary keywords (see Q2).

### Gaps
- I could not read the current official permission-package list from openservice.aliexpress.com because the page is a SPA. Exactly which methods sit in the "Advanced" package as of 2026 is unconfirmed.
- I found no evidence of `aliexpress.affiliate.image.search` or `aliexpress.ds.text.search`. The sources I checked do not list them.

## Q2. Response fields and request parameters for product.query and productdetail.get

### Takeaway
Affiliate product objects have **no review-count field**. `evaluate_rate` is the positive-feedback percentage as a string (e.g. "89.22%"). `lastest_volume` (misspelled in the API) is "recent sales volume"; no source defines the window. Sorting is limited to price and volume. Prices for filters are in cents. `page_size` is 1-50. Hebrew is supported (HE/IW). ILS support is inconsistent across docs and needs a live test.

### Cited Findings
- Product fields (ae_sdk `Affiliate_Base_Product_Details`):
  - prices: `app_sale_price(_currency)`, `sale_price(_currency)`, `original_price(_currency)`, `target_sale_price`, `target_original_price`, `target_app_sale_price`, each `target_*` with its `_currency`
  - commission: `commission_rate`, `hot_product_commission_rate`, `relevant_market_commission_rate`
  - other: `discount`, `evaluate_rate`, `lastest_volume` (number), `platform_product_type`
  - categories: `first_level_category_id/name`, `second_level_category_id/name`
  - product: `product_id`, `product_title`, `product_detail_url`, `product_main_image_url`, `product_small_image_urls`, `product_video_url`
  - links and promos: `promotion_link`, `promo_code_info{promo_code, code_campaigntype, code_value, code_availabletime_start/end, code_mini_spend, code_quantity, code_promotionurl}`
  - shop and shipping: `shop_id`, `shop_url`, `ship_to_days`
  - Source: [ae_sdk index.d.ts](https://unpkg.com/ae_sdk@0.6.0/dist/index.d.ts)
- The Python wrapper's Product model has the same field set, including the misspelling `lastest_volume`. It has no review-count field and no shop-name field — [models/product.py](https://raw.githubusercontent.com/sergioteula/python-aliexpress-api/master/aliexpress_api/models/product.py)
- Field meanings from the official doc mirror:
  - `evaluate_rate`: String, e.g. "89.22%", 好评率 = positive feedback rate
  - `lastest_volume`: Number, e.g. 300, 近期销量 = recent sales volume
  - `commission_rate`: e.g. "3.5%"
  - `hot_product_commission_rate`: e.g. "60%"
  - `relevant_market_commission_rate`: JV commission
  - `discount`: e.g. "50%"
  - `promotion_link`: e.g. `http://s.click.aliexpress.com/e/xxxxx`
  - `platform_product_type`: ALL / PLAZA / TMALL
  - Source: [open.fliggy productdetail.get](https://open.fliggy.com/docs/api.htm?apiId=48595)
- A third-party marketplace sample response shows `evaluate_rate` "95.3%" and `lastest_volume` 426 — [zylalabs listing](https://www.zylalabs.com/api-marketplace/data/aliexpress+products+api/2039)
- Response envelope: `aliexpress_affiliate_product_query_response.resp_result{resp_code, resp_msg, result{current_record_count, current_page_no, total_page_no, total_record_count, is_finished, products[]}}` (from ae_sdk types). The doc mirror shows the same `resp_result`/`result` shape — [ae_sdk index.d.ts](https://unpkg.com/ae_sdk@0.6.0/dist/index.d.ts); [open.fliggy](https://open.fliggy.com/docs/api.htm?apiId=48595)
- `product.query` / `hotproduct.query` parameters:
  - `category_ids`, `keywords`
  - `max_sale_price` / `min_sale_price` ("unit cent")
  - `page_no`, `page_size` ("1 - 50")
  - `platform_product_type` (TMALL | ALL | PLAZA)
  - `sort`
  - `delivery_days` (3, 5, 7 or 10)
  - `ship_to_country` ("Filter products that can be sent to that country; Returns the price according to the country's tax rate policy")
  - `fields`, `target_currency`, `target_language`, `tracking_id`, `app_signature`
  - Source: [ae_sdk index.d.ts](https://unpkg.com/ae_sdk@0.6.0/dist/index.d.ts)
- `productdetail.get` parameters: `product_ids` (comma-separated), `country` (ship-to), `fields`, `target_currency`, `target_language`, `tracking_id` — [open.fliggy](https://open.fliggy.com/docs/api.htm?apiId=48595); [ae_sdk](https://unpkg.com/ae_sdk@0.6.0/dist/index.d.ts)
- Sort values for product.query/hotproduct.query: `SALE_PRICE_ASC`, `SALE_PRICE_DESC`, `LAST_VOLUME_ASC`, `LAST_VOLUME_DESC`. There is no rating sort and no relevance option; omit `sort` for the default. For featuredpromo.products.get / ds.recommend.feed.get the values are `commissionAsc/Desc`, `priceAsc/Desc`, `volumeAsc/Desc`, `discountAsc/Desc`, `ratingAsc/Desc`, `promotionTimeAsc/Desc` — [ae_sdk index.d.ts](https://unpkg.com/ae_sdk@0.6.0/dist/index.d.ts)
- The python wrapper confirms the units and limits: prices are in the lowest currency unit (3141 means 31.41) for min and max, and `page_size` is 1-50 — [api.py](https://raw.githubusercontent.com/sergioteula/python-aliexpress-api/master/aliexpress_api/api.py)
- Language: HE and IW both appear in the target_language list — [open.fliggy](https://open.fliggy.com/docs/api.htm?apiId=48595); [ae_sdk](https://unpkg.com/ae_sdk@0.6.0/dist/index.d.ts)
- Currency conflict on ILS:
  - The productdetail.get doc mirror lists USD, GBP, CAD, EUR, UAH, MXN, TRY, RUB, BRL, AUD, INR, JPY, IDR, SEK and KRW. **ILS is not in the list** — [open.fliggy](https://open.fliggy.com/docs/api.htm?apiId=48595)
  - The ae_sdk doc comments for `hotproduct.download` and `smartmatch` list "...SEK,KRW,**ILS**,THB,CLP,VND" — [ae_sdk index.d.ts](https://unpkg.com/ae_sdk@0.6.0/dist/index.d.ts)

### Inferences
- Review counts are not available from affiliate methods. To show "4.8★ (1,234 reviews)" you need `aliexpress.ds.product.get` (Q4) or no review count at all. With affiliate data alone, show `evaluate_rate` (positive %) and `lastest_volume` (recent sold).
- "Best products" ranking: call `product.query` with `sort=LAST_VOLUME_DESC` and `ship_to_country=IL`, then re-rank on the client using `evaluate_rate`, `discount` and `commission_rate`. The API cannot sort by rating.
- ILS is probably accepted, since newer docs list it, but test it. If the gateway rejects it or quietly falls back, request USD and convert to ILS yourself.
- `lastest_volume` is often read as 30-day sales. No source I found confirms the window; the official description only says "recent".

### Gaps
- The time window for `lastest_volume` is not stated in any source I could read.
- I could not confirm whether `shop_name` or store rating exist in affiliate responses. The field lists only have `shop_id` and `shop_url`.
- Whether `ship_to_days` is returned for IL, and what it holds, is undocumented beyond its name.

## Q3. Image-based search

### Takeaway
There is no affiliate image-search method. The Dropshipping API has `aliexpress.ds.image.search`. It needs a DS app and access, takes image bytes (100 KB max) and returns affiliate-style product objects. The other options are paid third-party image-search scrapers or APIs.

### Cited Findings
- `aliexpress.ds.image.search` parameters:
  - `image_file_bytes` ("max size 100 KB")
  - `product_cnt` ("max 150")
  - `sort` (SALE_PRICE_* / LAST_VOLUME_*)
  - `shpt_to` (ship-to country; this spelling is the API's)
  - `target_currency`, `target_language`
  - Response: `aliexpress_ds_image_search_response{data: {products[] (same product shape as affiliate)}, rsp_code, rsp_msg}`
  - Source: [ae_sdk index.d.ts](https://unpkg.com/ae_sdk@0.6.0/dist/index.d.ts)
- Third-party options: Apify "AliExpress Image Search" (image upload or URL, up to 60 results, from $2 per 1,000 results), and a RapidAPI "AliExpress Search By Image" API by freecamp008 — [Apify](https://apify.com/bokgoon/aliexpress-image-search/api); [Apify freecamp008](https://apify.com/freecamp008/search-by-image-aliexpress?fpr=data)

### Inferences
- If DS access is granted, take the Telegram photo, compress it under 100 KB, call `ds.image.search`, then convert the resulting product URLs into affiliate links with `aliexpress.affiliate.link.generate`.
- Without DS access, a cheaper fallback is a vision model that describes the photo as keywords and then calls `product.query`.

### Gaps
- No source showed whether `ds.image.search` sends the bytes as multipart form data or base64, or whether it is actually open to individual developers in 2026.

## Q4. Dropshipping API: ratings and review counts, access, and combining with affiliate links

### Takeaway
`aliexpress.ds.product.get` does return `avg_evaluation_rating` and `evaluation_count`, both as strings, inside `ae_item_base_info_dto`. It also returns store sub-ratings. DS needs a separate DS-category app and a user OAuth `session` (access token). Whether an affiliate developer may display DS data with affiliate links is not documented in anything I found.

### Cited Findings
- `ds.product.get` parameters: `product_id`, `ship_to_country`, `target_currency`, `target_language` — [ae_sdk index.d.ts](https://unpkg.com/ae_sdk@0.6.0/dist/index.d.ts)
- `ds.product.get` response: `aliexpress_ds_product_get_response.result`, containing:
  - `ae_item_base_info_dto{product_id, category_id, subject, currency_code, product_status_type, evaluation_count, avg_evaluation_rating, detail, mobile_detail, gmt_create, ...}`
  - `ae_item_sku_info_dtos[]` (`sku_price`, `offer_sale_price`, `sku_available_stock`, ...)
  - `ae_store_info{store_id, store_name, item_as_described_rating, communication_rating, shipping_speed_rating}`
  - `logistics_info_dto{delivery_time, ship_to_country}`
  - `ae_multimedia_info_dto{image_urls, ae_video_dtos}`
  - `package_info_dto`, `ae_item_properties[]`
  - Source: [ae_sdk index.d.ts](https://unpkg.com/ae_sdk@0.6.0/dist/index.d.ts)
- `ds.recommend.feed.get` takes `feed_name` (from `ds.feedname.get`), `category_id`, `country`, `page_size` 1-50 and `sort` (which includes `ratingDesc`). It returns affiliate-shape products — [ae_sdk index.d.ts](https://unpkg.com/ae_sdk@0.6.0/dist/index.d.ts)
- The ae_sdk DS client is built with app_key, app_secret and a `session` access token from the OAuth authorization flow — [ae_sdk README](https://unpkg.com/ae_sdk@0.6.0/README.md); [ae-api npm](https://www.npmjs.org/package/ae-api)
- Third-party guide: the app category ("AliExpress Affiliate" or "AliExpress DS") is chosen when creating the app, and DS needs explicit approval (1-3 business days) plus a user OAuth token. This is unverified — [rapidevelopers Bubble guide](https://www.rapidevelopers.com/md/bubble-integrations/aliexpress-api)
- The doc mirror says affiliate `productdetail.get` needs no `session` — [open.fliggy](https://open.fliggy.com/docs/api.htm?apiId=48595)

### Inferences
- A combined design is technically possible. Search with affiliate `product.query`, enrich the top N results with DS `ds.product.get` for star rating and review count, and always build the link with affiliate `link.generate`. This costs one extra DS call per product and needs a DS app with an access token that you refresh periodically.
- `evaluation_count` and `avg_evaluation_rating` come back as strings; parse them defensively, since they may be empty for new items.

### Gaps
- I found no official policy on whether one developer can hold both an Affiliate app and a DS app, or on showing DS data alongside affiliate links. Ask AliExpress support or check the DS terms.
- I did not verify the DS access-token lifetime or the refresh flow from official docs.

## Q5. Signing for https://api-sg.aliexpress.com/sync

### Takeaway
Two signing variants are in use today:
1. **The new IOP gateway**: `sign_method=sha256`, HMAC-SHA256 with the app secret as key, over the concatenation of sorted `key+value` pairs with nothing wrapped around it. Uppercase hex. Timestamp in epoch milliseconds.
2. **The legacy TOP/Taobao SDK** (still bundled in python-aliexpress-api): `sign_method=md5`, MD5(secret + sorted key+value pairs + secret), uppercase hex, timestamp in milliseconds, `v=2.0`, `format=json`.

For `/rest` (OP-style) APIs whose method is a path, the path is prepended to the string being signed.

### Cited Findings
- ae_sdk code:
  - constants: `AE_TOP_API_URL = "https://api-sg.aliexpress.com/sync"`, `AE_OP_API_URL = "https://api-sg.aliexpress.com/rest"`, `SIGN_METHOD = "sha256"`
  - signing: `createHmac("sha256", app_secret).update(basestring).digest("hex").toUpperCase()`
  - basestring: params with null values dropped, sorted by key, concatenated as `key + String(value)`. If `method` contains "/", the path is prepended and `method` is removed from the params.
  - system params added on every call: `method`, `app_key`, `sign_method`, `timestamp: Date.now()` (ms), `simplify: true`, `session` (optional)
  - transport: HTTP POST with all params URL-encoded in the query string
  - Source: [ae_sdk index.js](https://unpkg.com/ae_sdk@0.6.0/dist/index.js)
- Legacy Python SDK (`skd/api/base.py`):
  - endpoint: domain `api-sg.aliexpress.com`, path `/sync`, POST
  - system params: `format=json`, `app_key`, `sign_method=md5`, `v=2.0`, `timestamp` (ms), `partner_id="taobao-sdk-python-20200924"`, `method`, optional `session`
  - signing: sort the system and application params together, build secret + concat(k+v) + secret, take MD5, uppercase hex. Not HMAC.
  - Source: [skd/api/base.py](https://raw.githubusercontent.com/sergioteula/python-aliexpress-api/master/aliexpress_api/skd/api/base.py)
- Old Taobao doc mirror: `sign_method` is `hmac` or `md5`. `timestamp` format is `yyyy-MM-dd HH:mm:ss` in GMT+8, and the server allows 10 minutes of clock error. `v=2.0`, `format` is xml (default) or json, and `simplify` is optional — [open.fliggy](https://open.fliggy.com/docs/api.htm?apiId=48595). This conflicts with the millisecond timestamps both current SDKs send. The current api-sg gateway evidently accepts milliseconds, while the date-string format is the legacy TOP convention.
- A third-party guide says the Affiliate API accepts both HMAC-SHA256 and MD5 — [rapidevelopers](https://www.rapidevelopers.com/md/bubble-integrations/aliexpress-api)

### Inferences
- Recommended for new code: `/sync`, `sign_method=sha256`, HMAC-SHA256(secret, sortedConcat). Timestamp as `Date.now()` milliseconds. Add `simplify=true` for flatter JSON.
- Do not wrap the secret around the string with sha256; that wrapping belongs to the MD5 variant only.
- Sign the raw, unencoded values. URL-encoding happens only when the query string is built.

### Gaps
- I could not open the official "Signature algorithm" doc page (SPA) or the official iop-sdk source directly. The sha256 rule comes from a well-maintained community SDK, not first-party code.

## Q6. Rate limits, error codes and pitfalls

### Takeaway
AliExpress publishes no numeric QPS or daily quota for affiliate apps. The observed throttle error is "Api access frequency exceeds the limit. this ban will last 1 seconds". The common pitfalls are missing permission, a wrong or ambiguous tracking_id, products without affiliate eligibility, and price filters in cents.

### Cited Findings
- Botize documents three errors:
  - "Api access frequency exceeds the limit. this ban will last 1 seconds": a rate-limit ban lasting about 1 s.
  - "TrackingId input parameter error": the account has several tracking IDs, so pass the right one.
  - "App does not have permission to access this api": Advanced API access is needed.
  - Source: [Botize hotproduct](https://botize.com/en/method/aliexpress_associates/search_hotproduct)
- Ali2Woo (updated Feb 2023) says the docs don't give exact per-token limits, real-world limits are "really high", tokens can be "temporary frozen", and requests may return empty data instead of an error — [Ali2Woo KB](https://help.ali2woo.com/codex/what-is-aliexpress-api-and-what-its-limits/)
- Unofficial quota figures conflict. One guide says about 1,000 calls/day on the free tier; another says an approved app gets a flow-rate cap of 5,000. Neither is official — [search summary: rapidevelopers Replit guide](https://www.rapidevelopers.com/replit-integration/aliexpress-api); [elfsight](https://elfsight.com/blog/how-to-get-and-use-aliexpress-api-key/)
- Example gateway error: code 50 "Remote service error", sub_code `isv.invalid-parameter` — [open.fliggy](https://open.fliggy.com/docs/api.htm?apiId=48595)
- `link.generate` parameters:
  - `promotion_link_type` ("0 for normal link which has standard commission, and 2 for hot link which has hot product commission")
  - `source_values` (comma-separated URLs)
  - `tracking_id` (required)
  - Response: `promotion_links[{promotion_link, source_value}]`, `total_result_count`
  - Source: [ae_sdk index.d.ts](https://unpkg.com/ae_sdk@0.6.0/dist/index.d.ts)
- The python wrapper refuses `get_affiliate_links` without a tracking ID (`InvalidTrackingIdException`) and raises `ProductsNotFoudException` on empty results. The typo is in the library — [api.py](https://raw.githubusercontent.com/sergioteula/python-aliexpress-api/master/aliexpress_api/api.py)
- Affiliate links come back as `s.click.aliexpress.com/e/...` short links — [open.fliggy](https://open.fliggy.com/docs/api.htm?apiId=48595)
- Not all products have an affiliate link, per a third-party integration — [search result summary, WordPress plugin](https://wordpress.org/plugins/?p=356658)

### Inferences
- Always pass `tracking_id` on `product.query` and `productdetail.get` so that `promotion_link` is filled in. Without it, `promotion_link` may be missing.
- Throttle the bot to about 1-5 QPS per app, with retry and backoff when the "frequency exceeds" message appears. Cache search results per keyword for a few minutes.
- Before calling `link.generate`, normalize user-pasted links (a.aliexpress.com/_xxx, s.click, mobile m.aliexpress) to `https://www.aliexpress.com/item/{id}.html`.

### Gaps
- No source confirmed which URL formats `link.generate` rejects. I found no reliable reports on this.
- No official QPS or daily quota figures were found.

## Q7. Commission fields and hot-product commission

### Takeaway
Each product carries `commission_rate` (standard), `hot_product_commission_rate` and `relevant_market_commission_rate`. Hot products can carry much higher commission (the doc example is 60% against a 3.5% standard), but you earn it only through a hot link (`promotion_link_type=2`).

### Cited Findings
- Doc examples: `commission_rate` "3.5%", `hot_product_commission_rate` "60%", `relevant_market_commission_rate` "10%" (JV commission) — [open.fliggy](https://open.fliggy.com/docs/api.htm?apiId=48595)
- `promotion_link_type`: 0 is a normal link at standard commission, 2 is a hot link at hot-product commission — [ae_sdk index.d.ts](https://unpkg.com/ae_sdk@0.6.0/dist/index.d.ts)
- `featuredpromo.products.get` and `ds.recommend.feed.get` support `commissionDesc` sorting — [ae_sdk index.d.ts](https://unpkg.com/ae_sdk@0.6.0/dist/index.d.ts)

### Inferences
- When an item comes from `hotproduct.query`, generate its link with `promotion_link_type=2` to capture the hot commission.
- The doc examples (60%) are illustrations, not typical rates.

### Gaps
- No source quantified typical hot-product commission rates for 2025-2026 or said how often IL-shippable products carry them.
