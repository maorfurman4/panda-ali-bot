// HTTP server: /health always; /webhook only in webhook mode, verified via the X-Telegram-Bot-Api-Secret-Token header.
import express from "express";
import { webhookCallback } from "grammy";
import { isMockMode } from "./aliexpress.js";

// reels: the Reels approve bot's update handler (reels.js), or null when its token isn't set on the server.
export function createApp({ bot, mode, webhookSecret, reels = null }) {
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

