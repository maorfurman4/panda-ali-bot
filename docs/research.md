# בונים בוט עלי אקספרס שחברי הקבוצה יסמכו עליו

הדרך הטובה ביותר היא צינור של שלושה שלבים: לשלוף כ-50–100 מועמדים מה-Affiliate API הרשמי, לסנן ולדרג אותם בקוד ובעזרת מודל AI קטן וזול, ורק אחר כך להעשיר את 4–8 המוצרים שנשארו בכוכבים ובמספר ביקורות. הנקודה שרוב המדריכים מפספסים: **ה-Affiliate API הרגיל לא מחזיר דירוג כוכבים ולא מספר ביקורות**. הוא מחזיר רק `evaluate_rate`, אחוז משוב חיובי כמחרוזת ("96.5%"), ו-`lastest_volume`, מספר מכירות "אחרונות" ([ae_sdk](https://unpkg.com/ae_sdk@0.6.0/dist/index.d.ts); [shopli](https://github.com/ohadf2015/shopli/blob/HEAD/lib/reviews.ts)). בוטים שמציגים "⭐ 4.9 (44 ביקורות)" מקבלים את הנתון משני מקומות: מה-**Dropshipping API** (`aliexpress.ds.product.get`), שדורש אפליקציה נפרדת ו-OAuth token, או מ-endpoint ציבורי לא מתועד, `feedback.aliexpress.com`, שיכול להפסיק לעבוד בכל יום ([omerxxben](https://github.com/omerxxben/telegram_bot/blob/HEAD/Classes/ali_epress_api_products.py)). כבר קיים בגיטהאב בוט עברי, omerxxben/telegram_bot, שעושה כמעט בדיוק את מה שאתה מתאר: טריגר "חפש לי", תרגום ב-Gemini, סינון רלוונטיות, דירוג מה-DS API וקולאז' עם מדליות ([README](https://github.com/omerxxben/telegram_bot/blob/HEAD/README.md)). כדאי ללמוד ממנו ולתקן את החולשות שלו, ולא להתחיל מאפס. העלות השוטפת נמוכה מאוד: כ-2–5 דולר לחודש על אחסון ([Fly.io](https://docs.fly.io/about/pricing); [Railway](https://railway.com/pricing)), ובערך עשירית סנט עד חצי סנט לחיפוש על AI ([Claude pricing](https://platform.claude.com/docs/en/docs/about-claude/pricing)). שני דברים לא תלויים בכסף: גילוי נאות בעברית בכל הודעה, ושהבוט יגיב רק כשפונים אליו.

## ה-API הרשמי נותן אחוז משוב ומכירות, לא כוכבים

לפני שמתכננים ציון אמון צריך לדעת אילו נתונים בכלל זמינים. יש 12 מתודות `aliexpress.affiliate.*`. לבוט חיפוש מספיקות שלוש מהשכבה הרגילה: `product.query` (חיפוש לפי מילות מפתח), `productdetail.get` (כשמישהו מדביק קישור) ו-`link.generate` (הפיכת קישור לקישור שותפים) ([ae_sdk](https://unpkg.com/ae_sdk@0.6.0/dist/index.d.ts)). המתודות `hotproduct.query` ו-`smartmatch` דורשות הרשאת **"Advanced API"**. מבקשים אותה ב-console.aliexpress.com → App Management → Apply for Permissions, עם תיאור של 100 מילים לפחות על אופן השימוש ([Botize](https://botize.com/en/method/aliexpress_associates/search_hotproduct)). כדאי לבקש אותה מוקדם, כי ב"מוצרים חמים" יש עמלה מיוחדת: בדוגמה בתיעוד היא 60% לעומת 3.5% רגילה. העמלה הזו משולמת רק דרך קישור מסוג `promotion_link_type=2` ([open.fliggy](https://open.fliggy.com/docs/api.htm?apiId=48595)). הדוגמה בתיעוד היא המחשה, לא נתון טיפוסי.

כל מוצר שחוזר מ-`product.query` כולל מחירים (`target_sale_price`, `original_price`, `discount`), עמלות, `evaluate_rate`, `lastest_volume` (באיות השגוי של ה-API), קטגוריות, `product_main_image_url`, `shop_id`/`shop_url` ו-`promotion_link`. **אין בו מספר ביקורות, אין דירוג חנות ואין שם חנות** ([ae_sdk](https://unpkg.com/ae_sdk@0.6.0/dist/index.d.ts); [models/product.py](https://raw.githubusercontent.com/sergioteula/python-aliexpress-api/master/aliexpress_api/models/product.py)). אי אפשר למיין לפי דירוג. האפשרויות הן מחיר (`SALE_PRICE_ASC/DESC`) ונפח מכירות (`LAST_VOLUME_ASC/DESC`) בלבד. מחירי הסינון (`min_sale_price`, `max_sale_price`) נמסרים **באגורות/סנטים**, ו-`page_size` מוגבל ל-1–50 ([api.py](https://raw.githubusercontent.com/sergioteula/python-aliexpress-api/master/aliexpress_api/api.py)). התיעוד לא אומר על איזה חלון זמן `lastest_volume` נמדד. עברית נתמכת (`target_language=HE`/`IW`). לגבי שקלים המקורות סותרים: מסמך אחד לא מונה ILS ברשימת המטבעות, ומסמך חדש יותר כן ([open.fliggy](https://open.fliggy.com/docs/api.htm?apiId=48595); [ae_sdk](https://unpkg.com/ae_sdk@0.6.0/dist/index.d.ts)). ההמלצה הבטוחה: לבקש USD עם `ship_to_country=IL` ולהמיר לשקלים בקוד שלך.

מספר הביקורות מגיע מ-`aliexpress.ds.product.get`. הוא מחזיר בתוך `ae_item_base_info_dto` את `avg_evaluation_rating` ואת `evaluation_count`, שניהם כמחרוזות, ובנוסף דירוגי משנה של החנות (`item_as_described_rating`, `communication_rating`, `shipping_speed_rating`) ואת `store_name` ([ae_sdk](https://unpkg.com/ae_sdk@0.6.0/dist/index.d.ts)). המחיר: אפליקציה נפרדת מקטגוריית "AliExpress DS", אישור שלוקח לפי מדריך צד שלישי 1–3 ימי עסקים, ו-access token של משתמש שצריך לרענן מדי פעם ([rapidevelopers](https://www.rapidevelopers.com/md/bubble-integrations/aliexpress-api)). לא מצאתי מסמך רשמי שמתיר או אוסר להציג נתוני DS לצד קישורי שותפים. הבוט העברי omerxxben עושה בדיוק את זה, עם משתני סביבה נפרדים `DS_APP_KEY`/`DS_APP_SECRET`/`AUTH_CODE` ([GLOBAL_CONST.py](https://github.com/omerxxben/telegram_bot/blob/HEAD/Classes/GLOBAL_CONST.py)).

הדרך השנייה היא ה-endpoint הציבורי `feedback.aliexpress.com/pc/searchEvaluation.do?productId=…&lang=he_IL&country=IL`. הוא לא דורש מפתח, אבל בלי User-Agent של דפדפן ו-`Referer: https://www.aliexpress.com/` הוא מחזיר דף חסימה ([shopli](https://github.com/ohadf2015/shopli/blob/HEAD/lib/reviews.ts)). יש בו גם מלכודת מספרית: באותו מוצר `totalNum` היה 1,186, וזה מספר הביקורות עם טקסט, וסכום היסטוגרמת הכוכבים היה 6,814, וזה מספר כל הדירוגים. בנוסף ההיסטוגרמה "מסוננת מראש": דירוגי 1–2 כוכבים הופיעו כאפס בזמן ש-557 דירוגים היו על 3 כוכבים ([shopli](https://github.com/ohadf2015/shopli/blob/HEAD/lib/reviews.ts)). מוצר בלי ביקורות מחזיר `evarageStar: 0.0`, וצריך להציג אותו כ"אין עדיין ביקורות" ולא כאפס כוכבים ([fetchaller](https://github.com/Averyy/fetchaller-mcp/blob/HEAD/docs/site-apis.md)). גרידה של דף המוצר עצמו כבר לא עובדת ב-2026: הדפים מרונדרים בצד הלקוח, ו-MTop מציג reCAPTCHA לכל session חדש משרת Linux ([fetchaller](https://github.com/Averyy/fetchaller-mcp/blob/HEAD/docs/site-apis.md)).

ל-Affiliate API **אין חיפוש לפי תמונה**. חיפוש תמונה קיים רק ב-DS API (`aliexpress.ds.image.search`), שמקבל תמונה של עד 100KB ומחזיר עד 150 מוצרים ([ae_sdk](https://unpkg.com/ae_sdk@0.6.0/dist/index.d.ts)). לגבי מגבלות קצב: AliExpress לא מפרסמת מספרים. shopli מדד באוגוסט 2026 שכ-**10% מהקריאות** חוזרות עם `ApiCallLimit` וחסימה של שנייה, גם כשהקריאות נשלחות ברצף ([shopli](https://github.com/ohadf2015/shopli/blob/HEAD/lib/aliexpress.ts)). החתימה בשרת `api-sg.aliexpress.com/sync` היא HMAC-SHA256 עם ה-app secret, על פרמטרים ממוינים, עם timestamp במילישניות. ספריית ae_sdk מטפלת בזה בשבילך ([ae_sdk index.js](https://unpkg.com/ae_sdk@0.6.0/dist/index.js)).

## ציון אמון: לסנן קודם, לדרג אחר כך, לא לסמוך על ממוצע של 2 ביקורות

מוצר "אמין באמת" מזוהה בשלוש שכבות, בסדר הזה: סינון קשיח, ציון סטטיסטי שמתחשב בכמות הראיות, ובדיקת שפיות של המחיר. הטעות הנפוצה היא למיין לפי ממוצע גולמי. כך "5.0 משתי ביקורות" עוקף את "4.8 מ-3,000". Evan Miller הראה שממוצע פשוט מדרג 2 חיוביות ו-0 שליליות מעל 100 חיוביות ושלילית אחת ([Evan Miller](https://www.evanmiller.org/how-not-to-sort-by-average-rating.html)). הפתרון המוכח הוא "כיווץ" (shrinkage) של פריטים עם מעט ראיות לכיוון ממוצע כללי. עבור אחוז משוב חיובי משתמשים ב-**Wilson lower bound**, ועבור כוכבים ב**ממוצע בייסיאני** בסגנון IMDb, `WR = (v·R + m·C)/(v + m)` ([Evan Miller, star ratings](https://www.evanmiller.org/ranking-items-with-star-ratings.html); [IMDb formula](https://neurobiology.substack.com/p/how-imdb-determines-top-250_27)).

הסינון הקשיח נשען על נתונים ישראליים אמיתיים. shopli מדד 395 מוצרים שנשלחים לישראל: סף `evaluate_rate ≥ 90` משאיר **87%** מהמוצרים, `≥ 94` משאיר **65%**, ו-`lastest_volume ≥ 100` משאיר 98%. כלומר סף המכירות כמעט לא מסנן, והמשוב הוא שעושה את העבודה ([shopli quality.ts](https://github.com/ohadf2015/shopli/blob/HEAD/lib/quality.ts)). shopli בחר ב-90 כרצפה וב-94 ומעלה כתג "מומלץ". מדריכי קונים מציבים 95% כרף מקובל, ממליצים על חנות שפתוחה יותר משנה (חלקם אומרים 3 שנים ומעלה), ומזהירים מפני חנויות חדשות שנפתחו מחדש כדי למחוק היסטוריה שלילית ([itigic](https://itigic.com/how-to-choose-the-most-reliable-aliexpress-sellers/); [Wise](https://wise.com/us/blog/how-to-find-aliexpress-suppliers)). לרשימה השחורה של מילים בכותרות כדאי להכניס "replica", "1:1", "toy" ו"for parts" ([ExpressVPN](https://expressvpn.com/blog/aliexpress-scams/)), וגם נפחי אחסון לא הגיוניים. הדוגמה המוכרת היא "SSD של 32TB" ב-21 ליש"ט שהתברר כ-98GB ([SlashGear](https://www.slashgear.com/2247483/cheap-2tb-usb-flash-drive-think-twice-before-buying/); [TechRadar](https://www.techradar.com/news/buyers-beware-fake-64tb-128tb-ssds-flooding-online-marketplaces)).

את בדיקת המחיר מריצים על המועמדים **שכבר עברו סינון רלוונטיות**. אחרת כיסויים וכבלים מורידים את החציון, והמוצר האמיתי נראה יקר מדי. הכלי הוא גדרות Tukey: מחיר מעל Q3 + 1.5·IQR מסומן כמופקע ([CodeSignal](https://codesignal.com/learn/courses/measuring-spread-with-range-and-iqr/lessons/outliers-and-spread-measures); [Pricefx](https://knowledge.pricefx.com/accelerators-documentation-2/latest/accelerators/accelerate-agents/business-user-reference-agents/configure-deployed-agents-agents/definition-step-agents/measures-best-practices-agents/outliers-too-high-values)). מחיר מתחת לכ-0.3 מהחציון מקבל קנס כ"טוב מכדי להיות אמיתי". את הסף של 0.3 תצטרך לכייל בעצמך. צריך לפחות כ-8 מועמדים רלוונטיים כדי שהרבעונים יהיו בעלי משמעות. תעלול נפוץ נוסף הוא **פיתיון וריאנטים**: הרשימה מציגה מטען נייד, והמחיר המפורסם הוא של כבל זול באותה רשימה ([ExpressVPN](https://expressvpn.com/blog/aliexpress-scams/)). הנחה של 80% ומעלה מעידה בדרך כלל על "מחיר מקורי" מנופח, ולא כדאי לתגמל אותה.

הנוסחה המומלצת להתחלה, שתכייל על נתונים שלך:

| רכיב | חישוב | משקל |
|---|---|---|
| משוב חיובי | Wilson על `evaluate_rate`. כשמספר הביקורות לא ידוע: כיווץ `(p·n + 0.9·20)/(n + 20)` | 0.35 |
| כוכבים (אם קיימים) | בייסיאני עם C≈4.5, m≈50, מנורמל: `(R_adj − 4.0)/1.0` | 0.25 |
| מכירות | `log10(1+orders)/log10(10001)`: עשר מכירות → 0.26, אלף → 0.75 | 0.25 |
| חנות (אם קיים מ-DS) | דירוגי משנה, ותוספת לחנות רשמית או TMALL | 0.15 |
| **ציון סופי** | `רלוונטי? × (0.7·אמון + 0.3·ציון מחיר)` | |

הכלל החשוב בטבלה: **כשנתון חסר, מוציאים את הרכיב שלו ומנרמלים את המשקלים של השאר. לא מציבים אפס**. אחרת כל מוצר שאין לו נתוני DS נענש בלי סיבה. זו המלצת תכנון שלי, לא תקן שפורסם. הערכים C=4.5 ו-m=50 הם הנחות עבודה, לא נתון שפורסם על עלי אקספרס. אותו דבר לגבי היחס בין הזמנות לביקורות. אותם צריך לחשב מתוך מאגר המועמדים שלך. ועוד עניין של ניסוח: גם כשהבוט מסנן היטב, אל תכתוב "סיננו מוצרים עם ביקורות רעות". ההיסטוגרמה של עלי אקספרס עצמה מסוננת ולא אמינה לטענה כזו ([shopli](https://github.com/ohadf2015/shopli/blob/HEAD/lib/reviews.ts)).

## בינה מלאכותית עושה ארבע עבודות קטנות, בעשירית סנט

כל בוטי החיפוש העבריים שנמצאו מתרגמים את השאילתה לאנגלית לפני הקריאה ל-API. ההבדל ביניהם הוא באיכות. tzahi1715 משתמש ב-endpoint לא רשמי של Google Translate ובמילון ידני של מגדר וצבעים, ובוחר עמוד אקראי ומיון אקראי. התוצאה פוגעת ברלוונטיות ואי אפשר לשחזר אותה ([bot.py](https://github.com/tzahi1715-cpu/aliexpress-telegram-bot/blob/HEAD/bot.py)). omerxxben משתמש ב-Gemini 2.5 Flash-Lite עם הנחיה לתרגם "למונחים שמוכרים בעלי אקספרס משתמשים בהם", ואחר כך מריץ סינון רלוונטיות קפדני שפוסל אביזרים וחלקים ([ai_manager.py](https://github.com/omerxxben/telegram_bot/blob/HEAD/Classes/ai_manager.py)). זה הדפוס הנכון, עם באג חמור אחד: כשה-JSON מהמודל לא מתפרסר, המשתמש מקבל "אין תוצאות". צריך להפוך את ההתנהגות (fail open): אם ה-AI נכשל, מחזירים את המוצרים המובילים לפי ציון האמון.

לכן ממליצים על **שתי קריאות למודל קטן בכל חיפוש**. הקריאה הראשונה מפרקת את הבקשה העברית ל-JSON מובנה: `keywords_en`, `alt_keywords_en`, `must_have` (כמו "500ml" או "USB-C"), `exclude` (כמו "case" כשמבקשים את המכשיר עצמו), `max_price_ils`, ודגל `is_ambiguous` עם שאלת הבהרה בעברית. את ההמרה משקלים לדולרים עושים בקוד, כדי שהשער יהיה קבוע וצפוי. הקריאה השנייה מקבלת כ-30–40 מועמדים בשורות קצרות (`id|כותרת|מחיר`). המועמדים כבר ממוינים לפי ציון האמון, כדי לצמצם הטיית מיקום. המודל מחזיר לכל אחד רלוונטיות 0/1/2, סוג בעיה ("accessory", "variant_bait", "replica") וכותרת עברית קצרה. מחקר על חיפוש מוצרים מצא שמודלי שפה מסכימים עם שופטים אנושיים ב-**85–89%** על מדדי nDCG ([arXiv 2406.00247](https://arxiv.org/pdf/2406.00247)). את שתי הקריאות כדאי להריץ עם structured outputs (`output_config.format` מסוג `json_schema`), כדי שהתשובה תמיד תתפרסר ([Claude structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)).

הכותרות העבריות חשובות יותר ממה שנראה. `target_language=HE` מחזיר תרגום מכונה מילולי של כותרות עמוסות מילות מפתח, למשל "TIMEMORE צרפתי עיתונות עיתונות, מכונת קפה תה", ובעיני דובר עברית זה נראה כמו ספאם ([shopli hebrew-titles.ts](https://github.com/ohadf2015/shopli/blob/HEAD/lib/hebrew-titles.ts)). הפתרון הוא כותרת של עד כ-6 מילים שכוללת את המפרט המרכזי ומשאירה שמות מותג ודגם באנגלית. שומרים אותה במטמון לפי `product_id`.

לחיפוש לפי תמונה הדרך הזולה והפשוטה היא מודל vision שמתאר את התמונה באותה סכמת JSON של שאילתת טקסט. את התיאור מריצים דרך אותו צינור חיפוש רגיל. לוקחים מתוך `Message.photo` גודל של כ-800–1000 פיקסלים, מורידים אותו בשרת ושולחים כ-base64. **אסור לשלוח לספק ה-AI את כתובת הקובץ של טלגרם**, כי היא כוללת את טוקן הבוט ([Bot API](https://core.telegram.org/bots/api)). תמונה של 1000×1000 עולה כ-1,300 טוקנים, כלומר כ-0.13 סנט ב-Haiku 4.5 ([Claude vision](https://platform.claude.com/docs/en/build-with-claude/vision)), ובערך עשירית מזה ב-Gemini 2.5 Flash-Lite ([Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing)). אם תקבל גישת DS, אפשר לשלב גם את `ds.image.search`, שמחפש לפי דמיון ויזואלי ולא דרך תיאור מילולי.

| מודל | מחיר לכל מיליון טוקנים (קלט/פלט) | עלות משוערת לחיפוש טקסט |
|---|---|---|
| Claude Haiku 5.5 | ‎$0.10 / $0.50 | כ-0.06 סנט |
| Claude Haiku 4.5 | ‎$1 / $5 | כ-0.6 סנט |
| Gemini 2.5 Flash-Lite | ‎$0.10 / $0.40 | כ-0.05 סנט |

מקורות המחירים: ([Claude pricing](https://platform.claude.com/docs/en/docs/about-claude/pricing); [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing)). העלויות לחיפוש הן חישוב שלי לפי כ-2,400 טוקני קלט ו-720 טוקני פלט. גם ב-1,000 חיפושים בחודש מדובר בפחות מ-6 דולר על המודל היקר שבטבלה. לא אימתתי ש-Haiku 5.5 תומך ב-vision. בדוק את זה לפני שאתה מסתמך עליו לחיפוש תמונות.

## בטלגרם: הודעה אחת לכל חיפוש, ומצב הפרטיות חוסם את "חפש לי"

המגבלה הראשונה שתפגוש היא **מצב הפרטיות (Privacy Mode)**. כברירת מחדל, בוט בקבוצה רואה רק פקודות שמופנות אליו ותגובות להודעות שלו. הודעה רגילה שמתחילה ב"חפש לי" פשוט לא מגיעה אליו ([Bot features](https://core.telegram.org/bots/features#privacy-mode)). יש שני פתרונות: להפוך את הבוט למנהל בקבוצה, או לכבות את מצב הפרטיות ב-BotFather ולהוסיף את הבוט לקבוצה מחדש. בשני המקרים הבוט מקבל כל הודעה בקבוצה, ולכן תנאי טלגרם מחייבים לא לשמור שום דבר מעבר להכרחי ([Telegram Bot Developer ToS](https://telegram.org/tos/bot-developers)). אותו דבר נכון לתמונות: תמונה רגילה בקבוצה לא תגיע לבוט במצב פרטיות. במצב הזה הטריגרים המעשיים הם כיתוב `/find` על התמונה, או `/find` כתגובה לתמונה של מישהו אחר.

המגבלה השנייה היא **20 הודעות בוט לדקה בקבוצה** ([Bots FAQ](https://core.telegram.org/bots/faq)). לכן כל חיפוש צריך לעלות הודעה אחת: `sendPhoto` עם הקולאז', כיתוב, ו-inline keyboard של 4 כפתורי קישור. אלבום (`sendMediaGroup`) לא מתאים, כי אי אפשר לצרף אליו כפתורים ([Bot API](https://core.telegram.org/bots/api#sendmediagroup)). אף בוט שנבדק לא השתמש בו. הכיתוב מוגבל ל-**1,024 תווים** ([sendPhoto](https://core.telegram.org/bots/api#sendphoto)). זה מספיק ל-4 שורות של כותרת קצרה, מחיר ודירוג, אבל לא לקישורים ארוכים, ולכן הקישורים יושבים בכפתורים ("1 · ₪45"). שולחים את התשובה עם `reply_parameters` ו-`allow_sending_without_reply: true`, ושולחים `sendChatAction('upload_photo')` מחדש כל 4 שניות, כי הסטטוס פג אחרי 5 ([Bot API](https://core.telegram.org/bots/api)).

כך יכול להיראות כיתוב (המספרים להמחשה בלבד):

```
‏🔎 בקבוק מים תרמי 500 מ"ל
‏1. בקבוק נירוסטה תרמי 500 מ"ל · ‎₪42
‏   ⭐ 4.8 (1,234 ביקורות) · 3,000+ נמכרו
‏2. ...
‏ℹ️ קישורי שותפים: רכישה דרכם עשויה לזכות אותנו בעמלה, ללא עלות נוספת לך. המחירים משוערים.
```

הסימן הבלתי נראה בתחילת כל שורה הוא U+200F (Right-to-Left Mark). טלגרם קובע את כיוון השורה לפי התו החזק הראשון בה, ולכן שורה שמתחילה בספרה או בשם מותג לטיני עלולה להיות מוצגת משמאל לימין. זו התנהגות כללית של bidi ב-Unicode ולא תיעוד רשמי של טלגרם, אז בדוק את התצוגה ב-iOS, ב-Android ובדסקטופ. אם אין נתוני DS, כתוב "96% משוב חיובי" ואל תמיר את האחוז לכוכבים. ismailsaoulaj עשה בדיוק את הטעות הזו: הוא הריץ `float()` על "96.5%", קיבל 0, ושורת הדירוג וגם 30% מהציון נעלמו בלי שום שגיאה ([deals_api.py](https://github.com/ismailsaoulaj/aliexpress-affiliate-bot/blob/HEAD/deals_api.py)).

את הקולאז' בונים ב-Node.js עם **sharp**. מורידים 4 תמונות במקביל עם timeout, מקטינים כל אחת לאריח של 400×400, מרכיבים אותן על קנבס של 800×800, ומוסיפים תגי ספרות כ-SVG. התוצר הוא JPEG ושולחים אותו ישר מהזיכרון ([sharp composite](https://sharp.pixelplumbing.com/api-composite)). sharp מהיר בערך פי 20 מ-Jimp לפי מדידה לא רשמית ([sharp vs jimp](https://peterbe.com/plog/sharp-vs-jimp)). בגלל קריאה מימין לשמאל, מספר 1 בפינה הימנית העליונה. זה מה ש-omerxxben עושה, בגרסת Python עם Pillow ([image_grid_creator.py](https://github.com/omerxxben/telegram_bot/blob/HEAD/Classes/image_grid_creator.py)). אצלו התמונות יורדות אחת אחרי השנייה, ואם קובץ מדליה חסר הקוד קורס. את שתי הבעיות האלה צריך לתקן. ספרות בתגים חוסכות את הצורך בגופן עברי בתוך התמונה. אם בכל זאת תרצה עברית בתמונה, תצטרך לצרף גופן כמו Heebo, כי ב-Docker מינימלי אין גופנים עבריים.

התנהגות בקבוצה: הבוט **שותק** מול כל הודעה שאינה טריגר. omerxxben עונה בהודעת עזרה על כל הודעה בקבוצה, ו-tzahi1715 מריץ חיפוש על כל הודעה, ושני הדברים הם ספאם ([telegram_bot_manager.py](https://github.com/omerxxben/telegram_bot/blob/HEAD/Telegram/telegram_bot_manager.py); [bot.py](https://github.com/tzahi1715-cpu/aliexpress-telegram-bot/blob/HEAD/bot.py)). משתמשים ב-`@grammyjs/ratelimiter` עם הגבלה של כ-3 חיפושים לדקה למשתמש ותקציב של כ-15 לדקה לקבוצה, וב-`@grammyjs/auto-retry` כדי לכבד שגיאות 429. כדי שחיפוש איטי אחד לא יתקע את כל הקבוצה, מריצים עם `@grammyjs/runner` ([grammY ratelimiter](https://grammy.dev/plugins/ratelimiter); [grammY auto-retry](https://grammy.dev/plugins/auto-retry); [grammY deployment](https://grammy.dev/guide/deployment-types)). מהבוט של omerxxben כדאי לאמץ את ההגבלה שרק מי שביקש את החיפוש יכול ללחוץ על "עוד תוצאות" ([telegram_bot_manager.py](https://github.com/omerxxben/telegram_bot/blob/HEAD/Telegram/telegram_bot_manager.py)).

## הארכיטקטורה המומלצת

הטכנולוגיות: **Node.js/TypeScript עם grammY, ae_sdk ו-sharp**, בתהליך long polling אחד. הסיבה העיקרית היא ש-ae_sdk תומך גם ב-Affiliate API וגם ב-DS API, ומתוחזק (עדכון אחרון ב-20.10.2026). לעומתו, ספריית ה-Python הפופולרית python-aliexpress-api לא תומכת ב-DS בכלל ([ae_sdk repo](https://github.com/moh3a/ae_sdk); [issue #44](https://github.com/sergioteula/python-aliexpress-api/issues/44)). אם תעדיף Python כדי להעתיק מ-omerxxben, תצטרך לכתוב את החתימה של קריאות ה-DS בעצמך, כמו שהוא עשה.

| שלב | מה קורה | פרטים חשובים |
|---|---|---|
| 1. טריגר | ההודעה מתחילה ב"חפש לי"/"מצא לי", או `/find`, או תמונה עם כיתוב או כתגובה | הבוט מנהל בקבוצה; בודקים rate limit למשתמש ולקבוצה |
| 2. פירוק שאילתה (AI) | עברית → JSON עם מילות מפתח באנגלית, אילוצים, מחיר בשקלים | מטמון לפי שאילתה מנורמלת; המרת מטבע בקוד |
| 3. שליפה | 2 קריאות `product.query` במקביל (מילות מפתח עיקריות + חלופיות), `LAST_VOLUME_DESC`, `ship_to_country=IL`, `page_size=50`, `tracking_id` | ב-`ApiCallLimit`: חתימה מחדש וניסיון חוזר אחרי כ-1.2 שניות; עד 4 קריאות במקביל |
| 4. סינון קשיח | `evaluate_rate ≥ 90`, לפחות כ-10 מכירות, רשימה שחורה, כללי אחסון | לפרסר את ה-"%" בזהירות |
| 5. רלוונטיות + כותרות (AI) | 30–40 מועמדים → רלוונטיות 0/1/2 וכותרת עברית | אם נכשל: הצג את המובילים לפי ציון אמון |
| 6. שפיות מחיר | גדרות IQR על הרלוונטיים בלבד | רק כשיש לפחות 8 מועמדים |
| 7. העשרה | `ds.product.get` רק ל-6–8 המובילים; אם אין, feedback endpoint; אם גם הוא לא זמין, אחוז משוב | מטמון ליום לפי `product_id` |
| 8. ציון סופי | נוסחת האמון + מחיר → 4 מוצרים | רכיב חסר → נרמול מחדש |
| 9. קישורים | `link.generate` בקריאה אחת, מכתובות `/item/{id}.html` נקיות | `promotion_link_type=2` למוצרים חמים |
| 10. קולאז' | sharp, 800×800, תגים מימין לשמאל, תמונות ממוזערות | `Promise.allSettled` + אריח אפור כגיבוי |
| 11. שליחה | `sendPhoto` כתגובה + כיתוב + 4 כפתורים + גילוי נאות | שמירת `file_id` לשליחה חוזרת מיידית |

שלב 7 הוא ההחלטה המרכזית בתכנון. omerxxben קורא ל-DS API לכל מוצר שעבר את סינון ה-AI. זה בזבזני וחושף אותו יותר למגבלת הקצב ([main.py](https://github.com/omerxxben/telegram_bot/blob/HEAD/main.py)). shopli בחר במכוון לא להתנות את הסינון ב-feedback endpoint, כי תלות כזו "הופכת אחר צהריים רע אחד ב-feedback.aliexpress.com לדפים ריקים באתר כולו" ([shopli quality.ts](https://github.com/ohadf2015/shopli/blob/HEAD/lib/quality.ts)). העיקרון הוא אותו עיקרון: **הסינון והדירוג נשענים רק על שדות ה-Affiliate הרשמיים. הכוכבים והביקורות הם תוספת לתצוגה ולשיפור הציון, ולא תנאי להצגת תוצאה**.

לאחסון: Railway Hobby (5 דולר לחודש, כולל 5 דולר שימוש) הוא הפשוט ביותר למתחיל, עם פריסה מגיטהאב וממשק למשתני סביבה. Fly.io זול יותר, 2.19–3.69 דולר לחודש למכונה של 256–512MB, אבל דורש Dockerfile ([Railway](https://railway.com/pricing); [Fly.io](https://docs.fly.io/about/pricing)). Render חינמי לא מתאים: Background worker בתוכנית החינמית לא נתמך, ושירות web חינמי נרדם אחרי 15 דקות בלי תעבורה ([Render](https://render.com/docs/free)). Vercel ופונקציות serverless מסוכנים כאן: לווב-הוק יש חלון של 10 שניות, וחיפוש עם תמונה עלול לחרוג ממנו ולגרום לתשובות כפולות ([grammY deployment](https://grammy.dev/guide/deployment-types)). מכונה אחת בלבד: שני מופעים שמושכים עדכונים עם אותו טוקן יקבלו `409 Conflict`. למטמון מספיק `lru-cache` בזיכרון. תוצאות נשמרות כ-30 דקות, כי המחירים משתנים, ונתוני DS וקישורי שותפים כיום. Redis נדרש רק אם יש כמה מופעים ([grammY ratelimiter](https://grammy.dev/plugins/ratelimiter)).

| רכיב עלות | לחודש, בערך 1,000 חיפושים |
|---|---|
| אחסון | ‎$2–5 |
| AI (טקסט + מעט תמונות) | ‎$0.5–7, לפי המודל |
| AliExpress API | חינם |
| **סה"כ** | **כ-‎$3–12** |

## ציות לחוק: גילוי נאות בעברית בכל הודעה

הדין הישראלי דורש שתוכן פרסומי בתמורה יסומן **במפורש, בעברית, ובאופן בולט כבר במבט ראשון**, בלי שהקורא יצטרך לעשות פעולה נוספת. אחרת התוכן עלול להיחשב מטעה לפי חוק הגנת הצרכן, והחשיפה העיקרית היא לתובענות ייצוגיות. כך עולה מחוות דעת של היועץ המשפטי לממשלה כפי שתוארה ב-Calcalist ([Calcalist](https://www.calcalist.co.il/local_news/article/r1i11ewsin)). הכלל חל גם על הטבות שאינן תשלום ישיר. אף מקור שנמצא לא מתייחס במפורש לעמלות שותפים, ולכן ההחלה עליהן היא היסק. היסק סביר, אבל עדיין היסק. לכן שורת הגילוי צריכה להופיע בתוך הכיתוב עצמו, ולא מאחורי כפתור. גם תיאור הבוט ב-BotFather ו-`/start` צריכים לכלול אותה. כדאי להוסיף שהמחירים משוערים, כי מחירים ומשלוחים בעלי אקספרס משתנים, וחוק הגנת הצרכן עוסק גם במחיר מטעה. דוגמה הפוכה: tzahi1715 כותב "🚚 משלוח חינם!" ו"⏰ מלאי מוגבל" על כל מוצר בלי שום קשר לנתונים ([bot.py](https://github.com/tzahi1715-cpu/aliexpress-telegram-bot/blob/HEAD/bot.py)).

תנאי המפתחים של טלגרם אוסרים ספאם (5.2b), מיתוג שמטעה לגבי תפקיד הבוט (5.2d) ועקיפה של מגבלות הקצב (5.2f). הם מחייבים מדיניות פרטיות נגישה ומזעור נתונים (סעיף 4), והפרה עלולה להוביל לחסימה זמנית או קבועה ([Telegram Bot Developer ToS](https://telegram.org/tos/bot-developers)). בפועל: לא לקרוא לבוט "AliExpress Official", לשמור מזהי צ'אט ולא שמות, ולשמור מזהי משתמש מגובבים (hashed) רק לצורך הגבלת קצב. לגבי תנאי AliExpress Portals עצמם, לא הצלחתי לקרוא את הטקסט הרשמי שלהם על בוטים ואפליקציות מסרים, ורשימות של רשתות שותפים סותרות זו את זו בשאלה אם תנועה ממדיה חברתית מותרת ([Cuelinks](https://www.cuelinks.com/campaigns/aliexpress-affiliate-program); [Awin](https://ui.awin.com/merchant-profile-terms/26009)). שני דברים נמצאים באזור אפור שכדאי לבדוק מול התמיכה של AliExpress: מעבר בין שני מפתחות אפליקציה כדי לעקוף מגבלות, כמו ש-omerxxben עושה, ושימוש ב-feedback endpoint הלא מתועד. לא מצאתי דיווח על חשבון שותפים שנחסם בגלל בוט טלגרם. כל זה איננו ייעוץ משפטי, ולפני מונטיזציה רחבה שווה להתייעץ עם עורך דין.

## המלכודות שהפילו בוטים קיימים

| מלכודת | מה קרה | מה עושים |
|---|---|---|
| סודות בקוד | טוקן בוט, מפתחות AliExpress ו-DS token גלויים במאגרים ציבוריים ([MiilouDz](https://github.com/MiilouDz/Aliexpress-Affiliate-Telegram-Bot/blob/HEAD/bot.py); [omerxxben](https://github.com/omerxxben/telegram_bot/blob/HEAD/Classes/ali_epress_api_products.py)) | רק משתני סביבה; אם טוקן דלף, מחליפים אותו ב-BotFather |
| מגבלת קצב כ"אין תוצאות" | כ-10% מהקריאות מחזירות `ApiCallLimit`, ונשמרו במטמון כ"מוצר לא נמצא" ([shopli](https://github.com/ohadf2015/shopli/blob/HEAD/lib/aliexpress.ts)) | חתימה מחדש וניסיון חוזר; שגיאה לעולם לא נשמרת במטמון |
| 401 אקראי | "This publisher is not registered" מופיע ונעלם ([issue #34](https://github.com/sergioteula/python-aliexpress-api/issues/34)) | ניסיון חוזר והודעה ידידותית למשתמש |
| חסימת לולאת האירועים | צינור סינכרוני בתוך handler אסינכרוני תוקע את כל הצ'אטים ([omerxxben](https://github.com/omerxxben/telegram_bot/blob/HEAD/Telegram/telegram_bot_manager.py)) | grammY runner + הגבלת מספר חיפושים מקבילים |
| מטבע שגוי | מחירים באירו תחת כותרת של ₪ ([shopli](https://github.com/ohadf2015/shopli/blob/HEAD/lib/aliexpress.ts)) | USD מה-API, המרה בקוד, בדיקה אוטומטית |
| שער קבוע | המרה לפי 3.7 קבוע ([tzahi1715](https://github.com/tzahi1715-cpu/aliexpress-telegram-bot/blob/HEAD/bot.py)) | שער יומי מעודכן |
| קישור של מתחרה | קישור שהמשתמש הדביק כבר כולל תג שותפים | פענוח הפניות, חילוץ ID, בניית `/item/{id}.html` נקי ([djeddi12](https://github.com/djeddi12/Aliexpress-telegram-bot/blob/HEAD/app.py)) |
| מעט ביקורות | "4.9 על 12 הזמנות זה לא 4.9 על 12,000" ([Aliexpress-Israel-Skills](https://github.com/danielrosehill/Aliexpress-Israel-Skills/blob/HEAD/skills/fetch-listing/SKILL.md)) | כיווץ בייסיאני/Wilson |

## ההחלטות שעליך לקבל

| החלטה | אפשרויות | ההמלצה שלי |
|---|---|---|
| **מאיפה מגיעים כוכבים ומספר ביקורות** | (א) להגיש בקשה ל-DS API: רשמי וחתום, אבל אפליקציה נפרדת, OAuth token ומדיניות שילוב לא ברורה. (ב) ה-feedback endpoint: בלי מפתח, אבל לא מתועד, עלול להיחסם, ויש בו שני מכנים שונים. (ג) בלי כוכבים, רק "96% משוב חיובי" | להגיש בקשה ל-DS כבר עכשיו ולהשתמש בו כמקור ראשי; feedback endpoint רק כגיבוי; עד שיש אישור, (ג) ביושר |
| **בקשת Advanced API** | להגיש עכשיו או לוותר | להגיש עכשיו: מוצרים חמים ועמלה גבוהה יותר |
| **חיפוש לפי תמונה** | מודל vision → מילות מפתח, או `ds.image.search` (דורש DS), או Apify בתשלום (מ-2 דולר ל-1,000 תוצאות, [Apify](https://apify.com/bokgoon/aliexpress-image-search/api)) | להתחיל עם vision; להוסיף `ds.image.search` אם תקבל גישת DS |
| **איך הבוט שומע את "חפש לי"** | מנהל בקבוצה או כיבוי מצב פרטיות (רואה הכול), או רק `/find` ותגובות לבוט | מנהל בקבוצה, עם שתיקה מוחלטת מול כל מה שאינו טריגר |
| **ספק AI** | Claude Haiku 5.5 / 4.5 או Gemini 2.5 Flash-Lite | מודל זול (Haiku 5.5 או Flash-Lite), אחרי בדיקת vision במודל שבחרת |
| **שפה ותשתית** | Node.js + ae_sdk או Python בעקבות omerxxben | Node.js, בגלל תמיכת ae_sdk ב-DS |
| **אחסון** | Railway ($5) / Fly.io ($2–4) / VPS | Railway למתחיל |
| **איפה הקישורים** | 4 כפתורים מתחת לקולאז', או הודעת טקסט נפרדת | כפתורים: הודעה אחת לחיפוש |

## סיכום

המסקנה העיקרית היא שבוט אמין נבנה סביב הנתונים שבאמת קיימים, ולא סביב הנתונים שהיינו רוצים. כמעט כל הבוטים בתחום הם ממירי קישורים שהועתקו ממדריכי יוטיוב, והבוט עם הכי הרבה כוכבים בגיטהאב (40) מכיל קוד שבור ([MiilouDz](https://github.com/MiilouDz/Aliexpress-Affiliate-Telegram-Bot/blob/HEAD/bot.py)). לכן הרף נמוך, ובוט שעושה את הבסיס כמו שצריך יבלוט מיד. הבסיס הוא סינון לפי אחוז משוב, כיווץ סטטיסטי, בדיקת מחיר אחרי סינון רלוונטיות, כותרות עבריות טבעיות, AI שנופל בעדינות כשהוא נכשל, והודעה אחת לכל חיפוש.

ההחלטה עם ההשפעה הגדולה ביותר היא הבקשה לגישת DS. מעבר לכוכבים וביקורות, היא פותחת גם חיפוש תמונה רשמי, ציוני חנות ושם חנות. כדאי להגיש אותה ביום הראשון, במקביל לבנייה, כדי שהאישור לא יעכב את ההשקה. ויש כמה שאלות שרק בדיקה חיה תענה עליהן: האם ILS מתקבל, על איזה חלון זמן `lastest_volume` נמדד, האם `evaluation_count` סופר ביקורות טקסט או את כל הדירוגים, והאם AliExpress מתירה להציג נתוני DS לצד קישורי שותפים. כדאי לבדוק אותן מול ה-API האמיתי ומול התמיכה לפני שהבוט מגיע לקבוצה.
