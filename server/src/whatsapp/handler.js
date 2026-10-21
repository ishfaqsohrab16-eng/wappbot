import { config } from "../config.js";
import { log, recordActivity } from "../logger.js";
import { normalizePhone } from "../util/phone.js";
import { createRateLimiter } from "../util/rateLimit.js";
import { toAppError } from "../util/errors.js";
import { isAllowed, touchUser } from "../store/users.js";
import { handleCommand } from "../bot/commands.js";
import { runAssistant } from "../bot/assistant.js";
import { transcribe, sttEnabled } from "../stt/transcribe.js";
import { sendText, sendTyping, markRead, getMediaBase64 } from "./evolution.js";

const rateLimiter = createRateLimiter({ limit: config.llm.rateLimitPerMin });
const seen = new Map(); // message id -> time, to drop webhook retries
const chains = new Map(); // phone -> promise, one message at a time per user
const deniedNotified = new Map(); // phone -> time of last "not authorized" reply
const MAX_AGE_SEC = 300;

setInterval(() => {
  const cutoff = Date.now() - 10 * 60_000;
  for (const [id, t] of seen) if (t < cutoff) seen.delete(id);
  const dayAgo = Date.now() - 24 * 3600_000;
  for (const [p, t] of deniedNotified) if (t < dayAgo) deniedNotified.delete(p);
}, 60_000).unref();

/** Work out the sender's real phone number, also for @lid chats. */
function senderPhone(data) {
  const k = data.key || {};
  const isGroup = String(k.remoteJid || "").endsWith("@g.us");
  const candidates = isGroup
    ? [k.participantPn, k.participantAlt, data.participantPn, k.participant, data.participant]
    : [k.senderPn, k.remoteJidAlt, data.senderPn, k.remoteJid];
  for (const c of candidates) {
    if (c && !String(c).endsWith("@lid")) {
      const p = normalizePhone(c, "");
      if (p) return p;
    }
  }
  return null;
}

function unwrap(message) {
  let m = message || {};
  // Disappearing / view-once / edited wrappers
  for (let i = 0; i < 3; i++) {
    const inner =
      m.ephemeralMessage?.message || m.viewOnceMessage?.message || m.viewOnceMessageV2?.message ||
      m.documentWithCaptionMessage?.message || m.editedMessage?.message;
    if (!inner) break;
    m = inner;
  }
  return m;
}

function extractContent(data) {
  const m = unwrap(data.message);
  const text =
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    m.documentMessage?.caption ||
    m.buttonsResponseMessage?.selectedDisplayText ||
    m.listResponseMessage?.title ||
    m.templateButtonReplyMessage?.selectedDisplayText ||
    "";
  if (m.audioMessage) return { kind: "audio", audio: m.audioMessage, text: "" };
  if (text) return { kind: "text", text };
  if (m.reactionMessage || m.protocolMessage || m.senderKeyDistributionMessage) return { kind: "ignore" };
  return { kind: "unsupported" };
}

async function loadAudio(data) {
  const inline = data.message?.base64 || data.base64;
  const mime = (data.message?.audioMessage?.mimetype || "audio/ogg").split(";")[0];
  if (inline) return { buf: Buffer.from(inline, "base64"), mime };
  const r = await getMediaBase64(data);
  if (!r.base64) throw new Error("No media returned");
  return { buf: Buffer.from(r.base64, "base64"), mime: (r.mimetype || mime).split(";")[0] };
}

/** Entry point for one Evolution "messages.upsert" item. Never throws. */
export function handleIncoming(data, instance) {
  try {
    const key = data?.key;
    if (!key?.id || key.fromMe) return;
    const jid = String(key.remoteJid || "");
    if (jid === "status@broadcast" || jid.endsWith("@newsletter") || jid.endsWith("@broadcast")) return;
    if (jid.endsWith("@g.us") && !config.allowGroups) return;
    if (instance && config.evolution.instance && instance !== config.evolution.instance) return;
    if (seen.has(key.id)) return;
    seen.set(key.id, Date.now());

    const ts = Number(data.messageTimestamp || 0);
    if (ts && Date.now() / 1000 - ts > MAX_AGE_SEC) return; // backlog after reconnect

    const phone = senderPhone(data);
    if (!phone) {
      log.warn(`Could not resolve phone for ${jid}`);
      return;
    }
    const replyTo = jid.endsWith("@g.us") ? jid : phone;
    const content = extractContent(data);
    if (content.kind === "ignore") return;

    if (!isAllowed(phone)) {
      recordActivity({ phone, kind: content.kind, status: "denied" });
      if (config.unauthorizedReply && !deniedNotified.has(phone)) {
        deniedNotified.set(phone, Date.now());
        sendText(replyTo, config.unauthorizedReply).catch((e) => log.warn("deny reply failed:", e.message));
      }
      return;
    }

    const prev = chains.get(phone) || Promise.resolve();
    const next = prev
      .then(() => processMessage({ data, phone, replyTo, content, name: data.pushName }))
      .catch((err) => log.error("processMessage crashed:", err));
    chains.set(phone, next);
    next.finally(() => {
      if (chains.get(phone) === next) chains.delete(phone);
    });
  } catch (err) {
    log.error("handleIncoming failed:", err);
  }
}

