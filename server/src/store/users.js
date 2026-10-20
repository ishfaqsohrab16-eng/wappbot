import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import { normalizePhone } from "../util/phone.js";
import { log } from "../logger.js";

// Allowed WhatsApp users, persisted as JSON on the data volume.
const file = path.join(config.dataDir, "users.json");
let users = new Map(); // phone -> { phone, name, addedBy, addedAt, lastSeenAt, messageCount }

const adminSet = new Set(config.adminNumbers.map((n) => normalizePhone(n)).filter(Boolean));

function load() {
  try {
    fs.mkdirSync(config.dataDir, { recursive: true });
    if (!fs.existsSync(file)) return;
    const arr = JSON.parse(fs.readFileSync(file, "utf8"));
    users = new Map(arr.map((u) => [u.phone, u]));
    log.info(`Loaded ${users.size} allowed users`);
  } catch (err) {
    log.error("Could not read users.json:", err.message);
  }
}

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify([...users.values()], null, 2));
      fs.renameSync(tmp, file);
    } catch (err) {
      log.error("Could not write users.json:", err.message);
    }
  }, 200);
}

export function flushUsers() {
  if (!saveTimer) return;
  clearTimeout(saveTimer);
  saveTimer = null;
  try {
    fs.writeFileSync(file, JSON.stringify([...users.values()], null, 2));
  } catch (err) {
    log.error("Could not write users.json:", err.message);
  }
}

load();

export const isAdmin = (phone) => adminSet.has(phone);
export const isAllowed = (phone) => isAdmin(phone) || users.has(phone);
export const adminNumbers = () => [...adminSet];

export function listUsers() {
  return [...users.values()].sort((a, b) => a.addedAt.localeCompare(b.addedAt));
}

/** Returns { ok, user, existed, error }. */
export function addUser(input, { name = "", addedBy = "dashboard" } = {}) {
  const phone = normalizePhone(input);
  if (!phone) return { ok: false, error: "Invalid phone number" };
  const existing = users.get(phone);
  if (existing) {
    if (name && name !== existing.name) {
      existing.name = name;
      save();
    }
    return { ok: true, user: existing, existed: true };
  }
  const user = { phone, name: name || "", addedBy, addedAt: new Date().toISOString(), lastSeenAt: null, messageCount: 0 };
  users.set(phone, user);
  save();
  return { ok: true, user, existed: false };
}

export function removeUser(input) {
  const phone = normalizePhone(input);
  if (!phone) return { ok: false, error: "Invalid phone number" };
  if (isAdmin(phone)) return { ok: false, error: "Admin numbers are set in ADMIN_NUMBERS and cannot be removed here" };
  const existed = users.delete(phone);
  if (existed) save();
  return { ok: existed, phone, error: existed ? undefined : "Number is not in the list" };
}

export function touchUser(phone, name) {
  const u = users.get(phone);
  if (!u) return;
  u.lastSeenAt = new Date().toISOString();
  u.messageCount = (u.messageCount || 0) + 1;
  if (name && !u.name) u.name = name;
  save();
}
