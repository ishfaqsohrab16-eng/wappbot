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
async function whisperAsr(buf, mime, signal) {
  const form = new FormData();
  form.append("audio_file", new Blob([buf], { type: mime }), `voice.${extFor(mime)}`);
  const url = `${config.stt.baseUrl}/asr?encode=true&task=transcribe&output=json&vad_filter=true`;
  const res = await fetch(url, { method: "POST", body: form, signal });
  if (!res.ok) throw new Error(`STT HTTP ${res.status}`);
  const body = await res.json();
  return { text: (body.text || "").trim(), language: body.language || null };
}

/** OpenAI-compatible /v1/audio/transcriptions (speaches, OpenAI, Groq, ...) */
async function openaiCompat(buf, mime, signal) {
  const form = new FormData();
  form.append("file", new Blob([buf], { type: mime }), `voice.${extFor(mime)}`);
  form.append("model", config.stt.model);
  form.append("response_format", "verbose_json");
  const base = config.stt.baseUrl.endsWith("/v1") ? config.stt.baseUrl : `${config.stt.baseUrl}/v1`;
  const res = await fetch(`${base}/audio/transcriptions`, {
    method: "POST",
    body: form,
    signal,
    headers: config.stt.apiKey ? { Authorization: `Bearer ${config.stt.apiKey}` } : {},
  });
  if (!res.ok) throw new Error(`STT HTTP ${res.status}`);
  const body = await res.json();
  return { text: (body.text || "").trim(), language: body.language || null };
}

/** Transcribe audio bytes. Returns { text, language }. */
export async function transcribe(buf, mime = "audio/ogg") {
  if (!sttEnabled()) throw new AppError("stt_disabled", 501, "Voice messages are not enabled.");
  return sttQueue.run(async () => {
    const started = Date.now();
    try {
      const signal = AbortSignal.timeout(config.stt.timeoutMs);
      const out =
        config.stt.provider === "openai" ? await openaiCompat(buf, mime, signal) : await whisperAsr(buf, mime, signal);
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