async function processMessage({ data, phone, replyTo, content, name }) {
  const started = Date.now();
  touchUser(phone, name);
  markRead(data.key);

  let text = content.text?.trim() || "";
  const activity = { phone, name, kind: content.kind };

  if (content.kind === "unsupported") {
    await sendText(replyTo, "I can read *text* and *voice* messages. Please type your question or send a voice note.");
    return;
  }

  // Commands are cheap; they skip the rate limit and the LLM.
  if (content.kind === "text" && /^[/!]\w/.test(text)) {
    const reply = await handleCommand(phone, text);
    if (reply) {
      await sendText(replyTo, reply);
      recordActivity({ ...activity, kind: "command", text, status: "ok", ms: Date.now() - started });
      return;
    }
  }

  const rl = rateLimiter.check(phone);
  if (!rl.ok) {
    await sendText(replyTo, `⏳ You are sending messages too quickly. Please wait ${rl.retryAfterSec}s and try again.`);
    recordActivity({ ...activity, text, status: "rate_limited" });
    return;
  }

  sendTyping(replyTo, 15000);
  const typingTimer = setInterval(() => sendTyping(replyTo, 15000), 12000);
  let progressed = false;
  let notes = Promise.resolve(); // progress notes go out in order, before the answer
  const ackTimer = setTimeout(() => {
    if (progressed) return;
    sendText(replyTo, "⏳ Working on it, this can take up to a minute…").catch(() => {});
  }, config.bot.showThinking ? Math.max(config.bot.ackAfterMs, 20000) : config.bot.ackAfterMs);

  try {
    let language;
    if (content.kind === "audio") {
      if (!sttEnabled()) {
        await sendText(replyTo, "Voice messages are not enabled. Please type your question.");
        return;
      }
      const secs = Number(content.audio.seconds || 0);
      if (secs > config.stt.maxAudioSeconds) {
        await sendText(replyTo, `That voice message is too long. Please keep it under ${config.stt.maxAudioSeconds} seconds.`);
        return;
      }
      const audio = await loadAudio(data);
      const tr = await transcribe(audio.buf, audio.mime);
      text = tr.text;
      language = tr.language || undefined;
      if (!text) {
        await sendText(replyTo, "I couldn't hear anything in that voice message. Please try again.");
        return;
      }
    }

    if (text.length > config.llm.maxUserChars) text = text.slice(0, config.llm.maxUserChars);

    const onProgress = config.bot.showThinking
      ? (note) => {
          progressed = true;
          notes = notes.then(() => sendText(replyTo, note)).catch(() => {});
        }
      : undefined;
    const result = await runAssistant({ text, historyKey: phone, language, onProgress });
    await notes;
    const prefix = content.kind === "audio" && config.bot.echoTranscript ? `🎤 _${text}_\n\n` : "";
    await sendText(replyTo, prefix + result.reply);
    recordActivity({
      ...activity,
      text,
      language,
      action: result.action,
      sql: result.sql,
      rows: result.rowCount,
      reply: result.reply.slice(0, 300),
      status: "ok",
      ms: Date.now() - started,
    });
  } catch (err) {
    const e = toAppError(err);
    if (e.code !== "aborted") log.error(`Reply to ${phone} failed [${e.code}]:`, err.cause || err);
    await sendText(replyTo, `⚠️ ${e.userMessage}`).catch(() => {});
    recordActivity({ ...activity, text, status: e.code, ms: Date.now() - started });
  } finally {
    clearTimeout(ackTimer);
    clearInterval(typingTimer);
  }
}
