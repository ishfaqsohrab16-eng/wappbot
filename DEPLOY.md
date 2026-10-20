# WappBot deployment guide (Easypanel)

One deploy runs everything the bot needs. You only link WhatsApp from the WappBot dashboard.
Allow about 30 minutes. Deploy outside busy hours: the first deploy downloads about 3 GB of images plus the Whisper model.

**What is in the stack** (`docker-compose.yml`, one Easypanel *Compose* service):

| Container | What it does | Reachable from outside? |
| --- | --- | --- |
| `wappbot` | Bot + React dashboard (port 3000) | **Yes**, via the domain you add |
| `wb-whisper` | Turns voice notes into text (faster-whisper, CPU) | No |
| `wb-evolution` | Evolution API v2.3.7, the WhatsApp connection | No |
| `wb-evolution-db` | Postgres for Evolution | No |
| `wb-evolution-redis` | Redis for Evolution | No |

The stack also uses two services that are **already running**:
Ollama at `http://wp_man_llm:11434` and MySQL at `digibizz_program_program_db:3306`.
Only `wappbot` joins the shared `easypanel` network to reach them. Nothing else is exposed.

---

## Step 1: Fix the database permission (5 min)

In the setup SQL, the GRANT was for `lms_imsdb`, but your settings use `lms_lmsdb`.

1. Easypanel → **digibizz_program → program_db → Console** (or phpMyAdmin/Adminer), logged in as root.
2. Run:
   ```sql
   SHOW DATABASES LIKE 'lms%';
   SHOW GRANTS FOR 'readonly_user'@'%';
   ```
3. If the grant does not name the real database, fix it (use the name `SHOW DATABASES` printed):
   ```sql
   GRANT SELECT ON lms_lmsdb.* TO 'readonly_user'@'%';
   FLUSH PRIVILEGES;
   ```
4. Use that name for `DB_NAME` in step 3.

Recommended: the DB password was shared in chat, so set a new one:
`ALTER USER 'readonly_user'@'%' IDENTIFIED BY '<new strong password>';`, then put it in `DB_PASSWORD`.

---

## Step 2: Put the code on GitHub (5 min)

1. Create a **private** GitHub repository, e.g. `wappbot`. Leave it empty.
2. In `D:\wappbot`:
   ```bash
   git init
   git add .
   git commit -m "WappBot initial version"
   git branch -M main
   git remote add origin https://github.com/<your-user>/wappbot.git
   git push -u origin main
   ```
3. On GitHub, check that **`.env` is not there**. It is in `.gitignore` because it holds your secrets.

---

## Step 3: Create the stack in Easypanel (10 min)

1. Easypanel → project **wp_man** → **+ Service → Compose**, name it `wappbot`.
2. **Source → GitHub:** pick the `wappbot` repo, branch `main`, compose file `docker-compose.yml`.
3. **Environment:** open `D:\wappbot\.env` on your PC, copy everything and paste it in.
   It already contains generated values for `ADMIN_PASSWORD`, `SESSION_SECRET`, `WEBHOOK_SECRET`,
   `EVOLUTION_API_KEY` and `EVOLUTION_DB_PASSWORD`. Check these lines:
   ```
   DB_NAME=<real database name from step 1>
   DB_PASSWORD=<new password if you changed it>
   ```
   Optional: describe your data so answers get better, e.g.
   `DB_SCHEMA_NOTES=status 1 means active; students are users with role 'student'; fees are in PKR`

   You do **not** need to set `EVOLUTION_BASE_URL`, `STT_BASE_URL` or `PUBLIC_URL`; the compose file wires them.
4. **Domains → Add Domain:** e.g. `bot.yourdomain.com`, HTTPS on, service **`wappbot`**, port **`3000`**.
   Don't add domains for the other containers.
5. Click **Deploy**. The first deploy takes 5–15 minutes: it builds the app and downloads the images.

**Check the logs** of the `wappbot` container. You should see, within a few minutes:
```
wappbot listening on :3000
Schema loaded: NN tables from lms_lmsdb
Evolution instance "digibizz" created, webhook set
Open the dashboard → WhatsApp to link a phone.
```
A few `Evolution not ready … retrying in 15s` lines at the start are normal while Postgres and Evolution boot.

