import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { config } from "../config.js";
import { log } from "../logger.js";

// Query patterns learned from successful LLM interpretations, stored on the app's
// own data volume (never in the LMS database). A pattern is the normalized
// question with values replaced by slots, e.g. "kitne bachay hain {batch} mein",
// mapped to { op, entity, dim }. Filter values are re-extracted every time.

const file = () => path.join(config.dataDir, "learned-queries.json");
let entries = [];
let loaded = false;
let saveTimer = null;

export const STATUS = ["active", "pending", "disabled"];

function load() {
  if (loaded) return;
  loaded = true;
  try {
    if (fs.existsSync(file())) {
      const data = JSON.parse(fs.readFileSync(file(), "utf8"));
      entries = Array.isArray(data.entries) ? data.entries : [];
      log.info(`Loaded ${entries.length} learned query patterns`);
    }
  } catch (err) {
    log.error("Could not read learned-queries.json:", err.message);
  }
}

function writeNow() {
  try {
    fs.mkdirSync(config.dataDir, { recursive: true });
    const tmp = `${file()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ version: 1, entries }, null, 1));
    fs.renameSync(tmp, file());
  } catch (err) {
    log.error("Could not write learned-queries.json:", err.message);
  }
}

function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    writeNow();
  }, 500);
  saveTimer.unref?.();
}

export function flushLearned() {
  if (!saveTimer) return;
  clearTimeout(saveTimer);
  saveTimer = null;
  writeNow();
}

/** For tests: forget the in-memory copy so the next call reads the file again. */
export function reloadLearned() {
  loaded = false;
  entries = [];
  load();
}

const sameMapping = (a, b) => a.op === b.op && a.entity === b.entity && (a.dim || null) === (b.dim || null);

function tokens(key) {
  return new Set(key.split(" ").filter((w) => w.length >= 2));
}

function similarity(a, b) {
  const A = tokens(a);
  const B = tokens(b);
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / Math.max(1, A.size + B.size - inter);
}

/**
 * Best active pattern for this slot key: exact first, then a close variant
 * with the same slots (Jaccard ≥ 0.8).
 */
export function findLearned(key) {
  load();
  const exact = entries.find((x) => x.key === key && x.status === "active");
  if (exact) return { entry: exact, match: "exact" };
  const slots = (key.match(/\{\w+\}/g) || []).sort().join();
  let best = null;
  for (const x of entries) {
    if (x.status !== "active") continue;
    if ((x.key.match(/\{\w+\}/g) || []).sort().join() !== slots) continue;
    const s = similarity(key, x.key);
    if (s >= 0.8 && (!best || s > best.s)) best = { entry: x, s };
  }
  return best ? { entry: best.entry, match: "similar" } : null;
}

export function touchLearned(entry) {
  entry.hits = (entry.hits || 0) + 1;
  entry.lastUsedAt = new Date().toISOString();
  save();
}

/**
 * Save a validated interpretation. Active when confidence ≥ LEARN_ACTIVE_CONFIDENCE,
 * pending (needs /approve) when ≥ LEARN_MIN_CONFIDENCE, otherwise ignored.
 * Never overwrites a different active mapping (conflicts are kept as pending).
 */
export function learn({ key, mapping, confidence, source = "llm", example }) {
  load();
  if (!key || key.split(" ").length < 2 || key.length > 300) return { saved: false, reason: "too short/long" };
  if (confidence < config.engine.learnMinConfidence) return { saved: false, reason: "low confidence" };
  const existing = entries.filter((x) => x.key === key);
  const same = existing.find((x) => sameMapping(x.mapping, mapping));
  if (same) {
    same.confirmations = (same.confirmations || 0) + 1;
    if (same.status === "pending" && same.confirmations >= 2 && confidence >= config.engine.learnMinConfidence) same.status = "active";
    save();
    return { saved: false, reason: "duplicate", entry: same };
  }
  const conflict = existing.some((x) => x.status === "active");
  const entry = {
    id: crypto.randomBytes(4).toString("hex"),
    key,
    mapping: { op: mapping.op, entity: mapping.entity, dim: mapping.dim || null },
    status: !conflict && confidence >= config.engine.learnActiveConfidence ? "active" : "pending",
    confidence: Math.round(confidence * 100) / 100,
    source,
    example: String(example || "").slice(0, 200),
    hits: 0,
    confirmations: 0,
    conflict: conflict || undefined,
    createdAt: new Date().toISOString(),
    lastUsedAt: null,
  };
  entries.push(entry);
  if (entries.length > 5000) {
    // Drop the least useful pending entries first.
    entries.sort((a, b) => (a.status === "pending") - (b.status === "pending") || (b.hits || 0) - (a.hits || 0));
    entries.length = 5000;
  }
  save();
  return { saved: true, entry };
}

export function listLearned({ status } = {}) {
  load();
  return entries.filter((x) => !status || x.status === status);
}

export function setLearnedStatus(id, status) {
  load();
  if (!STATUS.includes(status)) return { ok: false, error: "bad status" };
  const x = entries.find((e) => e.id === id);
  if (!x) return { ok: false, error: "not found" };
  if (status === "active") {
    for (const other of entries) if (other !== x && other.key === x.key && other.status === "active") other.status = "disabled";
  }
  x.status = status;
  save();
  return { ok: true, entry: x };
}

export function removeLearned(id) {
  load();
  const i = entries.findIndex((e) => e.id === id);
  if (i < 0) return { ok: false, error: "not found" };
  entries.splice(i, 1);
  save();
  return { ok: true };
}
