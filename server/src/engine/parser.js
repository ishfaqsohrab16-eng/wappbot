import { fold } from "../db/catalog.js";
import { resolveBatch, resolveCenter, resolveCourse, resolveEnum, resolveDate } from "./dictionary.js";
import { romanizeUrdu, asciiDigits, hasUrdu, ROMAN_WORDS } from "./urdu.js";

// Natural language → plan, deterministically. A plan is:
// { op, entity, dim, filters: {batch:{ids,label}, center, course, gender, status, ..., date}, ident, limit, want, confidence }

const LOOKUP_ENTITIES = new Set(["batch", "center", "course"]);

// Common misspellings / Roman Urdu / short forms → canonical words.
const SPELL = {
  studnt: "student", studnts: "students", stdents: "students", studens: "students", studetns: "students", sudents: "students", studdents: "students", stds: "students", studs: "students", stu: "student", talba: "students", talib: "student",
  centr: "center", cntr: "center", centrs: "centers", cnter: "center", centar: "center", sentar: "center", senter: "center", cneter: "center",
  cours: "course", corse: "course", coarse: "course", corses: "courses", cource: "course",
  btch: "batch", bach: "batch", bacth: "batch", batc: "batch", batchs: "batches", bathc: "batch",
  trainr: "trainer", traner: "trainer", trainor: "trainer", tranier: "trainer", tecaher: "teacher", techer: "teacher",
  attendence: "attendance", attandance: "attendance", attendnce: "attendance", atendance: "attendance", attandence: "attendance", haziri: "hazri",
  earnigs: "earnings", earings: "earnings", earnngs: "earnings", erning: "earning",
  candidats: "candidates", candidtes: "candidates", canidates: "candidates", applicnts: "applicants",
  assignmnt: "assignment", assigment: "assignment", assignmnts: "assignments", assigments: "assignments",
  detials: "details", detals: "details", deatils: "details", detail: "details", dtails: "details", infomation: "information", informaton: "information",
  cnic: "cnic", nic: "cnic", "id card": "cnic", shanakhti: "cnic",
  femal: "female", femails: "females", femail: "female", mal: "male",
  hw: "how", mny: "many", meny: "many", manny: "many", hou: "how",
  kitnay: "kitne", kitny: "kitne", ketne: "kitne", kitnee: "kitne", kitni: "kitne", kitna: "kitne", kinte: "kitne",
  lst: "list", lis: "list", shw: "show", sho: "show",
  todey: "today", tday: "today", tody: "today", yestarday: "yesterday", yesterdy: "yesterday",
  mnth: "month", mont: "month", wek: "week",
  totl: "total", totel: "total", ttl: "total",
  avrage: "average", avg: "average", averge: "average",
  vise: "wise", vize: "wise", wais: "wise", waise: "wise", summed: "sum", summ: "sum", ernings: "earnings", earnig: "earning",
  andget: "and get", schedul: "schedule", scheduls: "schedules", shedule: "schedule", sheduls: "schedules", schedual: "schedule",
  organisation: "organization", organiztion: "organization", orginization: "organization",
  qta: "quetta", qetta: "quetta", kwetta: "quetta", khi: "karachi", lhr: "lahore", isb: "islamabad",
};

const OP = {
  help: /\b(help|madad|what can you do|what do you do|commands?|menu|options|kya kar sakt[ae]|capabilities)\b/,
  avg: /\b(average|mean|ausat|avg)\b/,
  top: /\b(top|highest|best|most|maximum|toppers?|leaders?|leaderboard|sab se zyada|zyada se zyada|rank(?:ing)?)\b/,
  sum: /\b(sum|sums|sum up|add up|amount|amounts|how much|kitne paise|kitni raqam|raqam|total earnings?|total amount|total income|kamai|jama|figure)\b/,
  late: /\b(late|latecomers?|der se|on time|ontime|punctual\w*|delay(?:ed)?|match(?: \w+){0,3} (?:with )?(?:the )?(?:class )?schedules?|compare(?: \w+){0,3} (?:with )?(?:the )?(?:class )?schedules?)\b/,
  count: /\b(how many|count|number of|no of|total|tadad|tadaad|ginti|kitne|quantity|qty)\b/,
  details: /\b(details|information|info|profile|record|about|maloomat|tafseel|data of|full data|complete data|bio)\b/,
  list: /\b(list|show|display|names?|who|kon|kaun|konsa|konse|kon kon|dikhao|dikha|batao|bata|give|send|share|all|sab|sare|saray|which|kis|kin)\b/,
  current: /\b(current|currently|running|ongoing|active now|latest|present|abhi|chal rah[aie]|newest|recent|now)\b/,
};

