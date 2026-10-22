import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { config } from "../config.js";
import { log } from "../logger.js";
import { isGenericKey } from "./parser.js";

// Query patterns learned from successful LLM interpretations, stored on the app's
// own data volume (never in the LMS database). A pattern is the normalized
// question with values replaced by slots, e.g. "kitne bachay hain {batch} mein",
// mapped to { op, entity, dim }. Filter values are re-extracted every time.

const file = () => path.join(config.dataDir, "learned-queries.json");
let entries = [];
let words = []; // learned vocabulary: { id, word, entity, status, confidence, hits, ... }
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
      words = Array.isArray(data.words) ? data.words : [];
      // Self-healing: patterns with no data words ("what are you") are never trusted.
      let fixed = 0;
      for (const x of entries) {
        if (x.status !== "disabled" && isGenericKey(x.key)) {
          x.status = "disabled";
          x.note = "auto-disabled: too generic";
          fixed++;
        }
      }
      if (fixed) save();
      log.info(`Loaded ${entries.length} learned query patterns, ${words.length} learned words${fixed ? ` (${fixed} generic disabled)` : ""}`);
    }
  } catch (err) {
    log.error("Could not read learned-queries.json:", err.message);
  }
}

function writeNow() {
  try {
    fs.mkdirSync(config.dataDir, { recursive: true });
    const tmp = `${file()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ version: 2, entries, words }, null, 1));
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
  words = [];
  load();
}

/** Active learned words → entity, e.g. { talaba: "student" }. */
export function learnedSynonyms() {
  load();
  const out = {};
  for (const w of words) if (w.status === "active") out[w.word] = w.entity;
  return out;
}

/**
 * Learn that an unknown word means an entity ("talaba" → student). A word needs
 * two independent confirmations unless the LLM was very sure.
 */
export function learnWord({ word, entity, confidence, example }) {
  load();
  const wd = String(word || "").toLowerCase();
  if (!/^[a-z]{4,20}$/.test(wd) || confidence < config.engine.learnMinConfidence) return { saved: false };
  const same = words.find((x) => x.word === wd && x.entity === entity);
  if (same) {
    same.confirmations = (same.confirmations || 0) + 1;
    if (same.status === "pending" && same.confirmations >= 1) same.status = "active";
    save();
    return { saved: false, entry: same };
  }
  const conflict = words.some((x) => x.word === wd && x.status === "active");
  const entry = {
    id: crypto.randomBytes(4).toString("hex"),
    word: wd,
    entity,
    status: !conflict && confidence >= Math.max(0.9, config.engine.learnActiveConfidence) ? "active" : "pending",
    confidence: Math.round(confidence * 100) / 100,
    source: "llm",
    example: String(example || "").slice(0, 200),
    confirmations: 0,
    createdAt: new Date().toISOString(),
  };
  words.push(entry);
  save();
  return { saved: true, entry };
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
export function learn({ key, mapping, confidence, source = "llm", example, override = false }) {
  load();
  if (!key || key.split(" ").length < 2 || key.length > 300) return { saved: false, reason: "too short/long" };
  if (isGenericKey(key)) return { saved: false, reason: "too generic" };
  if (confidence < config.engine.learnMinConfidence) return { saved: false, reason: "low confidence" };
  const existing = entries.filter((x) => x.key === key);
  const same = existing.find((x) => sameMapping(x.mapping, mapping));
  // The user corrected us: their reading wins over whatever was learned before.
  if (override) {
    for (const x of existing) if (x !== same && x.status === "active") Object.assign(x, { status: "disabled", note: "replaced by user correction" });
    if (same) {
      Object.assign(same, { status: "active", source, confirmations: (same.confirmations || 0) + 1 });
      save();
      return { saved: true, entry: same };
    }
  }
  if (same) {
    same.confirmations = (same.confirmations || 0) + 1;
    if (same.status === "pending" && same.confirmations >= 2 && confidence >= config.engine.learnMinConfidence) same.status = "active";
    save();
    return { saved: false, reason: "duplicate", entry: same };
  }
  const conflict = !override && existing.some((x) => x.status === "active");
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

/**
 * Pre-teach the expected questions the rules don't route as intended (with the
 * live dictionary). Seeds never override a pattern someone already taught.
 * parse/slotKey are passed in to keep this module free of a parser import cycle.
 */
export function seedPhrasebook({ phrases, parse, slotKey, dict, entities }) {
  load();
  let seeded = 0;
  for (const [q, op, entity, dim] of phrases) {
    if (!entities[entity]) continue;
    const p = parse(q, { dict, entities });
    if (p.op === op && p.entity === entity && (!dim || p.dim === dim) && p.confidence >= 0.55) continue;
    const key = slotKey(p);
    if (entries.some((x) => x.key === key)) continue;
    const r = learn({ key, mapping: { op, entity, dim: dim || null }, confidence: 0.95, source: "seed", example: q });
    if (r.saved) seeded++;
  }
  return seeded;
}

/** "Correct / perfect": one more confirmation; pending patterns go live after two. */
export function confirmLearned(id) {
  load();
  const x = entries.find((e) => e.id === id) || words.find((e) => e.id === id);
  if (!x || x.status === "disabled") return null;
  x.confirmations = (x.confirmations || 0) + 1;
  x.userConfirmed = (x.userConfirmed || 0) + 1;
  if (x.status === "pending" && x.confirmations >= 2) x.status = "active";
  save();
  return x;
}

/** "Wrong answer": stop using a pattern unless users confirmed it more often than they rejected it. */
export function rejectLearned(id, note = "user said the answer was wrong") {
  load();
  const x = entries.find((e) => e.id === id);
  if (!x) return null;
  x.rejections = (x.rejections || 0) + 1;
  if (x.status === "pending" || x.rejections > (x.userConfirmed || 0)) {
    Object.assign(x, { status: "disabled", note });
    // Words learned from the same wrong answer go too (unless users confirmed them since).
    for (const w of words) if ((x.wordIds || []).includes(w.id) && !w.userConfirmed) Object.assign(w, { status: "disabled", note });
  }
  save();
  return x;
}

/** Remember that `word` was learned from the same LLM answer as `entry`. */
export function linkWord(entry, word) {
  entry.wordIds = [...new Set([...(entry.wordIds || []), word.id])];
  save();
}

export function listLearned({ status, kind } = {}) {
  load();
  const all = kind === "words" ? words.map((w) => ({ ...w, key: `word: ${w.word}`, mapping: { op: "word", entity: w.entity } })) : kind === "patterns" ? entries : [...entries, ...words.map((w) => ({ ...w, key: `word: ${w.word}`, mapping: { op: "word", entity: w.entity }, hits: w.hits || 0 }))];
  return all.filter((x) => !status || x.status === status);
}

export function setLearnedStatus(id, status) {
  load();
  if (!STATUS.includes(status)) return { ok: false, error: "bad status" };
  const w = words.find((e) => e.id === id);
  if (w) {
    w.status = status;
    save();
    return { ok: true, entry: w };
  }
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
  const wi = words.findIndex((e) => e.id === id);
  if (wi >= 0) {
    words.splice(wi, 1);
    save();
    return { ok: true };
  }
  const i = entries.findIndex((e) => e.id === id);
  if (i < 0) return { ok: false, error: "not found" };
  entries.splice(i, 1);
  save();
  return { ok: true };
}
