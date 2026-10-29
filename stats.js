// Health counters + owner alerts, so silent failures (like a deprecated AI model) are noticed within minutes.
// shortcut: in memory only, resets when the free server sleeps; persist to a database if long-term stats are needed.
const ALERT_WINDOW_MS = 10 * 60_000;
const ALERT_AFTER = 3;
const ALERT_EVERY_MS = 60 * 60_000;

export function createStats({ now = Date.now, notify = null } = {}) {
  const startedAt = now();
  const counters = {};
  const lastError = {};
  const recent = {};
  const lastAlert = {};
  const lists = {};
  let lastDigest = { at: startedAt, counters: {} };

  return {
    setNotifier(fn) {
      notify = fn;
    },
    count(name) {
      counters[name] = (counters[name] ?? 0) + 1;
    },
    // Keeps the last 10 items of a list (e.g. searches that got 👎), newest first.
    remember(name, text) {
      lists[name] = [{ text, at: now() }, ...(lists[name] ?? [])].slice(0, 30);
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
    digest() {
      const t = now(), since = lastDigest.at, prev = lastDigest.counters;
      const d = (k) => (counters[k] ?? 0) - (prev[k] ?? 0);
      const bad = (lists.thumbsDown ?? []).filter((x) => x.at > since).map((x) => x.text);
      lastDigest = { at: t, counters: { ...counters } };
      if (!d("search")) return null;
      return [
        "📊 סיכום יומי של הבוט",
        `🔎 חיפושים: ${d("search")} · ללא תוצאות: ${d("noResults")} · ♻️ מהזיכרון: ${d("cached")}`,
        `🎯 בול: ${d("thumbsUp")} · 🐼 לא זה: ${d("thumbsDown")} · 🔍 לחפש עוד: ${d("more")}`,
        ...(bad.length ? ["", "חיפושים שקיבלו 🐼 (כדאי לבדוק):", ...bad.map((b) => `• ${b}`)] : []),
      ].join("\n");
    },
    snapshot: () => ({ startedAt, counters: { ...counters }, lastError: { ...lastError }, lists: structuredClone(lists) }),
  };
}

export const stats = createStats();
