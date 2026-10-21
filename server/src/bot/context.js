import { describeTables, resolveTables } from "../db/schema.js";
import { queryTokens } from "./intent.js";

const MAX_TABLES = 10;
const RESULT_CHARS = 3500;

/** Parse the first JSON object in a model reply. Returns null if none. */
export function parseJson(text) {
  const s = String(text || "");
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(s.slice(start, end + 1));
  } catch {
    return null;
  }
}

function singular(w) {
  if (w.length <= 3) return w;
  return w.replace(/ies$/, "y").replace(/(ch|sh|ss|x|z)es$/, "$1").replace(/([^s])s$/, "$1");
}

function tableWords(name) {
  return name
    .toLowerCase()
    .replace(/^(tbl|tb|lms|app|wp)_/, "")
    .split(/[_\W]+/)
    .filter(Boolean)
    .map(singular);
}

/** Tables whose name matches a word of the question (student → students, tbl_student). */
export function tablesByWords(schema, text) {
  const toks = queryTokens(text).filter((t) => t.length >= 3 && !/^\d+$/.test(t)).map(singular);
  const out = [];
  for (const name of schema.tables.keys()) {
    const words = tableWords(name);
    if (toks.some((t) => words.some((w) => w === t || (t.length >= 4 && w.startsWith(t)) || (w.length >= 4 && t.startsWith(w)))))
      out.push(name);
  }
  // Short names first: "students" before "student_fee_installments".
  return out.sort((a, b) => a.length - b.length);
}

/** For `batch_id`-style columns, find the referenced lookup table. */
export function joinTables(schema, tables) {
  const byWord = new Map();
  for (const name of schema.tables.keys()) {
    const w = tableWords(name).join("_");
    if (!byWord.has(w) || name.length < byWord.get(w).length) byWord.set(w, name);
  }
  const out = [];
  for (const t of tables) {
    for (const c of schema.tables.get(t)?.columns || []) {
      const m = c.name.toLowerCase().match(/^(.+?)_?id$/);
      if (!m || c.key === "PRI") continue;
      const ref = byWord.get(singular(m[1].replace(/^(fk_|std_)/, "")));
      if (ref && ref !== t && !tables.includes(ref) && !out.includes(ref)) out.push(ref);
    }
  }
  return out;
}

/**
 * Tables to show the SQL writer: model picks + tables named in the question +
 * tables holding matched names + their join targets, within a character budget.
 */
export function chooseTables(schema, { picked = [], question = "", text = "", ranked = [], budget = 9000 }) {
  const list = [];
  const add = (names) => {
    for (const n of names) if (n && schema.tables.has(n) && !list.includes(n)) list.push(n);
  };
  add(resolveTables(schema, picked));
  add(tablesByWords(schema, `${question} ${text}`).slice(0, 4));
  add(ranked.slice(0, 6).map((h) => h.table));
  add(joinTables(schema, list.slice(0, 4)).slice(0, 4));
  if (!list.length) add([...schema.tables.keys()].slice(0, 6));

  const out = [];
  let used = 0;
  for (const name of list) {
    const len = describeTables(schema, [name]).length + 1;
    if (out.length && used + len > budget) continue;
    out.push(name);
    used += len;
    if (out.length >= MAX_TABLES) break;
  }
  return out;
}

function cell(v) {
  if (v === null || v === undefined) return null;
  if (Buffer.isBuffer(v)) return "[binary]";
  if (v instanceof Date) return v.toISOString();
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  return s.length > 150 ? `${s.slice(0, 150)}…` : s;
}

/** Rows as compact JSON lines, null fields dropped, within a char budget. */
export function formatRows(rows, maxChars = RESULT_CHARS) {
  const lines = [];
  let used = 0;
  for (const r of rows) {
    const obj = {};
    for (const [k, v] of Object.entries(r)) {
      const c = cell(v);
      if (c !== null && c !== "") obj[k] = c;
    }
    const line = JSON.stringify(obj);
    if (used + line.length > maxChars) {
      lines.push(`… (${rows.length - lines.length} more rows not shown)`);
      break;
    }
    lines.push(line);
    used += line.length;
  }
  return lines.join("\n");
}

/** Recent turns as a short "User:/Assistant:" transcript. */
export function transcript(history, maxChars = 2500) {
  const lines = [];
  let used = 0;
  for (const m of [...history].reverse()) {
    const content = m.content.length > 350 ? `${m.content.slice(0, 350)}…` : m.content;
    const line = `${m.role === "user" ? "User" : "Assistant"}: ${content.replace(/\s+/g, " ")}`;
    if (used + line.length > maxChars) break;
    lines.unshift(line);
    used += line.length;
  }
  return lines.join("\n");
}

export function lastLookupText(last) {
  if (!last?.question) return "";
  return [
    `Question: ${last.question}`,
    last.sql ? `SQL: ${last.sql.replace(/\s+/g, " ").slice(0, 400)}` : "",
    `Rows: ${last.rowCount ?? 0}${last.sample ? `\nFirst rows: ${last.sample}` : ""}`,
  ]
    .filter(Boolean)
    .join("\n");
}
