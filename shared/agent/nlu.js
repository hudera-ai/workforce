// Natural-language understanding for the built-in agent engine (Arabic — Gulf/Egyptian/MSA — and English).
// Deterministic and explainable: every decision can be shown in the trace. On the server an LLM can
// replace classify()/extract() (see server/src/llm.js); this module stays the fallback and the test oracle.

const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩", FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
export function normalize(s) {
  return String(s || "")
    .replace(/[٠-٩]/g, d => String(AR_DIGITS.indexOf(d))).replace(/[۰-۹]/g, d => String(FA_DIGITS.indexOf(d)))
    .replace(/[ً-ْـ]/g, "").replace(/[إأآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/ؤ/g, "و").replace(/ئ/g, "ي")
    .replace(/[،؛؟]/g, m => ({ "،": ",", "؛": ";", "؟": "?" })[m])
    .toLowerCase().replace(/\s+/g, " ").trim();
}
export const detectLang = s => ((String(s).match(/[؀-ۿ]/g) || []).length >= (String(s).match(/[a-z]/gi) || []).length ? "ar" : "en");
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const word = w => new RegExp(`(^|[^\\p{L}])(?:[وفبل]|ال|وال|بال|لل)?${esc(normalize(w))}(?=$|[^\\p{L}])`, "iu");
export const has = (t, words) => words.some(w => word(w).test(t));
export const count = (t, words) => words.filter(w => word(w).test(t)).length;

// ---------------------------------------------------------------- numbers
const NUM_WORDS = { "واحد": 1, "وحده": 1, "يوم": 1, "يومين": 2, "اتنين": 2, "اثنين": 2, "ثنين": 2, "تلاته": 3, "ثلاثه": 3, "ثلاث": 3, "تلت": 3, "اربعه": 4, "اربع": 4, "خمسه": 5, "خمس": 5, "سته": 6, "ست": 6, "سبعه": 7, "سبع": 7, "تمانيه": 8, "ثمانيه": 8, "تسعه": 9, "عشره": 10, "عشر": 10, "اسبوع": 7, "اسبوعين": 14,
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, week: 7, "a week": 7, "two weeks": 14 };

// ---------------------------------------------------------------- dates
const MONTHS = [["jan", "january", "يناير", "كانون الثاني"], ["feb", "february", "فبراير", "شباط"], ["mar", "march", "مارس", "اذار"], ["apr", "april", "ابريل", "نيسان"], ["may", "مايو", "ايار"], ["jun", "june", "يونيو", "حزيران"], ["jul", "july", "يوليو", "تموز"], ["aug", "august", "اغسطس", "اب"], ["sep", "sept", "september", "سبتمبر", "ايلول"], ["oct", "october", "اكتوبر", "تشرين الاول"], ["nov", "november", "نوفمبر", "تشرين الثاني"], ["dec", "december", "ديسمبر", "كانون الاول"]];
const DAYS = [["sun", "sunday", "الاحد", "احد"], ["mon", "monday", "الاثنين", "الاتنين", "اثنين", "اتنين"], ["tue", "tuesday", "الثلاثاء", "التلات", "ثلاثاء", "التلاتاء"], ["wed", "wednesday", "الاربعاء", "الاربع", "اربعاء"], ["thu", "thursday", "الخميس", "خميس"], ["fri", "friday", "الجمعه", "جمعه"], ["sat", "saturday", "السبت", "سبت"]];
const pad = n => String(n).padStart(2, "0");
export const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const atMidnight = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };

function monthIndex(tok) { const t = normalize(tok); return MONTHS.findIndex(m => m.some(a => normalize(a) === t)); }

