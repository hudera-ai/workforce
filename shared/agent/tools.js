// Tool registry: the only way an AI employee touches company data. Every call is permission-checked
// against the agent's enabled tools and recorded in the trace, so a human can see exactly what it did.
import { iso, workingDays } from "./nlu.js";

const today = now => iso(now || new Date());
const fmt = n => Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 2 });
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

export const TOOL_CATALOG = {
  // HR
  "hr.find_employee":       { role: "hr", label: "Look up employee record", label_ar: "قراءة ملف الموظف", risk: "read" },
  "hr.leave_balance":       { role: "hr", label: "Read leave balance", label_ar: "قراءة رصيد الإجازات", risk: "read" },
  "hr.create_leave_request":{ role: "hr", label: "Create leave request", label_ar: "إنشاء طلب إجازة", risk: "write" },
  "hr.leave_status":        { role: "hr", label: "Read leave requests", label_ar: "قراءة طلبات الإجازة", risk: "read" },
  "hr.draft_letter":        { role: "hr", label: "Draft HR letters", label_ar: "صياغة الخطابات", risk: "write" },
  "hr.search_policy":       { role: "hr", label: "Search HR policies", label_ar: "البحث في السياسات", risk: "read" },
  "hr.screen_cv":           { role: "hr", label: "Screen CVs against a job", label_ar: "فرز السير الذاتية", risk: "write" },
  "hr.schedule_interview":  { role: "hr", label: "Schedule interviews", label_ar: "جدولة المقابلات", risk: "write" },
  "hr.id_expiry_scan":      { role: "hr", label: "Watch ID / iqama expiries", label_ar: "متابعة انتهاء الإقامات", risk: "read" },
  // Collections
  "fin.customer_balance":   { role: "collections", label: "Read customer balance", label_ar: "قراءة رصيد العميل", risk: "read" },
  "fin.record_promise":     { role: "collections", label: "Record promise to pay", label_ar: "تسجيل وعد بالسداد", risk: "write" },
  "fin.payment_claim":      { role: "collections", label: "Register payment claims", label_ar: "تسجيل إشعار سداد", risk: "write" },
  "fin.send_reminder":      { role: "collections", label: "Send payment reminders", label_ar: "إرسال تذكيرات السداد", risk: "send" },
  "fin.open_dispute":       { role: "collections", label: "Open invoice disputes", label_ar: "فتح اعتراض على فاتورة", risk: "write" },
  "fin.send_invoice_copy":  { role: "collections", label: "Send invoice copies", label_ar: "إرسال نسخة الفاتورة", risk: "send" },
  // Sales
  "crm.upsert_lead":        { role: "sales", label: "Create / update leads", label_ar: "إنشاء وتحديث العملاء المحتملين", risk: "write" },
  "crm.match_service":      { role: "sales", label: "Match services & prices", label_ar: "مطابقة الخدمات والأسعار", risk: "read" },
  "crm.book_meeting":       { role: "sales", label: "Book meetings", label_ar: "حجز الاجتماعات", risk: "write" },
  // Common
  "common.handoff":         { role: "*", label: "Hand over to a human", label_ar: "التحويل لموظف بشري", risk: "send" },
};

