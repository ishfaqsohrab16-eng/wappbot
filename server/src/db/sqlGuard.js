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

/**
 * Validate a query before it runs. Returns { ok, sql, error }.
 * The engine's fixed handlers go through this as a second safety layer on top
 * of the SELECT-only database user.
 */
export function guardSql(raw, { maxRows } = {}) {
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
  const max = maxRows ?? config.db.maxRows;
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