// Find every date mention with its position. Returns [{date, idx, len}]
export function findDates(text, today = new Date()) {
  const t = normalize(text); const base = atMidnight(today); const out = [];
  const push = (d, m) => { if (d && !isNaN(d)) out.push({ date: atMidnight(d), idx: m.index, len: m[0].length }); };
  let m;
  const reIso = /(\d{4})-(\d{1,2})-(\d{1,2})/g; while ((m = reIso.exec(t))) push(new Date(+m[1], +m[2] - 1, +m[3]), m);
  const reDmy = /(?<![\d-])(\d{1,2})[\/.](\d{1,2})(?:[\/.](\d{2,4}))?(?![\d-])/g;
  while ((m = reDmy.exec(t))) { let y = m[3] ? +m[3] : base.getFullYear(); if (y < 100) y += 2000; const d = new Date(y, +m[2] - 1, +m[1]); if (!m[3] && d < addDays(base, -60)) d.setFullYear(y + 1); push(d, m); }
  const monthAlt = MONTHS.flat().map(normalize).sort((a, b) => b.length - a.length).map(esc).join("|");
  const reDM = new RegExp(`(\\d{1,2})\\s*(?:من\\s*)?(?:شهر\\s*)?(${monthAlt})(?:\\s*(\\d{4}))?`, "giu");
  while ((m = reDM.exec(t))) { const mi = monthIndex(m[2]); if (mi < 0) continue; let y = m[3] ? +m[3] : base.getFullYear(); const d = new Date(y, mi, +m[1]); if (!m[3] && d < addDays(base, -60)) d.setFullYear(y + 1); push(d, m); }
  const reMD = new RegExp(`(${monthAlt})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s*(\\d{4}))?`, "giu");
  while ((m = reMD.exec(t))) { if (out.some(o => Math.abs(o.idx - m.index) < 4)) continue; const mi = monthIndex(m[1]); if (mi < 0) continue; let y = m[3] ? +m[3] : base.getFullYear(); const d = new Date(y, mi, +m[2]); if (!m[3] && d < addDays(base, -60)) d.setFullYear(y + 1); push(d, m); }
  const rel = [[/بعد بكر[هة]|بعد غد|day after tomorrow/g, 2], [/(?<!بعد )(بكر[هة]|غدا|غدوه|tomorrow)/g, 1], [/النهارد[هة]|اليوم|today/g, 0]];
  for (const [re, n] of rel) { re.lastIndex = 0; while ((m = re.exec(t))) push(addDays(base, n), m); }
  const dayAlt = DAYS.flat().map(normalize).sort((a, b) => b.length - a.length).map(esc).join("|");
  const reDay = new RegExp(`(?:(next|this|coming)\\s+)?(?:يوم\\s+)?(${dayAlt})(?:\\s+(الجاي|القادم|الياي|اللي جاي|الجاية|next))?`, "giu");
  while ((m = reDay.exec(t))) {
    if (/^(احد|اثنين|اتنين)$/.test(m[2]) && !m[1] && !m[3]) continue; // "احد" / "اثنين" alone are usually numbers/words
    const wd = DAYS.findIndex(d => d.some(a => normalize(a) === m[2])); if (wd < 0) continue;
    let diff = (wd - base.getDay() + 7) % 7; if (diff === 0) diff = 7; if ((m[1] === "next" || m[3]) && diff < 3 && false) diff += 7;
    push(addDays(base, diff), m);
  }
  out.sort((a, b) => a.idx - b.idx);
  return out.filter((o, i) => !out.some((p, j) => j !== i && p.idx <= o.idx && p.idx + p.len >= o.idx + o.len && p.len > o.len));
}

// working days between two dates inclusive, excluding the weekend days (default Fri/Sat)
export function workingDays(from, to, weekend = [5, 6]) { let n = 0; for (let d = atMidnight(from); d <= to; d = addDays(d, 1)) if (!weekend.includes(d.getDay())) n++; return n; }
function addWorkingDays(from, n, weekend = [5, 6]) { let d = atMidnight(from); while (weekend.includes(d.getDay())) d = addDays(d, 1); let left = n - 1; while (left > 0) { d = addDays(d, 1); if (!weekend.includes(d.getDay())) left--; } return d; }

