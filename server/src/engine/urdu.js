// Urdu script → Roman Urdu / English words the rule parser understands. Voice notes
// come back from Whisper in Urdu script ("ٹرینرز کی اٹینڈنس"), so without this every
// spoken question fell through to the slow, unreliable LLM. Words not listed here
// become "_u_" (an unknown token that never looks like a name).

const URDU = /[؀-ۿ]/;

/** Same letter, different code points (Arabic vs Urdu keyboards), and no diacritics. */
function canon(w) {
  return w
    .replace(/[ً-ٰٟ۪-ۭ]/g, "")
    .replace(/[يى]/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[هۂۃة]/g, "ہ")
    .replace(/[أإ]/g, "ا")
    .replace(/ؤ/g, "و")
    .replace(/[‌‍ـ]/g, "");
}

const GROUPS = {
  students: "سٹوڈنٹ سٹوڈنٹس سٹوڈنٹز اسٹوڈنٹ اسٹوڈنٹس اسٹوڈنٹز سٹوڈینٹ سٹوڈینٹس اسٹوڈینٹ اسٹوڈینٹس سٹوڈنس اسٹوڈنس طالب طلبہ طلباء طالبعلم طالبعلموں بچے بچوں ٹرینیز ٹرینی",
  trainers: "ٹرینر ٹرینرز ٹرینرس ٹرینروں ٹینار ٹینارز ٹینرز ٹرینڑز ٹیچر ٹیچرز ٹیچرس استاد اساتذہ انسٹرکٹر انسٹرکٹرز",
  attendance: "اٹینڈنس اٹینڈینس اٹینڈنٹس اٹینڈینٹس اٹنڈنس اٹینڈنسز اٹینڈینسز حاضری حاضریاں",
  hazir: "حاضر موجود",
  absent: "غائب غیرحاضر",
  ghair: "غیر",
  earnings: "ارننگ ارننگز ارننگس ارنگ ارنگز ارنینگ ارنینگز کمائی آمدنی آمدن",
  batch: "بیچ بیچز بیچوں بیچس",
  center: "سینٹر سینٹرز سینٹرس سنٹر سنٹرز سنٹرس مرکز مراکز",
  course: "کورس کورسز کورسس کورسوں",
  class: "کلاس کلاسز کلاسیں کلاسوں",
  schedule: "شیڈول شیڈولز شیڈیول ٹائمنگ ٹائمنگز",
  late: "لیٹ دیر تاخیر",
  time: "ٹائم ٹرائم",
  on: "اون آن",
  punctual: "وقت_پر",
  total: "ٹوٹل ٹوٹیل",
  tadad: "تعداد",
  kitne: "کتنے کتنی کتنا کتنوں",
  kon: "کون کونسا کونسے کونسی",
  list: "لسٹ فہرست",
  naam: "نام ناموں",
  batao: "بتاؤ بتاو بتائیں بتایئں بتا بتائے بتادیں بتادو دکھاؤ دکھاو دکھائیں دکھا",
  today: "آج",
  kal: "کل",
  hafte: "ہفتے ہفتہ",
  mahine: "مہینے مہینہ ماہ",
  pichle: "پچھلے پچھلا پچھلی",
  girls: "لڑکیاں لڑکیوں لڑکی خواتین طالبات بچیاں بچیوں",
  boys: "لڑکے لڑکوں لڑکا",
  female: "فیمیل",
  male: "میل",
  active: "ایکٹو فعال",
  removed: "ریموو ریمووڈ نکالے",
  sum: "جمع سم سمب سمم",
  figure: "فگر فیگر",
  average: "ایوریج اوسط",
  data: "ڈیٹا ڈیٹے",
  database: "ڈیٹابیس دیتبیس ڈیٹابیز ڈیٹابیسز",
  admissions: "ایڈمیشن ایڈمیشنز داخلہ داخلے",
  applicants: "امیدوار امیدواروں اپلیکنٹس",
  applied: "اپلائی",
  results: "رزلٹ رزلٹس نتیجہ نتائج",
  marks: "مارکس",
  number: "نمبر نمبرز",
  chutti: "چھٹی چھٹیاں چھٹیوں",
  holidays: "تعطیلات",
  assignments: "اسائنمنٹ اسائنمنٹس اسائمنٹ",
  tickets: "ٹکٹ ٹکٹس",
  complaint: "شکایت شکایات",
  current: "موجودہ کرنٹ",
  abhi: "ابھی",
  chal: "چل",
  raha: "رہا رہی رہے",
  excel: "ایکسل",
  chart: "چارٹ",
  graph: "گراف",
  report: "رپورٹ رپورٹس",
  details: "تفصیل تفصیلات ڈیٹیل ڈیٹیلز",
  quetta: "کوئٹہ کوئٹا کویٹہ",
  sibi: "سبی",
  turbat: "تربت",
  gwadar: "گوادر",
  khuzdar: "خضدار",
  zhob: "ژوب ژوبی",
  loralai: "لورالائی",
  pishin: "پشین",
  nushki: "نوشکی",
  awaran: "آواران",
  itti: "آئیٹیٹیآئی",
  buitems: "بیوٹمز بیوٹیمز",
  university: "یونیورسٹی",
  balochistan: "بلوچستان",
  digibizz: "ڈیجیبز ڈیجی_بز ڈجیبز",
  // Grammar words, so a long spoken sentence is not "mostly unknown".
  mujhe: "مجھے مجھ", hamein: "ہمیں", aap: "آپ", ap: "اپ", hamari: "ہماری اماری", hamare: "ہمارے امارے", hamara: "ہمارا", mera: "میرا میری میرے",
  ki: "کی", ka: "کا", ke: "کے کہ", ko: "کو", mein: "میں", se: "سے", hai: "ہے", hain: "ہیں ہیں", tha: "تھا", thi: "تھی", the: "تھے",
  aur: "اور", ya: "یا", nahi: "نہیں نہی", na: "نہ", kya: "کیا", jo: "جو", jab: "جب", jabke: "جبکہ", ye: "یہ", wo: "وہ", is: "اس", in: "ان",
  koi: "کوئی", sab: "سب", tamam: "تمام", sare: "سارے ساری سار", ho: "ہو", hoga: "ہوگا ہوگی ہونگے ہوں", kar: "کر کرکے کریں کرو کرنا", karke: "کرکے",
  dein: "دیں دیجیے", do: "دو", ek: "ایک", par: "پر", tak: "تک", bhi: "بھی", sirf: "صرف", wale: "والے والا والی", aayi: "آئی آئے آیا آئیں",
  gaya: "گیا گئی گئے", salam: "سلام السلام", alaikum: "علیکم", shukriya: "شکریہ", haan: "ہاں", ji: "جی", theek: "ٹھیک", sir: "سر", bare: "بارے",
  chahiye: "چاہیے چاہئے", matlab: "مطلب", kaha: "کہا", bataya: "بتایا", ne: "نے", to: "تو", lekin: "لیکن", phir: "پھر", hua: "ہوا ہوئی ہوئے",
  please: "پلیز براہ_کرم", yahan: "یہاں", wahan: "وہاں", kahan: "کہاں", kab: "کب", kyun: "کیوں", kaise: "کیسے", sath: "ساتھ", liye: "لیے لئے",
  match: "میچ", compare: "موازنہ",
};