const DIM_WORDS = {
  batch: "batch|batches|session|sessions|intake",
  center: "center|centers|centre|centres|campus|campuses|branch|branches|location|locations",
  course: "course|courses|program|programs|trade|trades",
  gender: "gender|genders|sex|male female|boys girls",
  district: "district|districts|area|areas|domicile",
  qualification: "qualification|qualifications|education|degree|degrees",
  status: "status|statuses|state",
  city: "city|cities|shehar",
  platform: "platform|platforms|website|marketplace",
  type: "type|types|kind|category|categories",
};

const DIM_RE = Object.fromEntries(
  Object.entries(DIM_WORDS).map(([d, w]) => [
    d,
    new RegExp(`\\b(?:by|per|each|every|har|according to|across|split by|group(?:ed)? by|breakdown by|distribution by)\\s+(?:${w})\\b|\\b(?:${w})[\\s-]?(?:wise|wize|wice)\\b|\\b(?:${w})\\s+(?:ke hisab|ke lehaz|k hisab|breakdown|distribution)\\b`),
  ])
);

const REFER_LIST =
  /\b(name them|list them|show them|send them|their names|names of (?:all )?(?:these|them|those|the above)|which (?:ones|are they)|kon kon|kaun kaun|konse hain|naam batao|naam bata|names please|the names|list of (?:these|them|those)|all of them|show all|give (?:me )?(?:the )?list)\b|^(names?|list|naam)$/;
const OTHERS = /\b(others?|the rest|rest of (?:them|the)|remaining|baqi|baaqi|baki|everyone else|all other)\b/;

/** Message that only makes sense with the previous question. */
export function isFollowUpText(t) {
  return /^(and|aur|what about|how about|or|also|same for|now|ab|sirf|only)\b/.test(t) || FOLLOW_REF.test(t) || REFER_LIST.test(t) || OTHERS.test(t);
}

/** A learned key with no data words in it ("what are you") is never trusted. */
export function isGenericKey(key) {
  const k = String(key || "");
  if (/\{\w+\}/.test(k)) return false;
  return !k
    .split(/\s+/)
    .some((w) => w.length >= 3 && !STOP.has(w) && !NOT_NAME.has(w) && !/^(you|your|are|what|who|how|why|when|where|there|doing)$/.test(w));
}

const PRONOUN = /\b(there|their|them|these|those|unka|inka|unki|inki|unke|inke)\b/;
const FOLLOW_REF =/\b(his|her|their|uska|uski|uske|iska|iski|iske|is ka|us ka|unka|inka|this student|that student|same student|same person|is student|us student|wo|woh)\b/;
const EXPORT = {
  excel: /\b(excel|xlsx|xls|sheet|spreadsheet|csv|export|download)\b/,
  chart: /\b(chart|graph|pie|bar chart|plot|visual|visuali[sz]e|diagram|graphic)\b/,
  word: /\b(word file|word doc|docx|word document|doc file|word|report file|generate (?:a )?report|make (?:a )?report|full report|pdf)\b/,
};

const STOP = new Set(
  `a an the of in on at for to is are was were be been it this that these those me my you your i we they them
   and or not if from with as by so very just please plz pls can could would should will do did does tell give show find get what which who
   how many much number total all any some also only about there here hai hain ka ki ke ko mein me se aur kya ye yeh wo woh hy he hy
   batao bata dain dein do kar karo karein mujhe hamein humain hume ap aap please kindly now currently our we have has had`.split(/\s+/)
);

function levenshtein(a, b) {
  if (a === b) return 0;
  const m = Array.from({ length: b.length + 1 }, (_, i) => [i]);
  for (let j = 0; j <= a.length; j++) m[0][j] = j;
  for (let i = 1; i <= b.length; i++)
    for (let j = 1; j <= a.length; j++)
      m[i][j] = Math.min(m[i - 1][j] + 1, m[i][j - 1] + 1, m[i - 1][j - 1] + (b[i - 1] === a[j - 1] ? 0 : 1));
  return m[b.length][a.length];
}

