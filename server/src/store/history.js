import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import { log } from "../logger.js";

// Per-user conversation memory, persisted on the data volume so follow-up
// questions ("his phone number?", "and batch 11?") work across restarts.
const MAX_CHARS = 700;
const file = path.join(config.dataDir, "history.json");
const store = new Map(); // key -> { at, messages: [{role, content, at}], last: {question, sql, rowCount, sample} }

function idleMs() {
  return Math.max(1, config.llm.historyDays) * 24 * 3600_000;
}

function load() {
  try {
    if (!fs.existsSync(file)) return;
    const obj = JSON.parse(fs.readFileSync(file, "utf8"));
    const cutoff = Date.now() - idleMs();
    for (const [k, v] of Object.entries(obj)) if (v?.at > cutoff) store.set(k, v);
    log.info(`Loaded conversation memory for ${store.size} chats`);
  } catch (err) {
    log.error("Could not read history.json:", err.message);
  }
}

function writeNow() {
  try {
    fs.mkdirSync(config.dataDir, { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(store)));
    fs.renameSync(tmp, file);
  } catch (err) {
    log.error("Could not write history.json:", err.message);
  }
}

let saveTimer = null;
function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    writeNow();
  }, 1000);
  saveTimer.unref?.();
}

export function flushHistory() {
  if (!saveTimer) return;
  clearTimeout(saveTimer);
  saveTimer = null;
  writeNow();
}

function entry(key) {
  const h = store.get(key);
  if (!h) return null;
  if (Date.now() - h.at > idleMs()) {
    store.delete(key);
    save();
    return null;
  }
  return h;
}

export function getHistory(key) {
  const h = entry(key);
  return h ? h.messages.slice(-config.llm.historyMessages).map(({ role, content }) => ({ role, content })) : [];
}

/** The last database lookup for this chat, for follow-up questions. */
export function getLastLookup(key) {
  return entry(key)?.last || null;
}

export function appendHistory(key, role, content) {
  const h = entry(key) || { at: 0, messages: [] };
  const text = String(content || "");
  h.messages.push({ role, content: text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS)}…` : text });
  h.messages = h.messages.slice(-config.llm.historyMessages);
  h.at = Date.now();
  store.set(key, h);
  save();
}

export function setLastLookup(key, last) {
  const h = entry(key) || { at: Date.now(), messages: [] };
  h.last = last;
  h.at = Date.now();
  store.set(key, h);
  save();
}

export function clearHistory(key) {
  if (store.delete(key)) save();
}

load();
