import { config } from "../config.js";
import { log } from "../logger.js";
import { chat, streamChat, llmQueue } from "../llm/client.js";
import { getSchema, describeTables, listTableNames, schemaMode, resolveTables } from "../db/schema.js";
import { runQuery } from "../db/pool.js";
import { guardSql, extractSql } from "../db/sqlGuard.js";
import { getHistory, appendHistory } from "../store/history.js";
import * as P from "./prompts.js";

const PLAN_TOKENS = 700;
const RESULT_CHARS = 3500;

/** History trimmed to a char budget so the 4096-token context is not blown. */
function historyFor(key, maxChars) {
  const out = [];
  let used = 0;
  for (const m of [...getHistory(key)].reverse()) {
    used += m.content.length;
    if (used > maxChars) break;
    out.unshift(m);
  }
  return out;
}

const ACTION_RE = /^\s*ACTION:\s*([a-z]+)[^\S\n]*(?:\n|$)/i;

function couldBeActionPrefix(s) {
  const t = s.trimStart().toUpperCase();
  return "ACTION:".startsWith(t.slice(0, 7)) || t.startsWith("ACTION:");
}

/**
 * Read a planner token stream. When the model chooses "reply", its text is
 * forwarded to onToken as it arrives. Returns { action, body, streamed }.
 */
export async function consumePlan(tokens, onToken) {
  let buf = "";
  let action = null;
  let sent = 0;
  for await (const tok of tokens) {
    buf += tok;
    if (action === null) {
      const m = buf.match(ACTION_RE);
      if (m && buf.includes("\n")) {
        action = m[1].toLowerCase();
        sent = m[0].length;
      } else if (buf.trim().length >= 8 && !couldBeActionPrefix(buf)) {
        action = "reply"; // model ignored the format: treat it all as the reply
      }
    }
    if (action === "reply" && onToken && buf.length > sent) {
      onToken(buf.slice(sent));
      sent = buf.length;
    }
  }
  if (action === null) {
    const m = buf.match(/^\s*ACTION:\s*([a-z]+)\s*([\s\S]*)$/i);
    action = m ? m[1].toLowerCase() : "reply";
    sent = m ? buf.length - m[2].length : 0;
    if (action === "reply" && onToken) onToken(buf.slice(sent));
  }
  const body = action === "reply" && !ACTION_RE.test(buf) ? buf : buf.replace(ACTION_RE, "");
  return { action, body: body.trim(), streamed: Boolean(onToken && action === "reply") };
}

function plan(messages, { signal, onToken }) {
  const tokens = streamChat(messages, { signal, queued: false, maxTokens: PLAN_TOKENS, temperature: 0.2 });
  return consumePlan(tokens, onToken);
}

function cell(v) {
  if (v === null || v === undefined) return null;
  if (Buffer.isBuffer(v)) return "[binary]";
  if (v instanceof Date) return v.toISOString();
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  return s.length > 150 ? `${s.slice(0, 150)}…` : s;
}

function formatRows(rows) {
  const lines = [];
  let used = 0;
  for (const r of rows) {
    const obj = {};
    for (const [k, v] of Object.entries(r)) obj[k] = cell(v);
    const line = JSON.stringify(obj);
    if (used + line.length > RESULT_CHARS) {
      lines.push(`… (${rows.length - lines.length} more rows not shown)`);
      break;
    }
    lines.push(line);
    used += line.length;
  }
  return lines.join("\n");
}

/** Validate and run SQL; on failure ask the model to fix it once. */
async function executeWithRetry(sqlText, messages, signal) {
  let candidate = extractSql(sqlText);
  for (let attempt = 0; attempt < 2; attempt++) {
    const g = guardSql(candidate);
    let error = g.error;
    if (g.ok) {
      try {
        const res = await runQuery(g.sql);
        return { sql: g.sql, ...res };
      } catch (err) {
        error = err.sqlMessage || err.code || "query failed";
        log.warn(`SQL failed (attempt ${attempt + 1}): ${error}\n${g.sql}`);
      }
    } else {
      log.warn(`SQL rejected (attempt ${attempt + 1}): ${error}\n${candidate}`);
    }
    if (attempt === 1) {
      const e = new Error(`SQL failed: ${error}`);
      e.code = "sql_failed";
      throw e;
    }
    const fixed = await chat(
      [
        ...messages,
        { role: "assistant", content: `ACTION: sql\n${candidate}` },
        { role: "user", content: `That query failed: ${error}. Write a corrected query. Output only:\nACTION: sql\n<query>` },
      ],
      { signal, queued: false, maxTokens: PLAN_TOKENS, temperature: 0.1 }
    );
    candidate = extractSql(fixed.replace(ACTION_RE, ""));
  }
}