export function extractDuration(text) {
  const t = normalize(text);
  let m = /(\d+(?:\.\d+)?)\s*(?:ايام|يوم|days?|working days|ايام عمل)/u.exec(t); if (m) return +m[1];
  m = /(\d+)\s*(?:اسابيع|اسبوع|weeks?)/u.exec(t); if (m) return +m[1] * 5;
  for (const [w, n] of Object.entries(NUM_WORDS)) if (new RegExp(`(^|\\s)${esc(normalize(w))}(\\s+(ايام|يوم|days?))?($|\\s|[,.])`, "u").test(t) && /(يوم|ايام|يومين|اسبوع|days?|week)/u.test(t)) return n === 7 ? 5 : n === 14 ? 10 : n;
  if (/نص يوم|half day|half a day/u.test(t)) return 0.5;
  return null;
}

// Relative due dates for promises: "بعد شهرين", "خلال اسبوعين", "in 3 weeks", "after 20 days", "end of the month"
export function relativeDate(text, today = new Date()) {
  const t = normalize(text); const base = new Date(today); base.setHours(0, 0, 0, 0);
  const add = (n, unit) => { const d = new Date(base); if (unit === "m") d.setMonth(d.getMonth() + n); else d.setDate(d.getDate() + n * (unit === "w" ? 7 : 1)); return iso(d); };
  if (/نهايه الشهر|اخر الشهر|end of (the )?month|month end/u.test(t)) { const d = new Date(base.getFullYear(), base.getMonth() + 1, 0); return iso(d); }
  const words = { "شهرين": [2, "m"], "شهر": [1, "m"], "اسبوعين": [2, "w"], "اسبوع": [1, "w"], "يومين": [2, "d"], "تلات شهور": [3, "m"], "ثلاث شهور": [3, "m"], "ثلاثه اشهر": [3, "m"], "a month": [1, "m"], "a week": [1, "w"], "two weeks": [2, "w"], "two months": [2, "m"], "three months": [3, "m"] };
  if (/(بعد|خلال|في خلال|in|after|within)\s/u.test(t)) {
    let m = /(\d+)\s*(شهور|اشهر|شهر|months?|اسابيع|اسبوع|weeks?|ايام|يوم|days?)/u.exec(t);
    if (m) return add(+m[1], /شه|month/u.test(m[2]) ? "m" : /سبو|week/u.test(m[2]) ? "w" : "d");
    for (const [w, [n, u]] of Object.entries(words)) if (new RegExp(`(^|\\s)${esc(w)}($|\\s|[,.؟?])`, "u").test(t)) return add(n, u);
  }
  if (/الشهر الجاي|الشهر القادم|next month/u.test(t)) return add(1, "m");
  return null;
}

// "from X to Y" | "X to Y" | single date + duration
export function extractDateRange(text, today = new Date(), weekend = [5, 6]) {
  const ds = findDates(text, today); const dur = extractDuration(text);
  if (ds.length >= 2) { let [a, b] = [ds[0].date, ds[1].date]; if (b < a) [a, b] = [b, a]; return { from: iso(a), to: iso(b), days: workingDays(a, b, weekend), duration_stated: dur }; }
  if (ds.length === 1) { const a = ds[0].date; if (dur && dur >= 1) { const b = addWorkingDays(a, Math.ceil(dur), weekend); return { from: iso(a), to: iso(b), days: dur }; } return { from: iso(a), to: iso(a), days: dur === 0.5 ? 0.5 : 1, single: true }; }
  if (dur) return { from: null, to: null, days: dur };
  return null;
}

// ---------------------------------------------------------------- entities
export const LEAVE_TYPES = {
  annual: ["سنويه", "اعتياديه", "سنوي", "annual", "vacation", "holiday", "اجازتي السنويه"],
  sick: ["مرضيه", "مريض", "تعبان", "تعبانه", "مستشفى", "دكتور", "sick", "ill", "doctor", "medical"],
  emergency: ["اضطراريه", "طارئه", "ظرف", "ظروف", "emergency", "urgent family"],
  unpaid: ["بدون راتب", "بدون اجر", "unpaid", "without pay"],
  marriage: ["زواج", "عرسي", "زواجي", "wedding", "marriage", "getting married"],
  bereavement: ["وفاه", "عزاء", "توفي", "توفيت", "bereavement", "passed away", "funeral"],
  paternity: ["مولود", "ولاده", "زوجتي ولدت", "paternity", "baby", "newborn"],
};
export function leaveType(text) { const t = normalize(text); for (const [k, w] of Object.entries(LEAVE_TYPES)) if (has(t, w)) return k; return null; }

