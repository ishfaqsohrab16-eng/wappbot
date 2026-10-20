import mysql from "mysql2/promise";
import { config } from "../config.js";
import { log } from "../logger.js";

let pool = null;

export function dbEnabled() {
  return Boolean(config.db.name && config.db.user);
}

export function getPool() {
  if (!dbEnabled()) throw new Error("Database is not configured");
  if (!pool) {
    pool = mysql.createPool({
      host: config.db.host,
      port: config.db.port,
      database: config.db.name,
      user: config.db.user,
      password: config.db.password,
      connectionLimit: 3,
      waitForConnections: true,
      queueLimit: 20,
      connectTimeout: 10_000,
      dateStrings: true,
      supportBigNumbers: true,
      bigNumberStrings: true,
      multipleStatements: false,
      charset: "utf8mb4",
    });
    // Belt and braces on top of the SELECT-only grant. Errors are ignored
    // because MySQL and MariaDB support different variables.
    pool.on("connection", (conn) => {
      const raw = conn.connection ?? conn;
      const secs = Math.ceil(config.db.queryTimeoutMs / 1000);
      raw.query("SET SESSION TRANSACTION READ ONLY", () => {});
      raw.query(`SET SESSION MAX_EXECUTION_TIME = ${config.db.queryTimeoutMs}`, () => {});
      raw.query(`SET SESSION max_statement_time = ${secs}`, () => {});
    });
  }
  return pool;
}

/** Run a read-only query with a client-side timeout. */
export async function runQuery(sql, params = []) {
  const [rows, fields] = await getPool().query({ sql, timeout: config.db.queryTimeoutMs }, params);
  return { rows: Array.isArray(rows) ? rows : [], columns: (fields || []).map((f) => f.name) };
}

export async function dbHealth() {
  if (!dbEnabled()) return { ok: false, error: "Not configured" };
  const started = Date.now();
  try {
    await runQuery("SELECT 1 AS ok");
    return { ok: true, database: config.db.name, latencyMs: Date.now() - started };
  } catch (err) {
    log.warn("DB health check failed:", err.code || err.message);
    return { ok: false, database: config.db.name, error: err.code || "Connection failed" };
  }
}

export async function closePool() {
  if (pool) await pool.end().catch(() => {});
  pool = null;
}