export const ROLE_TEMPLATES = {
  hr: { name: "HR Officer", name_ar: "موظف موارد بشرية", minutes: { leave_balance: 4, leave_request: 12, leave_status: 4, letter: 20, policy: 6, payday: 3, id_expiry: 5, cv_screen: 15, interview: 10, handoff: 2, greeting: 1 },
    tools: ["hr.find_employee", "hr.leave_balance", "hr.create_leave_request", "hr.leave_status", "hr.draft_letter", "hr.search_policy", "hr.screen_cv", "hr.schedule_interview", "hr.id_expiry_scan", "common.handoff"],
    rules: { auto_approve_max_days: 1, min_notice_days: 2, letters_require_approval: true, shortlist_threshold: 70, payday: 27, id_expiry_warn_days: 60 },
    description: "Answers employees 24/7 on WhatsApp: leave balance and requests, HR letters, policy and payroll questions, iqama expiries, and first-round CV screening.",
    description_ar: "يرد على الموظفين ٢٤ ساعة على واتساب: رصيد الإجازات وطلبها، الخطابات، أسئلة السياسات والرواتب، انتهاء الإقامات، والفرز الأولي للسير الذاتية." },
  collections: { name: "Collections Officer", name_ar: "موظف تحصيل", minutes: { balance: 6, promise: 8, paid: 10, dispute: 8, invoice_copy: 5, reminder: 6, handoff: 2, greeting: 1 },
    tools: ["fin.customer_balance", "fin.record_promise", "fin.payment_claim", "fin.send_reminder", "fin.open_dispute", "fin.send_invoice_copy", "common.handoff"],
    rules: { reminder_days: [1, 7, 15], min_days_between: 3, max_promise_days: 14, escalate_after_days: 15 },
    description: "Follows up overdue invoices on a polite cadence, records promises to pay and payment claims, opens disputes, and escalates to finance only when needed.",
    description_ar: "يتابع الفواتير المتأخرة بتسلسل مهذب، يسجل وعود السداد وإشعارات التحويل، يفتح الاعتراضات، ويصعّد للمالية عند الحاجة فقط." },
  sales: { name: "Sales Development Rep", name_ar: "موظف مبيعات", minutes: { inquiry: 10, qualify: 12, meeting: 10, followup: 5, handoff: 2, greeting: 1 },
    tools: ["crm.upsert_lead", "crm.match_service", "crm.book_meeting", "common.handoff"],
    rules: { qualify_threshold: 60, followup_after_days: 2, served_cities: ["riyadh", "jeddah", "dammam", "khobar", "makkah", "madinah"] },
    description: "Replies to new inquiries in seconds, explains services and starting prices, qualifies the lead, and books a meeting in the sales team's calendar.",
    description_ar: "يرد على الاستفسارات الجديدة خلال ثوانٍ، يشرح الخدمات والأسعار المبدئية، يقيّم العميل المحتمل، ويحجز اجتماعًا في تقويم فريق المبيعات." },
};

