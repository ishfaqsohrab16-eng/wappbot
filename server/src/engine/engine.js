import { config } from "../config.js";
import { log } from "../logger.js";
import { activeEntities } from "./entities.js";
import { getDictionary, resolveBatch, resolveCenter, resolveCourse, resolveEnum, resolveDate } from "./dictionary.js";
import { parse, slotKey, extractIdent, isFollowUpText, isGenericKey } from "./parser.js";
import { execute, formatReply, helpText, humanizeRow, filterSummary, CHAT_LIST_ROWS } from "./executor.js";
import { findLearned, learn, touchLearned, learnedSynonyms, learnWord, linkWord, learnSql, findLearnedSql } from "./learned.js";
import { agentDecide, runAgentSql, formatAgentRows } from "./agent.js";
import { editDistance } from "./dictionary.js";
import { fold } from "../db/catalog.js";
import { excelFile, chartFile, wordFile } from "./files.js";

// Deterministic query engine. Order: learned pattern → rules → LLM classification
// (JSON plan only, never SQL) → clarification. Everything runs through the fixed
// read-only handlers in executor.js.

const RULE_MIN_CONFIDENCE = 0.55;
const WRITE_RE =
  /^(?:please |pls |plz |can you |could you |kindly |zara )?(?:delete|remove|update|change|edit|modify|insert|create|add|register|enroll|approve|reject|suspend|block|unblock|reset|assign|allocate|mark)\b|\bsend (?:an? |the )?(?:email|emails|sms|message|messages|notification|notifications|reminder|reminders)\b|\bmark (?:the |their )?attendance\b|\b(?:delete|update|change|edit) (?:kar|karo|kardo|kar do)\b/;
const LOOKUP_ENTITIES = new Set(["batch", "center", "course"]);
// Unknown words that are chit-chat, never a reason to run a lookup ("nice man").
const CHATTY = new Set("nice cool great awesome super wow haha hahaha lol okay okk alright fine good bad sad happy dude bro bruh yaar buddy friend sweet lovely amazing interesting really seriously".split(" "));
const sameAs = (a, b) => Boolean(a && b) && a.entity === b.entity && a.op === b.op && (a.dim || null) === (b.dim || null);
/** The correction spells out the same question by itself ("trainers who are late"): the user is restating, not rejecting. */
function restates(content, plan) {
  if (!content || !restates.entities) return false;
  const own = parse(content, { dict: restates.dict, entities: restates.entities });
  return own.entity === plan.entity && own.op === plan.op && own.confidence >= RULE_MIN_CONFIDENCE;
}
/**
 * /learn: save the message, the LLM's paraphrases of it (English, Roman Urdu, Urdu)
 * and its new words as trusted patterns. Paraphrases the rules already route the
 * same way are skipped (nothing to learn). Returns what was saved.
 */
function teachAll({ text, key, plan, base, dict, entities, paraphrases }) {
  const mapping = { op: plan.op, entity: plan.entity, dim: plan.dim || null };
  const understood = (p) => p.op === mapping.op && p.entity === mapping.entity && (!mapping.dim || p.dim === mapping.dim) && p.confidence >= RULE_MIN_CONFIDENCE;
  const taught = { mapping, main: null, phrases: [], known: 0, words: [] };
  if (!isGenericKey(key)) taught.main = learn({ key, mapping, confidence: 1, source: "teach", example: text, override: true }).entry || null;
  // The words the rules didn't know carry the meaning (at most two, so filler isn't learned).
  const unknown = (base.unknown || []).filter((w) => /^[a-z]{4,}$/.test(w));
  if (base.entity !== plan.entity && unknown.length && unknown.length <= 2 && plan.ident?.type !== "name") {
    for (const w of unknown) {
      const lw = learnWord({ word: w, entity: plan.entity, confidence: 1, example: text });
      if (!lw.entry) continue;
      taught.words.push(w);
      if (taught.main) linkWord(taught.main, lw.entry);
    }
  }
  const list = Array.isArray(paraphrases) ? paraphrases : [];
  for (const raw of list.slice(0, 12)) {
    const s = String(raw || "").trim().slice(0, 160);
    if (!s || s.toLowerCase() === text.toLowerCase()) continue;
    const pp = parse(s, { dict, entities, synonyms: learnedSynonyms() });
    if (understood(pp)) {
      taught.known++;
      continue;
    }
    const k = slotKey(pp);
    if (isGenericKey(k)) continue;
    const r = learn({ key: k, mapping, confidence: 1, source: "teach", example: s, override: true });
    if (r.entry) taught.phrases.push(s);
  }
  log.info(`Taught "${key}" → ${mapping.op}/${mapping.entity}: ${taught.phrases.length} paraphrases, ${taught.known} already known, words [${taught.words.join(", ")}]`);
  return taught;
}

