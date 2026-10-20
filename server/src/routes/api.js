import express from "express";
import { config } from "../config.js";
import { log, getActivity } from "../logger.js";
import { requireAuth, checkPassword, issueToken } from "./auth.js";
import { createRateLimiter } from "../util/rateLimit.js";
import { toAppError } from "../util/errors.js";
import { llmQueue, llmHealth } from "../llm/client.js";
import { runAssistant } from "../bot/assistant.js";
import { clearHistory } from "../store/history.js";
import { listUsers, addUser, removeUser, adminNumbers } from "../store/users.js";
import { getSchema, schemaSummary } from "../db/schema.js";
import { invalidateCatalog } from "../db/catalog.js";
import { collectHealth } from "../health.js";
import {
  setWebhook,
  evolutionEnabled,
  ensureInstance,
  fetchInstance,
  connectInstance,
  logoutInstance,
} from "../whatsapp/evolution.js";
import { normalizePhone } from "../util/phone.js";

export const apiRouter = express.Router();

const chatLimiter = createRateLimiter({ limit: config.llm.rateLimitPerMin });
const loginLimiter = createRateLimiter({ limit: 5 });

// ---- auth -------------------------------------------------------------
apiRouter.post("/auth/login", (req, res) => {
  const rl = loginLimiter.check(req.ip);
  if (!rl.ok) return res.set("Retry-After", String(rl.retryAfterSec)).status(429).json({ error: "Too many attempts" });
  if (!config.adminPassword) return res.status(503).json({ error: "Login disabled: ADMIN_PASSWORD is not set" });
  if (!checkPassword(req.body?.password)) return res.status(401).json({ error: "Wrong password" });
  res.json({ token: issueToken("admin"), expiresInHours: config.sessionTtlHours });
});

apiRouter.get("/auth/me", requireAuth, (req, res) => res.json({ user: req.user.sub }));

// ---- health -----------------------------------------------------------
// Public, minimal: only says whether the model is ready.
apiRouter.get("/chat/health", async (_req, res) => {
  const h = await llmHealth();
  res.status(h.ok ? 200 : 503).json({
    ok: h.ok,
    provider: h.provider,
    model: h.model,
    modelPresent: Boolean(h.modelPresent),
  });
});

apiRouter.get("/status", requireAuth, async (_req, res) => {
  const health = await collectHealth();
  res.json({
    ...health,
    config: {
      botName: config.bot.name,
      provider: health.llm?.provider || config.llm.provider,
      model: health.llm?.model || config.llm.model,
      googleModel: config.llm.googleModel,
      localModel: config.llm.model,
      fallback: config.llm.fallback,
      reasoningEffort: config.llm.reasoningEffort,
      maxTokens: config.llm.botMaxTokens,
      rateLimitPerMin: config.llm.rateLimitPerMin,
      sttProvider: config.stt.provider,
      evolutionInstance: config.evolution.instance,
      webhookUrl: webhookUrl(),
      adminNumbers: adminNumbers(),
    },
  });
});

// ---- chat (SSE) -------------------------------------------------------
apiRouter.post("/chat", requireAuth, async (req, res) => {
  const message = String(req.body?.message || "").trim();
  const sessionId = String(req.body?.sessionId || "default").slice(0, 64);
  if (!message) return res.status(400).json({ error: "Message is required" });
  if (message.length > config.llm.maxUserChars)
    return res.status(413).json({ error: `Message is too long (max ${config.llm.maxUserChars} characters)` });

  const rl = chatLimiter.check(`${req.user.sub}:${req.ip}`);
  if (!rl.ok)
    return res.set("Retry-After", String(rl.retryAfterSec)).status(429).json({ error: "Slow down, please try again shortly." });

  const ac = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) ac.abort();
  });

  // Take the queue slot before opening the stream so "busy" is a real 503.
  let release;
  try {
    release = await llmQueue.acquire(ac.signal);
  } catch (err) {
    const e = toAppError(err);
    if (e.code === "aborted") return;
    if (e.retryAfterSec) res.set("Retry-After", String(e.retryAfterSec));
    return res.status(e.status).json({ error: e.userMessage });
  }

  res.set({
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  const ping = setInterval(() => res.write(": ping\n\n"), 15000);

  try {
    const result = await runAssistant({
      text: message,
      historyKey: `web:${sessionId}`,
      signal: ac.signal,
      release,
      onToken: (token) => send("token", { token }),
      onStatus: (status) => send("status", { status }),
    });
    send("done", { action: result.action, sql: result.sql, rowCount: result.rowCount, ms: result.ms });
  } catch (err) {
    const e = toAppError(err);
    if (e.code !== "aborted") {
      log.error(`Web chat failed [${e.code}]:`, err.cause || err);
      send("error", { code: e.code, message: e.userMessage });
    }
  } finally {
    clearInterval(ping);
    res.end();
  }
});

