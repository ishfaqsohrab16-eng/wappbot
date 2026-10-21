import { test } from "node:test";
import assert from "node:assert/strict";

const { expandStars, guardSql } = await import("../src/db/sqlGuard.js");
const { identifierHints, smallTalkReply, looksLikeDataQuestion } = await import("../src/bot/intent.js");
const { parseJson, chooseTables, joinTables, tablesByWords } = await import("../src/bot/context.js");
const { stripThink } = await import("../src/llm/client.js");

const tables = new Map([
  ["students", { columns: [{ name: "id", key: "PRI" }, { name: "std_name" }, { name: "std_cnic" }, { name: "batch_id" }] }],
  ["tbl_batches", { columns: [{ name: "id", key: "PRI" }, { name: "batch_name" }] }],
  ["student_fee_installments", { columns: [{ name: "id", key: "PRI" }, { name: "amount" }] }],
]);
const schema = { tables };

test("expandStars turns * into allowed columns", () => {
  const a = expandStars("SELECT * FROM students WHERE id = 1", tables);
  assert.match(a, /^SELECT `id`, `std_name`, `std_cnic`, `batch_id` FROM students/);
  assert.ok(guardSql(a).ok);
  const b = expandStars("SELECT s.*, b.batch_name FROM students s JOIN tbl_batches AS b ON b.id = s.batch_id", tables);
  assert.match(b, /`s`\.`std_cnic`/);
  assert.ok(guardSql(b).ok, guardSql(b).error);
  assert.equal(expandStars("SELECT COUNT(*) FROM students", tables), "SELECT COUNT(*) FROM students");
  assert.ok(!guardSql(expandStars("SELECT * FROM unknown_t", tables)).ok);
});

test("identifierHints for CNIC, phone, email", () => {
  const h = identifierHints("cnic 54401-6647329-0 phone 0333-7881264 a@B.com");
  assert.ok(h.some((x) => x.includes("'5440166473290'")));
  assert.ok(h.some((x) => x.includes("3337881264")));
  assert.ok(h.some((x) => x.includes("a@b.com")));
  assert.equal(identifierHints("how many students in batch 10").length, 0);
  assert.equal(identifierHints("5440166473290").filter((x) => x.startsWith("Phone")).length, 0);
});

test("smallTalkReply only for pure greetings", () => {
  assert.ok(smallTalkReply("Hi"));
  assert.ok(smallTalkReply("Assalam o Alaikum!"));
  assert.ok(smallTalkReply("السلام علیکم").includes("وعلیکم"));
  assert.ok(smallTalkReply("thank you so much"));
  assert.equal(smallTalkReply("hi how many students in batch 10"), null);
  assert.equal(smallTalkReply("which batch is running"), null);
  assert.ok(looksLikeDataQuestion("Can you tell me which batch is currently running"));
  assert.ok(!looksLikeDataQuestion("Hello"));
});

test("parseJson tolerates surrounding text", () => {
  assert.deepEqual(parseJson('Sure: {"type":"chat","reply":"hi"} done'), { type: "chat", reply: "hi" });
  assert.equal(parseJson("no json"), null);
});

test("table selection finds tables by words and join targets", () => {
  assert.deepEqual(tablesByWords(schema, "student details").slice(0, 1), ["students"]);
  assert.deepEqual(joinTables(schema, ["students"]), ["tbl_batches"]);
  const t = chooseTables(schema, { picked: ["STUDENTS"], question: "students in batch 10" });
  assert.ok(t.includes("students") && t.includes("tbl_batches"));
});

test("stripThink removes reasoning blocks", () => {
  assert.equal(stripThink("<think>hmm</think>\nSELECT 1"), "SELECT 1");
  assert.equal(stripThink("plain"), "plain");
});
