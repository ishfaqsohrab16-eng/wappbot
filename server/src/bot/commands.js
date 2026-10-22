import { config } from "../config.js";
import { addUser, removeUser, listUsers, isAdmin, adminNumbers } from "../store/users.js";
import { clearHistory } from "../store/history.js";
import { normalizePhone, displayPhone } from "../util/phone.js";
import { getSchema } from "../db/schema.js";
import { collectHealth } from "../health.js";
import { sendText } from "../whatsapp/evolution.js";
import { log } from "../logger.js";
import { warmEngine } from "./assistant.js";
import { listLearned, setLearnedStatus, removeLearned } from "../engine/learned.js";

const USER_HELP = () =>
  [
    `*${config.bot.name}*`,
    "Ask me anything about the data in plain language — in English, اردو, Roman Urdu or your own language. You can also send a *voice message*.",
    "",
    "Examples:",
    "• How many students enrolled this month?",
    "• Kitne courses active hain?",
    "",
    "Commands:",
    "• /help — this message",
    "• /reset — forget our conversation",
    "• /llm <question> — let the AI answer (it can write its own query); or just mention _llm_ in your message",
  ].join("\n");

const ADMIN_HELP = () =>
  [
    "",
    "*Admin commands*",
    "• /add <number> [name] — give access (e.g. /add 03001234567 Ali)",
    "• /add <n1>, <n2>, … — add several numbers",
    "• /remove <number> — remove access",
    "• /list — show allowed numbers",
    "• /status — check AI, database, voice and WhatsApp",
    "• /refresh — reload the database schema",
    "• /learn <question> — the AI works it out, answers, and I remember it (and similar phrasings)",
    "• /learn <question> = <plain question> — teach the meaning yourself",
    "• /learned [pending] — query patterns the bot learned",
    "• /approve <id> · /disable <id> · /forget <id> — manage a learned pattern",
  ].join("\n");

const PHONE_TOKEN = /^\+?[\d\s\-()]{8,}$/;

/** Split "/add 0300 1234567 Ali Khan" or "/add 0300..., 0301..." into numbers and an optional name. */
export function parseNumbersAndName(args) {
  const parts = args.split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean);
  if (parts.length > 1) {
    return { numbers: parts.map((p) => p.replace(/[^\d+]/g, "")).filter(Boolean), name: "" };
  }
  const one = parts[0] || "";
  // Number may contain spaces ("0333 7881264"); the name is the trailing non-numeric part.
  const m = one.match(/^([+\d][\d\s\-()]*\d)\s*(.*)$/);
  if (!m || !PHONE_TOKEN.test(m[1])) return { numbers: [], name: "" };
  return { numbers: [m[1]], name: m[2].trim().slice(0, 60) };
}

async function welcome(phone) {
  try {
    await sendText(phone, `👋 Hello! You now have access to *${config.bot.name}*.\n\n${USER_HELP()}`);
  } catch (err) {
    log.warn(`Welcome message to ${phone} failed:`, err.message);
  }
}

/**
 * Handle a "/command". Returns the reply text, or null if `text` is not a command.
 */