let vocab = null;
function vocabulary(entities) {
  if (vocab?.src === entities) return vocab.words;
  const words = new Set(Object.values(SPELL));
  for (const e of Object.values(entities)) for (const w of e.words) for (const p of w.split(" ")) words.add(p);
  for (const w of Object.values(DIM_WORDS).join("|").split("|")) for (const p of w.split(" ")) words.add(p);
  "how many count list show details information total average highest today yesterday month week year female male present absent active removed admitted approved current running latest excel chart graph report"
    .split(" ")
    .forEach((w) => words.add(w));
  vocab = { src: entities, words: [...words].filter((w) => w.length >= 4) };
  return vocab.words;
}

/** Lowercase, fix common misspellings, keep identifiers intact. */
export function normalize(text, entities = {}) {
  let t = romanizeUrdu(text)
    .toLowerCase()
    .replace(/[’'`]/g, "")
    .replace(/[?!.,;:()[\]{}"]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const words = vocabulary(entities);
  t = t
    .split(" ")
    .map((w) => {
      if (SPELL[w]) return SPELL[w];
      if (w.length < 5 || /\d/.test(w) || STOP.has(w) || words.includes(w)) return w;
      let best = null;
      for (const v of words) {
        if (Math.abs(v.length - w.length) > 2 || v[0] !== w[0]) continue;
        const d = levenshtein(w, v);
        if (d <= (w.length >= 8 ? 2 : 1) && (!best || d < best.d)) best = { v, d };
      }
      return best ? best.v : w;
    })
    .join(" ");
  return t;
}

/** CNIC / phone / roll number / email in the message. */
export function extractIdent(text) {
  const raw = String(text || "");
  const cnic = raw.match(/\b(\d{5})[-\s]?(\d{7})[-\s]?(\d)\b/);
  if (cnic) return { type: "cnic", value: `${cnic[1]}${cnic[2]}${cnic[3]}`, display: `${cnic[1]}-${cnic[2]}-${cnic[3]}` };
  const roll = raw.match(/\b([A-Za-z]{1,6}\d{0,3}-\d{3,}(?:-\d{1,3})?)\b/);
  if (roll) return { type: "rollno", value: roll[1].toUpperCase(), display: roll[1].toUpperCase() };
  const phone = raw.match(/(?:\+?92|0092|\b0)[-\s]?(3\d{2})[-\s]?(\d{7})\b/);
  if (phone) return { type: "phone", value: `${phone[1]}${phone[2]}`, display: `0${phone[1]}${phone[2]}` };
  const email = raw.match(/[\w.+-]+@[\w-]+\.[\w.]+/);
  if (email) return { type: "email", value: email[0].toLowerCase(), display: email[0].toLowerCase() };
  return null;
}

/** All entity mentions, longest phrase first. */
let SYNONYMS = {}; // learned words → entity, set per parse

// Words that also appear in more specific subjects ("quiz marks", "syllabus topics"):
// they only decide the subject when nothing more specific is named.
const WEAK = new Set(["marks", "score", "scores", "final", "syllabus", "curriculum", "outline", "profiles", "task", "tasks", "query", "queries", "session", "sessions", "teaching", "support"]);

function findEntities(t, entities) {
  const hits = [];
  for (const [w, name] of Object.entries(SYNONYMS)) {
    if (!entities[name] || !/^[a-z]+$/.test(w)) continue;
    for (const m of t.matchAll(new RegExp(`\\b${w}\\b`, "g"))) hits.push({ name, len: w.length, pos: m.index, word: w, learned: true });
  }
  for (const [name, e] of Object.entries(entities)) {
    for (const w of e.words) {
      const re = new RegExp(`\\b${w.replace(/ /g, "\\s+")}\\b`, "g");
      for (const m of t.matchAll(re)) hits.push({ name, len: WEAK.has(w) ? 1 : w.length, pos: m.index, word: w });
    }
  }
  return hits.sort((a, b) => b.len - a.len || a.pos - b.pos);
}

// Words that are never part of a person's name.
const NOT_NAME = new Set(
  ("others other rest remaining baqi baki these those them ones name names list naam you your yourself bot assistant something anything nothing thing things stuff odd weird need want know check help idea question answer reply message good job nice great bad well done sorry okay yes no sure really very much more thanks thank welcome fine cool awesome perfect correct wrong right again try test testing hello there bye see later morning evening night weather time date day news price " +
  "find search who whos kon kaun hai dhoond dhundo talash details information info profile about record named naam the ka ki ke ko please plz tell send give show get data full complete phone number contact email address father cnic roll rollno mobile whatsapp batch center course his her uska uski iska iski wala wali " +
  "match both compare late early ontime punctual class classes ma mai main to ni nai nahi nahin tha thi thay aaj kal abhi koi sab tamam sare kitne kitni " +
  "org organization organisation company institute program programme project department team office website your our yours ours man bro dude yaar buddy " +
  "there their sum summed amount amounts approved figure total yes haan han ji jee no nope wrong galat correct sahi meant mean said asked").split(" ")
);

function knownWords(entities) {
  const known = new Set([...STOP, ...vocabulary(entities), ...Object.keys(SYNONYMS), ...ROMAN_WORDS]);
  for (const e of Object.values(entities)) for (const w of e.words) for (const p of w.split(" ")) known.add(p);
  for (const w of Object.values(DIM_WORDS).join("|").split("|")) for (const p of w.split(" ")) known.add(p);
  for (const re of Object.values(OP)) for (const m of String(re.source).match(/[a-z]{3,}/g) || []) known.add(m);
  "today yesterday week month year this last previous current running latest male female boys girls active removed admitted approved present absent excel chart graph word report pdf sheet export download top average highest lowest"
    .split(" ")
    .forEach((w) => known.add(w));
  return known;
}

const NAME_RE = /\b(?:named|name is|naam|called|of|student|trainer|candidate|applicant|for|about)\s+([a-z][a-z.]+(?:\s+[a-z][a-z.]+){0,3})\s*$/;

const GENDER_WORDS = /\b(girls?|boys?|female|females|male|males|women|men|ladies|larki|larkiyan|larkay|larke|khawateen)\b/;
const PERSON = new Set(["student", "trainer", "candidate"]);
const ENUM_FILTERS = ["gender", "status", "district", "qualification", "city", "platform", "type"];

/**
 * Choose the subject. Lookup words used as filters ("batch 10", "Quetta center")
 * and dimension words ("by center") are not the subject; "student" is a generic
 * qualifier when a more specific record is named ("student leaves").
 * Returns { name, defaulted } (defaulted = only filters were named).
 */
function pickEntity(t, entities, filters, dimPhrase) {
  const scan = dimPhrase ? t.replace(dimPhrase, " ") : t;
  const hits = findEntities(scan, entities);
  const usedAsFilter = (name) =>
    (name === "batch" && filters.batch) || (name === "center" && filters.center) || (name === "course" && filters.course);
  const mains = hits.filter((h) => !LOOKUP_ENTITIES.has(h.name) && !usedAsFilter(h.name));
  const specific = mains.find((h) => h.name !== "student");
  if (specific) return { name: specific.name };
  if (mains.length) return { name: mains[0].name };
  const lookup = hits.find((h) => !usedAsFilter(h.name));
  if (lookup) return { name: lookup.name };
  if (hits.length || GENDER_WORDS.test(t) || (OP.count.test(t) && Object.keys(filters).length))
    return { name: entities.student ? "student" : hits[0]?.name, defaulted: true };
  return { name: null };
}

function resolveEnums(plan, dict, entities, t) {
  const e = entities[plan.entity];
  if (!e) return;
  for (const f of ENUM_FILTERS) {
    if (!e.filters?.[f] || plan.filters[f]) continue;
    const r = resolveEnum(dict, plan.entity, f, t, e);
    if (r) plan.filters[f] = r;
  }
  if (plan.filters.district && plan.filters.center && !/\bdistrict\b/.test(t)) delete plan.filters.district;
  if (plan.dim && plan.filters[plan.dim] && plan.dim !== "batch") delete plan.filters[plan.dim];
}

/** Pick the operation; explicit = the user said which (count/list/...). */
function pickOp(plan, e, t) {
  const has = (k) => OP[k].test(t);
  const pick = (op, explicit = true) => ({ op, explicit });
  if (!e) return has("help") ? pick("help") : pick(null, false);
  if (has("avg") && e.avg && Object.keys(e.avg).length) return pick("avg");
  if (has("top") && e.top) return pick("top");
  if (e.sum && has("sum")) return pick("sum");
  // "total earnings", "kitni earning": money is summed; counting needs "how many / entries".
  if (e.sum && !plan.dim && /\b(total|kitne|tadad|overall|all)\b/.test(t) && !/\b(how many|count|number of|no of|entries|records|kitne (?:log|students|entries))\b/.test(t)) return pick("sum");
  if (plan.dim) return pick("count_by");
  if (plan.entity === "batch" && has("current") && !has("count")) return pick("current");
  if (plan.ident && (has("details") || !has("count"))) return pick(e.student && plan.entity !== "student" ? "list" : "details");
  if (has("count")) return pick("count");
  if (has("details")) return pick(e.details?.length && (e.idents || LOOKUP_ENTITIES.has(plan.entity)) ? "details" : "list");
  if (has("list") || plan.want.excel) return pick("list");
  if (e.sum) return pick("sum", false);
  // "attendance today at ITTI": present / absent / leave split is the useful answer.
  if (e.defaultDim && !plan.filters[e.defaultDim]) {
    plan.dim = e.defaultDim;
    return pick("count_by", false);
  }
  return pick(e.defaultOp || (LOOKUP_ENTITIES.has(plan.entity) && !Object.keys(plan.filters).length ? "list" : "count"), false);
}

/**
 * Parse one message. dict = live dictionary, entities = active catalogue,
 * last = previous plan in this chat (for follow-ups).
 */
export function parse(text, { dict, entities, last, synonyms = {} } = {}) {
  SYNONYMS = synonyms;
  const t = normalize(text, entities);
  const plan = { op: null, entity: null, dim: null, filters: {}, ident: null, limit: null, want: {}, text: t };

  for (const [k, re] of Object.entries(EXPORT)) if (re.test(t)) plan.want[k] = true;
  plan.ident = extractIdent(asciiDigits(text));

  // Lookup filters (fuzzy-matched against real batches / centers / courses)
  const batch = resolveBatch(dict, t);
  if (batch) plan.filters.batch = batch;
  const center = resolveCenter(dict, t.replace(/\b(students?|trainers?|batch \d+)\b/g, " "));
  if (center) plan.filters.center = center;
  const course = resolveCourse(dict, t.replace(/\bcourses?\b/g, " "));
  if (course) plan.filters.course = course;
  const date = resolveDate(t);
  if (date) plan.filters.date = date;

  // Breakdown dimension
  let dimPhrase = null;
  for (const [d, re] of Object.entries(DIM_RE)) {
    const m = t.match(re);
    if (m) {
      plan.dim = d;
      dimPhrase = m[0];
      break;
    }
  }
  if (!plan.dim && /\bmale\s+(?:and|&|vs|or)\s+female\b|\bboys\s+(?:and|&|vs)\s+girls\b|\bgirls\s+(?:and|&|vs)\s+boys\b/.test(t)) plan.dim = "gender";

  // Subject
  const picked = pickEntity(t, entities, plan.filters, dimPhrase);
  plan.entity = picked.name;
  let defaulted = Boolean(picked.defaulted);
  if (entities.attendance && /\b(present|absent|absentees|hazir|ghair hazir|attendance|hazri)\b/.test(t) && !/\b(trainer|teacher)s?\b/.test(t)) {
    plan.entity = "attendance";
    defaulted = false;
  }
  if (entities.trainer_leave && plan.entity === "leave" && /\b(trainer|teacher)s?\b/.test(t)) plan.entity = "trainer_leave";
  if (entities.trainer_attendance && /\b(trainer|teacher)s?\b/.test(t) && /\b(attendance|present|absent|check ?in|checkout)\b/.test(t)) plan.entity = "trainer_attendance";
  // "which trainers are assigned to ITTI": the allocation, not the trainer record
  if (entities.allocation && plan.entity === "trainer" && /\b(assigned|allocated|allocations?|posted|postings?)\b/.test(t)) plan.entity = "allocation";
  // "average assignment marks" → submissions carry the marks
  if (entities.submission && plan.entity === "assignment" && /\b(average|avg|marks|obtained|score)\b/.test(t)) plan.entity = "submission";
  // "when does batch 9 end at ITTI", "batch start date": per-center batch dates
  if (entities.center_dates && /\b(start|starts|starting|begin|begins|end|ends|ending|shuru|khatam|close|closes)\b/.test(t) && /\b(batch|session|class|classes|training)\b/.test(t) && (!plan.entity || defaulted || ["batch", "student"].includes(plan.entity)) && !OP.count.test(t)) {
    plan.entity = plan.filters.center || !entities.batch ? "center_dates" : "batch";
    if (plan.entity === "batch" && plan.filters.batch?.ids?.length) {
      plan.op = "details";
      plan.lookupIds = plan.filters.batch.ids;
      delete plan.filters.batch;
    }
    defaulted = false;
  }
  // "centers in quetta", "list centres of sibi": those center records
  if (entities.center && plan.filters.center && /\b(centers|centres|campuses|markaz)\b/.test(t) && !OP.count.test(t) && (!plan.entity || defaulted || plan.entity === "center")) {
    plan.entity = "center";
    plan.op = "list";
    plan.lookupIds = plan.filters.center.ids;
    delete plan.filters.center;
    defaulted = false;
  }
  // "late trainers", "was Shafi late today", "match them with class schedules":
  // trainer check-ins compared with the class schedule. Students have their own
  // "late" attendance status, so only when no student word is used.
  if (entities.trainer_attendance && entities.schedule && OP.late.test(t) && !/\b(students?|learners?|trainees?)\b/.test(t)) {
    const trainerTalk = /\b(trainer|teacher|instructor)s?\b/.test(t) || ["trainer", "trainer_attendance", "schedule"].includes(last?.entity);
    if (trainerTalk || !plan.entity || plan.entity === "schedule") {
      if (["trainer_attendance", "schedule"].includes(last?.entity)) plan.filters = { ...(last.filters || {}), ...plan.filters };
      plan.entity = "trainer_attendance";
      plan.op = "late";
      defaulted = false;
    }
  }
  // Only a breakdown was named ("course wise", "list corse vise"): students.
  if (!plan.entity && plan.dim && entities.student && !last) {
    plan.entity = "student";
    defaulted = true;
  }
  // "amount summed up", "total figure": money lives in earnings.
  if ((!plan.entity || (defaulted && plan.entity === "student")) && entities.earning && OP.sum.test(t) && !OP.count.test(t.replace(/\btotal\b/g, ""))) {
    plan.entity = "earning";
    defaulted = false;
  }
  // "top students by score" → the record that supports the ranking
  for (const k of ["top", "avg"]) {
    if (OP[k].test(t) && plan.entity && !entities[plan.entity]?.[k]) {
      const alt = findEntities(t, entities).find((h) => entities[h.name]?.[k] && (k !== "avg" || Object.keys(entities[h.name].avg).length));
      if (alt) plan.entity = alt.name;
    }
  }

  // Filters only, about the batch/center/course itself: "current batch", "batch 9 details"
  if (defaulted && (!last || OP.details.test(t)) && !plan.ident && !plan.dim && !GENDER_WORDS.test(t) && !OP.count.test(t) && !OP.list.test(t)) {
    const only = Object.keys(plan.filters).filter((k) => k !== "date");
    if (only.length === 1 && entities[only[0]]) {
      const k = only[0];
      if (k === "batch" && plan.filters.batch.current) {
        plan.entity = "batch";
        plan.op = "current";
      } else {
        plan.entity = k;
        plan.op = "details";
        plan.lookupIds = plan.filters[k].ids;
      }
      delete plan.filters[k];
      defaulted = false;
    }
  }

  resolveEnums(plan, dict, entities, t);
  const e = plan.entity ? entities[plan.entity] : null;
  if (!plan.dim && /\b(breakdown|distribution|split|wise)\b/.test(t) && e?.defaultDim) plan.dim = e.defaultDim;
  const topN = t.match(/\btop\s+(\d{1,2})\b/) || t.match(/\b(\d{1,2})\s+(?:top|best|highest)\b/);
  if (topN) plan.limit = Math.min(50, Number(topN[1]));

  let opExplicit = true;
  if (!plan.op) {
    const o = pickOp(plan, e, t);
    plan.op = o.op;
    opExplicit = o.explicit;
  }

  // Name search: "details of Ali Khan", "student named Sara", "find ali khan", "Ali Khan"
  const known = knownWords(entities);
  const consumedLabels = new Set(
    [plan.filters.center?.label, plan.filters.course?.label, plan.filters.district?.label].filter(Boolean).flatMap((s) => fold(s).split(" "))
  );
  const blockedOps = ["count", "count_by", "sum", "avg", "top", "help", "current"];
  const isNameWord = (w) => /^[a-z]{3,}$/.test(w) && !known.has(w) && !consumedLabels.has(w) && !NOT_NAME.has(w);
  // "was Shafi late today", "Shafi trainer late": the trainer's name narrows the check.
  if (plan.op === "late" && !plan.ident && !hasUrdu(text)) {
    const words = t.split(" ").filter(isNameWord);
    if (words.length >= 1 && words.length <= 3)
      plan.ident = { type: "name", value: words.join(" "), display: words.map((w) => w[0].toUpperCase() + w.slice(1)).join(" ") };
  }
  if (!plan.ident && !plan.lookupIds && (!plan.entity || PERSON.has(plan.entity)) && !(opExplicit && blockedOps.includes(plan.op)) && !plan.dim) {
    const words = t.split(" ").filter((w) => /^[a-z]{2,}$/.test(w) && !known.has(w) && !consumedLabels.has(w) && !NOT_NAME.has(w));
    const asked = /\b(find|search|who is|whos|kon hai|kaun hai|dhoond|dhundo|talash|details|information|info|profile|about|record|named|naam|called)\b/.test(t);
    const short = t.split(" ").length <= 4 && words.length >= 2;
    // "trainer Shafi" / "Ali Khan student": the name sits right next to the person word.
    const tw = t.split(" ");
    const pos = tw.findIndex((w) => entities[plan.entity]?.words.includes(w));
    const runAt = (i, step) => {
      const r = [];
      for (let j = i; j >= 0 && j < tw.length && r.length < 4 && isNameWord(tw[j]); j += step) r.push(tw[j]);
      return step < 0 ? r.reverse() : r;
    };
    const adjacent = pos >= 0 ? (runAt(pos + 1, 1).length ? runAt(pos + 1, 1) : runAt(pos - 1, -1)) : [];
    const namedSubject = plan.entity && !defaulted && PERSON.has(plan.entity) && adjacent.length >= 1 && !Object.keys(plan.filters).length;
    if (namedSubject && !asked) words.splice(0, words.length, ...adjacent);
    if (words.length >= 1 && words.length <= 4 && (asked || (short && !plan.entity) || namedSubject)) {
      plan.ident = { type: "name", value: words.join(" "), display: words.map((w) => w[0].toUpperCase() + w.slice(1)).join(" ") };
      plan.nameAsked = asked || (Boolean(plan.entity) && !defaulted);
      if (!plan.entity || defaulted) {
        plan.entity = "student";
        plan.personSearch = true; // also try applicants / trainers if no student matches
        defaulted = false;
      }
      plan.op = entities[plan.entity]?.student && plan.entity !== "student" ? "list" : "details";
    }
  }

  // A bare CNIC / roll number / phone / email: look the person up.
  if (plan.ident && plan.ident.type !== "name" && (!plan.entity || defaulted)) {
    plan.entity = "student";
    plan.op = "details";
    plan.personSearch = true;
    plan.nameAsked = true;
    defaulted = false;
  }

  // Just a center / course / batch name with nothing else ("ITTI") → that record
  if (!plan.entity && !plan.ident && !last) {
    for (const k of ["center", "course", "batch"]) {
      if (plan.filters[k]?.ids?.length && entities[k]) {
        plan.entity = k;
        plan.op = "details";
        plan.lookupIds = plan.filters[k].ids;
        delete plan.filters[k];
        break;
      }
    }
  }

  // Follow-ups: "his attendance", "and batch 9?", "what about girls", "by center", "turbat"
  plan.followUp = false;
  if (last?.entity && (!plan.entity || plan.entity === last.entity || defaulted) && (!plan.ident || plan.ident.type === "name")) {
    // "name them", "give me names of all these" → list what was just counted
    if (REFER_LIST.test(t)) {
      Object.assign(plan, { entity: last.entity, op: "list", dim: null, filters: { ...(last.filters || {}), ...plan.filters }, ident: last.ident || null, followUp: true });
      delete plan.lookupIds;
    } else if (OTHERS.test(t)) {
      // "what about others / the rest" → same question without its most specific filter
      const f = { ...(last.filters || {}) };
      const drop = ["center", "course", "district", "gender", "status", "qualification", "city", "platform", "type", "batch"].find((k) => f[k]);
      if (drop) delete f[drop];
      Object.assign(plan, { entity: last.entity, op: last.op, dim: last.dim, filters: { ...f, ...plan.filters }, ident: null, followUp: true });
      if (drop && last.filters[drop]?.ids) plan.exclude = { [drop]: { ids: last.filters[drop].ids, label: last.filters[drop].label } };
      delete plan.lookupIds;
    }
  }
  // "their amount", "un ka total": same subject as before, keep its filters.
  if (last?.entity && !plan.followUp && plan.entity === last.entity && PRONOUN.test(t) && !plan.ident) {
    plan.filters = { ...(last.filters || {}), ...plan.filters };
    plan.followUp = true;
  }
  if (last?.entity && !plan.followUp) {
    const startsLikeFollowUp = /^(and|aur|what about|how about|or|also|same for|now|ab|sirf|only)\b/.test(t);
    if (!plan.ident && FOLLOW_REF.test(t) && last.ident) {
      plan.ident = last.ident;
      plan.followUp = true;
      if (!plan.entity || defaulted) {
        plan.entity = last.entity;
        plan.op = "details";
      }
    }
    const noSubject = !plan.entity || (defaulted && !/\bstudents?\b/.test(t));
    const hasModifier = Object.keys(plan.filters).length || plan.dim || Object.keys(plan.want).length;
    if (!plan.followUp && noSubject && (hasModifier || startsLikeFollowUp)) {
      plan.followUp = true;
      plan.entity = last.entity;
      plan.filters = { ...(last.filters || {}), ...plan.filters };
      if (plan.dim) plan.op = "count_by";
      else if (opExplicit && plan.op && !["details", "list"].includes(plan.op)) plan.dim = null;
      else {
        plan.op = last.op;
        plan.dim = last.dim;
      }
      if (!plan.ident && last.ident) plan.ident = last.ident;
      resolveEnums(plan, dict, entities, t);
    }
  }

  // Attendance of one student → breakdown by status
  if (plan.entity === "attendance" && plan.ident && !(opExplicit && plan.op === "count") && plan.op !== "count_by") {
    plan.op = "count_by";
    plan.dim = "status";
  }

  // Confidence: how much of the message we understood.
  const consumed = [plan.filters.center?.label, plan.filters.course?.label, plan.filters.district?.label, plan.ident?.display]
    .filter(Boolean)
    .map((s) => fold(s))
    .join(" ");
  const unknown = t
    .replace(/\b\d+\b/g, " ")
    .split(" ")
    .filter((w) => w.length >= 3 && !known.has(w) && !consumed.includes(w) && !NOT_NAME.has(w) && w !== "_u_");
  plan.unknown = unknown;
  const urduUnknown = t.split(" ").filter((w) => w === "_u_").length;
  let c = plan.entity && plan.op ? 0.9 : plan.op === "help" ? 0.9 : 0.2;
  c -= Math.min(0.5, unknown.length * 0.12 + urduUnknown * 0.05);
  if (plan.followUp) c = Math.max(c, 0.75);
  plan.confidence = Math.max(0, Math.round(c * 100) / 100);
  return plan;
}

/** Text with extracted values replaced by slots, for learned patterns. */
export function slotKey(plan) {
  let t = ` ${plan.text} `;
  const sub = (re, slot) => (t = t.replace(re, ` {${slot}} `));
  sub(/\b\d{5}-?\d{7}-?\d\b/g, "cnic");
  sub(/\b[a-z]{1,6}\d{0,3}-\d{3,}(?:-\d{1,3})?\b/g, "rollno");
  sub(/(?:\+?92|0092|\b0)[-\s]?3\d{2}[-\s]?\d{7}\b/g, "phone");
  sub(/[\w.+-]+@[\w-]+\.[\w.]+/g, "email");
  sub(/\b(?:batch|session)\s*\d{1,3}\b|\b\d{1,3}(?:st|nd|rd|th)?\s+batch\b/g, "batch");
  sub(/\b20\d{2}-\d{1,2}-\d{1,2}\b|\b\d{1,2}[/.]\d{1,2}[/.]20\d{2}\b/g, "date");
  for (const f of ["center", "course", "district", "city", "platform"]) {
    const label = plan.filters?.[f]?.label;
    if (!label) continue;
    for (const part of String(label).split(", ")) {
      const fp = fold(part);
      if (fp && t.includes(` ${fp} `)) {
        t = t.replace(` ${fp} `, ` {${f}} `);
        continue;
      }
      // Partial name ("itti" for "ITTI Quetta"): replace the words that appear
      let placed = t.includes(`{${f}}`);
      for (const w of fp.split(" ").filter((x) => x.length >= 3)) {
        if (!t.includes(` ${w} `)) continue;
        t = t.replace(` ${w} `, placed ? " " : ` {${f}} `);
        placed = true;
      }
    }
  }
  if (plan.ident?.type === "name") t = t.replace(plan.ident.value, "{name}");
  return t.replace(/\s+/g, " ").trim();
}
