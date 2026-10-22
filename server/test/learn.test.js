// Chat log 3 (22 Oct 2026): punctuality must match the LMS dashboard (exact times,
// "didn't check out"), complaints about the data are rechecked, "ask llm" uses the
// LLM, and /learn teaches a question plus its paraphrases and new words.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const dir = new URL("../.test-data/learn", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
fs.rmSync(dir, { recursive: true, force: true });
process.env.DATA_DIR = dir;

const H = await import("./helpers/lms.js");
const { setDictionary } = await import("../src/engine/dictionary.js");
const { runAssistant, __setDeps } = await import("../src/bot/assistant.js");
const { clearResultCache } = await import("../src/engine/executor.js");
const { DICT_REAL } = await import("../src/knowledge/phrasebook.js");
const L = await import("../src/engine/learned.js");
setDictionary(DICT_REAL);
const schema = H.lmsSchema();

// Centers 8 = MCKRU, 9 = SBK; course 3 = GraphicsAI. Yesterday's row has no check-out.
const CHECKINS = [
  { t_id: 1, trainer: "Shafi Ullah", date: "2026-10-22", check_in: "15:22:00", check_out: "17:05:00", center_id: 8, tb_id: 10, course_id: 3 },
  { t_id: 5, trainer: "Five Late", date: "2026-10-22", check_in: "15:05:00", check_out: "16:55:00", center_id: 8, tb_id: 10, course_id: 3 },
  { t_id: 2, trainer: "Mis Amaara", date: "2026-10-22", check_in: "11:44:00", check_out: "14:08:00", center_id: 9, tb_id: 10, course_id: 3 },
  { t_id: 6, trainer: "No Out", date: "2026-10-01", check_in: "11:55:00", check_out: null, center_id: 9, tb_id: 10, course_id: 3 },
];
const ALLOC = CHECKINS.map((r) => ({ t_id: r.t_id, trainer: r.trainer, center_id: r.center_id, course_id: 3, tb_id: 10 }));
const SCHED = [
  { center_id: 8, course_id: 3, tb_id: 10, start_date: "2026-09-01", days: "Monday to Sunday", start_time: "03:00 PM", end_time: "05:00 PM" },
  { center_id: 9, course_id: 3, tb_id: 10, start_date: "2026-09-01", days: "Monday to Sunday", start_time: "12:00 PM", end_time: "02:00 PM" },
];