// ------------------------------------------------------------------ implementations
export const TOOLS = {
  "hr.find_employee": (dbx, ctx, { phone, emp_no }) => dbx.get(`SELECT e.*, u.name AS manager_name FROM employees e LEFT JOIN users u ON u.id=e.manager_user_id WHERE e.tenant_id=? AND (e.phone=? OR e.emp_no=?)`, [ctx.tenant.id, phone || "", emp_no || ""]),
  "hr.leave_balance": (dbx, ctx, { employee_id }) => {
    const e = dbx.get("SELECT annual_leave_balance, sick_days_used FROM employees WHERE id=?", [employee_id]);
    const pend = dbx.get("SELECT COALESCE(SUM(days),0) AS d FROM leave_requests WHERE employee_id=? AND status='pending' AND type='annual'", [employee_id]).d;
    const taken = dbx.get("SELECT COALESCE(SUM(days),0) AS d FROM leave_requests WHERE employee_id=? AND status='approved' AND type='annual' AND substr(from_date,1,4)=?", [employee_id, today(ctx.now).slice(0, 4)]).d;
    return { balance: e.annual_leave_balance, pending: pend, available: e.annual_leave_balance - pend, taken_this_year: taken, sick_days_used: e.sick_days_used };
  },
  "hr.leave_status": (dbx, ctx, { employee_id }) => dbx.all("SELECT * FROM leave_requests WHERE employee_id=? ORDER BY id DESC LIMIT 3", [employee_id]),
  "hr.create_leave_request": (dbx, ctx, { employee_id, type, from_date, to_date, days, reason, status = "pending" }) => {
    const id = dbx.run("INSERT INTO leave_requests (tenant_id,employee_id,type,from_date,to_date,days,reason,status,source,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)", [ctx.tenant.id, employee_id, type, from_date, to_date, days, reason || null, status, "agent", ctx.nowStr]).lastId;
    if (status === "approved" && type === "annual") dbx.run("UPDATE employees SET annual_leave_balance=annual_leave_balance-? WHERE id=?", [days, employee_id]);
    return { id };
  },
  "hr.draft_letter": (dbx, ctx, { employee, type, addressed_to, lang }) => {
    const body = letterBody(ctx.tenant, employee, type, addressed_to, lang, ctx.now);
    const id = dbx.run("INSERT INTO letters (tenant_id,employee_id,type,addressed_to,lang,status,body,created_at) VALUES (?,?,?,?,?,?,?,?)", [ctx.tenant.id, employee.id, type, addressed_to || null, lang, "pending", body, ctx.nowStr]).lastId;
    return { id, body };
  },
  "hr.search_policy": (dbx, ctx, { query, lang }) => ctx.kbSearch(query, lang),
  "hr.screen_cv": (dbx, ctx, { job, cv_text, name, phone, screen }) => {
    const r = screen(cv_text, JSON.parse(job.requirements));
    const id = dbx.run("INSERT INTO candidates (tenant_id,job_id,name,phone,cv_text,score,breakdown,status,created_at) VALUES (?,?,?,?,?,?,?,?,?)", [ctx.tenant.id, job.id, name, phone, cv_text, r.score, JSON.stringify(r.breakdown), r.score >= (ctx.rules.shortlist_threshold || 70) ? "shortlisted" : "new", ctx.nowStr]).lastId;
    return { id, ...r };
  },
  "hr.schedule_interview": (dbx, ctx, { candidate_id, at }) => { dbx.run("UPDATE candidates SET status='interview', interview_at=? WHERE id=?", [at, candidate_id]); return { ok: true }; },
  "hr.id_expiry_scan": (dbx, ctx, { days = 60 }) => dbx.all("SELECT * FROM employees WHERE tenant_id=? AND status='active' AND id_expiry IS NOT NULL AND id_expiry <= ? ORDER BY id_expiry", [ctx.tenant.id, iso(addDays(ctx.now, days))]),

  "fin.customer_balance": (dbx, ctx, { customer_id }) => {
    const inv = dbx.all("SELECT * FROM invoices WHERE customer_id=? AND status<>'paid' ORDER BY due_date", [customer_id]);
    const t = today(ctx.now);
    const rows = inv.map(i => ({ ...i, due: i.amount - i.paid_amount, days_overdue: Math.max(0, Math.round((new Date(t) - new Date(i.due_date)) / 864e5)) }));
    return { invoices: rows, total: rows.reduce((a, b) => a + b.due, 0), overdue: rows.filter(r => r.days_overdue > 0).reduce((a, b) => a + b.due, 0) };
  },
  "fin.record_promise": (dbx, ctx, { invoice_ids, date }) => { for (const id of invoice_ids) dbx.run("UPDATE invoices SET promise_date=? WHERE id=?", [date, id]); return { ok: true, count: invoice_ids.length }; },
  "fin.payment_claim": (dbx, ctx, { invoice_ids, ref, amount }) => ({ ok: true, invoice_ids, ref, amount }),
  "fin.send_reminder": (dbx, ctx, { invoice_id }) => { dbx.run("UPDATE invoices SET reminders_count=reminders_count+1, last_reminder_at=? WHERE id=?", [ctx.nowStr, invoice_id]); return { ok: true }; },
  "fin.open_dispute": (dbx, ctx, { invoice_id }) => { dbx.run("UPDATE invoices SET status='disputed' WHERE id=?", [invoice_id]); return { ok: true }; },
  "fin.send_invoice_copy": (dbx, ctx, { invoice }) => ({ ok: true, to: invoice.email }),

  "crm.upsert_lead": (dbx, ctx, { id, ...f }) => {
    const cols = ["name", "company", "phone", "email", "source", "need", "size", "budget", "timeline", "city", "score", "stage", "meeting_at"].filter(k => k in f && f[k] !== undefined);
    if (id) { if (cols.length) dbx.run(`UPDATE leads SET ${cols.map(c => `${c}=?`).join(",")} WHERE id=?`, [...cols.map(c => f[c]), id]); return { id }; }
    return { id: dbx.run(`INSERT INTO leads (tenant_id,${cols.join(",")},created_at) VALUES (?,${cols.map(() => "?").join(",")},?)`, [ctx.tenant.id, ...cols.map(c => f[c]), ctx.nowStr]).lastId };
  },
  "crm.match_service": (dbx, ctx, { text, normalize }) => {
    const t = normalize(text);
    const svcs = dbx.all("SELECT * FROM services_catalog WHERE tenant_id=?", [ctx.tenant.id]);
    const scored = svcs.map(s => ({ ...s, hits: s.keywords.split(",").map(k => normalize(k.trim())).filter(k => k && t.includes(k)).length })).filter(s => s.hits).sort((a, b) => b.hits - a.hits);
    return scored.slice(0, 2);
  },
  "crm.book_meeting": (dbx, ctx, { lead_id, at }) => { dbx.run("UPDATE leads SET stage='meeting', meeting_at=? WHERE id=?", [at, lead_id]); return { ok: true }; },
  "common.handoff": (dbx, ctx, { reason }) => { dbx.run("UPDATE conversations SET status='waiting_human' WHERE id=?", [ctx.conv.id]); return { ok: true, reason }; },
};

