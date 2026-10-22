import OpenAI from "openai";
import { config } from "../config.js";
import { createQueue } from "./queue.js";
import { isQuotaOrRateLimit } from "./failover.js";
import { log } from "../logger.js";

// Local models talk to Ollama's native /api/chat: it is the only API that lets us
// turn thinking off, raise num_ctx and keep the model loaded. Gemini uses the
// OpenAI-compatible endpoint.
const ollamaRoot = config.llm.baseUrl.replace(/\/v1$/, "");

const googleClient = config.llm.googleApiKey
  ? new OpenAI({
      baseURL: config.llm.googleBaseUrl,
      apiKey: config.llm.googleApiKey,
      timeout: config.llm.timeoutMs,
      maxRetries: 0,
    })
  : null;

let googleBlockedUntil = 0;
let lastUsedProvider = null;
let thinkSupported = true; // flips off if Ollama rejects the "think" field

export const llmQueue = createQueue({
  name: "llm",
  concurrency: config.llm.concurrency,
  maxQueue: config.llm.maxQueue,
});

export function googleCooldownMs() {
  return Math.max(0, googleBlockedUntil - Date.now());
}

function canUseGoogle() {
  return Boolean(googleClient && Date.now() >= googleBlockedUntil);
}

function canUseLocal() {
  return Boolean(config.llm.baseUrl);
}

/** Which backend will handle the next call. */
export function activeProvider() {
  const pref = config.llm.provider;
  if (pref !== "google" && pref !== "auto") return "local";
  if (canUseGoogle()) return "google";
  return config.llm.fallback === "local" && canUseLocal() ? "local" : "google";
}

export function modelFor(provider = activeProvider()) {
  return provider === "google" ? config.llm.googleModel : config.llm.model;
}

/** Remove <think>…</think> blocks that older Ollama builds leave in the content. */
export function stripThink(text) {
  return String(text || "")
    .replace(/<think>[\s\S]*?(<\/think>|$)/gi, "")
    .trim();
}

function withTimeout(signal) {
  const ac = new AbortController();
  const timer = setTimeout(() => {
    const e = new Error("LLM timeout");
    e.name = "TimeoutError";
    ac.abort(e);
  }, config.llm.timeoutMs);
  const onAbort = () => ac.abort(signal.reason);
  signal?.addEventListener("abort", onAbort, { once: true });
  return {
    signal: ac.signal,
    done: () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    },
    timedOut: () => ac.signal.reason?.name === "TimeoutError",
  };
}

function rethrow(err, t) {
  if (t.timedOut()) {
    const e = new Error("LLM timeout");
    e.name = "TimeoutError";
    throw e;
  }
  if (err?.name === "TypeError" && /fetch failed/i.test(err.message)) {
    const e = new Error("AI service unreachable");
    e.code = err.cause?.code || "ECONNREFUSED";
    throw e;
  }
  throw err;
}

// ---- Ollama native ------------------------------------------------------

function keepAlive() {
  const k = config.llm.keepAlive;
  return /^-?\d+$/.test(k) ? Number(k) : k;
}

function ollamaBody(messages, opts, stream) {
  const body = {
    model: config.llm.model,
    messages,
    stream,
    keep_alive: keepAlive(),
    options: {
      temperature: opts.temperature ?? config.llm.temperature,
      num_predict: opts.maxTokens ?? config.llm.maxTokens,
      num_ctx: config.llm.numCtx,
    },
  };
  if (thinkSupported) body.think = config.llm.think;
  if (opts.json) body.format = "json";
  return body;
}

