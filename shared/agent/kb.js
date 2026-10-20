// Knowledge retrieval over the tenant's policy documents. Paragraph-level scoring with Arabic
// normalization, light stemming and a bilingual synonym map, so "overtime" finds "العمل الإضافي".
import { normalize } from "./nlu.js";

const STOP = new Set(["في", "من", "على", "عن", "الى", "او", "و", "ما", "هل", "كم", "متي", "ايش", "وش", "اي", "هو", "هي", "ان", "انا", "لي", "عندي", "عندكم", "the", "a", "an", "is", "are", "of", "to", "in", "on", "for", "what", "how", "do", "does", "i", "my", "we", "our", "can", "and", "or", "with", "at", "be", "it", "this", "that", "يا", "مع", "كيف", "ليش", "بس", "حق", "حقي", "تبع"]);
const SYN = [
  ["overtime", "اضافي", "اوفر", "اوفرتايم", "الاضافي", "الساعات الاضافيه"],
  ["hours", "ساعات", "الدوام", "دوام", "working", "shift"],
  ["ramadan", "رمضان"],
  ["annual", "سنويه", "اعتياديه", "سنوي"],
  ["sick", "مرضيه", "مرض"],
  ["leave", "اجازه", "اجازات"],
  ["salary", "راتب", "الراتب", "رواتب", "مرتب", "payroll"],
  ["allowance", "بدل", "بدلات"],
  ["housing", "سكن"], ["transport", "نقل", "مواصلات"],
  ["insurance", "تامين", "طبي", "medical"],
  ["probation", "تجربه", "التجربه"],
  ["resign", "resignation", "استقاله", "notice", "انذار"],
  ["end of service", "نهايه الخدمه", "مكافاه", "gratuity"],
  ["remote", "عن بعد", "ريموت", "work from home", "wfh"],
  ["late", "lateness", "تاخير", "تاخر", "attendance", "حضور", "بصمه"],
  ["marriage", "زواج"], ["bereavement", "وفاه"], ["paternity", "مولود", "ولاده"], ["maternity", "وضع", "الولاده"], ["hajj", "حج"],
  ["dress", "ملابس", "زي", "اللبس"], ["payday", "يوم الراتب", "صرف الرواتب"], ["loan", "سلفه", "قرض", "advance"],
  ["payment", "سداد", "دفع", "تحويل"], ["terms", "شروط", "مده السداد"], ["penalty", "غرامه", "تاخير السداد"],
];
const synMap = new Map(); for (const g of SYN) { const ng = g.map(normalize); for (const w of ng) synMap.set(w, ng); }
const stem = w => w.replace(/^(وال|بال|كال|فال|لل|ال)/, "").replace(/(ات|ون|ين|يه|ه)$/, "");
export function tokens(text) {
  const t = normalize(text).replace(/[^\p{L}\p{N}\s]/gu, " ");
  const out = new Set();
  for (const w of t.split(" ")) { if (!w || STOP.has(w) || w.length < 2) continue; out.add(stem(w)); out.add(w); }
  // phrase synonyms
  for (const [k, g] of synMap) if (k.includes(" ") && t.includes(k)) g.forEach(x => out.add(x));
  for (const w of [...out]) { const g = synMap.get(w) || synMap.get(stem(w)); if (g) g.forEach(x => { out.add(x); out.add(stem(x)); }); }
  return out;
}

export function buildIndex(docs) {
  const paras = [];
  for (const d of docs) {
    const parts = d.body.split(/\n\s*\n|\n(?=[-•*]\s|\d+[.)]\s|#)/).map(p => p.trim()).filter(p => p.length > 20);
    parts.forEach((p, i) => paras.push({ doc_id: d.id, title: d.title, lang: d.lang, n: i + 1, text: p, toks: tokens(`${d.title} ${p}`) }));
  }
  // idf
  const df = new Map(); for (const p of paras) for (const t of p.toks) df.set(t, (df.get(t) || 0) + 1);
  const N = paras.length || 1; for (const p of paras) p.idf = t => Math.log(1 + N / (df.get(t) || 1));
  return paras;
}

export function search(index, query, lang) {
  const q = tokens(query);
  const scored = index.map(p => { let s = 0; const hit = []; for (const t of q) if (p.toks.has(t)) { s += p.idf(t); hit.push(t); } if (lang && p.lang !== lang) s *= 0.55; return { ...p, score: +s.toFixed(2), hit }; })
    .filter(p => p.score > 0).sort((a, b) => b.score - a.score);
  return scored.slice(0, 3).map(({ idf, toks, ...p }) => p);
}
