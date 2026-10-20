const GREET_RE =
  /^(hi|hello|hey|yo|salam|salaam|assalamu? ?alaikum|as[- ]?salam|thanks|thank you|shukriya|mehrbani|ok+|okay|bye|good (morning|evening|night|afternoon)|how are you|i am (good|fine|ok)|i'm (good|fine|ok)|w(aa|a)laikum)\b/i;

const DATA_RE =
  /\b(how many|kitn[ae]|count|list|show|pull|fetch|enroll\w*|students?|batches?|centres?|centers?|campus(?:es)?|courses?|programs?|programmes?|fees?|attend\w*|totals?|reports?|pass|fail|teachers?|instructors?|classes?|admissions?|active|inactive|city|quetta|karachi|lahore|names?|cnic|phone|email|trades?|sessions?|shifts?|modules?|subjects?|results?|marks?|grades?|certificates?|institutes?|itti|dgbis|coeta|data)\b/i;

/** True when the message likely needs database work, not a chat reply. */
export function looksLikeDataQuestion(text) {
  const t = String(text || "").trim();
  if (!t) return false;
  if (DATA_RE.test(t)) return true;
  if (/\d/.test(t) && t.length > 12) return true;
  if (/\?/.test(t) && t.length > 24) return true;
  if (GREET_RE.test(t) && t.length < 70) return false;
  return t.length > 50;
}

const STOP = new Set(
  `a an the of in on at for to is are was were be been being it this that these those me my you your i we they them he she his her
   and or not if then from with as by so too very just please can could would should will shall do did does
   tell give show find get what which who whom whose when where why how many number much more most some any all
   about also only into over after before than there here am good fine ok okay well thank thanks hi hello hey
   current currently now today latest`.split(/\s+/)
);

/** Significant tokens from messy / voice-transcribed questions. */
export function queryTokens(text) {
  const folded = String(text || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  const out = [];
  for (const w of folded.split(/\s+/)) {
    if (!w || STOP.has(w)) continue;
    if (w.length >= 3 || /^\d+$/.test(w) || (w.length >= 2 && /^[a-z]{2,8}$/.test(w) && !STOP.has(w))) {
      if (!out.includes(w)) out.push(w);
    }
  }
  return out;
}
