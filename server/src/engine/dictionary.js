import { log } from "../logger.js";
import { config } from "../config.js";
import { scoreMatch, fold, ident, acronym } from "../db/catalog.js";
import { LOOKUPS } from "./entities.js";

// Real values from the database (batches, centers, courses, enum-like columns),
// used to resolve messy user words into exact filter values without an LLM.

const ENUM_FILTERS = new Set(["gender", "status", "district", "qualification", "city", "platform", "type"]);
const REFRESH_MS = 10 * 60_000;

let dict = null;
let loading = null;

function plainColumn(expr) {
  return /^[a-z][a-z0-9_]*\.[a-z_][a-z0-9_]*$/i.test(expr) ? expr : null;
}

async function load(entities, query) {
  const d = { batches: [], centers: [], courses: [], enums: {}, loadedAt: Date.now() };
  const safe = async (sql, params) => {
    try {
      return (await query(sql, params)).rows;
    } catch (err) {
      log.debug("dictionary skip:", err.code || err.message);
      return [];
    }
  };
  d.batches = (await safe("SELECT tb_id AS id, tb_name AS name, tb_slug AS slug, tb_start AS start, tb_end AS end, tb_status AS status FROM training_batches ORDER BY tb_id")).map(
    (r) => ({ ...r, id: Number(r.id), name: String(r.name ?? r.id) })
  );
  d.centers = (await safe("SELECT center_id AS id, center_name AS name, center_location AS location, center_type AS type FROM centers ORDER BY center_id")).map((r) => ({
    ...r,
    id: Number(r.id),
    name: String(r.name ?? r.id),
  }));
  d.courses = (await safe("SELECT course_id AS id, course_name AS name, course_full_name AS full FROM courses ORDER BY course_id")).map((r) => ({
    ...r,
    id: Number(r.id),
    name: String(r.name ?? r.id),
  }));
  for (const [name, e] of Object.entries(entities)) {
    for (const [f, expr] of Object.entries(e.filters || {})) {
      const col = ENUM_FILTERS.has(f) && plainColumn(expr);
      if (!col) continue;
      const [alias, column] = col.split(".");
      const table = e.from.match(new RegExp(`\`?([a-z_]+)\`?\\s+${alias}\\b`, "i"))?.[1];
      if (!table) continue;
      const rows = await safe(
        `SELECT DISTINCT ${ident(column)} AS v FROM ${ident(table)} WHERE ${ident(column)} IS NOT NULL AND ${ident(column)} <> '' LIMIT 300`
      );
      d.enums[`${name}.${f}`] = rows.map((r) => r.v).filter((v) => v !== null && v !== undefined);
    }
  }
  log.info(
    `Dictionary: ${d.batches.length} batches, ${d.centers.length} centers, ${d.courses.length} courses, ${Object.keys(d.enums).length} value lists`
  );
  return d;
}

export async function getDictionary(entities, query, { refresh = false } = {}) {
  if (dict && !refresh && Date.now() - dict.loadedAt < REFRESH_MS) return dict;
  if (loading) return loading;
  loading = load(entities, query)
    .then((d) => (dict = d))
    .finally(() => (loading = null));
  return loading;
}

export function setDictionary(d) {
  dict = { loadedAt: Date.now(), enums: {}, batches: [], centers: [], courses: [], ...d };
}

export function lookupName(d, kind, id) {
  const list = kind === "batch" ? d.batches : kind === "center" ? d.centers : kind === "course" ? d.courses : null;
  const hit = list?.find((x) => String(x.id) === String(id));
  return hit ? hit.name : undefined;
}

// ---- resolvers ------------------------------------------------------------