function respond(sql, params) {
  const flat = params.flat().map(String);
  const like = flat.find((x) => x.startsWith("%"));
  const byName = (rows, field) => (like ? rows.filter((r) => new RegExp(like.replace(/%/g, ".*"), "i").test(r[field])) : rows);
  if (/FROM class_schedules/.test(sql)) return SCHED;
  if (/FROM trainers_center_allocation/.test(sql)) return byName(ALLOC, "trainer");
  if (/FROM trainer_attendance/.test(sql)) return byName(CHECKINS, "trainer");
  if (/FROM trainers/.test(sql)) return byName(CHECKINS.map((r) => ({ name: r.trainer, email: "x@y.pk", course_id: 3 })), "name");
  if (/GROUP BY/.test(sql)) return [{ k: 3, n: 20 }, { k: 2, n: 10 }];
  if (/SUM\(/.test(sql)) return [{ total: 1250000, n: 2100 }];
  if (/COUNT\(/.test(sql)) return [{ n: 45 }];
  return [];
}

let llmCalls = 0;
function setup(llmReplies = []) {
  llmCalls = 0;
  clearResultCache();
  __setDeps({
    getSchema: async () => schema,
    runQuery: H.fakeDb(respond).query,
    chat: async () => {
      llmCalls++;
      const r = llmReplies.shift();
      return r ? JSON.stringify(r) : JSON.stringify({ type: "chat", reply: "🙂" });
    },
    streamChat: async function* () {
      llmCalls++;
      yield "🙂";
    },
  });
}

let n = 0;
async function converse(turns, { llm = [], isAdmin } = {}) {
  setup(llm);
  const key = `learn-${++n}`;
  for (const [msg, check] of turns) {
    const r = await runAssistant({ text: msg, historyKey: key, isAdmin });
    check?.(r.reply, r);
  }
}
const has = (re) => (reply) => assert.match(reply, re);
const hasNot = (re) => (reply) => assert.doesNotMatch(reply, re);
const both = (...f) => (reply, r) => f.forEach((x) => x(reply, r));
const noLlm = (_x, r) => assert.equal(r.llmCalls || 0, 0, "unexpected LLM call");
const usedLlm = (_x, r) => assert.ok(r.llmCalls >= 1, "expected an LLM call");

test("punctuality uses exact times and lists missing check-outs, like the LMS dashboard", async () => {
  await converse([
    [
      "Give me todays late attendance trainers",
      both(has(/exact times/), has(/Late: 2/), has(/Five Late\* — \*5 min late/), has(/Left early: 1/), has(/Five Late\* — \*5 min early/), has(/Didn't check out: 1/), has(/No Out/), noLlm),
    ],
  ]);
});

test("log 3: names, data complaints, 'ask llm' and the dashboard message", async () => {
  await converse(
    [
      ["Give me todays late attendance trainers", has(/Late: 2/)],
      ["It's wrong today is 22 oct", both(has(/Rechecked from the live LMS data/), has(/Late: 2/), noLlm)],
      ["I wanted trainers who were late or left early", both(has(/Late: 2/), hasNot(/Wanted/), noLlm)],
      ["But on my dashboard 1 is late 3 left early and 2 didn't check out while ones check in missing", both(has(/Trainer punctuality/), hasNot(/Trainers\* \(showing/), noLlm)],
      ["Wrong response ask llm", both(hasNot(/Ask Llm/), has(/Trainer punctuality/), usedLlm)],
    ],
    { llm: [{ action: "plan", op: "late", entity: "trainer_attendance" }] }
  );
});

test("/learn asks the LLM, answers, and remembers the question, its paraphrases and new words", async () => {
  const paraphrases = ["kaun kaun sa ustaad der se pohncha", "which teachers reached after class started", "ustaad der se aaye kya"];
  await converse(
    [
      [
        "/learn ustaad der se pohncha kya",
        both(usedLlm, has(/Trainer punctuality/), has(/Learned:/), has(/similar phrasing/), has(/without the AI/)),
      ],
    ],
    { llm: [{ type: "data", op: "late", entity: "trainer_attendance", confidence: 0.9, paraphrases }], isAdmin: true }
  );
  // A fresh chat: the taught question and a paraphrase work instantly.
  await converse([
    ["ustaad der se pohncha kya", both(has(/Trainer punctuality/), noLlm)],
    ["kaun kaun sa ustaad der se pohncha", both(has(/Trainer punctuality/), noLlm)],
  ]);
  assert.ok(L.listLearned().some((x) => x.source === "teach"), "saved with source teach");
});

test("/learn <message> = <meaning> needs no LLM, and only admins can teach", async () => {
  await converse([["/learn sab ki kamai kitni = total earnings", both(has(/Total earnings/), has(/Learned:/), noLlm)]], { isAdmin: true });
  await converse([["sab ki kamai kitni", both(has(/Total earnings/), noLlm)]]);
  await converse([["/learn kuch bhi", both(has(/Only admins/), noLlm)]], { isAdmin: false });
  await converse([["/learn", has(/Teach me a question/)]], { isAdmin: true });
});

test("saying 'wrong' after /learn unlearns it", async () => {
  await converse(
    [
      ["/learn hazri ka haal = trainer attendance today", has(/Learned:/)],
      ["wrong", has(/What did you want instead/)],
    ],
    { isAdmin: true }
  );
  const x = L.listLearned().find((e) => e.example === "hazri ka haal");
  assert.equal(x?.status, "disabled");
});
