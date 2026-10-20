// Formatting helpers for agent replies (dates and money in Arabic or English).
const DAYS_AR = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
const DAYS_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON_AR = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
const MON_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const parse = s => new Date(s.length === 10 ? s + "T00:00:00" : s.replace(" ", "T"));
export function fmtDay(s, lang) { if (!s) return ""; const d = parse(s); return lang === "ar" ? `${DAYS_AR[d.getDay()]} ${d.getDate()} ${MON_AR[d.getMonth()]}` : `${DAYS_EN[d.getDay()]} ${d.getDate()} ${MON_EN[d.getMonth()]}`; }
export function fmtDateTime(s, lang) { const d = parse(s); const h = d.getHours(), m = String(d.getMinutes()).padStart(2, "0"); if (lang === "ar") return `${fmtDay(s, "ar")} الساعة ${h > 12 ? h - 12 : h}:${m} ${h >= 12 ? "م" : "ص"}`; return `${fmtDay(s, "en")} at ${h > 12 ? h - 12 : h}:${m} ${h >= 12 ? "PM" : "AM"}`; }
export const money = (n, lang) => `${Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })} ${lang === "ar" ? "ريال" : "SAR"}`;
export const LEAVE_LABEL = {
  ar: { annual: "سنوية", sick: "مرضية", emergency: "اضطرارية", unpaid: "بدون راتب", marriage: "زواج", bereavement: "وفاة", paternity: "مولود" },
  en: { annual: "Annual", sick: "Sick", emergency: "Emergency", unpaid: "Unpaid", marriage: "Marriage", bereavement: "Bereavement", paternity: "Paternity" },
};
export const LETTER_LABEL = {
  ar: { salary_certificate: "تعريف بالراتب", employment_certificate: "خطاب تعريف", experience_letter: "شهادة خبرة", noc: "خطاب عدم ممانعة" },
  en: { salary_certificate: "Salary certificate", employment_certificate: "Employment letter", experience_letter: "Experience letter", noc: "No-objection letter" },
};
