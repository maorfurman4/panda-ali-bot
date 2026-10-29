// HTTP server: /health always; /webhook only in webhook mode, verified via the X-Telegram-Bot-Api-Secret-Token header.
import express from "express";
import { webhookCallback } from "grammy";
import { isMockMode } from "./aliexpress.js";

export function createApp({ bot, mode, webhookSecret }) {
  const app = express();
  app.disable("x-powered-by");
  app.get("/health", (_req, res) => res.json({ ok: true, mode, mock: isMockMode() }));
  if (webhookSecret) {
    // onTimeout "return": answer Telegram fast and keep working, so a slow search isn't redelivered and answered twice.
    app.post("/webhook", express.json(), webhookCallback(bot, "express", { secretToken: webhookSecret, onTimeout: "return" }));
  }
  return app;
}

// Keep-awake window (Israel time): the free server sleeps after 15 idle minutes. Awake 05:00-03:00 fits the 750 free
// monthly hours shared with the owner's other services (24/7 would stop them all until the month ends).
export const isAwakeHour = (date = new Date()) => {
  const h = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jerusalem", hour: "numeric", hourCycle: "h23" }).format(date));
  return h >= 5 || h < 3;
};

