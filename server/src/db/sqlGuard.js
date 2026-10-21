import { config } from "../config.js";
import { isBlockedColumn } from "./schema.js";

// Statement keywords that never belong in a single read-only SELECT.
const FORBIDDEN = [
  "insert", "update", "delete", "drop", "alter", "create", "truncate", "rename", "grant",
  "revoke", "call", "handler", "lock", "unlock", "prepare", "execute", "deallocate",
  "flush", "kill", "shutdown", "install", "uninstall",
];
const FORBIDDEN_RE = new RegExp(`\\b(${FORBIDDEN.join("|")})\\b`, "i");
const DANGEROUS_RE =
  /\binto\s+(outfile|dumpfile|@)|\bload_file\s*\(|\bsleep\s*\(|\bbenchmark\s*\(|\bget_lock\s*\(|\bfor\s+update\b|\bfor\s+share\b|\bmysql\s*\.|\binformation_schema\b|\bperformance_schema\b|\bsys\s*\./i;

/** Remove string literals so keyword checks don't trip on user text like 'delete me'. */
function stripStrings(sql) {
  return sql.replace(/'(?:[^'\\]|\\.|'')*'/g, "''").replace(/"(?:[^"\\]|\\.|"")*"/g, '""');
}

/** Pull SQL out of an LLM reply (```sql fences, or raw). */
export function extractSql(text) {
  if (!text) return "";
  const fence = text.match(/```(?:sql|mysql)?\s*([\s\S]*?)```/i);
  let sql = (fence ? fence[1] : text).trim();
  const start = sql.search(/\b(select|with)\b/i);
  if (start > 0) sql = sql.slice(start);
  return sql.trim();
}

const NOT_ALIAS = new Set(
  "where join left right inner outer cross natural straight_join on using group order limit having union select as".split(" ")
);

/**
 * "All details" questions make models write SELECT * / t.*, which the guard
 * rejects. Expand stars into the table's allowed (non-sensitive) columns.
 * `tables` is the schema Map: name -> { columns: [{ name }] }.
 */
export function expandStars(sql, tables) {
  if (!sql || !tables?.size || !/\*/.test(sql)) return sql;
  const byLower = new Map([...tables.keys()].map((n) => [n.toLowerCase(), n]));
  const refs = []; // { table, alias }
  const re = /\b(?:from|join)\s+`?([a-zA-Z0-9_]+)`?(?:\s+(?:as\s+)?`?([a-zA-Z_][a-zA-Z0-9_]*)`?)?/gi;
  for (const m of sql.matchAll(re)) {
    const table = byLower.get(m[1].toLowerCase());
    if (!table) continue;
    const alias = m[2] && !NOT_ALIAS.has(m[2].toLowerCase()) ? m[2] : null;
    refs.push({ table, alias });
  }
  if (!refs.length) return sql;
  const cols = (ref, qualify) =>
    tables
      .get(ref.table)
      .columns.map((c) => (qualify ? `\`${ref.alias || ref.table}\`.\`${c.name}\`` : `\`${c.name}\``))
      .join(", ");

  // alias.* / table.*
  let out = sql.replace(/`?([a-zA-Z_][a-zA-Z0-9_]*)`?\s*\.\s*\*/g, (whole, name) => {
    const n = name.toLowerCase();
    const ref = refs.find((r) => (r.alias || "").toLowerCase() === n) || refs.find((r) => !r.alias && r.table.toLowerCase() === n);
    return ref ? cols(ref, true) : whole;
  });
  // bare * in the select list (not COUNT(*))
  const all = refs.length === 1 ? cols(refs[0], false) : refs.map((r) => cols(r, true)).join(", ");
  out = out.replace(/\bselect(\s+distinct)?\s+\*(?=\s*(,|\bfrom\b))/gi, (_w, d) => `SELECT${d || ""} ${all}`);
  out = out.replace(/,\s*\*(?=\s*(,|\bfrom\b))/gi, `, ${all}`);
  return out;
}

/**
 * Validate an LLM-generated query. Returns { ok, sql, error }.
 * The database user is SELECT-only too; this is a second layer.
 */
export function guardSql(raw) {
  let sql = String(raw || "").trim().replace(/;+\s*$/, "");
  if (!sql) return { ok: false, error: "empty query" };
  if (sql.length > 4000) return { ok: false, error: "query too long" };

  const bare = stripStrings(sql);
  if (/--|\/\*|\*\/|#/.test(bare)) return { ok: false, error: "comments are not allowed" };
  if (bare.includes(";")) return { ok: false, error: "only one statement is allowed" };
  if (!/^\s*(select|with)\b/i.test(bare)) return { ok: false, error: "only SELECT queries are allowed" };
  const kw = bare.match(FORBIDDEN_RE);
  if (kw) return { ok: false, error: `keyword not allowed: ${kw[1]}` };
  if (DANGEROUS_RE.test(bare)) return { ok: false, error: "query uses a blocked function or schema" };

  // Block sensitive columns (passwords, tokens, ...). Check identifiers only.
  const idents = bare.match(/`[^`]+`|\b[a-z_][a-z0-9_$]*\b/gi) || [];
  for (const id of idents) {
    if (isBlockedColumn(id.replace(/`/g, ""))) return { ok: false, error: `column not allowed: ${id}` };
  }
  // SELECT * could expose blocked columns, so columns must be listed. COUNT(*) is fine.
  if (/\bselect\s+(distinct\s+)?\*/i.test(bare) || /\.\s*\*/.test(bare) || /,\s*\*/.test(bare))
    return { ok: false, error: "SELECT * is not allowed, list the columns explicitly" };

  // Enforce a row cap at the outer level.
  const max = config.db.maxRows;
  const lim = sql.match(/\blimit\s+(\d+)(?:\s*,\s*(\d+))?(?:\s+offset\s+(\d+))?\s*$/i);
  if (!lim) sql = `${sql}\nLIMIT ${max}`;
  else {
    const count = Number(lim[2] ?? lim[1]);
    if (count > max) {
      const head = sql.slice(0, lim.index);
      if (lim[2]) sql = `${head}LIMIT ${lim[1]}, ${max}`;
      else sql = `${head}LIMIT ${max}${lim[3] ? ` OFFSET ${lim[3]}` : ""}`;
    }
  }
  return { ok: true, sql };
}
