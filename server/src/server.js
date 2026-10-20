import fs from "node:fs";
import path from "node:path";
import express from "express";
import { config, configWarnings } from "./config.js";
import { log } from "./logger.js";
import { apiRouter, webhookUrl } from "./routes/api.js";
import { webhookRouter } from "./routes/webhook.js";
import { getSchema } from "./db/schema.js";
import { closePool, dbEnabled } from "./db/pool.js";
import { flushUsers } from "./store/users.js";
import { ensureInstance, evolutionEnabled } from "./whatsapp/evolution.js";

const app = express();
app.set("trust proxy", 1);
app.disable("x-powered-by");

// Webhook payloads can carry base64 audio, so allow a larger body there.
app.use("/webhook", express.json({ limit: "25mb" }), webhookRouter);
app.use("/api", express.json({ limit: "100kb" }), apiRouter);
app.get("/healthz", (_req, res) => res.json({ ok: true }));

// React dashboard (built into web/dist)
if (fs.existsSync(path.join(config.webDist, "index.html"))) {
  app.use(express.static(config.webDist, { index: false, maxAge: "1h" }));
  app.get(/^\/(?!api|webhook).*/, (_req, res) => res.sendFile(path.join(config.webDist, "index.html")));
} else {
  log.warn(`Dashboard not found at ${config.webDist}. Run "npm run build" in web/.`);
}

app.use((err, _req, res, _next) => {
  log.error("Unhandled route error:", err);
  if (res.headersSent) return res.end();
  res.status(err.status || 500).json({ error: err.status === 413 ? "Payload too large" : "Internal error" });
});

const server = app.listen(config.port, () => {
  log.info(`wappbot listening on :${config.port}`);
  for (const w of configWarnings()) log.warn(w);
  if (dbEnabled()) getSchema();
  if (config.evolution.autoSetWebhook && evolutionEnabled()) setupWhatsApp();
});

// Evolution may still be starting (it waits for Postgres/Redis), so retry for a while.
async function setupWhatsApp(attempt = 1) {
  try {
    const { created } = await ensureInstance(webhookUrl());
    log.info(`Evolution instance "${config.evolution.instance}" ${created ? "created" : "found"}, webhook set`);
    if (created) log.info("Open the dashboard → WhatsApp to link a phone.");
  } catch (err) {
    if (attempt >= 40) return log.error("Giving up on Evolution setup:", err.message);
    log.warn(`Evolution not ready (${err.message}), retrying in 15s [${attempt}/40]`);
    setTimeout(() => setupWhatsApp(attempt + 1), 15000).unref();
  }
}

async function shutdown(sig) {
  log.info(`${sig} received, shutting down`);
  flushUsers();
  server.close();
  await closePool();
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("unhandledRejection", (err) => log.error("Unhandled rejection:", err));
