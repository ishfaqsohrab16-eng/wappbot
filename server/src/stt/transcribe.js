import { config } from "../config.js";
import { createQueue } from "../llm/queue.js";
import { log } from "../logger.js";
import { AppError } from "../util/errors.js";

// STT runs on the same CPU as the LLM, so keep it to one job at a time.
const sttQueue = createQueue({ name: "stt", concurrency: 1, maxQueue: 10 });

export function sttEnabled() {
  return config.stt.provider !== "none" && Boolean(config.stt.baseUrl);
}

function extFor(mime = "") {
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("mpeg") || mime.includes("mp3")) return "mp3";
  if (mime.includes("mp4") || mime.includes("m4a") || mime.includes("aac")) return "m4a";
  if (mime.includes("wav")) return "wav";
  if (mime.includes("webm")) return "webm";
  return "ogg";
}

/** whisper-asr-webservice (onerahmet/openai-whisper-asr-webservice) */
async function whisperAsr(buf, mime, signal, language) {
  const form = new FormData();
  form.append("audio_file", new Blob([buf], { type: mime }), `voice.${extFor(mime)}`);
  const q = new URLSearchParams({ encode: "true", task: "transcribe", output: "json", vad_filter: "true" });
  if (language) q.set("language", language);
  if (config.stt.prompt) q.set("initial_prompt", config.stt.prompt);
  const url = `${config.stt.baseUrl}/asr?${q}`;
  const res = await fetch(url, { method: "POST", body: form, signal });
  if (!res.ok) throw new Error(`STT HTTP ${res.status}`);
  const body = await res.json();
  return { text: (body.text || "").trim(), language: body.language || language || null };
}

/** OpenAI-compatible /v1/audio/transcriptions (speaches, OpenAI, Groq, ...) */
async function openaiCompat(buf, mime, signal, language) {
  const form = new FormData();
  form.append("file", new Blob([buf], { type: mime }), `voice.${extFor(mime)}`);
  form.append("model", config.stt.model);
  form.append("response_format", "verbose_json");
  if (language) form.append("language", language);
  if (config.stt.prompt) form.append("prompt", config.stt.prompt);
  const base = config.stt.baseUrl.endsWith("/v1") ? config.stt.baseUrl : `${config.stt.baseUrl}/v1`;
  const res = await fetch(`${base}/audio/transcriptions`, {
    method: "POST",
    body: form,
    signal,
    headers: config.stt.apiKey ? { Authorization: `Bearer ${config.stt.apiKey}` } : {},
  });
  if (!res.ok) throw new Error(`STT HTTP ${res.status}`);
  const body = await res.json();
  return { text: (body.text || "").trim(), language: body.language || language || null };
}

const DEVANAGARI = /[ऀ-ॿ]/;

/** Transcribe audio bytes. Returns { text, language }. */
export async function transcribe(buf, mime = "audio/ogg") {
  if (!sttEnabled()) throw new AppError("stt_disabled", 501, "Voice messages are not enabled.");
  return sttQueue.run(async () => {
    const started = Date.now();
    try {
      const signal = AbortSignal.timeout(config.stt.timeoutMs);
      const run = (lang) => (config.stt.provider === "openai" ? openaiCompat(buf, mime, signal, lang) : whisperAsr(buf, mime, signal, lang));
      let out = await run(config.stt.language || undefined);
      // Whisper often hears Urdu as Hindi and writes Devanagari the bot can't read: redo it as Urdu.
      if (!config.stt.language && (/^(hi|hindi)$/i.test(out.language || "") || DEVANAGARI.test(out.text))) {
        log.info(`STT detected ${out.language || "Devanagari"}; retrying as Urdu`);
        out = await run("ur");
      }
      log.info(`STT ${Date.now() - started}ms lang=${out.language ?? "?"} chars=${out.text.length}`);
      return out;
    } catch (err) {
      log.error("STT failed:", err.message);
      throw new AppError("stt_failed", 502, "Sorry, I could not understand the voice message. Please try again or type it.", err);
    }
  });
}

export async function sttHealth() {
  if (!sttEnabled()) return { ok: false, error: "Disabled" };
  try {
    const path = config.stt.provider === "openai" ? "/v1/models" : "/docs";
    const base = config.stt.baseUrl.replace(/\/v1$/, "");
    const res = await fetch(`${base}${path}`, {
      signal: AbortSignal.timeout(5000),
      headers: config.stt.apiKey ? { Authorization: `Bearer ${config.stt.apiKey}` } : {},
    });
    return res.ok ? { ok: true, provider: config.stt.provider } : { ok: false, error: `HTTP ${res.status}` };
  } catch {
    return { ok: false, provider: config.stt.provider, error: "Unreachable" };
  }
}
