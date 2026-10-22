// End-to-end WhatsApp conversations through the full assistant (greetings,
// knowledge base, engine, follow-ups, memory). The fake DB answers per table;
// the LLM stub counts calls. Scenarios come from real chats plus edge cases.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const dir = new URL("../.test-data/scenarios", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
fs.rmSync(dir, { recursive: true, force: true });
process.env.DATA_DIR = dir;

const H = await import("./helpers/lms.js");
const { setDictionary } = await import("../src/engine/dictionary.js");
const { runAssistant, __setDeps } = await import("../src/bot/assistant.js");
const { clearResultCache } = await import("../src/engine/executor.js");

const REAL = {
  ...H.DICT,
  batches: Array.from({ length: 10 }, (_, i) => ({ id: i + 1, name: `Training Batch ${i + 1}`, start: "2026-07-01", end: "2026-10-31" })),
  centers: [
    { id: 1, name: "Awaran", location: "awaran" },
    { id: 2, name: "BUITEMS", location: "Balochistan University of Information Technology, Engineering and Management Sciences, Quetta" },
    { id: 3, name: "Derabugti", location: "Derabugti" },
    { id: 4, name: "Govt Girls College, Quetta Cantt", location: "Govt.Girls Post Graduate College Cantt, Quetta" },
    { id: 5, name: "IDSP", location: "IDSP's University of Community development, Quetta Rd, Quetta" },
    { id: 6, name: "ITTI Pishin Stop QTA", location: "ITTI Center Model Town near Old Pishin Stop, Quetta" },
    { id: 7, name: "ITTI Zhob", location: "IT Training Center Zhob" },
    { id: 8, name: "MCKRU", location: "Mir Chakar Khan Rind University, Sibi" },
    { id: 9, name: "SBK Women's University", location: "SBK Women's University" },
    { id: 10, name: "UoB", location: "University of Balochistan, Quetta" },
    { id: 11, name: "UoL", location: "University of Loralai, Loralai" },
    { id: 12, name: "UoG", location: "University of Gwadar, Gwadar" },
  ],
  courses: [
    { id: 1, name: "GraphicsAI", full: "Creative Design" },
    { id: 2, name: "AWE", full: "Amazon E-commerce & Web" },
    { id: 3, name: "DMA", full: "Digital Marketing & Advertising" },
    { id: 4, name: "Freelancing", full: "Freelancing" },
  ],
};
setDictionary(REAL);
const schema = H.lmsSchema();

const STUDENT = { name: "Bibi Ayesha", roll_no: "DB10-0240252-0", cnic: "54401-6647329-0", father_name: "Ghulam Mohiuddin", gender: "Female", phone: "03308497797", tb_id: 10, course_id: 1, center_id: 10, added_on: "2026-10-14 00:00:00", lms_status: 1 };

