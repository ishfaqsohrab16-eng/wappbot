import { config } from "../config.js";

// Short per-user conversation memory for follow-up questions. In memory only.
const MAX_CHARS = 600;
const IDLE_MS = 60 * 60 * 1000;
const store = new Map(); // key -> { at, messages: [{role, content}] }

export function getHistory(key) {
  const h = store.get(key);
  if (!h) return [];
  if (Date.now() - h.at > IDLE_MS) {
    store.delete(key);
    return [];
  }
  return h.messages.slice(-config.llm.historyMessages);
}

export function appendHistory(key, role, content) {
  const h = store.get(key) || { at: 0, messages: [] };
  const text = String(content || "");
  h.messages.push({ role, content: text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS)}…` : text });
  h.messages = h.messages.slice(-config.llm.historyMessages);
  h.at = Date.now();
  store.set(key, h);
}

export function clearHistory(key) {
  store.delete(key);
}
