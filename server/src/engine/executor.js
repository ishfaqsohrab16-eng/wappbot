import { config } from "../config.js";
import { guardSql } from "../db/sqlGuard.js";
import { lookupName } from "./dictionary.js";
import { scoreMatch } from "../db/catalog.js";

// Plan → fixed, parameterized, read-only SQL. Only expressions from entities.js
// are ever placed in the SQL text; every user value is a bound "?" parameter.

export const CHAT_LIST_ROWS = 20;
const CACHE_TTL_MS = () => config.engine.resultCacheMs;
const cache = new Map(); // key -> { at, value }

export function clearResultCache() {
  cache.clear();
}

function cached(key, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS()) return Promise.resolve(hit.value);
  return fn().then((value) => {
    if (CACHE_TTL_MS() > 0) {
      cache.set(key, { at: Date.now(), value });
      if (cache.size > 500) cache.delete(cache.keys().next().value);
    }
    return value;
  });
}

function where(e, plan, student) {
  const sql = [];
  const params = [];
  const f = plan.filters || {};
  for (const [name, v] of Object.entries(f)) {
    if (name === "date") {
      if (!e.date) continue;
      sql.push(`${e.date} >= ? AND ${e.date} < DATE_ADD(?, INTERVAL 1 DAY)`);
      params.push(v.from, v.to);
      continue;
    }
    const expr = e.filters?.[name];
    if (!expr) continue;
    const vals = v.ids ?? v.values;
    if (!vals?.length) continue;
    if (expr.includes("?")) sql.push(expr);
    else sql.push(`${expr} IN (?)`);
    params.push(vals);
  }
  if (student && e.student) {
    sql.push(`${e.student.col} = ?`);
    params.push(student[e.student.via]);
  }
  return { sql: sql.length ? ` WHERE ${sql.join(" AND ")}` : "", params };
}

function identClause(col, ident) {
  switch (ident.type) {
    case "cnic":
      return { sql: `REPLACE(REPLACE(${col}, '-', ''), ' ', '') = ?`, params: [ident.value] };
    case "phone":
      return { sql: `REPLACE(REPLACE(${col}, '-', ''), ' ', '') LIKE ?`, params: [`%${ident.value}`] };
    case "rollno":
      return { sql: `UPPER(${col}) = ?`, params: [ident.value] };
    case "email":
      return { sql: `LOWER(${col}) = ?`, params: [ident.value] };
    default:
      return { sql: `${col} LIKE ?`, params: [`%${String(ident.value).split(/\s+/).join("%")}%`] };
  }
}

function addWhere(w, clause) {
  return {
    sql: w.sql ? `${w.sql} AND ${clause.sql}` : ` WHERE ${clause.sql}`,
    params: [...w.params, ...clause.params],
  };
}

async function run(query, sql, params, maxRows) {
  const g = guardSql(sql, { maxRows });
  if (!g.ok) throw Object.assign(new Error(`blocked: ${g.error}`), { code: "sql_blocked" });
  return (await query(g.sql, params)).rows;
}

/** Rough sound-alike key for South Asian names: "Aly Kahn" ~ "Ali Khan", "Muhammed" ~ "Muhammad". */
function nameKey(w) {
  return w
    .toLowerCase()
    .replace(/[^a-z]/g, "")
    .replace(/y/g, "i")
    .replace(/(?!^)h/g, "")
    .replace(/(.)\1+/g, "$1")
    .replace(/(?!^)[aeiou]/g, "");
}

function damerau(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  return d[a.length][b.length];
}

/** 0-100: every query word matched to its best name word (sound-alike or edit distance). */
export function nameSimilarity(query, name) {
  const q = String(query).toLowerCase().split(/\s+/).filter(Boolean);
  const n = String(name).toLowerCase().split(/\s+/).filter(Boolean);
  if (!q.length || !n.length) return 0;
  let total = 0;
  for (const w of q) {
    let best = 0;
    for (const v of n) {
      if (nameKey(w) && nameKey(w) === nameKey(v)) best = Math.max(best, 0.92);
      best = Math.max(best, 1 - damerau(w, v) / Math.max(w.length, v.length));
    }
    total += best;
  }
  return Math.round((total / q.length) * 100);
}

