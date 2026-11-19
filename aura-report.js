// AURA HQ reporter for the Node bots (Node 18+). No dependencies. Copy this one file next to the bot's code.
//
// It writes one row per station event to Supabase (public.bot_events), which the office reads.
// Needs SUPABASE_URL and SUPABASE_SERVICE_KEY in the environment; without them it does nothing.
// It never throws and never waits more than 2.5 seconds: the office must not be able to break a bot.
//
//   import { working } from './aura-report.js';      (the Panda repo is an ES module project)
//
//   const items = await working('panda', 'scout', 'מחפש רבי-מכר', async (w) => {   // -> status "working"
//     const found = await searchBestSellers(topic);
//     w.done(`${found.length} מוצרים`, { found: found.length });                    // -> status "done" with real numbers
//     return found;
//   });
//   // an error inside reports status "error" and is thrown again, unchanged
//
// Station ids must match office/public/js/aura.config.js.
const STATUSES = ['idle', 'working', 'done', 'error'];

// One line in the run's log, at the first report: is telemetry on, and if not, why.
let announced = false;
function announce(url, key) {
  if (announced) return;
  announced = true;
  const why = process.env.AURA_REPORT === 'off' ? 'AURA_REPORT=off' : !url ? 'missing SUPABASE_URL' : !key ? 'missing SUPABASE_SERVICE_KEY' : '';
  console.log(why ? `[AURA] Telemetry disabled: ${why}` : '[AURA] Telemetry enabled');
}

export async function station(bot, stationId, status, headline, metrics, { handoffTo = null, workerType = null } = {}) {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_KEY;
  announce(url, key); // at the first report, not at import: a script may switch reporting off after importing this file
  if (!url || !key || !STATUSES.includes(status) || process.env.AURA_REPORT === 'off') return false;
  const row = {
    bot, kind: 'station', station_id: stationId, status, text: headline ? String(headline).slice(0, 300) : null,
    metrics: metrics || null, handoff_to: handoffTo, worker_type: workerType, run_id: process.env.GITHUB_RUN_ID || null,
  };
  try {
    const r = await fetch(`${url.replace(/\/$/, '')}/rest/v1/bot_events`, {
      method: 'POST', body: JSON.stringify(row), signal: AbortSignal.timeout(2500),
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    });
    return r.ok;
  } catch { return false; }
}

export async function working(bot, stationId, headline, fn, opts) {
  let closed = false;
  const w = {
    update: (h, metrics) => station(bot, stationId, 'working', h, metrics, opts),
    done: (h, metrics, handoffTo) => { closed = true; return station(bot, stationId, 'done', h || headline, metrics, { ...opts, handoffTo }); },
  };
  await station(bot, stationId, 'working', headline, null, opts);
  try {
    const out = await fn(w);
    if (!closed) await w.done();
    return out;
  } catch (e) {
    await station(bot, stationId, 'error', `${e?.name || 'Error'}: ${e?.message || e}`, null, opts);
    throw e;
  }
}

if (process.argv[1] && import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1]).href) {   // node aura-report.js : self-check, no network
  (async () => {
    const assert = (await import('node:assert/strict')).default;
    delete process.env.SUPABASE_URL;
    assert.equal(await station('panda', 'scout', 'working'), false, 'without keys it must do nothing');
    Object.assign(process.env, { SUPABASE_URL: 'http://127.0.0.1:9', SUPABASE_SERVICE_KEY: 'x' });
    assert.equal(await station('panda', 'scout', 'nonsense'), false);
    assert.equal(await station('panda', 'scout', 'working', 'x'), false, 'an unreachable office must not throw');
    assert.equal(await working('panda', 'scout', 'x', async () => 7), 7);
    await assert.rejects(working('panda', 'scout', 'x', async () => { throw new Error('boom'); }), /boom/);
    console.log('ok: aura-report');
  })();
}
