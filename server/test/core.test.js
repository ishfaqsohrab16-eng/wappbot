import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DB_MAX_ROWS = "50";
process.env.ADMIN_NUMBERS = "03337881264";
process.env.DATA_DIR = new URL("../.test-data", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");

const { normalizePhone } = await import("../src/util/phone.js");
const { guardSql, extractSql } = await import("../src/db/sqlGuard.js");
const { createQueue } = await import("../src/llm/queue.js");
const { parseNumbersAndName } = await import("../src/bot/commands.js");
const { isAdmin } = await import("../src/store/users.js");

test("normalizePhone handles Pakistani formats", () => {
  assert.equal(normalizePhone("03337881264"), "923337881264");
  assert.equal(normalizePhone("+92 333 7881264"), "923337881264");
  assert.equal(normalizePhone("0092-333-7881264"), "923337881264");
  assert.equal(normalizePhone("923337881264@s.whatsapp.net"), "923337881264");
  assert.equal(normalizePhone("3337881264"), "923337881264");
  assert.equal(normalizePhone("+447911123456"), "447911123456");
  assert.equal(normalizePhone("abc"), null);
  assert.equal(normalizePhone("123"), null);
});

test("admin number from env is recognised", () => {
  assert.ok(isAdmin("923337881264"));
  assert.ok(!isAdmin("923001234567"));
});

test("guardSql accepts reads and adds a limit", () => {
  const r = guardSql("SELECT name, email FROM students WHERE city = 'Quetta';");
  assert.ok(r.ok, r.error);
  assert.match(r.sql, /LIMIT 50$/);
  assert.ok(guardSql("SELECT COUNT(*) AS n FROM courses").ok);
  assert.ok(guardSql("WITH x AS (SELECT id FROM t) SELECT id FROM x LIMIT 5").ok);
  assert.ok(guardSql("SELECT REPLACE(name,'a','b') AS n FROM t").ok);
  assert.ok(guardSql("SELECT title FROM t WHERE note = 'please delete; drop'").ok);
  assert.match(guardSql("SELECT id FROM t LIMIT 1000").sql, /LIMIT 50$/);
  assert.match(guardSql("SELECT id FROM t LIMIT 10, 500").sql, /LIMIT 10, 50$/);
});

test("guardSql rejects writes and risky queries", () => {
  for (const q of [
    "DELETE FROM users",
    "SELECT id FROM t; DROP TABLE t",
    "SELECT * FROM users",
    "SELECT u.* FROM users u",
    "SELECT id, password FROM users",
    "SELECT id FROM t INTO OUTFILE '/tmp/x'",
    "SELECT SLEEP(10)",
    "SELECT id FROM t -- hi",
    "SELECT table_name FROM information_schema.tables",
    "WITH x AS (SELECT 1) UPDATE t SET a = 1",
    "SELECT id FROM t FOR UPDATE",
  ]) {
    assert.equal(guardSql(q).ok, false, q);
  }
});

test("extractSql strips fences and prose", () => {
  assert.equal(extractSql("```sql\nSELECT id FROM t\n```"), "SELECT id FROM t");
  assert.equal(extractSql("Here you go: SELECT id FROM t"), "SELECT id FROM t");
});

test("parseNumbersAndName", () => {
  assert.deepEqual(parseNumbersAndName("03001234567 Ali Khan"), { numbers: ["03001234567"], name: "Ali Khan" });
  assert.deepEqual(parseNumbersAndName("0300 1234567"), { numbers: ["0300 1234567"], name: "" });
  assert.deepEqual(parseNumbersAndName("03001234567, +923011234567"), {
    numbers: ["03001234567", "+923011234567"],
    name: "",
  });
  assert.deepEqual(parseNumbersAndName("hello"), { numbers: [], name: "" });
});

test("queue limits concurrency, rejects when full, frees on abort", async () => {
  const q = createQueue({ concurrency: 1, maxQueue: 1 });
  const r1 = await q.acquire();
  const ac = new AbortController();
  const p2 = q.acquire(ac.signal);
  await assert.rejects(q.acquire(), (e) => e.code === "queue_full");
  ac.abort();
  await assert.rejects(p2, (e) => e.code === "aborted");
  const p3 = q.acquire();
  r1();
  const r3 = await p3;
  assert.deepEqual(q.stats().active, 1);
  r3();
  assert.deepEqual(q.stats().active, 0);
});
