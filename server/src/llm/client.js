import OpenAI from "openai";
import { config } from "../config.js";
import { createQueue } from "./queue.js";
import { log } from "../logger.js";

// The single place that talks to Ollama. Everything else goes through here.
const llm = new OpenAI({
  baseURL: config.llm.baseUrl,
  apiKey: config.llm.apiKey || "ollama",
  timeout: config.llm.timeoutMs,
  maxRetries: 0,
});

export const llmQueue = createQueue({
  name: "llm",
  concurrency: config.llm.concurrency,
  maxQueue: config.llm.maxQueue,
});

function buildParams(messages, opts, stream) {
  return {
    model: config.llm.model,
    messages,
    stream,
    max_tokens: opts.maxTokens ?? config.llm.maxTokens,
    temperature: opts.temperature ?? config.llm.temperature,
    reasoning_effort: opts.reasoningEffort ?? config.llm.reasoningEffort,
  };
}

/** Combine the caller's signal with a hard timeout. */
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

/**
 * Non-streaming completion. Holds a queue slot for the whole call.
 * Pass { queued: false } when the caller already holds a slot.
 */
export async function chat(messages, opts = {}) {
  const exec = async () => {
    const t = withTimeout(opts.signal);
    const started = Date.now();
    try {
      const res = await llm.chat.completions.create(buildParams(messages, opts, false), { signal: t.signal });
      const text = res.choices?.[0]?.message?.content ?? "";
      log.debug(`llm chat ${Date.now() - started}ms, ${res.usage?.completion_tokens ?? "?"} tokens`);
      return text.trim();
    } catch (err) {
      rethrow(err, t);
    } finally {
      t.done();
    }
  };
  return opts.queued === false ? exec() : llmQueue.run(exec, opts.signal);
}

/**
 * Streaming completion: yields text tokens. Pass { queued: false } when the
 * caller already holds a slot.
 */
export async function* streamChat(messages, opts = {}) {
  const release = opts.queued === false ? null : await llmQueue.acquire(opts.signal);
  const t = withTimeout(opts.signal);
  try {
    const stream = await llm.chat.completions.create(buildParams(messages, opts, true), { signal: t.signal });
    for await (const chunk of stream) {
      const tok = chunk.choices?.[0]?.delta?.content;
      if (tok) yield tok;
    }
  } catch (err) {
    rethrow(err, t);
  } finally {
    t.done();
    release?.();
  }
}

/** GET /api/tags on the Ollama root (base URL without /v1). */
export async function llmHealth() {
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
      queue: llmQueue.stats(),
      ...(present ? {} : { error: "Model not installed" }),
    };
  } catch (err) {
    log.warn("LLM health check failed:", err.message);
    return { ok: false, model: config.llm.model, error: "AI service unreachable", queue: llmQueue.stats() };
  }
}
