import { config } from "../config.js";
import { log } from "../logger.js";
import { chat, streamChat, llmQueue } from "../llm/client.js";
import { getSchema, describeTables, listTableNames, schemaMode, resolveTables } from "../db/schema.js";
import { runQuery } from "../db/pool.js";
import { guardSql, extractSql } from "../db/sqlGuard.js";
import { getCatalog, rankCatalog, formatRanked, lookupNameHits } from "../db/catalog.js";
import { getHistory, appendHistory } from "../store/history.js";
import { looksLikeDataQuestion } from "./intent.js";
import * as P from "./prompts.js";

const PLAN_TOKENS = 900;
const RESULT_CHARS = 3500;

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
        action = "reply";
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
  const tokens = streamChat(messages, { signal, queued: false, maxTokens: PLAN_TOKENS, temperature: 0.15 });
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

function observationUser(text, q) {
  const capped = q.rows.length >= config.db.maxRows;
  return (
    `${P.contextLine({ language: undefined })}\nQuestion: ${text}\n\n` +
    `Query results: ${q.rows.length} row(s)${capped ? ` (cut off at the ${config.db.maxRows}-row limit)` : ""}\n` +
    (q.rows.length ? formatRows(q.rows) : "(no rows)")
  );
}

async function resolveNames({ text, catalog, history, userMsg, signal }) {
  if (!catalog.text && !catalog.groups.length) return "";
  const ranked = rankCatalog(catalog, text);
  if (ranked.length && ranked[0].score >= 86 && (ranked.length === 1 || ranked[0].score - ranked[1].score >= 12)) {
    return formatRanked(ranked.slice(0, 6));
  }
  const raw = await chat(
    [
      { role: "system", content: P.resolveNamesPrompt(catalog.text) },
      ...history.slice(-4),
      userMsg,
      ranked.length
        ? { role: "user", content: `Automatic closest matches:\n${formatRanked(ranked)}\nPick the official values.` }
        : { role: "user", content: "No automatic matches. Guess the closest official values or UNKNOWN." },
    ],
    { signal, queued: false, maxTokens: 400, temperature: 0 }
  );
  return [ranked.length ? formatRanked(ranked.slice(0, 8)) : "", raw.replace(ACTION_RE, "").trim()].filter(Boolean).join("\n");
}

const TABLE_FALLBACK = /center|centre|campus|batch|student|enroll|user|course|program|institut|class|session/i;

function fallbackTables(schema, catalog, text) {
  const names = [];
  for (const h of rankCatalog(catalog, text, { limit: 30, minScore: 40 })) {
    if (!names.includes(h.table)) names.push(h.table);
  }
  for (const t of schema.tables.keys()) {
    if (TABLE_FALLBACK.test(t) && !names.includes(t)) names.push(t);
    if (names.length >= 8) break;
  }
  return names.slice(0, 8);
}

async function pickTables(schema, history, userMsg, signal) {
  const pickMessages = [
    { role: "system", content: P.tablePickerPrompt(listTableNames(schema)) },
    ...history,
    userMsg,
  ];
  const decision = await plan(pickMessages, { signal });
  if (decision.action === "reply") return { tables: null, decision };
  const names = decision.action === "tables" ? decision.body.split(/[\s,]+/) : [];
  const tables = resolveTables(schema, names).slice(0, 8);
  return { tables, decision: tables.length ? null : { action: "reply", body: "" } };
}

