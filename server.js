// HTTP server: /health always; /webhook only in webhook mode, verified via the X-Telegram-Bot-Api-Secret-Token header.
import { createHash, timingSafeEqual } from "node:crypto";
import express from "express";
import { webhookCallback } from "grammy";
import { isMockMode } from "./aliexpress.js";

// Timing-safe: both sides hashed to the same length first.
const sameKey = (got, want) => typeof got === "string" && timingSafeEqual(createHash("sha256").update(got).digest(), createHash("sha256").update(want).digest());

// reels: the Reels approve bot's update handler (reels.js), or null when its token isn't set on the server.
// decideSecret: AURA_DECIDE_SECRET, the key AURA sends to /reels/decide (unset: that endpoint answers 503).
export function createApp({ bot, mode, webhookSecret, reels = null, decideSecret = process.env.AURA_DECIDE_SECRET }) {
  const app = express();
  app.disable("x-powered-by");
  app.get("/health", (_req, res) => res.json({ ok: true, mode, mock: isMockMode() }));
  if (webhookSecret) {
    // onTimeout "return": answer Telegram fast and keep working, so a slow search isn't redelivered and answered twice.
    app.post("/webhook", express.json(), webhookCallback(bot, "express", { secretToken: webhookSecret, onTimeout: "return" }));
  }
  if (webhookSecret && reels) {
    // Answered at once: publishing a Reel takes minutes, and Telegram resends an update it isn't answered for.
    app.post("/reels", express.json(), (req, res) => {
      if (req.get("X-Telegram-Bot-Api-Secret-Token") !== webhookSecret) return res.sendStatus(401);
      res.sendStatus(200);
      Promise.resolve(reels(req.body)).catch((e) => console.error(`reels: ${e.message}`));
    });
    // AURA approves or rejects a reel: { id, action: "approve" | "reject" } with header x-aura-key. The same decide() as the
    // Telegram button, so the row is claimed once. Answered as soon as the row is claimed (publishing takes minutes).
    app.post("/reels/decide", express.json(), async (req, res) => {
      if (!decideSecret) return res.sendStatus(503);
      if (!sameKey(req.get("x-aura-key"), decideSecret)) return res.sendStatus(403);
      const id = ["number", "string"].includes(typeof req.body?.id) ? Number(req.body.id) : NaN; // a bigserial may come as a string
      const action = req.body?.action;
      if (!Number.isSafeInteger(id) || id < 1 || !["approve", "reject"].includes(action)) return res.status(400).json({ ok: false, error: "want { id, action: approve | reject }" });
      const reply = (body) => res.headersSent || res.json(body);
      try {
        const r = await reels.decide({ id }, action, "aura", { answer: async () => reply({ ok: true }) });
        reply(r.already ? { ok: true, already: true } : { ok: true });
      } catch (e) {
        console.error(`reels/decide ${id}: ${e.message}`);
        if (!res.headersSent) res.status(502).json({ ok: false, error: "not decided" });
      }
    });
  }
  return app;
}

// Keep-awake window (Israel time): the free server sleeps after 15 idle minutes. Awake 05:00-03:00 fits the 750 free
// monthly hours shared with the owner's other services (24/7 would stop them all until the month ends).
export const isAwakeHour = (date = new Date()) => {
  const h = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jerusalem", hour: "numeric", hourCycle: "h23" }).format(date));
  return h >= 5 || h < 3;
};

// The nightly digest goes out in the 10 minutes from 02:30 Israel time, before the server sleeps (memory resets then).
export const isDigestTime = (date = new Date()) => {
  const [h, m] = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jerusalem", hour: "numeric", minute: "numeric", hourCycle: "h23" }).format(date).split(":").map(Number);
  return h === 2 && m >= 30 && m < 40;
};

