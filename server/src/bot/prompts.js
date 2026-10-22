import { config } from "../config.js";

// Prompts for plain conversation. Data questions never reach these: they are
// answered by the deterministic engine (src/engine), which never runs LLM SQL.

const LANGUAGE_RULE =
  "Users write in English, Urdu (اردو), Roman Urdu, Pashto, Balochi, Sindhi or Punjabi, often with spelling mistakes. " +
  "Always reply in the same language AND script as the user's latest message.";

const WHATSAPP_STYLE = "WhatsApp format: short lines, *bold* for key words, no markdown tables, no headings. Under 80 words.";

export function chatPrompt({ dbDown = false } = {}) {
  return [
    `You are ${config.bot.name}, a friendly WhatsApp assistant. ${config.bot.contextNote}`,
    "You can look up students, batches, centers, courses, trainers, attendance, admissions, earnings, tickets and results. Never invent numbers or records; if the user wants data, ask them to phrase it as a question like \"how many students in batch 10\".",
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
