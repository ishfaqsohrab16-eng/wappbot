import { config } from "../config.js";
import { log } from "../logger.js";
import { chat, streamChat, llmQueue } from "../llm/client.js";
import { getSchema } from "../db/schema.js";
import { runQuery } from "../db/pool.js";
import { getHistory, appendHistory, getLastLookup, setLastLookup } from "../store/history.js";
import { answer } from "../engine/engine.js";
import { helpText, clearResultCache } from "../engine/executor.js";
import { getDictionary } from "../engine/dictionary.js";
import { engineEntities } from "../engine/engine.js";
import { smallTalkReply, looksLikeDataQuestion } from "./intent.js";
import { transcript } from "./context.js";
import * as P from "./prompts.js";
import { knowledgeAnswer } from "../knowledge/digibizz.js";
import { extractIdent } from "../engine/parser.js";

// Swappable for tests.
let deps = { chat, streamChat, getSchema, runQuery };
export function __setDeps(d) {
  deps = { ...deps, ...d };
}

let llmCallCount = 0;
/** Total LLM calls made by the assistant since start (for the dashboard / tests). */
export function llmCalls() {
  return llmCallCount;
}

async function streamText(messages, { signal, onToken, maxTokens }) {
  llmCallCount++;
  let out = "";
  for await (const tok of deps.streamChat(messages, { signal, maxTokens })) {
    out += tok;
    onToken?.(tok);
  }
  return out.trim();
}

/** Keep only what a follow-up needs from a plan. */
function compactPlan(plan) {
  if (!plan?.entity) return null;
  const { op, entity, dim, filters, ident, limit } = plan;
  return { op, entity, dim, filters, ident, limit };
}

/** Load the engine's lookup values (batches, centers, …) so the first question is fast. */
export async function warmEngine({ refresh = false } = {}) {
  const schema = await deps.getSchema();
  if (!schema.tables.size) return;
  if (refresh) clearResultCache();
  await getDictionary(engineEntities(schema), deps.runQuery, { refresh });
}

/**
 * Answer one user message.
 * p: { text, historyKey, language, signal, release, onToken, onStatus, onProgress, maxTokens }
 * Returns { action, reply, files, source, llmCalls, ms }.
 */
export async function runAssistant(p) {
  const started = Date.now();
  const text = String(p.text || "").trim().slice(0, config.llm.maxUserChars);
  const key = p.historyKey;
  const status = (s) => p.onStatus?.(s);
  // The queue is only needed for LLM calls; they take their own slot.
  p.release?.();
  const finish = (result) => {
    if (!result.reply) result.reply = "Sorry, I didn't quite get that. Could you say it another way?";
    appendHistory(key, "user", text);
    appendHistory(key, "assistant", result.reply);
    const ms = Date.now() - started;
    log.info(`Answered in ${ms}ms [${result.action}${result.source ? `/${result.source}` : ""}] llm=${result.llmCalls || 0}`);
    return { files: [], ...result, ms };
  };

  const canned = smallTalkReply(text);
  if (canned) {
    p.onToken?.(canned);
    return finish({ action: "reply", reply: canned, source: "canned" });
  }

  // General questions about the DigiBizz program (fee, stipend, eligibility, …)
  const kb = knowledgeAnswer(text, { hasIdent: Boolean(extractIdent(text)) });
  if (kb) {
    p.onToken?.(kb.answer);
    return finish({ action: "reply", reply: kb.answer, source: `knowledge:${kb.id}` });
  }

  const history = getHistory(key);
  const chatReply = (dbDown = false) => {
    status("answering");
    return streamText(
      [{ role: "system", content: P.chatPrompt({ dbDown }) }, ...history.slice(-6), { role: "user", content: text }],
      { signal: p.signal, onToken: p.onToken, maxTokens: 200 }
    );
  };

  const schema = await deps.getSchema();
  if (!schema.tables.size) return finish({ action: "reply", reply: await chatReply(true), llmCalls: 1 });

  const last = getLastLookup(key);
  let noted = false;
  const llm = config.engine.llmFallback
    ? async (messages, opts) => {
        if (!noted) {
          noted = true;
          p.onProgress?.("🤔 _Working out what you need…_");
        }
        llmCallCount++;
        return deps.chat(messages, { ...opts, signal: p.signal });
      }
    : null;

  status("thinking");
  const r = await answer(text, {
    schema,
    query: deps.runQuery,
    last: last?.plan,
    lastText: last?.question,
    llm,
    transcript: transcript(history.slice(-4), 600),
  });

  if (r.handled) {
    if (r.kind === "data") {
      setLastLookup(key, { plan: compactPlan(r.plan), question: text, rowCount: r.rowCount });
    }
    p.onToken?.(r.reply);
    return finish({ action: r.kind === "data" ? "engine" : r.kind, reply: r.reply, files: r.files, source: r.source, llmCalls: r.llmCalls, plan: r.plan });
  }

  // Small talk the LLM already answered while classifying
  if (r.chat && r.reply) {
    p.onToken?.(r.reply);
    return finish({ action: "reply", reply: r.reply, source: "llm", llmCalls: r.llmCalls });
  }

  // Not a supported data question.
  if (looksLikeDataQuestion(text) || !llm) {
    const reply = `I couldn't match that to the LMS data I can read.\n\n${helpText(engineEntities(schema))}`;
    p.onToken?.(reply);
    return finish({ action: "clarify", reply, source: "rules", llmCalls: r.llmCalls });
  }
  const reply = await chatReply();
  return finish({ action: "reply", reply, source: "llm-chat", llmCalls: (r.llmCalls || 0) + 1 });
}

export { llmQueue };
