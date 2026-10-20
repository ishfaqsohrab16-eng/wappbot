import { runQuery } from "./pool.js";
import { log } from "../logger.js";
import { queryTokens } from "../bot/intent.js";

const TABLE_HINT =
  /center|centre|campus|branch|institute|batch|program|course|class|dept|department|city|location|site|school|college|role|session|shift|trade|skill|categor|organis|organiz|partner|project|module|subject|section|faculty|office|region|district|province|status|type/i;

const COL_HINT =
  /^(.*_)?(name|title|code|short_name|slug|label|alias|display_name|full_name|center_name|batch_name|program_name|course_name|city|location)s?$/i;

const STRING_TYPES = new Set(["varchar", "char", "text", "tinytext", "mediumtext", "longtext", "enum"]);

const PLACE = {
  qta: "quetta",
  qetta: "quetta",
  kwetta: "quetta",
  khi: "karachi",
  lhr: "lahore",
  isb: "islamabad",
  rwp: "rawalpindi",
  psh: "peshawar",
  fsd: "faisalabad",
  hyd: "hyderabad",
  mtn: "multan",
};

const MAX_VALUES_PER_COL = 250;
const MAX_CATALOG_CHARS = 4500;

let cache = null;

export function invalidateCatalog() {
  cache = null;
}

export function ident(name) {
  const n = String(name || "");
  if (!/^[a-zA-Z0-9_]+$/.test(n)) throw new Error("invalid identifier");
  return `\`${n}\``;
}

export function fold(s) {
  const t = String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return t
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => PLACE[w] || w)
    .join(" ");
}

export function compact(s) {
  return fold(s).replace(/ /g, "");
}

export function acronym(s) {
  return fold(s)
    .split(/\s+/)
    .filter((w) => w.length && !/^\d+$/.test(w))
    .map((w) => w[0])
    .join("");
}

function isSubsequence(small, large) {
  if (!small || !large || small.length > large.length) return false;
  let i = 0;
  for (const ch of large) {
    if (ch === small[i]) i++;
    if (i === small.length) return true;
  }
  return false;
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const m = [];
  for (let i = 0; i <= b.length; i++) m[i] = [i];
  for (let j = 0; j <= a.length; j++) m[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      m[i][j] = Math.min(m[i - 1][j] + 1, m[i][j - 1] + 1, m[i - 1][j - 1] + (b[i - 1] === a[j - 1] ? 0 : 1));
    }
  }
  return m[b.length][a.length];
}

/** Score how well a catalog value matches a messy user phrase. Higher is better. */
export function scoreMatch(query, value) {
  const q = fold(query);
  const v = fold(value);
  if (!q || !v) return 0;
  if (q === v) return 100;
  const qc = compact(q);
  const vc = compact(v);
  const qt = q.split(/\s+/);
  const vt = new Set(v.split(/\s+/));
  let score = 0;
  if (v.includes(q) || q.includes(v)) score = Math.max(score, 82);
  if (qc && vc && (vc.includes(qc) || qc.includes(vc))) score = Math.max(score, 80);
  const ac = acronym(v);
  if (ac.length >= 2 && (qc === ac || q.replace(/ /g, "") === ac)) score = Math.max(score, 88);
  if (qc.length >= 3 && ac.length >= 3 && (qc === ac || isSubsequence(qc, ac) || isSubsequence(ac, qc)))
    score = Math.max(score, 76);
  if (qc.length >= 4 && vc.length >= 4 && isSubsequence(qc, vc)) score = Math.max(score, 72);
  const overlap = qt.filter((t) => vt.has(t) || [...vt].some((x) => x.startsWith(t) || t.startsWith(x))).length;
  if (qt.length) score = Math.max(score, Math.round((overlap / qt.length) * 70));
  const maxLen = Math.max(qc.length, vc.length);
  if (maxLen && maxLen <= 24) {
    const d = levenshtein(qc, vc);
    score = Math.max(score, Math.round((1 - d / maxLen) * 65));
  }
  return score;
}

export function nameColumns(schema, tableNames) {
  const allow = tableNames ? new Set(tableNames) : null;
  const out = [];
  for (const [table, t] of schema.tables) {
    if (allow && !allow.has(table)) continue;
    const tableLooks = TABLE_HINT.test(table);
    for (const c of t.columns) {
      if (!STRING_TYPES.has(c.type) && c.type !== "str" && c.type !== "text" && c.type !== "enum") continue;
      if (!COL_HINT.test(c.name)) continue;
      if (tableLooks || COL_HINT.test(c.name)) out.push({ table, column: c.name, rows: t.rows || 0 });
    }
  }
  return out;
}

