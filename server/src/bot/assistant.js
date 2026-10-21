import { config } from "../config.js";
import { log } from "../logger.js";
import { chat, streamChat, llmQueue } from "../llm/client.js";
import { getSchema, describeTables, listTableNames, resolveTables } from "../db/schema.js";
import { runQuery } from "../db/pool.js";
import { guardSql, extractSql, expandStars } from "../db/sqlGuard.js";
import { getCatalog, rankCatalog, formatRanked, lookupNameHits } from "../db/catalog.js";
import { getHistory, appendHistory, getLastLookup, setLastLookup } from "../store/history.js";
import { looksLikeDataQuestion, smallTalkReply, identifierHints } from "./intent.js";
import { parseJson, chooseTables, formatRows, transcript, lastLookupText, resolveIdColumns } from "./context.js";
import * as P from "./prompts.js";

// Swappable for tests.
let deps = { chat, streamChat, getSchema, getCatalog, runQuery, lookupNameHits };
export function __setDeps(d) {
  deps = { ...deps, ...d };
  staticCache = null;
}

const FALLBACK_REPLY = "Sorry, I didn't quite get that. Could you say it another way, e.g. *how many students are in batch 10*?";
// Whole schema goes into the cached system prompt when it fits (~4k tokens).
const STATIC_FULL_CHARS = 14000;
const STATIC_OVERVIEW_CHARS = 9000;

let staticCache = null; // { key, system, full }

/** The shared system prompt for this schema (identical across calls → cached by Ollama). */
export function staticSystem(schema) {
  const key = schema.loadedAt;
  if (staticCache?.key === key) return staticCache;
  const fullText = describeTables(schema);
  const full = fullText.length <= STATIC_FULL_CHARS;
  const schemaText = full ? fullText : listTableNames(schema, STATIC_OVERVIEW_CHARS);
  staticCache = { key, full, system: P.systemPrompt({ schemaText, full }) };
  log.info(`System prompt: ${staticCache.system.length} chars (${full ? "full schema" : "table overview"})`);
  return staticCache;
}

/** Load the system prompt into Ollama's cache so the first question is fast. */
export async function primeCache() {
  try {
    const schema = await deps.getSchema();
    if (!schema.tables.size) return;
    const started = Date.now();
    await deps.chat(
      [
        { role: "system", content: staticSystem(schema).system },
        { role: "user", content: "TASK: ping. Reply OK." },
      ],
      { maxTokens: 2, temperature: 0 }
    );
    log.info(`Prompt cache primed in ${Date.now() - started}ms`);
  } catch (err) {
    log.warn("Prompt cache priming failed:", err.message);
  }
}

