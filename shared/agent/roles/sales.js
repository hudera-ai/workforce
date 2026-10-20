// Sales Development Rep AI — answers new inquiries, qualifies them, books a meeting.
import { classify, normalize, has, pickNumberChoice, iso } from "../nlu.js";
import { slots, stamp } from "../tools.js";
import { fmtDateTime, money } from "../format.js";

const CITIES = { riyadh: ["الرياض", "riyadh"], jeddah: ["جده", "جدة", "jeddah", "jedda"], dammam: ["الدمام", "دمام", "dammam"], khobar: ["الخبر", "khobar", "al khobar"], makkah: ["مكه", "مكة", "makkah", "mecca"], madinah: ["المدينه", "المدينة", "madinah", "medina"], jubail: ["الجبيل", "jubail"], tabuk: ["تبوك", "tabuk"], abha: ["ابها", "abha"], qassim: ["القصيم", "بريده", "qassim", "buraidah"], taif: ["الطائف", "taif"] };
const CITY_LABEL = { riyadh: ["الرياض", "Riyadh"], jeddah: ["جدة", "Jeddah"], dammam: ["الدمام", "Dammam"], khobar: ["الخبر", "Khobar"], makkah: ["مكة", "Makkah"], madinah: ["المدينة", "Madinah"], jubail: ["الجبيل", "Jubail"], tabuk: ["تبوك", "Tabuk"], abha: ["أبها", "Abha"], qassim: ["القصيم", "Qassim"], taif: ["الطائف", "Taif"] };
export function city(text) { const t = normalize(text); for (const [k, ws] of Object.entries(CITIES)) if (has(t, ws)) return k; return null; }
export function size(text) {
  const t = normalize(text);
  const m = /(\d[\d,]*)\s*(?:\+\s*)?(ادوار|دور|طوابق|طابق|floors?|storeys?|موظف|موظفين|employees|staff|حارس|حراس|guards?|م2|م٢|sqm|m2|متر مربع|square meters|مبني|مباني|مبنى|buildings?|فروع|فرع|branches|مواقع|موقع|sites?|طن|tons?|شحنه|شحنات|shipments?|pallets?|بالته|بالتات|وحده|وحدات|units?|فيلا|فلل|villas?)/u.exec(t);
  return m ? `${m[1]} ${m[2]}` : null;
}
export function timeline(text) {
  const t = normalize(text);
  const T = [[["فورا", "حالا", "اسرع وقت", "باسرع", "asap", "immediately", "urgent", "عاجل", "اليوم", "today"], 3], [["هذا الاسبوع", "الاسبوع هذا", "this week", "خلال اسبوع", "within a week"], 7], [["الاسبوع الجاي", "الاسبوع القادم", "next week"], 14], [["هذا الشهر", "الشهر هذا", "this month", "خلال شهر", "within a month", "نهايه الشهر", "end of the month"], 30], [["الشهر الجاي", "الشهر القادم", "next month"], 45], [["شهرين", "two months", "2 months"], 60], [["ربع", "quarter", "3 months", "ثلاث شهور", "تلات شهور"], 90], [["السنه الجايه", "next year", "مش مستعجل", "not urgent", "just exploring", "نستكشف"], 180]];
  for (const [ws, d] of T) if (has(t, ws)) return d;
  return null;
}
function company(text) { const m = /(?:شركه|شركة|مؤسسه|مؤسسة|مجموعه|مجموعة)\s+([\p{L}\s]{2,30}?)(?=[,.،\n]|$| في | و | نحتاج| محتاجين)/u.exec(text) || /(?:from|at|we are|i'm with|on behalf of)\s+([A-Z][\w&\s]{1,30}?)(?=[,.\n]|$| in | and | we )/u.exec(text); return m ? m[1].trim() : null; }

export function sales(ctx) {
  const L = ctx.L; const st = ctx.state || {};
  // find or create the lead for this number
  let lead = st.lead_id ? ctx.dbx.get("SELECT * FROM leads WHERE id=?", [st.lead_id]) : ctx.dbx.get("SELECT * FROM leads WHERE tenant_id=? AND phone=? ORDER BY id DESC", [ctx.tenant.id, ctx.contact.phone || "-"]);
  if (!lead) { const { id } = ctx.tool("crm.upsert_lead", { name: ctx.contact.name || "WhatsApp lead", phone: ctx.contact.phone, source: ctx.conv.channel, stage: "new" }); lead = ctx.dbx.get("SELECT * FROM leads WHERE id=?", [id]); ctx.step("identify", L("عميل محتمل جديد", "New lead created"), `#${id} · ${ctx.contact.phone || ""}`); }
  else ctx.step("identify", L("عميل محتمل موجود", "Existing lead"), `#${lead.id} · ${lead.stage}${lead.company ? " · " + lead.company : ""}`);
  ctx.patchState({ lead_id: lead.id });

  // choosing a meeting slot
  if (st.flow === "slot") {
    const n = pickNumberChoice(ctx.text, 2);
    if (n) {
      const at = st.slots[n - 1];
      ctx.tool("crm.book_meeting", { lead_id: lead.id, at });
      ctx.step("notify", L("إشعار مدير المبيعات", "Sales manager notified"), `${at}`);
      ctx.patchState({ lead_id: lead.id, flow: null });
      ctx.say(L(`تم الحجز ✅ ${fmtDateTime(at, "ar")} مع مدير الحسابات لدينا. بيوصلك رابط الاجتماع ودعوة التقويم. نتشرف بالتعاون معكم!`, `Booked ✅ ${fmtDateTime(at, "en")} with our account manager. You'll receive the meeting link and a calendar invite. Looking forward to it!`));
      return ctx.task("meeting", ctx.T(`اجتماع محجوز — ${lead.company || lead.name}`, `Meeting booked — ${lead.company || lead.name}`), "done", "lead", lead.id);
    }
  }

  const c = classify(ctx.text, "sales");
  ctx.step("understand", L("فهم الرسالة", "Understood intent"), `${c.intent} · ${L("ثقة", "confidence")} ${Math.round(c.confidence * 100)}%${c.matched?.length ? ` · ${c.matched.join("، ")}` : ""}`);
  if (c.intent === "human") { ctx.tool("common.handoff", { reason: "asked for human" }); ctx.step("escalate", L("تحويل لفريق المبيعات", "Handed to sales team"), ""); ctx.say(L("أكيد، حولتك لزميل من فريق المبيعات وبيتواصل معك خلال ساعة عمل.", "Sure — I've passed you to a colleague in sales; they'll contact you within a business hour.")); return ctx.task("handoff", ctx.T("تحويل لموظف", "Handed over"), "escalated", "lead", lead.id); }
  if (c.intent === "thanks") { ctx.say(L("العفو! بالخدمة دائمًا.", "You're welcome — happy to help.")); return; }

  // pull every qualifying detail we can from this message
  const svc = ctx.tool("crm.match_service", { text: `${ctx.text} ${lead.need || ""}`, normalize });
  const upd = {};
  if (svc[0] && !lead.need) upd.need = svc[0].name_en;
  const sz = size(ctx.text); if (sz) upd.size = sz;
  const ct = city(ctx.text); if (ct) upd.city = ct;
  const tl = timeline(ctx.text); if (tl) upd.timeline = String(tl);
  const co = company(ctx.text); if (co) upd.company = co;
  if (Object.keys(upd).length) ctx.step("entities", L("بيانات التأهيل", "Qualification details"), Object.entries(upd).map(([k, v]) => `${k}: ${v}`).join(" · "));
  const L2 = { ...lead, ...upd };

  let intro = "";
  if (svc[0] && (c.intent === "pricing" || c.intent === "service_inquiry" || !lead.need)) {
    const s = svc[0];
    intro = L(`نعم، نقدم ${s.name_ar}${s.price_from ? `، والأسعار تبدأ من ${money(s.price_from, "ar")} شهريًا حسب الحجم والنطاق` : ""}.`, `Yes — we provide ${s.name_en.toLowerCase()}${s.price_from ? `, starting from ${money(s.price_from, "en")}/month depending on size and scope` : ""}.`);
  } else if (c.intent === "greeting" && !lead.need) {
    intro = L(`أهلًا وسهلًا 👋 معك ${ctx.agent.name_ar} من ${ctx.tenant.name_ar}.`, `Hello 👋 This is ${ctx.agent.name} from ${ctx.tenant.name_en}.`);
  }

  // score
  const R = ctx.rules; const served = (R.served_cities || []).includes(L2.city);
  const tlDays = L2.timeline ? +L2.timeline : null;
  let score = 0; const parts = [];
  if (L2.need) { score += 30; parts.push("need +30"); }
  if (L2.size) { score += 20; parts.push("size +20"); }
  if (L2.city) { if (served) { score += 20; parts.push("city served +20"); } else parts.push("city not served +0"); }
  if (tlDays != null) { const s = tlDays <= 30 ? 20 : tlDays <= 90 ? 10 : 0; score += s; parts.push(`timeline ${tlDays}d +${s}`); }
  if (L2.company) { score += 10; parts.push("company +10"); }
  upd.score = score; upd.stage = score >= (R.qualify_threshold || 60) ? "qualified" : "qualifying";
  ctx.tool("crm.upsert_lead", { id: lead.id, ...upd });
  ctx.step("score", L("تقييم العميل المحتمل", "Lead score"), `${score}/100 · ${parts.join(" · ") || "—"}`);

  if (L2.city && !served) {
    ctx.step("rule", L("خارج نطاق الخدمة", "Outside service area"), L2.city);
    ctx.say(`${intro ? intro + "\n" : ""}${L(`حاليًا خدماتنا متاحة في ${(R.served_cities || []).map(c => CITY_LABEL[c]?.[0] || c).join("، ")}. سجلت طلبكم وبيتواصل معكم فريق المبيعات إذا توسعنا لمدينتكم.`, `We currently serve ${(R.served_cities || []).map(c => CITY_LABEL[c]?.[1] || c).join(", ")}. I've logged your request and our team will reach out if we expand to your city.`)}`);
    ctx.tool("crm.upsert_lead", { id: lead.id, stage: "disqualified" });
    return ctx.task("qualify", ctx.T(`تأهيل — خارج النطاق`, `Qualification — out of area`), "done", "lead", lead.id);
  }
  if (upd.stage === "qualified" && st.flow === "slot" && st.slots?.length) {
    const s = st.slots;
    ctx.step("rule", L("بانتظار اختيار الموعد", "Waiting for slot choice"), L("تم تحديث البيانات، إعادة عرض نفس المواعيد", "details updated, same slots re-offered"));
    const got = Object.keys(upd).filter(k => !["score", "stage"].includes(k));
    ctx.say(L(`${got.length ? "سجلت التفاصيل ✅ " : ""}أي موعد يناسبكم؟\n1) ${fmtDateTime(s[0], "ar")}\n2) ${fmtDateTime(s[1], "ar")}`, `${got.length ? "Noted ✅ " : ""}Which time works for you?\n1) ${fmtDateTime(s[0], "en")}\n2) ${fmtDateTime(s[1], "en")}`));
    return ctx.task("qualify", ctx.T(`تحديث بيانات عميل — ${L2.company || L2.name}`, `Lead details updated — ${L2.company || L2.name}`), "done", "lead", lead.id);
  }
  if (upd.stage === "qualified") {
    const s = slots(ctx.now, 2);
    ctx.step("rule", L("مؤهل → عرض موعد", "Qualified → offer meeting"), `${score} ≥ ${R.qualify_threshold || 60}`);
    ctx.patchState({ lead_id: lead.id, flow: "slot", slots: s.map(stamp) });
    ctx.say(`${intro ? intro + "\n\n" : ""}${L(`ممتاز، الصورة واضحة 👍 أقترح اجتماع قصير (20 دقيقة) مع مدير الحسابات نجهز لكم عرض مخصص:\n1) ${fmtDateTime(stamp(s[0]), "ar")}\n2) ${fmtDateTime(stamp(s[1]), "ar")}\nاختر رقم الموعد المناسب.`, `Great, that's clear 👍 I suggest a short 20-minute call with our account manager to prepare a tailored proposal:\n1) ${fmtDateTime(stamp(s[0]), "en")}\n2) ${fmtDateTime(stamp(s[1]), "en")}\nReply 1 or 2.`)}`);
    return ctx.task("qualify", ctx.T(`تأهيل عميل — ${L2.company || L2.name} (${score})`, `Lead qualified — ${L2.company || L2.name} (${score})`), "done", "lead", lead.id);
  }
  // ask the next missing detail
  const ask = !L2.need ? L("وش الخدمة اللي تحتاجونها بالضبط؟", "Which service are you looking for exactly?")
    : !L2.size ? L("كم حجم الموقع تقريبًا؟ (عدد الأدوار/المباني أو المساحة أو عدد الموظفين)", "Roughly how big is the site? (floors/buildings, area, or headcount)")
    : !L2.city ? L("في أي مدينة الموقع؟", "Which city is the site in?")
    : tlDays == null ? L("ومتى تبغون تبدأ الخدمة؟", "And when would you like the service to start?")
    : !L2.company ? L("وما اسم الشركة؟", "And the company name?") : L("تحب نحجز اجتماع قصير مع مدير الحسابات؟", "Shall we book a short call with our account manager?");
  ctx.step("plan", L("السؤال التالي", "Next question"), ask);
  ctx.say(`${intro ? intro + "\n" : ""}${ask}`);
  ctx.task("inquiry", ctx.T(`رد على استفسار — ${L2.company || L2.name}`, `Inquiry reply — ${L2.company || L2.name}`), "done", "lead", lead.id);
}

export function salesFollowups(ctx, { send }) {
  const L = ctx.L; const days = ctx.rules.followup_after_days || 2;
  const cutoff = new Date(ctx.now); cutoff.setDate(cutoff.getDate() - days);
  const rows = ctx.dbx.all(`SELECT l.* FROM leads l WHERE l.tenant_id=? AND l.stage IN ('new','qualifying') AND l.phone IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM conversations c JOIN messages m ON m.conversation_id=c.id WHERE c.tenant_id=l.tenant_id AND c.contact_phone=l.phone AND m.at > ?)`, [ctx.tenant.id, iso(cutoff) + " 23:59:59"]);
  const log = [];
  for (const l of rows) {
    send({ contact_type: "lead", contact_id: l.id, contact_name: l.name, contact_phone: l.phone, body: L(`مرحبًا ${l.name.split(" ")[0]} 👋 حبيت أتابع معك بخصوص ${l.need ? "طلب " + l.need : "استفسارك"}. هل تحب نرسل لك عرضًا مبدئيًا أو نحجز مكالمة قصيرة؟`, `Hi ${l.name.split(" ")[0]} 👋 Just following up on ${l.need ? "your " + l.need.toLowerCase() + " request" : "your inquiry"}. Would you like a preliminary proposal or a short call?`), step: `no reply ${days}+ days` });
    ctx.taskFor("followup", ctx.T(`متابعة — ${l.company || l.name}`, `Follow-up — ${l.company || l.name}`), "done", "lead", l.id);
    log.push(`#${l.id} ${l.company || l.name}: ${L("رسالة متابعة", "follow-up sent")}`);
  }
  return log;
}
