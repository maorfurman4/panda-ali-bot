// 50 "people" write to the REAL bot in the group (real AI + AliExpress; Telegram calls intercepted), each in their own
// style. Records what the bot answered (card / question / refusal / hint / silence), and an independent judge (gpt-5.5)
// checks every card's products. Shows defects real members would hit.
// Usage: npm run eval:personas [-- --set 2]
import { createBot } from "../bot.js";
import { createRelevanceFilter } from "../query.js";
import { isMockMode } from "../aliexpress.js";
import { createStats } from "../stats.js";

if (!process.env.OPENAI_API_KEY || isMockMode()) {
  console.log("Needs OPENAI_API_KEY and the ALI_* keys in .env.");
  process.exit(0);
}
const judge = createRelevanceFilter({ env: { ...process.env, OPENAI_RELEVANCE_MODEL: "gpt-5.5" } });

// [who, message, what a person would expect]
const PEOPLE = [
  ["סבתא עם שגיאות", "חפס לי משקפי קריעה", "משקפי קריאה"],
  ["ילד בסלנג", "חפש לי סקין לפורטנייט אחי", "לא מוצר / הסבר"],
  ["ממהר", "חפש לי מטען", "מטענים"],
  ["אמא עייפה", "חפש לי משהו שירדים את התינוק", "שאלה או מוצרי הרדמה"],
  ["דובר אנגלית", "find me wireless earbuds", "אוזניות"],
  ["דובר רוסית", "найди мне чехол для айфона 15", "כיסוי לאייפון 15"],
  ["דובר ערבית", "ابحث لي عن ساعة ذكية", "שעון חכם"],
  ["אימוג'י", "חפש לי 🎧", "אוזניות"],
  ["הודעה קולית ארוכה", "תחפש לי בבקשה איזה מנורה כזאת ליד המיטה שאפשר לשלוט בה מהטלפון ושתהיה לה גם אור צהוב חם כי האור הלבן מעייף לי את העיניים", "מנורת לילה חכמה"],
  ["צייד מחירים", "חפש לי אוזניות עד 20 שקל", "אוזניות עד ₪20"],
  ["צייד מחירים 2", "חפש לי שעון חכם בין 100 ל 200", "שעון חכם 100-200"],
  ["מחיר בדולר", "חפש לי מקלדת מכנית עד 30 דולר", "מקלדת מכנית עד ~₪111"],
  ["מותג קיים", "חפש לי אוזניות של שיאומי", "Xiaomi"],
  ["מותג יוקרה", "חפש לי תיק של שאנל", "תיק / לא מדויק"],
  ["מידה", "חפש לי נעלי ריצה לנשים מידה 38", "נעלי ריצה לנשים"],
  ["צבע", "חפש לי כיסוי לגלקסי S24 בצבע סגול", "כיסוי סגול"],
  ["מתנה", "חפש לי מתנה לבעלי", "שאלה"],
  ["שאלה טבעית", "מישהו מכיר שואב אבק רובוטי טוב?", "שואבים רובוטיים"],
  ["המלצה", "יש המלצה על מצלמת דרך?", "מצלמות דרך"],
  ["בלי חפש לי", "אוזניות אלחוטיות", "הודעה קבועה"],
  ["צ'אט", "בוקר טוב לכולם מה שלומכם", "הודעה קבועה"],
  ["תודה", "תודה רבה!!", "הודעה קבועה / שתיקה"],
  ["שואל על משלוח", "כמה זמן לוקח משלוח לישראל?", "הודעה קבועה"],
  ["ספאמר", "הצטרפו לערוץ שלי t.me/cheap_deals_now", "מחיקה + אזהרה"],
  ["מפרסם קישור", "תראו מה מצאתי https://he.aliexpress.com/item/1005008148860952.html", "שתיקה"],
  ["תיוג הבוט", "@panda_test_bot כבל לאייפון", "כבלים"],
  ["פקודה", "/search usb hub", "מפצלי USB"],
  ["עזרה", "עזרה", "הסבר"],
  ["עזרה 2", "איך זה עובד?", "הסבר"],
  ["אסור", "חפש לי אקדח הלם", "סירוב"],
  ["אסור 2", "חפש לי וייפ", "סירוב"],
  ["מותר דומה", "חפש לי סכין למטבח", "סכיני מטבח"],
  ["ספציפי מאוד", "חפש לי מעמד לאוזניות גיימינג עם תאורת RGB ומפצל USB", "מעמד אוזניות RGB"],
  ["מוצר נדיר", "חפש לי מכונת וופל בצורת לב", "מכונת וופל לב"],
  ["רהיט", "חפש לי שולחן מחשב מתכוונן", "שולחנות"],
  ["כבד", "חפש לי אופניים חשמליים", "אופניים חשמליים / יקר"],
  ["ילדים", "חפש לי צעצוע לילד בן 3", "צעצועים לגיל 3"],
  ["תינוק", "חפש לי מוצץ לתינוק", "מוצצים"],
  ["חיות", "חפש לי צעצוע לחתול", "צעצועי חתול"],
  ["רכב", "חפש לי שואב אבק לרכב", "שואב אבק לרכב"],
  ["כלי עבודה", "חפש לי מברגה נטענת 12V", "מברגות"],
  ["אופנה", "חפש לי מעיל פוך לגבר", "מעילי פוך"],
  ["טיפוח", "חפש לי מסכת פנים לשיער", "לא ברור / מסכת שיער"],
  ["גיימר", "חפש לי שלט לפלייסטיישן 5", "שלטים ל-PS5"],
  ["מזון", "חפש לי שוקולד בלגי", "הודעת מזון"],
  ["שגיאת מקלדת", "jpa kh nturb", "?"],
  ["הכל באותיות", "חפשליאוזניות", "אוזניות או הודעה"],
  ["רק חפש לי", "חפש לי", "מה לחפש?"],
  ["סימני שאלה", "חפש לי????", "מה לחפש?"],
  ["כפול", "חפש לי מטען לרכב וגם כבל לאייפון", "אחד מהם או שניהם"],
];

