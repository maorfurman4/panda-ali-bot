// AURA HQ reporter for the Node bots (Node 18+). No dependencies. Copy this one file next to the bot's code.
//
// It writes one row per station event to Supabase (public.bot_events), which the office reads.
// Needs SUPABASE_URL and SUPABASE_SERVICE_KEY in the environment (or AURA_SUPABASE_URL and AURA_SUPABASE_KEY, which
// win when both exist); without them it does nothing.
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
//
// AI usage (round 5): after every model call, one line counts it for the station whose `working` block runs it (async
// work started inside the block counts too, even when several blocks run at once). The station's next "done" or
// "error" report carries the totals in metrics.ai; the office prices them. Only numbers are sent, never the prompt.
//
//   const resp = await openai.chat.completions.create({ model: 'gpt-5.4-mini', ... });
//   ai('gpt-5.4-mini', resp);                 // reads resp.usage (OpenAI, Anthropic, Gemini shapes all work)
import { AsyncLocalStorage } from 'node:async_hooks';
const STATUSES = ['idle', 'working', 'done', 'error'];

// Serverless bots (a webhook that must answer fast): call setBuffered(true) once, and `await flush()` once before the
// HTTP response goes out. Every report of the request then travels in ONE request instead of one each.
const openBlock = new AsyncLocalStorage();               // { bot, stationId } of the working block this code runs in
const usage = new Map();                                    // "bot/station" -> Map(model -> { calls, in, out, sec })
const LIMIT = /\b429\b|rate.?limit|quota|too many requests|resource.?exhausted/i;
function tokensOf(u) {
  for (const root of [u?.usage, u?.usage_metadata, u?.usageMetadata, u?.response?.usageMetadata, u]) {
    if (!root || typeof root !== 'object') continue;
    const i = root.prompt_tokens ?? root.input_tokens ?? root.promptTokenCount ?? root.prompt_token_count;
    const o = root.completion_tokens ?? root.output_tokens ?? root.candidatesTokenCount ?? root.candidates_token_count;
    if (i != null || o != null) return [Number(i) || 0, Number(o) || 0];
  }
  return [0, 0];
}
// Count one AI call for the station whose working block runs this code (or the given bot / station). Never throws.
export function ai(model, resp, { tokensIn, tokensOut, audioSeconds, bot, stationId } = {}) {
  try {
    const at = bot && stationId ? { bot, stationId } : openBlock.getStore();
    if (!at) return false;
    const [i, o] = resp != null ? tokensOf(resp) : [tokensIn, tokensOut];
    const key = `${at.bot}/${at.stationId}`, per = usage.get(key) || new Map(); usage.set(key, per);
    const m = per.get(String(model).slice(0, 60)) || { calls: 0, in: 0, out: 0, sec: 0 }; per.set(String(model).slice(0, 60), m);
    m.calls++; m.in += Number(i) || 0; m.out += Number(o) || 0; m.sec += Number(audioSeconds) || 0;
    return true;
  } catch { return false; }
}
function takeUsage(bot, stationId) {
  const per = usage.get(`${bot}/${stationId}`); if (!per) return null;
  usage.delete(`${bot}/${stationId}`);
  return [...per].map(([model, m]) => ({ model, calls: m.calls, in: m.in, out: m.out, ...(m.sec ? { sec: Math.round(m.sec * 10) / 10 } : {}) }));
}

let buffered = false;
const pending = [];
export const setBuffered = (on) => { buffered = !!on; };

// One line in the run's log, at the first report: is telemetry on, and if not, why.
let announced = false;
let quietUntil = 0; // after a failed report the office is left alone for a minute, so a bot never pays the timeout twice in a row
function announce(url, key) {
  if (announced) return;
  announced = true;
  const why = process.env.AURA_REPORT === 'off' ? 'AURA_REPORT=off' : !url ? 'missing SUPABASE_URL' : !key ? 'missing SUPABASE_SERVICE_KEY' : '';
  console.log(why ? `[AURA] Telemetry disabled: ${why}` : '[AURA] Telemetry enabled');
}

const config = () => ({
  // AURA_SUPABASE_URL / AURA_SUPABASE_KEY win, for a bot whose own SUPABASE_* variables point at another project
  url: process.env.AURA_SUPABASE_URL || process.env.SUPABASE_URL, key: process.env.AURA_SUPABASE_KEY || process.env.SUPABASE_SERVICE_KEY,
});

// One POST to the office: a row, or an array of rows (a bulk insert). Never throws.
async function send(payload, url, key) {
  try {
    const r = await fetch(`${url.replace(/\/$/, '')}/rest/v1/bot_events`, {
      method: 'POST', body: JSON.stringify(payload), signal: AbortSignal.timeout(2500),
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    });
    if (!r.ok) quietUntil = Date.now() + 60_000;
    return r.ok;
  } catch { quietUntil = Date.now() + 60_000; return false; }
}

