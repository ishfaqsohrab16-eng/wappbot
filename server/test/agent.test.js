// "Ask the LLM" mode: when the user names the LLM, the model picks a built-in
// query, writes its own guarded SQL, or replies — and good SQL is remembered.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const dir = new URL("../.test-data/agent", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
fs.rmSync(dir, { recursive: true, force: true });
process.env.DATA_DIR = dir;

const H = await import("./helpers/lms.js");
const { setDictionary } = await import("../src/engine/dictionary.js");
const { runAssistant, __setDeps } = await import("../src/bot/assistant.js");
const { clearResultCache } = await import("../src/engine/executor.js");
const { DICT_REAL } = await import("../src/knowledge/phrasebook.js");
const { datePlaceholders, stripAgentWords, AGENT_RE } = await import("../src/engine/agent.js");
const L = await import("../src/engine/learned.js");
setDictionary(DICT_REAL);
const schema = H.lmsSchema();

const LATE_SQL =
  "SELECT u.user_name AS trainer, ta.center_id, ta.checkin_time AS check_in, cs.cs_start_time AS class_start FROM trainer_attendance ta JOIN trainers t ON t.t_id = ta.t_id JOIN `user` u ON u.user_id = t.user_id JOIN class_schedules cs ON cs.center_id = ta.center_id AND cs.course_id = t.t_course_id WHERE ta.ta_date = {today} AND ta.checkin_time > STR_TO_DATE(cs.cs_start_time, '%h:%i %p') ORDER BY ta.checkin_time DESC LIMIT 50";

