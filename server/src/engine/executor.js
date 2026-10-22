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
  // "what about the others" → everything except the previous filter value
  for (const [name, v] of Object.entries(plan.exclude || {})) {
    const expr = e.filters?.[name];
    if (!expr || !v.ids?.length) continue;
    if (expr.includes("?")) sql.push(`NOT (${expr})`);
    else sql.push(`(${expr} NOT IN (?) OR ${expr} IS NULL)`);
    params.push(v.ids);
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

// ---- trainer punctuality: check-ins vs class schedules ---------------------

/** Minutes after midnight from "15:05:00", "03:00 PM", "2026-10-22 11:24:00" or a Date. */
export function clockMinutes(v) {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) return v.getHours() * 60 + v.getMinutes();
  const m = String(v).trim().match(/(\d{1,2}):(\d{2})(?::\d{2})?\s*([ap])?\.?\s*m?\.?/i);
  if (!m) return null;
  let h = Number(m[1]);
  const ap = m[3]?.toLowerCase();
  if (ap === "p" && h < 12) h += 12;
  if (ap === "a" && h === 12) h = 0;
  return h * 60 + Number(m[2]);
}

const pad2 = (n) => String(n).padStart(2, "0");
const ymd = (v) => (v instanceof Date ? `${v.getFullYear()}-${pad2(v.getMonth() + 1)}-${pad2(v.getDate())}` : String(v ?? "").slice(0, 10));
const hhmm = (mins) => (mins === null ? "—" : `${pad2(Math.floor(mins / 60))}:${pad2(mins % 60)}`);
const WEEK = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/** "Monday to Friday", "Mon, Wed, Fri", "Mon-Sat" → is `date` a class day? Unknown text → true. */
export function isClassDay(days, date) {
  const s = String(days || "").toLowerCase();
  const d = new Date(`${ymd(date)}T12:00:00Z`).getUTCDay();
  if (!s || Number.isNaN(d)) return true;
  const idx = (w) => WEEK.findIndex((x) => x.startsWith(w.slice(0, 3)));
  const range = s.match(/([a-z]{3,})\w*\s*(?:to|-|–|till|through)\s*([a-z]{3,})/);
  if (range && idx(range[1]) >= 0 && idx(range[2]) >= 0) {
    const a = idx(range[1]);
    const b = idx(range[2]);
    return a <= b ? d >= a && d <= b : d >= a || d <= b;
  }
  const listed = (s.match(/[a-z]{3,}/g) || []).map(idx).filter((i) => i >= 0);
  return listed.length ? listed.includes(d) : true;
}

const lateGrace = () => config.engine.lateGraceMin;

/**
 * Compare each trainer check-in with the class schedule of its center + course
 * (+ batch), using the schedule in force on that day. Defaults to today.
 */
