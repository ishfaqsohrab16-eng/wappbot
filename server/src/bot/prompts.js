import { config } from "../config.js";

const LANGUAGE_RULE =
  "Users write in English, Urdu (اردو), Roman Urdu, Pashto, Balochi, Sindhi or Punjabi, often with spelling mistakes. " +
  "Reply in the same language AND script as the user's latest message (Roman Urdu → Roman Urdu, English → English).";

const WHATSAPP_STYLE =
  "Format for WhatsApp: short lines, *bold* for key values, '•' bullets for lists, no markdown tables, no headings, no code blocks. " +
  "Keep it under 120 words unless the user asked for a list or full details.";

function header() {
  return `You are ${config.bot.name}, a smart and friendly WhatsApp data assistant. ${config.bot.contextNote}`;
}

function notes() {
  return config.db.schemaNotes ? `Notes about the data: ${config.db.schemaNotes}` : "";
}

/**
 * Step 1 (JSON): understand the message in the light of the conversation.
 * Decides chat / clarify / data, rewrites follow-ups into a standalone question
 * and picks the tables.
 */
export function understandPrompt({ tableList, ranked, lastLookup, transcript }) {
  return [
    header(),
    `Database tables:\n${tableList}`,
    notes(),
    ranked ? `Official names in the database that look similar to words in the message:\n${ranked}` : "",
    lastLookup ? `Your last database lookup in this chat:\n${lastLookup}` : "",
    transcript ? `Conversation so far (oldest first):\n${transcript}` : "",
    [
      "Classify the user's NEW message and output JSON only, no other text:",
      '{"type":"data|chat|clarify","question":"...","tables":["..."],"reply":"..."}',
      "",
      '- "data": the user wants facts from the database (counts, lists, details, status, dates, who/which). This is the usual case.',
      '  "question": rewrite it as ONE complete, standalone question in clear English. Fix spelling mistakes and voice-typing errors, expand short forms (QTA=Quetta, std=student),',
      '  use official names from the list above when they fit, and resolve references such as "this cnic", "he", "his phone", "that batch", "same for batch 11", "and Karachi?" using the conversation and the last lookup.',
      "  Copy exact values (CNIC, phone, names, numbers) the user gave, even if they were in an earlier message.",
      '  "tables": up to 8 table names from the list that are needed, including lookup tables needed for joins.',
      '- "chat": greetings, thanks, small talk, questions about you or what you can do. "reply": a short friendly reply.',
      '- "clarify": ONLY if you truly cannot guess what data they want, even with the conversation. "reply": one short question that asks for the missing detail and suggests 2-3 concrete options.',
      "Prefer a reasonable guess (type data) over clarify. If the message only adds a detail to the previous question, combine both into the new question.",
      LANGUAGE_RULE,
    ].join("\n"),
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Step 2: write one SELECT. */
export function sqlPrompt({ schemaText, ranked, idHints }) {
  return [
    "You are an expert MySQL analyst. Write ONE read-only query that answers the question.",
    `Schema, one table per line as table(column:type), * marks the primary key:\n${schemaText}`,
    notes(),
    ranked ? `Official values in the database similar to words in the question (use these exact spellings):\n${ranked}` : "",
    idHints?.length ? `Identifier hints:\n${idHints.map((h) => `- ${h}`).join("\n")}` : "",
    [
      "Rules:",
      "- One MySQL SELECT (or WITH … SELECT). Use only tables and columns from the schema. No comments, no semicolon.",
      `- At most ${config.db.maxRows} rows (add LIMIT). For "how many" use COUNT(*) or COUNT(DISTINCT …).`,
      "- Text matching must be forgiving: use LIKE '%word%' on each important word, combined with AND, never one long exact string. Example: name LIKE '%itti%' AND name LIKE '%quetta%'.",
      "- Numbers in names: 'batch 10' may be stored as 'Batch 10', 'Batch-10', 'B10' or just 10 in a number column. Use (col LIKE '%10%') or the number column, and avoid matching 100 or 110 by mistake when possible (e.g. col REGEXP '[^0-9]10$|^10$|[^0-9]10[^0-9]').",
      "- For full details of a record, select every column of that table and JOIN lookup tables to show names instead of ids.",
      "- Prefer readable columns (names, titles, dates) and give computed columns clear aliases.",
      "- 'Current' / 'running' / 'active' means: a status column if one exists, otherwise start date <= CURDATE() AND (end date >= CURDATE() OR end date IS NULL). 'Latest' means ORDER BY the date or id DESC LIMIT 1.",
      "- Use CURDATE()/NOW() for relative dates.",
      "Output only the SQL.",
    ].join("\n"),
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Step 3: turn rows into the WhatsApp answer. */
export function answerPrompt() {
  return [
    header(),
    "You get the user's message, the question you looked up and the database rows. Write the reply to the user.",
    [
      "- Use ONLY the rows. Never invent records or numbers. Do not mention SQL, tables or column names.",
      "- Start with the direct answer (the number / the name / yes-no), then short supporting details.",
      "- Show field names in plain words (std_cnic → CNIC, created_at → Created). Skip empty/null fields and internal ids.",
      "- If you used an official name that differs from the user's spelling, mention it, e.g. 'For *ITTI Quetta*: …'.",
      "- If there are no rows: say no matching record was found, mention close names if given, and ask the user to check the spelling/number or give one more detail.",
      "- If the rows were cut off at the limit, say more records exist.",
    ].join("\n"),
    LANGUAGE_RULE,
    WHATSAPP_STYLE,
  ].join("\n\n");
}

/** Used when no query worked: ask the user one helpful follow-up question. */
export function clarifyPrompt() {
  return [
    header(),
    "You tried to look this up in the database but could not find a way to answer it.",
    "Write ONE short, friendly message that says what you understood and asks the user for the missing detail. Suggest 2-3 concrete options of what they could mean, using the hints given.",
    LANGUAGE_RULE,
    WHATSAPP_STYLE,
  ].join("\n\n");
}

/** Plain conversation without the database. */
export function chatPrompt({ dbDown = false } = {}) {
  return [
    header(),
    "Reply naturally and briefly. You can answer questions about the LMS data (students, batches, courses, centers, enrollments, etc.).",
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