const describe = (p) => (p ? `${p.op} of ${p.entity}${p.dim ? ` by ${p.dim}` : ""}` : "something else");
let active = null; // { schemaAt, entities, problems }

export function engineEntities(schema) {
  if (active?.schemaAt === schema.loadedAt) return active.entities;
  const { entities, problems } = activeEntities(schema);
  for (const p of problems) log.warn(`Query engine: ${p}`);
  log.info(`Query engine: ${Object.keys(entities).length} entities ready`);
  active = { schemaAt: schema.loadedAt, entities, problems };
  return entities;
}

/** Check a plan against the catalogue. Returns { ok, clarify? }. */
export function validatePlan(plan, entities) {
  const e = entities[plan.entity];
  if (plan.op === "help") return { ok: true };
  if (!e) return { ok: false, reason: "unknown entity" };
  if (plan.op === "current" && plan.entity !== "batch") plan.op = "list";
  if (plan.op === "late") {
    if (!e.late || !entities.schedule) return { ok: false, reason: "punctuality is only checked for trainer check-ins" };
    return { ok: true };
  }
  if (plan.op === "count_by" && !(e.dims || []).includes(plan.dim)) {
    if (e.defaultDim) plan.dim = e.defaultDim;
    // No (or an impossible) breakdown: answer the plain total instead of an error.
    else if (!plan.dim) plan.op = e.sum ? "sum" : "count";
    else return { ok: false, reason: `I can't split ${e.plural} by ${plan.dim} — try by ${(e.dims || []).slice(0, 4).join(", ")}` };
  }
  if (plan.op === "sum" && !e.sum) plan.op = "count";
  if (plan.op === "avg" && !(e.avg && Object.keys(e.avg).length)) return { ok: false, reason: `no average for ${e.plural}` };
  if (plan.op === "top" && !e.top) return { ok: false, reason: `no ranking for ${e.plural}` };
  if (plan.op === "details" && !plan.ident && !plan.lookupIds?.length) {
    // "details of trainers" (plural, nobody named): show them rather than ask which one.
    if (LOOKUP_ENTITIES.has(plan.entity) || new RegExp(`\\b${e.plural.split(" ").at(-1)}\\b`).test(plan.text || "")) plan.op = "list";
    else {
      const ways = Object.keys(e.idents || {}).map((k) => ({ cnic: "CNIC", rollno: "roll number", phone: "phone", name: "name" })[k] || k);
      return { ok: false, clarify: `Which ${e.singular}? Please send their ${ways.join(", ").replace(/, ([^,]*)$/, " or $1")}.` };
    }
  }
  if (plan.ident && plan.op === "details" && !e.idents?.[plan.ident.type] && !e.student) {
    return { ok: false, clarify: `I can't look up ${e.plural} by ${plan.ident.type}. Try their ${Object.keys(e.idents || { name: 1 }).join(" or ")}.` };
  }
  if (plan.filters?.batch?.notFound) return { ok: false, clarify: `I couldn't find *${plan.filters.batch.label}*. Send "list batches" to see them.` };
  // Earnings: the LMS reports approved amounts (earning_status = 1)
  if (plan.entity === "earning" && ["sum", "top"].includes(plan.op) && !plan.filters?.status && e.status?.approved !== undefined)
    plan.filters = { ...plan.filters, status: { values: [e.status.approved], label: "approved" } };
  return { ok: true };
}

