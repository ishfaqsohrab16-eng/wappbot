// Replays the WhatsApp log of 22 Oct 2026 (Mansoor Ahmed / IconiX) where the bot
// gave wrong answers, plus the feedback-learning loop added after it.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const dir = new URL("../.test-data/realchat", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
fs.rmSync(dir, { recursive: true, force: true });
process.env.DATA_DIR = dir;

const H = await import("./helpers/lms.js");
const { setDictionary } = await import("../src/engine/dictionary.js");
const { runAssistant, __setDeps, stripReasoning } = await import("../src/bot/assistant.js");
const { clearResultCache, clockMinutes, isClassDay } = await import("../src/engine/executor.js");
const { romanizeUrdu } = await import("../src/engine/urdu.js");

const REAL = {
  ...H.DICT,
  batches: Array.from({ length: 10 }, (_, i) => ({ id: i + 1, name: `Training Batch ${i + 1}` })),
  centers: [
    { id: 6, name: "ITTI Pishin Stop QTA", location: "ITTI Center Model Town near Old Pishin Stop, Quetta" },
    { id: 8, name: "MCKRU", location: "Mir Chakar Khan Rind University, Sibi" },
    { id: 9, name: "SBK Women's University", location: "SBK Women's University" },
  ],
  courses: [
    { id: 1, name: "GraphicsAI", full: "Graphic Design with AI" },
    { id: 2, name: "AWE", full: "Amazon Web and e-Commerce" },
    { id: 3, name: "Digital", full: "Digital Marketing and Advertising" },
    { id: 4, name: "Technical", full: "Technical" },
  ],
};
setDictionary(REAL);
const schema = H.lmsSchema();

const CHECKINS = [
  { t_id: 1, trainer: "Shafi Ullah", date: "2026-10-22", check_in: "15:22:10", check_out: "17:05:00", center_id: 8, tb_id: 10, course_id: 1 },
  { t_id: 2, trainer: "Mis Amaara", date: "2026-10-22", check_in: "11:44:00", check_out: "14:08:00", center_id: 9, tb_id: 10, course_id: 1 },
  { t_id: 4, trainer: "Early Bird", date: "2026-10-22", check_in: "11:50:00", check_out: "13:00:00", center_id: 9, tb_id: 10, course_id: 1 },
];
const ALLOC = [
  { t_id: 1, trainer: "Shafi Ullah", center_id: 8, course_id: 1, tb_id: 10 },
  { t_id: 2, trainer: "Mis Amaara", center_id: 9, course_id: 1, tb_id: 10 },
  { t_id: 3, trainer: "Absent Khan", center_id: 8, course_id: 2, tb_id: 10 },
  { t_id: 4, trainer: "Early Bird", center_id: 9, course_id: 1, tb_id: 10 },
];
const SCHED = [
  { center_id: 8, course_id: 1, tb_id: 10, start_date: "2026-10-13", days: "Monday to Sunday", start_time: "03:00 PM", end_time: "05:00 PM" },
  { center_id: 9, course_id: 1, tb_id: 10, start_date: "2026-10-07", days: "Monday to Sunday", start_time: "12:00 PM", end_time: "02:00 PM" },
  { center_id: 8, course_id: 2, tb_id: 10, start_date: "2026-10-13", days: "Monday to Sunday", start_time: "03:00 PM", end_time: "05:00 PM" },
];