async function lateCheck(plan, { entities, query }) {
  const e = entities.trainer_attendance;
  if (!plan.filters?.date) {
    const now = new Date();
    const today = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
    plan.filters = { ...plan.filters, date: { from: today, to: today, label: "today" } };
  }
  const fetchCheckins = (p) => {
    let w = where(e, p);
    if (p.ident?.type === "name") w = addWhere(w, identClause("u.user_name", p.ident));
    return run(
      query,
      `SELECT ta.t_id, u.user_name AS trainer, ta.ta_date AS date, ta.checkin_time AS check_in, ta.checkout_time AS check_out, ta.center_id, ta.tb_id, t.t_course_id AS course_id FROM ${e.from}${w.sql} ORDER BY ta.ta_date DESC, ta.checkin_time LIMIT 500`,
      w.params,
      500
    );
  };
  let checkins = await fetchCheckins(plan);
  // Words read as a name that belong to no trainer ("asked tadays left") → everyone.
  let ignoredName = null;
  if (plan.ident?.type === "name" && !checkins.length && entities.trainer) {
    const c = identClause("u.user_name", plan.ident);
    const known = await run(query, `SELECT u.user_name AS name FROM ${entities.trainer.from} WHERE ${c.sql} LIMIT 1`, c.params, 1);
    if (!known.length) {
      ignoredName = plan.ident.display;
      plan.ident = null;
      checkins = await fetchCheckins(plan);
    }
  }
  const tIds = [...new Set(checkins.map((r) => r.t_id))];
  const single = plan.filters.date.from === plan.filters.date.to;

  // Courses each trainer teaches per center/batch, and the trainers expected that day.
  let alloc = [];
  if (entities.allocation) {
    const aw = [];
    const ap = [];
    if (plan.ident?.type === "name") {
      aw.push("u.user_name LIKE ?");
      ap.push(`%${String(plan.ident.value).split(/\s+/).join("%")}%`);
    } else if (single) {
      const batches = plan.filters.batch?.ids?.length ? plan.filters.batch.ids : [...new Set(checkins.map((r) => r.tb_id))];
      if (batches.length) {
        aw.push("tca.tb_id IN (?)");
        ap.push(batches);
      }
      if (plan.filters.center?.ids?.length) {
        aw.push("tca.center_id IN (?)");
        ap.push(plan.filters.center.ids);
      }
    } else if (tIds.length) {
      aw.push("tca.t_id IN (?)");
      ap.push(tIds);
    }
    if (aw.length)
      alloc = await run(
        query,
        `SELECT tca.t_id, u.user_name AS trainer, tca.center_id, tca.course_id, tca.tb_id FROM ${entities.allocation.from} WHERE ${aw.join(" AND ")} LIMIT 1000`,
        ap,
        1000
      );
  }
  const centerIds = [...new Set([...checkins, ...alloc].map((r) => r.center_id).filter((x) => x !== null && x !== undefined))];
  const schedules = centerIds.length
    ? await run(
        query,
        "SELECT cs.center_id, cs.course_id, cs.tb_id, cs.cs_start_date AS start_date, cs.cs_class_days AS days, cs.cs_start_time AS start_time, cs.cs_end_time AS end_time FROM class_schedules cs WHERE cs.center_id IN (?) LIMIT 1000",
        [centerIds],
        1000
      )
    : [];

  /** The schedule in force on `date` for this center + one of the courses (+ batch). */
  const scheduleFor = (center, courses, tb, date, checkin) => {
    let list = schedules.filter((s) => String(s.center_id) === String(center) && courses.some((c) => String(c) === String(s.course_id)));
    const sameBatch = list.filter((s) => String(s.tb_id) === String(tb));
    if (sameBatch.length) list = sameBatch;
    const started = list.filter((s) => !s.start_date || ymd(s.start_date) <= ymd(date));
    if (started.length) list = started;
    if (!list.length) return null;
    // Latest schedule first; among a trainer's courses, the class nearest the check-in.
    const latest = Math.max(...list.map((s) => (s.start_date ? Date.parse(ymd(s.start_date)) || 0 : 0)));
    list = list.filter((s) => (s.start_date ? Date.parse(ymd(s.start_date)) || 0 : 0) === latest);
    if (checkin !== null && list.length > 1) list.sort((a, b) => Math.abs(clockMinutes(a.start_time) - checkin) - Math.abs(clockMinutes(b.start_time) - checkin));
    return list[0];
  };
  const coursesOf = (t, center, tb, fallback) => {
    const mine = alloc.filter((a) => String(a.t_id) === String(t) && String(a.center_id) === String(center));
    const inBatch = mine.filter((a) => String(a.tb_id) === String(tb));
    const c = (inBatch.length ? inBatch : mine).map((a) => a.course_id);
    return c.length ? [...new Set(c)] : [fallback];
  };

  const rows = checkins.map((r) => {
    const inAt = clockMinutes(r.check_in);
    const s = scheduleFor(r.center_id, coursesOf(r.t_id, r.center_id, r.tb_id, r.course_id), r.tb_id, r.date, inAt);
    const start = s ? clockMinutes(s.start_time) : null;
    let status = "no_schedule";
    let minutes = null;
    if (s && start !== null && inAt !== null) {
      minutes = inAt - start;
      status = !isClassDay(s.days, r.date) ? "no_class_day" : minutes > lateGrace() ? "late" : "on_time";
    }
    // Checked out before the class ended (no check-out yet = still there, not early).
    const outAt = clockMinutes(r.check_out);
    const end = s ? clockMinutes(s.end_time) : null;
    const leftEarly = status !== "no_class_day" && outAt !== null && end !== null && outAt < end - lateGrace() ? end - outAt : null;
    return {
      trainer: r.trainer, date: ymd(r.date), check_in: hhmm(inAt), check_out: outAt === null ? null : hhmm(outAt),
      class_start: s?.start_time ?? null, class_end: s?.end_time ?? null, minutes_late: minutes, left_early: leftEarly,
      status, center_id: r.center_id, course_id: s?.course_id ?? r.course_id,
    };
  });

  // Expected that day (allocated, class day, schedule found) but no check-in.
  const missing = [];
  if (single && !plan.ident) {
    const seen = new Set(checkins.map((r) => `${r.t_id}|${r.center_id}`));
    const done = new Set();
    for (const a of alloc) {
      const k = `${a.t_id}|${a.center_id}`;
      if (seen.has(k) || done.has(k)) continue;
      const s = scheduleFor(a.center_id, [a.course_id], a.tb_id, plan.filters.date.from, null);
      if (!s || !isClassDay(s.days, plan.filters.date.from)) continue;
      done.add(k);
      missing.push({ trainer: a.trainer, center_id: a.center_id, course_id: a.course_id, class_start: s.start_time });
    }
  }
  return { rows, missing, ignoredName };
}