async function loadValues(schema) {
  const groups = [];
  for (const col of nameColumns(schema)) {
    const lookup = TABLE_HINT.test(col.table) || col.rows <= 400;
    if (!lookup) continue;
    try {
      const sql = `SELECT DISTINCT TRIM(LEFT(${ident(col.column)}, 160)) AS v
        FROM ${ident(col.table)}
        WHERE ${ident(col.column)} IS NOT NULL AND TRIM(${ident(col.column)}) <> ''
        LIMIT ${MAX_VALUES_PER_COL}`;
      const { rows } = await runQuery(sql);
      const values = rows.map((r) => String(r.v || "").trim()).filter(Boolean);
      if (values.length) groups.push({ table: col.table, column: col.column, values });
    } catch (err) {
      log.debug(`catalog skip ${col.table}.${col.column}:`, err.code || err.message);
    }
  }
  return groups;
}

function catalogText(groups) {
  const lines = [];
  let used = 0;
  for (const g of groups) {
    const head = `${g.table}.${g.column}: `;
    const body = g.values.join(" | ");
    const line = head + (head.length + body.length > 700 ? `${g.values.slice(0, 80).join(" | ")} …` : body);
    if (used + line.length > MAX_CATALOG_CHARS) {
      lines.push("… (more names in the database; query DISTINCT if you need a full list)");
      break;
    }
    lines.push(line);
    used += line.length;
  }
  return lines.join("\n");
}

/** Cached DISTINCT name/code values from lookup-style tables. */
export async function getCatalog(schema, { refresh = false } = {}) {
  if (!schema?.tables?.size) return { groups: [], text: "", schemaAt: null };
  if (cache && !refresh && cache.schemaAt === schema.loadedAt) return cache;
  const groups = await loadValues(schema);
  cache = { groups, text: catalogText(groups), schemaAt: schema.loadedAt, loadedAt: new Date().toISOString() };
  log.info(`Catalog loaded: ${groups.length} name columns, ${groups.reduce((n, g) => n + g.values.length, 0)} values`);
  return cache;
}

/**
 * Rank catalog values against the user question.
 * Returns top hits so the model can use official spellings.
 */
export function rankCatalog(catalog, question, { limit = 18, minScore = 48 } = {}) {
  const q = String(question || "").trim();
  const tokens = queryTokens(q);
  if (!q || !catalog?.groups?.length) return [];
  const hits = [];
  for (const g of catalog.groups) {
    for (const value of g.values) {
      let s = scoreMatch(q, value);
      for (const tok of tokens) s = Math.max(s, scoreMatch(tok, value));
      if (s >= minScore) hits.push({ table: g.table, column: g.column, value, score: s });
    }
  }
  hits.sort((a, b) => b.score - a.score || a.value.localeCompare(b.value));
  const seen = new Set();
  const out = [];
  for (const h of hits) {
    const k = `${h.table}.${h.column}:${h.value.toLowerCase()}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(h);
    if (out.length >= limit) break;
  }
  return out;
}

export function formatRanked(hits) {
  if (!hits.length) return "";
  return hits.map((h) => `- ${h.table}.${h.column} = "${h.value}" (match ${h.score})`).join("\n");
}

/** Live LIKE search on name columns using tokens from the question. */
export async function lookupNameHits(schema, question, tableNames) {
  const tokens = queryTokens(question).filter((t) => t.length >= 2).slice(0, 6);
  if (!tokens.length) return [];
  const cols = nameColumns(schema, tableNames).slice(0, 14);
  const hits = [];
  for (const col of cols) {
    try {
      const likes = tokens.map(() => `${ident(col.column)} LIKE ?`).join(" OR ");
      const sql = `SELECT DISTINCT TRIM(LEFT(${ident(col.column)}, 160)) AS name
        FROM ${ident(col.table)}
        WHERE ${ident(col.column)} IS NOT NULL AND (${likes})
        LIMIT 20`;
      const { rows } = await runQuery(
        sql,
        tokens.map((t) => `%${t}%`)
      );
      for (const r of rows) {
        const name = String(r.name || "").trim();
        if (name) hits.push({ table: col.table, column: col.column, value: name, score: scoreMatch(question, name) });
      }
    } catch (err) {
      log.debug(`name lookup skip ${col.table}.${col.column}:`, err.code || err.message);
    }
  }
  hits.sort((a, b) => b.score - a.score);
  const seen = new Set();
  return hits.filter((h) => {
    const k = `${h.table}:${h.value.toLowerCase()}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, 25);
}
