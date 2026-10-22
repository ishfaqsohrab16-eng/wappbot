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
import { knowledgeAnswer, teamAnswer } from "../knowledge/digibizz.js";
import { confirmLearned, rejectLearned, seedPhrasebook } from "../engine/learned.js";
import { PHRASES_1000 } from "../knowledge/phrasebook.js";
import { romanizeUrdu } from "../engine/urdu.js";
import { extractIdent, parse, slotKey } from "../engine/parser.js";

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
  for await (const tok of deps.streamChat(messages, { signal, maxTokens })) out += tok;
  // Tokens are collected first: small models sometimes "think out loud" without tags.
  const clean = stripReasoning(out);
  onToken?.(clean);
  return clean;
}

const REASONING_START = /^(okay|ok|alright|hmm+|so|first|let me|let's|we need|i need|i should|the user|user (is|wants|asked|said|clarified)|looking at|based on the|wait)\b/i;
const REASONING_LINE = /\b(the user|user's|they (want|mean|asked|said|clarified|are asking)|i should|i need to|let me|need to (explain|respond|reply|answer|check)|my (reply|response|answer)|the (assistant|system prompt)|in the reply|respond (in|with)|draft)\b/i;

/** Drop leaked chain-of-thought ("Okay, the user clarified…") and keep the actual reply. */
export function stripReasoning(text) {
  const t = String(text || "").trim();
  if (!REASONING_START.test(t) && !REASONING_LINE.test(t.split(/\n/)[0])) return t;
  const paras = t.split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean);
  const keep = paras.filter((x) => !REASONING_LINE.test(x) && !REASONING_START.test(x));
  if (keep.length) return keep.join("\n\n");
  // Only reasoning came back: a quoted final reply inside it, else nothing usable.
  const quoted = t.match(/["“]([^"”]{15,400})["”]\s*$/);
  return quoted ? quoted[1] : "";
}

// User feedback on the previous answer.
const NEGATIVE = /^(no+|nope|nah|nahi+n?|galat|ghalat|wrong|incorrect|not (this|that|correct|right)|that'?s (wrong|not (it|right|what i asked))|this is wrong|ye galat|yeh galat|bilkul galat|kya bakwas)\b|\b(i (meant|mean|asked|said|wanted|was asking)|maine (kaha|kaha tha|poocha|pucha)|mein ne (aap ko )?(kaha|poocha|pucha)|i didn'?t ask|not what i asked|wrong (answer|data|reply|result)|galat (jawab|answer|data)|jabke (mein|maine) ne|(is|was|it'?s|that'?s|this'?s) (not (a |the )?(correct|right|what i)|wrong|incorrect)|not (a |the )?(correct|right|proper) (response|answer|reply|result|data)|(response|answer|reply|result) (is|was) (wrong|incorrect|not correct)|incorrect (response|answer|reply)|sahi nahi|theek nahi|ghalat)\b/;
const POSITIVE = /^(correct|right|perfect|exactly|bilkul|sahi|sahi hai|bilkul sahi|yes correct|that'?s (right|correct|it)|good job|well done|great job|zabardast|shabash)( (hai|ha|he|bro|sir|thanks?|thank you))*$/;
const YES = /^(yes+|yeah|yep|yup|ya|haa+n?|han|ji|jee|ji haan|haan ji|ok(ay)?|sure|please|kar do|krdo|kardo|theek hai|ہاں|جی|جی ہاں)( please| ji| jee| kar do)?$/;
/** The correction without the complaint ("no, I asked about trainers" → "trainers"). */
function correctionContent(t) {
  // What follows the complaint is what they want ("you showed students, I said trainers").
  const g = new RegExp(NEGATIVE.source, "g");
  let end = -1;
  let start = -1;
  for (const m of t.matchAll(g)) {
    start = m.index;
    end = m.index + m[0].length;
  }
  const after = end >= 0 ? t.slice(end) : t;
  const picked = after.split(" ").filter((w) => w.length >= 3).length >= 1 ? after : t.slice(0, Math.max(0, start));
  return picked
    .replace(/\b(not|na|nahi) \w+(?: \w+)?$/g, " ")
    .replace(/\b(not|instead of) \w+\b/g, " ")
    .replace(/\b(no+|not|this|that|is|was|wrong|galat|answer|jawab|you|aap|ne|mujhe|me|told|bataya|hai|tha|about|for|instead|rather|but|jabke|lekin|actually|ko|kaha|ka|ke|ki|your|my|response|reply|result|correct|incorrect|right|asked|meant|said|wanted|i)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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
  const entities = engineEntities(schema);
  const dict = await getDictionary(entities, deps.runQuery, { refresh });
  // Expected questions the rules miss on this database: learn them now, not on first ask.
  if (!seeded) {
    seeded = true;
    setImmediate(() => {
      try {
        const n = seedPhrasebook({ phrases: PHRASES_1000, parse, slotKey, dict, entities });
        log.info(`Phrasebook: ${PHRASES_1000.length} expected questions checked, ${n} pre-taught`);
      } catch (err) {
        log.warn("Phrasebook seeding failed:", err.message);
      }
    });
  }
}
let seeded = false;

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

  const last0 = getLastLookup(key);
  const roman = romanizeUrdu(text).toLowerCase().replace(/[!.,?؟۔]+/g, " ").replace(/\s+/g, " ").trim();

  // "Yes" to a question the bot asked ("Did you mean late trainers today?")
  if (YES.test(roman) && last0?.suggest) {
    setLastLookup(key, { ...last0, suggest: null });
    return runAssistant({ ...p, text: last0.suggest, _fromYes: true });
  }
  // "Correct / perfect" right after an answer: confirm what was learned.
  if (POSITIVE.test(roman) && last0?.learnedId) {
    const x = confirmLearned(last0.learnedId);
    if (x) log.info(`User confirmed learned pattern ${x.id} (${x.status})`);
    setLastLookup(key, { ...last0, learnedId: null });
    const reply = "👍 Great — I'll remember that. Anything else?";
    p.onToken?.(reply);
    return finish({ action: "reply", reply, source: "feedback" });
  }
  // "Wrong / I asked about trainers": unlearn and answer the original question again.
  const recent = last0?.at && Date.now() - last0.at < 15 * 60_000;
  const correcting = NEGATIVE.test(roman) || (last0?.awaitingCorrection && roman.split(" ").length <= 8);
  const aboutProgram = knowledgeAnswer(text) || teamAnswer(text);
  if (last0?.question && recent && correcting && !aboutProgram) {
    if (last0.learnedId) {
      const x = rejectLearned(last0.learnedId);
      if (x) log.info(`User rejected learned pattern ${x.id} → ${x.status}`);
    }
    const content = last0.awaitingCorrection ? roman : correctionContent(roman);
    if (content.split(" ").filter((w) => w.length >= 3).length === 0) {
      setLastLookup(key, { ...last0, learnedId: null, awaitingCorrection: true });
      const reply = "🙏 Sorry about that! What did you want instead? e.g. _trainers, not students_ · _total amount, not count_ · _today only_";
      p.onToken?.(reply);
      return finish({ action: "clarify", reply, source: "feedback" });
    }
    p = { ...p, text: `${last0.question} ${content}`, _correction: { question: last0.question, key: last0.key, plan: last0.plan, content } };
  }

  const canned = p._fromYes || p._correction ? null : smallTalkReply(text);
  if (canned) {
    p.onToken?.(canned);
    return finish({ action: "reply", reply: canned, source: "canned" });
  }

  // General questions about the DigiBizz program (fee, stipend, eligibility, …)
  const kb = p._correction ? null : knowledgeAnswer(text, { hasIdent: Boolean(extractIdent(text)) }) || teamAnswer(text);
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

  const last = p._correction ? null : getLastLookup(key);
  const work = p._correction ? p.text : text;
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
  const r = await answer(work, {
    schema,
    query: deps.runQuery,
    last: last?.plan,
    lastText: last?.question,
    correction: p._correction,
    llm,
    transcript: transcript(history.slice(-4), 600),
  });

  if (r.handled) {
    if (r.kind === "data") {
      const question = p._correction ? p._correction.question : text;
      const k = p._correction ? p._correction.key : r.plan.key;
      setLastLookup(key, { plan: compactPlan(r.plan), question, key: k, rowCount: r.rowCount, learnedId: r.learnedId || null, at: Date.now() });
    } else if (r.kind === "clarify") {
      setLastLookup(key, { ...(last || {}), suggest: r.suggest || null, awaitingCorrection: false });
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
