import { config } from "../config.js";
import { log } from "../logger.js";
import { guardSql } from "../db/sqlGuard.js";
import { describeTables } from "../db/schema.js";
import { fold } from "../db/catalog.js";
import { localNow, lookupName } from "./dictionary.js";
import { prettyValue, prettyLabel } from "./executor.js";
import { excelFile } from "./files.js";

// "Ask the LLM" mode. When a user names the LLM, the model decides how to answer:
//  - "plan":  one of the built-in, tested queries (the engine runs it),
//  - "sql":   a new read-only SELECT it writes itself (guarded, row-capped, retried once),
//  - "reply": a plain answer (no data needed / not answerable).
// The database user is read-only and every statement goes through guardSql.

const AGENT_ROWS = 200;
const CHAT_ROWS = 25;
const SCHEMA_BUDGET = 9000;

/** Words that mean "use the LLM for this". */
export const AGENT_RE = /\b(llm|gpt|chat ?gpt|ask (?:the )?ai|use (?:the )?ai|ai (?:se|sy|ko|say) (?:pucho|poocho|batao|check)|ai (?:sy|se))\b/i;

/** The question without the "ask llm" part. */
export function stripAgentWords(text) {
  return String(text || "")
    .replace(/^[/!](llm|ai|gpt)\b/i, " ")
    .replace(/\b(please |pls |plz )?(ask|use|try|with|via|using) (the )?(llm|ai|gpt|chat ?gpt)\b/gi, " ")
    .replace(/\b(llm|gpt|chat ?gpt)\b/gi, " ")
    .replace(/\b(ai (?:se|sy|ko|say)) (pucho|poocho|batao|check)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Date placeholders the model writes instead of literal dates, so a saved query stays right on later days. */
export function datePlaceholders(now = localNow()) {
  const day = (off) => {
    const d = new Date(now);
    d.setDate(d.getDate() + off);
    return ymd(d);
  };
  const dow = (now.getDay() + 6) % 7;
  return {
    today: day(0),
    yesterday: day(-1),
    tomorrow: day(1),
    week_start: day(-dow),
    month_start: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`,
    last_month_start: ymd(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
    year_start: `${now.getFullYear()}-01-01`,
    now_time: `${pad(now.getHours())}:${pad(now.getMinutes())}:00`,
  };
}

function fillPlaceholders(sql) {
  const p = datePlaceholders();
  return sql.replace(/\{(today|yesterday|tomorrow|week_start|month_start|last_month_start|year_start|now_time)\}/g, (_m, k) => `'${p[k]}'`);
}

/** Schema for the prompt: the tables the built-in catalogue uses first, then any the question names. */
function schemaText(schema, entities, question) {
  const core = new Set();
  for (const e of Object.values(entities)) for (const t of Object.keys(e.uses || {})) core.add(t);
  const words = fold(question).split(" ").filter((w) => w.length >= 4);
  const named = [...schema.tables.keys()].filter((t) => !core.has(t) && words.some((w) => t.includes(w) || w.includes(t.replace(/s$/, ""))));
  const order = [...core, ...named].filter((t) => schema.tables.has(t));
  let text = "";
  for (const t of order) {
    const line = describeTables(schema, [t]);
    if (text.length + line.length > SCHEMA_BUDGET) break;
    text += `${line}\n`;
  }
  return text.trim();
}

function catalog(entities) {
  return Object.entries(entities)
    .map(([n, e]) => {
      const ops = ["count", "list", e.details?.length ? "details" : null, e.dims?.length ? "count_by" : null, e.sum ? "sum" : null, e.avg && Object.keys(e.avg).length ? "avg" : null, e.top ? "top" : null, n === "batch" ? "current" : null, e.late ? "late" : null].filter(Boolean);
      return `${n}: ${ops.join("/")}; dims=${(e.dims || []).join("/") || "-"}; filters=${[...Object.keys(e.filters || {}), e.date ? "date" : null].filter(Boolean).join("/")}`;
    })
    .join("\n");
}

function agentPrompt({ schema, entities, dict, question, transcript, lastText, error, previousSql }) {
  const ph = datePlaceholders();
  const centers = dict.centers.map((c) => `${c.id}=${c.name}`).join(", ");
  const courses = dict.courses.map((c) => `${c.id}=${c.name}`).join(", ");
  const batches = dict.batches.slice(-4).map((b) => `${b.id}=${b.name}`).join(", ");
  return [
    {
      role: "system",
      content: [
        "You answer WhatsApp questions about the DigiBizz LMS (MySQL). The user explicitly asked for you (the LLM), so think it through and pick the best way to answer.",
        "Choose ONE action:",
        '- "plan": a built-in query fits exactly. Fields: op, entity, dim, filters (plain words, e.g. {"batch":"10","center":"quetta","date":"today"}), ident {"type":"cnic|rollno|phone|name","value":""}.',
        config.engine.allowLlmSql ? "" : '(Writing SQL is turned off: use "plan" or "reply" only.)',
        '- "sql": nothing built-in fits (comparisons, joins, custom calculations, "who was late or left early", rankings across tables …). Write ONE MySQL SELECT.',
        '- "reply": no data is needed, or the data does not exist in this database (say so honestly).',
        `Built-in queries:\n${catalog(entities)}`,
        "SQL rules: a single SELECT (WITH allowed); only tables/columns from the schema below; never SELECT *; readable column aliases (trainer, center, minutes_late …); join `user` u ON u.user_id = <table>.user_id for names; ORDER BY something useful; LIMIT 200 at most.",
        `Dates: write the placeholders {today} {yesterday} {week_start} {month_start} {last_month_start} {year_start} {now_time} instead of literal dates (today is ${ph.today}, Pakistan time ${ph.now_time.slice(0, 5)}). Example: WHERE ta.ta_date = {today}.`,
        "Codes: students.std_lms_status 1=active 2=removed; earnings.earning_status 1=approved (amounts are reported for approved only); candidates.cand_admission_status 1=admitted.",
        "Punctuality: trainer_attendance.checkin_time / checkout_time vs class_schedules.cs_start_time / cs_end_time for the same center_id + course (trainers.t_course_id or trainers_center_allocation.course_id) and tb_id; cs_start_time may be text like '03:00 PM' → STR_TO_DATE(cs.cs_start_time, '%h:%i %p').",
        `Lookups: centers ${centers}. Courses ${courses}. Recent batches ${batches}.`,
        `Schema (table(columns), *=primary key):\n${schemaText(schema, entities, question)}`,
        'Output JSON only: {"action":"plan|sql|reply","op":"","entity":"","dim":null,"filters":{},"ident":null,"sql":"","explain":"one short line: how the answer is computed","title":"short title","reply":""}',
      ].join("\n"),
    },
    {
      role: "user",
      content: `${transcript ? `Recent chat:\n${transcript}\n\n` : ""}${lastText ? `Previous question: ${lastText}\n` : ""}${
        error ? `Your previous SQL failed.\nSQL: ${previousSql}\nError: ${error}\nFix it.\n` : ""
      }Question: ${question}`,
    },
  ];
}

function parseJson(s) {
  const a = String(s || "").indexOf("{");
  const b = String(s || "").lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try {
    return JSON.parse(String(s).slice(a, b + 1));
  } catch {
    return null;
  }
}

/** Ask the model how to answer. Returns its decision (action plan/sql/reply) or null. */
export async function agentDecide(ctx, extra = {}) {
  try {
    const raw = await ctx.llm(agentPrompt({ ...ctx, ...extra }), { json: true, maxTokens: 900, temperature: 0 });
    const j = parseJson(raw);
    if (!j || !["plan", "sql", "reply"].includes(j.action)) return j?.reply ? { action: "reply", reply: String(j.reply) } : null;
    return j;
  } catch (err) {
    log.warn("Agent LLM call failed:", err.message);
    return null;
  }
}

/** Run model-written SQL through the guard. Throws with a readable message on failure. */
export async function runAgentSql(sql, query) {
  if (!config.engine.allowLlmSql) throw Object.assign(new Error("AI-written queries are turned off (ALLOW_LLM_SQL=false)"), { code: "sql_disabled" });
  const filled = fillPlaceholders(String(sql || ""));
  const g = guardSql(filled, { maxRows: AGENT_ROWS });
  if (!g.ok) throw Object.assign(new Error(`blocked: ${g.error}`), { code: "sql_blocked" });
  return (await query(g.sql, [])).rows;
}

const ID_COLS = { tb_id: "batch", center_id: "center", course_id: "course", t_course_id: "course", cv_center_id: "center", ocr_center_id: "center" };

function humanize(row, dict) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    const kind = ID_COLS[k];
    const name = kind ? lookupName(dict, kind, v) : undefined;
    out[kind ? cap(kind) : prettyLabel(k)] = name ?? (v instanceof Date ? v.toISOString().slice(0, 19).replace("T", " ") : v);
  }
  return out;
}

const cap = (s) => s[0].toUpperCase() + s.slice(1);
const empty = (v) => v === null || v === undefined || v === "" || v === "undefined";
const num = (v) => (typeof v === "number" || (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v)) ? Number(v).toLocaleString("en-US", { maximumFractionDigits: 2 }) : null);

/** WhatsApp text (and an Excel file for long results) for SQL rows. */
export async function formatAgentRows(rows, { dict, title, explain }) {
  const head = `🧠 *${title || "Result"}*${explain ? `\n_${explain}_` : ""}`;
  if (!rows.length) return { reply: `${head}\n\nNo matching records.`, files: [] };
  const h = rows.map((r) => humanize(r, dict));
  const cols = Object.keys(h[0]);
  // A single value ("total = 1,250,000"): say it plainly.
  if (h.length === 1 && cols.length <= 2) {
    const parts = cols.map((c) => `${c}: *${num(h[0][c]) ?? prettyValue(h[0][c])}*`);
    return { reply: `${head}\n\n${parts.join("\n")}`, files: [] };
  }
  const lines = h.slice(0, CHAT_ROWS).map((r, i) => {
    const vals = cols.filter((c) => !empty(r[c])).map((c) => (i === 0 || cols.length > 3 ? `${c}: ${num(r[c]) ?? prettyValue(r[c])}` : num(r[c]) ?? prettyValue(r[c])));
    const [first, ...rest] = vals;
    return `*${i + 1}. ${String(first).replace(/^[^:]+: /, "")}*${rest.length ? `\n    ${rest.join(" · ")}` : ""}`;
  });
  const more = h.length > CHAT_ROWS ? `\n\n…${h.length - CHAT_ROWS} more — 📎 full list attached as Excel.` : "";
  const files = [];
  if (h.length > CHAT_ROWS) {
    try {
      files.push(await excelFile(title || "Result", h));
    } catch (err) {
      log.warn("Agent Excel failed:", err.message);
    }
  }
  return { reply: `${head} (${h.length}${h.length >= AGENT_ROWS ? "+" : ""})\n\n${lines.join("\n")}${more}`, files };
}

export { AGENT_ROWS };
