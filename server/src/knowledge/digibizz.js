// Basic facts about the DigiBizz program, from https://digibizz.gob.pk (home page,
// FAQ, Program Policy, Classes Schedule, Learning Resources). Answered instantly,
// without the LLM. Update here when the website changes.

export const SOURCE = "https://digibizz.gob.pk";

const CONTACT =
  "📞 *DigiBizz Support*\n• Phone: *081-9203131*\n• Email: support@digibizz.gob.pk\n• Office: IT Training Institute (ITTI), Old Pishin Stop, Near TCS Office, Model Town, Quetta\n• Website: digibizz.gob.pk\n• Complaints: digibizz.gob.pk/digibizz-complaint-portal";

export const TOPICS = [
  {
    id: "about",
    re: /\b(what is|whats|about|tell me about|introduce|kya hai|kia hai|ke bare|ke baare|maloomat)\b.*\bdigi ?bizz?\b|\bdigi ?bizz?\b.*\b(kya hai|kia hai|what is|about)\b|^digi ?bizz?$|\babout (the )?program\b|\b(your|this|ur) (org|organi[sz]ation|company|program|programme|project|institute|initiative)\b(?! (director|officer|team|incharge|head|manager))|^(i )?(meant|mean) (the |your )?(org|organi[sz]ation|program|company)\b|\bwho (runs|owns|made|funds) (this|you|digibizz)\b/,
    answer:
      "🚀 *DigiBizz — Training to Dollars*\nBalochistan's first mega employment program, by the *Science & IT Department, Government of Balochistan*.\n\nIt trains the youth of Balochistan in in-demand *digital skills* and *freelancing* so they can earn online, support their families and build a better future.\n\n• 100% *free* training\n• *Stipend* of Rs. 6,200 at the end of the training\n• *4-month* training, 3 courses, each with freelancing training\n• Official certificate on completion",
  },
  {
    id: "courses",
    re: /\b(which|what|kon ?se|konsa|kaun ?se)\b.*\bcourses?\b.*\b(offer|offered|available|hain|parhaye|teach|taught|do you have|are there|provide)|\bcourses? (offered|available)\b|\bwhat (do you|does digibizz) (teach|offer)\b|\b(course|courses) (details|info|information)\b/,
    answer:
      "📚 *DigiBizz courses* (each includes full freelancing training)\n\n1️⃣ *Digital Marketing & Advertising* — content marketing, SEO, social & Google ads\n2️⃣ *Creative Design* — graphic design (Photoshop, Illustrator)\n3️⃣ *Amazon E-commerce & Web (AWE)* — Amazon, WordPress, Shopify, websites\n\nGraduates are trained to start earning online on Fiverr, Upwork and other platforms.",
  },
  {
    id: "google",
    re: /\bgoogle (certificate|certification|program)\b|\bfree google\b/,
    answer: "🏅 *Free Google Certification:* DigiBizz has introduced Google's three-step certification program for trainees. Details and the apply link: digibizz.gob.pk/google",
  },
  {
    id: "fee",
    re: /\b(fee|fees|fess|charges?|cost|paisa|paise|paid|free|kitne paise|kya paise|payment for (admission|training)|money)\b/,
    answer:
      "✅ *DigiBizz is 100% FREE.*\nNo fees, no charges, no hidden costs — it is fully funded by the Government of Balochistan.\n\n⚠️ If anyone asks you for money to get admission, *report them immediately*. Apply only through the official website.",
  },
  {
    id: "stipend",
    re: /\b(stipend|wazifa|wazeefa|allowance|monthly (amount|payment)|kitna milta|kitne milte|scholarship)\b/,
    answer:
      "💵 *Stipend: Rs. 6,200*, given to trainees *at the end of the training* — on top of the completely free training (no fees at all).",
  },
  {
    id: "eligibility",
    re: /\b(eligib\w*|criteria|requirements?|who can apply|can i apply|qualification required|age limit|shart|sharait|kon apply)\b/,
    answer:
      "📋 *Eligibility criteria*\n• Resident of *Balochistan* with a valid domicile\n• At least *12 years of education* (Intermediate / F.Sc or equivalent)\n• Must be *unemployed*\n• *Males and females* from all over the province can apply\n\nAll criteria are mandatory.",
  },
  {
    id: "register",
    re: /\b(how (do|can) i (register|apply|join|get admission)|how to (register|apply|join)|registration|apply|admission (process|kaise|procedure)|admission kaise|dakhla|daakhla|enroll myself|sign up|form)\b/,
    answer:
      "📝 *How to apply*\n1. When admissions open, apply at *lms.digibizz.gob.pk/registration*\n2. Fill the form with correct details — contact info, valid CNIC, city and preferred center\n3. Submit the required documents\n4. Complete the assessment tests (test & interview)\n5. Wait for the selection email\n\n❗ Use a correct email address — all communication is by email. Final selection is based on the assessments.",
  },
  {
    id: "duration",
    re: /\b(how long|duration|kitne (din|mahine|months)|kitna time|kab tak|length of (the )?(training|course)|lectures)\b/,
    answer:
      "⏳ *Training length: 4 months*\nThe course has *50 lectures* plus assignments and assessments; complete all of them to earn the certificate. For your batch's exact dates ask me: _which batch is running_.",
  },
  {
    id: "certificate",
    re: /\b(certificate|certification|sanad|degree milegi|certificate milega)\b(?!.*\bgoogle\b)/,
    answer:
      "🎓 *Certificate:* after completing all *50 lectures*, assignments and assessments you receive an official training completion certificate from DigiBizz, Science & IT Department, Government of Balochistan. It reflects your performance evaluation and rating.",
  },
  {
    id: "centers_info",
    re: /\b(where (are|is) (the )?(training )?(centers?|centres?|campus)|centers? (location|address)|address of (the )?(centers?|office)|kahan (hai|hain)|location of)\b/,
    answer:
      "🏫 *DigiBizz centers*\n• *Main office:* IT Training Institute (ITTI), Old Pishin Stop, Near TCS Office, Model Town, Quetta\n• University of Balochistan (UoB)\n• BUITEMS\n• ITTI Model Town, Quetta\n• Government Girls College, Quetta\n• MCKRU Sibi and more centers across the province (incl. online)\n\nFor the live list ask: _list centers_.",
  },
  {
    id: "timings",
    re: /\b(class (timings?|time|schedule)|timings?|time ?table|kab (hoti|hote|start)|class kab|schedule of classes)\b/,
    answer:
      "🕘 *Class timings* (from the website)\n\n*ITTI Center*\n• Amazon Web & E-commerce: 2:00–5:00 PM (Lab 1)\n• Creative Designing: 2:00–5:00 PM (Lab 2)\n• Content Marketing & Advertising: 11:00 AM–2:00 PM (Lab 1)\n\n*BUITEMS* — all courses 3:00–5:00 PM (HBL Lab)\n\n*University of Balochistan* — all courses 2:00–5:00 PM (CS & IMS Departments)\n\n*Govt. Girls College* — all courses 12:30–2:30 PM (Digital Library / Sofia Ahmed Computer Lab)\n\n*MCKRU, UoL, UoG* — online classes, all courses 3:00–5:00 PM\n\nFor a specific center ask: _class timings at ITTI_.",
  },
  {
    id: "policy",
    re: /\b(policy|policies|rules|regulations|qawaid|attendance policy|blacklist\w*|terminate|termination|code of conduct)\b/,
    answer:
      "📜 *Program rules (summary)*\n• Attend *all* sessions and complete all assignments — failing the attendance policy means removal and *blacklisting* from future DigiBizz and other Govt. of Balochistan programs\n• Professional, respectful conduct with trainers and fellow trainees\n• Contact trainers only through the official groups, not personal numbers\n• Program material is confidential\n• Final selection can't be challenged; the program may terminate enrollment for violations\n• No guarantee of freelance income or employment\n\nFull policy: digibizz.gob.pk/policy",
  },
  {
    id: "complaint",
    re: /\b(complain\w*|shikayat|report (someone|a person|fraud)|grievance)\b/,
    answer: "📣 *Complaint portal:* digibizz.gob.pk/digibizz-complaint-portal — students and staff can file a complaint there.\n\n" + CONTACT,
  },
  {
    id: "contact",
    re: /\b(contact|helpline|support|customer care|office (address|number)|digibizz (number|phone|email)|kis se baat|rabta)\b/,
    answer: CONTACT,
  },
  {
    id: "team",
    re: /\b(team|program director|director|admin officer|m&e|m and e|master trainers? (of|for) (digital|graphics|awe)|who (runs|manages|leads) (the )?(program|digibizz)|management)\b/,
    answer:
      "👥 *DigiBizz team*\n• Program Director: *Jawad Ahmed*\n• Admin Officer: *Mansoor Ahmed*\n• M&E Officer: *Usama Nadeem*\n• Master Trainer – Digital: *Azib Anjum*\n• Master Trainer – Graphics: *Mohsin Ali*\n• Master Trainer – AWE: *Muhammad Umar*\n• LMS Incharge: *Abdul Moiz Khan*\n\nFor current trainers ask: _list trainers_.",
  },
  {
    id: "resources",
    re: /\b(learning (resources|material)|study material|helping material|notes|tutorials?|prepare for (the )?(interview|test)|interview preparation|test preparation)\b/,
    answer:
      "📖 *Learning resources* (to prepare for the interview/test): digibizz.gob.pk/courses-helping-material\nTopics: Freelancing (Fiverr, Upwork, proposals), Creative Design (Photoshop, Illustrator, colour theory), Digital Marketing (SEO, WordPress, Google & WhatsApp ads), Amazon & Web (Amazon VA, wholesale, PL, WordPress, WooCommerce, Shopify).\n\nLMS how-to videos: digibizz.gob.pk/lms-help",
  },
  {
    id: "lms",
    re: /\b(lms (account|login|help|tutorial)|how to (use|login to|log in to) (the )?lms|create (an )?lms account|lms kaise)\b/,
    answer: "💻 *LMS help:* video tutorials on creating your DigiBizz LMS account and the dashboard: digibizz.gob.pk/lms-help\nStudent LMS: lms.digibizz.gob.pk",
  },
];