function respond(sql, params) {
  const flat = params.flat().map(String);
  if (/FROM class_schedules/.test(sql)) return SCHED;
  if (/FROM trainers_center_allocation/.test(sql)) return /user_name LIKE/.test(sql) ? ALLOC.filter((a) => flat.some((x) => /shafi/i.test(x)) && /Shafi/.test(a.trainer)) : ALLOC;
  if (/FROM trainer_attendance/.test(sql)) {
    const rows = /user_name LIKE/.test(sql) ? CHECKINS.filter((r) => r.trainer.toLowerCase().split(" ").some((w) => flat.some((x) => x.toLowerCase().includes(w)))) : CHECKINS;
    return /ta\.t_id,/.test(sql) ? rows : rows.map(({ trainer, date, check_in, check_out, center_id }) => ({ trainer, date, check_in, check_out, center_id }));
  }
  if (/GROUP BY/.test(sql)) return [{ k: 3, n: 2213 }, { k: 2, n: 2175 }, { k: 1, n: 1963 }, { k: 4, n: 81 }];
  if (/SUM\(/.test(sql)) return [{ total: 1250000, n: 2100 }];
  if (/COUNT\(/.test(sql)) return [{ n: 142 }];
  if (/FROM trainers/.test(sql)) {
    const all = [{ name: "Faizan Gul", email: "faizan@x.pk", course_id: 1 }, ...CHECKINS.map((r) => ({ name: r.trainer }))];
    const like = flat.find((x) => x.startsWith("%"));
    return like ? all.filter((t) => new RegExp(like.replace(/%/g, ".*"), "i").test(t.name)) : all.slice(0, 1);
  }
  if (/FROM students/.test(sql)) return [{ name: "Bibi Ayesha", roll_no: "DB10-0240252-0", cnic: "54401-6647329-0", qualification: "undefined", phone: "3337881264", tb_id: 10 }];
  return [];
}

let llmCalls = 0;
function setup(llmReplies = []) {
  llmCalls = 0;
  clearResultCache();
  const db = H.fakeDb(respond);
  __setDeps({
    getSchema: async () => schema,
    runQuery: db.query,
    chat: async () => {
      llmCalls++;
      const r = llmReplies.shift();
      return r ? JSON.stringify(r) : JSON.stringify({ type: "chat", reply: "🙂" });
    },
    streamChat: async function* () {
      llmCalls++;
      yield "Okay, the user clarified they meant the organization. I should explain DigiBizz.\n\nDigiBizz is a free training program.";
    },
  });
  return db;
}

let chatNo = 0;
async function converse(turns, { llm = [] } = {}) {
  const db = setup(llm);
  const key = `real-${++chatNo}`;
  for (const [msg, check] of turns) {
    const r = await runAssistant({ text: msg, historyKey: key });
    if (check) check(r.reply, r, db);
  }
}

const has = (re) => (reply) => assert.match(reply, re);
const hasNot = (re) => (reply) => assert.doesNotMatch(reply, re);
const both = (...fns) => (reply, r, db) => fns.forEach((f) => f(reply, r, db));
const noLlm = (_reply, r) => assert.equal(r.llmCalls || 0, 0, "unexpected LLM call");

test("late trainers: check-ins matched with class schedules", async () => {
  await converse([
    ["Show me todays trainer attendance", both(has(/Shafi Ullah/), noLlm)],
    ["Match them with class scheduls", both(has(/Late: 1/), has(/Shafi Ullah\* — \*22 min late/), has(/On time: 2/), has(/Left early: 1/), has(/Early Bird\* — \*60 min early/), has(/Not checked in: 1/), has(/Absent Khan/), hasNot(/GraphicsAI_/), noLlm)],
    ["Match both of them andget me late trainers", both(has(/Late: 1/), hasNot(/No trainer found/), noLlm)],
    ["Shafi trainer aaj class ma late to ni tha", both(has(/Shafi Ullah\* was \*22 min late/), noLlm)],
    ["Shafi aaj class ma late to ni tha", both(has(/22 min late/), hasNot(/Students/), noLlm)],
    ["was amaara on time today", both(has(/on time/), has(/16 min early/), noLlm)],
  ]);
});

test("log 2: late / left early, 'who was late?', complaints and a garbled correction", async () => {
  await converse([
    ["Give me todays late attendance trainers", both(has(/Trainer punctuality/), has(/Late: 1/), has(/Left early: 1/), noLlm)],
    ["Who was late?", both(has(/Shafi Ullah\* — \*22 min late/), noLlm)],
    ["This is not a correct response", both(has(/What did you want instead/), noLlm)],
    ["No I asked for trainers who are late for tadays class or left early your response was wrong", both(has(/Late: 1/), has(/Left early: 1/), hasNot(/No trainer found|Asked|Tadays/), noLlm)],
  ]);
  await converse([["did anyone leave early today", both(has(/Left early: 1/), noLlm)]]);
  await converse([["was Zzyzx late today", both(has(/no trainer named "Zzyzx"/), has(/Late: 1/))]]);
});

test("Urdu voice transcripts are understood without the LLM", async () => {
  await converse([
    [
      "سلام علیکم. مجھے آج یہ آپ بتاؤ کہ آج کے جو ٹینارز کی اٹینڈینس ہے اس میں سے کوئی لیٹ ہے یا نہیں ہے یہ سار ٹینارز اون ٹرائم آئی ہیں",
      both(has(/Trainer punctuality/), has(/Late: 1/), noLlm),
    ],
    [
      "ابھی تک جو اماری دیتبیس ہے اس میں سٹوڈنٹس کی ٹوٹل ارننگ کتنی ہوگا یہ تمام سٹوڈنٹس کی ارننگ کو آپ سمب کر کے آپ ایک فیگر بتا ہیں",
      both(has(/Total earnings \(approved\)/), has(/1,250,000/), noLlm),
    ],
  ]);
  assert.match(romanizeUrdu("آئی ٹی ٹی آئی کوئٹہ میں غیر حاضر طلبہ ۱۰"), /itti quetta mein absent students 10/);
});

test("earnings are summed, follow-ups keep the subject", async () => {
  await converse([
    ["Give me total student earnings", both(has(/Total earnings \(approved\)/), noLlm)],
    ["Give me there amount summed up only approved", both(has(/Total earnings \(approved\)/), hasNot(/null/), noLlm)],
    ["how many earning entries", both(has(/142/), has(/earning entries/), noLlm)],
  ]);
});

test("course wise, small talk, the organization and team members", async () => {
  await converse([
    ["List students data here course wise", both(has(/Students by course/), noLlm)],
    ["List corse vise", both(has(/by course/), noLlm)],
    ["Nice man", both(has(/👍/), noLlm)],
    ["Can you tell me in full details about your org", both(has(/Training to Dollars/), hasNot(/Roll No/), noLlm)],
    ["I meant organization", both(has(/Training to Dollars/), noLlm)],
    ["Usama Nadeem", both(has(/M&E Officer/), noLlm)],
  ]);
  await converse([["course wise", both(has(/Students by course/), noLlm)]]);
});

test("details hide 'undefined' and format phone numbers", async () => {
  await converse([["5440166473290", both(hasNot(/undefined/), has(/0333-7881264/))]]);
});

test("a wrong answer is unlearned and the correction is learned for next time", async () => {
  const q = "staff ki maloomat do zara";
  await converse(
    [
      [q, both(has(/Bibi Ayesha|Students/))],
      ["no, I asked about trainers", both(has(/Faizan Gul/), hasNot(/Bibi Ayesha/))],
    ],
    { llm: [{ type: "data", op: "list", entity: "student", confidence: 0.95 }] }
  );
  // Next chat: the same phrasing now goes straight to trainers, no LLM.
  await converse([[q, both(has(/Faizan Gul/), noLlm)]]);
});

test("a bare 'wrong' asks what they wanted, then uses the answer", async () => {
  await converse([
    ["Show me todays trainer attendance", has(/Shafi Ullah/)],
    ["wrong", has(/What did you want instead/)],
    ["late ones only", both(has(/Late: 1/), noLlm)],
  ]);
});

test("'yes' runs the question the bot suggested", async () => {
  await converse(
    [
      ["kuch batao trainers ke baare mein aaj ka scene", has(/Did you mean/)],
      ["Haan.", both(has(/Late: 1/))],
    ],
    { llm: [{ type: "clarify", reply: "Did you mean late trainers today?", suggest: "late trainers today" }] }
  );
});

test("leaked reasoning is stripped from chat replies", () => {
  assert.equal(stripReasoning("Okay, the user clarified they meant the org. I should explain.\n\nDigiBizz is free."), "DigiBizz is free.");
  assert.equal(stripReasoning("Hello! How can I help?"), "Hello! How can I help?");
});

test("clock and class-day helpers", () => {
  assert.equal(clockMinutes("03:00 PM"), 900);
  assert.equal(clockMinutes("12:00 PM"), 720);
  assert.equal(clockMinutes("12:10 AM"), 10);
  assert.equal(clockMinutes("15:22:10"), 922);
  assert.equal(clockMinutes("2026-10-22 11:24:00"), 684);
  assert.equal(isClassDay("Monday to Friday", "2026-10-22"), true); // Thursday
  assert.equal(isClassDay("Monday to Friday", "2026-10-24"), false); // Saturday
  assert.equal(isClassDay("Mon, Wed, Fri", "2026-10-23"), true);
});
