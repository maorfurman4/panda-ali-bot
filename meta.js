// Publishes a finished Reel (mp4 bytes) to Instagram @panda_dilim and the Facebook Page "פנדה דילים" through Meta's Graph
// API, uploading the file itself (resumable upload: no public URL needed). Steps as in Meta's docs, read 2026-11-14:
//   Instagram: developers.facebook.com/docs/instagram-platform/content-publishing/resumable-uploads
//   Facebook:  developers.facebook.com/docs/video-api/guides/reels-publishing (3-90 s, 9:16, AAC 48 kHz, 30 a day)
// One platform failing never stops the other. Errors carry Meta's message, never the token.
const GRAPH = "https://graph.facebook.com/v27.0";
const RUPLOAD = "https://rupload.facebook.com";
const IG_WAIT_MS = 10_000; // Instagram processes the video before it can be published
const IG_WAIT_TRIES = 30; // up to 5 minutes

async function call(fetch, url, { token, json, headers = {}, body, method = json || body ? "POST" : "GET" } = {}) {
  const res = await fetch(url, {
    method,
    headers: { Authorization: token.startsWith("OAuth ") ? token : `Bearer ${token}`, ...(json ? { "content-type": "application/json" } : {}), ...headers },
    ...(json ? { body: JSON.stringify(json) } : body ? { body } : {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error(data.error?.message ?? `HTTP ${res.status}`);
  return data;
}

const upload = (fetch, url, token, bytes) =>
  call(fetch, url, { token: `OAuth ${token}`, body: bytes, headers: { offset: "0", file_size: String(bytes.length), "content-type": "application/octet-stream" } });

async function instagram(bytes, caption, { fetch, token, igId, sleep }) {
  const container = await call(fetch, `${GRAPH}/${igId}/media`, { token, json: { media_type: "REELS", upload_type: "resumable", caption } });
  await upload(fetch, container.uri ?? `${RUPLOAD}/ig-api-upload/v27.0/${container.id}`, token, bytes);
  for (let i = 0; i < IG_WAIT_TRIES; i++) {
    const { status_code: s } = await call(fetch, `${GRAPH}/${container.id}?fields=status_code`, { token });
    if (s === "FINISHED") return { id: (await call(fetch, `${GRAPH}/${igId}/media_publish`, { token, json: { creation_id: container.id } })).id };
    if (s === "ERROR" || s === "EXPIRED") throw new Error(`Instagram processing ${s}`);
    await sleep(IG_WAIT_MS);
  }
  throw new Error("Instagram still processing after 5 minutes");
}

async function facebook(bytes, caption, { fetch, token, pageId }) {
  const start = await call(fetch, `${GRAPH}/${pageId}/video_reels`, { token, json: { upload_phase: "start", access_token: token } });
  await upload(fetch, start.upload_url ?? `${RUPLOAD}/video-upload/v27.0/${start.video_id}`, token, bytes);
  await call(fetch, `${GRAPH}/${pageId}/video_reels`, { token, json: { upload_phase: "finish", video_id: start.video_id, video_state: "PUBLISHED", description: caption, access_token: token } });
  return { id: start.video_id };
}

// only: "facebook" on a retry, so a platform already published isn't posted twice.
export async function publishReel(bytes, caption, { fetch = globalThis.fetch, token, igId, pageId, only = null, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const missing = !token ? "META_PAGE_TOKEN" : null;
  const jobs = { instagram: () => (igId ? instagram(bytes, caption, { fetch, token, igId, sleep }) : Promise.reject(new Error("META_IG_ID is missing"))), facebook: () => (pageId ? facebook(bytes, caption, { fetch, token, pageId }) : Promise.reject(new Error("META_PAGE_ID is missing"))) };
  const names = Object.keys(jobs).filter((p) => !only || p === only);
  const settled = await Promise.allSettled(names.map((p) => (missing ? Promise.reject(new Error(`${missing} is missing`)) : jobs[p]())));
  const clean = (m) => (token ? String(m).split(token).join("***") : String(m));
  return Object.fromEntries(names.map((p, i) => [p, settled[i].status === "fulfilled" ? { ok: true, id: settled[i].value.id } : { ok: false, error: clean(settled[i].reason?.message ?? "error") }]));
}
