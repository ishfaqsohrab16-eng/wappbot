import fs from "node:fs";
import { ENTITIES } from "./entities.js";

// Maps every read query in the LMS inventory (queries.txt) to the bot intent that
// answers the same question, or to the documented reason it is not exposed in chat.
// Used by the coverage test and `npm run coverage`.

/** LMS Sequelize model names (as used in queries.txt) → MySQL table. */
export const MODEL_TABLE = {
  Student: "students", StudentModel: "students", student: "students", StudentsModel: "students",
  Candidate: "candidates",
  User: "user",
  TrainerCenterAllocation: "trainers_center_allocation", TrainersCenterAllocationModel: "trainers_center_allocation",
  TrainerCenterAllocationModel: "trainers_center_allocation", TrainerAlocation: "trainers_center_allocation",
  TrainerCenterAlocation: "trainers_center_allocation", Allocation: "trainers_center_allocation",
  trainers_center_allocation: "trainers_center_allocation",
  Trainer: "trainers", TrainerModel: "trainers", Teacher: "trainers",
  Center: "centers",
  MasterTrainer: "mastertrainers", MasterTrainerModel: "mastertrainers", MastterTrainer: "mastertrainers",
  Course: "courses",
  TrainingBatch: "training_batches", TrainingBatchModel: "training_batches",
  Assignment: "assignments",
  TrainerAttendanceModel: "trainer_attendance",
  trainerLeave: "trainer_leaves",
  studentLeave: "students_leaves", StudentLeaves: "students_leaves", StudentLeave: "students_leaves",
  StudentQuiz: "student_quiz", Quiz: "student_quiz",
  Attendance: "attendance",
  WeeklyEvaluation: "weekly_evaluations",
  Ticket: "tickets", Tiket: "tickets",
  StudentsFeedback: "students_feedback", WeaklyFeedback: "students_feedback",
  ExamAssessment: "exam_assessment", ExamAssignment: "exam_assessment",
  EmailCampaign: "email_campaigns",
  CenterVisit: "center_visits",
  AssignmentSubmission: "assignment_submissions", assignmentSubmission: "assignment_submissions",
  Earnings: "earnings", EarningsModel: "earnings", Earning: "earnings", earning: "earnings",
  DailyLectureReport: "daily_lecture_reports", DailyReport: "daily_lecture_reports",
  EmailCampaignRecipient: "email_campaign_recipients",
  TrainerTopicReport: "trainer_topic_reports",
  Topic: "topics",
  StudentsDocsModel: "students_docs", StudentsDocs: "students_docs", StudentDocuments: "students_docs",
  StudentQuizAttempts: "student_quiz_attempts", QuizAttempts: "student_quiz_attempts",
  OnlineClassReport: "online_class_reports",
  Holiday: "holidays", HolidaysModel: "holidays",
  CourseModule: "modules",
  ClassSchedule: "class_schedules",
  ClassAnnouncements: "class_announcements",
  CentersDates: "centers_dates", CenterDates: "centers_dates",
  CenterUser: "centerusers", CenterUsers: "centerusers", CenterManager: "centerusers",
  StudentsFreelancing: "students_freelancing_profiles",
  StudentQuizQuestions: "student_quiz_questions",
  LectureRecording: "lecture_recordings", LectureRecordings: "lecture_recordings",
  LearningResource: "learning_resources", LearningResoruces: "learning_resources",
  EmailVerification: "email_verifications",
  AdmissionControl: "admission_controls",
  TicketReply: "ticket_replies",
  Notification: "notifications",
  EmailOutbox: "email_outbox",
  BrevoContact: "brevo_contacts",
  Admin: "admins",
  ActivityLog: "activity_log",
  TrainerAttendanceNote: "trainer_attendance_notes",
  EmailSendQuota: "email_send_quota",
};