/** "batch 10", "b10", "10th batch", "current batch" → [{id,name}] */
// Batch numbers written as words, 1-20 (English, ordinals, Roman Urdu with common spellings).
const NUM_WORDS = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
  ek: 1, do: 2, teen: 3, char: 4, chaar: 4, panch: 5, paanch: 5, chay: 6, chhe: 6, chhay: 6, cheh: 6, saat: 7, sat: 7, aath: 8, ath: 8, nau: 9, no: 9, das: 10, dus: 10,
  gyarah: 11, gyara: 11, giyara: 11, barah: 12, bara: 12, baara: 12, terah: 13, tera: 13, chaudah: 14, choda: 14, chauda: 14,
  pandrah: 15, pandra: 15, solah: 16, sola: 16, satrah: 17, satra: 17, atharah: 18, athara: 18, unees: 19, unnees: 19, bees: 20, bis: 20,
};
const ORDINALS = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
  eleventh: 11, twelfth: 12, thirteenth: 13, fourteenth: 14, fifteenth: 15, sixteenth: 16, seventeenth: 17, eighteenth: 18, nineteenth: 19, twentieth: 20,
};
const BATCH_WORD_RE = new RegExp(
  `\\b(batch|btch|session)\\s+(${Object.keys(NUM_WORDS).join("|")})\\b|\\b(${Object.keys(ORDINALS).join("|")})\\s+(batch|session)\\b`,
  "g"
);

export function resolveBatch(d, text) {
  const t = fold(text).replace(BATCH_WORD_RE, (m, a, w1, w2) => (w1 ? `${a} ${NUM_WORDS[w1]}` : `batch ${ORDINALS[w2]}`));
  if (!d.batches.length) return null;
  if (/\b(current|running|ongoing|latest|present|this|abhi|new|newest|recent|chal rah[ai])\s+(batch|session|intake)\b/.test(t) || /\bbatch\s+(current|running|ongoing|latest)\b/.test(t)) {
    const b = d.batches.at(-1);
    return { ids: [b.id], label: b.name, current: true };
  }
  if (/\b(previous|last|pichl[ae]|pichla|purana|old)\s+(batch|session)\b/.test(t) && d.batches.length > 1) {
    const b = d.batches.at(-2);
    return { ids: [b.id], label: b.name };
  }
  const m =
    t.match(/\b(?:batch|btch|bach|bacth|b|session|intake)\s*(?:no\s*|number\s*)?(\d{1,3})\b/) ||
    t.match(/\b(\d{1,3})\s*(?:st|nd|rd|th)?\s*(?:batch|btch|session)\b/);
  if (m) {
    const n = Number(m[1]);
    const byName = d.batches.filter((b) => new RegExp(`(^|[^0-9])0*${n}([^0-9]|$)`).test(`${b.name} ${b.slug || ""}`));
    const pick = byName.length ? byName : d.batches.filter((b) => b.id === n);
    if (pick.length) return { ids: pick.map((b) => b.id), label: pick.map((b) => b.name).join(", ") };
    return { ids: [], label: `batch ${n}`, notFound: true };
  }
  // A batch name written out, e.g. "DigiBizz 10"
  for (const b of d.batches) {
    if (b.name.length >= 4 && fold(t).includes(fold(b.name))) return { ids: [b.id], label: b.name };
  }
  return null;
}

// Words too common in names to identify one center/course on their own.
const GENERIC = new Set(["center", "centre", "campus", "institute", "college", "university", "school", "training", "course", "development", "digital", "skills", "main", "branch", "office", "technology", "sciences", "science", "pakistan", "balochistan"]);

// "with" / "and" are inside course names ("Graphic Design with AI"): never evidence on their own.
const COMMON = new Set(
  ("the of in at for and with to from by on or as how many much list show all total count students student trainers trainer batch batches today data details info me give what which who is are hai hain ka ki ke mein " +
    "them they these those their there match both get class classes schedule schedules late time this that was were my your our").split(" ")
);

export function editDistance(a, b) {
  if (a === b) return 0;
  const m = Array.from({ length: b.length + 1 }, (_, i) => [i]);
  for (let j = 0; j <= a.length; j++) m[0][j] = j;
  for (let i = 1; i <= b.length; i++)
    for (let j = 1; j <= a.length; j++)
      m[i][j] = Math.min(m[i - 1][j] + 1, m[i][j - 1] + 1, m[i - 1][j - 1] + (b[i - 1] === a[j - 1] ? 0 : 1));
  return m[b.length][a.length];
}

// Gender words are filters, not parts of a place/course name ("girls in quetta").
const FILTER_WORDS = new Set("girls girl boys boy female females male males women men ladies larki larkiyan larkay larke".split(" "));

