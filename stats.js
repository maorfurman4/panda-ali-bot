// Health counters + owner alerts, so silent failures (like a deprecated AI model) are noticed within minutes.
// shortcut: in memory only, resets when the free server sleeps; persist to a database if long-term stats are needed.
const ALERT_WINDOW_MS = 10 * 60_000;
const ALERT_AFTER = 3;
const ALERT_EVERY_MS = 60 * 60_000;
const REPORTS_PER_DAY = 20;

export function createStats({ now = Date.now, notify = null } = {}) {
  const startedAt = now();
  const counters = {};
  const lastError = {};
  const recent = {};
  const lastAlert = {};
  const lists = {};
  const reports = { day: "", sent: 0 };
  let lastDigest = { at: startedAt, counters: {} };

  return {
    setNotifier(fn) {
      notify = fn;
    },
    count(name, by = 1) {
      counters[name] = (counters[name] ?? 0) + by;
    },
    // Keeps the last 10 items of a list (e.g. searches that got 👎), newest first.
    remember(name, text) {
      lists[name] = [{ text, at: now() }, ...(lists[name] ?? [])].slice(0, 30);
    },
    // A search that went wrong (🐼 or no results), for fixing by pattern: kept for the digest AND sent to the owner at once,
    // since the in-memory digest list is lost on every deploy. At most REPORTS_PER_DAY messages a day.
    report(name, text) {
      this.remember(name, text);
      const day = new Date(now()).toISOString().slice(0, 10);
      if (reports.day !== day) Object.assign(reports, { day, sent: 0 });
      if (notify && reports.sent < REPORTS_PER_DAY) {
        reports.sent++;
        Promise.resolve(notify(text)).catch(() => {});
      }
    },
    // 3 failures of the same kind within 10 minutes alert the owner, at most once an hour per kind.
    failure(kind, detail) {
      const t = now();
      counters[`fail:${kind}`] = (counters[`fail:${kind}`] ?? 0) + 1;
      lastError[kind] = { detail, at: t };
      recent[kind] = (recent[kind] ?? []).filter((x) => t - x < ALERT_WINDOW_MS).concat(t);
      if (notify && recent[kind].length >= ALERT_AFTER && t - (lastAlert[kind] ?? -Infinity) > ALERT_EVERY_MS) {
        lastAlert[kind] = t;
        Promise.resolve(notify(`⚠️ תקלה חוזרת בבוט (${kind}): ${detail}\nבדקו /status`)).catch(() => {});
      }
    },
    // The day's summary for the owner: counts since the previous digest and the 🐼 searches in that time.
    // ">=": an item saved in the same millisecond the stats started was dropped (a flaky test, 2026-11-04).
    digest() {
      const t = now(), since = lastDigest.at, prev = lastDigest.counters;
      const d = (k) => (counters[k] ?? 0) - (prev[k] ?? 0);
      const bad = (lists.thumbsDown ?? []).filter((x) => x.at >= since).map((x) => x.text);
      const none = (lists.noResults ?? []).filter((x) => x.at >= since).map((x) => x.text);
      const weak = (lists.weak ?? []).filter((x) => x.at >= since).map((x) => x.text);
      lastDigest = { at: t, counters: { ...counters } };
      if (!d("search")) return null;
      return [
        "📊 סיכום יומי של הבוט",
        `🔎 חיפושים: ${d("search")} · ללא תוצאות: ${d("noResults")} · ♻️ מהזיכרון: ${d("cached")}`,
        `🎯 בול: ${d("thumbsUp")} · 🐼 לא זה: ${d("thumbsDown")} · 🔍 לחפש עוד: ${d("more")}`,
        `💰 עלות בינה מלאכותית: $${d("aiCost").toFixed(2)} (${((d("aiCost") * 100) / d("search")).toFixed(1)} סנט לחיפוש)`,
        ...(bad.length ? ["", "חיפושים שקיבלו 🐼 (כדאי לבדוק):", ...bad.map((b) => `• ${b}`)] : []),
        ...(none.length ? ["", "חיפושים בלי תוצאות:", ...none.map((b) => `• ${b}`)] : []),
        ...(weak.length ? ["", "חיפושים עם כרטיס חלש (מעט מכירות):", ...weak.map((b) => `• ${b}`)] : []),
      ].join("\n");
    },
    snapshot: () => ({ startedAt, counters: { ...counters }, lastError: { ...lastError }, lists: structuredClone(lists) }),
  };
}

export const stats = createStats();

// The money lines of the nightly digest (sent at 02:30, so "yesterday" is the day that just ended, Israel dates):
// affiliate orders yesterday and this month, and a note once the SKU API is approved. Amounts are USD cents.
export async function moneyReport({ listOrders, skuApproved, now = Date.now }) {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(now() - 86_400_000);
  const [orders, sku] = await Promise.all([listOrders(`${day.slice(0, 8)}01 00:00:00`, `${day} 23:59:59`).catch(() => null), skuApproved().catch(() => null)]);
  const usd = (list, key) => `$${(list.reduce((s, o) => s + Number(key(o) ?? 0), 0) / 100).toFixed(2)}`;
  const commission = (o) => o.estimated_finished_commission ?? o.estimated_paid_commission;
  const lines = [];
  if (!orders) lines.push("💵 לא הצלחתי לבדוק הזמנות הלילה");
  else {
    const fresh = orders.filter((o) => String(o.created_time).startsWith(day));
    lines.push(`💵 הזמנות אתמול: ${fresh.length}${fresh.length ? ` (עמלה צפויה ${usd(fresh, commission)})` : ""}`);
    lines.push(`📅 החודש: ${orders.length} הזמנות · ${usd(orders, (o) => o.paid_amount)} קניות · עמלה צפויה ${usd(orders, commission)}`);
  }
  if (sku) lines.push(`🔓 ה-SKU של עלי אקספרס אושר! אפשר להוסיף "החל מ-₪X" לפוסטים ולתוצאות`);
  return lines.join("\n");
}
