import { config } from "../config.js";
import { log } from "../logger.js";
import { chat, streamChat, llmQueue } from "../llm/client.js";
import { getSchema, describeTables, listTableNames } from "../db/schema.js";
import { runQuery } from "../db/pool.js";
import { guardSql, extractSql, expandStars } from "../db/sqlGuard.js";
import { getCatalog, rankCatalog, formatRanked, lookupNameHits } from "../db/catalog.js";
import { getHistory, appendHistory, getLastLookup, setLastLookup } from "../store/history.js";
import { looksLikeDataQuestion, smallTalkReply, identifierHints } from "./intent.js";
import { parseJson, chooseTables, formatRows, transcript, lastLookupText } from "./context.js";
import * as P from "./prompts.js";

// Swappable for tests.
let deps = { chat, streamChat, getSchema, getCatalog, runQuery, lookupNameHits };
export function __setDeps(d) {
  deps = { ...deps, ...d };
}

const FALLBACK_REPLY = "Sorry, I didn't quite get that. Could you say it another way, e.g. *how many students are in batch 10*?";

async function streamText(messages, { signal, onToken, maxTokens, temperature }) {
  let out = "";
  for await (const tok of deps.streamChat(messages, { signal, queued: false, maxTokens, temperature })) {
    out += tok;
    onToken?.(tok);
  }
  return out.trim();
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
  return out.slice(0, 14);
}

/** Step 1: one JSON call that understands the message in context. */
async function understand({ schema, catalog, text, history, last, signal }) {
  const ranked = rankCatalog(catalog, text, { limit: 12, minScore: 60 });
  const sys = P.understandPrompt({
    tableList: listTableNames(schema),
    ranked: formatRanked(ranked),
    lastLookup: lastLookupText(last),
    transcript: transcript(history),
  });
  const raw = await deps.chat(
    [
      { role: "system", content: sys },
      { role: "user", content: `[Today is ${P.today()}]\nNew message: ${text}` },
    ],
    { signal, queued: false, json: true, maxTokens: 400, temperature: 0 }
  );
  const u = parseJson(raw) || {};
  let type = ["data", "chat", "clarify"].includes(u.type) ? u.type : looksLikeDataQuestion(text) ? "data" : "chat";
  // A bare CNIC / phone / long number is always a lookup.
  if (type !== "data" && (identifierHints(text).length || /\d{5,}/.test(text))) type = "data";
  const question = typeof u.question === "string" && u.question.trim().length > 3 ? u.question.trim() : text;
  const tables = Array.isArray(u.tables) ? u.tables.map(String) : typeof u.tables === "string" ? u.tables.split(/[\s,]+/) : [];
  const reply = typeof u.reply === "string" ? u.reply.trim() : "";
  log.debug(`understand: ${type} | ${question} | ${tables.join(",")}`);
  return { type, question, tables, reply };
}

async function runSql(candidate, schema) {
  const g = guardSql(expandStars(extractSql(candidate), schema.tables));
  if (!g.ok) return { error: g.error, sql: extractSql(candidate) };
  try {
    const res = await deps.runQuery(g.sql);
    return { sql: g.sql, rows: res.rows };
  } catch (err) {
    return { error: err.sqlMessage || err.code || "query failed", sql: g.sql };
  }
}