/** Ids of the closest names for a misspelled query (e.g. "aly kahn" → "Ali Khan"). */
async function fuzzyNameIds(e, name, w0, query) {
  const words = String(name).toLowerCase().split(/\s+/).filter((x) => x.length >= 2).slice(0, 4);
  if (!words.length) return [];
  const col = e.idents.name;
  const likes = words.map(() => `${col} LIKE ?`).join(" OR ");
  const w = addWhere(w0, { sql: `(${likes})`, params: words.map((x) => `%${x.slice(0, Math.min(3, x.length))}%`) });
  const rows = await run(query, `SELECT ${e.key} AS id, ${col} AS name FROM ${e.from}${w.sql} LIMIT 400`, w.params, 400);
  const scored = rows
    .map((r) => ({ id: r.id, score: Math.max(scoreMatch(name, r.name || ""), nameSimilarity(name, r.name || "")) }))
    .filter((r) => r.score >= 62)
    .sort((a, b) => b.score - a.score);
  if (!scored.length) return [];
  const top = scored[0].score;
  return scored.filter((r) => r.score >= top - 6).slice(0, 5);
}

const countExpr = (e, plan) =>
  plan.entity === "attendance" && !plan.studentScoped ? "COUNT(DISTINCT a.std_cnic)" : "COUNT(*)";

/** Find the student a per-student question is about. */
async function findStudent(entities, plan, query) {
  const s = entities.student;
  if (!s) return null;
  const col = s.idents[plan.ident.type] || (plan.ident.type === "email" ? "u.user_email" : null);
  if (!col) return null;
  const c = identClause(col, plan.ident);
  const rows = await run(
    query,
    `SELECT s.std_id, s.std_cnic, s.std_rollno, u.user_name AS name FROM ${s.from} WHERE ${c.sql} LIMIT 2`,
    c.params,
    2
  );
  return rows;
}

/**
 * Execute a validated plan. Returns { rows, total?, meta } (raw data, not text).
 * opts.exportRows: fetch up to N rows for a file export.
 */