// ------------------------------------------------------------------ helpers
export function letterBody(tenant, e, type, to, lang, now) {
  const d = iso(now || new Date());
  const total = (e.basic_salary || 0) + (e.housing_allowance || 0) + (e.transport_allowance || 0);
  if (lang === "ar") {
    const head = `${tenant.name_ar}\nالتاريخ: ${d}\n\nإلى: ${to || "من يهمه الأمر"}\n\n`;
    const intro = `تشهد ${tenant.name_ar} بأن السيد/ة ${e.name_ar}، رقم وظيفي ${e.emp_no}، الجنسية: ${e.nationality || "—"}، يعمل لدينا بوظيفة ${e.title || "—"} في إدارة ${e.department || "—"} منذ ${e.hire_date || "—"} ولا يزال على رأس العمل.`;
    const pay = type === "salary_certificate" ? `\n\nويتقاضى راتبًا شهريًا إجماليًا قدره ${fmt(total)} ريال سعودي، مفصلًا كالتالي: الراتب الأساسي ${fmt(e.basic_salary)} ريال، بدل السكن ${fmt(e.housing_allowance)} ريال، بدل النقل ${fmt(e.transport_allowance)} ريال.` : "";
    const exp = type === "experience_letter" ? `\n\nوقد أبدى خلال فترة عمله التزامًا وكفاءة عالية.` : "";
    const noc = type === "noc" ? `\n\nولا مانع لدى الشركة من ${to ? "تقديم الطلب لدى " + to : "إتمام الإجراء المطلوب"} دون أدنى مسؤولية على الشركة.` : "";
    return `${head}${intro}${pay}${exp}${noc}\n\nوقد أُعطي هذا الخطاب بناءً على طلبه دون أدنى مسؤولية على الشركة.\n\nإدارة الموارد البشرية`;
  }
  const head = `${tenant.name_en}\nDate: ${d}\n\nTo: ${to || "Whom It May Concern"}\n\n`;
  const intro = `This is to certify that ${e.name_en}, employee no. ${e.emp_no}, ${e.nationality || ""} national, has been employed with ${tenant.name_en} as ${e.title || "—"} in the ${e.department || "—"} department since ${e.hire_date || "—"} and is currently in service.`;
  const pay = type === "salary_certificate" ? `\n\nThe employee receives a gross monthly salary of SAR ${fmt(total)}: basic SAR ${fmt(e.basic_salary)}, housing allowance SAR ${fmt(e.housing_allowance)}, transport allowance SAR ${fmt(e.transport_allowance)}.` : "";
  const noc = type === "noc" ? `\n\nThe company has no objection to ${to ? "the employee's application with " + to : "the requested procedure"}.` : "";
  return `${head}${intro}${pay}${noc}\n\nThis letter is issued at the employee's request without any liability on the company.\n\nHuman Resources Department`;
}

// next payday: the configured day of month; if it falls on the weekend, move back to the last working day
export function nextPayday(now, day = 27, weekend = [5, 6]) {
  const base = new Date(now); base.setHours(0, 0, 0, 0);
  let d = new Date(base.getFullYear(), base.getMonth(), day);
  const adjust = x => { while (weekend.includes(x.getDay())) x.setDate(x.getDate() - 1); return x; };
  adjust(d);
  if (d < base) { d = new Date(base.getFullYear(), base.getMonth() + 1, day); adjust(d); }
  return d;
}

// next N meeting slots on working days (10:00 and 13:00), at least `after` hours from now
export function slots(now, n = 2, weekend = [5, 6]) {
  const out = []; let d = new Date(now); d.setMinutes(0, 0, 0);
  for (let i = 0; i < 14 && out.length < n; i++) {
    const day = addDays(new Date(now), i + 1); if (weekend.includes(day.getDay())) continue;
    for (const h of [10, 13]) { if (out.length >= n) break; const s = new Date(day); s.setHours(h, 0, 0, 0); out.push(s); }
  }
  return out;
}
export const stamp = d => `${iso(d)} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:00`;
export { workingDays };