async function streamAnswer(messages, { signal, onToken, maxTokens }) {
  let out = "";
  for await (const tok of streamChat(messages, { signal, queued: false, maxTokens })) {
    out += tok;
    onToken?.(tok);
  }
  return out.trim();
}

/**
 * Answer one user message.
 * @param {object} p
 * @param {string} p.text         the user's message (already transcribed if voice)
 * @param {string} p.historyKey   conversation key (phone number or web user)
 * @param {string} [p.language]   language hint from STT
 * @param {AbortSignal} [p.signal]
 * @param {(t:string)=>void} [p.onToken]   streaming callback (web chat)
 * @param {(s:string)=>void} [p.onStatus]  progress callback ("thinking", "querying", "answering")
 * @param {()=>void} [p.release]  a queue slot already acquired by the caller
 * @param {number} [p.maxTokens]
 */
export async function runAssistant(p) {
  const started = Date.now();
  const text = String(p.text || "").slice(0, config.llm.maxUserChars);
  const release = p.release ?? (await llmQueue.acquire(p.signal));
  const status = (s) => p.onStatus?.(s);
  const maxTokens = p.maxTokens ?? config.llm.botMaxTokens;
  const userMsg = { role: "user", content: `${P.contextLine({ language: p.language })}\n${text}` };

  try {
    const schema = await getSchema();
    let result;

    if (!schema.tables.size) {
      // No database available: plain chat so the bot still answers.
      status("answering");
      const sys =
        P.answerPrompt() +
        "\n\nThe database is currently unavailable. If the user asks for data, say the data service is temporarily unavailable.";
      const reply = await streamAnswer(
        [{ role: "system", content: sys }, ...historyFor(p.historyKey, 1500), userMsg],
        { signal: p.signal, onToken: p.onToken, maxTokens }
      );
      result = { action: "reply", reply };
    } else {
      status("thinking");
      const mode = schemaMode(schema);
      let planMessages;
      let decision;

      if (mode === "full") {
        planMessages = [
          { role: "system", content: P.plannerPrompt(describeTables(schema)) },
          ...historyFor(p.historyKey, 1500),
          userMsg,
        ];
        decision = await plan(planMessages, p);
      } else {
        const pickMessages = [
          { role: "system", content: P.tablePickerPrompt(listTableNames(schema)) },
          ...historyFor(p.historyKey, 1200),
          userMsg,
        ];
        decision = await plan(pickMessages, p);
        if (decision.action === "tables") {
          const tables = resolveTables(schema, decision.body.split(/[\s,]+/)).slice(0, 6);
          log.debug("Picked tables:", tables);
          if (!tables.length) {
            decision = { action: "reply", body: "" };
          } else {
            planMessages = [
              { role: "system", content: P.sqlWriterPrompt(describeTables(schema, tables)) },
              ...historyFor(p.historyKey, 800),
              userMsg,
            ];
            decision = await plan(planMessages, { signal: p.signal });
          }
        }
      }

      if (decision.action === "sql") {
        status("querying");
        const q = await executeWithRetry(decision.body, planMessages, p.signal);
        status("answering");
        const capped = q.rows.length >= config.db.maxRows;
        const content =
          `${P.contextLine({ language: p.language })}\nQuestion: ${text}\n\n` +
          `Query results: ${q.rows.length} row(s)${capped ? ` (cut off at the ${config.db.maxRows}-row limit)` : ""}\n` +
          (q.rows.length ? formatRows(q.rows) : "(no rows)");
        const reply = await streamAnswer(
          [{ role: "system", content: P.answerPrompt() }, ...historyFor(p.historyKey, 600), { role: "user", content }],
          { signal: p.signal, onToken: p.onToken, maxTokens }
        );
        result = { action: "sql", reply, sql: q.sql, rowCount: q.rows.length };
      } else {
        const fallback = !decision.body;
        const reply = decision.body || "I could not find that information. Could you rephrase your question?";
        if (fallback || !decision.streamed) p.onToken?.(reply);
        result = { action: "reply", reply };
      }
    }

    if (!result.reply) result.reply = "Sorry, I could not generate an answer. Please try again.";
    appendHistory(p.historyKey, "user", text);
    appendHistory(p.historyKey, "assistant", result.reply);
    return { ...result, ms: Date.now() - started };
  } finally {
    release();
  }
}
