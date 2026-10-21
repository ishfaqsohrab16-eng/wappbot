const DATA_RE =
  /\b(how many|kitn[ae]|count|list|show|pull|fetch|detail\w*|enroll\w*|students?|batch\w*|centres?|centers?|campus(?:es)?|courses?|programs?|programmes?|fees?|attend\w*|totals?|reports?|pass|fail|teachers?|instructors?|classes?|admissions?|active|inactive|running|city|quetta|karachi|lahore|names?|cnic|phone|mobile|email|trades?|sessions?|shifts?|modules?|subjects?|results?|marks?|grades?|certificates?|institutes?|itti|dgbis|coeta|data)\b/i;

/** True when the message likely needs database work, not a chat reply. */
export function looksLikeDataQuestion(text) {
  const t = String(text || "").trim();
  if (!t) return false;
  if (DATA_RE.test(t)) return true;
  if (/\d{4,}/.test(t)) return true;
  if (/\d/.test(t) && t.length > 12) return true;
  if (/\?/.test(t) && t.length > 24) return true;
  if (smallTalkReply(t)) return false;
  return t.length > 50;
}

const URDU_SCRIPT = /[؀-ۿ]/;

// Instant replies for messages that are only a greeting/thanks: no LLM call.
const CANNED = [
  {
    re: /^(hi+|hello+|hel+o|hey+|hy|yo|hiya|good (morning|afternoon|evening|day))$/,
    en: "Hello! 👋 How can I help you with the LMS data today?",
  },
  {
    re: /^(a?s+a?la+m+|as+alam+u? ?(o|u)?alaik(u|o)m|aoa|slam|salam alaikum|assalam o alaikum|السلام علیکم|سلام)$/,
    en: "Wa Alaikum Assalam! 👋 Main LMS data ke baare mein aap ki kya madad kar sakta hoon?",
    ur: "وعلیکم السلام! 👋 میں LMS ڈیٹا کے بارے میں آپ کی کیا مدد کر سکتا ہوں؟",
  },
  {
    re: /^(how are you|how r u|how are u|kaise ho|kese ho|kaisay ho|kya haal hai|kia hal hai|aap kaise hain|آپ کیسے ہیں)$/,
    en: "I'm doing great, thanks for asking! 😊 What would you like to know from the LMS data?",
  },
  {
    re: /^(thanks?|thank you|thank u|thx|ty|shukriya|shukria|bohat shukriya|jazakallah|jazak allah|meherbani|mehrbani|شکریہ)( (so much|a lot|bro|sir))?$/,
    en: "You're welcome! 😊 Anything else you'd like to know?",
    ur: "خوش آمدید! 😊 کچھ اور معلوم کرنا ہو تو بتائیں۔",
  },
  { re: /^(ok+|okay|okk+|k|acha|achha|theek hai|thik hai|fine|great|nice|good|cool|👍)$/, en: "👍 Let me know if you need anything else." },
  {
    re: /^(bye|goodbye|good night|allah hafiz|khuda hafiz|اللہ حافظ|خدا حافظ)$/,
    en: "Allah Hafiz! 👋 Message me anytime you need data.",
    ur: "اللہ حافظ! 👋",
  },
];

/** Canned reply for pure greetings / thanks, or null. */
export function smallTalkReply(text) {
  const raw = String(text || "").trim();
  if (!raw || raw.length > 40) return null;
  const t = raw
    .toLowerCase()
    .replace(/[!.,?؟۔😊🙂👋🙏]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/ (bhai|bro|sir|dear|there|ji|jee)$/, "");
  for (const c of CANNED) {
    if (c.re.test(t)) return URDU_SCRIPT.test(raw) && c.ur ? c.ur : c.en;
  }
  return null;
}

const STOP = new Set(
  `a an the of in on at for to is are was were be been being it this that these those me my you your i we they them he she his her
   and or not if then from with as by so too very just please can could would should will shall do did does
   tell give show find get what which who whom whose when where why how many number much more most some any all
   about also only into over after before than there here am good fine ok okay well thank thanks hi hello hey
   current currently now today latest details detail information info record records data
   ka ki ke ko hai hain mein me se aur kya kitne kitna batao bata dain dein`.split(/\s+/)
);

/** Significant tokens from messy / voice-transcribed questions. */
export function queryTokens(text) {
  const folded = String(text || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  const out = [];
  for (const w of folded.split(/\s+/)) {
    if (!w || STOP.has(w)) continue;
    if (w.length >= 3 || /^\d+$/.test(w) || /^[a-z]{2}$/.test(w)) {
      if (!out.includes(w)) out.push(w);
    }
  }
  return out;
}

/**
 * Hints for exact identifiers (CNIC, phone, email) whose stored format may differ
 * from what the user typed.
 */
export function identifierHints(text) {
  const t = String(text || "");
  const hints = [];
  for (const m of t.matchAll(/\b(\d{5})[-\s]?(\d{7})[-\s]?(\d)\b/g)) {
    const digits = m[1] + m[2] + m[3];
    hints.push(
      `CNIC ${m[0]}: it may be stored with or without dashes. Match with REPLACE(REPLACE(<cnic column>,'-',''),' ','') = '${digits}'.`
    );
  }
  for (const m of t.matchAll(/(?:\+?92|0092|\b0)?[-\s]?(3\d{2})[-\s]?(\d{7})\b/g)) {
    const core = m[1] + m[2];
    if (hints.some((h) => h.includes(core))) continue;
    hints.push(
      `Phone ${m[0].trim()}: may be stored as 0${core}, 92${core} or +92${core}. Match with REPLACE(REPLACE(<phone column>,'-',''),' ','') LIKE '%${core}'.`
    );
  }
  for (const m of t.matchAll(/[\w.+-]+@[\w-]+\.[\w.]+/g)) {
    hints.push(`Email ${m[0]}: match case-insensitively with LOWER(<email column>) = '${m[0].toLowerCase()}'.`);
  }
  return hints;
}
