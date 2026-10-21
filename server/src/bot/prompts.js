import { config } from "../config.js";

// Every LLM call uses the SAME system prompt (instructions + schema). Ollama keeps
// it in its prompt cache, so each call only has to read the short user message.
// That is what makes a CPU-only server fast. Task-specific instructions go in the
// user message.

const LANGUAGE_RULE =
  "Users write in English, Urdu (اردو), Roman Urdu, Pashto, Balochi, Sindhi or Punjabi, often with spelling mistakes and voice-typing errors. " +
  "Always reply in the same language AND script as the user's latest message (Roman Urdu → Roman Urdu, English → English).";

const WHATSAPP_STYLE =
  "WhatsApp format: short lines, *bold* for key values, '•' bullets for lists, no markdown tables, no headings, no code blocks. " +
  "Under 120 words unless the user asked for a list or full details.";

const SQL_RULES = () =>
  [
    "SQL rules:",
    "- One MySQL SELECT (or WITH … SELECT). Only tables/columns from the schema. No comments, no semicolon.",
    `- At most ${config.db.maxRows} rows (add LIMIT). For "how many" use COUNT(*) or COUNT(DISTINCT …) with a clear alias.`,
    "- Forgiving text matching: LIKE '%word%' on each important word joined with AND, never one long exact string.",
    "- 'batch 10' may be stored as 'Batch 10', 'Batch-10', 'B10' or 10 in a number column; avoid matching 100/110.",
    "- Full details of a record: select all its columns. Always JOIN lookup tables to return names (course, center, batch, city…) instead of raw ids.",
    "- 'Current/running/active': use a status column if one exists, else start date <= CURDATE() AND (end date >= CURDATE() OR end date IS NULL). 'Latest': ORDER BY date or id DESC LIMIT 1.",
    "- Use CURDATE()/NOW() for relative dates.",
  ].join("\n");

/** The one static system prompt. */
export function systemPrompt({ schemaText, full }) {
  return [
    `You are ${config.bot.name}, a smart and friendly WhatsApp data assistant. ${config.bot.contextNote}`,
    `You have read-only access to a MySQL database. ${full ? "Complete schema" : "Tables with their first columns (more columns are given when needed)"}, as table(column:type), * = primary key, columns without a type are text:\n${schemaText}`,
    config.db.schemaNotes ? `Notes about the data: ${config.db.schemaNotes}` : "",
    SQL_RULES(),
    LANGUAGE_RULE,
    WHATSAPP_STYLE,
    "Each message starts with TASK: and tells you exactly what to output. Follow it exactly.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

const section = (title, body) => (body ? `${title}:\n${body}` : "");

/** TASK plan: understand + write SQL in one go (JSON). */
export function planTask({ today, transcript, lastLookup, tableDetails, ranked, idHints, text }) {
  return [
    "TASK: plan",
    `Today is ${today}.`,
    section("Conversation so far", transcript),
    section("Your last database lookup", lastLookup),
    section("Columns of the tables most likely needed", tableDetails),
    section("Official names in the database similar to the message (use these spellings)", ranked),
    section("Identifier hints", idHints?.map((h) => `- ${h}`).join("\n")),
    `New message: ${text}`,
    [
      "Output JSON only:",
      '{"type":"data|chat|clarify","question":"...","sql":"...","template":"...","reply":"..."}',
      '- "data" (the usual case): the user wants facts from the database. "question" = ONE standalone question in clear English: fix spelling, expand short forms (QTA=Quetta, std=student), resolve "this/he/his/that batch/same for…" from the conversation, copy exact values (CNIC, phone, names, numbers) even from earlier messages. "sql" = the query. "template" = if the answer is ONE value (a count, a date, a name), a short reply in the user\'s language with {value} where that value goes, e.g. "There are {value} centers."; otherwise "".',
      '- "chat": greeting, thanks, small talk, questions about you. "reply" = short friendly reply.',
      '- "clarify": ONLY if you truly cannot guess what they want, even with the conversation. "reply" = one short question with 2-3 concrete options.',
      "Prefer a reasonable guess (data) over clarify.",
    ].join("\n"),
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** TASK fix: repair a failed / empty query (JSON). */
export function fixTask({ question, sql, problem, tableDetails, closeNames }) {
  return [
    "TASK: fix",
    `Question: ${question}`,
    `Previous SQL: ${sql}`,
    `Problem: ${problem}`,
    section("Similar values that exist in the database", closeNames),
    section("Columns of the relevant tables", tableDetails),
    'Write a better query. If the result was empty, broaden it: official values above, LIKE on single key words, fewer filters, or another column/table. Output JSON only: {"sql":"..."}',
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** TASK answer: turn rows into the reply (plain text). */
export function answerTask({ text, question, rowsText, rowCount, capped, closeNames }) {
  return [
    "TASK: answer",
    `User's message: ${text}`,
    `Question looked up: ${question}`,
    `Rows: ${rowCount}${capped ? ` (cut off at the ${config.db.maxRows}-row limit, more exist)` : ""}`,
    rowsText || "(no rows)",
    closeNames ? `Close names in the database: ${closeNames}` : "",
    [
      "Write the WhatsApp reply now, as plain text (not JSON):",
      "- Use ONLY these rows; never invent data. No SQL, table or column names.",
      "- Direct answer first, then short details. For a person, start with their name. Field names in plain words (std_cnic → CNIC, course → Course).",
      "- Never show id numbers (id, course_id, center_id…); show the names that are given instead. Skip empty fields.",
      "- If you used an official name that differs from the user's spelling, mention it.",
      "- No rows: say nothing matched, mention close names if any, and ask the user to check the spelling/number or add a detail.",
    ].join("\n"),
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** TASK clarify: nothing worked, ask one helpful question (plain text). */
export function clarifyTask({ text, question, names }) {
  return [
    "TASK: clarify",
    `User's message: ${text}`,
    `What you understood: ${question}`,
    names ? `Names that exist in the database: ${names}` : "",
    "You could not find this in the database. Write ONE short, friendly message (plain text) saying what you understood and asking for the missing detail, with 2-3 concrete options.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Plain conversation when the database is unavailable. */
export function chatPrompt({ dbDown = false } = {}) {
  return [
    `You are ${config.bot.name}, a friendly WhatsApp data assistant. ${config.bot.contextNote}`,
    dbDown ? "The database is temporarily unavailable. If the user asks for data, say the data service is down right now and to try again shortly." : "",
    LANGUAGE_RULE,
    WHATSAPP_STYLE,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function today() {
  return new Date().toISOString().slice(0, 10);
}
