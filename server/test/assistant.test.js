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
  const calls = { chat: [], stream: [], sql: [] };
  const queue = [...chatReplies];
  const rowQueue = [...rows];
  __setDeps({
    getSchema: async () => schema,
    getCatalog: async () => catalog,
    lookupNameHits: async () => [],
    chat: async (messages, opts) => {
      calls.chat.push({ messages: [...messages], opts });
      return queue.shift() ?? "";
    },
    streamChat: async function* (messages) {
      calls.stream.push(messages);
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

test("greetings are answered instantly without any model call", async () => {
  const calls = setup({ chatReplies: [] });
  for (const msg of ["Hi", "hello!", "Assalam o alaikum", "How are you", "thanks", "ok"]) {
    const r = await runAssistant({ text: msg, historyKey: "g" });
    assert.ok(r.reply.length > 2, msg);
  }
  assert.equal(calls.chat.length + calls.stream.length, 0);
});

test("data question: understand -> sql -> answer (3 model calls)", async () => {
  const calls = setup({
    chatReplies: [
      JSON.stringify({ type: "data", question: "How many students are in Batch 10?", tables: ["students", "batches"] }),
      "SELECT COUNT(*) AS n FROM students s JOIN batches b ON b.id = s.batch_id WHERE b.batch_name LIKE '%10%'",
    ],
    rows: [[{ n: 1059 }]],
    answer: "*1,059* students are enrolled in Batch 10.",
  });
  const r = await runAssistant({ text: "how mny studnts in btch 10", historyKey: "d" });
  assert.equal(r.action, "sql");
  assert.equal(r.rowCount, 1);
  assert.match(r.reply, /1,059/);
  assert.equal(calls.chat.length, 2);
  assert.equal(calls.stream.length, 1);
  assert.ok(calls.chat[0].opts.json, "understand step uses JSON mode");
  assert.match(calls.chat[1].messages[0].content, /students\(id\*:int/);
  assert.match(calls.chat[1].messages[0].content, /batches\(/);
  assert.equal(getLastLookup("d").rowCount, 1);
});

test("follow-up sees the conversation and the last lookup", async () => {
  const calls = setup({
    chatReplies: [
      JSON.stringify({ type: "data", question: "Show all details of the student with CNIC 54401-6647329-0", tables: ["students"] }),
      "SELECT * FROM students WHERE REPLACE(std_cnic,'-','') = '5440166473290'",
    ],
    rows: [[{ id: 1, std_name: "Ali", std_cnic: "54401-6647329-0" }]],
    answer: "*Ali*",
  });
  await runAssistant({ text: "54401-6647329-0", historyKey: "f" });
  // SELECT * was expanded to the allowed columns instead of being rejected
  assert.match(calls.sql[0], /`std_name`/);
  assert.match(calls.chat[1].messages[0].content, /CNIC 54401-6647329-0/);

  const calls2 = setup({
    chatReplies: [
      JSON.stringify({ type: "data", question: "What is the phone number of the student with CNIC 54401-6647329-0?", tables: ["students"] }),
      "SELECT std_phone FROM students WHERE REPLACE(std_cnic,'-','') = '5440166473290'",
    ],
    rows: [[{ std_phone: "03001234567" }]],
  });
  await runAssistant({ text: "uska phone number?", historyKey: "f" });
  const sys = calls2.chat[0].messages[0].content;
  assert.match(sys, /User: 54401-6647329-0/);
  assert.match(sys, /Your last database lookup/);
  assert.match(calls2.chat[1].messages[1].content, /Previous query in this chat/);
});

test("bare CNIC is treated as a lookup even if the model says chat", async () => {
  const calls = setup({
    chatReplies: [JSON.stringify({ type: "chat", reply: "Hello" }), "SELECT std_name FROM students WHERE std_cnic = '5440166473290'"],
    rows: [[{ std_name: "Ali" }]],
  });
  const r = await runAssistant({ text: "5440166473290", historyKey: "c" });
  assert.equal(r.action, "sql");
  assert.equal(calls.sql.length, 1);
});

test("SQL errors are repaired, empty results are broadened", async () => {
  const err = Object.assign(new Error("bad"), { sqlMessage: "Unknown column 'name'" });
  const calls = setup({
    chatReplies: [
      JSON.stringify({ type: "data", question: "Which batch is currently running?", tables: ["batches"] }),
      "SELECT name FROM batches",
      "SELECT batch_name FROM batches WHERE start_date <= CURDATE() AND end_date >= CURDATE()",
      "SELECT batch_name FROM batches ORDER BY start_date DESC LIMIT 1",
    ],
    rows: [err, [], [{ batch_name: "Batch 11" }]],
    answer: "*Batch 11* is running.",
  });
  const r = await runAssistant({ text: "which batch is currently running", historyKey: "e" });
  assert.equal(r.action, "sql");
  assert.equal(calls.sql.length, 3);
  assert.match(calls.chat[2].messages.at(-1).content, /Unknown column/);
  assert.match(calls.chat[3].messages.at(-1).content, /0 rows/);
});

test("when nothing works the bot asks a clarifying question instead of erroring", async () => {
  setup({
    chatReplies: [JSON.stringify({ type: "data", question: "x", tables: [] }), "nope", "still nope", "no", "no"],
    answer: "Did you mean Batch 10 or Batch 11?",
  });
  const r = await runAssistant({ text: "the thing for btch", historyKey: "x" });
  assert.equal(r.action, "clarify");
  assert.match(r.reply, /Batch/);
});

test("clarify from the understand step is passed through", async () => {
  setup({ chatReplies: [JSON.stringify({ type: "clarify", reply: "Which batch do you mean?" })] });
  const r = await runAssistant({ text: "tell me about it", historyKey: "q" });
  assert.equal(r.action, "clarify");
  assert.equal(r.reply, "Which batch do you mean?");
});

test("progress notes show understanding but never SQL or schema", async () => {
  setup({
    chatReplies: [
      JSON.stringify({ type: "data", question: "How many students are in Batch 10?", tables: ["students"] }),
      "SELECT COUNT(*) AS n FROM students WHERE batch_id = 999",
      "SELECT COUNT(*) AS n FROM students WHERE batch_id = 10",
    ],
    rows: [[], [{ n: 5 }]],
  });
  const notes = [];
  await runAssistant({ text: "studnts btch 10", historyKey: "p", onProgress: (n) => notes.push(n) });
  assert.ok(notes[0].includes("Understood: How many students are in Batch 10?"), notes[0]);
  assert.ok(!notes[0].includes("matched"), "no redundant match note");
  assert.ok(notes.some((n) => n.includes("broader")));
  for (const n of notes) assert.doesNotMatch(n, /select|from |students\(|batch_id/i);
});

test("memory persists to disk", async () => {
  flushHistory();
  const saved = JSON.parse(fs.readFileSync(`${dir}/history.json`, "utf8"));
  assert.ok(saved.f.messages.length >= 4);
  assert.ok(getHistory("f").some((m) => /uska phone/.test(m.content)));
});