const LATE_LIST = 25;

function formatLate(plan, res, { dict }) {
  const place = (r) => [lookupName(dict, "center", r.center_id), lookupName(dict, "course", r.course_id)].filter(Boolean).join(" · ");
  const cls = (r) => (r.class_start ? prettyValue(r.class_start) : "—");
  const when = plan.filters?.date?.label || "today";
  const by = (s) => res.rows.filter((r) => r.status === s);
  const late = by("late").sort((a, b) => b.minutes_late - a.minutes_late);
  const onTime = by("on_time");
  const noSched = by("no_schedule");
  const offDay = by("no_class_day");
  const early = res.rows.filter((r) => r.left_early).sort((a, b) => b.left_early - a.left_early);
  const clsEnd = (r) => (r.class_end ? prettyValue(r.class_end) : "—");
  const leftNote = (r) => (r.left_early ? `\n    🏃 left *${r.left_early} min early* — out ${r.check_out}, class ends ${clsEnd(r)}` : "");

  if (plan.ident) {
    if (!res.rows.length) return `🔍 No check-in found for *${plan.ident.display}* ${when}.\n_Either they didn't check in, or the name is spelled differently — try_ _trainer attendance ${when}_.`;
    return res.rows
      .slice(0, 10)
      .map((r) => {
        const head = `*${r.trainer}*${res.rows.length > 1 || when !== "today" ? ` · ${prettyValue(r.date)}` : ""}`;
        if (r.status === "late") return `⏰ ${head} was *${r.minutes_late} min late* — checked in ${r.check_in}, class starts ${cls(r)}${leftNote(r)}\n    ${place(r)}`;
        if (r.status === "on_time")
          return `✅ ${head} was *on time* — checked in ${r.check_in}, class starts ${cls(r)}${r.minutes_late < 0 ? ` (${-r.minutes_late} min early)` : ""}${leftNote(r)}\n    ${place(r)}`;
        if (r.status === "no_class_day") return `📅 ${head} checked in ${r.check_in}, but the schedule has no class that day\n    ${place(r)}`;
        return `❔ ${head} checked in ${r.check_in} — no class schedule found for ${place(r) || "their center"}`;
      })
      .join("\n\n");
  }

  if (!res.rows.length && !res.missing.length) return `🕒 No trainer check-ins ${when}.${scopeText(plan)}`;
  const parts = [
    `🕒 *Trainer punctuality*${scopeText(plan)}\n_Check-in vs class start, check-out vs class end · ${lateGrace()} min grace_${
      res.ignoredName ? `\n_(no trainer named "${res.ignoredName}", so showing everyone)_` : ""
    }`,
  ];
  parts.push(
    late.length
      ? `⏰ *Late: ${late.length}*\n${late
          .slice(0, LATE_LIST)
          .map((r, i) => `*${i + 1}. ${r.trainer}* — *${r.minutes_late} min late*\n    in ${r.check_in} · class ${cls(r)} · ${place(r)}${when === "today" ? "" : ` · ${prettyValue(r.date)}`}`)
          .join("\n")}`
      : "⏰ *Late: 0* — nobody was late 🎉"
  );
  parts.push(
    early.length
      ? `🏃 *Left early: ${early.length}*\n${early
          .slice(0, LATE_LIST)
          .map((r, i) => `*${i + 1}. ${r.trainer}* — *${r.left_early} min early*\n    out ${r.check_out} · class ends ${clsEnd(r)} · ${place(r)}${when === "today" ? "" : ` · ${prettyValue(r.date)}`}`)
          .join("\n")}`
      : "🏃 *Left early: 0*"
  );
  if (onTime.length) parts.push(`✅ *On time: ${onTime.length}*\n${onTime.slice(0, LATE_LIST).map((r) => `• ${r.trainer} — ${r.check_in} (class ${cls(r)})`).join("\n")}`);
  if (res.missing.length) parts.push(`🚫 *Not checked in: ${res.missing.length}*\n${res.missing.slice(0, LATE_LIST).map((r) => `• ${r.trainer || "Unknown"} — ${place(r)} (class ${cls(r)})`).join("\n")}`);
  if (offDay.length) parts.push(`📅 *Checked in on a non-class day: ${offDay.length}*\n${offDay.slice(0, 10).map((r) => `• ${r.trainer} — ${r.check_in}`).join("\n")}`);
  if (noSched.length) parts.push(`❔ *No class schedule found: ${noSched.length}*\n${noSched.slice(0, 10).map((r) => `• ${r.trainer} — ${r.check_in} · ${place(r)}`).join("\n")}`);
  return parts.join("\n\n");
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

  if (plan.op === "late") return { ...(await lateCheck(plan, { entities, query })), meta };

  let w0 = where(e, plan, student);
  // A name/CNIC on a non-student record ("Shafi's leaves", "trainer Ali allocations")
  if (plan.ident && plan.op !== "details" && !e.student && e.idents?.[plan.ident.type]) w0 = addWhere(w0, identClause(e.idents[plan.ident.type], plan.ident));
  // "centers in quetta": a list limited to the matched records
  if (plan.lookupIds?.length && plan.op !== "details") w0 = addWhere(w0, { sql: `${e.key} IN (?)`, params: [plan.lookupIds] });
  const key = JSON.stringify({ o: plan.op, e: plan.entity, d: plan.dim, f: plan.filters, l: plan.limit, x: exportRows, s: student?.std_id, i: plan.ident?.value, k: plan.lookupIds });
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
        // "who is usama": say how many share the name so the user can narrow it down.
        if (rows.length >= 3 && plan.ident?.type === "name") {
          const cnt = await run(query, `SELECT COUNT(*) AS n FROM ${e.from}${w.sql}`, w.params, 1);
          return { rows: rows.slice(0, 3), total: Number(cnt[0]?.n || rows.length) };
        }
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
  return v === null || v === undefined || v === "" || v === "null" || v === "undefined" || v === "NULL";
}