const MAP = new Map();
/** Every Roman word this module can produce: known vocabulary, never a person's name. */
export const ROMAN_WORDS = new Set(Object.keys(GROUPS).flatMap((k) => k.split("_")));
for (const [roman, words] of Object.entries(GROUPS)) for (const w of words.split(/\s+/)) MAP.set(canon(w.replace(/_/g, "")), roman.replace(/_/g, " "));

// Spoken acronyms and multi-word names, replaced before splitting into words.
const PHRASES = [
  [/آئی\s*ٹی\s*ٹی\s*آئی/g, " itti "],
  [/ڈیرہ\s*بگٹی/g, " derabugti "],
  [/ٹائم\s*ٹیبل/g, " schedule "],
  [/ڈیجی\s*بز/g, " digibizz "],
];

const SUFFIXES = ["وں", "یں", "ز", "س", "ے", "ی"];

function lookup(w) {
  if (MAP.has(w)) return MAP.get(w);
  for (const s of SUFFIXES) if (w.length > s.length + 2 && w.endsWith(s) && MAP.has(w.slice(0, -s.length))) return MAP.get(w.slice(0, -s.length));
  return null;
}

/** Eastern Arabic / Urdu digits → 0-9. */
export function asciiDigits(text) {
  return String(text || "").replace(/[٠-٩۰-۹]/g, (d) => String(d.charCodeAt(0) & 0xf));
}

export function hasUrdu(text) {
  return URDU.test(String(text || ""));
}

/** Replace Urdu-script words with Roman equivalents; Latin text is left as is. */
export function romanizeUrdu(text) {
  const s = asciiDigits(text);
  if (!URDU.test(s)) return s;
  let p = s;
  for (const [re, r] of PHRASES) p = p.replace(re, r);
  const tokens = p.replace(/[۔،؟!?.,]/g, " ").split(/\s+/).filter(Boolean);
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    const w = canon(tokens[i]);
    if (!URDU.test(w)) {
      out.push(tokens[i]);
      continue;
    }
    // Two-word phrases first ("غیر حاضر", "آن ٹائم", "ڈیٹا بیس", "کل تعداد")
    const next = tokens[i + 1] ? canon(tokens[i + 1]) : "";
    if (next) {
      const pair = lookup(w + next);
      if (pair) {
        out.push(pair);
        i++;
        continue;
      }
      if (w === "کل" && ["تعداد", "ٹوٹل"].includes(next)) {
        out.push("total");
        continue;
      }
    }
    out.push(lookup(w) || "_u_");
  }
  return out.join(" ");
}