/** City part of an address: "…, Quetta" → "quetta"; short values are used whole. */
function cityOf(v) {
  const s = String(v || "");
  if (s.includes(",")) return fold(s.slice(s.lastIndexOf(",") + 1));
  const f = fold(s);
  return f.split(" ").length <= 2 ? f : f.split(" ").at(-1);
}

function wordMatch(w, vw) {
  if (w === vw) return true;
  if (w.length < 3 || vw.length < 3 || w[0] !== vw[0] || Math.abs(w.length - vw.length) > 2) return false;
  const d = editDistance(w, vw);
  return vw.length <= 5 ? d <= 1 : d <= 2;
}

/** Old-style phrase score (whole name, acronyms, compact spelling) for ranking and fallback. */
function phraseScore(fv, v, t, grams) {
  let best = 0;
  if (fv.length >= 3 && new RegExp(`\\b${fv.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(t)) best = 100;
  for (const g of grams) {
    // Skip phrases with no real content ("center", "students center"); allow
    // multi-word generic names ("university of balochistan", "girls college").
    const content = g.split(" ").filter((w) => !COMMON.has(w) && !/^\d+$/.test(w));
    if (g.length < 3 || !content.length || (content.length === 1 && (GENERIC.has(content[0]) || GENERIC.has(content[0].replace(/s$/, "")) || FILTER_WORDS.has(content[0])))) continue;
    best = Math.max(best, scoreMatch(g, v));
    // "university of balochistan" → "UoB"; "mir chakar khan rind university" → "MCKRU"
    const ac = acronym(g);
    if (content.length >= 2 && ac.length >= 3 && ac === fv.replace(/ /g, "")) best = Math.max(best, 96);
    // A multi-word phrase inside a longer name/address
    if (content.length >= 2 && ` ${fv} `.includes(` ${g} `)) best = Math.max(best, 92);
    if (g.length >= 5 && Math.abs(g.length - fv.length) <= 3) {
      const sim = 1 - editDistance(g, fv) / Math.max(g.length, fv.length);
      if (sim >= 0.85) best = Math.max(best, Math.round(70 + sim * 20));
    }
  }
  return best;
}

/**
 * Pick the records a message refers to. Every meaningful word narrows the set of
 * records it can belong to; the answer is the records that fit ALL such words
 * ("iti qta" → ITTI ∩ Quetta = "ITTI Pishin Stop QTA"; "quetta" → every Quetta
 * center). Ties are broken by how well the whole phrase matches. Works the same
 * for centers, courses, districts, cities and platforms.
 * fields[0] is the name; `cityFields` are addresses where only the city counts.
 */
function fuzzyPick(list, text, fields, { min = 80, cityFields = [] } = {}) {
  const t = fold(text);
  const all = t.split(" ");
  const grams = new Set();
  for (let n = 1; n <= 4; n++) for (let i = 0; i + n <= all.length; i++) grams.add(all.slice(i, i + n).join(" "));
  const vocab = list.map((item) => {
    const ws = new Set();
    for (const f of fields) {
      if (!item[f]) continue;
      const src = cityFields.includes(f) ? cityOf(item[f]) : fold(item[f]);
      for (const w of src.split(" ")) if (w.length >= 2 && !GENERIC.has(w)) ws.add(w);
    }
    return [...ws];
  });
  const words = [...new Set(all.filter((w) => w.length >= 2 && !COMMON.has(w) && !GENERIC.has(w) && !FILTER_WORDS.has(w) && !/^\d+$/.test(w)))];
  const sets = [];
  for (const w of words) {
    const idx = [];
    vocab.forEach((vs, i) => {
      if (vs.some((vw) => wordMatch(w, vw))) idx.push(i);
    });
    if (idx.length && idx.length < list.length) sets.push(idx);
  }
  const phrase = (i) => Math.max(...fields.map((f, k) => (list[i][f] ? phraseScore(fold(list[i][f]), list[i][f], t, grams) - (k === 0 ? 0 : 4) : 0)));

  let cand = null;
  if (sets.length) {
    let inter = sets[0];
    for (const s of sets.slice(1)) {
      const next = inter.filter((i) => s.includes(i));
      if (next.length) inter = next; // ignore a word that would rule everything out
    }
    cand = inter;
  } else {
    cand = list.map((_, i) => i).filter((i) => phrase(i) >= min);
  }
  if (!cand.length) return [];
  // Prefer an exact phrase hit ("university of balochistan") when one stands out.
  const scored = cand.map((i) => ({ i, s: phrase(i) })).sort((a, b) => b.s - a.s);
  if (scored[0].s >= 95 && (scored.length === 1 || scored[1].s < scored[0].s - 5)) return [list[scored[0].i]];
  return scored.map((x) => list[x.i]);
}

export function resolveCenter(d, text) {
  const hits = fuzzyPick(d.centers, text, ["name", "location"], { min: 82, cityFields: ["location"] });
  return hits.length ? { ids: hits.map((c) => c.id), label: hits.map((c) => c.name).join(", ") } : null;
}

export function resolveCourse(d, text) {
  const hits = fuzzyPick(d.courses, text, ["name", "full"], { min: 84 });
  return hits.length ? { ids: hits.map((c) => c.id), label: hits.map((c) => c.name).join(", ") } : null;
}

const GENDER = {
  male: /\b(male|males|boy|boys|man|men|gents|larka|larkay|larke|larkon|mard|aadmi)\b/,
  female: /\b(female|females|girl|girls|woman|women|ladies|lady|larki|larkiyan|larkiyon|khawateen|aurat|auratein)\b/,
};

/** Match a user word against the real distinct values of an enum column. */
export function resolveEnum(d, entityName, filter, text, entity) {
  const values = d.enums[`${entityName}.${filter}`] || [];
  const t = fold(text);
  if (filter === "gender") {
    for (const [g, re] of Object.entries(GENDER)) {
      if (!re.test(t)) continue;
      const v = values.filter((x) => fold(x) === g || fold(x).startsWith(g[0]) && fold(x).length <= 6);
      const chosen = v.length ? v : values.filter((x) => fold(x)[0] === g[0]);
      if (chosen.length) return { values: chosen, label: g };
    }
    return null;
  }
  if (filter === "status") {
    // Evidence-based codes first (e.g. students: active = 1)
    for (const [word, code] of Object.entries(entity?.status || {})) {
      if (new RegExp(`\\b${word}\\b`).test(t)) return { values: [code], label: word };
    }
    if (entity?.status?.removed !== undefined && /\b(removed|dropped|dropout|dropouts|drop out|suspended|inactive|nikal|nikale|blocked)\b/.test(t))
      return { values: [entity.status.removed], label: "removed" };
    if (entity?.status?.active !== undefined && /\b(active|studying|regular|not removed)\b/.test(t) && !/\b(in)?active batch\b/.test(t))
      return { values: [entity.status.active], label: "active" };
    if (entity?.status?.admitted !== undefined && /\b(admitted|selected|passed|pass|qualified|accepted|successful)\b/.test(t))
      return { values: [entity.status.admitted], label: "admitted" };
    if (entity?.status?.approved !== undefined && /\b(approved|verified|accepted)\b/.test(t)) return { values: [entity.status.approved], label: "approved" };
  }
  if (entityName === "attendance" && filter === "status") {
    const map = { present: /\b(present|presnt|hazir|attended|came)\b/, absent: /\b(absent|absnt|ghair hazir|missing|absentees?)\b/, leave: /\b(on leave|leave|chutti)\b/, late: /\b(late|der)\b/ };
    for (const [word, re] of Object.entries(map)) {
      if (!re.test(t)) continue;
      const v = values.filter((x) => fold(x) === word || fold(x) === word[0] || fold(x).startsWith(word.slice(0, 3)));
      if (v.length) return { values: v, label: word };
    }
  }
  // Generic: the word itself is one of the stored values ("open", "pending", "Fiverr")
  const strVals = values.filter((v) => typeof v === "string" && v.length >= 3);
  const hits = strVals.filter((v) => new RegExp(`\\b${fold(v).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(t));
  if (hits.length) return { values: hits, label: hits.join(", ") };
  if (["district", "city", "platform"].includes(filter)) {
    const fz = fuzzyPick(strVals.map((v) => ({ v })), t, ["v"], { min: 88 });
    if (fz.length) return { values: fz.map((x) => x.v), label: fz.map((x) => x.v).join(", ") };
  }
  return null;
}

/** Date phrases → [from, to] (inclusive, YYYY-MM-DD). */
/** Current wall-clock time in APP_TIMEZONE, as a Date whose local getters read that time. */
export function localNow(tz = config.timezone) {
  try {
    return new Date(new Date().toLocaleString("en-US", { timeZone: tz }));
  } catch {
    return new Date();
  }
}

export function resolveDate(text, now = localNow()) {
  const t = fold(text);
  const iso = (d) => d.toISOString().slice(0, 10);
  const day = (offset) => {
    const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() + offset));
    return iso(d);
  };
  if (/\b(today|aaj|aj|todays)\b/.test(t)) return { from: day(0), to: day(0), label: "today" };
  if (/\b(yesterday|kal|guzishta kal)\b/.test(t)) return { from: day(-1), to: day(-1), label: "yesterday" };
  const lastN = t.match(/\b(?:last|past|pichl[ae])\s+(\d{1,3})\s+(days?|din)\b/);
  if (lastN) return { from: day(-Number(lastN[1]) + 1), to: day(0), label: `last ${lastN[1]} days` };
  const dow = (now.getDay() + 6) % 7; // Monday = 0
  if (/\b(this|is|current)\s+(week|hafte|hafta)\b/.test(t)) return { from: day(-dow), to: day(0), label: "this week" };
  if (/\b(last|previous|pichl[ae])\s+(week|hafte|hafta)\b/.test(t)) return { from: day(-dow - 7), to: day(-dow - 1), label: "last week" };
  const y = now.getFullYear();
  const mo = now.getMonth();
  const monthRange = (yy, mm) => ({
    from: iso(new Date(Date.UTC(yy, mm, 1))),
    to: iso(new Date(Date.UTC(yy, mm + 1, 0))),
  });
  if (/\b(this|is|current)\s+(month|mahine|mahina|maah)\b/.test(t)) return { ...monthRange(y, mo), label: "this month" };
  if (/\b(last|previous|pichl[ae])\s+(month|mahine|mahina)\b/.test(t)) return { ...monthRange(mo ? y : y - 1, mo ? mo - 1 : 11), label: "last month" };
  if (/\b(this|is|current)\s+(year|saal)\b/.test(t)) return { from: `${y}-01-01`, to: `${y}-12-31`, label: "this year" };
  const isoM = text.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
  if (isoM) {
    const v = `${isoM[1]}-${isoM[2].padStart(2, "0")}-${isoM[3].padStart(2, "0")}`;
    return { from: v, to: v, label: v };
  }
  const dmy = text.match(/\b(\d{1,2})[/.](\d{1,2})[/.](20\d{2})\b/);
  if (dmy) {
    const v = `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
    return { from: v, to: v, label: v };
  }
  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  // "22 oct", "oct 22", "22nd october 2026": one day
  const MON = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
  const dm = t.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MON}\\b(?:\\s+(20\\d{2}))?`)) || t.match(new RegExp(`\\b${MON}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:\\s+(20\\d{2}))?`));
  if (dm) {
    const dayFirst = /^\d/.test(dm[1]);
    const d = Number(dayFirst ? dm[1] : dm[2]);
    const m = months.indexOf((dayFirst ? dm[2] : dm[1]).slice(0, 3));
    const yy = dm[3] ? Number(dm[3]) : m > mo ? y - 1 : y;
    if (d >= 1 && d <= 31) {
      const v = `${yy}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      return { from: v, to: v, label: v === iso(new Date(Date.UTC(y, mo, now.getDate()))) ? "today" : `${d} ${months[m][0].toUpperCase()}${months[m].slice(1)} ${yy}` };
    }
  }
  const mm = t.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b(?:\s+(20\d{2}))?/);
  if (mm && !/\bmay i\b/.test(t)) {
    const m = months.indexOf(mm[1].slice(0, 3));
    const yy = mm[2] ? Number(mm[2]) : m > mo ? y - 1 : y;
    return { ...monthRange(yy, m), label: `${mm[1]} ${yy}` };
  }
  return null;
}

export { LOOKUPS };