export async function execute(plan, { entities, query, exportRows = 0 }) {
  const e = entities[plan.entity];
  if (!e) throw Object.assign(new Error("unknown entity"), { code: "bad_plan" });
  const meta = {};
  let student = null;

  if (plan.ident && e.student && plan.entity !== "student") {
    const found = await findStudent(entities, plan, query);
    if (!found?.length) return { rows: [], meta: { studentNotFound: true } };
    student = found[0];
    meta.student = student;
    plan.studentScoped = true;
  }

  const w0 = where(e, plan, student);
  const key = JSON.stringify({ o: plan.op, e: plan.entity, d: plan.dim, f: plan.filters, l: plan.limit, x: exportRows, s: student?.std_id });
  const personal = Boolean(plan.ident);

  const go = async () => {
    switch (plan.op) {
      case "count": {
        const rows = await run(query, `SELECT ${countExpr(e, plan)} AS n FROM ${e.from}${w0.sql}`, w0.params, 1);
        return { rows, n: Number(rows[0]?.n || 0) };
      }
      case "count_by": {
        const dimCol = e.filters?.[plan.dim];
        if (!dimCol || dimCol.includes("?")) throw Object.assign(new Error("bad dim"), { code: "bad_plan" });
        const rows = await run(
          query,
          `SELECT ${dimCol} AS k, ${countExpr(e, plan)} AS n FROM ${e.from}${w0.sql} GROUP BY ${dimCol} ORDER BY n DESC`,
          w0.params,
          100
        );
        return { rows };
      }
      case "sum": {
        const rows = await run(query, `SELECT SUM(${e.sum}) AS total, COUNT(*) AS n FROM ${e.from}${w0.sql}`, w0.params, 1);
        return { rows };
      }
      case "avg": {
        const [label, col] = Object.entries(e.avg)[0];
        const rows = await run(
          query,
          `SELECT ROUND(AVG(${col}), 2) AS avg, MIN(${col}) AS min, MAX(${col}) AS max, COUNT(${col}) AS n FROM ${e.from}${w0.sql}`,
          w0.params,
          1
        );
        return { rows, label };
      }
      case "top": {
        const metric = e.top.metric || `SUM(${e.sum})`;
        const n = Math.min(plan.limit || 10, 50);
        const rows = await run(
          query,
          `SELECT ${e.top.label} AS name, ${metric} AS v FROM ${e.from} ${e.top.join}${w0.sql} GROUP BY ${e.top.by}, ${e.top.label} ORDER BY v DESC LIMIT ${n}`,
          w0.params,
          n
        );
        return { rows };
      }
      case "current": {
        const rows = await run(query, `SELECT ${e.details.join(", ")} FROM ${e.from} ORDER BY ${e.order} LIMIT 1`, [], 1);
        return { rows };
      }
      case "details": {
        let w = w0;
        if (plan.lookupIds?.length) w = addWhere(w0, { sql: `${e.key} IN (?)`, params: [plan.lookupIds] });
        else if (plan.ident) {
          const col = e.idents?.[plan.ident.type];
          if (!col) throw Object.assign(new Error("no ident"), { code: "bad_ident" });
          w = addWhere(w0, identClause(col, plan.ident));
        }
        let rows = await run(query, `SELECT ${e.details.join(", ")} FROM ${e.from}${w.sql} ORDER BY ${e.order} LIMIT 5`, w.params, 5);
        // Misspelled name: pull candidates sharing word prefixes, rank by similarity.
        if (!rows.length && plan.ident?.type === "name" && e.idents?.name) {
          const ids = await fuzzyNameIds(e, plan.ident.value, w0, query);
          if (ids.length) {
            const wf = addWhere(w0, { sql: `${e.key} IN (?)`, params: [ids.map((x) => x.id)] });
            rows = await run(query, `SELECT ${e.key} AS __k, ${e.details.join(", ")} FROM ${e.from}${wf.sql} LIMIT 5`, wf.params, 5);
            const order = new Map(ids.map((x, i) => [String(x.id), i]));
            rows.sort((a, b) => (order.get(String(a.__k)) ?? 9) - (order.get(String(b.__k)) ?? 9));
            rows = rows.map(({ __k, ...r }) => r);
            return { rows, fuzzy: true };
          }
        }
        return { rows };
      }
      case "list":
      default: {
        const limit = exportRows || CHAT_LIST_ROWS;
        const [rows, cnt] = await Promise.all([
          run(query, `SELECT ${e.list.join(", ")} FROM ${e.from}${w0.sql} ORDER BY ${e.order} LIMIT ${limit}`, w0.params, limit),
          run(query, `SELECT COUNT(*) AS n FROM ${e.from}${w0.sql}`, w0.params, 1),
        ]);
        return { rows, total: Number(cnt[0]?.n || 0) };
      }
    }
  };
  const out = personal || CACHE_TTL_MS() <= 0 ? await go() : await cached(key, go);
  return { ...out, meta };
}

// ---- formatting ---------------------------------------------------------

const LABELS = {
  cnic: "CNIC", roll_no: "Roll No", tb_id: "Batch", center_id: "Center", course_id: "Course", t_course_id: "Course",
  lms_status: "LMS Status", forum_status: "Forum Status", dob: "Date of Birth", date_of_birth: "Date of Birth",
  added_on: "Added On", applied_on: "Applied On", has_laptop: "Has Laptop", ticket_no: "Ticket No",
};