function mergeRanked(...lists) {
  const seen = new Set();
  const out = [];
  for (const h of lists.flat().sort((a, b) => b.score - a.score)) {
    const k = `${h.table}.${h.column}:${h.value.toLowerCase()}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(h);
  }
  return out.slice(0, 10);
}

function tablesInSql(schema, sql) {
  const names = [...String(sql || "").matchAll(/\b(?:from|join)\s+`?([a-zA-Z0-9_]+)`?/gi)].map((m) => m[1]);
  return resolveTables(schema, names);
}

async function runSql(candidate, schema) {
  const raw = extractSql(candidate);
  const g = guardSql(expandStars(raw, schema.tables));
  if (!g.ok) return { error: g.error, sql: raw };
  try {
    const res = await deps.runQuery(g.sql);
    return { sql: g.sql, rows: res.rows };
  } catch (err) {
    return { error: err.sqlMessage || err.code || "query failed", sql: g.sql };
  }
}

function scalar(rows) {
  if (rows?.length !== 1) return undefined;
  const vals = Object.values(rows[0]);
  return vals.length === 1 ? vals[0] : undefined;
}

const isZero = (v) => v === null || v === 0 || v === "0" || v === "0.00";

function fmtValue(v) {
  const s = String(v ?? "");
  // Thousands separators for amounts/counts only; keep phone, CNIC and ids as stored.
  if (/^-?[1-9]\d{0,8}(\.\d+)?$/.test(s)) return Number(s).toLocaleString("en-US", { maximumFractionDigits: 2 });
  return s;
}

async function streamText(messages, { signal, onToken, maxTokens, temperature }) {
  let out = "";
  for await (const tok of deps.streamChat(messages, { signal, queued: false, maxTokens, temperature })) {
    out += tok;
    onToken?.(tok);
  }
  return out.trim();
}

/**
 * Answer one user message.
 * p: { text, historyKey, language, signal, release, onToken, onStatus, onProgress, maxTokens }
 * onProgress gets short user-facing notes (what was understood, retries); never SQL or schema.
 */
export async function runAssistant(p) {
  const started = Date.now();
  const timing = [];
  const mark = (label, t0) => timing.push(`${label} ${Date.now() - t0}ms`);
  const text = String(p.text || "").trim().slice(0, config.llm.maxUserChars);
  const key = p.historyKey;
  const status = (s) => p.onStatus?.(s);
  const maxTokens = p.maxTokens ?? config.llm.botMaxTokens;
  const finish = (result) => {
    if (!result.reply) result.reply = FALLBACK_REPLY;
    appendHistory(key, "user", text);
    appendHistory(key, "assistant", result.reply);
    const ms = Date.now() - started;
    if (timing.length) log.info(`Answered in ${ms}ms [${result.action}] (${timing.join(", ")})`);
    return { ...result, ms };
  };

  // Greetings and thanks: instant, no model call.
  const canned = smallTalkReply(text);
  if (canned) {
    p.release?.();
    p.onToken?.(canned);
    return finish({ action: "reply", reply: canned });
  }

  const release = p.release ?? (await llmQueue.acquire(p.signal));
  try {
    const history = getHistory(key);
    const schema = await deps.getSchema();

    if (!schema.tables.size) {
      status("answering");
      const t0 = Date.now();
      const reply = await streamText(
        [{ role: "system", content: P.chatPrompt({ dbDown: true }) }, ...history.slice(-6), { role: "user", content: text }],
        { signal: p.signal, onToken: p.onToken, maxTokens: 250 }
      );
      mark("chat", t0);
      return finish({ action: "reply", reply });
    }

    const { system, full } = staticSystem(schema);
    const sys = { role: "system", content: system };
    const catalog = await deps.getCatalog(schema);
    const last = getLastLookup(key);
    const ranked = rankCatalog(catalog, text, { limit: 8, minScore: 60 });
    const idHints = identifierHints(text);
    const likely = full ? [] : chooseTables(schema, { question: text, text, ranked, budget: 3500 });

    // ---- 1 call: understand + SQL ----
    status("thinking");
    let t0 = Date.now();
    const planRaw = await deps.chat(
      [
        sys,
        {
          role: "user",
          content: P.planTask({
            today: P.today(),
            transcript: transcript(history.slice(-8), 1500),
            lastLookup: lastLookupText(last),
            tableDetails: likely.length ? describeTables(schema, likely) : "",
            ranked: formatRanked(ranked),
            idHints,
            text,
          }),
        },
      ],
      { signal: p.signal, queued: false, json: true, maxTokens: 500, temperature: 0 }
    );
    mark("plan", t0);
    const plan = parseJson(planRaw) || {};
    let type = ["data", "chat", "clarify"].includes(plan.type) ? plan.type : looksLikeDataQuestion(text) ? "data" : "chat";
    if (type !== "data" && (idHints.length || /\d{5,}/.test(text))) type = "data"; // bare CNIC / phone
    const question = typeof plan.question === "string" && plan.question.trim().length > 3 ? plan.question.trim() : text;
    const reply0 = typeof plan.reply === "string" ? plan.reply.trim() : "";
    log.debug(`plan: ${type} | ${question}`);

    if (type !== "data") {
      if (reply0) {
        p.onToken?.(reply0);
        return finish({ action: type === "clarify" ? "clarify" : "reply", reply: reply0 });
      }
      status("answering");
      t0 = Date.now();
      const reply = await streamText(
        [sys, { role: "user", content: `TASK: chat\n\nConversation so far:\n${transcript(history.slice(-6), 1000)}\n\nNew message: ${text}\n\nReply briefly in plain text.` }],
        { signal: p.signal, onToken: p.onToken, maxTokens: 200 }
      );
      mark("chat", t0);
      return finish({ action: "reply", reply });
    }

    p.onProgress?.(`🔎 _${question.replace(/[_*]/g, "")}_\nChecking the records…`);

    // ---- run, repair errors, broaden empty results ----
    let candidate = typeof plan.sql === "string" && plan.sql.trim() ? plan.sql : "";
    let good = null;
    let empty = null;
    let closeNames = [];
    let lastError = candidate ? null : "no query was written";
    const steps = Math.max(2, config.llm.maxAgentSteps);
    for (let step = 0; step < steps; step++) {
      let problem;
      let r = null;
      if (candidate) {
        status("querying");
        t0 = Date.now();
        r = await runSql(candidate, schema);
        mark("sql", t0);
      }
      if (!r || r.error) {
        lastError = r?.error || lastError;
        if (r) log.warn(`SQL rejected/failed (step ${step + 1}): ${r.error}\n${r.sql}`);
        if (step === 0) p.onProgress?.("🛠️ Adjusting the search…");
        problem = `the query failed: ${lastError}`;
      } else if (r.rows.length && !(isZero(scalar(r.rows)) && !empty)) {
        good = r;
        break;
      } else {
        if (empty) {
          good = r.rows.length ? r : null;
          break;
        }
        empty = r;
        p.onProgress?.("🔁 No exact match yet, trying a broader search…");
        closeNames = await deps.lookupNameHits(schema, `${question} ${text}`, tablesInSql(schema, r.sql)).catch(() => []);
        problem = r.rows.length ? "it returned 0 / nothing" : "it returned 0 rows";
      }
      if (step === steps - 1) break;
      const used = [...new Set([...tablesInSql(schema, r?.sql || candidate), ...likely])].slice(0, 6);
      t0 = Date.now();
      const fixRaw = await deps.chat(
        [
          sys,
          {
            role: "user",
            content: P.fixTask({
              question,
              sql: (r?.sql || candidate || "(none)").replace(/\s+/g, " "),
              problem,
              tableDetails: used.length ? describeTables(schema, used) : "",
              closeNames: formatRanked(closeNames.slice(0, 10)),
            }),
          },
        ],
        { signal: p.signal, queued: false, json: true, maxTokens: 400, temperature: 0.1 }
      );
      mark("fix", t0);
      const fixed = parseJson(fixRaw);
      candidate = typeof fixed?.sql === "string" ? fixed.sql : extractSql(fixRaw);
    }
    const result = good || empty;

    status("answering");
    if (!result) {
      log.warn(`No working query for "${question}" (${lastError})`);
      const names = mergeRanked(ranked, closeNames).slice(0, 8).map((h) => h.value).join(" | ");
      t0 = Date.now();
      const reply = await streamText([sys, { role: "user", content: P.clarifyTask({ text, question, names }) }], {
        signal: p.signal,
        onToken: p.onToken,
        maxTokens: 200,
      });
      mark("clarify", t0);
      return finish({ action: "clarify", reply });
    }

    // Show names instead of ids (course_id 3 → course "Web Development").
    if (result.rows.length) {
      t0 = Date.now();
      const used = tablesInSql(schema, result.sql);
      result.rows = await resolveIdColumns(schema, result.rows, deps.runQuery, { selfTable: used.length === 1 ? used[0] : undefined });
      mark("names", t0);
    }

    setLastLookup(key, {
      question,
      sql: result.sql,
      rowCount: result.rows.length,
      sample: result.rows.length ? formatRows(result.rows.slice(0, 3), 700) : "",
    });

    // Single value (a count, a date, a name): fill the template, no extra model call.
    const v = scalar(result.rows);
    const template = typeof plan.template === "string" ? plan.template.trim() : "";
    if (v !== undefined && v !== null && template.includes("{value}") && template.length < 300) {
      const reply = template.replace(/\*?\{value\}\*?/g, `*${fmtValue(v)}*`);
      p.onToken?.(reply);
      return finish({ action: "sql", reply, sql: result.sql, rowCount: 1 });
    }

    t0 = Date.now();
    const reply = await streamText(
      [
        sys,
        {
          role: "user",
          content: P.answerTask({
            text,
            question,
            rowsText: result.rows.length ? formatRows(result.rows) : "",
            rowCount: result.rows.length,
            capped: result.rows.length >= config.db.maxRows,
            closeNames: !result.rows.length ? closeNames.slice(0, 8).map((h) => h.value).join(" | ") : "",
          }),
        },
      ],
      { signal: p.signal, onToken: p.onToken, maxTokens, temperature: 0.2 }
    );
    mark("answer", t0);
    return finish({ action: "sql", reply, sql: result.sql, rowCount: result.rows.length });
  } finally {
    release();
  }
}
