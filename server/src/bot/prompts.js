import { config } from "../config.js";

// Prompts are kept short and stable so Ollama can reuse the cached prefix.
// Anything that changes per request (date, language, question) goes last.

const LANGUAGE_RULE =
  "Users write in English, Urdu (اردو), Roman Urdu, Pashto, Balochi, Sindhi, Punjabi or other languages. " +
  "Always reply in the same language AND script the user used. If they use Roman Urdu, reply in Roman Urdu.";

const WHATSAPP_STYLE =
  "Format for WhatsApp: short paragraphs, *bold* for key values, '•' bullets for lists, no markdown tables, no headings, no code blocks. " +
  "Keep replies under 150 words unless the user asks for a full list.";

function header() {
  return `You are ${config.bot.name}, a helpful WhatsApp assistant. ${config.bot.contextNote}`;
}

function sqlRules() {
  return [
    "SQL rules:",
    "- Exactly one MySQL SELECT (or WITH ... SELECT) statement. Never modify data.",
    "- Use only tables and columns listed in the schema. Never use SELECT *; name the columns.",
    `- Return at most ${config.db.maxRows} rows (add LIMIT). Use COUNT/SUM/AVG with GROUP BY for totals.`,
    "- Match names and text with LIKE '%...%'. Use CURDATE()/NOW() for relative dates.",
    "- Prefer human-readable columns (names, titles, dates) over raw ids; JOIN to get them.",
    "- No comments, no semicolons.",
  ].join("\n");
}

function schemaBlock(schemaText) {
  const notes = config.db.schemaNotes ? `\nNotes about the data: ${config.db.schemaNotes}` : "";
  return `Database schema, one table per line as table(column:type), * marks the primary key:\n${schemaText}${notes}`;
}

/** Full-schema planner: decides reply vs SQL in one call. */
export function plannerPrompt(schemaText) {
  return [
    header(),
    "You have read-only access to a MySQL database.",
    schemaBlock(schemaText),
    sqlRules(),
    LANGUAGE_RULE,
    "Decide how to answer the user's latest message. Answer in exactly one of these two formats and nothing else:",
    "ACTION: sql\n<the SQL query>",
    "or, when no database data is needed (greetings, thanks, help, general questions):",
    "ACTION: reply\n<your reply to the user>",
    "If a question needs data, always choose sql. Never invent data.",
    WHATSAPP_STYLE,
  ].join("\n\n");
}

/** Two-step mode, step 1: choose tables from names only. */
export function tablePickerPrompt(tableNames) {
  return [
    header(),
    "You have read-only access to a MySQL database with these tables:",
    tableNames,
    config.db.schemaNotes ? `Notes about the data: ${config.db.schemaNotes}` : "",
    LANGUAGE_RULE,
    "Decide how to answer the user's latest message. Answer in exactly one of these two formats and nothing else:",
    "ACTION: tables\n<comma-separated list of up to 6 table names needed to answer>",
    "or, when no database data is needed (greetings, thanks, help, general questions):",
    "ACTION: reply\n<your reply to the user>",
    "If a question needs data, always choose tables. Never invent data.",
    WHATSAPP_STYLE,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Two-step mode, step 2: write SQL for the chosen tables. */
export function sqlWriterPrompt(schemaText) {
  return [
    header(),
    schemaBlock(schemaText),
    sqlRules(),
    "Write one SQL query that answers the user's latest message. Output only:",
    "ACTION: sql\n<the SQL query>",
  ].join("\n\n");
}

/** Turn query results into the final answer. */
export function answerPrompt() {
  return [
    header(),
    "You receive the user's question and the result of a database query that was run for it.",
    "Answer the question using ONLY these results. Do not invent records. Do not show SQL, table or column names unless asked.",
    "If there are no rows, say politely that no matching records were found and suggest how to rephrase.",
    "If the results were cut off at the row limit, say that more records exist.",
    LANGUAGE_RULE,
    WHATSAPP_STYLE,
  ].join("\n\n");
}

export function contextLine({ language } = {}) {
  const today = new Date().toISOString().slice(0, 10);
  return `[Today is ${today}.${language ? ` Detected language: ${language}.` : ""}]`;
}
