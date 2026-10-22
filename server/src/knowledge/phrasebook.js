// 1,000 questions DigiBizz staff are expected to ask, built from the LMS schema
// (every entity in src/engine/entities.js), the real centers / courses / batches,
// and the phrasing seen in real chats: English, Roman Urdu, Urdu script (voice
// notes), typos and short forms. Each row: [question, op, entity, dim?].
// Used by test/phrasebook1000.test.js (rules coverage) and, at startup, by
// seedPhrasebook() in engine/learned.js: any question the rules miss against the
// live dictionary is pre-taught as a learned pattern, so it never needs the LLM.

export const DICT_REAL = {
  batches: Array.from({ length: 10 }, (_, i) => ({ id: i + 1, name: `Training Batch ${i + 1}`, slug: `training-batch-${i + 1}` })),
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
    { id: 1, name: "AWE", full: "Amazon Web and e-Commerce" },
    { id: 2, name: "Digital", full: "Digital Marketing and Advertising" },
    { id: 3, name: "GraphicsAI", full: "Graphic Design with AI" },
    { id: 4, name: "Technical", full: "Technical" },
  ],
  enums: {
    "student.gender": ["Male", "Female"],
    "student.district": ["Quetta", "Pishin", "Kech", "Gwadar", "Khuzdar", "Sibi", "Nushki", "Zhob", "Loralai"],
    "student.qualification": ["Intermediate", "Bachelors", "Masters"],
    "student.status": [1, 2],
    "candidate.gender": ["male", "female"],
    "candidate.status": [0, 1, 2],
    "candidate.city": ["Quetta", "Sibi", "Gwadar", "Turbat"],
    "attendance.status": ["Present", "Absent", "Leave", "Late"],
    "ticket.status": ["open", "closed", "pending"],
    "earning.status": [0, 1, 2],
    "earning.platform": ["Fiverr", "Upwork", "Local Client", "Freelancer"],
    "leave.status": [0, 1, 2],
  },
  loadedAt: Date.now(),
};

// Values people actually type for each filter (several spellings per value).
const CENTERS = ["itti qta", "ITTI", "buitems", "mckru", "sibi", "uob", "university of balochistan", "zhob", "awaran", "sbk", "girls college", "idsp", "loralai", "gwadar", "derabugti"];
const COURSES = ["awe", "amazon", "digital marketing", "digital", "graphics", "graphic design", "graphicsai", "technical"];
const BATCHES = ["batch 10", "batch 9", "batch 8", "batch 7", "b10", "10th batch", "current batch", "previous batch", "batch dus", "batch 5"];
const DATES = ["today", "yesterday", "this week", "last week", "this month", "last month", "aaj", "kal", "in october", "last 7 days"];
const GENDERS = [["girls", "boys"], ["female", "male"], ["larkiyan", "larkay"]];

/** Deterministic pick so the file is stable between runs. */
const pick = (arr, i) => arr[i % arr.length];