let sqlSeen = [];
function respond(sql, params) {
  sqlSeen.push(sql);
  if (/FROM trainer_attendance ta JOIN trainers/.test(sql)) return [{ trainer: "Shafi Ullah", center_id: 8, check_in: "15:22:00", class_start: "03:00 PM" }, { trainer: "Five Late", center_id: 8, check_in: "15:05:00", class_start: "03:00 PM" }];
  if (/GROUP BY s\.center_id/.test(sql)) return Array.from({ length: 30 }, (_, i) => ({ center_id: (i % 12) + 1, students: 100 + i }));
  if (/SUM\(/.test(sql)) return [{ total: 1250000, n: 2100 }];
  if (/COUNT\(/.test(sql)) return [{ n: 45 }];
  return [];
}

let llmCalls = 0;
function setup(replies = []) {
  llmCalls = 0;
  sqlSeen = [];
  clearResultCache();
  __setDeps({
    getSchema: async () => schema,
    runQuery: H.fakeDb(respond).query,
    chat: async () => {
      llmCalls++;
      const r = replies.shift();
      return r ? JSON.stringify(r) : JSON.stringify({ action: "reply", reply: "🙂" });
    },
    streamChat: async function* () {
      llmCalls++;
      yield "🙂";
    },
  });
}

let n = 0;
async function converse(turns, replies = []) {
  setup(replies);
  const key = `agent-${++n}`;
  for (const [msg, check] of turns) {
    const r = await runAssistant({ text: msg, historyKey: key });
    check?.(r.reply, r);
  }
}
const has = (re) => (reply) => assert.match(reply, re);
const hasNot = (re) => (reply) => assert.doesNotMatch(reply, re);
const both = (...f) => (reply, r) => f.forEach((x) => x(reply, r));
const calls = (k) => (_x, r) => assert.equal(r.llmCalls || 0, k, `expected ${k} LLM call(s)`);

test("mentioning the LLM lets it write its own query; dates are filled in; the query is saved", async () => {
  await converse(
    [["llm which trainers were late today compared with the class schedule", both(has(/Late trainers today/), has(/Shafi Ullah/), has(/MCKRU/), has(/AI-written query/), calls(1))]],
    [{ action: "sql", sql: LATE_SQL, title: "Late trainers today", explain: "check-in after the scheduled class start" }]
  );
  const ran = sqlSeen.find((s) => /trainer_attendance ta JOIN/.test(s));
  assert.ok(ran.includes(`'${datePlaceholders().today}'`), "placeholder replaced by today's date");
  assert.ok(!ran.includes("{today}"));
  assert.ok(L.listLearned().some((x) => x.kind === "sql" && x.status === "active"), "AI query saved");
});

test("a saved AI query answers the same question later without the LLM (when the rules are unsure)", async () => {
  const q = "zxq ustad tafteesh scorecard nikalo";
  await converse([[`llm ${q}`, calls(1)]], [{ action: "sql", sql: LATE_SQL, title: "Scorecard", explain: "custom" }]);
  await converse([[q, both(has(/Scorecard/), has(/Shafi Ullah/), calls(0))]]);
});

test("a blocked or failing query is sent back to the LLM once to fix", async () => {
  await converse(
    [["/llm list trainer passwords", both(has(/Late trainers/), calls(2))]],
    [
      { action: "sql", sql: "SELECT u.user_password FROM `user` u", title: "x" },
      { action: "sql", sql: LATE_SQL, title: "Late trainers" },
    ]
  );
  assert.ok(!sqlSeen.some((s) => /user_password/.test(s)), "sensitive column never reached the database");
});

test("two bad queries end with an honest message, not a crash", async () => {
  await converse(
    [["llm delete everything", both(has(/read-only/i), calls(0))]],
    []
  );
  await converse(
    [["llm show raw secrets", both(has(/didn't run/), calls(2))]],
    [
      { action: "sql", sql: "SELECT u.api_key FROM `user` u", title: "x" },
      { action: "sql", sql: "SELECT * FROM `user`", title: "x" },
    ]
  );
});

test("the LLM can pick a built-in query or just reply", async () => {
  await converse([["ask ai what is our total approved earning", both(has(/Total earnings \(approved\)/), calls(1))]], [{ action: "plan", op: "sum", entity: "earning" }]);
  await converse([["llm what is the weather in quetta", both(has(/🧠 Weather isn't in the LMS/), calls(1))]], [{ action: "reply", reply: "Weather isn't in the LMS data." }]);
});

test("long AI results come with an Excel file and names instead of ids", async () => {
  const sql = "SELECT s.center_id, COUNT(*) AS students FROM students s GROUP BY s.center_id ORDER BY students DESC LIMIT 200";
  setup([{ action: "sql", sql, title: "Students per center" }]);
  const r = await runAssistant({ text: "llm students per center", historyKey: "agent-x" });
  assert.match(r.reply, /Students per center/);
  assert.match(r.reply, /ITTI Pishin Stop QTA|BUITEMS|Awaran/);
  assert.ok(r.files.some((f) => f.name.endsWith(".xlsx")));
});

test("'wrong' after an AI query disables it; bare 'ask llm' re-asks the last question", async () => {
  await converse(
    [
      ["llm late trainers vs schedule today", has(/AI-written/)],
      ["wrong", has(/What did you want instead/)],
    ],
    [{ action: "sql", sql: LATE_SQL, title: "Late" }]
  );
  const x = L.listLearned().find((e) => e.kind === "sql" && e.example === "late trainers vs schedule today");
  assert.equal(x?.status, "disabled");
  await converse(
    [
      ["Give me todays late attendance trainers", calls(0)],
      ["ask llm", both(has(/Late trainers/), calls(1))],
    ],
    [{ action: "sql", sql: LATE_SQL, title: "Late trainers" }]
  );
});

test("trigger words", () => {
  for (const s of ["llm who was late", "ask ai about earnings", "use gpt", "check with chatgpt", "ai se pucho kitne students"]) assert.ok(AGENT_RE.test(s), s);
  for (const s of ["graphicsai students", "trainer late aai", "maine kaha"]) assert.ok(!AGENT_RE.test(s), s);
  assert.equal(stripAgentWords("please ask llm who was late today"), "who was late today");
  assert.equal(stripAgentWords("/llm late trainers"), "late trainers");
});