apiRouter.post("/chat/reset", requireAuth, (req, res) => {
  clearHistory(`web:${String(req.body?.sessionId || "default").slice(0, 64)}`);
  res.json({ ok: true });
});

// ---- WhatsApp users ---------------------------------------------------
apiRouter.get("/users", requireAuth, (_req, res) => {
  res.json({ admins: adminNumbers(), users: listUsers() });
});

apiRouter.post("/users", requireAuth, (req, res) => {
  const r = addUser(req.body?.phone, { name: String(req.body?.name || "").slice(0, 60), addedBy: "dashboard" });
  if (!r.ok) return res.status(400).json({ error: r.error });
  res.status(r.existed ? 200 : 201).json(r);
});

apiRouter.delete("/users/:phone", requireAuth, (req, res) => {
  const r = removeUser(req.params.phone);
  if (!r.ok) return res.status(r.error?.startsWith("Admin") ? 400 : 404).json({ error: r.error });
  clearHistory(r.phone);
  res.json(r);
});

// ---- activity / schema / webhook ---------------------------------------
apiRouter.get("/activity", requireAuth, (req, res) => {
  res.json({ items: getActivity(Math.min(Number(req.query.limit) || 100, 200)) });
});

apiRouter.get("/schema", requireAuth, async (_req, res) => {
  res.json(schemaSummary(await getSchema()));
});

apiRouter.post("/schema/refresh", requireAuth, async (_req, res) => {
  invalidateCatalog();
  res.json(schemaSummary(await getSchema({ refresh: true })));
});

export function webhookUrl() {
  if (!config.publicUrl || !config.evolution.webhookSecret) return null;
  return `${config.publicUrl}/webhook/evolution/${config.evolution.webhookSecret}`;
}

apiRouter.post("/whatsapp/webhook", requireAuth, async (_req, res) => {
  const url = webhookUrl();
  if (!evolutionEnabled() || !url)
    return res.status(400).json({ error: "Set EVOLUTION_*, PUBLIC_URL and WEBHOOK_SECRET first" });
  try {
    await setWebhook(url);
    res.json({ ok: true, url: url.replace(config.evolution.webhookSecret, "***") });
  } catch (err) {
    log.error("setWebhook failed:", err.message, err.body);
    res.status(502).json({ error: "Evolution API rejected the webhook update" });
  }
});

// ---- WhatsApp linking (QR / pairing code) -------------------------------
function evoError(res, err, what) {
  log.error(`${what} failed:`, err.message, err.body ?? "");
  const unreachable = !err.status;
  res.status(502).json({ error: unreachable ? "Evolution API is not reachable yet. Is it running?" : `${what} failed` });
}

apiRouter.get("/whatsapp", requireAuth, async (_req, res) => {
  if (!evolutionEnabled()) return res.json({ configured: false });
  try {
    const instance = await fetchInstance();
    res.json({
      configured: true,
      instanceName: config.evolution.instance,
      exists: Boolean(instance),
      state: instance?.state ?? "missing",
      phone: instance?.ownerJid ? normalizePhone(instance.ownerJid, "") : null,
      profileName: instance?.profileName ?? null,
      profilePicUrl: instance?.profilePicUrl ?? null,
    });
  } catch (err) {
    evoError(res, err, "Reading WhatsApp status");
  }
});

apiRouter.post("/whatsapp/connect", requireAuth, async (req, res) => {
  if (!evolutionEnabled()) return res.status(400).json({ error: "Evolution API is not configured" });
  let number = null;
  if (req.body?.number) {
    number = normalizePhone(req.body.number);
    if (!number) return res.status(400).json({ error: "Invalid phone number" });
  }
  try {
    await ensureInstance(webhookUrl());
    res.json(await connectInstance(number));
  } catch (err) {
    evoError(res, err, "Starting WhatsApp link");
  }
});

apiRouter.post("/whatsapp/logout", requireAuth, async (_req, res) => {
  if (!evolutionEnabled()) return res.status(400).json({ error: "Evolution API is not configured" });
  try {
    await logoutInstance();
    res.json({ ok: true });
  } catch (err) {
    evoError(res, err, "Logging out");
  }
});