export const LETTER_TYPES = {
  salary_certificate: ["تعريف بالراتب", "تعريف راتب", "شهاده راتب", "خطاب راتب", "تعريف بالمرتب", "salary certificate", "salary letter", "salary transfer"],
  employment_certificate: ["خطاب تعريف", "تعريف", "شهاده عمل", "مشهد", "لمن يهمه الامر", "employment letter", "employment certificate", "to whom it may concern", "introduction letter"],
  experience_letter: ["شهاده خبره", "خطاب خبره", "experience letter", "experience certificate"],
  noc: ["عدم ممانعه", "noc", "no objection"],
};
export function letterType(text) { const t = normalize(text); for (const k of ["salary_certificate", "experience_letter", "noc", "employment_certificate"]) if (has(t, LETTER_TYPES[k])) return k; return null; }
export function addressedTo(text) {
  const raw = String(text);
  let m = /(?:لـ?\s?|ل|الى|إلى|موجه(?:ه)?\s+(?:ل|الى|إلى))\s*((?:بنك|مصرف|سفاره|سفارة|القنصليه|القنصلية|جهة|شركه|شركة|الجوازات|وزاره|وزارة)\s+[\p{L}\s]{2,30}?)(?=$|[.,،\n]| علشان| عشان| لاني| بخصوص)/iu.exec(raw);
  if (m) return m[1].trim();
  m = /\b(?:for|to|addressed to)\s+((?:the\s+)?(?:[A-Z][\p{L}'-]+\s){0,3}(?:Bank|Embassy|Consulate|Ministry|Company|Group)(?:\s+of\s+(?:the\s+)?[A-Z][\p{L}]+(?:\s[A-Z][\p{L}]+)?)?)\b/u.exec(raw);
  if (m) return m[1].trim();
  m = /\bto\s+((?:the\s+)?(?:[A-Z][\p{L}]+\s?){1,4}(?:Bank|Embassy|Consulate|Ministry|Company)?)/u.exec(raw);
  if (m && !/whom/i.test(m[1])) return m[1].trim();
  if (/بنك|bank/iu.test(raw)) { m = /(?:بنك|مصرف)\s+([\p{L}]+(?:\s[\p{L}]+)?)/u.exec(raw) || /([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)\s+bank/u.exec(raw); if (m) return /bank/i.test(m[0]) ? m[0] : `بنك ${m[1]}`; }
  return null;
}
export function amount(text) { const m = /(\d[\d,]*(?:\.\d+)?)\s*(?:ريال|ر\.?س|sar|sr|riyal)/iu.exec(normalize(text)) || /(?:sar|ريال)\s*(\d[\d,]*(?:\.\d+)?)/iu.exec(normalize(text)); return m ? +m[1].replace(/,/g, "") : null; }
export function invoiceNo(text) { const m = /(?:inv|فاتوره|فاتورة|invoice)\s*(?:رقم|no\.?|#)?\s*[:#-]?\s*([a-z]*-?\d{3,})/iu.exec(normalize(text)); return m ? m[1].toUpperCase() : null; }
export function bankRef(text) { const m = /(?:reference|ref|مرجع|رقم العمليه|رقم الحواله|حواله رقم)\s*[:#]?\s*([a-z0-9-]{5,})/iu.exec(normalize(text)); return m ? m[1].toUpperCase() : null; }
export function pickNumberChoice(text, max) { const m = /^\s*(\d)\s*$/.exec(normalize(text)) || /(?:رقم|option|الخيار)\s*(\d)/u.exec(normalize(text)); if (m && +m[1] >= 1 && +m[1] <= max) return +m[1]; const ord = [["الاول", "first", "اول"], ["الثاني", "التاني", "second", "تاني"], ["الثالث", "التالت", "third", "تالت"]]; const t = normalize(text); const i = ord.findIndex(o => has(t, o)); return i >= 0 && i < max ? i + 1 : null; }
export function yesNo(text) { const t = normalize(text); if (has(t, ["نعم", "ايوه", "ايوا", "اي", "تمام", "اوكي", "ok", "okay", "yes", "yep", "sure", "اكيد", "موافق", "يب", "ماشي", "confirm", "اكد", "ابشر"])) return true; if (has(t, ["لا", "لاء", "no", "nope", "مش", "الغي", "الغاء", "cancel", "بلاش"])) return false; return null; }

// ---------------------------------------------------------------- intents
// Each intent: [name, keyword sets (any match adds weight), weight]. Score = sum of matched weights.
export const INTENTS = {
  common: [
    ["greeting", [["السلام", "سلام", "مرحبا", "اهلا", "هلا", "صباح الخير", "مساء الخير", "hi", "hello", "hey", "good morning", "good evening", "salam"]], 1],
    ["thanks", [["شكرا", "مشكور", "تسلم", "يعطيك العافيه", "جزاك الله", "thanks", "thank you", "thx", "appreciate"]], 1.2],
    ["human", [["موظف", "انسان", "بشري", "مسؤول", "حد يكلمني", "اكلم حد", "كلم", "human", "real person", "agent", "representative", "talk to someone", "manager"], ["ابغى", "عايز", "اريد", "ممكن", "want", "need", "can i", "let me", "talk", "speak", "اكلم", "تواصل"]], 0.9],
  ],
  hr: [
    ["leave_balance", [["رصيد", "رصيدي", "كم يوم", "باقي لي", "باقيلي", "متبقي", "كام يوم", "balance", "how many days", "days left", "remaining"], ["اجازه", "اجازات", "اجازتي", "leave", "vacation", "days off"]], 1.4],
    ["leave_request", [["اجازه", "اجازات", "اجازتي", "leave", "vacation", "day off", "days off", "time off", "اوف"], ["ابغى", "ابي", "عايز", "عاوز", "اريد", "اطلب", "طلب", "احتاج", "محتاج", "اخذ", "اخد", "need", "want", "request", "take", "apply", "book", "would like", "can i", "ممكن", "بكره", "بكرة", "من", "from", "تعبان", "مريض", "sick"]], 1.3],
    ["leave_status", [["حاله", "وضع", "وين وصل", "فين وصل", "اعتمد", "اتوافق", "انقبل", "status", "approved yet", "update on"], ["طلب", "طلبي", "اجازتي", "request", "leave"]], 1.2],
    ["letter_request", [["خطاب", "شهاده", "تعريف", "مشهد", "لمن يهمه", "letter", "certificate", "noc", "عدم ممانعه"]], 1.4],
    ["payday", [["راتب", "الراتب", "رواتب", "معاش", "مرتب", "salary", "payroll", "pay day", "payday", "payslip"], ["متي", "امتي", "ايمتي", "يوم كم", "تاريخ", "ينزل", "when", "date", "day", "slip", "كشف"]], 1.1],
    ["id_expiry", [["اقامه", "اقامتي", "الاقامه", "هويه", "تنتهي", "iqama", "residency", "id expiry", "id card"]], 1.2],
    ["policy", [["سياسه", "نظام", "لائحه", "قانون", "مسموح", "يحق", "يحقلي", "كم ساعه", "ساعات", "الدوام", "دوام", "بدل", "اوفر", "اضافي", "تأمين", "تامين", "طبي", "تجربه", "استقاله", "نهايه الخدمه", "مكافاه", "عن بعد", "ريموت", "ملابس", "حضور", "تاخير", "تأخير", "مدفوعه", "مدفوع", "براتب", "مرضيه", "sick days", "sick leave", "paid sick", "policy", "rule", "allowed", "entitled", "fully paid", "with pay", "working hours", "hours", "overtime", "allowance", "insurance", "medical", "probation", "resign", "resignation", "notice period", "end of service", "remote", "work from home", "dress", "attendance", "late", "lateness", "maternity", "marriage leave", "hajj"]], 1.0],
    ["apply_job", [["وظيفه", "وظائف", "توظيف", "شاغر", "شواغر", "سيره ذاتيه", "سي في", "cv", "resume", "job", "jobs", "vacancy", "hiring", "apply", "position", "career"]], 1.1],
  ],
  collections: [
    ["balance", [["كم علينا", "كم المستحق", "المستحق", "رصيد", "المبلغ", "كشف حساب", "حسابنا", "balance", "outstanding", "statement", "how much do we owe", "amount due", "due"]], 1.3],
    ["promise", [["بندفع", "هندفع", "بنحول", "هنحول", "سنسدد", "بنسدد", "راح نحول", "نحول", "ندفع", "نسدد", "will pay", "we'll pay", "will transfer", "transfer on", "pay on", "payment on", "by next", "promise", "next week", "end of month", "نهايه الشهر"]], 1.4],
    ["paid", [["حولنا", "دفعنا", "سددنا", "تم التحويل", "تم السداد", "تم الدفع", "اتحول", "حولت", "paid", "transferred", "settled", "payment done", "remitted", "sent the payment"]], 1.5],
    ["dispute", [["خطا", "غلط", "اعتراض", "مش صحيح", "غير صحيح", "ما استلمنا", "مااستلمنا", "مشكله في الفاتوره", "dispute", "wrong", "incorrect", "error", "not received", "didn't receive", "disagree", "issue with the invoice"]], 1.4],
    ["invoice_copy", [["نسخه", "ارسل الفاتوره", "ابعت الفاتوره", "صوره الفاتوره", "copy", "send the invoice", "resend", "invoice pdf"]], 1.3],
  ],
  sales: [
    ["pricing", [["سعر", "اسعار", "الاسعار", "تكلفه", "بكم", "بكام", "كم يكلف", "عرض سعر", "price", "prices", "pricing", "cost", "quote", "quotation", "how much", "rates"]], 1.3],
    ["service_inquiry", [["خدمات", "خدمه", "تقدمون", "عندكم", "توفرون", "تشتغلون", "محتاجين", "نحتاج", "نبغى", "عايزين", "services", "service", "do you offer", "do you provide", "we need", "looking for", "interested", "provide"]], 1.0],
    ["book_meeting", [["اجتماع", "موعد", "ميتنج", "زياره", "مكالمه", "نتقابل", "meeting", "call", "appointment", "visit", "demo", "schedule", "book"]], 1.2],
  ],
};

export function classify(text, role) {
  const t = normalize(text);
  const scored = [];
  for (const [name, sets, w] of [...(INTENTS[role] || []), ...INTENTS.common]) {
    const hits = sets.map(ws => ws.filter(x => word(x).test(t)));
    if (!hits[0].length) continue;
    let s = w * (1 + 0.15 * (hits[0].length - 1));
    if (sets.length > 1) { if (hits.slice(1).every(h => h.length)) s += 0.6 * w; else s *= 0.55; }
    scored.push({ intent: name, score: +s.toFixed(2), matched: hits.flat().slice(0, 4) });
  }
  // contextual boosts
  const boost = (n, by) => { const x = scored.find(s => s.intent === n); if (x) x.score = +(x.score + by).toFixed(2); };
  if (role === "hr") { if (has(t, ["وين وصل", "فين وصل", "حاله طلب", "وضع طلب", "اتوافق", "انقبل", "اعتمد", "status", "approved yet", "any update"])) boost("leave_status", 0.8); if (findDates(text).length || extractDuration(text)) boost("leave_request", 0.5); if (letterType(text)) boost("letter_request", 0.5); if (has(t, ["كم", "how many", "باقي", "remaining", "left"])) boost("leave_balance", 0.4); if (has(t, ["مدفوعه", "مدفوع", "براتب", "يحق", "يحقلي", "مسموح", "النظام", "entitled", "allowed", "policy", "fully paid", "with pay", "paid", "do i get", "يستحق"]) && !has(t, ["رصيد", "رصيدي", "باقي", "باقيلي", "متبقي", "my balance", "left", "remaining"]) && !findDates(text).length) { boost("policy", 1.2); boost("leave_balance", -1.2); boost("leave_request", -0.8); } }
  if (role === "collections") { if (findDates(text).length) boost("promise", 0.4); if (bankRef(text)) boost("paid", 0.6); }
  scored.sort((a, b) => b.score - a.score);
  const top = scored[0];
  if (!top) return { intent: "unknown", confidence: 0, alternatives: [] };
  // greetings/thanks only win when nothing else matched strongly
  if (["greeting", "thanks"].includes(top.intent) && scored[1] && scored[1].score >= 0.9) { const [a, b] = scored; scored[0] = b; scored[1] = a; }
  const best = scored[0];
  const conf = Math.min(0.99, +(best.score / (best.score + (scored[1]?.score || 0.4))).toFixed(2));
  return { intent: best.intent, confidence: conf, matched: best.matched, alternatives: scored.slice(1, 3).map(s => `${s.intent} ${s.score}`) };
}

// ---------------------------------------------------------------- CV screening
const SKILL_SYNONYMS = {
  "excel": ["excel", "اكسل", "spreadsheets"], "payroll": ["payroll", "رواتب", "مسيرات"], "gosi": ["gosi", "التامينات", "تأمينات"], "qiwa": ["qiwa", "قوى"], "mudad": ["mudad", "مدد"],
  "saudi labor law": ["labor law", "labour law", "نظام العمل", "قانون العمل"], "recruitment": ["recruitment", "hiring", "توظيف", "استقطاب"], "english": ["english", "انجليزي", "الانجليزيه"],
  "hvac": ["hvac", "تكييف", "chiller", "تشلر"], "electrical": ["electrical", "كهرباء", "كهربائي"], "plumbing": ["plumbing", "سباكه"], "bms": ["bms", "building management"], "cafm": ["cafm", "maximo", "archibus"],
  "driving license": ["driving license", "رخصه قياده", "رخصة قيادة", "license"], "forklift": ["forklift", "فوركلفت", "رافعه شوكيه"], "wms": ["wms", "warehouse management", "sap ewm"], "sap": ["sap"], "crm": ["crm", "salesforce", "hubspot", "zoho"], "b2b sales": ["b2b", "corporate sales", "مبيعات الشركات"], "arabic": ["arabic", "عربي"],
};
export function screenCv(cvText, req) {
  const t = normalize(cvText); const breakdown = []; let score = 0;
  const must = req.must || [], nice = req.nice || [];
  const found = s => (SKILL_SYNONYMS[s] || [s]).some(w => word(w).test(t));
  const mustW = must.length ? 60 / must.length : 0, niceW = nice.length ? 20 / nice.length : 0;
  for (const s of must) { const ok = found(s); if (ok) score += mustW; breakdown.push({ item: s, type: "must", ok }); }
  for (const s of nice) { const ok = found(s); if (ok) score += niceW; breakdown.push({ item: s, type: "nice", ok }); }
  const ym = /(\d{1,2})\+?\s*(?:years|year|yrs|سنوات|سنه|سنين|عام|اعوام)/iu.exec(t); const years = ym ? +ym[1] : 0;
  const yScore = req.min_years ? Math.min(20, 20 * years / req.min_years) : 20; score += yScore;
  breakdown.push({ item: `${years} years experience (min ${req.min_years || 0})`, type: "experience", ok: years >= (req.min_years || 0) });
  return { score: Math.round(score), years, breakdown, missing_must: breakdown.filter(b => b.type === "must" && !b.ok).map(b => b.item) };
}