// ---- LLM classification (fallback only) --------------------------------

function catalogText(entities) {
  return Object.entries(entities)
    .map(([n, e]) => {
      const ops = ["count", "list", e.details?.length ? "details" : null, e.dims?.length ? "count_by" : null, e.sum ? "sum" : null, e.avg && Object.keys(e.avg).length ? "avg" : null, e.top ? "top" : null, n === "batch" ? "current" : null, e.late ? "late" : null].filter(Boolean);
      const filters = [...Object.keys(e.filters || {}), e.date ? "date" : null].filter(Boolean);
      return `${n}: ops=${ops.join("/")}; dims=${(e.dims || []).join("/") || "-"}; filters=${filters.join("/") || "-"}${e.idents ? `; lookup by ${Object.keys(e.idents).join("/")}` : ""}${e.student ? "; per-student via cnic/rollno" : ""}`;
    })
    .join("\n");
}

function classifyPrompt(entities, { text, lastText, transcript, correction, teach = false }) {
  return [
    {
      role: "system",
      content: [
        "You route WhatsApp questions about an LMS (students, batches, centers, courses, trainers, attendance, admissions) to a JSON query plan. You never write SQL.",
        `Entities:\n${catalogText(entities)}`,
        'Output JSON only: {"type":"data|chat|clarify|unsupported","op":"","entity":"","dim":null,"filters":{},"ident":null,"limit":null,"confidence":0.0,"reply":"","suggest":""}',
        '- data: op and entity from the list; dim only for count_by; filters as plain words, e.g. {"batch":"10","center":"quetta","course":"web","gender":"female","status":"active","date":"this month"}; ident {"type":"cnic|rollno|phone|name","value":"..."} for one person.',
        '- chat: greetings/small talk → "reply" short and friendly, same language as the user.',
        '- clarify: you cannot tell what they want → "reply" one short question.',
        '- unsupported: the data is not in the list → "reply" explaining briefly.',
        '- clarify: also give "suggest": the most likely question rewritten in plain English (e.g. "late trainers today"), so a "yes" can run it.',
        '- late (trainer_attendance only): who was late / on time vs the class schedule; ident {"type":"name"} for one trainer.',
        "- Follow the user's latest correction if they say a previous answer was wrong.",
        teach
          ? '- TEACH MODE: an admin is teaching you this phrasing. Answer with type "data" if at all possible, and add "paraphrases": 8 other short ways staff would ask exactly the same thing (mix English, Roman Urdu and Urdu script; keep any names, numbers, centers and dates).'
          : "",
        "confidence: 0-1, how sure you are about op+entity. Users write English, Urdu or Roman Urdu with typos.",
      ].join("\n"),
    },
    {
      role: "user",
      content: `${transcript ? `Recent chat:\n${transcript}\n\n` : ""}${lastText ? `Previous question: ${lastText}\n` : ""}${
        correction ? `The user said the answer to "${correction.question}" was WRONG (it was read as ${correction.wrong}). Their correction follows; answer the original question the way they mean it.\n` : ""
      }Message: ${text}`,
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

/** True when a value the LLM proposes is actually in the user's message (typos allowed). */
function inMessage(value, text) {
  const words = fold(text).split(" ");
  return fold(value)
    .split(" ")
    .filter((w) => w.length >= 3 || /^\d+$/.test(w))
    .some((w) => words.some((x) => x === w || (w.length >= 4 && x.length >= 4 && editDistance(x, w) <= 2)));
}

/**
 * Turn the LLM's loose JSON into a plan, re-using values the rules already found.
 * Values (filters, CNIC, names) are only accepted if they appear in the current
 * message, or the message clearly refers back to the previous question — the
 * model must not copy them from the chat history on its own.
 */
function planFromLlm(j, base, { dict, entities, text, last }) {
  const plan = { ...base, op: j.op, entity: j.entity, dim: j.dim || null, filters: { ...base.filters }, limit: j.limit || base.limit };
  const e = entities[plan.entity];
  if (!e) return null;
  const refersBack = Boolean(last) && isFollowUpText(base.text);
  const f = j.filters && typeof j.filters === "object" ? j.filters : {};
  for (const [k, raw] of Object.entries(f)) {
    if (plan.filters[k] || raw === null || raw === "") continue;
    if (!inMessage(raw, text) && !(k === "date" && /\b(today|aaj|yesterday|kal|week|month|year|mahine|hafte)\b/.test(base.text))) {
      if (refersBack && last.filters?.[k]) plan.filters[k] = last.filters[k];
      continue;
    }
    const v = String(raw).toLowerCase();
    let r = null;
    if (k === "batch") r = resolveBatch(dict, /\d/.test(v) && !/batch/.test(v) ? `batch ${v}` : `${v} batch`);
    else if (k === "center") r = resolveCenter(dict, v);
    else if (k === "course") r = resolveCourse(dict, v);
    else if (k === "date") r = resolveDate(v);
    else if (e.filters?.[k]) r = resolveEnum(dict, plan.entity, k, v, e);
    if (r) plan.filters[k] = r;
  }
  if (!plan.ident && j.ident?.value && ["cnic", "rollno", "phone", "name", "email"].includes(j.ident.type)) {
    const v = String(j.ident.value);
    const digits = v.replace(/\D/g, "");
    const present = digits.length >= 7 ? text.replace(/\D/g, "").includes(digits) : inMessage(v, text);
    if (present) {
      plan.ident = extractIdent(v) || (j.ident.type === "name" ? { type: "name", value: v.toLowerCase().slice(0, 60), display: v.slice(0, 60) } : null);
    } else if (refersBack && last.ident) {
      plan.ident = last.ident;
    }
  }
  return plan;
}

// ---- files -----------------------------------------------------------

async function buildFiles(plan, res, ctx) {
  const { entities, dict, query } = ctx;
  const e = entities[plan.entity];
  const want = plan.want || {};
  const files = [];
  const title = `${e.plural[0].toUpperCase()}${e.plural.slice(1)}${plan.dim ? ` by ${plan.dim}` : ""}`;
  const subtitle = filterSummary(plan);
  try {
    if (plan.op === "list" && (want.excel || want.word || (config.engine.autoExcel && res.total > CHAT_LIST_ROWS))) {
      const full = await execute(plan, { entities, query, exportRows: config.engine.exportMaxRows });
      const rows = full.rows.map((r) => humanizeRow(r, { dict, entity: e }));
      if (want.word) files.push(await wordFile(title, { subtitle, summary: [`Total: ${res.total}`], rows }));
      if (want.excel || !want.word) files.push(await excelFile(title, rows, { sheet: e.plural }));
    } else if (["count_by", "top"].includes(plan.op) && res.rows.length) {
      const rows = res.rows.map((r) => {
        const h = humanizeRow(r, { dict, entity: e, dim: plan.dim });
        return plan.op === "top" ? { Name: h.name || "Unknown", Value: Number(r.v) } : { [plan.dim]: h.k ?? "Not set", Count: Number(r.n) };
      });
      const data = rows.map((r) => ({ label: String(Object.values(r)[0]), value: Number(Object.values(r)[1]) || 0 }));
      if (want.chart || (config.engine.autoChart && plan.op === "count_by" && data.length >= 3)) {
        const c = await chartFile(title, data, { subtitle });
        if (c) files.push(c);
      }
      if (want.excel) files.push(await excelFile(title, rows));
      if (want.word) files.push(await wordFile(title, { subtitle, rows }));
    } else if (want.word || want.excel) {
      const rows = (res.rows || []).map((r) => humanizeRow(r, { dict, entity: e }));
      if (want.word) files.push(await wordFile(title, { subtitle, summary: [ctx.replyText], rows: plan.op === "details" ? [] : rows }));
      if (want.excel && rows.length) files.push(await excelFile(title, rows));
    }
  } catch (err) {
    log.warn("File generation failed:", err.message);
  }
  return files.filter(Boolean);
}

// ---- main ------------------------------------------------------------

/**
 * Answer a message with the deterministic engine.
 * ctx: { schema, query, last (previous plan), llm (chat fn or null), transcript, onProgress }
 * Returns { handled, reply, files, plan, source, llmCalls, kind }.
 */
export async function answer(text, ctx) {
  const entities = engineEntities(ctx.schema);
  const dict = await getDictionary(entities, ctx.query);
  const out = { handled: false, files: [], llmCalls: 0, source: null };
  let plan = parse(text, { dict, entities, last: ctx.last, synonyms: learnedSynonyms() });
  restates.dict = dict;
  restates.entities = entities;
  const base = plan;
  const key = slotKey(plan);
  plan.key = key;

  if (plan.op === "help") return { ...out, handled: true, reply: helpText(entities), plan, source: "rules", kind: "help" };

  // Requests to change data or send messages: this bot is read-only.
  if (WRITE_RE.test(plan.text))
    return {
      ...out,
      handled: true,
      kind: "unsupported",
      source: "rules",
      plan,
      reply: "I have *read-only* access: I can look things up, count, list and export, but I can't change records or send emails/messages. Please do that in the LMS portal.",
    };

  // The user named the LLM: it decides — built-in query, its own SQL, or a plain reply.
  if (ctx.agent && ctx.llm) {
    const actx = { schema: ctx.schema, entities, dict, question: text, transcript: ctx.transcript, lastText: ctx.lastText, llm: ctx.llm };
    out.llmCalls++;
    let d = await agentDecide(actx);
    if (!d) return { ...out, handled: true, kind: "clarify", plan, reply: "🧠 The AI couldn't answer that right now. Please try again in a moment, or ask without _llm_ to use the built-in answers." };
    if (d.action === "reply") return { ...out, handled: true, kind: "reply", plan, source: "agent", reply: `🧠 ${String(d.reply || "").trim() || "I couldn't find that in the LMS data."}` };
    if (d.action === "sql") {
      let rows = null;
      let lastErr = null;
      for (let attempt = 0; attempt < 2 && rows === null; attempt++) {
        try {
          rows = await runAgentSql(d.sql, ctx.query);
        } catch (err) {
          lastErr = err;
          log.warn(`Agent SQL failed (try ${attempt + 1}): ${err.message} :: ${String(d.sql).slice(0, 300)}`);
          if (attempt === 0) {
            out.llmCalls++;
            const fixed = await agentDecide(actx, { error: err.message.slice(0, 300), previousSql: d.sql });
            if (!fixed || fixed.action !== "sql") {
              if (fixed?.action === "plan" || fixed?.action === "reply") d = fixed;
              break;
            }
            d = fixed;
          }
        }
      }
      if (rows !== null) {
        const { reply, files } = await formatAgentRows(rows, { dict, title: d.title, explain: d.explain });
        const saved = learnSql({ question: text, sql: d.sql, explain: d.explain, title: d.title });
        if (saved.entry) log.info(`Learned AI query ${saved.entry.id} for "${text}"`);
        return {
          ...out,
          handled: true,
          kind: "data",
          source: "agent-sql",
          learnedId: saved.entry?.id,
          plan: { ...plan, op: "sql", entity: null },
          reply: `${reply}\n\n_AI-written query · saved for next time · say_ _wrong_ _if it's not right_`,
          files,
          rowCount: rows.length,
        };
      }
      if (d.action === "reply") return { ...out, handled: true, kind: "reply", plan, source: "agent", reply: `🧠 ${d.reply}` };
      if (d.action !== "plan")
        return { ...out, handled: true, kind: "unsupported", plan, source: "agent", reply: `🧠 The AI's query didn't run (${String(lastErr?.message || "error").slice(0, 120)}). Try rephrasing, or ask without _llm_.` };
    }
    // "plan": continue with the built-in query the model picked.
    const p = planFromLlm(d, plan, { dict, entities, text, last: ctx.last });
    if (p) {
      plan = p;
      out.source = "agent";
      out.llmConfidence = 0.9;
    }
  }

  // An AI-written query saved for this exact question: someone asked the AI for it and
  // didn't call it wrong, so it beats the rules' guess. ("wrong" disables it.)
  if (!ctx.agent && !ctx.teach && !ctx.correction) {
    const hit = findLearnedSql(text);
    if (hit) {
      try {
        const rows = await runAgentSql(hit.mapping.sql, ctx.query);
        touchLearned(hit);
        const { reply, files } = await formatAgentRows(rows, { dict, title: hit.mapping.title, explain: hit.mapping.explain });
        return { ...out, handled: true, kind: "data", source: "learned:sql", learnedId: hit.id, plan: { ...plan, op: "sql", entity: null }, reply, files, rowCount: rows.length };
      } catch (err) {
        log.warn(`Saved AI query ${hit.id} failed: ${err.message}`);
      }
    }
  }

  // /learn <message> = <plain question>: the admin says what it means; no guessing.
  const teach = ctx.teach;
  if (teach?.meaning) {
    const mp = parse(teach.meaning, { dict, entities, synonyms: learnedSynonyms() });
    if (!mp.entity || !mp.op || mp.confidence < RULE_MIN_CONFIDENCE)
      return { ...out, handled: true, kind: "clarify", plan, reply: `🤔 I don't understand *${teach.meaning}* either. Write the meaning as a plain question, e.g. _/learn ${text} = late trainers today_` };
    plan = { ...mp, filters: { ...mp.filters, ...plan.filters }, ident: plan.ident || mp.ident, text: plan.text, key, unknown: plan.unknown };
    out.source = "teach";
  }

  // "It's wrong, today is 22 oct": no new subject, so the question was understood and the
  // user doubts the data → run the same question again (with any new date / filter).
  const prev = ctx.correction?.plan;
  if (!teach && !ctx.agent && prev?.entity && ctx.correction.content) {
    const own = parse(ctx.correction.content, { dict, entities });
    const newWords = (own.unknown || []).filter((w) => w.length >= 4 && !CHATTY.has(w));
    if ((!own.entity || (own.entity === prev.entity && own.op === prev.op)) && !newWords.length) {
      plan = { ...prev, filters: { ...(prev.filters || {}), ...own.filters }, text: plan.text, key, unknown: [] };
      out.source = "recheck";
    }
  }

  // 1-3. Learned patterns (exact, then close variants with the same slots)
  const skipKnown = teach || ctx.agent || out.source === "recheck";
  const learned = skipKnown ? null : findLearned(key);
  if (learned && !ctx.correction && (!plan.entity || !plan.op || plan.confidence < 0.75 || learned.entry.mapping.entity === plan.entity)) {
    const m = learned.entry.mapping;
    plan = { ...plan, op: m.op, entity: m.entity, dim: m.dim || plan.dim };
    // Re-extract enum filters for the learned entity
    const e = entities[plan.entity];
    if (e) for (const f of ["gender", "status", "district", "qualification", "city", "platform", "type"]) {
      if (e.filters?.[f] && !plan.filters[f]) {
        const r = resolveEnum(dict, plan.entity, f, plan.text, e);
        if (r) plan.filters[f] = r;
      }
    }
    touchLearned(learned.entry);
    out.source = `learned:${learned.match}`;
    out.learnedId = learned.entry.id;
  } else if (!skipKnown && plan.entity && plan.op && plan.confidence >= RULE_MIN_CONFIDENCE && !(ctx.correction && sameAs(plan, ctx.correction.plan) && !restates(ctx.correction.content, plan))) {
    out.source = "rules";
  }

  // 4. LLM classification when the rules are unsure
  let llmJson = null;
  if (!out.source && ctx.llm) {
    try {
      out.llmCalls++;
      const correction = ctx.correction && { question: ctx.correction.question, wrong: describe(ctx.correction.plan) };
      const raw = await ctx.llm(classifyPrompt(entities, { text, lastText: ctx.lastText, transcript: ctx.transcript, correction, teach: Boolean(teach) }), {
        json: true,
        maxTokens: teach ? 700 : 220,
        temperature: 0,
      });
      llmJson = parseJson(raw);
    } catch (err) {
      log.warn("LLM classification failed:", err.message);
    }
    if (llmJson) {
      if (teach && llmJson.type !== "data")
        return {
          ...out,
          handled: true,
          kind: "clarify",
          plan,
          reply: `🤔 I couldn't map that to LMS data${llmJson.reply ? ` (${String(llmJson.reply).trim().slice(0, 160)})` : ""}.\nTell me what it means: _/learn ${text} = <plain question>_ e.g. _= late trainers today_`,
        };
      if (["chat", "clarify", "unsupported"].includes(llmJson.type)) {
        const reply = String(llmJson.reply || "").trim();
        if (llmJson.type === "chat") return { ...out, handled: false, chat: true, reply, plan };
        const suggest = String(llmJson.suggest || "").trim().slice(0, 200);
        return {
          ...out,
          handled: true,
          kind: llmJson.type,
          suggest: llmJson.type === "clarify" && suggest ? suggest : undefined,
          reply: reply || helpText(entities),
          plan,
          source: "llm",
        };
      }
      // Nothing data-like in the message ("what are you?"): never run a lookup.
      const meaningful = teach || ctx.correction || plan.entity || Object.keys(plan.filters).length || plan.ident || plan.unknown?.some((w) => w.length >= 4 && !CHATTY.has(w));
      if (!meaningful) return { ...out, handled: false, chat: true, reply: "", plan };
      const p = planFromLlm(llmJson, plan, { dict, entities, text, last: ctx.last });
      if (p) {
        plan = p;
        out.source = teach ? "teach" : "llm";
        out.llmConfidence = Math.max(0, Math.min(1, Number(llmJson.confidence) || 0));
      }
    }
  }
  if (teach && out.source !== "teach")
    return { ...out, handled: true, kind: "clarify", plan, reply: `🤔 The AI couldn't work that out right now. Teach it directly: _/learn ${text} = <plain question>_` };

  // 5. Best effort without an LLM when we at least know the subject
  if (!out.source && plan.entity && plan.op) out.source = "rules-lowconf";
  if (!out.source) return { ...out, plan };

  const v = validatePlan(plan, entities);
  if (!v.ok) {
    if (v.clarify) return { ...out, handled: true, kind: "clarify", reply: v.clarify, plan };
    return { ...out, handled: true, kind: "unsupported", reply: `🤔 ${v.reason[0].toUpperCase()}${v.reason.slice(1)}.\n\n${helpText(entities)}`, plan };
  }

  let res;
  try {
    res = await execute(plan, { entities, query: ctx.query });
    // A bare name: try trainers and applicants when no student matches.
    if (plan.personSearch && plan.op === "details" && !res.rows.length) {
      for (const alt of ["candidate", "trainer"]) {
        if (!entities[alt]?.idents?.[plan.ident.type]) continue;
        const p2 = { ...plan, entity: alt };
        const r2 = await execute(p2, { entities, query: ctx.query });
        if (r2.rows.length) {
          plan = p2;
          res = r2;
          break;
        }
      }
      if (!res.rows.length && !plan.nameAsked) return { ...out, handled: false, plan };
    }
  } catch (err) {
    log.warn(`Engine query failed [${plan.entity}/${plan.op}]: ${err.message}`);
    return { ...out, handled: false, error: err.message, plan };
  }

  const reply = formatReply(plan, res, { entities, dict });
  const files = await buildFiles(plan, res, { entities, dict, query: ctx.query, replyText: reply });

  // Learn: the LLM's interpretation worked, so remember the phrasing.
  const found = ["count", "count_by", "sum", "avg"].includes(plan.op) || res.rows?.length || res.missing?.length;
  // A correction teaches the ORIGINAL question's phrasing, with the user's say-so.
  if (ctx.correction?.key && found && out.source !== "recheck" && !isGenericKey(ctx.correction.key)) {
    // "Details" only made sense with the name in the correction; the bare phrasing means "show them".
    const mapping = plan.op === "details" && !LOOKUP_ENTITIES.has(plan.entity) && !/\{(cnic|rollno|phone|email|name)\}/.test(ctx.correction.key) ? { ...plan, op: "list" } : plan;
    const r = learn({ key: ctx.correction.key, mapping, confidence: 0.95, source: "feedback", example: ctx.correction.question, override: true });
    if (r.entry) {
      out.learnedId = r.entry.id;
      log.info(`Learned from correction ${r.entry.id}: "${ctx.correction.key}" → ${plan.op}/${plan.entity}`);
    }
  }
  // /learn: the admin vouches for this reading — save it, its paraphrases and its new words.
  if (teach) {
    out.taught = teachAll({ text, key, plan, base, dict, entities, paraphrases: llmJson?.paraphrases });
    if (out.taught.main) out.learnedId = out.taught.main.id;
  }
  if (["llm", "agent"].includes(out.source) && found && !res.meta?.studentNotFound && !isGenericKey(key) && !ctx.correction) {
    const conf = out.llmConfidence ?? 0;
    const r = learn({ key, mapping: plan, confidence: conf, example: text });
    if (r.entry) out.learnedId = r.entry.id;
    if (r.saved) log.info(`Learned pattern ${r.entry.id} [${r.entry.status}]: "${key}" → ${plan.op}/${plan.entity}${plan.dim ? `/${plan.dim}` : ""}`);
    // Learn the unknown words too, so other sentences using them work without the LLM.
    if (base.entity !== plan.entity && plan.ident?.type !== "name") {
      // Only when exactly one word was unknown: that word must be what the LLM understood.
      const unknownWords = (base.unknown || []).filter((x) => /^[a-z]{4,}$/.test(x));
      for (const w of unknownWords.length === 1 ? unknownWords : []) {
        const lw = learnWord({ word: w, entity: plan.entity, confidence: conf, example: text });
        if (lw.saved) log.info(`Learned word "${w}" → ${plan.entity} [${lw.entry.status}]`);
        // Tie the word to this pattern: if the user says the answer was wrong, both are unlearned.
        if (lw.saved && r.entry) linkWord(r.entry, lw.entry);
      }
    }
  }

  // A doubted answer: say it was rechecked, and how to compare it with the LMS dashboard.
  const recheckNote =
    out.source === "recheck"
      ? `🔁 _Rechecked from the live LMS data._\n${plan.op === "late" ? "_If your dashboard differs, send one trainer's name (e.g._ _was Ahmed Khan late today_) _and I'll show the exact times and schedule I compared._\n" : ""}\n`
      : "";
  const t = out.taught;
  const taughtNote = t
    ? `\n\n🧠 *Learned:* "${text}" → ${describe(t.mapping)}${t.phrases.length ? `\n+ ${t.phrases.length} similar phrasing${t.phrases.length > 1 ? "s" : ""}: ${t.phrases.slice(0, 4).map((s) => `_${s}_`).join(" · ")}${t.phrases.length > 4 ? " …" : ""}` : ""}${t.known ? `\n(${t.known} more I already understood)` : ""}${t.words.length ? `\n+ word${t.words.length > 1 ? "s" : ""}: ${t.words.map((w) => `*${w}*`).join(", ")}` : ""}\n_Next time this works instantly, without the AI. Say_ _wrong_ _if this answer isn't right._`
    : "";
  return {
    ...out,
    handled: true,
    kind: "data",
    reply: recheckNote + reply + taughtNote,
    files,
    plan,
    rowCount: res.rows?.length ?? 0,
    sample: (res.rows || []).slice(0, 3),
  };
}
