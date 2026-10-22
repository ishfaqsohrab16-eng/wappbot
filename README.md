# WappBot — WhatsApp data assistant

Ask your LMS database questions on WhatsApp, by text or voice, in English, Urdu, Roman Urdu or other languages.
Answers come from fixed read-only database handlers; a small self-hosted model (`qwen3:4b`, Ollama) only helps with unusual phrasings and small talk. Only numbers approved by an admin can use the bot.
A React dashboard links the WhatsApp number (QR or pairing code), manages users, shows activity and has a streaming test chat.

Everything ships as **one Docker Compose stack**: the bot, Whisper and Evolution API with its Postgres and Redis.
It talks to the Ollama and MySQL services that are already on the server.

```
┌──────────────────────────── docker-compose.yml ────────────────────────────┐
│ WhatsApp ◄──► wb-evolution (+ db, redis) ──webhook──► wappbot :3000 ◄── Browser (dashboard)
│                                                        │   └──► wb-whisper (voice → text)
└────────────────────────────────────────────────────────┼───────────────────┘
                                         "easypanel" net  ├──► Ollama  http://wp_man_llm:11434
                                                          └──► MySQL   digibizz_program_program_db (read-only)
```

## How a question is answered

1. Evolution API posts the message to `/webhook/evolution/<WEBHOOK_SECRET>`.
2. The sender must be in `ADMIN_NUMBERS` or the allowed list. Others get one polite refusal per day.
3. Voice notes are transcribed by Whisper. Short answers to voice questions also come back as a voice note.
4. Greetings and thanks get an instant reply (no AI).
5. **Data questions go to the query engine** (`server/src/engine`), in this order:
   1. learned patterns (exact, then close variants),
   2. rules: synonyms, Roman Urdu, typo correction, and fuzzy matching of batch/center/course/district names
      against the real values in the database; CNIC, roll number, phone, email and person-name lookups
      (misspelled names find the closest match); follow-ups such as "and batch 9?", "what about girls", "his attendance",
   3. only if the rules are unsure: one small AI call that **classifies** the message into a plan
      (entity + operation + filters). The AI never writes SQL. If the plan validates and runs,
      the phrasing is saved as a pattern with slots (`{batch}`, `{center}`, `{cnic}` …), so next time no AI is needed.
6. The plan runs through **fixed, parameterized, read-only SELECT handlers** (`engine/entities.js`), also checked by the SQL guard.
   Ids are shown as names (batch, center, course). Counts and breakdowns are cached for 60 s; person lookups never are.
7. Files where they help: a **chart** for breakdowns, an **Excel sheet** for long lists (or "excel/export"),
   a **Word report** on request ("word/report").

Requests to change data or send messages are refused: the bot is read-only.
`docs/query-coverage.md` maps every query in `queries.txt` to the intent that answers it (`npm run coverage`).

## WhatsApp commands

| Command | Who | What |
| --- | --- | --- |
| `/help` | everyone | Usage and examples |
| `/reset` | everyone | Forget the conversation |
| `/add 03001234567 Ali` | admin | Give access (name optional). Several: `/add 0300…, 0301…` |
| `/remove 03001234567` | admin | Remove access |
| `/list` | admin | Show allowed numbers |
| `/status` | admin | AI, database, voice and WhatsApp health |
| `/refresh` | admin | Reload the database schema and lookup values |
| `/learned [pending]` | admin | Query patterns learned from the AI |
| `/approve <id>` · `/disable <id>` · `/forget <id>` | admin | Manage a learned pattern |

Numbers can be written `03001234567`, `+92 300 1234567` or `923001234567`. Admins come from `ADMIN_NUMBERS`
(default `03337881264`) and cannot be removed from WhatsApp. Allowed users are stored in `/app/data/users.json`.

## Deploy

See **[DEPLOY.md](DEPLOY.md)** for the step-by-step Easypanel guide. In short:

1. Fix the DB grant. The setup SQL granted `lms_imsdb`, but `DB_NAME` is `lms_lmsdb`.
2. Push to GitHub. In Easypanel, create a **Compose** service from the repo and paste `.env` into Environment.
3. Add a domain for service `wappbot`, port 3000, then deploy.
4. Dashboard → **WhatsApp** → scan the QR code (or use a pairing code) with the bot's phone.

## Local development

```bash
npm run install:all
npm run dev:server   # API on :3000 (reads ./.env)
npm run dev:web      # dashboard on :5173, proxies /api to :3000
npm test             # unit tests
```

## HTTP API