/** "3337881264" / "923337881264" → "0333-7881264" */
function prettyPhone(v) {
  const d = String(v).replace(/\D/g, "");
  const m = d.match(/^(?:92|0)?(3\d{2})(\d{7})$/);
  return m ? `0${m[1]}-${m[2]}` : String(v);
}

const ICON = {
  student: "🎓", candidate: "📝", trainer: "👨‍🏫", master_trainer: "🧑‍💼", allocation: "🗂️", batch: "📅", center: "🏫", course: "📚",
  attendance: "✅", earning: "💰", ticket: "🎫", assignment: "📄", submission: "📥", result: "🏅", leave: "🌴", trainer_leave: "🌴",
  holiday: "🏖️", schedule: "🕘", center_dates: "📆", recording: "🎥", resource: "📎", lecture_report: "📝", trainer_attendance: "🕒",
  quiz_attempt: "❓", quiz: "❓", feedback: "💬", document: "📂", freelance_profile: "🌐", announcement: "📢", user: "👤",
  module: "📘", topic: "🔖", topic_report: "📊", login: "🔐", center_visit: "🚗", weekly_evaluation: "📈", online_class_report: "💻",
};

const FIELD_ICON = [
  [/^(cnic)$/i, "🪪"], [/phone|whatsapp|mobile/i, "📞"], [/email/i, "✉️"], [/^roll/i, "🔢"], [/father/i, "👨"],
  [/gender/i, "⚧"], [/qualification|degree|institute/i, "🎓"], [/district|city|location|domicile|address/i, "📍"],
  [/^batch$/i, "📅"], [/^course$/i, "📚"], [/^center$/i, "🏫"], [/status/i, "🔘"], [/date|on$|^added|^applied|starts|ends|time|created/i, "🗓️"],
  [/marks|score|amount/i, "🔢"],
];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-10-14 00:00:00" → "14 Oct 2026"; "2026-10-22 11:53:48" → "22 Oct 2026, 11:53"; "11:53:48" → "11:53". */
export function prettyValue(v) {
  if (isEmpty(v)) return v;
  const s = String(v);
  const dt = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::\d{2})?(?:\.\d+)?Z?)?$/);
  if (dt) {
    const d = `${Number(dt[3])} ${MONTHS[Number(dt[2]) - 1]} ${dt[1]}`;
    return dt[4] && !(dt[4] === "00" && dt[5] === "00") ? `${d}, ${dt[4]}:${dt[5]}` : d;
  }
  const tm = s.match(/^(\d{2}):(\d{2}):\d{2}$/);
  if (tm) return `${tm[1]}:${tm[2]}`;
  return s.length > 90 ? `${s.slice(0, 90)}…` : s;
}