async function ollamaFetch(messages, opts, stream, signal) {
  const send = () =>
    fetch(`${ollamaRoot}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(ollamaBody(messages, opts, stream)),
      signal,
    });
  let res = await send();
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    if (thinkSupported && res.status === 400 && /think/i.test(text)) {
      thinkSupported = false;
      log.info(`Model ${config.llm.model} has no thinking switch; continuing without it`);
      res = await send();
      if (res.ok) return res;
    }
    const e = new Error(`Ollama HTTP ${res.status}: ${text.slice(0, 200)}`);
    e.status = res.status;
    if (res.status === 404) e.code = "model_missing";
    throw e;
  }
  return res;
}

async function ollamaChat(messages, opts) {
  const t = withTimeout(opts.signal);
  try {
    const res = await ollamaFetch(messages, opts, false, t.signal);
    const body = await res.json();
    return stripThink(body.message?.content ?? "");
  } catch (err) {
    rethrow(err, t);
  } finally {
    t.done();
  }
}

async function* ollamaStream(messages, opts) {
  const t = withTimeout(opts.signal);
  try {
    const res = await ollamaFetch(messages, opts, true, t.signal);
    const decoder = new TextDecoder();
    let buf = "";
    // Hold tokens back while inside a <think> block.
    let pending = "";
    let inThink = false;
    let decided = false;
    const emit = function* (piece) {
      pending += piece;
      for (;;) {
        if (!decided) {
          const lead = pending.trimStart();
          if (lead.length < 7 && "<think>".startsWith(lead)) return;
          decided = true;
          if (lead.startsWith("<think>")) {
            inThink = true;
            pending = lead.slice(7);
          }
        }
        if (inThink) {
          const end = pending.indexOf("</think>");
          if (end < 0) {
            pending = pending.slice(-8);
            return;
          }
          pending = pending.slice(end + 8).replace(/^\s+/, "");
          inThink = false;
          continue;
        }
        if (pending) yield pending;
        pending = "";
        return;
      }
    };
    for await (const chunk of res.body) {
      buf += decoder.decode(chunk, { stream: true });
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (msg.error) throw new Error(`Ollama: ${msg.error}`);
        const tok = msg.message?.content;
        if (tok) yield* emit(tok);
      }
    }
    if (!decided && pending) yield pending;
  } catch (err) {
    rethrow(err, t);
  } finally {
    t.done();
  }
}

// ---- Gemini (OpenAI-compatible) -----------------------------------------

function googleParams(messages, opts, stream) {
  const p = {
    model: config.llm.googleModel,
    messages,
    stream,
    max_tokens: opts.maxTokens ?? config.llm.maxTokens,
    temperature: opts.temperature ?? config.llm.temperature,
  };
  if (opts.json) p.response_format = { type: "json_object" };
  return p;
}

async function googleChat(messages, opts) {
  const t = withTimeout(opts.signal);
  try {
    const res = await googleClient.chat.completions.create(googleParams(messages, opts, false), { signal: t.signal });
    return stripThink(res.choices?.[0]?.message?.content ?? "");
  } catch (err) {
    rethrow(err, t);
  } finally {
    t.done();
  }
}

async function* googleStream(messages, opts) {
  const t = withTimeout(opts.signal);
  try {
    const stream = await googleClient.chat.completions.create(googleParams(messages, opts, true), { signal: t.signal });
    for await (const chunk of stream) {
      const tok = chunk.choices?.[0]?.delta?.content;
      if (tok) yield tok;
    }
  } catch (err) {
    rethrow(err, t);
  } finally {
    t.done();
  }
}

function blockGoogle(err) {
  googleBlockedUntil = Date.now() + config.llm.googleCooldownMs;
  log.warn(
    `Gemini limit/quota (${err.status || err.message || "error"}); using local ${config.llm.model} for ${Math.round(config.llm.googleCooldownMs / 60000)} min`
  );
}

const canFailOver = (provider, err) =>
  provider === "google" && isQuotaOrRateLimit(err) && config.llm.fallback === "local" && canUseLocal();

// ---- public API ---------------------------------------------------------

/**
 * One non-streamed completion.
 * opts: { signal, queued, maxTokens, temperature, json }
 */
export async function chat(messages, opts = {}) {
  const exec = async () => {
    const started = Date.now();
    let provider = activeProvider();
    lastUsedProvider = provider;
    let text;
    try {
      text = provider === "google" ? await googleChat(messages, opts) : await ollamaChat(messages, opts);
    } catch (err) {
      if (!canFailOver(provider, err)) throw err;
      blockGoogle(err);
      provider = lastUsedProvider = "local";
      text = await ollamaChat(messages, opts);
    }
    log.debug(`llm chat [${provider}/${modelFor(provider)}] ${Date.now() - started}ms`);
    return text;
  };
  return opts.queued === false ? exec() : llmQueue.run(exec, opts.signal);
}

/** Streamed completion, yields text tokens. */
export async function* streamChat(messages, opts = {}) {
  const release = opts.queued === false ? null : await llmQueue.acquire(opts.signal);
  try {
    const started = Date.now();
    let provider = activeProvider();
    lastUsedProvider = provider;
    if (provider === "local") {
      yield* ollamaStream(messages, opts);
    } else {
      let gotAny = false;
      try {
        for await (const tok of googleStream(messages, opts)) {
          gotAny = true;
          yield tok;
        }
      } catch (err) {
        if (gotAny || !canFailOver(provider, err)) throw err;
        blockGoogle(err);
        provider = lastUsedProvider = "local";
        yield* ollamaStream(messages, opts);
      }
    }
    log.debug(`llm stream [${provider}/${modelFor(provider)}] ${Date.now() - started}ms`);
  } finally {
    release?.();
  }
}

/** Pull the configured model into Ollama if it is not installed yet. */
async function ensureModel() {
  const h = await pingLocal();
  if (h.ok || h.error !== "Model not installed" || !config.llm.autoPull) return h.ok;
  log.info(`Pulling ${config.llm.model} into Ollama (first start only, can take several minutes)…`);
  try {
    const res = await fetch(`${ollamaRoot}/api/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: config.llm.model, stream: false }),
      signal: AbortSignal.timeout(60 * 60_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    log.info(`Model ${config.llm.model} is ready`);
    return true;
  } catch (err) {
    log.warn(`Could not pull ${config.llm.model}: ${err.message}`);
    return false;
  }
}

