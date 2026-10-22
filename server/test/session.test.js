// Regressions from real WhatsApp conversations, with the real centers/courses.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const dir = new URL("../.test-data/session", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
fs.rmSync(dir, { recursive: true, force: true });
process.env.DATA_DIR = dir;

const H = await import("./helpers/lms.js");
const { setDictionary } = await import("../src/engine/dictionary.js");
const { parse } = await import("../src/engine/parser.js");
const { answer, engineEntities } = await import("../src/engine/engine.js");
const L = await import("../src/engine/learned.js");
const { smallTalkReply } = await import("../src/bot/intent.js");
const { knowledgeAnswer } = await import("../src/knowledge/digibizz.js");

const REAL = {
  ...H.DICT,
  batches: Array.from({ length: 10 }, (_, i) => ({ id: i + 1, name: `Training Batch ${i + 1}` })),
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
  ],
  courses: [
    { id: 1, name: "GraphicsAI", full: "Creative Design" },
    { id: 2, name: "AWE", full: "Amazon E-commerce & Web" },
    { id: 3, name: "DMA", full: "Digital Marketing & Advertising" },
  ],
};
setDictionary(REAL);
const schema = H.lmsSchema();
const entities = engineEntities(schema);
const p = (q, last) => parse(q, { dict: REAL, entities, last });
const rows = (sql) => (/GROUP BY/.test(sql) ? [{ k: 1, n: 3 }] : /COUNT/.test(sql) ? [{ n: 12 }] : [{ center: "Awaran", location: "awaran" }]);

test("'iti qta' means ITTI Pishin Stop QTA, not every Quetta center", () => {
  assert.equal(p("How many students in iti qta?").filters.center.label, "ITTI Pishin Stop QTA");
  assert.equal(p("students in itti zhob").filters.center.label, "ITTI Zhob");
  assert.equal(p("students in quetta").filters.center.ids.length, 5, "a city means all its centers");
  assert.equal(p("students in university of balochistan").filters.center.label, "UoB");
  assert.equal(p("sbk womens students").filters.center.label, "SBK Women's University");
  assert.equal(p("how many girls in quetta").filters.gender.label, "female");
  assert.equal(p("how many girls in quetta").filters.center.ids.length, 5, "'girls' is a filter, not the girls college");
  assert.equal(p("students of girls college").filters.center.label, "Govt Girls College, Quetta Cantt");
});

test("'name them' after a count lists the same records", () => {
  const last = p("How many centers do we have");
  assert.equal(last.op, "count");
  for (const q of ["Name them", "Give me names of all these", "list them", "names", "which ones"]) {
    const f = p(q, last);
    assert.equal(f.op, "list", q);
    assert.equal(f.entity, "center", q);
    assert.ok(!f.ident, q);
  }
});

test("'what about others' repeats the question without the specific filter", () => {
  const last = p("trainer attendance today at govt girls college");
  assert.equal(last.entity, "trainer_attendance");
  const f = p("What about others?", last);
  assert.equal(f.entity, "trainer_attendance");
  assert.ok(!f.ident);
  assert.ok(!f.filters.center);
  assert.deepEqual(f.exclude.center.ids, [4]);
  assert.equal(f.filters.date.label, "today");
});

test("questions about the bot get a fixed intro, never data", () => {
  for (const q of ["What are you?", "who are you", "what is your name", "aap kaun hain", "what can you do"]) assert.ok(smallTalkReply(q), q);
});

test("an LLM answer cannot copy a CNIC from history into an unrelated message", async () => {
  const db = H.fakeDb(rows);
  const llm = async () => JSON.stringify({ type: "data", op: "details", entity: "student", ident: { type: "cnic", value: "54401-6647329-0" }, confidence: 0.95 });
  const last = p("54401-6647329-0");
  const r = await answer("are you sure about that lady", { schema, query: db.query, llm, last, lastText: "54401-6647329-0" });
  assert.ok(!db.calls.some((c) => c.params.flat().includes("5440166473290")), "CNIC not looked up");
  assert.equal(L.listLearned({ kind: "patterns" }).length, 0, "nothing learned");
  void r;
});

test("generic phrasings are never learned; old ones are auto-disabled", () => {
  assert.equal(L.learn({ key: "what are you", mapping: { op: "details", entity: "student" }, confidence: 0.99 }).saved, false);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(`${dir}/learned-queries.json`, JSON.stringify({ entries: [{ id: "x1", key: "what are you", mapping: { op: "details", entity: "student" }, status: "active" }] }));
  L.reloadLearned();
  assert.equal(L.listLearned()[0].status, "disabled");
  assert.equal(L.findLearned("what are you"), null);
  fs.rmSync(`${dir}/learned-queries.json`);
  L.reloadLearned();
});

test("unknown words are learned so later sentences need no LLM", async () => {
  const db = H.fakeDb(rows);
  const llm = async () => JSON.stringify({ type: "data", op: "count", entity: "student", confidence: 0.95 });
  const r0 = await answer("shagird kitne hain", { schema, query: db.query, llm });
  assert.equal(r0.source, "llm");
  assert.equal(p("kitne shagird hain UoB mein").entity, "student", "count + center defaults to students");
  assert.equal(L.learnedSynonyms().shagird, "student");
  let calls = 0;
  const llm2 = async () => (calls++, "{}");
  const r = await answer("BUITEMS ke female shagird", { schema, query: db.query, llm: llm2 });
  assert.equal(calls, 0, "learned word routes without the LLM");
  assert.equal(r.plan.entity, "student");
  assert.equal(r.plan.filters.center.label, "BUITEMS");
});

test("DigiBizz knowledge: program questions answered from the website facts", () => {
  const k = (q) => knowledgeAnswer(q)?.id;
  assert.equal(k("What is DigiBizz?"), "about");
  assert.equal(k("is there any fee"), "fee");
  assert.equal(k("stipend kitna milta hai"), "stipend");
  assert.match(knowledgeAnswer("what is the stipend").answer, /6,200/);
  assert.equal(k("how long is the training"), "duration");
  assert.match(knowledgeAnswer("training duration").answer, /4 months/);
  assert.equal(k("what is the eligibility criteria"), "eligibility");
  assert.equal(k("how do i apply"), "register");
  assert.equal(k("which courses are offered"), "courses");
  assert.equal(k("will i get a certificate"), "certificate");
  assert.equal(k("free google certification"), "google");
  assert.equal(k("class timings at buitems"), "timings");
  assert.equal(k("contact number of digibizz"), "contact");
  // database questions are not stolen by the knowledge base
  assert.equal(k("how many courses"), undefined);
  assert.equal(k("list centers"), undefined);
  assert.equal(k("total earnings batch 10"), undefined);
  assert.equal(k("contact of student ali khan"), undefined);
});

test("replies are formatted for WhatsApp with names, icons and readable dates", async () => {
  const db = H.fakeDb((sql) =>
    /COUNT\(\*\) AS n FROM centers/.test(sql)
      ? [{ n: 10 }]
      : [{ name: "Bibi Ayesha", cnic: "54401-6647329-0", tb_id: 10, course_id: 1, center_id: 10, added_on: "2026-10-14 00:00:00" }]
  );
  const r = await answer("54401-6647329-0", { schema, query: db.query, llm: null });
  assert.match(r.reply, /🎓 \*Bibi Ayesha\*/);
  assert.match(r.reply, /Training Batch 10/);
  assert.match(r.reply, /GraphicsAI/);
  assert.match(r.reply, /UoB/);
  assert.match(r.reply, /14 Oct 2026/);
  assert.doesNotMatch(r.reply, /00:00:00/);
});
