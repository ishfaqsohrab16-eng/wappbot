const TOKEN_KEY = "wappbot.token";

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable */
  }
}

const listeners = new Set();
export function onUnauthorized(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export class ApiError extends Error {
  constructor(status, message, retryAfter) {
    super(message);
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

async function toError(res) {
  let msg = `Request failed (${res.status})`;
  try {
    const body = await res.json();
    if (body?.error) msg = body.error;
  } catch {
    /* not JSON */
  }
  if (res.status === 401) listeners.forEach((fn) => fn());
  return new ApiError(res.status, msg, Number(res.headers.get("Retry-After")) || undefined);
}

export async function api(path, { method = "GET", body, signal } = {}) {
  const token = getToken();
  const res = await fetch(`/api${path}`, {
    method,
    signal,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw await toError(res);
  return res.status === 204 ? null : res.json();
}

/**
 * POST /api/chat and read the SSE stream.
 * handlers: { onToken, onStatus, onDone, onError }
 */
export async function streamChat({ message, sessionId, signal, ...handlers }) {
  const token = getToken();
  const res = await fetch("/api/chat", {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ message, sessionId }),
  });
  if (!res.ok) throw await toError(res);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const raw = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      let event = "message";
      let data = "";
      for (const line of raw.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data += line.slice(5).trim();
      }
      if (!data) continue;
      let payload;
      try {
        payload = JSON.parse(data);
      } catch {
        continue;
      }
      if (event === "token") handlers.onToken?.(payload.token);
      else if (event === "status") handlers.onStatus?.(payload.status);
      else if (event === "progress") handlers.onStatus?.(payload.note);
      else if (event === "done") handlers.onDone?.(payload);
      else if (event === "error") handlers.onError?.(payload);
    }
  }
}
