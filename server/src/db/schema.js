import { config } from "../config.js";
import { runQuery, dbEnabled } from "./pool.js";
import { log } from "../logger.js";

const blockedCol = new RegExp(config.db.blockedColumnsRegex, "i");
// Framework housekeeping tables the bot never needs (smaller prompt = faster model).
const ignoredTable = config.db.ignoreTablesRegex ? new RegExp(config.db.ignoreTablesRegex, "i") : null;
// Columns left out of prompts only (still queryable / shown in "all details").
const NOISE_COL = /^(updated_at|deleted_at|email_verified_at|remember_token|created_by|updated_by|deleted_by)$/i;

let cache = null; // { tables: Map<name, {columns:[{name,type,key}], rows}>, loadedAt, error }
let loading = null;

export function isBlockedColumn(name) {
  return blockedCol.test(name);
}

async function introspect() {
  const { rows } = await runQuery(
    `SELECT c.TABLE_NAME AS t, c.COLUMN_NAME AS c, c.DATA_TYPE AS dt, c.COLUMN_KEY AS k, tb.TABLE_ROWS AS r
       FROM information_schema.COLUMNS c
       JOIN information_schema.TABLES tb
         ON tb.TABLE_SCHEMA = c.TABLE_SCHEMA AND tb.TABLE_NAME = c.TABLE_NAME
      WHERE c.TABLE_SCHEMA = ?
      ORDER BY c.TABLE_NAME, c.ORDINAL_POSITION`,
    [config.db.name]
  );
  const allow = new Set(config.db.allowedTables.map((t) => t.toLowerCase()));
  const tables = new Map();
  for (const row of rows) {
    if (allow.size && !allow.has(String(row.t).toLowerCase())) continue;
    if (isBlockedColumn(row.c)) continue;
    if (ignoredTable?.test(row.t)) continue;
    if (!tables.has(row.t)) tables.set(row.t, { columns: [], rows: Number(row.r) || 0 });
    tables.get(row.t).columns.push({ name: row.c, type: row.dt, key: row.k });
  }
  return tables;
}

/** Load (and cache) the schema. Safe to call often. */
export async function getSchema({ refresh = false } = {}) {
  if (!dbEnabled()) return { tables: new Map(), error: "Database not configured" };
  if (cache && !refresh && !cache.error) return cache;
  if (loading) return loading;
  loading = (async () => {
    try {
      const tables = await introspect();
      cache = { tables, loadedAt: new Date().toISOString(), error: null };
      log.info(`Schema loaded: ${tables.size} tables from ${config.db.name}`);
      if (!tables.size) log.warn("Schema is empty. Check DB_NAME, the GRANT, and DB_ALLOWED_TABLES.");
    } catch (err) {
      log.error("Schema load failed:", err.code || err.message);
      cache = { tables: new Map(), loadedAt: new Date().toISOString(), error: err.code || "Schema load failed" };
    } finally {
      loading = null;
    }
    return cache;
  })();
  return loading;
}

function colStr(c) {
  const k = c.key === "PRI" ? "*" : "";
  const t = shortType(c.type);
  // Text columns are the default and carry no type, to keep prompts short.
  return t === "str" || t === "text" ? `${c.name}${k}` : `${c.name}${k}:${t}`;
}

function shortType(t) {
  const m = { varchar: "str", char: "str", text: "text", longtext: "text", mediumtext: "text", tinytext: "text",
    int: "int", bigint: "int", smallint: "int", tinyint: "int", mediumint: "int", decimal: "num", float: "num",
    double: "num", datetime: "datetime", timestamp: "datetime", date: "date", time: "time", enum: "enum", json: "json" };
  return m[t] || t;
}

/** Compact one-line-per-table schema text for prompts. */
export function describeTables(schema, names) {
  const lines = [];
  for (const name of names ?? schema.tables.keys()) {
    const t = schema.tables.get(name);
    if (!t) continue;
    lines.push(`${name}(${t.columns.filter((c) => !NOISE_COL.test(c.name)).map(colStr).join(", ")})`);
  }
  return lines.join("\n");
}

/**
 * Table overview for choosing tables: each table with its first columns when it
 * fits the budget, otherwise names only.
 */
export function listTableNames(schema, maxChars = 5000) {
  const names = [...schema.tables.keys()];
  for (const perTable of [8, 4]) {
    const lines = names.map((n) => {
      const cols = schema.tables.get(n).columns.map((c) => c.name);
      return `${n}(${cols.slice(0, perTable).join(", ")}${cols.length > perTable ? ", …" : ""})`;
    });
    const text = lines.join("\n");
    if (text.length <= maxChars) return text;
  }
  return names.join(", ");
}

/** "full" if the whole schema fits the prompt budget, otherwise "two-step". */
export function schemaMode(schema) {
  return describeTables(schema).length <= config.db.schemaFullMaxChars ? "full" : "two-step";
}

/** Resolve LLM-picked table names case-insensitively against the real schema. */
export function resolveTables(schema, names) {
  const byLower = new Map([...schema.tables.keys()].map((n) => [n.toLowerCase(), n]));
  const out = [];
  for (const n of names || []) {
    const real = byLower.get(String(n).toLowerCase().replace(/[`"]/g, "").trim());
    if (real && !out.includes(real)) out.push(real);
  }
  return out;
}

export function schemaSummary(schema) {
  return {
    loadedAt: schema.loadedAt,
    error: schema.error,
    mode: schema.tables.size ? schemaMode(schema) : null,
    tableCount: schema.tables.size,
    tables: [...schema.tables.entries()].map(([name, t]) => ({
      name,
      rows: t.rows,
      columns: t.columns.map((c) => c.name),
    })),
  };
}
