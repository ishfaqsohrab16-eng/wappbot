import { describeTables, resolveTables } from "../db/schema.js";
import { queryTokens } from "./intent.js";
import { ident } from "../db/catalog.js";

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
  w = w.replace(/centre/g, "center");
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

const refCache = new WeakMap();

/** Lookup table a `course_id` / `centerId` / `std_batch_id` column points to, or null. */
export function refTableFor(schema, column, selfTable) {
  let byWord = refCache.get(schema);
  if (!byWord) {
    byWord = new Map();
    for (const name of schema.tables.keys()) {
      const w = tableWords(name).join("_");
      if (!byWord.has(w) || name.length < byWord.get(w).length) byWord.set(w, name);
    }
    refCache.set(schema, byWord);
  }
  const m = String(column)
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .match(/^(.+?)_?id$/);
  if (!m) return null;
  const base = m[1].replace(/^(fk|std|student|ref)_(?=.)/, "").replace(/_$/, "");
  const parts = base.split("_").map(singular);
  const ref = byWord.get(parts.join("_")) || byWord.get(parts.at(-1));
  return ref && ref !== selfTable ? ref : null;
}

/** For `batch_id`-style columns, find the referenced lookup tables. */
export function joinTables(schema, tables) {
  const out = [];
  for (const t of tables) {
    for (const c of schema.tables.get(t)?.columns || []) {
      if (c.key === "PRI") continue;
      const ref = refTableFor(schema, c.name, t);
      if (ref && !tables.includes(ref) && !out.includes(ref)) out.push(ref);
    }
  }
  return out;
}

const LABEL_RE = /(^|_)(full_?name|name|title|label|code)$/i;

/** Primary key and best human-readable column of a lookup table. */
export function labelColumns(schema, table) {
  const cols = schema.tables.get(table)?.columns || [];
  const pk = cols.find((c) => c.key === "PRI")?.name || cols.find((c) => c.name.toLowerCase() === "id")?.name;
  const words = tableWords(table);
  const score = (c) => {
    const n = c.name.toLowerCase();
    let s = /name$/.test(n) ? 3 : /title$/.test(n) ? 2 : 1;
    if (words.some((w) => n.startsWith(w))) s += 2;
    if (/^(short|user|slug|login)/.test(n)) s -= 2;
    return s;
  };
  const labels = cols.filter((c) => LABEL_RE.test(c.name) && c.name !== pk).sort((a, b) => score(b) - score(a));
  return pk && labels.length ? { pk, label: labels[0].name } : null;
}

function prettyKey(column) {
  return String(column)
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .replace(/_?id$/i, "")
    .replace(/^(fk|std|ref)_/i, "");
}

/**
 * Replace *_id values in result rows with the referenced record's name
 * (course_id 3 → course "Web Development"). `query(sql, params)` runs SQL.
 */
export async function resolveIdColumns(schema, rows, query, { selfTable } = {}) {
  if (!rows?.length) return rows;
  const keys = Object.keys(rows[0]).filter((k) => /(_id|[a-z]Id)$/.test(k));
  const maps = [];
  for (const k of keys.slice(0, 8)) {
    const ref = refTableFor(schema, k, selfTable);
    const lc = ref && labelColumns(schema, ref);
    if (!lc) continue;
    const ids = [...new Set(rows.map((r) => r[k]).filter((v) => v !== null && v !== undefined && v !== ""))].slice(0, 200);
    if (!ids.length) continue;
    try {
      const sql = `SELECT ${ident(lc.pk)} AS k, ${ident(lc.label)} AS v FROM ${ident(ref)} WHERE ${ident(lc.pk)} IN (?)`;
      const { rows: found } = await query(sql, [ids]);
      const names = new Map(found.map((f) => [String(f.k), f.v]));
      if (names.size) maps.push({ key: k, out: prettyKey(k), names });
    } catch {
      // keep the ids as they are
    }
  }
  if (!maps.length) return rows;
  return rows.map((r) => {
    const o = {};
    for (const [k, v] of Object.entries(r)) {
      const m = maps.find((x) => x.key === k);
      if (!m) {
        o[k] = v;
        continue;
      }
      const name = m.names.get(String(v));
      o[name !== undefined && !(m.out in r) ? m.out : k] = name ?? v;
    }
    return o;
  });
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
