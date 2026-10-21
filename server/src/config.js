import dotenv from "dotenv";
import path from "node:path";

// Local dev: read server/.env or the repo-root .env. In Docker, env vars come from Easypanel.
dotenv.config({ path: [".env", "../.env"], quiet: true });

const str = (name, def = "") => (process.env[name] ?? def).toString().trim();
const num = (name, def) => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && process.env[name] !== "" ? v : def;
};
const bool = (name, def) => {
  const v = process.env[name];
  if (v === undefined || v === "") return def;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
};
const list = (name) =>
  str(name)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

export const config = {
  port: num("PORT", 3000),
  publicUrl: str("PUBLIC_URL").replace(/\/$/, ""),
  dataDir: path.resolve(str("DATA_DIR", "./data")),
  webDist: path.resolve(str("WEB_DIST", "../web/dist")),

  // Dashboard / API auth
  adminPassword: str("ADMIN_PASSWORD"),
  sessionSecret: str("SESSION_SECRET"),
  sessionTtlHours: num("SESSION_TTL_HOURS", 24),

  // WhatsApp access control
  adminNumbers: list("ADMIN_NUMBERS"),
  defaultCountryCode: str("DEFAULT_COUNTRY_CODE", "92"),
  unauthorizedReply: str(
    "UNAUTHORIZED_REPLY",
    "Sorry, you are not authorized to use this bot. Please contact the administrator."
  ),
  allowGroups: bool("ALLOW_GROUPS", false),

  // Evolution API
  evolution: {
    baseUrl: str("EVOLUTION_BASE_URL").replace(/\/$/, ""),
    apiKey: str("EVOLUTION_API_KEY"),
    instance: str("EVOLUTION_INSTANCE"),
    webhookSecret: str("WEBHOOK_SECRET"),
    autoSetWebhook: bool("EVOLUTION_AUTO_SET_WEBHOOK", true),
  },

  // LLM: local Ollama by default (native /api/chat). Gemini optional.
  llm: {
    provider: (str("LLM_PROVIDER") || str("DEFAULT_LLM_PROVIDER") || "local").toLowerCase(),
    fallback: str("LLM_FALLBACK", "none").toLowerCase(),
    googleApiKey: str("GOOGLE_API_KEY"),
    googleModel: str("GOOGLE_LLM_MODEL") || "gemini-2.0-flash",
    googleBaseUrl: str("GOOGLE_LLM_BASE_URL", "https://generativelanguage.googleapis.com/v1beta/openai").replace(/\/$/, ""),
    googleCooldownMs: num("GOOGLE_COOLDOWN_MS", 15 * 60 * 1000),
    baseUrl: str("LLM_BASE_URL", "http://wp_man_llm:11434/v1").replace(/\/$/, ""),
    apiKey: str("LLM_API_KEY", "ollama"),
    model: str("LLM_MODEL", "qwen3:8b"),
    // Ollama context window. Its default (2-4k) silently cuts the schema off.
    numCtx: num("LLM_NUM_CTX", 8192),
    // How long Ollama keeps the model in memory (-1 = forever). Avoids slow cold loads.
    keepAlive: str("LLM_KEEP_ALIVE", "-1"),
    // Thinking makes qwen3/deepseek-r1 much slower; off by default.
    think: bool("LLM_THINK", false),
    maxTokens: num("LLM_MAX_TOKENS", 800),
    botMaxTokens: num("LLM_BOT_MAX_TOKENS", 500),
    temperature: num("LLM_TEMPERATURE", 0.2),
    reasoningEffort: str("LLM_REASONING_EFFORT", "none"),
    timeoutMs: num("LLM_TIMEOUT_MS", 120000),
    concurrency: num("LLM_CONCURRENCY", 2),
    maxQueue: num("LLM_MAX_QUEUE", 10),
    rateLimitPerMin: num("LLM_RATE_LIMIT_PER_MIN", 10),
    historyMessages: num("LLM_HISTORY_MESSAGES", 30),
    historyDays: num("LLM_HISTORY_DAYS", 30),
    maxUserChars: num("LLM_MAX_USER_CHARS", 2000),
    maxAgentSteps: num("LLM_MAX_AGENT_STEPS", 4),
  },

  // Database (read-only)
  db: {
    host: str("DB_HOST", "localhost"),
    port: num("DB_PORT", 3306),
    name: str("DB_NAME"),
    user: str("DB_USER"),
    password: str("DB_PASSWORD"),
    queryTimeoutMs: num("DB_QUERY_TIMEOUT_MS", 15000),
    maxRows: num("DB_MAX_ROWS", 50),
    allowedTables: list("DB_ALLOWED_TABLES"),
    blockedColumnsRegex: str(
      "DB_BLOCKED_COLUMNS_REGEX",
      "pass|pwd|token|secret|salt|hash|otp|api_?key|remember"
    ),
    schemaFullMaxChars: num("DB_SCHEMA_FULL_MAX_CHARS", 6000),
    schemaNotes: str("DB_SCHEMA_NOTES"),
  },

  // Speech-to-text
  stt: {
    provider: str("STT_PROVIDER", "whisper-asr"), // whisper-asr | openai | none
    baseUrl: str("STT_BASE_URL", "http://wb-whisper:9000").replace(/\/$/, ""),
    apiKey: str("STT_API_KEY"),
    model: str("STT_MODEL", "whisper-1"),
    timeoutMs: num("STT_TIMEOUT_MS", 120000),
    maxAudioSeconds: num("STT_MAX_AUDIO_SECONDS", 180),
  },

  bot: {
    name: str("BOT_NAME", "DigiBizz Assistant"),
    ackAfterMs: num("BOT_ACK_AFTER_MS", 8000),
    welcomeOnAdd: bool("BOT_WELCOME_ON_ADD", true),
    echoTranscript: bool("BOT_ECHO_TRANSCRIPT", true),
    // Send short progress notes (what the bot understood, retries). Never SQL/schema.
    showThinking: bool("BOT_SHOW_THINKING", true),
    contextNote: str("BOT_CONTEXT_NOTE", "You answer questions about an LMS (learning management system) database."),
  },
};

export function configWarnings() {
  const w = [];
  if (!config.adminPassword) w.push("ADMIN_PASSWORD is empty: dashboard login is disabled.");
  if (!config.sessionSecret || config.sessionSecret.length < 16)
    w.push("SESSION_SECRET is missing or shorter than 16 chars.");
  if (!config.adminNumbers.length) w.push("ADMIN_NUMBERS is empty: nobody can manage WhatsApp users.");
  if (!config.evolution.baseUrl || !config.evolution.apiKey || !config.evolution.instance)
    w.push("EVOLUTION_BASE_URL / EVOLUTION_API_KEY / EVOLUTION_INSTANCE not fully set: WhatsApp disabled.");
  if (!config.evolution.webhookSecret) w.push("WEBHOOK_SECRET is empty: the webhook is not protected.");
  if (!config.db.name || !config.db.user) w.push("DB_NAME / DB_USER not set: database features disabled.");
  if (config.llm.provider === "local" && config.llm.numCtx < 6144)
    w.push(`LLM_NUM_CTX=${config.llm.numCtx} is small; the schema may not fit. 8192 is recommended.`);
  if ((config.llm.provider === "google" || config.llm.provider === "auto") && !config.llm.googleApiKey)
    w.push("LLM_PROVIDER is google but GOOGLE_API_KEY is empty; falling back to local LLM.");
  return w;
}