// A second, different set of 50 for edge cases: npm run eval:personas -- --set 2
const PEOPLE_2 = [
  ["מספרים במילים", "חפש לי אוזניות עד עשרים שקל", "אוזניות זולות"],
  ["הכי זול", "חפש לי את המטען הכי זול", "מטענים זולים"],
  ["איכותי", "חפש לי רמקול איכותי באמת", "רמקולים טובים"],
  ["שלילה", "חפש לי כיסוי לאייפון 15 לא שקוף", "כיסוי צבעוני"],
  ["דגם מדויק", "חפש לי כבל לאייפון 16 פרו מקס", "כבלים לאייפון 16"],
  ["קיצור", "חפש לי שלט ps5", "שלט PS5"],
  ["גלקסי", "חפש לי מגן מסך לגלקסי s23", "מגני מסך S23"],
  ["אנגלית בעברית", "חפש לי איירפודס פרו", "אוזניות בסגנון AirPods"],
  ["מעורב", "חפש לי power bank 20000 קטן", "סוללות ניידות"],
  ["כמות", "חפש לי 2 כבלים לאנדרואיד", "כבלים"],
  ["מידה בסמ", "חפש לי מגבת רחצה 70 על 140", "מגבות"],
  ["גיל", "חפש לי מתנה לבן 10", "שאלה"],
  ["אירוע", "חפש לי קישוטים לבר מצווה", "קישוטים"],
  ["עונה", "חפש לי מאוורר נייד לקיץ", "מאווררים ניידים"],
  ["פנייה נקבית", "תמצאי לי שמלת כלה", "שמלות כלה"],
  ["פנייה ברבים", "תמצאו לנו אוהל לקמפינג", "אוהלים"],
  ["דחוף", "דחוף!!! חפש לי מטען לאייפון", "מטענים"],
  ["אחי", "אחי תחפש לי שעון כזה של גברים שווה", "שעוני גברים"],
  ["בא לי", "בא לי לקנות רולר לפנים", "רולר לפנים"],
  ["השוואה", "מה עדיף שיאומי או סמסונג?", "הודעה קבועה / שתיקה"],
  ["שואל מחיר", "כמה עולה אייפון 16 באלי?", "הודעה קבועה"],
  ["תלונה", "הבוט לא מבין כלום", "הודעה קבועה"],
  ["תודה לבוט", "תודה פנדה!", "הודעה קבועה"],
  ["רק תיוג", "@panda_test_bot", "מה לחפש?"],
  ["תיוג באמצע", "היי @panda_test_bot תמצא לי מטען", "לא חיפוש / הודעה"],
  ["קישור אמזון", "https://www.amazon.com/dp/B0CHX1W1XY", "שתיקה"],
  ["קישור עלי אחרי תיוג", "@panda_test_bot https://he.aliexpress.com/item/1005008148860952.html", "קישור מומר"],
  ["אימוג'י רצף", "😂😂😂", "הודעה קבועה"],
  ["מספר טלפון", "תתקשרו אליי 0501234567", "הודעה קבועה"],
  ["אנגלית מלאה", "search for gaming mouse rgb", "עכברי גיימינג"],
  ["אנגלית שגויה", "find me hedphones", "אוזניות"],
  ["ספרדית", "busca auriculares", "הודעה קבועה"],
  ["ערבית מעורבת", "دور لي على شاحن ايفون", "מטענים לאייפון"],
  ["אות סופית", "חפש לי מעיל חורף לנשים בצבע שחורך", "מעיל שחור"],
  ["אותיות כפולות", "חפששש ליי אוזנייות", "אוזניות"],
  ["רווחים", "חפש    לי     כבל", "כבלים"],
  ["נקודה", "חפש לי. מנורה", "מנורות"],
  ["שורה חדשה", "חפש לי\nמנורת לילה", "מנורות לילה"],
  ["מתנה מצחיקה", "חפש לי מתנה מצחיקה לחבר", "שאלה או מתנות מצחיקות"],
  ["תחפושת", "חפש לי תחפושת לפורים לילד", "תחפושות"],
  ["כלי נגינה", "חפש לי גיטרה קלאסית", "גיטרות / יקר"],
  ["ספורט", "חפש לי כדורסל מקצועי", "כדורסל"],
  ["דייג", "חפש לי חכה לדייג", "חכות"],
  ["גינה", "חפש לי צינור השקיה מתכווץ", "צינורות"],
  ["בריאות", "חפש לי מד לחץ דם", "מדי לחץ דם"],
  ["תרופה", "חפש לי אקמול", "סירוב"],
  ["נשק צעצוע", "חפש לי רובה נרף", "רובי נרף"],
  ["מבוגרים עקיף", "חפש לי הלבשה תחתונה סקסית", "סירוב או הלבשה"],
  ["תכשיט ספציפי", "חפש לי טבעת כסף 925 עם אבן כחולה", "טבעות כסף כחולות"],
  ["רכב ספציפי", "חפש לי כיסויים למושבים של טויוטה קורולה", "כיסויי מושב"],
];
const set2 = process.argv.includes("--set") && process.argv[process.argv.indexOf("--set") + 1] === "2";

