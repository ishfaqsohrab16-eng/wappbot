import OpenAI from "openai";
import { config } from "../config.js";
import { createQueue } from "./queue.js";
import { isQuotaOrRateLimit } from "./failover.js";
import { log } from "../logger.js";

function makeClient(baseUrl, apiKey) {
  return new OpenAI({
    baseURL: baseUrl,
    apiKey: apiKey || "ollama",
    timeout: config.llm.timeoutMs,
    maxRetries: 0,
  });
}

const localClient = makeClient(config.llm.baseUrl, config.llm.apiKey);
const googleClient = config.llm.googleApiKey
  ? makeClient(config.llm.googleBaseUrl, config.llm.googleApiKey)
  : null;

let googleBlockedUntil = 0;
let lastUsedProvider = null;

export const llmQueue = createQueue({
  name: "llm",
  concurrency: config.llm.concurrency,
  maxQueue: config.llm.maxQueue,
});

export function googleCooldownMs() {
  return Math.max(0, googleBlockedUntil - Date.now());
}

function canUseGoogle() {
  return Boolean(googleClient && config.llm.googleApiKey && Date.now() >= googleBlockedUntil);
}

function canUseLocal() {
  return Boolean(config.llm.baseUrl);
}

/** Which backend will handle the next call. */
export function activeProvider() {
  const pref = config.llm.provider;
  if (pref === "local") return "local";
  if ((pref === "google" || pref === "auto") && canUseGoogle()) return "google";
  if (config.llm.fallback === "local" && canUseLocal()) return "local";
  if (canUseGoogle()) return "google";
  return "local";
}

export function modelFor(provider = activeProvider()) {
  return provider === "google" ? config.llm.googleModel : config.llm.model;
}

function clientFor(provider) {
  return provider === "google" ? googleClient : localClient;
}

function buildParams(provider, messages, opts, stream) {
  const params = {
    model: modelFor(provider),
    messages,
    stream,
    max_tokens: opts.maxTokens ?? config.llm.maxTokens,
    temperature: opts.temperature ?? config.llm.temperature,
  };
  if (provider !== "google") {
    params.reasoning_effort = opts.reasoningEffort ?? config.llm.reasoningEffort;
  }
  return params;
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
  throw err;
}

function blockGoogle(err) {
  googleBlockedUntil = Date.now() + config.llm.googleCooldownMs;
  log.warn(
    `Gemini limit/quota (${err.status || err.message || "error"}); using local ${config.llm.model} for ${Math.round(config.llm.googleCooldownMs / 60000)} min`
  );
}

async function withFailover(run) {
  const primary = activeProvider();
  lastUsedProvider = primary;
  try {
    return await run(primary);
  } catch (err) {
    if (primary === "google" && isQuotaOrRateLimit(err) && canUseLocal()) {
      blockGoogle(err);
      lastUsedProvider = "local";
      return run("local");
    }
    throw err;
  }
}

export async function chat(messages, opts = {}) {
  const exec = async () => {
    const started = Date.now();
    const text = await withFailover(async (provider) => {
      const t = withTimeout(opts.signal);
      try {
        const res = await clientFor(provider).chat.completions.create(buildParams(provider, messages, opts, false), {
          signal: t.signal,
        });
        return res.choices?.[0]?.message?.content ?? "";
      } catch (err) {
        rethrow(err, t);
      } finally {
        t.done();
      }
    });
    log.debug(`llm chat [${lastUsedProvider}/${modelFor(lastUsedProvider)}] ${Date.now() - started}ms`);
    return text.trim();
  };
  return opts.queued === false ? exec() : llmQueue.run(exec, opts.signal);
}

export async function* streamChat(messages, opts = {}) {
  const release = opts.queued === false ? null : await llmQueue.acquire(opts.signal);
  try {
    const started = Date.now();
    yield* streamWithFailover(messages, opts);
    log.debug(`llm stream [${lastUsedProvider}/${modelFor(lastUsedProvider)}] ${Date.now() - started}ms`);
  } finally {
    release?.();
  }
}

async function* streamWithFailover(messages, opts) {
  const primary = activeProvider();
  lastUsedProvider = primary;
  try {
    yield* streamOnce(primary, messages, opts);
  } catch (err) {
    if (primary === "google" && isQuotaOrRateLimit(err) && canUseLocal()) {
      blockGoogle(err);
      lastUsedProvider = "local";
      yield* streamOnce("local", messages, opts);
      return;
    }
    throw err;
  }
}

async function* streamOnce(provider, messages, opts) {
  const t = withTimeout(opts.signal);
  try {
    const stream = await clientFor(provider).chat.completions.create(buildParams(provider, messages, opts, true), {
      signal: t.signal,
    });
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

async function pingLocal() {
  const root = config.llm.baseUrl.replace(/\/v1$/, "");
  const started = Date.now();
  try {
    const res = await fetch(`${root}/api/tags`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const body = await res.json();
    const models = (body.models || []).map((m) => m.name);
    const present = models.includes(config.llm.model);
    return {
      ok: present,
      model: config.llm.model,
      modelPresent: present,
      models,
      latencyMs: Date.now() - started,
      ...(present ? {} : { error: "Model not installed" }),
    };
  } catch (err) {
    return { ok: false, model: config.llm.model, error: "AI service unreachable" };
  }
}

async function pingGoogle() {
  if (!config.llm.googleApiKey) return { ok: false, error: "GOOGLE_API_KEY not set" };
  if (googleCooldownMs()) {
    return { ok: false, error: "quota cooldown", cooldownMs: googleCooldownMs() };
  }
  const started = Date.now();
  try {
    const url = new URL("https://generativelanguage.googleapis.com/v1beta/models");
    url.searchParams.set("key", config.llm.googleApiKey);
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (res.status === 429) return { ok: false, error: "rate limited" };
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    return { ok: true, model: config.llm.googleModel, latencyMs: Date.now() - started };
  } catch (err) {
    return { ok: false, model: config.llm.googleModel, error: "Gemini unreachable" };
  }
}

export async function llmHealth() {
  const provider = activeProvider();
  const [google, local] = await Promise.all([
    config.llm.googleApiKey ? pingGoogle() : Promise.resolve({ ok: false, error: "not configured" }),
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