const TEAM = [
  ["Jawad Ahmed", "Program Director"],
  ["Mansoor Ahmed", "Admin Officer"],
  ["Usama Nadeem", "M&E Officer"],
  ["Azib Anjum", "Master Trainer – Digital Marketing"],
  ["Mohsin Ali", "Master Trainer – Graphics"],
  ["Muhammad Umar", "Master Trainer – AWE"],
  ["Abdul Moiz Khan", "LMS Incharge"],
];

/** "Usama Nadeem", "who is jawad ahmed": a DigiBizz team member, not a student. */
export function teamAnswer(text) {
  const t = String(text || "")
    .toLowerCase()
    .replace(/[?!.,;:'"]/g, " ")
    .replace(/\b(who is|whos|who's|kon hai|kaun hai|tell me about|about|details of|sir|madam|mr|ms)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const hit = TEAM.find(([n]) => n.toLowerCase() === t);
  return hit ? { id: "team-member", answer: `👤 *${hit[0]}* is the *${hit[1]}* of DigiBizz.\n\nFor the full team ask: _DigiBizz team_ · contact: 081-9203131` } : null;
}

/** Words that mean the user wants numbers/records from the database instead. */
const DATA_ASK = /\b(how many|kitne|count|total|list|names?|show|number of|by center|wise|batch \d+|students? (in|of|at|from)|enrolled|present|absent|today|this (month|week))\b/;

/**
 * Answer a general question about the program, or null.
 * Database questions ("how many courses", "list centers") are left to the engine.
 */
export function knowledgeAnswer(text, { hasIdent = false } = {}) {
  const t = String(text || "")
    .toLowerCase()
    .replace(/[?!.,;:'"]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!t || hasIdent) return null;
  for (const topic of TOPICS) {
    if (!topic.re.test(t)) continue;
    // "timings at ITTI for web" style questions are better answered from the DB when it has schedules;
    // still, the website table is the reliable source, so answer it here.
    if (DATA_ASK.test(t) && !["fee", "stipend", "eligibility", "register", "contact", "complaint", "policy", "about", "certificate", "timings"].includes(topic.id)) continue;
    if (["contact", "team"].includes(topic.id) && /\b(student|trainer|teacher|candidate|applicant)s?\b/.test(t)) continue;
    if (topic.id === "fee" && /\b(earning|earnings|kamai|income|payment|amount)\b/.test(t) && !/\b(fee|fees|admission|training)\b/.test(t)) continue;
    return { id: topic.id, answer: topic.answer };
  }
  return null;
}

/** Short program summary for the chat model's system prompt. */
export const PROGRAM_SUMMARY =
  "About DigiBizz (from digibizz.gob.pk): Balochistan's first mega employment / freelancing program by the Science & IT Department, Government of Balochistan. " +
  "Free training (no fees; report anyone asking for money) with a stipend of Rs. 6,200 given at the end of the training. Courses: Digital Marketing & Advertising, Creative Design (graphics), Amazon E-commerce & Web (AWE), each with freelancing training. " +
  "Eligibility: Balochistan domicile, at least 12 years of education, unemployed, males and females. Apply at lms.digibizz.gob.pk/registration when admissions open (form, documents, tests, email selection). " +
  "Training lasts 4 months (50 lectures). Certificate after 50 lectures, assignments and assessments. Main office: IT Training Institute, Old Pishin Stop, Model Town, Quetta. Phone 081-9203131, support@digibizz.gob.pk. " +
  "Strict attendance policy: removal and blacklisting for violations.";