export function prettyLabel(k) {
  if (LABELS[k]) return LABELS[k];
  return String(k)
    .replace(/^(std|cand|t|tb|sl|tl|cd|ea|cs|lr|ls|dlr|ta|sfp|sd|as|ca|us)_/, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

const ID_KIND = { tb_id: "batch", center_id: "center", course_id: "course", t_course_id: "course", k_batch: "batch" };

/** Replace batch/center/course ids with names and status codes with words. */
export function humanizeRow(row, { dict, entity, dim } = {}) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    const kind = ID_KIND[k];
    if (kind) {
      out[LABELS[k] || prettyLabel(k)] = lookupName(dict, kind, v) ?? v;
      continue;
    }
    if (k === "k" && ["batch", "center", "course"].includes(dim)) {
      out.k = lookupName(dict, dim, v) ?? v;
      continue;
    }
    if ((k === "status" || /_status$/.test(k) || (k === "k" && dim === "status")) && entity?.status) {
      const word = Object.entries(entity.status).find(([, code]) => String(code) === String(v))?.[0];
      out[k === "k" ? "k" : prettyLabel(k)] = word ? word[0].toUpperCase() + word.slice(1) : v;
      continue;
    }
    out[k === "k" || k === "n" || k === "v" || k === "name" ? k : prettyLabel(k)] = v;
  }
  return out;
}

const fmtNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString("en-US", { maximumFractionDigits: 2 }) : String(v ?? "—");
};

export function filterSummary(plan) {
  const f = plan.filters || {};
  const parts = [];
  for (const k of ["batch", "center", "course", "gender", "status", "district", "qualification", "city", "platform", "type"]) {
    if (f[k]?.label) parts.push(k === "batch" && !/batch/i.test(f[k].label) ? `Batch ${f[k].label}` : f[k].label);
  }
  if (f.date?.label) parts.push(f.date.label);
  return parts.join(" · ");
}

