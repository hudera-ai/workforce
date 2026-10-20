import test from "node:test";
import assert from "node:assert/strict";
import { classify, extractDateRange, screenCv, iso, detectLang, relativeDate } from "../shared/agent/nlu.js";
import { buildIndex, search } from "../shared/agent/kb.js";
import { arDays } from "../shared/agent/runtime.js";

test("intent classification — Arabic and English, per role", () => {
  const cases = [
    ["كم رصيد إجازتي؟", "hr", "leave_balance"], ["ابغى اجازة من 12 نوفمبر الى 14 نوفمبر", "hr", "leave_request"], ["محتاج تعريف بالراتب لبنك الراجحي", "hr", "letter_request"],
    ["متى ينزل الراتب؟", "hr", "payday"], ["كم يوم إجازة مرضية مدفوعة؟", "hr", "policy"], ["What is the overtime policy?", "hr", "policy"], ["How many paid sick days do I get?", "hr", "policy"],
    ["وين وصل طلب اجازتي؟", "hr", "leave_status"], ["عندكم وظائف؟", "hr", "apply_job"], ["ابغى اكلم موظف", "hr", "human"],
    ["كم المستحق علينا؟", "collections", "balance"], ["بنحول يوم الخميس الجاي", "collections", "promise"], ["We transferred the payment, reference TRX1234", "collections", "paid"],
    ["في خطأ في الفاتورة", "collections", "dispute"], ["Please resend the invoice copy", "collections", "invoice_copy"],
    ["بكم عقد النظافة؟", "sales", "pricing"], ["We need security guards", "sales", "service_inquiry"],
  ];
  for (const [text, role, intent] of cases) assert.equal(classify(text, role).intent, intent, `${text} → ${intent}`);
});

test("date ranges and working days (Fri/Sat weekend)", () => {
  const today = new Date("2026-10-19T10:00:00"); // Monday
  const r = extractDateRange("ابغى اجازة من 27 أكتوبر الى 29 أكتوبر", today);
  assert.equal(r.from, "2026-10-27"); assert.equal(r.to, "2026-10-29"); assert.equal(r.days, 3);
  const w = extractDateRange("I need leave from 22 Oct to 25 Oct", today);
  assert.equal(w.days, 2, "Thu + Sun, weekend excluded");
  const t = extractDateRange("ابغى اجازة بكرة", today); assert.equal(t.from, "2026-10-20");
  assert.equal(relativeDate("بنسدد بعد شهرين", today), "2026-12-19"); assert.equal(relativeDate("we'll pay in 3 weeks", today), "2026-11-09");
  assert.equal(relativeDate("نهاية الشهر", today), "2026-10-31"); assert.equal(relativeDate("thanks", today), null);
});

test("CV screening scores must-haves, nice-to-haves and years", () => {
  const req = { must: ["payroll", "gosi", "saudi labor law", "excel"], nice: ["qiwa", "english"], min_years: 3 };
  const strong = screenCv("HR officer, 5 years. Payroll, GOSI, Qiwa, Saudi labor law, advanced Excel, fluent English.", req);
  const weak = screenCv("Receptionist, 1 year experience, good communication.", req);
  assert.ok(strong.score >= 90, `strong ${strong.score}`); assert.ok(weak.score < 30, `weak ${weak.score}`);
});

test("knowledge search finds the right paragraph in both languages", () => {
  const idx = buildIndex([{ id: 1, title: "Policy", lang: "en", body: "Overtime\nOvertime is paid at 150% of the hourly rate.\n\nSick leave\nThe first 30 days are fully paid." },
    { id: 2, title: "اللائحة", lang: "ar", body: "العمل الإضافي\nيُحتسب العمل الإضافي بأجر الساعة مضافًا إليه 50%.\n\nالإجازة المرضية\nأول 30 يومًا براتب كامل." }]);
  assert.match(search(idx, "overtime rate", "en")[0].text, /150%/);
  assert.match(search(idx, "كم الاجازة المرضية", "ar")[0].text, /30 يومًا/);
});

test("Arabic number agreement and language detection", () => {
  assert.equal(arDays("المدة: 3 يوم عمل"), "المدة: 3 أيام عمل");
  assert.equal(arDays("1 يوم"), "يوم واحد"); assert.equal(arDays("2 يوم عمل"), "يومي عمل"); assert.equal(arDays("بعد 37 يوم"), "بعد 37 يوم");
  assert.equal(detectLang("كم رصيدي"), "ar"); assert.equal(detectLang("what is my balance"), "en");
});
