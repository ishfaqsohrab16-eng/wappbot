import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const dir = new URL("../.test-data/assistant", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
fs.rmSync(dir, { recursive: true, force: true });
process.env.DATA_DIR = dir;

const H = await import("./helpers/lms.js");
const { setDictionary } = await import("../src/engine/dictionary.js");
const { runAssistant, __setDeps } = await import("../src/bot/assistant.js");
const { getHistory, getLastLookup, flushHistory } = await import("../src/store/history.js");

setDictionary(H.DICT);
const schema = H.lmsSchema();

function setup({ chatReplies = [], rows = (sql) => (/COUNT/.test(sql) ? [{ n: 1059 }] : [{ name: "Ali Khan", tb_id: 10, center_id: 1 }]) } = {}) {
  const calls = { chat: [], stream: [] };
  const db = H.fakeDb(rows);
  __setDeps({
    getSchema: async () => schema,
    runQuery: db.query,
    chat: async (messages, opts) => {
      calls.chat.push({ messages, opts });
      const r = chatReplies.shift() ?? "{}";
      return typeof r === "string" ? r : JSON.stringify(r);
    },
    streamChat: async function* (messages) {
      calls.stream.push(messages);
      yield "Sure!";
    },
  });
  return { calls, db };
}

test("greetings: instant, no model or database call", async () => {
  const { calls, db } = setup();
  for (const msg of ["Hi", "hello!", "Assalam o alaikum", "How are you", "thanks", "ok"]) {
    const r = await runAssistant({ text: msg, historyKey: "g" });
    assert.ok(r.reply.length > 2, msg);
  }
  assert.equal(calls.chat.length + calls.stream.length + db.calls.length, 0);
});

test("data questions are answered by the engine without any LLM call", async () => {
  const { calls } = setup();
  const r = await runAssistant({ text: "How many students enrolled in batch 10", historyKey: "d" });
  assert.equal(r.action, "engine");
  assert.match(r.reply, /1,059/);
  assert.match(r.reply, /Batch 10/);
  assert.equal(calls.chat.length + calls.stream.length, 0);
  assert.equal(r.llmCalls || 0, 0);
});

test("follow-ups use the remembered question, across messages and restarts", async () => {
  const { calls, db } = setup();
  await runAssistant({ text: "how many students in ITTI", historyKey: "f" });
  flushHistory();
  const r = await runAssistant({ text: "what about girls", historyKey: "f" });
  assert.equal(calls.chat.length, 0);
  assert.match(r.reply, /ITTI Quetta/);
  assert.match(r.reply, /female/);
  assert.deepEqual(db.calls.at(-1).params, [[1], ["Female"]]);
  assert.equal(getLastLookup("f").plan.entity, "student");
  const saved = JSON.parse(fs.readFileSync(`${dir}/history.json`, "utf8"));
  assert.ok(saved.f.messages.length >= 2);
  assert.ok(getHistory("f").some((m) => /what about girls/.test(m.content)));
});

test("small talk the engine can't place goes to the LLM chat", async () => {
  const { calls } = setup({ chatReplies: [{ type: "chat", reply: "I'm a data assistant 😊" }] });
  const r = await runAssistant({ text: "tell me a joke please", historyKey: "c" });
  assert.equal(calls.chat.length, 1);
  assert.equal(r.reply, "I'm a data assistant 😊");
});

test("files from the engine are returned to the channel", async () => {
  setup({ rows: (sql) => (/GROUP BY/.test(sql) ? [{ k: 1, n: 5 }, { k: 2, n: 3 }, { k: 3, n: 2 }] : [{ n: 1 }]) });
  const r = await runAssistant({ text: "students by center", historyKey: "x" });
  assert.ok(r.files.some((f) => f.kind === "image" && f.base64.length > 1000));
});