export async function station(bot, stationId, status, headline, metrics, { handoffTo = null, workerType = null, buffer: toBuffer = buffered } = {}) {
  const { url, key } = config();
  announce(url, key); // at the first report, not at import: a script may switch reporting off after importing this file
  if (!url || !key || !STATUSES.includes(status) || process.env.AURA_REPORT === 'off' || Date.now() < quietUntil) return false;
  if (status === 'done' || status === 'error') { const used = takeUsage(bot, stationId); if (used) metrics = { ...(metrics || {}), ai: used }; }
  const row = {
    bot, kind: 'station', station_id: stationId, status, text: headline ? String(headline).slice(0, 300) : null,
    metrics: metrics || null, handoff_to: handoffTo, worker_type: workerType, run_id: process.env.GITHUB_RUN_ID || null,
  };
  if (toBuffer) { pending.push({ ...row, ts: new Date().toISOString() }); return true; } // the real moment, not the moment of the flush
  return send(row, url, key);
}

// Like station(), but always waits for flush().
export const buffer = (bot, stationId, status, headline, metrics, opts = {}) => station(bot, stationId, status, headline, metrics, { ...opts, buffer: true });

// Send everything buffered, in one request. Await it once, right before the webhook answers. Never throws.
export async function flush() {
  if (!pending.length) return true;
  const rows = pending.splice(0);
  const { url, key } = config();
  if (!url || !key || process.env.AURA_REPORT === 'off' || Date.now() < quietUntil) return false;
  return send(rows, url, key);
}

// An error's summary without what an error text can carry: URLs (a Telegram URL holds the bot token) and long tokens.
export function safeError(e) {
  const text = String(e?.message ?? e).replace(/https?:\/\/\S+/g, '[url]').replace(/\S{24,}/g, '[...]');
  return `${e?.name || 'Error'}: ${text}`.slice(0, 160);
}

export async function working(bot, stationId, headline, fn, opts) {
  let closed = false;
  const w = {
    update: (h, metrics) => station(bot, stationId, 'working', h, metrics, opts),
    done: (h, metrics, handoffTo) => { closed = true; return station(bot, stationId, 'done', h || headline, metrics, { ...opts, handoffTo }); },
  };
  await station(bot, stationId, 'working', headline, null, opts);
  try {
    const out = await openBlock.run({ bot, stationId }, () => fn(w));
    if (!closed) await w.done();
    return out;
  } catch (e) {
    await station(bot, stationId, 'error', safeError(e), LIMIT.test(String(e?.message ?? e)) ? { limit: true } : null, opts);
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
    assert.ok(!safeError(new Error('failed https://api.telegram.org/bot123:SECRETSECRET/send key=SECRETSECRETSECRETSECRETSECRET')).includes('SECRET'));
    quietUntil = 0;
    assert.equal(await buffer('yahli', 'parse', 'working', 'x'), true);
    assert.equal(await buffer('yahli', 'parse', 'done', 'y'), true);
    assert.equal(await flush(), false, 'a flush to an unreachable office fails quietly');
    assert.equal(await flush(), true, 'nothing left to send');
    // AI usage: counted per open block (two blocks at once stay apart), carried by the done report
    quietUntil = 0; pending.length = 0;
    const b = { buffer: true };
    await Promise.all([
      working('panda', 'judges', 'x', async () => { await new Promise((r) => setTimeout(r, 5)); ai('gpt-5.4', { usage: { prompt_tokens: 100, completion_tokens: 20 } }); ai('claude-sonnet-5-5', { usage: { input_tokens: 50, output_tokens: 10 } }); }, b),
      working('panda', 'understand', 'x', async () => { ai('gpt-5.4-mini', { usage: { input_tokens: 9, output_tokens: 1 } }); }, b),
    ]);
    const done = (id) => pending.find((r) => r.station_id === id && r.status === 'done');
    assert.deepEqual(done('judges').metrics.ai.map((m) => [m.model, m.calls, m.in, m.out]), [['gpt-5.4', 1, 100, 20], ['claude-sonnet-5-5', 1, 50, 10]]);
    assert.deepEqual(done('understand').metrics.ai.map((m) => [m.model, m.in]), [['gpt-5.4-mini', 9]]);
    assert.equal(ai('gpt-5.4', { usage: { prompt_tokens: 1 } }), false, 'outside a block nothing is counted');
    await assert.rejects(working('panda', 'fit', 'x', async () => { throw new Error('429 Too Many Requests'); }, b));
    assert.deepEqual(pending.at(-1).metrics, { limit: true });
    pending.length = 0;
    console.log('ok: aura-report');
  })();
}