async function investigate({ schema, tables, catalog, text, language, history, userMsg, signal, onToken, onStatus, maxTokens }) {
  const schemaText = describeTables(schema, tables);
  const ranked = rankCatalog(catalog, text);
  onStatus?.("thinking");
  let resolved = "";
  if (looksLikeDataQuestion(text)) {
    try {
      resolved = await resolveNames({ text, catalog, history, userMsg, signal });
    } catch (err) {
      log.warn("Name resolution skipped:", err.message);
    }
  }
  const extra = P.extraNotes({
    catalogText: catalog.text,
    rankedText: formatRanked(ranked),
    resolvedText: resolved,
  });

  const observations = [];
  let lastQuery = null;
  const maxSteps = Math.max(1, config.llm.maxAgentSteps);
  const usedTables = tables;

  for (let step = 0; step < maxSteps; step++) {
    const sys =
      step === 0
        ? P.plannerPrompt(schemaText, extra)
        : P.investigatorPrompt(schemaText, extra);
    const messages = [{ role: "system", content: sys }, ...history, userMsg, ...observations];
    const streamReply = step > 0 || !looksLikeDataQuestion(text);
    const decision = await plan(messages, { signal, onToken: streamReply ? onToken : undefined });

    if (decision.action !== "sql") {
      if (looksLikeDataQuestion(text) && step === 0 && !lastQuery) {
        log.debug("Overriding chat reply with SQL investigation");
        const forced = await plan(
          [
            { role: "system", content: P.sqlWriterPrompt(schemaText, extra) },
            ...history,
            userMsg,
            { role: "user", content: "This needs database facts. Output ACTION: sql and a query. If names are unclear, SELECT DISTINCT candidate names first." },
          ],
          { signal }
        );
        if (forced.action === "sql") {
          decision.action = "sql";
          decision.body = forced.body;
        } else {
          return { action: "reply", reply: decision.body, streamed: decision.streamed };
        }
      } else {
        return { action: "reply", reply: decision.body, streamed: decision.streamed, sql: lastQuery?.sql, rowCount: lastQuery?.rows.length };
      }
    }

    onStatus?.("querying");
    const q = await executeWithRetry(decision.body, messages, signal);
    lastQuery = q;
    observations.push({ role: "assistant", content: `ACTION: sql\n${q.sql}` });
    observations.push({ role: "user", content: observationUser(text, q) });
    log.debug(`Investigate step ${step + 1}: ${q.rows.length} rows`);

    if (!q.rows.length) {
      const hits = await lookupNameHits(schema, text, usedTables);
      if (hits.length) {
        observations.push({
          role: "user",
          content:
            "The query returned no rows. Similar names found in the database:\n" +
            formatRanked(hits) +
            "\nWrite a new ACTION: sql using these official values, or ACTION: reply if none fit.",
        });
      }
    }
  }

  onStatus?.("answering");
  const content =
    lastQuery
      ? observations
          .filter((m) => m.role === "user")
          .map((m) => m.content)
          .join("\n\n")
      : `${P.contextLine({ language })}\nQuestion: ${text}\n\n(no query results)`;
  const reply = await streamAnswer(
    [{ role: "system", content: P.answerPrompt() }, ...history.slice(-4), { role: "user", content }],
    { signal, onToken, maxTokens }
  );
  return { action: "sql", reply, sql: lastQuery?.sql, rowCount: lastQuery?.rows.length ?? 0 };
}

/**
 * Answer one user message.
 */
export async function runAssistant(p) {
  const started = Date.now();
  const text = String(p.text || "").slice(0, config.llm.maxUserChars);
  const release = p.release ?? (await llmQueue.acquire(p.signal));
  const status = (s) => p.onStatus?.(s);
  const maxTokens = p.maxTokens ?? config.llm.botMaxTokens;
  const userMsg = { role: "user", content: `${P.contextLine({ language: p.language })}\n${text}` };
  const history = historyFor(p.historyKey, 1500);

  try {
    const schema = await getSchema();
    let result;

    if (!schema.tables.size) {
      status("answering");
      const sys =
        P.answerPrompt() +
        "\n\nThe database is currently unavailable. If the user asks for data, say the data service is temporarily unavailable.";
      const reply = await streamAnswer(
        [{ role: "system", content: sys }, ...history, userMsg],
        { signal: p.signal, onToken: p.onToken, maxTokens }
      );
      result = { action: "reply", reply };
    } else {
      const catalog = await getCatalog(schema);
      let tables;
      const mode = schemaMode(schema);
      if (mode !== "full") {
        status("thinking");
        const picked = await pickTables(schema, historyFor(p.historyKey, 800), userMsg, p.signal);
        if (picked.decision?.action === "reply" && !looksLikeDataQuestion(text)) {
          const reply = picked.decision.body || "I could not find that information. Could you rephrase your question?";
          if (!picked.decision.streamed) p.onToken?.(reply);
          result = { action: "reply", reply };
        } else {
          const fb = fallbackTables(schema, catalog, text);
          tables = picked.tables?.length ? picked.tables : fb.length ? fb : undefined;
        }
      }
      if (!result) {
        result = await investigate({
          schema,
          tables,
          catalog,
          text,
          language: p.language,
          history,
          userMsg,
          signal: p.signal,
          onToken: p.onToken,
          onStatus: status,
          maxTokens,
        });
        if (!result.reply) {
          const fallback = "I could not find that information. Could you rephrase your question?";
          p.onToken?.(fallback);
          result.reply = fallback;
        } else if (result.action === "reply" && !result.streamed) {
          p.onToken?.(result.reply);
        }
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
