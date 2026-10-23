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

  return {
    setNotifier(fn) {
      notify = fn;
    },
    count(name) {
      counters[name] = (counters[name] ?? 0) + 1;
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
    snapshot: () => ({ startedAt, counters: { ...counters }, lastError: { ...lastError } }),
  };
}

export const stats = createStats();