function bar(n, max, width = 10) {
  const filled = max ? Math.max(Number(n) > 0 ? 1 : 0, Math.round((Number(n) / max) * width)) : 0;
  return "▰".repeat(filled) + "▱".repeat(width - filled);
}

function scopeText(plan) {
  const s = filterSummary(plan);
  const ex = Object.values(plan.exclude || {}).map((x) => `excluding ${x.label}`);
  const all = [s, ...ex].filter(Boolean).join(" · ");
  return all ? `\n_${all}_` : "";
}

/** Reply text for an executed plan (WhatsApp formatting). */
export function formatReply(plan, res, { entities, dict }) {
  const e = entities[plan.entity];
  const icon = ICON[plan.entity] || "📋";
  const scopeLine = scopeText(plan);
  const who = res.meta?.student ? ` — *${res.meta.student.name || res.meta.student.std_rollno}*` : "";

  if (res.meta?.studentNotFound)
    return `🔍 I couldn't find a student with ${plan.ident.type === "name" ? "the name" : plan.ident.type.toUpperCase()} *${plan.ident.display}*.\nPlease check it and send again.`;

  switch (plan.op) {
    case "count": {
      const noun = plan.entity === "attendance" ? "students" : res.n === 1 ? e.singular : e.plural;
      const label = plan.entity === "attendance" && plan.filters?.status?.label ? ` ${plan.filters.status.label}` : "";
      const hint = res.n > 0 && res.n <= 200 && ["student", "trainer", "center", "course", "batch", "candidate"].includes(plan.entity) ? `\n\n_Reply *list* to see them._` : "";
      return `${icon} *${fmtNum(res.n)}* ${noun}${label}${who}${scopeLine}${hint}`;
    }
    case "count_by": {
      if (!res.rows.length) return `${icon} No ${e.plural} found${who}.${scopeLine}`;
      const total = res.rows.reduce((s, r) => s + Number(r.n || 0), 0);
      const max = Math.max(...res.rows.map((r) => Number(r.n) || 0));
      const lines = res.rows.slice(0, 30).map((r) => {
        const h = humanizeRow(r, { dict, entity: e, dim: plan.dim });
        const pct = total ? Math.round((Number(r.n) / total) * 100) : 0;
        return `*${isEmpty(h.k) ? "Not set" : prettyValue(h.k)}*\n${bar(r.n, max)} ${fmtNum(r.n)} (${pct}%)`;
      });
      const more = res.rows.length > 30 ? `\n…and ${res.rows.length - 30} more` : "";
      return `${icon} *${cap(e.plural)} by ${plan.dim}*${who}${scopeLine}\n\n${lines.join("\n")}${more}\n\n*Total: ${fmtNum(total)}*`;
    }
    case "sum": {
      const r = res.rows[0] || {};
      const approved = plan.filters?.status?.label ? ` (${plan.filters.status.label})` : "";
      return `💰 *Total ${e.sumLabel || "amount"}${approved}*${who}\n*${fmtNum(r.total || 0)}* from ${fmtNum(r.n || 0)} ${Number(r.n) === 1 ? "entry" : "entries"}${scopeLine}`;
    }
    case "avg": {
      const r = res.rows[0] || {};
      if (!Number(r.n)) return `📊 No ${res.label} recorded yet${who}.${scopeLine}`;
      return `📊 *Average ${res.label}*${who}: *${fmtNum(r.avg)}*\n⬇️ Lowest ${fmtNum(r.min)} · ⬆️ Highest ${fmtNum(r.max)} · ${fmtNum(r.n)} records${scopeLine}`;
    }
    case "top": {
      if (!res.rows.length) return `🏆 No ${e.plural} found.${scopeLine}`;
      const medal = ["🥇", "🥈", "🥉"];
      const lines = res.rows.map((r, i) => `${medal[i] || `*${i + 1}.*`} ${r.name || "Unknown"} — *${fmtNum(r.v)}*`);
      return `🏆 *Top ${res.rows.length}* by ${plan.entity === "earning" ? "earnings" : "score"}${scopeLine}\n\n${lines.join("\n")}`;
    }
    case "current": {
      const r = res.rows[0];
      if (!r) return "📅 No batches found.";
      return `📅 *Current batch: ${r.batch}*${r.starts ? `\n🟢 Starts: ${prettyValue(r.starts)}` : ""}${r.ends ? `\n🔴 Ends: ${prettyValue(r.ends)}` : ""}${r.description ? `\n_${prettyValue(r.description)}_` : ""}`;
    }
    case "details": {
      if (!res.rows.length) {
        const what = plan.ident ? `${plan.ident.type === "name" ? "name" : plan.ident.type.toUpperCase()} *${plan.ident.display}*` : "that";
        return `🔍 No ${e.singular} found with ${what}.\nPlease check it and try again.`;
      }
      const intro = res.fuzzy ? `🔍 No exact match for *${plan.ident.display}*. Closest ${res.rows.length > 1 ? "matches" : "match"}:\n\n` : "";
      const many =
        res.total > res.rows.length
          ? `\n\n🔎 *${fmtNum(res.total)}* ${e.plural} match *${plan.ident.display}* — showing ${res.rows.length}. Send a full name, CNIC or roll number to pick one${["student", "candidate", "trainer"].includes(plan.entity) ? `, or _list ${e.plural} named ${plan.ident.value}_` : ""}.`
          : "";
      return (
        intro +
        res.rows
          .map((row) => {
            const h = humanizeRow(row, { dict, entity: e });
            const title = h.Name || h.name || h.Center || h.Batch || h.Course || cap(e.singular);
            const lines = Object.entries(h)
              .filter(([k, v]) => !isEmpty(v) && !["Name", "name"].includes(k) && String(v) !== String(title))
              .map(([k, v]) => `${FIELD_ICON.find(([re]) => re.test(k))?.[1] || "▫️"} *${k}:* ${/phone|whatsapp|mobile/i.test(k) ? prettyPhone(v) : prettyValue(v)}`);
            return `${icon} *${title}*\n━━━━━━━━━━━━\n${lines.join("\n")}`;
          })
          .join("\n\n") +
        many
      );
    }
    case "late":
      return formatLate(plan, res, { dict });
    case "list":
    default: {
      if (!res.rows.length) return `${icon} No ${e.plural} found${who}.${scopeLine}`;
      const lines = res.rows.slice(0, CHAT_LIST_ROWS).map((row, i) => {
        const h = humanizeRow(row, { dict, entity: e });
        const vals = Object.values(h)
          .filter((v) => !isEmpty(v))
          .map((v) => prettyValue(v));
        const [first, ...rest] = vals;
        return `*${i + 1}. ${first}*${rest.length ? `\n    ${rest.join(" · ")}` : ""}`;
      });
      const shown = Math.min(res.rows.length, CHAT_LIST_ROWS);
      const count = res.total > shown ? `showing ${shown} of ${fmtNum(res.total)}` : fmtNum(res.total);
      const more = res.total > shown && config.engine.autoExcel ? `\n\n📎 _Full list attached as Excel._` : "";
      return `${icon} *${cap(e.plural)}*${who} (${count})${scopeLine}\n\n${lines.join("\n")}${more}`;
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
