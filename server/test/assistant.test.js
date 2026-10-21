import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const dir = new URL("../.test-data/assistant", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
fs.rmSync(dir, { recursive: true, force: true });
process.env.DATA_DIR = dir;
process.env.DB_MAX_ROWS = "50";

const { runAssistant, __setDeps } = await import("../src/bot/assistant.js");
const { getHistory, getLastLookup, flushHistory } = await import("../src/store/history.js");

const schema = {
  loadedAt: "t",
  tables: new Map([
    [
      "students",
      {
        rows: 5000,
        columns: [
          { name: "id", type: "int", key: "PRI" },
          { name: "std_name", type: "varchar" },
          { name: "std_cnic", type: "varchar" },
          { name: "std_phone", type: "varchar" },
          { name: "batch_id", type: "int" },
        ],
      },
    ],
    [
      "batches",
      {
        rows: 12,
        columns: [
          { name: "id", type: "int", key: "PRI" },
          { name: "batch_name", type: "varchar" },
          { name: "start_date", type: "date" },
          { name: "end_date", type: "date" },
        ],
      },
    ],
  ]),
};
const catalog = { groups: [{ table: "batches", column: "batch_name", values: ["Batch 9", "Batch 10", "Batch 11"] }], text: "" };

function setup({ chatReplies, rows = [], answer = "ok" }) {
  const calls = { chat: [], stream: [], sql: [], systems: new Set() };
  const queue = [...chatReplies];
  const rowQueue = [...rows];
  __setDeps({
    getSchema: async () => schema,
    getCatalog: async () => catalog,
    lookupNameHits: async () => [],
    chat: async (messages, opts) => {
      calls.chat.push({ messages: [...messages], opts });
      calls.systems.add(messages[0].content);
      const r = queue.shift() ?? "";
      return typeof r === "string" ? r : JSON.stringify(r);
    },
    streamChat: async function* (messages) {
      calls.stream.push(messages);
      calls.systems.add(messages[0].content);
      yield answer;
    },
    runQuery: async (sql) => {
      calls.sql.push(sql);
      const r = rowQueue.shift();
      if (r instanceof Error) throw r;
      return { rows: r ?? [] };
    },
  });
  return calls;
}

const userOf = (call) => call.messages.at(-1).content;

test("greetings are answered instantly without any model call", async () => {
  const calls = setup({ chatReplies: [] });
  for (const msg of ["Hi", "hello!", "Assalam o alaikum", "How are you", "thanks", "ok"]) {
    const r = await runAssistant({ text: msg, historyKey: "g" });
    assert.ok(r.reply.length > 2, msg);
  }
  assert.equal(calls.chat.length + calls.stream.length, 0);
});

test("count question: ONE model call, answer from the template", async () => {
  const calls = setup({
    chatReplies: [
      {
        type: "data",
        question: "How many centers are there?",
        sql: "SELECT COUNT(*) AS n FROM batches",
        template: "There are {value} centers in the system.",
      },
    ],
    rows: [[{ n: 1059 }]],
  });
  const r = await runAssistant({ text: "how many center we have", historyKey: "d" });
  assert.equal(r.action, "sql");
  assert.equal(r.reply, "There are *1,059* centers in the system.");
  assert.equal(calls.chat.length, 1);
  assert.equal(calls.stream.length, 0);
  assert.ok(calls.chat[0].opts.json);
  assert.match(calls.chat[0].messages[0].content, /students\(id\*:int/, "schema is in the cached system prompt");
  assert.equal(getLastLookup("d").rowCount, 1);
});

test("list/details answers use the same cached system prompt", async () => {
  const calls = setup({
    chatReplies: [
      { type: "data", question: "Show all details of the student with CNIC 54401-6647329-0", sql: "SELECT * FROM students WHERE REPLACE(std_cnic,'-','') = '5440166473290'", template: "" },
    ],
    rows: [[{ id: 1, std_name: "Ali", std_cnic: "54401-6647329-0" }]],
    answer: "*Ali*",
  });
  await runAssistant({ text: "54401-6647329-0", historyKey: "f" });
  assert.match(calls.sql[0], /`std_name`/, "SELECT * expanded to allowed columns");
  assert.match(userOf(calls.chat[0]), /CNIC 54401-6647329-0/);
  assert.equal(calls.stream.length, 1);
  assert.equal(calls.systems.size, 1, "every call shares one system prompt");

  const calls2 = setup({
    chatReplies: [
      { type: "data", question: "Phone of student with CNIC 54401-6647329-0?", sql: "SELECT std_phone FROM students WHERE REPLACE(std_cnic,'-','') = '5440166473290'", template: "The phone number is {value}." },
    ],
    rows: [[{ std_phone: "03001234567" }]],
  });
  const r = await runAssistant({ text: "uska phone number?", historyKey: "f" });
  assert.match(userOf(calls2.chat[0]), /User: 54401-6647329-0/);
  assert.match(userOf(calls2.chat[0]), /Your last database lookup/);
  assert.equal(r.reply, "The phone number is *03001234567*.");
});

test("bare CNIC is treated as a lookup even if the model says chat", async () => {
  const calls = setup({
    chatReplies: [{ type: "chat", reply: "Hello", sql: "SELECT std_name FROM students WHERE std_cnic = '5440166473290'" }],
    rows: [[{ std_name: "Ali" }]],
  });
  const r = await runAssistant({ text: "5440166473290", historyKey: "c" });
  assert.equal(r.action, "sql");
  assert.equal(calls.sql.length, 1);
});

test("SQL errors are repaired, empty and zero results are broadened", async () => {
  const err = Object.assign(new Error("bad"), { sqlMessage: "Unknown column 'name'" });
  const calls = setup({
    chatReplies: [
      { type: "data", question: "Which batch is currently running?", sql: "SELECT name FROM batches" },
      { sql: "SELECT batch_name FROM batches WHERE start_date <= CURDATE() AND end_date >= CURDATE()" },
      { sql: "SELECT batch_name FROM batches ORDER BY start_date DESC LIMIT 1" },
    ],
    rows: [err, [], [{ batch_name: "Batch 11" }]],
    answer: "*Batch 11* is running.",
  });
  const r = await runAssistant({ text: "which batch is currently running", historyKey: "e" });
  assert.equal(r.action, "sql");
  assert.equal(calls.sql.length, 3);
  assert.match(userOf(calls.chat[1]), /Unknown column/);
  assert.match(userOf(calls.chat[1]), /batches\(/, "fix step gets the table columns");
  assert.match(userOf(calls.chat[2]), /0 rows/);
  assert.equal(calls.systems.size, 1);

  const calls2 = setup({
    chatReplies: [
      { type: "data", question: "How many students in Batch 10?", sql: "SELECT COUNT(*) AS n FROM students WHERE batch_id = 999", template: "{value} students." },
      { sql: "SELECT COUNT(*) AS n FROM students WHERE batch_id = 10" },
    ],
    rows: [[{ n: 0 }], [{ n: 7 }]],
  });
  const r2 = await runAssistant({ text: "students btch 10", historyKey: "z" });
  assert.equal(calls2.sql.length, 2, "a 0 count is re-checked once");
  assert.equal(r2.reply, "*7* students.");
});

test("when nothing works the bot asks a clarifying question instead of erroring", async () => {
  setup({
    chatReplies: [{ type: "data", question: "x", sql: "nope" }, "still nope", "no", "no"],
    answer: "Did you mean Batch 10 or Batch 11?",
  });
  const r = await runAssistant({ text: "the thing for btch", historyKey: "x" });
  assert.equal(r.action, "clarify");
  assert.match(r.reply, /Batch/);
});

test("chat and clarify replies come straight from the plan call", async () => {
  let calls = setup({ chatReplies: [{ type: "clarify", reply: "Which batch do you mean?" }] });
  let r = await runAssistant({ text: "tell me about it", historyKey: "q" });
  assert.equal(r.action, "clarify");
  assert.equal(r.reply, "Which batch do you mean?");
  assert.equal(calls.chat.length, 1);
  calls = setup({ chatReplies: [{ type: "chat", reply: "I can answer questions about students, batches and centers." }] });
  r = await runAssistant({ text: "what can you do for me", historyKey: "q" });
  assert.equal(r.action, "reply");
  assert.equal(calls.chat.length + calls.stream.length, 1);
});

test("progress notes show understanding but never SQL or schema", async () => {
  setup({
    chatReplies: [
      { type: "data", question: "How many students are in Batch 10?", sql: "SELECT std_name FROM students WHERE batch_id = 999" },
      { sql: "SELECT std_name FROM students WHERE batch_id = 10" },
    ],
    rows: [[], [{ std_name: "Ali" }]],
  });
  const notes = [];
  await runAssistant({ text: "studnts btch 10", historyKey: "p", onProgress: (n) => notes.push(n) });
  assert.ok(notes[0].startsWith("🔎 _How many students are in Batch 10?_"), notes[0]);
  assert.ok(notes.some((n) => n.includes("broader")));
  for (const n of notes) assert.doesNotMatch(n, /select|from |students\(|batch_id/i);
});

test("memory persists to disk", async () => {
  flushHistory();
  const saved = JSON.parse(fs.readFileSync(`${dir}/history.json`, "utf8"));
  assert.ok(saved.f.messages.length >= 4);
  assert.ok(getHistory("f").some((m) => /uska phone/.test(m.content)));
});
