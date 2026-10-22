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
  // "Today", class times and check-ins are Pakistan wall-clock time; the container runs on UTC.
  timezone: str("APP_TIMEZONE", "Asia/Karachi"),
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
    // qwen3:4b is ~2x faster than 8b on CPU and enough for routing + chat.
    model: str("LLM_MODEL", "qwen3:4b"),
    // Pull the model into Ollama on startup if it is missing.
    autoPull: bool("LLM_AUTO_PULL", true),
    // Ollama context window. Its default (2-4k) silently cuts the schema off.
    numCtx: num("LLM_NUM_CTX", 4096),
    // How long Ollama keeps the model in memory (-1 = forever). Avoids slow cold loads.
    keepAlive: str("LLM_KEEP_ALIVE", "-1"),
    // Thinking makes qwen3/deepseek-r1 much slower; off by default.
    think: bool("LLM_THINK", false),
    maxTokens: num("LLM_MAX_TOKENS", 800),
    botMaxTokens: num("LLM_BOT_MAX_TOKENS", 500),
    temperature: num("LLM_TEMPERATURE", 0.2),
    reasoningEffort: str("LLM_REASONING_EFFORT", "none"),
    timeoutMs: num("LLM_TIMEOUT_MS", 300000),
    concurrency: num("LLM_CONCURRENCY", 2),
    maxQueue: num("LLM_MAX_QUEUE", 10),
    rateLimitPerMin: num("LLM_RATE_LIMIT_PER_MIN", 10),
    historyMessages: num("LLM_HISTORY_MESSAGES", 30),
    historyDays: num("LLM_HISTORY_DAYS", 30),
    maxUserChars: num("LLM_MAX_USER_CHARS", 2000),
    maxAgentSteps: num("LLM_MAX_AGENT_STEPS", 4),
  },

  // Deterministic query engine (approved read-only handlers, learned patterns)
  engine: {
    // LLM only classifies unknown questions into a plan; it never writes SQL.
    llmFallback: bool("ENGINE_LLM_FALLBACK", true),
    // When a user names the LLM ("llm …", /llm), it may write its own read-only SELECT
    // (guarded by sqlGuard, row-capped, read-only DB user). Off: built-in queries only.
    allowLlmSql: bool("ALLOW_LLM_SQL", true),
    learnMinConfidence: num("LEARN_MIN_CONFIDENCE", 0.6),
    learnActiveConfidence: num("LEARN_ACTIVE_CONFIDENCE", 0.8),
    resultCacheMs: num("RESULT_CACHE_MS", 60000),
    exportMaxRows: num("EXPORT_MAX_ROWS", 5000),
    autoExcel: bool("AUTO_EXCEL", true),
    autoChart: bool("AUTO_CHART", true),
    // Minutes of slack before a check-in counts as late / a check-out as early (0 = strict, like the LMS dashboard).
    lateGraceMin: num("TRAINER_LATE_GRACE_MIN", 0),
  },

  // Text-to-speech for voice replies (OpenAI-compatible /v1/audio/speech, e.g. Kokoro)
  tts: {
    baseUrl: str("TTS_BASE_URL").replace(/\/$/, ""),
    apiKey: str("TTS_API_KEY", "none"),
    model: str("TTS_MODEL", "kokoro"),
    voice: str("TTS_VOICE", "af_heart"),
    maxChars: num("TTS_MAX_CHARS", 350),
    timeoutMs: num("TTS_TIMEOUT_MS", 60000),
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
    ignoreTablesRegex: str(
      "DB_IGNORE_TABLES_REGEX",
      "^(migrations|password_resets?|password_reset_tokens|failed_jobs|jobs|job_batches|sessions|cache|cache_locks|personal_access_tokens|telescope_.*|oauth_.*|pulse_.*)$"
    ),
  },

  // Speech-to-text
  stt: {
    provider: str("STT_PROVIDER", "whisper-asr"), // whisper-asr | openai | none
    baseUrl: str("STT_BASE_URL", "http://wb-whisper:9000").replace(/\/$/, ""),
    apiKey: str("STT_API_KEY"),
    model: str("STT_MODEL", "whisper-1"),
    timeoutMs: num("STT_TIMEOUT_MS", 120000),
    maxAudioSeconds: num("STT_MAX_AUDIO_SECONDS", 180),
    // Force a language ("ur", "en") or leave empty to auto-detect. Hindi detections are redone as Urdu.
    language: str("STT_LANGUAGE"),
    // Domain words that help Whisper spell names and terms correctly.
    prompt: str("STT_PROMPT", "DigiBizz LMS: students, trainers, attendance, batch, center, course, earnings, ITTI, BUITEMS, MCKRU, Quetta, Sibi, AWE, GraphicsAI, Digital Marketing. طلبہ، ٹرینرز، حاضری، بیچ، سینٹر، کورس"),
  },

  bot: {
    name: str("BOT_NAME", "DigiBizz Assistant"),
    ackAfterMs: num("BOT_ACK_AFTER_MS", 8000),
    welcomeOnAdd: bool("BOT_WELCOME_ON_ADD", true),
    echoTranscript: bool("BOT_ECHO_TRANSCRIPT", true),
    // Send short progress notes (what the bot understood, retries). Never SQL/schema.
    showThinking: bool("BOT_SHOW_THINKING", true),
    // Reply to voice notes with a voice note when the answer is short
    voiceReplies: bool("BOT_VOICE_REPLIES", true),
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
  if ((config.llm.provider === "google" || config.llm.provider === "auto") && !config.llm.googleApiKey)
    w.push("LLM_PROVIDER is google but GOOGLE_API_KEY is empty; falling back to local LLM.");
  return w;
}