const rows = [];
let uid = 1000;
for (const [who, text, expect] of set2 ? PEOPLE_2 : PEOPLE) {
  const userId = ++uid;
  const calls = [];
  const bot = createBot({
    token: "123:SIM", botInfo: { id: 42, is_bot: true, first_name: "Panda", username: "panda_test_bot", can_join_groups: true, can_read_all_group_messages: true, supports_inline_queries: false, can_connect_to_business: false, has_main_web_app: false },
    collage: async () => null, stats: createStats(), adminId: "1", groupId: null, cooldownMs: 0,
  });
  bot.api.config.use(async (_prev, method, payload) => {
    calls.push({ method, payload });
    const isSend = method === "sendMessage" || method === "sendPhoto";
    return { ok: true, result: isSend ? { message_id: 999, date: 0, chat: { id: payload.chat_id, type: "supergroup" } } : method === "getChatAdministrators" ? [] : true };
  });
  const command = text.match(/^\/\S+/);
  const t = Date.now();
  await bot.handleUpdate({
    update_id: uid,
    message: { message_id: uid, date: 0, chat: { id: -100123, type: "supergroup", title: "G" }, from: { id: userId, is_bot: false, first_name: "U" }, text, ...(command ? { entities: [{ type: "bot_command", offset: 0, length: command[0].length }] } : {}) },
  }).catch((e) => calls.push({ method: "ERROR", payload: { text: e.message } }));
  const s = ((Date.now() - t) / 1000).toFixed(1);
  const sent = calls.filter((c) => (c.method === "sendMessage" && !/מחפש לכם/.test(c.payload.text)) || c.method === "sendPhoto");
  const body = (m) => (m.payload.text ?? m.payload.caption ?? "").replace(/‏/g, "");
  let outcome = "silence", detail = "", judged = "";
  const card = sent.find((m) => m.method === "sendPhoto" || /🥇/.test(body(m)));
  if (calls.some((c) => c.method === "deleteMessage" && c.payload.message_id === uid)) outcome = "deleted";
  if (card) {
    const b = body(card);
    const titles = [...b.matchAll(/(?:🥇|🥈|🥉|4️⃣) ([^\n]+)/g)].map((m) => m[1].replace(/<[^>]+>/g, ""));
    outcome = `card ${titles.length}`;
    detail = b.split("\n")[0].replace(/<[^>]+>/g, "") + (/לא מצאתי התאמה מדויקת/.test(b) ? " [no exact]" : "");
    const v = await judge({ he: text, en: "" }, titles.map((product_title) => ({ product_title })));
    judged = `${v.exact.length + v.partial.length}/${titles.length}`;
  } else if (sent.length) {
    const b = body(sent[0]);
    outcome = sent[0].payload.reply_markup?.inline_keyboard?.length && /🤔/.test(b) ? "question" : "text";
    detail = b.replace(/<[^>]+>/g, "").split("\n")[0].slice(0, 60);
  }
  if (calls.some((c) => c.method === "ERROR")) outcome = "ERROR";
  rows.push({ who, text: text.slice(0, 34), expect, outcome, judged, detail: detail.slice(0, 50), s });
  console.error(`${who}: ${outcome} ${judged} (${s}s)`);
}
console.table(rows);