/** Tables deliberately not answerable in chat, with the reason. */
export const EXCLUDED = {
  "information_schema": "schema introspection; the bot reads the schema itself at startup",
  email_campaigns: "email delivery internals",
  email_campaign_recipients: "email delivery internals",
  email_outbox: "email delivery internals",
  email_send_quota: "email delivery internals",
  email_verifications: "sign-up verification codes (sensitive)",
  brevo_contacts: "email provider sync",
  admins: "staff accounts / authentication",
  centerusers: "staff accounts / authentication",
  admission_control: "portal configuration",
  admission_controls: "portal configuration",
  center_admission_mapping: "portal configuration",
  center_course_mapping: "portal configuration",
  activity_log: "audit trail of edits",
  notifications: "in-app notification feed",
  student_quiz_questions: "quiz answer keys (exam integrity)",
  student_quiz_answers: "individual quiz answers (exam integrity)",
  ticket_replies: "private ticket conversations",
  trainer_attendance_notes: "internal HR notes",
  "<dynamic>": "table chosen at runtime by an internal purge/maintenance routine",
  "<auth-tokens>": "login refresh tokens (authentication secret)",
};

/** table → entity names that read it. */
export function tableCoverage() {
  const map = {};
  for (const [name, e] of Object.entries(ENTITIES)) {
    for (const t of Object.keys(e.uses)) (map[t] ||= []).push(name);
  }
  return map;
}

/** Parse queries.txt into entries: { section, no, source, text, tables }. */
export function parseInventory(text) {
  const lines = String(text).replace(/\r/g, "").split("\n");
  const out = [];
  let section = null;
  let cur = null;
  for (const line of lines) {
    const sec = line.match(/^([A-D])\. /);
    if (sec) {
      section = sec[1];
      continue;
    }
    if (!section) continue;
    const head = line.match(/^\s{0,3}(\d{1,3})\. (\S+:\d+|\S+\.js:\d+)/);
    if (head) {
      cur = { section, no: head[1], source: head[2], text: "" };
      out.push(cur);
      continue;
    }
    if (cur && /^\s{3,}\S/.test(line)) cur.text += `${line.trim()} `;
  }
  for (const q of out) q.tables = tablesOf(q.text);
  return out;
}

function tablesOf(text) {
  const tables = new Set();
  if (/information_schema/i.test(text)) tables.add("information_schema");
  const sql = text.match(/Query source:\s*`([^`]*)`/)?.[1] || "";
  if (/\$\{(?:source\.)?table\}/.test(text)) tables.add("<dynamic>");
  if (/token_hash/.test(text)) tables.add("<auth-tokens>");
  for (const m of sql.matchAll(/\b(?:from|join)\s+`?([a-z_]+)`?/gi)) {
    if (m[1].toLowerCase() !== "information_schema") tables.add(m[1]);
  }
  if (!sql) {
    const model = text.match(/^([A-Za-z_]+)\.(findAll|findOne|findByPk|count|sum|max|min|findAndCountAll|findOrCreate|query|aggregate)/)?.[1];
    if (model && MODEL_TABLE[model]) tables.add(MODEL_TABLE[model]);
    if (/^db\.query/.test(text)) tables.add("<llm-sql>");
  }
  return [...tables];
}

/** Classify every entry. Returns { entries:[...{covered, by, reason}], summary }. */
export function coverage(text) {
  const cov = tableCoverage();
  const entries = parseInventory(text).map((q) => {
    if (q.tables.includes("<llm-sql>"))
      return { ...q, covered: "replaced", reason: "the LMS's AI SQL path; this bot uses fixed handlers instead (never runs LLM SQL)" };
    if (!q.tables.length) return { ...q, covered: "unknown" };
    const by = [...new Set(q.tables.flatMap((t) => cov[t] || []))];
    const excluded = q.tables.filter((t) => EXCLUDED[t]);
    if (by.length) return { ...q, covered: "intent", by };
    if (excluded.length) return { ...q, covered: "excluded", reason: EXCLUDED[excluded[0]] };
    return { ...q, covered: "unknown" };
  });
  const summary = entries.reduce((s, e) => ((s[e.covered] = (s[e.covered] || 0) + 1), s), {});
  return { entries, summary };
}

export function readInventoryFile(path) {
  return fs.readFileSync(path, "utf8");
}
