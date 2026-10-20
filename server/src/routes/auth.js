import crypto from "node:crypto";
import { config } from "../config.js";

// Stateless signed session tokens for the dashboard: base64url(payload).hmac
// Without SESSION_SECRET a random key is used, so sessions end on restart.
const KEY = config.sessionSecret || crypto.randomBytes(32).toString("hex");

const b64 = (s) => Buffer.from(s).toString("base64url");
const sign = (data) => crypto.createHmac("sha256", KEY).update(data).digest("base64url");

function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

export function checkPassword(pw) {
  if (!config.adminPassword) return false;
  // Hash both so lengths match for timingSafeEqual.
  const h = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");
  return safeEqual(h(pw), h(config.adminPassword));
}

export function issueToken(sub = "admin") {
  const payload = b64(JSON.stringify({ sub, exp: Date.now() + config.sessionTtlHours * 3600_000 }));
  return `${payload}.${sign(payload)}`;
}

export function verifyToken(token) {
  if (!token || typeof token !== "string") return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig || !safeEqual(sig, sign(payload))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString());
    return data.exp > Date.now() ? data : null;
  } catch {
    return null;
  }
}

export function requireAuth(req, res, next) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : null;
  const session = verifyToken(token);
  if (!session) return res.status(401).json({ error: "Unauthorized" });
  req.user = session;
  next();
}
