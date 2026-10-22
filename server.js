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