export async function handleCommand(phone, text) {
  const m = text.trim().match(/^[/!](\w+)\s*([\s\S]*)$/);
  if (!m) return null;
  const cmd = m[1].toLowerCase();
  const args = m[2].trim();
  const admin = isAdmin(phone);

  switch (cmd) {
    case "help":
    case "start":
    case "menu":
      return USER_HELP() + (admin ? `\n${ADMIN_HELP()}` : "");
    case "reset":
    case "clear":
      clearHistory(phone);
      return "🧹 Conversation cleared.";
    case "id":
    case "me":
      return `Your number: ${displayPhone(phone)}${admin ? " (admin)" : ""}`;
  }

  if (!admin) return "This command is only for admins. Send /help to see what you can do.";

  switch (cmd) {
    case "add":
    case "allow": {
      const { numbers, name } = parseNumbersAndName(args);
      if (!numbers.length) return "Usage: /add 03001234567 [name]";
      const lines = [];
      for (const n of numbers) {
        const r = addUser(n, { name: numbers.length === 1 ? name : "", addedBy: phone });
        if (!r.ok) lines.push(`❌ ${n}: ${r.error}`);
        else if (r.existed) lines.push(`ℹ️ ${displayPhone(r.user.phone)} already has access`);
        else {
          lines.push(`✅ Added ${displayPhone(r.user.phone)}${r.user.name ? ` (${r.user.name})` : ""}`);
          if (config.bot.welcomeOnAdd) welcome(r.user.phone);
        }
      }
      return lines.join("\n");
    }
    case "remove":
    case "rm":
    case "del":
    case "delete": {
      const { numbers } = parseNumbersAndName(args);
      if (!numbers.length) return "Usage: /remove 03001234567";
      return numbers
        .map((n) => {
          const r = removeUser(n);
          const p = normalizePhone(n);
          if (r.ok) clearHistory(p);
          return r.ok ? `🗑️ Removed ${displayPhone(p)}` : `❌ ${n}: ${r.error}`;
        })
        .join("\n");
    }
    case "list":
    case "users": {
      const users = listUsers();
      const admins = adminNumbers().map((a) => `• ${displayPhone(a)} (admin)`);
      const rows = users.map((u) => `• ${displayPhone(u.phone)}${u.name ? ` — ${u.name}` : ""}`);
      return [`*Allowed numbers (${users.length})*`, ...admins, ...(rows.length ? rows : ["(none yet)"])].join("\n");
    }
    case "status": {
      const h = await collectHealth();
      const icon = (ok) => (ok ? "✅" : "❌");
      return [
        "*Status*",
        `${icon(h.llm.ok)} AI: ${h.llm.ok ? `${h.llm.model} (queue ${h.llm.queue.active}/${h.llm.queue.waiting} waiting)` : h.llm.error}`,
        `${icon(h.db.ok)} Database: ${h.db.ok ? `${h.db.database}, ${h.schema.tableCount} tables` : h.db.error}`,
        `${icon(h.stt.ok)} Voice: ${h.stt.ok ? h.stt.provider : h.stt.error}`,
        `${icon(h.whatsapp.ok)} WhatsApp: ${h.whatsapp.state ?? h.whatsapp.error}`,
      ].join("\n");
    }
    case "refresh": {
      const s = await getSchema({ refresh: true });
      if (!s.error) warmEngine({ refresh: true });
      return s.error ? `❌ Schema reload failed: ${s.error}` : `🔄 Schema reloaded: ${s.tables.size} tables.`;
    }
    case "learned": {
      const status = /pending|disabled|active/.exec(args)?.[0];
      const items = listLearned({ status }).slice(-25).reverse();
      if (!items.length) return status ? `No ${status} patterns.` : "Nothing learned yet.";
      return [
        `*Learned patterns${status ? ` (${status})` : ""}* — newest first`,
        ...items.map(
          (x) =>
            `• ${x.id} [${x.status}] "${x.key}" → ${x.mapping.op}/${x.mapping.entity}${x.mapping.dim ? `/${x.mapping.dim}` : ""} · used ${x.hits}×`
        ),
      ].join("\n");
    }
    case "approve":
    case "enable":
    case "disable": {
      const r = setLearnedStatus(args.trim(), cmd === "disable" ? "disabled" : "active");
      return r.ok ? `✅ Pattern ${r.entry.id} is now ${r.entry.status}.` : `❌ ${r.error}`;
    }
    case "forget":
    case "unlearn": {
      const r = removeLearned(args.trim());
      return r.ok ? "🗑️ Pattern removed." : `❌ ${r.error}`;
    }
    default:
      return `Unknown command /${cmd}. Send /help.`;
  }
}