| Route | Auth | Purpose |
| --- | --- | --- |
| `POST /webhook/evolution/:secret` | secret in URL | Evolution API webhook |
| `POST /api/auth/login` | password | Returns a dashboard token (5 attempts/min per IP) |
| `POST /api/chat` | Bearer | SSE stream: `status`, `token`, `done`, `error`. 503 + `Retry-After` when the queue is full, 429 when rate-limited |
| `POST /api/chat/reset` | Bearer | Clear a web chat session |
| `GET /api/chat/health` | public | Whether the model is installed (Ollama `/api/tags`) |
| `GET /api/status` | Bearer | Health of AI, DB, STT, WhatsApp + settings |
| `GET/POST /api/users`, `DELETE /api/users/:phone` | Bearer | Manage allowed numbers |
| `GET /api/activity` | Bearer | Recent WhatsApp messages (in memory) |
| `GET /api/schema`, `POST /api/schema/refresh` | Bearer | What the bot can see in the DB |
| `GET /api/whatsapp` | Bearer | Linked number and connection state |
| `POST /api/whatsapp/connect` | Bearer | Create the instance if needed; returns a QR code, or a pairing code when `{ "number" }` is sent |
| `POST /api/whatsapp/logout` | Bearer | Unlink the phone |
| `POST /api/whatsapp/webhook` | Bearer | Re-register the Evolution webhook |
| `GET /healthz` | public | Liveness |

## Environment variables

See [.env.example](.env.example) for the full list with comments. The main groups:

- **App / dashboard:** `PORT`, `PUBLIC_URL`, `DATA_DIR`, `ADMIN_PASSWORD`, `SESSION_SECRET`, `SESSION_TTL_HOURS`
- **Access:** `ADMIN_NUMBERS`, `DEFAULT_COUNTRY_CODE`, `UNAUTHORIZED_REPLY`, `ALLOW_GROUPS`
- **Evolution:** `EVOLUTION_BASE_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_INSTANCE`, `WEBHOOK_SECRET`, `EVOLUTION_AUTO_SET_WEBHOOK`,
  `EVOLUTION_DB_PASSWORD`, `EVOLUTION_IMAGE_TAG`
- **LLM:** `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`, `LLM_MAX_TOKENS`, `LLM_BOT_MAX_TOKENS`, `LLM_TEMPERATURE`,
  `LLM_REASONING_EFFORT`, `LLM_TIMEOUT_MS`, `LLM_CONCURRENCY`, `LLM_MAX_QUEUE`, `LLM_RATE_LIMIT_PER_MIN`,
  `LLM_HISTORY_MESSAGES`, `LLM_MAX_USER_CHARS`
- **Database:** `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_QUERY_TIMEOUT_MS`, `DB_MAX_ROWS`,
  `DB_ALLOWED_TABLES`, `DB_BLOCKED_COLUMNS_REGEX`, `DB_SCHEMA_NOTES`
- **Voice:** `WHISPER_MODEL`, `WHISPER_CPUS`, `WHISPER_IMAGE_TAG`, `STT_PROVIDER`, `STT_BASE_URL`, `STT_API_KEY`, `STT_MODEL`, `STT_TIMEOUT_MS`, `STT_MAX_AUDIO_SECONDS`
- **Bot:** `BOT_NAME`, `BOT_CONTEXT_NOTE`, `BOT_ACK_AFTER_MS`, `BOT_WELCOME_ON_ADD`, `BOT_ECHO_TRANSCRIPT`

## Tuning tips

- **Better answers:** put business meaning in `DB_SCHEMA_NOTES` (status codes, which table holds students, and so on),
  and limit `DB_ALLOWED_TABLES` to the tables that matter. A smaller schema means faster, more accurate SQL.
- **Speed:** recognized questions need no AI call and answer in about a second. Unknown phrasings need one
  short AI call the first time; after that they are learned.
- **Privacy:** every allowed user can ask about any table the bot can see. Hide tables with `DB_ALLOWED_TABLES`
  and columns with `DB_BLOCKED_COLUMNS_REGEX`.

## Testing checklist (on the server)

1. From the wappbot container: `wget -qO- http://wp_man_llm:11434/api/tags` lists `qwen3:4b` (pulled automatically on first start).
2. Dashboard **WhatsApp** shows Connected; **Overview** shows AI, Database, Voice and WhatsApp as Online.
3. **Test chat:** ask "students by center" (chart), "list students in batch 10" (Excel), a CNIC; each reply shows whether AI was used.
4. From the admin phone: `/status`, `/add <test number>`, then send a text and a voice note from the test number.
5. A number not on the list gets the refusal once. `/remove` it and confirm it's blocked.
6. Send 11 messages in a minute: the 11th gets the slow-down reply. Stop the `llm` service: users see "AI service unavailable" and the app keeps running.
