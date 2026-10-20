import express from "express";
import crypto from "node:crypto";
import { config } from "../config.js";
import { log, recordActivity } from "../logger.js";
import { handleIncoming } from "../whatsapp/handler.js";

export const webhookRouter = express.Router();

function secretOk(given) {
  const want = config.evolution.webhookSecret;
  if (!want) return true;
  const a = Buffer.from(String(given || ""));
  const b = Buffer.from(want);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Mounted at /webhook. Evolution posts to /webhook/evolution/<secret>; with "webhook by events" it appends /messages-upsert etc.
webhookRouter.post(["/evolution/:secret", "/evolution/:secret/:event"], (req, res) => {
  if (!secretOk(req.params.secret)) return res.sendStatus(401);
  res.sendStatus(200); // answer fast; work happens async

  const body = req.body || {};
  const event = String(body.event || req.params.event || "").toLowerCase().replace(/[_-]/g, ".");
  if (event === "connection.update") {
    const state = body.data?.state;
    log.info(`WhatsApp connection: ${state}`);
    recordActivity({ kind: "connection", status: state === "open" ? "ok" : String(state), text: `WhatsApp ${state}` });
    return;
  }
  if (event !== "messages.upsert") return;
  const items = Array.isArray(body.data) ? body.data : body.data?.messages || [body.data];
  for (const item of items) if (item) handleIncoming(item, body.instance);
  log.debug(`webhook ${event}: ${items.length} item(s)`);
});