/** Fake LMS database: answers each generated query from its FROM table. */
function respond(sql, params) {
  const flat = params.flat();
  if (/LIKE \?/.test(sql) && flat.some((x) => /zzz|qqq|good|job/i.test(String(x)))) return [];
  if (/REPLACE\(REPLACE\(\w+\.(std|cand|t)_cnic/.test(sql) && !flat.includes("5440166473290")) return [];
  if (/GROUP BY/.test(sql)) {
    if (/std_gender|cand_gender/.test(sql)) return [{ k: "Male", n: 3100 }, { k: "Female", n: 2900 }];
    if (/status/.test(sql)) return [{ k: "Present", n: 40 }, { k: "Absent", n: 8 }, { k: "Leave", n: 2 }];
    return [{ k: 10, n: 900 }, { k: 6, n: 700 }, { k: 2, n: 500 }, { k: 4, n: 300 }];
  }
  if (/SUM\(/.test(sql)) return [{ total: 125000, n: 40 }];
  if (/AVG\(/.test(sql)) return [{ avg: 72.4, min: 31, max: 98, n: 340 }];
  if (/AS v FROM/.test(sql)) return [{ name: "Ali Raza", v: 900 }, { name: "Sana Baloch", v: 700 }, { name: "Hamza Khan", v: 650 }];
  if (/COUNT\(/.test(sql)) return [{ n: /FROM centers/.test(sql) ? 12 : /FROM training_batches/.test(sql) ? 10 : /FROM courses/.test(sql) ? 4 : 4505 }];
  if (/FROM centers/.test(sql)) return REAL.centers.slice(0, 12).map((c) => ({ center: c.name, location: c.location, type: "CO Education", medium: "Physical" }));
  if (/FROM training_batches/.test(sql)) return [{ batch: "Training Batch 10", starts: "2026-07-01", ends: "2026-10-31", status: 1 }];
  if (/FROM courses/.test(sql)) return REAL.courses.map((c) => ({ course: c.name, full_name: c.full }));
  if (/FROM trainer_attendance/.test(sql))
    return [{ trainer: "Asfandyar Qasim", date: "2026-10-22", check_in: "11:53:48", check_out: "14:07:09", center_id: 4 }, { trainer: "Mareena Khan", date: "2026-10-22", check_in: "11:57:40", check_out: "14:08:27", center_id: 4 }];
  if (/FROM trainers/.test(sql)) return [{ name: "Faizan Gul", email: "faizan@x.pk", course_id: 1 }];
  if (/FROM students/.test(sql)) return [STUDENT];
  return [{ title: "Row", date: "2026-10-20" }];
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
      yield "🙂 I'm here to help with LMS data.";
    },
  });
  return db;
}

let chatNo = 0;
/** Play a conversation: [[message, check(reply, result)], ...] */
async function converse(turns, { llm = [] } = {}) {
  const db = setup(llm);
  const key = `chat-${++chatNo}`;
  const out = [];
  for (const [msg, check] of turns) {
    const r = await runAssistant({ text: msg, historyKey: key });
    out.push(r);
    if (check) check(r.reply, r, db);
  }
  return out;
}

const has = (re) => (reply) => assert.match(reply, re);
const hasNot = (re) => (reply) => assert.doesNotMatch(reply, re);
const both = (...fns) => (reply, r, db) => fns.forEach((f) => f(reply, r, db));
const noLlm = (_reply, r) => assert.equal(r.llmCalls || 0, 0, "unexpected LLM call");

test("real chat 1: counts, a typo'd center, 'name them', the CNIC and 'what are you'", async () => {
  await converse([
    ["Hi", both(has(/Hello/), noLlm)],
    ["How many students in iti qta?", both(has(/4,505/), has(/ITTI Pishin Stop QTA/), hasNot(/BUITEMS|UoB|IDSP/), noLlm)],
    ["How many centers do we have", both(has(/\*12\* centers/), noLlm)],
    ["Name them", both(has(/Awaran/), has(/BUITEMS/), has(/UoB/), noLlm)],
    ["Give me names of all these", both(has(/Awaran/), noLlm)],
    ["54401-6647329-0\n\nGive me all details of student with this cnic number", both(has(/Bibi Ayesha/), has(/Training Batch 10/), has(/GraphicsAI/), has(/UoB/), has(/14 Oct 2026/), noLlm)],
    ["What are you?", both(has(/DigiBizz Assistant/), hasNot(/Bibi Ayesha/), noLlm)],
  ]);
});

test("real chat 2: trainer attendance, 'what about others', 'other trainers attendance'", async () => {
  await converse([
    ["trainer attendance today at govt girls college", both(has(/Asfandyar Qasim/), has(/Govt Girls College/), noLlm)],
    ["What about others?", both(hasNot(/No student found/), has(/excluding Govt Girls College/), noLlm)],
    ["What about other trainers attendance", both(hasNot(/No student found/), noLlm)],
  ]);
});

test("follow-ups keep context: batch, gender, breakdown, list, attendance of a person", async () => {
  await converse([
    ["how many students in batch 10", both(has(/4,505/), has(/Training Batch 10/))],
    ["and batch 9?", both(has(/Training Batch 9/), noLlm)],
    ["what about girls", both(has(/female/), has(/Training Batch 9/), noLlm)],
    ["by center", both(has(/by center/), noLlm)],
    ["list them", both(has(/Bibi Ayesha/), noLlm)],
    ["54401-6647329-0", has(/Bibi Ayesha/)],
    ["uski attendance", both(has(/Present/), noLlm)],
  ]);
});

test("program questions come from the DigiBizz knowledge base", async () => {
  await converse([
    ["what is digibizz", both(has(/Training to Dollars/), noLlm)],
    ["is there any fee?", both(has(/FREE/), noLlm)],
    ["stipend kitna milta hai", both(has(/6,200/), has(/end of the training/), noLlm)],
    ["how long is the training", both(has(/4 months/), noLlm)],
    ["eligibility criteria kya hai", both(has(/domicile/), noLlm)],
    ["how do i apply", both(has(/lms\.digibizz\.gob\.pk\/registration/), noLlm)],
    ["which courses are offered", both(has(/Creative Design/), noLlm)],
    ["will i get certificate", both(has(/certificate/i), noLlm)],
    ["class timings at buitems", both(has(/HBL Lab/), noLlm)],
    ["contact number", both(has(/081-9203131/), noLlm)],
    ["who is the program director", both(has(/Jawad Ahmed/), noLlm)],
    ["how many courses are there", both(has(/\*4\* courses/), noLlm)],
  ]);
});

test("typos, Roman Urdu and short forms", async () => {
  await converse([
    ["hw mny studnts in btch 10 quetaa", both(has(/4,505/), noLlm)],
    ["kitne bachay hain sbk mein", both(has(/SBK Women's University/), noLlm)],
    ["larkiyan kitni hain uob mein", both(has(/female/), has(/UoB/), noLlm)],
    ["students in zhob", both(has(/ITTI Zhob/), noLlm)],
    ["graphics ai students in batch 10", both(has(/GraphicsAI/), noLlm)],
    ["attendence todey", both(has(/today/), noLlm)],
    ["konsa batch chal raha hai", both(has(/Current batch/), noLlm)],
    ["university of balochistan students", both(has(/UoB/), noLlm)],
  ]);
});

test("people lookups: CNIC with/without dashes, roll number, phone, misspelled name", async () => {
  await converse([
    ["5440166473290", has(/Bibi Ayesha/)],
    ["roll no DB10-0240252-0", has(/Bibi Ayesha/)],
    ["find bibi aysha", has(/Bibi Ayesha|No exact match|Closest/)],
    ["11111-1111111-1", both(has(/couldn't find|No student found/), hasNot(/Bibi Ayesha/))],
    ["find zzzqqq", has(/No student found|couldn't find/)],
  ]);
});

test("files: chart for breakdowns, Excel for long lists, Word on request", async () => {
  const [a, b, c] = await converse([
    ["students by center", has(/by center/)],
    ["list students in batch 10", has(/Full list attached/)],
    ["students gender wise word report", has(/by gender/)],
  ]);
  assert.ok(a.files.some((f) => f.kind === "image"), "chart");
  assert.ok(b.files.some((f) => f.name.endsWith(".xlsx")), "excel");
  assert.ok(c.files.some((f) => f.name.endsWith(".docx")), "word");
});

test("read-only, injection and nonsense are handled safely", async () => {
  await converse([
    ["delete all students of batch 10", both(has(/read-only/), noLlm)],
    ["send email to all students", both(has(/read-only/), noLlm)],
    ["update ali khan phone", both(has(/read-only/), noLlm)],
    ["students'; DROP TABLE students; --", (reply, r, db) => db.calls.forEach((c) => assert.doesNotMatch(c.sql, /DROP/i))],
    ["good job", hasNot(/No student found/)],
    ["thanks", has(/welcome/i)],
    ["ok", has(/👍/)],
  ]);
});

test("unknown phrasing uses the LLM once, then is learned", async () => {
  const llm = [{ type: "data", op: "count", entity: "student", confidence: 0.93 }];
  const [first] = await converse([["zara talib-e-ilmon ki tadaad batao mujhe abhi abhi jaldi"]], { llm });
  assert.equal(first.llmCalls, 1);
  const [again] = await converse([["zara talib-e-ilmon ki tadaad batao mujhe abhi abhi jaldi"]]);
  assert.equal(again.llmCalls || 0, 0, "second time is learned");
  assert.match(again.reply, /4,505/);
});

test("edge cases: Urdu script, emoji, very long text, voice-like transcripts, mixed questions", async () => {
  await converse([
    ["السلام علیکم", has(/وعلیکم السلام/)],
    ["👍", has(/👍/)],
    ["   ", () => {}],
    ["a".repeat(5000), hasNot(/Bibi Ayesha/)],
    ["um so like how many uh students are there in in batch ten", both(has(/4,505/), has(/Training Batch 10/))],
    ["students in tenth batch", has(/Training Batch 10/)],
    ["batch dus ke students", has(/Training Batch 10/)],
    ["how many students in batch 10 and how many trainers", has(/4,505|students/)],
    ["batch 99 students", has(/couldn't find|batch 99/i)],
    ["students in karachi", (reply) => assert.ok(reply.length > 0)],
    ["/help", () => {}],
  ]);
});

test("help and capability questions", async () => {
  await converse([
    ["what can you do", both(has(/Count/), noLlm)],
    ["help", both(has(/Try|batch 10/), noLlm)],
    ["who are you", both(has(/DigiBizz Assistant/), noLlm)],
  ]);
});
