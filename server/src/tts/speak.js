import { config } from "../config.js";
import { log } from "../logger.js";

// Voice replies through an OpenAI-compatible speech API running in this stack
// (Kokoro-FastAPI by default). Audio never leaves the server.

export function ttsEnabled() {
  return Boolean(config.tts.baseUrl);
}

/** WhatsApp formatting → plain speakable text. */
export function speakable(text) {
  return String(text || "")
    .replace(/[*_~`]/g, "")
    .replace(/^[•\-]\s*/gm, "")
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "")
    .replace(/\n{2,}/g, ". ")
    .replace(/\n/g, ", ")
    .replace(/\s+/g, " ")
    .trim();
}

/** True when a reply is short enough and in a script the voice can read. */
export function canSpeak(text) {
  const s = speakable(text);
  return ttsEnabled() && s.length > 0 && s.length <= config.tts.maxChars && !/[؀-ۿ]/.test(s);
}

/** Returns base64 audio (ogg/opus) or null. */
export async function synthesize(text) {
  if (!ttsEnabled()) return null;
  try {
    const res = await fetch(`${config.tts.baseUrl}/v1/audio/speech`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.tts.apiKey}` },
      body: JSON.stringify({ model: config.tts.model, voice: config.tts.voice, input: speakable(text), response_format: "opus" }),
      signal: AbortSignal.timeout(config.tts.timeoutMs),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer()).toString("base64");
  } catch (err) {
    log.warn("Text-to-speech failed:", err.message);
    return null;
  }
}

export async function ttsHealth() {
  if (!ttsEnabled()) return { ok: false, error: "not configured" };
  try {
    const res = await fetch(`${config.tts.baseUrl}/v1/models`, { signal: AbortSignal.timeout(4000) });
    return { ok: res.ok, ...(res.ok ? {} : { error: `HTTP ${res.status}` }) };
  } catch {
    return { ok: false, error: "unreachable" };
  }
}