function gen() {
  const rows = [];
  const add = (q, op, entity, dim) => rows.push(dim ? [q, op, entity, dim] : [q, op, entity]);

  // ---- students (≈ 300) ----
  for (let i = 0; i < 17; i++) {
    const c = pick(CENTERS, i);
    const b = pick(BATCHES, i);
    const co = pick(COURSES, i);
    const g = pick(GENDERS, i);
    add(`how many students in ${c}`, "count", "student");
    add(`kitne students hain ${c} mein`, "count", "student");
    add(`total students ${b}`, "count", "student");
    add(`how many ${g[0]} in ${c}`, "count", "student");
    add(`${g[1]} students in ${b}`, "count", "student");
    add(`${co} students in ${b}`, "count", "student");
    add(`number of ${co} students at ${c}`, "count", "student");
    add(`students by ${pick(["center", "course", "gender", "batch", "district", "qualification"], i)} in ${b}`, "count_by", "student", pick(["center", "course", "gender", "batch", "district", "qualification"], i));
    add(`${pick(["center", "course", "gender", "district"], i)} wise students ${c}`, "count_by", "student", pick(["center", "course", "gender", "district"], i));
    add(`list students of ${c} ${b}`, "list", "student");
    add(`names of ${g[0]} in ${co}`, "list", "student");
    add(`show ${co} students list ${b}`, "list", "student");
    add(`active students in ${c}`, "count", "student");
    add(`removed students ${b}`, "count", "student");
    add(`students added ${pick(DATES, i)}`, "count", "student");
    add(`${b} mein kitne bachay hain`, "count", "student");
    add(`${c} ke ${co} students kitne hain`, "count", "student");
    add(`${pick(["course", "center", "gender"], i)} vise students ${b}`, "count_by", "student", pick(["course", "center", "gender"], i));
    add(`studnts in ${c} ${b}`, "count", "student");
    add(`dropouts in ${c}`, "count", "student");
  }

  // ---- applicants / admissions (≈ 90) ----
  for (let i = 0; i < 10; i++) {
    const c = pick(CENTERS, i);
    const b = pick(BATCHES, i);
    add(`how many applicants ${pick(DATES, i)}`, "count", "candidate");
    add(`admitted applicants in ${b}`, "count", "candidate");
    add(`applications for ${c}`, "count", "candidate");
    add(`applicants by ${pick(["center", "course", "gender", "status", "city"], i)}`, "count_by", "candidate", pick(["center", "course", "gender", "status", "city"], i));
    add(`list applicants ${b} ${c}`, "list", "candidate");
    add(`average test marks of applicants ${b}`, "avg", "candidate");
    add(`kitni admissions hui ${pick(DATES, i)}`, "count", "candidate");
    add(`female applicants in ${c}`, "count", "candidate");
    add(`candidates who applied ${pick(DATES, i + 3)}`, "list", "candidate");
  }

  // ---- trainers, allocations, master trainers (≈ 90) ----
  for (let i = 0; i < 10; i++) {
    const c = pick(CENTERS, i);
    const co = pick(COURSES, i);
    const b = pick(BATCHES, i);
    add(`how many trainers in ${c}`, "count", "trainer");
    add(`list trainers of ${co}`, "list", "trainer");
    add(`trainers in ${b}`, "list", "trainer");
    add(`kitne trainers hain ${co} ke`, "count", "trainer");
    add(`trainers by course`, "count_by", "trainer", "course");
    add(`trainer allocations in ${c}`, "list", "allocation");
    add(`which trainers are assigned to ${c} ${b}`, "list", "allocation");
    add(`list master trainers`, "list", "master_trainer");
    add(`master trainer of ${co}`, "list", "master_trainer");
  }

  // ---- student attendance (≈ 80) ----
  for (let i = 0; i < 10; i++) {
    const c = pick(CENTERS, i);
    const d = pick(DATES, i);
    add(`absent students ${d} in ${c}`, "count", "attendance");
    add(`how many present ${d}`, "count", "attendance");
    add(`attendance ${d} ${c}`, "count_by", "attendance", "status");
    add(`aaj kitne students absent hain ${c} mein`, "count", "attendance");
    add(`attendance by center ${d}`, "count_by", "attendance", "center");
    add(`ghair hazir students ${d}`, "count", "attendance");
    add(`hazri report ${d} ${pick(BATCHES, i)}`, "count_by", "attendance", "status");
    add(`attendence todey ${c}`, "count_by", "attendance", "status");
  }

  // ---- trainer attendance & punctuality (≈ 100) ----
  for (let i = 0; i < 10; i++) {
    const c = pick(CENTERS, i);
    const d = pick(DATES, i);
    add(`trainer attendance ${d}`, "list", "trainer_attendance");
    add(`trainer attendance at ${c} ${d}`, "list", "trainer_attendance");
    add(`trainer check in ${d}`, "list", "trainer_attendance");
    add(`late trainers ${d}`, "late", "trainer_attendance");
    add(`which trainers came late ${d} in ${c}`, "late", "trainer_attendance");
    add(`kon se trainers late aaye ${d}`, "late", "trainer_attendance");
    add(`were all trainers on time ${d}`, "late", "trainer_attendance");
    add(`match trainer attendance with class schedule ${d}`, "late", "trainer_attendance");
    add(`teachers punctuality ${c}`, "late", "trainer_attendance");
    add(`koi trainer der se aaya ${d}`, "late", "trainer_attendance");
  }

  // ---- earnings (≈ 80) ----
  for (let i = 0; i < 10; i++) {
    const b = pick(BATCHES, i);
    const c = pick(CENTERS, i);
    add(`total earnings ${b}`, "sum", "earning");
    add(`how much did students earn in ${c}`, "sum", "earning");
    add(`kitni kamai hui ${pick(DATES, i)}`, "sum", "earning");
    add(`top ${5 + (i % 6)} earners ${b}`, "top", "earning");
    add(`earnings by ${pick(["platform", "center", "course", "batch"], i)}`, "count_by", "earning", pick(["platform", "center", "course", "batch"], i));
    add(`total student earnings ${c}`, "sum", "earning");
    add(`approved earnings amount ${b}`, "sum", "earning");
    add(`how many earning entries ${pick(DATES, i)}`, "count", "earning");
  }

  // ---- results, quizzes, assignments, submissions (≈ 90) ----
  for (let i = 0; i < 10; i++) {
    const b = pick(BATCHES, i);
    const c = pick(CENTERS, i);
    add(`average exam score ${b}`, "avg", "result");
    add(`top 10 students by score ${c}`, "top", "result");
    add(`results by course ${b}`, "count_by", "result", "course");
    add(`average quiz marks ${c}`, "avg", "quiz_attempt");
    add(`quiz attempts ${pick(DATES, i)}`, "count", "quiz_attempt");
    add(`how many assignments in ${b}`, "count", "assignment");
    add(`list assignments ${c}`, "list", "assignment");
    add(`assignment submissions ${pick(DATES, i)}`, "count", "submission");
    add(`average assignment marks ${b}`, "avg", "submission");
  }

  // ---- leaves, holidays, schedules, dates (≈ 70) ----
  for (let i = 0; i < 10; i++) {
    const c = pick(CENTERS, i);
    const d = pick(DATES, i);
    add(`student leaves ${d}`, "count", "leave");
    add(`leave requests by status`, "count_by", "leave", "status");
    add(`trainer leaves ${d}`, "list", "trainer_leave");
    add(`holidays ${d}`, "list", "holiday");
    add(`list schedules in ${c}`, "list", "schedule");
    add(`batch start date ${c}`, "list", "center_dates");
    add(`when does ${pick(BATCHES, i)} end at ${c}`, "list", "center_dates");
  }

  // ---- tickets, feedback, documents, profiles, announcements (≈ 70) ----
  for (let i = 0; i < 10; i++) {
    const d = pick(DATES, i);
    const c = pick(CENTERS, i);
    add(`open tickets ${c}`, "count", "ticket");
    add(`tickets by status ${d}`, "count_by", "ticket", "status");
    add(`complaints ${d}`, "count", "ticket");
    add(`student feedback ${c}`, "count", "feedback");
    add(`documents by type`, "count_by", "document", "type");
    add(`freelancing profiles by platform`, "count_by", "freelance_profile", "platform");
    add(`announcements ${d}`, "list", "announcement");
  }

  // ---- learning content, reports, visits, logins, users (≈ 70) ----
  for (let i = 0; i < 7; i++) {
    const co = pick(COURSES, i);
    const c = pick(CENTERS, i);
    const d = pick(DATES, i);
    add(`modules of ${co}`, "list", "module");
    add(`${co} syllabus topics`, "list", "topic");
    add(`lecture recordings ${co}`, "list", "recording");
    add(`learning resources for ${co}`, "list", "resource");
    add(`daily lecture reports ${d} ${c}`, "count", "lecture_report");
    add(`center visits ${d}`, "count", "center_visit");
    add(`weekly evaluations ${pick(BATCHES, i)}`, "count", "weekly_evaluation");
    add(`online class reports ${d}`, "count", "online_class_report");
    add(`logins ${d}`, "count", "login");
    add(`user accounts by type`, "count_by", "user", "type");
  }

  // ---- batches, centers, courses (≈ 40) ----
  const META = [
    ["which batch is running", "current", "batch"], ["current batch", "current", "batch"], ["konsa batch chal raha hai", "current", "batch"],
    ["latest batch", "current", "batch"], ["list batches", "list", "batch"], ["how many batches", "count", "batch"],
    ["how many centers", "count", "center"], ["list centers", "list", "center"], ["centers in quetta", "list", "center"],
    ["kitne centers hain", "count", "center"], ["list courses", "list", "course"], ["how many courses", "count", "course"],
    ["List corse vise", "count_by", "student", "course"], ["course wise students", "count_by", "student", "course"],
    ["center wise", "count_by", "student", "center"], ["gender wise", "count_by", "student", "gender"],
    ["batch wise students", "count_by", "student", "batch"], ["district wise students", "count_by", "student", "district"],
  ];
  for (const r of META) add(...r);

  // ---- Urdu script (voice notes) ----
  const URDU = [
    ["کوئٹہ میں کتنے طلبہ ہیں", "count", "student"],
    ["بیچ ۱۰ میں کتنے سٹوڈنٹس ہیں", "count", "student"],
    ["آج کتنے طلبہ غیر حاضر ہیں", "count", "attendance"],
    ["آج کی حاضری بتائیں", "count_by", "attendance", "status"],
    ["آج کون سے ٹرینرز لیٹ آئے", "late", "trainer_attendance"],
    ["آج ٹرینرز کی اٹینڈنس بتاؤ", "list", "trainer_attendance"],
    ["کیا سارے ٹرینرز آن ٹائم آئے ہیں", "late", "trainer_attendance"],
    ["طلبہ کی ٹوٹل ارننگ کتنی ہے", "sum", "earning"],
    ["سٹوڈنٹس کی کمائی کتنی ہوئی", "sum", "earning"],
    ["کورس کے حساب سے طلبہ", "count_by", "student", "course"],
    ["سینٹرز کی لسٹ دکھاؤ", "list", "center"],
    ["کتنے ٹرینرز ہیں", "count", "trainer"],
    ["لڑکیاں کتنی ہیں بیچ ۹ میں", "count", "student"],
    ["کتنے امیدوار اپلائی ہوئے اس مہینے", "count", "candidate"],
    ["موجودہ بیچ کون سا ہے", "current", "batch"],
  ];
  for (const r of URDU) add(...r);
  return rows;
}

const all = gen();
const seen = new Set();
export const PHRASES_1000 = all.filter(([q]) => {
  const k = q.toLowerCase().replace(/\s+/g, " ").trim();
  if (seen.has(k)) return false;
  seen.add(k);
  return true;
}).slice(0, 1000);
