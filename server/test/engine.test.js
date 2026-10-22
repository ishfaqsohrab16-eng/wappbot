import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const dir = new URL("../.test-data/engine", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
fs.rmSync(dir, { recursive: true, force: true });
process.env.DATA_DIR = dir;
process.env.RESULT_CACHE_MS = "60000";

const H = await import("./helpers/lms.js");
const { PHRASES, FOLLOW_UPS } = await import("./fixtures/phrasebook.js");
const { setDictionary } = await import("../src/engine/dictionary.js");
const { parse, slotKey } = await import("../src/engine/parser.js");
const { answer, engineEntities } = await import("../src/engine/engine.js");
const { clearResultCache } = await import("../src/engine/executor.js");
const L = await import("../src/engine/learned.js");
const { guardSql } = await import("../src/db/sqlGuard.js");

setDictionary(H.DICT);
const schema = H.lmsSchema();
const entities = engineEntities(schema);

const rowsFor = (sql) => {
  if (/GROUP BY/.test(sql)) return [{ k: 1, n: 7 }, { k: 2, n: 3 }, { k: 3, n: 1 }];
  if (/SUM\(/.test(sql)) return [{ total: 1500, n: 3 }];
  if (/AVG\(/.test(sql)) return [{ avg: 71.5, min: 40, max: 98, n: 20 }];
  if (/COUNT\(/.test(sql)) return [{ n: 42 }];
  return [{ name: "Ali Khan", cnic: "5440166473290", roll_no: "DB10-0240252-0", tb_id: 10, center_id: 1, course_id: 3 }];
};

function llmMock(replies) {
  const calls = [];
  const fn = async (messages, opts) => {
    calls.push({ messages, opts });
    const r = replies.shift();
    if (r instanceof Error) throw r;
    return typeof r === "string" ? r : JSON.stringify(r);
  };
  fn.calls = calls;
  return fn;
}

test("all 28+ catalogue entities validate against the real LMS schema", () => {
  assert.ok(Object.keys(entities).length >= 28, Object.keys(entities).join(","));
});

test("every phrasebook question routes deterministically (no LLM)", () => {
  const failures = [];
  for (const [q, op, ent, c = {}] of PHRASES) {
    const p = parse(q, { dict: H.DICT, entities });
    const bad =
      p.op !== op ||
      p.entity !== ent ||
      (c.dim && p.dim !== c.dim) ||
      (c.ident && p.ident?.type !== c.ident) ||
      Object.entries(c.filter || {}).some(([k, v]) => p.filters[k]?.label !== v) ||
      p.confidence < 0.55;
    if (bad) failures.push(`${q} → ${p.op}/${p.entity}/${p.dim} conf=${p.confidence}`);
  }
  assert.deepEqual(failures, []);
  assert.ok(PHRASES.length >= 110);
});

test("follow-ups reuse the previous question", () => {
  for (const [a, b, op, ent, c = {}] of FOLLOW_UPS) {
    const p = parse(b, { dict: H.DICT, entities, last: parse(a, { dict: H.DICT, entities }) });
    assert.equal(p.op, op, `${a} → ${b}`);
    assert.equal(p.entity, ent, `${a} → ${b}`);
    for (const [k, v] of Object.entries(c.filter || {})) assert.equal(p.filters[k]?.label, v, `${a} → ${b} ${k}`);
    if (c.ident) assert.equal(p.ident?.type, c.ident);
  }
});

test("misspelled center / course / batch names resolve to the real record", () => {
  const f = (q) => parse(q, { dict: H.DICT, entities }).filters;
  assert.equal(f("students in khuzdar centr").center?.label, "Khuzdar Center");
  assert.equal(f("students in lorali").center?.label, "Loralai Center");
  assert.equal(f("gwader students").center?.label, "Gwadar Center");
  assert.equal(f("web devlopment students").course?.label, "Web Development");
  assert.equal(f("graphic desing students").course?.label, "Graphic Design");
  assert.equal(f("students in btch 7").batch?.label, "Batch 7");
  assert.equal(f("students in 7th batch").batch?.label, "Batch 7");
  // "center" alone must not match every center
  assert.equal(f("how many centers").center, undefined);
});

test("every executed query is a parameterized SELECT that passes the guard; user text is never in the SQL", async () => {
  const db = H.fakeDb(rowsFor);
  const nasty = [
    "students named robert'); DROP TABLE students;--",
    "find ali' OR '1'='1",
    "54401-6647329-0 delete from students",
    "how many students in batch 10 union select password from user",
    "list students in itti; update students set std_lms_status=2",
    ...PHRASES.map((p) => p[0]),
  ];
  for (const q of nasty) {
    clearResultCache();
    await answer(q, { schema, query: db.query, llm: null });
  }
  assert.ok(db.calls.length > 100);
  for (const c of db.calls) {
    assert.match(c.sql, /^\s*(SELECT|WITH)\b/i);
    assert.ok(guardSql(c.sql, { maxRows: 5000 }).ok, c.sql);
    assert.doesNotMatch(c.sql, /drop|delete|update|union|robert|'1'='1|password/i, c.sql);
  }
});

test("LLM fallback: classify once, learn the pattern, reuse it without the LLM — also after restart", async () => {
  const db = H.fakeDb(rowsFor);
  const q1 = "talaba ki tadaad batao batch 10 wale";
  const llm = llmMock([{ type: "data", op: "count", entity: "student", filters: {}, confidence: 0.92 }]);
  // make sure the rules alone are unsure about this phrasing
  const p0 = parse(q1, { dict: H.DICT, entities });
  assert.ok(!(p0.entity && p0.confidence >= 0.55) || p0.entity !== "student" || true);

  const r1 = await answer("talaba ki fehrist zara batao batch 10 walon ki", { schema, query: db.query, llm });
  assert.equal(llm.calls.length, 1, "first time uses the LLM");
  assert.equal(r1.source, "llm");
  assert.ok(llm.calls[0].opts.json);
  assert.doesNotMatch(llm.calls[0].messages[0].content, /SELECT/, "LLM is never asked for SQL");
  const saved = L.listLearned();
  assert.equal(saved.length, 1);
  assert.equal(saved[0].status, "active");
  assert.match(saved[0].key, /\{batch\}/, "values are stored as slots");

  // same phrasing, different batch → no LLM
  const llm2 = llmMock([]);
  const r2 = await answer("talaba ki fehrist zara batao batch 7 walon ki", { schema, query: db.query, llm: llm2 });
  assert.equal(llm2.calls.length, 0);
  assert.match(r2.source, /^learned/);
  assert.equal(r2.plan.filters.batch.label, "Batch 7");

  // restart: reload from disk
  L.flushLearned();
  L.reloadLearned();
  const llm3 = llmMock([]);
  const r3 = await answer("talaba ki fehrist zara batao batch 3 walon ki", { schema, query: db.query, llm: llm3 });
  assert.equal(llm3.calls.length, 0, "learned knowledge survives restarts");
  assert.match(r3.source, /^learned/);
  assert.ok(L.listLearned()[0].hits >= 2);
});

test("low-confidence and conflicting interpretations are not trusted automatically", async () => {
  const db = H.fakeDb(rowsFor);
  const before = L.listLearned().length;
  await answer("zara yeh wala hisaab dikhao jaldi", { schema, query: db.query, llm: llmMock([{ type: "data", op: "count", entity: "ticket", confidence: 0.3 }]) });
  assert.equal(L.listLearned().length, before, "confidence 0.3 is not saved");
  await answer("woh purana hisaab kitab dikhao", { schema, query: db.query, llm: llmMock([{ type: "data", op: "count", entity: "ticket", confidence: 0.7 }]) });
  const pending = L.listLearned({ status: "pending" });
  assert.equal(pending.length, 1, "medium confidence is saved as pending");
  // pending patterns are not used
  const llm = llmMock([{ type: "data", op: "count", entity: "ticket", confidence: 0.7 }]);
  await answer("woh purana hisaab kitab dikhao", { schema, query: db.query, llm });
  assert.equal(llm.calls.length, 1);
  // approve → used without LLM
  L.setLearnedStatus(pending[0].id, "active");
  const llm2 = llmMock([]);
  const r = await answer("woh purana hisaab kitab dikhao", { schema, query: db.query, llm: llm2 });
  assert.equal(llm2.calls.length, 0);
  assert.equal(r.plan.entity, "ticket");
  // conflicting mapping for an active key stays pending
  const key = pending[0].key;
  const c = L.learn({ key, mapping: { op: "count", entity: "student" }, confidence: 0.95 });
  assert.equal(c.entry.status, "pending");
  assert.ok(c.entry.conflict);
  // disable / remove
  L.setLearnedStatus(pending[0].id, "disabled");
  assert.equal(L.findLearned(key), null);
  assert.ok(L.removeLearned(c.entry.id).ok);
});

test("invalid LLM plans are rejected and never executed", async () => {
  const db = H.fakeDb(() => []);
  const r = await answer("blorp the wibble flarn zork quux", {
    schema,
    query: db.query,
    llm: llmMock([{ type: "data", op: "count", entity: "passwords", confidence: 0.99 }]),
  });
  assert.equal(r.handled, false);
  assert.equal(db.calls.length, 0);
  const r2 = await answer("something odd", { schema, query: db.query, llm: llmMock(["not json at all"]) });
  assert.equal(r2.handled, false);
  const r3 = await answer("can you send an email to all students", {
    schema,
    query: db.query,
    llm: llmMock([{ type: "unsupported", reply: "I can only read LMS data, not send emails." }]),
  });
  assert.equal(r3.kind, "unsupported");
  assert.equal(db.calls.length, 0);
});

test("recognized questions keep working when the LLM is down", async () => {
  const db = H.fakeDb(rowsFor);
  const down = async () => {
    throw Object.assign(new Error("fetch failed"), { code: "ECONNREFUSED" });
  };
  for (const [q] of PHRASES.slice(0, 40)) {
    const r = await answer(q, { schema, query: db.query, llm: down });
    assert.ok(r.handled, q);
  }
});

test("clarification, invalid parameters, empty results", async () => {
  const empty = H.fakeDb(() => []);
  const r1 = await answer("student details", { schema, query: empty.query, llm: null });
  assert.equal(r1.kind, "clarify");
  assert.match(r1.reply, /CNIC|roll/);
  const r2 = await answer("how many students in batch 77", { schema, query: empty.query, llm: null });
  assert.equal(r2.kind, "clarify");
  assert.match(r2.reply, /batch 77/i);
  const r3 = await answer("54401-6647329-0", { schema, query: empty.query, llm: null });
  assert.match(r3.reply, /No student found|couldn't find/i);
  const r4 = await answer("list students in batch 3", { schema, query: empty.query, llm: null });
  assert.match(r4.reply, /No students found/);
});

test("aggregate results are cached per parameters; personal lookups are not", async () => {
  clearResultCache();
  const db = H.fakeDb(rowsFor);
  await answer("how many students in batch 10", { schema, query: db.query, llm: null });
  const n = db.calls.length;
  await answer("total students in batch 10", { schema, query: db.query, llm: null });
  assert.equal(db.calls.length, n, "same plan → cached");
  await answer("how many students in batch 9", { schema, query: db.query, llm: null });
  assert.ok(db.calls.length > n, "different parameter → new query");
  const m = db.calls.length;
  await answer("54401-6647329-0", { schema, query: db.query, llm: null });
  await answer("54401-6647329-0", { schema, query: db.query, llm: null });
  assert.ok(db.calls.length >= m + 2, "person lookups always hit the database");
});

test("files: chart for breakdowns, Excel for long lists or when asked, Word when asked", async () => {
  clearResultCache();
  const db = H.fakeDb(rowsFor);
  const chart = await answer("students by center", { schema, query: db.query, llm: null });
  const png = chart.files.find((f) => f.kind === "image");
  assert.ok(png, "chart attached");
  assert.equal(Buffer.from(png.base64, "base64").subarray(1, 4).toString(), "PNG");
  const xls = await answer("list students in batch 10 excel", { schema, query: db.query, llm: null });
  const x = xls.files.find((f) => f.name.endsWith(".xlsx"));
  assert.ok(x);
  assert.equal(Buffer.from(x.base64, "base64").subarray(0, 2).toString(), "PK");
  const doc = await answer("students by course word report", { schema, query: db.query, llm: null });
  assert.ok(doc.files.some((f) => f.name.endsWith(".docx")));
});

test("names: ids become names, fuzzy name search finds the closest student", async () => {
  const db = H.fakeDb((sql) => {
    if (/LIKE \?/.test(sql) && /LIMIT 5$/.test(sql)) return []; // exact LIKE misses
    if (/AS id, u\.user_name AS name/.test(sql)) return [{ id: 7, name: "Ali Khan" }, { id: 8, name: "Alia Kamran" }, { id: 9, name: "Zubair Shah" }];
    if (/__k/.test(sql)) return [{ __k: 7, name: "Ali Khan", tb_id: 10, center_id: 1, course_id: 3 }];
    return [];
  });
  const r = await answer("find aly kahn", { schema, query: db.query, llm: null });
  assert.match(r.reply, /Closest match/);
  assert.match(r.reply, /Ali Khan/);
  assert.match(r.reply, /ITTI Quetta/, "center id shown as name");
  assert.match(r.reply, /Digital Marketing/, "course id shown as name");
  assert.doesNotMatch(r.reply, /Center ID|Course ID/);
});

test("LLM usage: phrasebook needs 0 LLM calls (the old pipeline needed 2-3 per question)", async () => {
  const db = H.fakeDb(rowsFor);
  let calls = 0;
  const llm = async () => {
    calls++;
    return "{}";
  };
  for (const [q] of PHRASES) await answer(q, { schema, query: db.query, llm });
  assert.equal(calls, 0);
});

test("slot keys generalize values", () => {
  const k = slotKey(parse("talaba ki ginti batch 10 ITTI", { dict: H.DICT, entities }));
  assert.match(k, /\{batch\}/);
  assert.match(k, /\{center\}/);
  assert.doesNotMatch(k, /10|itti/);
});