/** Step 2: write SQL, run it, repair errors and broaden empty results. */
async function lookup({ schema, catalog, question, text, picked, last, signal, onStatus, onProgress }) {
  const ranked = mergeRanked(
    rankCatalog(catalog, question, { limit: 14, minScore: 55 }),
    rankCatalog(catalog, text, { limit: 8, minScore: 60 })
  );
  const tables = chooseTables(schema, { picked, question, text, ranked });
  const idHints = identifierHints(`${text}\n${question}`);
  const messages = [
    { role: "system", content: P.sqlPrompt({ schemaText: describeTables(schema, tables), ranked: formatRanked(ranked), idHints }) },
    {
      role: "user",
      content: [
        `Today is ${P.today()}.`,
        `Question: ${question}`,
        text !== question ? `User's original words: ${text}` : "",
        last?.sql ? `Previous query in this chat (reuse its filters for follow-ups): ${last.sql.replace(/\s+/g, " ")}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    },
  ];

  let good = null;
  let empty = null;
  let closeNames = [];
  let lastError = null;
  const steps = Math.max(2, config.llm.maxAgentSteps);
  let candidate = await deps.chat(messages, { signal, queued: false, maxTokens: 600, temperature: 0 });

  for (let step = 0; step < steps; step++) {
    onStatus?.("querying");
    const r = await runSql(candidate, schema);
    let feedback;
    if (r.error) {
      lastError = r.error;
      log.warn(`SQL rejected/failed (step ${step + 1}): ${r.error}\n${r.sql}`);
      if (step === 0) onProgress?.("🛠️ Adjusting the search…");
      feedback = `That query failed: ${r.error}. Write a corrected query using only the schema's tables and columns. Output only the SQL.`;
    } else if (r.rows.length) {
      good = r;
      break;
    } else {
      if (empty) break; // already broadened once; accept "no rows"
      onProgress?.("🔁 No exact match yet, trying a broader search…");
      empty = r;
      closeNames = await deps.lookupNameHits(schema, `${question} ${text}`, tables).catch(() => []);
      feedback =
        "The query returned 0 rows. " +
        (closeNames.length ? `These similar values exist in the database:\n${formatRanked(closeNames.slice(0, 12))}\n` : "") +
        "Write a broader query: use the official values above if they fit, LIKE on single key words, fewer filters, or another column/table that may hold the value. Output only the SQL.";
    }
    if (step === steps - 1) break;
    messages.push({ role: "assistant", content: r.sql || extractSql(candidate) }, { role: "user", content: feedback });
    candidate = await deps.chat(messages, { signal, queued: false, maxTokens: 600, temperature: 0.1 });
  }
  return { result: good || empty, closeNames, ranked, lastError };
}

/**
 * Answer one user message.
 * p: { text, historyKey, language, signal, release, onToken, onStatus, onProgress, maxTokens }
 * onProgress gets short user-facing notes (what was understood, retries); never SQL or schema.
 */
export async function runAssistant(p) {
  const started = Date.now();
  const text = String(p.text || "").trim().slice(0, config.llm.maxUserChars);
  const key = p.historyKey;
  const status = (s) => p.onStatus?.(s);
  const maxTokens = p.maxTokens ?? config.llm.botMaxTokens;
  const finish = (result) => {
    if (!result.reply) result.reply = FALLBACK_REPLY;
    appendHistory(key, "user", text);
    appendHistory(key, "assistant", result.reply);
    return { ...result, ms: Date.now() - started };
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

    const chatReply = async (dbDown = false) => {
      status("answering");
      return streamText(
        [{ role: "system", content: P.chatPrompt({ dbDown }) }, ...history.slice(-8), { role: "user", content: text }],
        { signal: p.signal, onToken: p.onToken, maxTokens: 250 }
      );
    };

    if (!schema.tables.size) return finish({ action: "reply", reply: await chatReply(true) });

    const catalog = await deps.getCatalog(schema);
    const last = getLastLookup(key);
    status("thinking");
    const u = await understand({ schema, catalog, text, history, last, signal: p.signal });

    if (u.type === "chat" || u.type === "clarify") {
      if (u.reply) {
        p.onToken?.(u.reply);
        return finish({ action: u.type === "clarify" ? "clarify" : "reply", reply: u.reply });
      }
      return finish({ action: "reply", reply: await chatReply() });
    }

    p.onProgress?.(`🔎 Understood: ${u.question}\nChecking the records…`);
    const { result, closeNames, ranked, lastError } = await lookup({
      schema,
      catalog,
      question: u.question,
      text,
      picked: u.tables,
      last,
      signal: p.signal,
      onStatus: status,
      onProgress: p.onProgress,
    });

    status("answering");
    if (!result) {
      // No query worked: ask a helpful follow-up instead of a dead-end error.
      log.warn(`No working query for "${u.question}" (${lastError})`);
      const hints = mergeRanked(ranked, closeNames).slice(0, 8);
      const reply = await streamText(
        [
          { role: "system", content: P.clarifyPrompt() },
          {
            role: "user",
            content:
              `User's message: ${text}\nWhat you understood: ${u.question}\n` +
              (hints.length ? `Names that exist in the database:\n${hints.map((h) => `- ${h.value}`).join("\n")}` : ""),
          },
        ],
        { signal: p.signal, onToken: p.onToken, maxTokens: 200 }
      );
      return finish({ action: "clarify", reply });
    }

    const capped = result.rows.length >= config.db.maxRows;
    const reply = await streamText(
      [
        { role: "system", content: P.answerPrompt() },
        {
          role: "user",
          content: [
            `User's message: ${text}`,
            `Question looked up: ${u.question}`,
            `Rows: ${result.rows.length}${capped ? ` (cut off at the ${config.db.maxRows}-row limit)` : ""}`,
            result.rows.length ? formatRows(result.rows) : "(no rows)",
            !result.rows.length && closeNames.length
              ? `Close names in the database: ${closeNames.slice(0, 8).map((h) => h.value).join(" | ")}`
              : "",
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
      { signal: p.signal, onToken: p.onToken, maxTokens, temperature: 0.2 }
    );
    setLastLookup(key, {
      question: u.question,
      sql: result.sql,
      rowCount: result.rows.length,
      sample: result.rows.length ? formatRows(result.rows.slice(0, 3), 700) : "",
    });
    return finish({ action: "sql", reply, sql: result.sql, rowCount: result.rows.length });
  } finally {
    release();
  }
}