/** Load the model into memory so the first real question is not slow. */
export async function warmup() {
  if (activeProvider() !== "local") return;
  await ensureModel();
  try {
    const started = Date.now();
    await ollamaChat([{ role: "user", content: "hi" }], { maxTokens: 1 });
    log.info(`LLM ${config.llm.model} warmed up in ${Date.now() - started}ms (num_ctx ${config.llm.numCtx})`);
  } catch (err) {
    log.warn(`LLM warmup failed: ${err.message}`);
  }
}

async function pingLocal() {
  const started = Date.now();
  try {
    const res = await fetch(`${ollamaRoot}/api/tags`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const body = await res.json();
    const models = (body.models || []).map((m) => m.name);
    const want = config.llm.model.includes(":") ? config.llm.model : `${config.llm.model}:latest`;
    const present = models.includes(config.llm.model) || models.includes(want);
    return {
      ok: present,
      model: config.llm.model,
      modelPresent: present,
      models,
      latencyMs: Date.now() - started,
      ...(present ? {} : { error: "Model not installed" }),
    };
  } catch {
    return { ok: false, model: config.llm.model, error: "AI service unreachable" };
  }
}

async function pingGoogle() {
  if (!config.llm.googleApiKey) return { ok: false, error: "GOOGLE_API_KEY not set" };
  if (googleCooldownMs()) return { ok: false, error: "quota cooldown", cooldownMs: googleCooldownMs() };
  const started = Date.now();
  try {
    const url = new URL("https://generativelanguage.googleapis.com/v1beta/models");
    url.searchParams.set("key", config.llm.googleApiKey);
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (res.status === 429) return { ok: false, error: "rate limited" };
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    return { ok: true, model: config.llm.googleModel, latencyMs: Date.now() - started };
  } catch {
    return { ok: false, model: config.llm.googleModel, error: "Gemini unreachable" };
  }
}

export async function llmHealth() {
  const provider = activeProvider();
  const useGoogle = config.llm.provider === "google" || config.llm.provider === "auto";
  const [google, local] = await Promise.all([
    useGoogle && config.llm.googleApiKey ? pingGoogle() : Promise.resolve({ ok: false, error: "not used" }),
    pingLocal(),
  ]);
  const current = provider === "google" ? google : local;
  return {
    ok: Boolean(current.ok),
    provider,
    model: modelFor(provider),
    modelPresent: current.ok,
    google,
    local,
    cooldownMs: googleCooldownMs(),
    lastUsedProvider,
    queue: llmQueue.stats(),
    ...(current.ok ? {} : { error: current.error || "AI service unavailable" }),
  };
}
