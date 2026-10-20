// UI strings: keys are the English text, Arabic in ./i18n-ar.js. t(key, vars) falls back to the key.
import { AR } from "./i18n-ar.js";
const KEY = "workforce.lang";
export let LANG = localStorage.getItem(KEY) || (new URLSearchParams(location.search).get("lang")) || ((navigator.language || "").startsWith("ar") ? "ar" : "en");
export function setLang(l) { LANG = l === "ar" ? "ar" : "en"; localStorage.setItem(KEY, LANG); document.documentElement.lang = LANG; document.documentElement.dir = LANG === "ar" ? "rtl" : "ltr"; }
const EN = { owner: "Owner", hr_manager: "HR manager", finance_manager: "Finance manager", sales_manager: "Sales manager", viewer: "Viewer", platform: "Platform operator", waiting_human: "with a human", web_chat: "web chat", whatsapp: "WhatsApp", email: "e-mail",
  salary_certificate: "Salary certificate", employment_certificate: "Employment certificate", experience_letter: "Experience letter", noc: "No-objection letter" };
export function t(k, vars) { let s = (LANG === "ar" ? AR[k] : EN[k]) || k; if (vars) for (const [a, b] of Object.entries(vars)) s = s.replaceAll(`{${a}}`, b); return s; }
export const L = (en, ar) => (LANG === "ar" ? ar ?? en : en);
export const nf = (n, d = 0) => Number(n || 0).toLocaleString(LANG === "ar" ? "ar-SA-u-nu-latn" : "en-US", { maximumFractionDigits: d, minimumFractionDigits: d });
export const money = n => `${nf(n)} ${LANG === "ar" ? "ر.س" : "SAR"}`;
const MON_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], MON_AR = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
export function fdate(s, withTime = false) {
  if (!s) return "—"; const d = new Date(String(s).replace(" ", "T")); if (isNaN(d)) return s;
  const day = `${d.getDate()} ${(LANG === "ar" ? MON_AR : MON_EN)[d.getMonth()]}`;
  return withTime ? `${day} · ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}` : day;
}
export function ago(s) {
  const d = new Date(String(s).replace(" ", "T")); const m = Math.round((Date.now() - d) / 60000);
  if (m < 1) return t("just now"); if (m < 60) return t("{n} min ago", { n: m }); const h = Math.round(m / 60); if (h < 24) return t("{n} h ago", { n: h }); return fdate(s);
}
// Titles written by AI employees are stored in both languages: {"ar": "...", "en": "..."}
export function tt(s) { if (s && s[0] === "{") { try { const o = JSON.parse(s); return o[LANG] || o.en || o.ar; } catch {} } return s; }