function cap(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

function isEmpty(v) {
  return v === null || v === undefined || v === "" || v === "null";
}

/** Reply text for an executed plan. */
export function formatReply(plan, res, { entities, dict }) {
  const e = entities[plan.entity];
  const scope = filterSummary(plan);
  const scopeLine = scope ? `\n_${scope}_` : "";
  const who = res.meta?.student ? ` for *${res.meta.student.name || res.meta.student.std_rollno}*` : "";

  if (res.meta?.studentNotFound)
    return `I couldn't find a student with ${plan.ident.type === "name" ? "the name" : plan.ident.type.toUpperCase()} *${plan.ident.display}*. Please check it and send again.`;

  switch (plan.op) {
    case "count": {
      const noun = plan.entity === "attendance" ? "students" : res.n === 1 ? e.singular : e.plural;
      const label = plan.entity === "attendance" && plan.filters?.status?.label ? ` ${plan.filters.status.label}` : "";
      return `*${fmtNum(res.n)}* ${noun}${label}${who}${scopeLine}`;
    }
    case "count_by": {
      if (!res.rows.length) return `No ${e.plural} found${who}.${scopeLine}`;
      const total = res.rows.reduce((s, r) => s + Number(r.n || 0), 0);
      const lines = res.rows.slice(0, 40).map((r) => {
        const h = humanizeRow(r, { dict, entity: e, dim: plan.dim });
        const pct = total ? ` (${Math.round((Number(r.n) / total) * 100)}%)` : "";
        return `• ${isEmpty(h.k) ? "Not set" : h.k}: *${fmtNum(r.n)}*${pct}`;
      });
      const more = res.rows.length > 40 ? `\n…and ${res.rows.length - 40} more` : "";
      return `*${cap(e.plural)} by ${plan.dim}*${who}${scopeLine}\n${lines.join("\n")}${more}\nTotal: *${fmtNum(total)}*`;
    }
    case "sum": {
      const r = res.rows[0] || {};
      const approved = plan.filters?.status?.label ? ` (${plan.filters.status.label})` : "";
      return `💰 Total ${e.sumLabel || "amount"}${approved}${who}: *${fmtNum(r.total || 0)}* from *${fmtNum(r.n || 0)}* ${Number(r.n) === 1 ? "entry" : "entries"}${scopeLine}`;
    }
    case "avg": {
      const r = res.rows[0] || {};
      if (!Number(r.n)) return `No ${res.label} recorded yet${who}.${scopeLine}`;
      return `📊 Average ${res.label}${who}: *${fmtNum(r.avg)}* (lowest ${fmtNum(r.min)}, highest ${fmtNum(r.max)}, ${fmtNum(r.n)} records)${scopeLine}`;
    }
    case "top": {
      if (!res.rows.length) return `No ${e.plural} found.${scopeLine}`;
      const lines = res.rows.map((r, i) => `${i + 1}. ${r.name || "Unknown"} — *${fmtNum(r.v)}*`);
      return `🏆 *Top ${res.rows.length}* by ${plan.entity === "earning" ? "earnings" : "score"}${scopeLine}\n${lines.join("\n")}`;
    }
    case "current": {
      const r = res.rows[0];
      if (!r) return "No batches found.";
      return `📅 Current batch: *${r.batch}*${r.starts ? `\nStarts: ${String(r.starts).slice(0, 10)}` : ""}${r.ends ? `\nEnds: ${String(r.ends).slice(0, 10)}` : ""}`;
    }
    case "details": {
      if (!res.rows.length) {
        const what = plan.ident ? `${plan.ident.type === "name" ? "name" : plan.ident.type.toUpperCase()} *${plan.ident.display}*` : "that";
        return `No ${e.singular} found with ${what}. Please check it and try again.`;
      }
      const intro = res.fuzzy ? `No exact match for *${plan.ident.display}*. Closest ${res.rows.length > 1 ? "matches" : "match"}:

` : "";
      return intro + res.rows
        .map((row) => {
          const h = humanizeRow(row, { dict, entity: e });
          const title = h.Name || h.name || h.Center || h.Batch || h.Course || cap(e.singular);
          const lines = Object.entries(h)
            .filter(([k, v]) => !isEmpty(v) && !["Name", "name"].includes(k))
            .map(([k, v]) => `• *${k}:* ${String(v).length > 120 ? `${String(v).slice(0, 120)}…` : v}`);
          const icon = ["student", "trainer", "candidate"].includes(plan.entity) ? "👤" : plan.entity === "center" ? "📍" : "📋";
          return `${icon} *${title}*\n${lines.join("\n")}`;
        })
        .join("\n\n");
    }
    case "list":
    default: {
      if (!res.rows.length) return `No ${e.plural} found${who}.${scopeLine}`;
      const lines = res.rows.slice(0, CHAT_LIST_ROWS).map((row, i) => {
        const h = humanizeRow(row, { dict, entity: e });
        const vals = Object.values(h).filter((v) => !isEmpty(v)).map((v) => String(v).slice(0, 60));
        return `${i + 1}. ${vals.join(" — ")}`;
      });
      const shown = Math.min(res.rows.length, CHAT_LIST_ROWS);
      const head = `*${cap(e.plural)}*${who} (${res.total > shown ? `showing ${shown} of ${fmtNum(res.total)}` : fmtNum(res.total)})${scopeLine}`;
      return `${head}\n${lines.join("\n")}`;
    }
  }
}

/** Short capability list for "help" and unknown questions. */
export function helpText(entities) {
  const has = (n) => Boolean(entities[n]);
  const ex = [
    has("student") && "• How many students in batch 10?",
    has("student") && "• Students by center / female students in Quetta",
    has("student") && "• Details of student 54401-1234567-1",
    has("attendance") && "• Attendance today / absent students this week",
    has("candidate") && "• How many applicants were admitted this month?",
    has("earning") && "• Total earnings in batch 10 / top 10 earners",
    has("trainer") && "• List trainers in Quetta center",
    has("batch") && "• Which batch is running?",
    "• Add *excel*, *chart* or *word report* to get a file",
  ].filter(Boolean);
  return `I can answer questions about the LMS data. Try:\n${ex.join("\n")}`;
}