The `wb-whisper` container downloads its model on first start, so voice notes work a few minutes after the rest.

---

## Step 4: Link WhatsApp from the dashboard (3 min)

1. Open `https://bot.yourdomain.com` and log in with `ADMIN_PASSWORD` (from your `.env`).
2. Go to the **WhatsApp** page.
3. Use the phone that will **be the bot**. Use a separate number, not the admin's personal number `03337881264`.
   - **QR code:** click **Show QR code**. On the bot phone open WhatsApp → **Settings → Linked devices → Link a device** and scan it.
     The code refreshes by itself.
   - **Pairing code** (if you can't scan): enter the bot's number, click **Get code**. On the phone choose
     **Link with phone number instead** and type the 8-character code.
4. The page switches to **Connected** and shows the bot's name and number. The bot is now live.

---

## Step 5: Check everything (5 min)

**Overview** page: all four cards should say **Online**:

| Card offline | Fix |
| --- | --- |
| AI model | The `llm` service in `wp_man` is stopped, or the `easypanel` network is missing (see Troubleshooting). |
| Database | Wrong DB name or grant (step 1), or a wrong `DB_HOST`. |
| Voice | `wb-whisper` is still downloading the model. Wait, then check its logs. |
| WhatsApp | Not linked yet (step 4), or the phone was logged out. |

Optional console check: Easypanel → `wappbot` container → **Console**:
```sh
wget -qO- http://wp_man_llm:11434/api/tags
```
The output must list `gpt-oss:20b`.

---

## Step 6: Test it (10 min)

1. **Test chat** page: ask "How many students are there?". Text streams in after a few seconds.
   Open **SQL** under the answer to see the query it ran.
2. From the **admin phone (03337881264)**, send these to the **bot's number**:
   - `/status` → all ✅
   - `/add 03xxxxxxxxx Test` → the test number gets a welcome message
3. From the **test number**: send a text question, then an Urdu voice note. The reply starts with 🎤 and the transcript.
4. From a number **not** on the list → it gets "not authorized" (once per day).
5. `/remove 03xxxxxxxxx` → blocked again.
6. **Activity** page lists every message, with the time taken and the query used.

---

## Updating later

`git push` your changes, then Easypanel → `wappbot` → **Deploy**. Or enable **Auto Deploy** so every push redeploys.
These survive redeploys because they are stored in volumes: the allowed numbers, the WhatsApp login and the Whisper model.
You do not need to scan the QR code again.

## Troubleshooting

| Problem | Cause / fix |
| --- | --- |
| Deploy fails with `network easypanel declared as external, but could not be found` | Your Easypanel names its network differently. Run `docker network ls` on the VPS and put that name under `networks:` at the bottom of `docker-compose.yml`. |
| AI or DB offline, logs show `ENOTFOUND wp_man_llm` | Same cause: `wappbot` is not on the shared network. See the line above. |
| WhatsApp page: "Evolution API is not reachable yet" | `wb-evolution` is still starting, or crashed. Check its logs. `EVOLUTION_DB_PASSWORD` must contain only letters and digits. |
| QR code never appears | Wait 30 s and click again. If it still fails, update `EVOLUTION_IMAGE_TAG` to a newer Evolution release (WhatsApp changes its protocol from time to time). |
| Linked, but the bot never replies | Overview → **Register webhook**. Then check Activity. If it shows `denied`, add the number with `/add`. |
| "The assistant is busy" | The queue is full. This is expected under load (one answer at a time on this CPU). |
| "I couldn't fetch that information" | Add `DB_SCHEMA_NOTES` and limit `DB_ALLOWED_TABLES` to the tables that matter. |
| Replies are slow while voice notes are processed | Whisper and the LLM share the CPU. Lower `WHISPER_CPUS`, or keep `WHISPER_MODEL=small`. |
| The phone shows the device was logged out | WhatsApp → Linked devices removed it. Link it again from the WhatsApp page. |

## Security checklist

- [ ] `.env` is not on GitHub
- [ ] Only `wappbot` has a domain. Evolution, Whisper, Postgres, Redis and Ollama have none.
- [ ] The DB user has only `SELECT` on the LMS database
- [ ] `ADMIN_PASSWORD` is strong. Login is limited to 5 attempts per minute.
