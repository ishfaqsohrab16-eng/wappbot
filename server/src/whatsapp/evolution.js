import { config } from "../config.js";
import { log } from "../logger.js";

const evo = config.evolution;

export function evolutionEnabled() {
  return Boolean(evo.baseUrl && evo.apiKey && evo.instance);
}

async function call(method, path, body, timeoutMs = 20000) {
  const res = await fetch(`${evo.baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json", apikey: evo.apiKey },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const err = new Error(`Evolution ${method} ${path} -> HTTP ${res.status}`);
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data;
}

const inst = () => encodeURIComponent(evo.instance);

// WhatsApp caps a message at ~65k chars; keep chunks readable.
function chunkText(text, size = 3500) {
  if (text.length <= size) return [text];
  const parts = [];
  let rest = text;
  while (rest.length > size) {
    let cut = rest.lastIndexOf("\n", size);
    if (cut < size * 0.5) cut = rest.lastIndexOf(" ", size);
    if (cut < size * 0.5) cut = size;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

/** Send a text reply. `to` is a phone number or full JID. */
export async function sendText(to, text, { quoted } = {}) {
  const parts = chunkText(String(text || "").trim() || "…");
  for (let i = 0; i < parts.length; i++) {
    await call("POST", `/message/sendText/${inst()}`, {
      number: to,
      text: parts[i],
      ...(quoted && i === 0 ? { quoted } : {}),
    });
  }
}

/** Show "typing…" for up to `ms`. Failures are ignored. */
/**
 * Send a file: { kind: "image"|"document", mime, name, base64, caption }.
 */
export async function sendMedia(to, file) {
  await call(
    "POST",
    `/message/sendMedia/${inst()}`,
    {
      number: to,
      mediatype: file.kind === "image" ? "image" : "document",
      mimetype: file.mime,
      caption: file.caption || "",
      media: file.base64,
      fileName: file.name,
    },
    60000
  );
}

/** Send a voice note (Evolution converts the audio to WhatsApp PTT). */
export async function sendVoice(to, base64) {
  await call("POST", `/message/sendWhatsAppAudio/${inst()}`, { number: to, audio: base64, encoding: true }, 60000);
}

export async function sendTyping(to, ms = 10000) {
  try {
    await call("POST", `/chat/sendPresence/${inst()}`, { number: to, presence: "composing", delay: ms }, 5000);
  } catch (err) {
    log.debug("sendPresence failed:", err.message);
  }
}

export async function markRead(key) {
  try {
    await call("POST", `/chat/markMessageAsRead/${inst()}`, {
      readMessages: [{ remoteJid: key.remoteJid, fromMe: Boolean(key.fromMe), id: key.id }],
    }, 5000);
  } catch (err) {
    log.debug("markMessageAsRead failed:", err.message);
  }
}

/** Download a media message as base64 (used when the webhook did not include it). */
export async function getMediaBase64(messageData) {
  const data = await call(
    "POST",
    `/chat/getBase64FromMediaMessage/${inst()}`,
    { message: { key: messageData.key }, convertToMp4: false },
    60000
  );
  return { base64: data?.base64, mimetype: data?.mimetype };
}

const WEBHOOK_EVENTS = ["MESSAGES_UPSERT", "CONNECTION_UPDATE"];

function webhookBody(url) {
  return { enabled: true, url, byEvents: false, base64: true, events: WEBHOOK_EVENTS };
}

export async function setWebhook(url) {
  return call("POST", `/webhook/set/${inst()}`, { webhook: webhookBody(url) });
}

/** The instance record, or null if it does not exist yet. */
export async function fetchInstance() {
  try {
    const data = await call("GET", `/instance/fetchInstances?instanceName=${inst()}`, null, 8000);
    const list = Array.isArray(data) ? data : data ? [data] : [];
    const raw = list.map((x) => x?.instance ?? x).find((x) => (x?.name ?? x?.instanceName) === evo.instance);
    if (!raw) return null;
    return {
      name: raw.name ?? raw.instanceName,
      state: raw.connectionStatus ?? raw.status ?? "unknown",
      ownerJid: raw.ownerJid ?? raw.owner ?? null,
      profileName: raw.profileName ?? null,
      profilePicUrl: raw.profilePicUrl ?? raw.profilePictureUrl ?? null,
    };
  } catch (err) {
    if (err.status === 404) return null;
    throw err;
  }
}

export async function createInstance(webhookUrl) {
  return call("POST", "/instance/create", {
    instanceName: evo.instance,
    integration: "WHATSAPP-BAILEYS",
    qrcode: true,
    groupsIgnore: !config.allowGroups,
    rejectCall: false,
    alwaysOnline: false,
    readMessages: false,
    syncFullHistory: false,
    ...(webhookUrl ? { webhook: webhookBody(webhookUrl) } : {}),
  });
}

/**
 * Start (or continue) linking. Returns { state, qr, pairingCode }.
 * With `number`, WhatsApp issues an 8-character pairing code instead of a QR scan.
 */
export async function connectInstance(number) {
  if (number) {
    // A pairing code can only be requested from the "close" state.
    await logoutInstance().catch(() => {});
  }
  const q = number ? `?number=${encodeURIComponent(number)}` : "";
  const data = await call("GET", `/instance/connect/${inst()}${q}`, null, 30000);
  const state = data?.instance?.state ?? data?.instance?.status ?? null;
  const qr = data?.base64 ?? data?.qrcode?.base64 ?? null;
  const pairingCode = data?.pairingCode ?? data?.qrcode?.pairingCode ?? null;
  return { state: state ?? (qr || pairingCode ? "connecting" : "unknown"), qr, pairingCode };
}

export async function logoutInstance() {
  return call("DELETE", `/instance/logout/${inst()}`, null, 15000);
}

/** Create the instance if needed and point its webhook at this app. */
export async function ensureInstance(webhookUrl) {
  let created = false;
  if (!(await fetchInstance())) {
    await createInstance(webhookUrl);
    created = true;
  }
  if (webhookUrl) await setWebhook(webhookUrl);
  return { created };
}

export async function evolutionHealth() {
  if (!evolutionEnabled()) return { ok: false, error: "Not configured" };
  try {
    const data = await call("GET", `/instance/connectionState/${inst()}`, null, 5000);
    const state = data?.instance?.state ?? data?.state ?? "unknown";
    return { ok: state === "open", instance: evo.instance, state: state === "close" ? "not linked" : state };
  } catch (err) {
    if (err.status === 404) return { ok: false, instance: evo.instance, error: "Instance not created yet" };
    return { ok: false, instance: evo.instance, error: err.status ? `HTTP ${err.status}` : "Unreachable" };
  }
}
