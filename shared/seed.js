// Sample platform data: three fictional tenant companies, their AI employees, company data and
// real conversations produced by running the agent runtime itself. Deterministic (seeded PRNG).
// All companies, people, phone numbers and figures are invented for demonstration.
import { ROLE_TEMPLATES, stamp } from "./agent/tools.js";
import { handleInbound, runJob, applyDecision } from "./agent/runtime.js";
import { iso } from "./agent/nlu.js";

export const DEMO_PASSWORD = "demo1234";
export const DEMO_HASH = "pbkdf2$100000$736974656c6f672d64656d6f2d73616c74$c1518516014ed00eeb9fbc27d1c19b37b424ccc30559442d91dd95fbc6a52a89";
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const at = (d, h, m = 0) => { const x = new Date(d); x.setHours(h, m, 0, 0); return x; };
const MON_AR = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
const MON_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const nextWorkday = (d, n) => { let x = new Date(d), k = 0; while (k < n) { x = addDays(x, 1); if (![5, 6].includes(x.getDay())) k++; } return x; };

export const PLANS = [
  ["starter", "Starter", 1490, 1000, 1.2, 2],
  ["growth", "Growth", 3900, 4000, 0.9, 5],
  ["scale", "Scale", 9500, 15000, 0.6, 15],
];

const HR_POLICY_AR = `ساعات العمل
الدوام الرسمي من الأحد إلى الخميس من 8:00 صباحًا حتى 5:00 مساءً مع ساعة استراحة. في شهر رمضان يكون الدوام 6 ساعات من 9:00 صباحًا حتى 3:00 عصرًا للموظفين المسلمين. فرق الموقع (النظافة والأمن والصيانة) تعمل بنظام الورديات حسب جدول المشروع.

الحضور والتأخير
يُسمح بتأخير حتى 15 دقيقة. التأخير المتكرر (3 مرات في الشهر) يترتب عليه إنذار كتابي، ويُخصم وقت التأخير الزائد من الراتب. البصمة إلزامية عند الحضور والانصراف.

الإجازة السنوية
يستحق الموظف 21 يوم إجازة سنوية مدفوعة، تصبح 30 يومًا بعد إكمال 5 سنوات خدمة. يُقدَّم الطلب قبل يومي عمل على الأقل. الإجازة ليوم واحد بإشعار مسبق تُعتمد تلقائيًا، وما زاد يحتاج موافقة المدير المباشر.

الإجازة المرضية
وفق نظام العمل: أول 30 يومًا في السنة براتب كامل، والـ60 يومًا التالية بثلاثة أرباع الراتب، والـ30 يومًا التالية بدون راتب. يجب إرفاق تقرير طبي معتمد لأي إجازة مرضية تزيد عن يوم واحد.

الإجازات الأخرى
إجازة الزواج 5 أيام، إجازة الوفاة 5 أيام لوفاة الزوج أو أحد الأصول أو الفروع، إجازة المولود 3 أيام للأب، وإجازة الحج من 10 إلى 15 يومًا مرة واحدة خلال الخدمة لمن أمضى سنتين.

العمل الإضافي
العمل الإضافي يجب أن يكون بموافقة مسبقة من المدير، ويُحتسب بأجر الساعة الأساسي مضافًا إليه 50% (أي 150%).

الرواتب
تُصرف الرواتب يوم 27 من كل شهر ميلادي، وإذا وافق عطلة نهاية الأسبوع تُصرف في آخر يوم عمل قبله. تُرسل قسيمة الراتب على البريد الإلكتروني.

البدلات
بدل السكن 25% من الراتب الأساسي، وبدل النقل 10% من الراتب الأساسي، وتُصرف شهريًا مع الراتب.

التأمين الطبي
جميع الموظفين مشمولون بالتأمين الطبي فئة B، ويشمل الزوجة والأبناء للدرجة الوظيفية 8 فما فوق.

فترة التجربة والاستقالة
فترة التجربة 90 يومًا. مدة الإشعار عند الاستقالة 60 يومًا بعد التثبيت. مكافأة نهاية الخدمة حسب نظام العمل السعودي.

العمل عن بعد
يُسمح لموظفي المكاتب بالعمل عن بعد حتى يومين في الشهر بموافقة المدير، ولا ينطبق على فرق الموقع.

السلفة
يحق للموظف بعد التثبيت سلفة مرة واحدة في السنة لا تتجاوز راتبًا أساسيًا واحدًا، تُسدد على 6 أشهر.`;

const HR_POLICY_EN = `Working hours
Office hours are Sunday to Thursday, 8:00 am to 5:00 pm with a one-hour break. During Ramadan, working hours are 6 hours, 9:00 am to 3:00 pm, for Muslim employees. Site teams (cleaning, security, maintenance) work shifts according to the project roster.

Attendance and lateness
A grace period of 15 minutes applies. Repeated lateness (3 times in a month) leads to a written warning, and late time beyond the grace period is deducted. Fingerprint check-in and check-out are mandatory.

Annual leave
Employees are entitled to 21 days of paid annual leave, increasing to 30 days after 5 years of service. Requests must be submitted at least 2 working days in advance. One-day leave with advance notice is approved automatically; longer leave needs the line manager's approval.

Sick leave
Per the Labor Law: the first 30 days in a year at full pay, the next 60 days at three-quarters pay, and the following 30 days unpaid. A certified medical report is required for any sick leave longer than one day.

Other leave
Marriage leave 5 days, bereavement leave 5 days for a spouse, parent or child, paternity leave 3 days, and Hajj leave of 10 to 15 days once during service after two years.

Overtime
Overtime must be pre-approved by the manager and is paid at the basic hourly rate plus 50% (150%).

Payroll
Salaries are paid on the 27th of each month; if that falls on a weekend, on the last working day before it. Payslips are sent by e-mail.

Allowances
Housing allowance is 25% of basic salary and transport allowance 10% of basic salary, paid monthly with the salary.

Medical insurance
All employees are covered by class B medical insurance; spouse and children are covered for grade 8 and above.

Probation and resignation
Probation is 90 days. The notice period for resignation is 60 days after confirmation. End-of-service benefits follow the Saudi Labor Law.

Remote work
Office staff may work remotely up to 2 days per month with manager approval. This does not apply to site teams.

Salary advance
After confirmation, employees may request one salary advance per year of up to one month's basic salary, repaid over 6 months.`;

const COLL_POLICY = `Payment terms
Standard terms are 30 days from the invoice date. Reminders are sent on day 1 (friendly), day 7 (firm) and from day 15 the case is escalated to the finance manager before any formal notice. Promises to pay up to 14 days are accepted automatically; longer extensions need finance manager approval. Disputed invoices are excluded from reminders until resolved.`;

const T1 = {
  slug: "rawabi", name_ar: "شركة روابي لإدارة المرافق", name_en: "Rawabi Facilities Management Co.", industry: "Facility management", city: "Riyadh", plan: "growth", employees_count: 420,
  users: [
    ["Abdulrahman Al-Shammari", "owner@rawabi.example", "owner"], ["Hessa Al-Otaibi", "hr@rawabi.example", "hr_manager"], ["Waleed Kamal", "finance@rawabi.example", "finance_manager"], ["Majed Al-Harthi", "sales@rawabi.example", "sales_manager"],
    ["Eng. Khalid Mansour", "khalid@rawabi.example", "viewer"], ["Ahmed Fathi", "ahmed.f@rawabi.example", "viewer"],
  ],
  agents: [
    { role: "hr", name: "Noura", name_ar: "نورة", color: "#7C5CFF", supervisor: "hr@rawabi.example" },
    { role: "collections", name: "Fahd", name_ar: "فهد", color: "#0FA97A", supervisor: "finance@rawabi.example" },
    { role: "sales", name: "Sami", name_ar: "سامي", color: "#F2A33A", supervisor: "sales@rawabi.example" },
  ],
  services: [
    ["عقود النظافة الشاملة", "Integrated cleaning contracts", "نظافه,تنظيف,cleaning,عمال نظافه,janitorial,housekeeping", 9500],
    ["صيانة التكييف والكهرباء والسباكة (MEP)", "MEP maintenance (HVAC, electrical, plumbing)", "صيانه,تكييف,كهرباء,سباكه,mep,hvac,maintenance,chiller", 14000],
    ["خدمات الحراسة الأمنية", "Security guarding services", "حراسه,امن,حارس,حراس,security,guards,guard", 6800],
    ["مكافحة الحشرات", "Pest control", "حشرات,مكافحه,pest,rodent,قوارض", 1200],
    ["إدارة المرافق المتكاملة", "Integrated facility management", "اداره مرافق,اداره المرافق,facility management,fm,integrated", 35000],
    ["تنسيق الحدائق", "Landscaping", "حدائق,تنسيق,زراعه,landscaping,garden", 3500],
  ],
  jobs: [
    ["HR Officer (payroll & GOSI)", "HR & Admin", { must: ["payroll", "gosi", "saudi labor law", "excel"], nice: ["qiwa", "mudad", "english"], min_years: 3 }],
    ["HVAC Technician", "Maintenance", { must: ["hvac", "electrical"], nice: ["bms", "cafm", "driving license"], min_years: 4 }],
  ],
};
const T2 = {
  slug: "masar", name_ar: "مسار للخدمات اللوجستية", name_en: "Masar Logistics", industry: "Logistics", city: "Dammam", plan: "starter", employees_count: 160,
  users: [["Yousef Al-Dossari", "owner@masar.example", "owner"], ["Dalal Al-Mutairi", "hr@masar.example", "hr_manager"], ["Rakan Al-Subaie", "sales@masar.example", "sales_manager"]],
  agents: [{ role: "hr", name: "Reem", name_ar: "ريم", color: "#0B83C5", supervisor: "hr@masar.example" }, { role: "sales", name: "Ali", name_ar: "علي", color: "#D9363E", supervisor: "sales@masar.example" }],
  services: [
    ["الشحن البري بين المدن", "Inter-city road freight", "شحن,نقل,شاحنه,شاحنات,freight,trucking,trucks,shipping", 4500],
    ["التخزين وإدارة المستودعات", "Warehousing & fulfilment", "تخزين,مستودع,مستودعات,warehouse,warehousing,storage,fulfilment,fulfillment,pallets", 8000],
    ["التوصيل للميل الأخير", "Last-mile delivery", "توصيل,ميل اخير,delivery,last mile,last-mile,courier", 3000],
  ],
  jobs: [["Warehouse Supervisor", "Operations", { must: ["wms", "forklift", "excel"], nice: ["sap", "english"], min_years: 3 }]],
};
const T3 = { slug: "bunyan", name_ar: "مجموعة البنيان للمقاولات", name_en: "Al-Bunyan Contracting Group", industry: "Construction", city: "Jeddah", plan: "scale", employees_count: 1850,
  users: [["Faisal Al-Ghamdi", "owner@bunyan.example", "owner"], ["Lama Al-Zahrani", "hr@bunyan.example", "hr_manager"]],
  agents: [{ role: "hr", name: "Salem", name_ar: "سالم", color: "#3D5AFE", supervisor: "hr@bunyan.example" }], services: [], jobs: [] };

const FIRST = [["أحمد", "Ahmed"], ["محمد", "Mohammed"], ["خالد", "Khalid"], ["فهد", "Fahad"], ["سعد", "Saad"], ["عمر", "Omar"], ["يوسف", "Yousef"], ["عبدالله", "Abdullah"], ["ناصر", "Nasser"], ["ماجد", "Majed"], ["حسن", "Hassan"], ["علي", "Ali"], ["بلال", "Bilal"], ["رامي", "Rami"], ["طارق", "Tarek"], ["كريم", "Karim"], ["عمران", "Imran"], ["راجيش", "Rajesh"], ["جوزيف", "Joseph"], ["نورة", "Noura"], ["سارة", "Sara"], ["ريم", "Reem"], ["لمى", "Lama"], ["هند", "Hind"], ["مها", "Maha"], ["بريا", "Priya"], ["أمل", "Amal"]];
const LAST = [["الحربي", "Al-Harbi"], ["العتيبي", "Al-Otaibi"], ["القحطاني", "Al-Qahtani"], ["الشهري", "Al-Shehri"], ["حسن", "Hassan"], ["محمود", "Mahmoud"], ["خان", "Khan"], ["صديقي", "Siddiqui"], ["العمري", "Al-Amri"], ["صالح", "Saleh"], ["عبده", "Abdo"], ["رحمن", "Rahman"], ["نير", "Nair"], ["فرنانديز", "Fernandes"]];
const DEPTS = [["Operations", "Site Supervisor"], ["Cleaning Services", "Cleaning Team Leader"], ["Maintenance", "HVAC Technician"], ["Maintenance", "Electrician"], ["Security", "Security Guard"], ["HR & Admin", "Admin Officer"], ["Finance", "Accountant"], ["Sales", "Account Manager"], ["Operations", "Operations Coordinator"]];
const NAT = ["Saudi", "Saudi", "Saudi", "Egyptian", "Indian", "Pakistani", "Filipino", "Sudanese", "Bangladeshi"];

export function applySeed(dbx, { today = new Date() } = {}) {
  const now = new Date(today); const T0 = at(now, 0);
  const rand = rng(20261020); const pick = a => a[Math.floor(rand() * a.length)]; const between = (a, b) => a + Math.floor(rand() * (b - a + 1));
  const run = (sql, p) => dbx.run(sql, p);
  dbx.tx(() => {
    for (const t of ["audit_log", "automation_runs", "automations", "approvals", "tasks", "messages", "conversations", "services_catalog", "leads", "invoices", "customers", "candidates", "jobs", "letters", "leave_requests", "employees", "knowledge_docs", "agents", "api_keys", "users", "tenants", "plans"]) run(`DELETE FROM ${t}`);
    run("DELETE FROM sqlite_sequence");
    const planId = {}; for (const [code, name, price, inc, over, max] of PLANS) planId[code] = run("INSERT INTO plans (code,name,price_month,included_tasks,overage_per_task,max_agents) VALUES (?,?,?,?,?,?)", [code, name, price, inc, over, max]).lastId;
    run("INSERT INTO users (tenant_id,name,email,role,password_hash) VALUES (NULL,?,?,?,?)", ["HUDERA Platform Ops", "platform@hudera.example", "platform", DEMO_HASH]);
    let phoneSeq = 100;
    for (const [ti, T] of [T1, T2, T3].entries()) {
      const tid = run("INSERT INTO tenants (slug,name_ar,name_en,industry,city,plan_id,employees_count,created_at) VALUES (?,?,?,?,?,?,?,?)", [T.slug, T.name_ar, T.name_en, T.industry, T.city, planId[T.plan], T.employees_count, stamp(addDays(now, -[210, 95, 40][ti]))]).lastId;
      const uid = {}; for (const [name, email, role] of T.users) uid[email] = run("INSERT INTO users (tenant_id,name,email,phone,role,password_hash) VALUES (?,?,?,?,?,?)", [tid, name, email, `+9665XX90${tid}${String(Object.keys(uid).length).padStart(2, "0")}`, role, DEMO_HASH]).lastId;
      const aid = {};
      for (const a of T.agents) { const tpl = ROLE_TEMPLATES[a.role]; aid[a.role] = run("INSERT INTO agents (tenant_id,name,name_ar,role,color,status,channels,tools,rules,tone,supervisor_user_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", [tid, a.name, a.name_ar, a.role, a.color, "active", JSON.stringify(a.role === "sales" ? ["whatsapp", "web_chat", "email"] : ["whatsapp", "email"]), JSON.stringify(tpl.tools), JSON.stringify(tpl.rules), "friendly", uid[a.supervisor], stamp(addDays(now, -[200, 90, 35][ti]))]).lastId; }
      // knowledge
      run("INSERT INTO knowledge_docs (tenant_id,agent_role,lang,title,body) VALUES (?,?,?,?,?)", [tid, "hr", "ar", "لائحة الموارد البشرية", HR_POLICY_AR]);
      run("INSERT INTO knowledge_docs (tenant_id,agent_role,lang,title,body) VALUES (?,?,?,?,?)", [tid, "hr", "en", "HR Policy Handbook", HR_POLICY_EN]);
      if (aid.collections) run("INSERT INTO knowledge_docs (tenant_id,agent_role,lang,title,body) VALUES (?,?,?,?,?)", [tid, "collections", "en", "Credit & collections policy", COLL_POLICY]);
      for (const [ar, en, kw, price] of T.services) run("INSERT INTO services_catalog (tenant_id,name_ar,name_en,keywords,price_from) VALUES (?,?,?,?,?)", [tid, ar, en, kw, price]);
      for (const [title, dept, req] of T.jobs) run("INSERT INTO jobs (tenant_id,title,department,requirements) VALUES (?,?,?,?)", [tid, title, dept, JSON.stringify(req)]);
      // employees
      const nEmp = [42, 24, 12][ti]; const managers = T.users.filter(u => ["viewer", "hr_manager", "owner"].includes(u[2])).map(u => uid[u[1]]);
      for (let i = 1; i <= nEmp; i++) {
        const f = pick(FIRST), l = pick(LAST), [dept, title] = pick(DEPTS), nat = pick(NAT);
        const basic = Math.round(between(dept === "Security" || dept === "Cleaning Services" ? 2500 : 4500, dept === "Finance" || dept === "Sales" || dept === "HR & Admin" ? 11000 : 8000) / 100) * 100;
        const expiry = nat === "Saudi" ? null : iso(addDays(now, between(20, 700)));
        run("INSERT INTO employees (tenant_id,emp_no,name_ar,name_en,phone,email,department,title,manager_user_id,hire_date,basic_salary,housing_allowance,transport_allowance,annual_leave_balance,sick_days_used,nationality,id_expiry) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
          [tid, `${T.slug.slice(0, 2).toUpperCase()}-${String(i).padStart(3, "0")}`, `${f[0]} ${l[0]}`, `${f[1]} ${l[1]}`, `+9665XX${String(phoneSeq++).padStart(6, "0")}`, `${f[1].toLowerCase()}.${l[1].toLowerCase().replace(/[^a-z]/g, "")}${i}@${T.slug}.example`, dept, title, pick(managers), iso(addDays(now, -between(120, 2600))), basic, Math.round(basic * 0.25), Math.round(basic * 0.1), between(6, 30), between(0, 6), nat, expiry]);
      }
      if (ti === 2) continue; // tenant 3: synthetic history only (below)
      // customers & invoices (collections) — tenant 1
      if (aid.collections) {
        const CUST = [["Al-Faisaliah Medical Center", "Dr. Hatem", "medical"], ["Dar Al-Ufuq Investment", "Mr. Bandar", "real estate"], ["Riyadh Front Business Park", "Eng. Saeed", "real estate"], ["Najd International School", "Ms. Huda", "education"], ["Al-Waha Mall", "Mr. Rakan", "retail"], ["Gulf Pharma Warehouse", "Mr. Anwar", "industrial"], ["King's Road Tower", "Eng. Ziad", "real estate"], ["Al-Masif Residential Compound", "Mr. Turki", "residential"], ["Sahara Hotels", "Ms. Nadia", "hospitality"], ["Tamkeen Training Institute", "Mr. Ibrahim", "education"]];
        CUST.forEach(([name, contact, seg], i) => {
          const cid = run("INSERT INTO customers (tenant_id,name,contact_name,phone,email,segment) VALUES (?,?,?,?,?,?)", [tid, name, contact, `+9665XX70${String(i).padStart(4, "0")}`, `ap@${name.toLowerCase().replace(/[^a-z]+/g, "")}.example`, seg]).lastId;
          for (let k = 0; k < 4; k++) {
            const issue = addDays(now, -(15 + k * 30 + between(0, 12))); const due = addDays(issue, 30);
            const amt = Math.round(between(8, 60) * 1000 * 1.15);
            const overdueDays = Math.round((T0 - at(due, 0)) / 864e5);
            const paid = overdueDays < -0 ? false : k >= 2 ? true : rand() < (i < 3 ? 0.1 : 0.55);
            const id = run("INSERT INTO invoices (tenant_id,customer_id,invoice_no,amount,paid_amount,issue_date,due_date,status) VALUES (?,?,?,?,?,?,?,?)", [tid, cid, `INV-${iso(issue).slice(2, 4)}${iso(issue).slice(5, 7)}-${String(100 + i * 4 + k)}`, amt, paid ? amt : 0, iso(issue), iso(due), paid ? "paid" : "open"]).lastId;
            if (!paid && overdueDays > 0 && rand() < 0.25) run("UPDATE invoices SET promise_date=? WHERE id=?", [iso(addDays(now, between(2, 9))), id]);
          }
        });
      }
      // leads
      if (aid.sales) {
        const LEADS = ti === 0 ? [["Bandar Al-Rashid", "Dar Al-Ufuq Investment", "Integrated cleaning contracts", "6 floors", "riyadh", "30", 90, "qualified"], ["Mona Saleh", "Najd Clinics", "MEP maintenance (HVAC, electrical, plumbing)", "3 buildings", "riyadh", "45", 80, "meeting"], ["Ziad Hamdan", null, "Security guarding services", null, "jeddah", null, 50, "qualifying"], ["Kevin D'Souza", "Arabian Cold Stores", "Pest control", "1 warehouse", "dammam", "7", 90, "won"], ["Huda Nasser", "Al-Rawdah Schools", "Integrated cleaning contracts", "4 sites", "riyadh", "90", 70, "lost"], ["Sultan Al-Qahtani", null, null, null, null, null, 0, "new"]]
          : [["Omar Basha", "Eastern Foods", "Warehousing & fulfilment", "800 pallets", "dammam", "30", 90, "meeting"], ["Ruba Kassem", "Bloom Online", "Last-mile delivery", "1200 shipments", "riyadh", "14", 90, "qualified"], ["Hani Yaseen", null, "Inter-city road freight", null, null, null, 30, "qualifying"]];
        LEADS.forEach(([name, company, need, size, city, tl, score, stage], i) => run("INSERT INTO leads (tenant_id,name,company,phone,email,source,need,size,city,timeline,score,stage,meeting_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
          [tid, name, company, `+9665XX8${ti}${String(i).padStart(4, "0")}`, company ? `info@${company.toLowerCase().replace(/[^a-z]+/g, "")}.example` : null, pick(["whatsapp", "website", "instagram", "referral"]), need, size, city, tl, score, stage, stage === "meeting" ? stamp(at(nextWorkday(now, 2), 10)) : null, stamp(addDays(now, -between(1, 20)))]));
      }
    }

    // ---------------- synthetic history (last 65 days) so dashboards and billing have shape
    const KINDS = { hr: [["leave_balance", 30], ["leave_request", 18], ["policy", 22], ["letter", 9], ["payday", 10], ["id_expiry", 3], ["cv_screen", 6], ["greeting", 12], ["handoff", 3]], collections: [["reminder", 40], ["balance", 15], ["promise", 18], ["paid", 12], ["invoice_copy", 9], ["dispute", 3], ["handoff", 3]], sales: [["inquiry", 40], ["qualify", 25], ["meeting", 10], ["followup", 20], ["handoff", 5]] };
    const TITLES_EN = { leave_balance: "Leave balance", leave_request: "Leave request", policy: "Policy question", letter: "Salary certificate", payday: "Payday question", id_expiry: "Iqama renewal", cv_screen: "CV screened", greeting: "Greeting", handoff: "Handed over to a human", reminder: "Payment reminder", balance: "Statement", promise: "Promise to pay", paid: "Payment confirmation", invoice_copy: "Invoice copy", dispute: "Invoice dispute", inquiry: "Inquiry reply", qualify: "Lead qualified", meeting: "Meeting booked", followup: "Lead follow-up" };
    const TITLES_AR = { leave_balance: "رصيد إجازات", leave_request: "طلب إجازة", policy: "سؤال عن السياسات", letter: "تعريف بالراتب", payday: "سؤال عن موعد الراتب", id_expiry: "تجديد إقامة", cv_screen: "فرز سيرة ذاتية", greeting: "ترحيب", handoff: "تحويل لموظف بشري", reminder: "تذكير سداد", balance: "كشف حساب", promise: "وعد بالسداد", paid: "تأكيد سداد", invoice_copy: "نسخة فاتورة", dispute: "اعتراض على فاتورة", inquiry: "رد على استفسار", qualify: "تأهيل عميل محتمل", meeting: "حجز اجتماع", followup: "متابعة عميل محتمل" };
    const TITLES = Object.fromEntries(Object.keys(TITLES_EN).map(k => [k, JSON.stringify({ ar: TITLES_AR[k], en: TITLES_EN[k] })]));
    const agents = dbx.all("SELECT a.*, t.employees_count FROM agents a JOIN tenants t ON t.id=a.tenant_id");
    for (const a of agents) {
      const tpl = ROLE_TEMPLATES[a.role]; const scale = a.employees_count / 400;
      const ins = dbx.raw.prepare("INSERT INTO tasks (tenant_id,agent_id,kind,title,status,minutes_saved,created_at,completed_at) VALUES (?,?,?,?,?,?,?,?)");
      for (let d = 65; d >= 1; d--) {
        const day = addDays(now, -d); if (new Date(a.created_at) > day) continue;
        const weekend = [5, 6].includes(day.getDay());
        const base = { hr: 24, collections: 11, sales: 9 }[a.role] * Math.max(0.35, scale) * (weekend ? 0.25 : 1);
        const n = Math.round(base * (0.75 + rand() * 0.5));
        const pool = KINDS[a.role].flatMap(([k, w]) => Array(w).fill(k));
        for (let i = 0; i < n; i++) {
          const k = pick(pool); const t = at(day, between(7, 21), between(0, 59));
          const status = k === "handoff" || k === "id_expiry" || k === "dispute" ? "escalated" : "done";
          ins.run([a.tenant_id, a.id, k, TITLES[k], status, tpl.minutes[k] ?? 3, stamp(t), stamp(new Date(t.getTime() + between(5, 90) * 1000))]);
        }
      }
      ins.free();
    }
    // automations (tenant 1 + 2)
    const AUTOS = [
      ["Daily collections run", { type: "schedule", params: { time: "08:00", days: "Sun-Thu" } }, [{ type: "agent_job", role: "collections" }, { type: "notify", role: "finance_manager", text: "Daily collections summary" }]],
      ["Iqama expiry watch", { type: "schedule", params: { time: "09:00", days: "Sun" } }, [{ type: "agent_job", role: "hr" }]],
      ["Shortlist strong candidates", { type: "event", params: { event: "candidate.screened" } }, [{ type: "condition", field: "score", op: ">=", value: 70 }, { type: "agent_action", role: "hr", action: "invite_interview" }, { type: "notify", role: "hr_manager", text: "New shortlisted candidate" }]],
      ["Follow up quiet leads", { type: "schedule", params: { time: "11:00", days: "Sun-Thu" } }, [{ type: "agent_job", role: "sales" }]],
    ];
    for (const tid of [1, 2]) {
      const roles = dbx.all("SELECT role FROM agents WHERE tenant_id=?", [tid]).map(r => r.role);
      for (const [name, trig, steps] of AUTOS) { if (!steps.every(s => !s.role || ["finance_manager", "hr_manager"].includes(s.role) || roles.includes(s.role))) continue; if (steps.some(s => s.type === "agent_job" && !roles.includes(s.role))) continue;
        run("INSERT INTO automations (tenant_id,name,enabled,trigger,steps,runs_count,last_run_at,created_at) VALUES (?,?,?,?,?,?,?,?)", [tid, name, 1, JSON.stringify(trig), JSON.stringify(steps), between(8, 30), stamp(at(addDays(now, -1), 8)), stamp(addDays(now, -60))]); }
    }
    run("INSERT INTO api_keys (tenant_id,name,prefix,key_hash,created_at,last_used_at) VALUES (1,'Website chat widget','hw_live_7Kq2','(hash)',?,?)", [stamp(addDays(now, -50)), stamp(at(addDays(now, -1), 16, 20))]);
    run("INSERT INTO api_keys (tenant_id,name,prefix,key_hash,created_at,last_used_at) VALUES (1,'ERP webhook','hw_live_Pz9x','(hash)',?,?)", [stamp(addDays(now, -20)), stamp(at(now, 7, 45))]);
  });

  // ---------------- real conversations, produced by the runtime (so the traces are genuine)
  const yesterday = addDays(now, -1);
  const emp = (tid, n) => dbx.get("SELECT * FROM employees WHERE tenant_id=? ORDER BY id LIMIT 1 OFFSET ?", [tid, n]);
  const ag = (tid, role) => dbx.get("SELECT id FROM agents WHERE tenant_id=? AND role=?", [tid, role]).id;
  const say = (tid, role, contact, text, when) => handleInbound(dbx, { tenant_id: tid, agent_id: ag(tid, role), contact, text, now: when });
  const asContact = (e, type = "employee") => ({ type, id: e.id, name: e.name_en, phone: e.phone });
  const d1 = nextWorkday(now, 6), d2 = nextWorkday(now, 8);
  const range = (a, b) => `${a.getDate()} ${MON_AR[a.getMonth()]}${a.getMonth() === b.getMonth() ? "" : ""} الى ${b.getDate()} ${MON_AR[b.getMonth()]}`;

  // HR — Rawabi
  let e = emp(1, 3);
  say(1, "hr", asContact(e), "السلام عليكم", at(yesterday, 9, 2));
  say(1, "hr", asContact(e), "كم رصيد إجازتي؟", at(yesterday, 9, 3));
  say(1, "hr", asContact(e), `ابغى اجازة من ${range(d1, d2)}`, at(yesterday, 9, 4));
  say(1, "hr", asContact(e), "نعم", at(yesterday, 9, 5));
  const e2 = dbx.get("SELECT * FROM employees WHERE tenant_id=1 AND nationality IN ('Indian','Filipino') ORDER BY id LIMIT 1") || emp(1, 5);
  say(1, "hr", asContact(e2), "Hi Noura, can I get a salary certificate addressed to Saudi National Bank?", at(yesterday, 10, 15));
  e = emp(1, 8); say(1, "hr", asContact(e), "متى ينزل الراتب هالشهر؟", at(yesterday, 11, 40));
  e = emp(1, 11); say(1, "hr", asContact(e), "كم ساعات الدوام في رمضان؟", at(yesterday, 12, 5));
  e = emp(1, 14); say(1, "hr", asContact(e), "What is the overtime policy?", at(yesterday, 13, 30));
  const exp = dbx.get("SELECT * FROM employees WHERE tenant_id=1 AND id_expiry IS NOT NULL ORDER BY id_expiry LIMIT 1");
  if (exp) say(1, "hr", asContact(exp), "اقامتي متى تنتهي؟", at(yesterday, 14, 10));
  const cand = { type: "candidate", name: "Mohammed Al-Ghamdi", phone: "+9665XX555001" };
  say(1, "hr", cand, "السلام عليكم عندكم وظائف؟", at(now, 8, 12));
  say(1, "hr", cand, "1", at(now, 8, 13));
  say(1, "hr", cand, "Mohammed Al-Ghamdi — HR Generalist, 5 years experience at a Riyadh contracting company. Managed payroll for 300 employees, GOSI registrations and Qiwa contracts, Mudad wage protection, applied Saudi labor law in disciplinary cases. Advanced Excel (pivot tables, VLOOKUP). Fluent Arabic and English.", at(now, 8, 15));
  say(1, "hr", cand, "1", at(now, 8, 16));
  // a leave request that gets approved (shows the notification loop)
  e = emp(1, 20); const d3 = nextWorkday(now, 3);
  say(1, "hr", asContact(e), `I need annual leave from ${d3.getDate()} ${MON_EN[d3.getMonth()]} to ${nextWorkday(now, 4).getDate()} ${MON_EN[nextWorkday(now, 4).getMonth()]}`, at(yesterday, 15, 0));
  say(1, "hr", asContact(e), "yes", at(yesterday, 15, 1));
  const ap = dbx.get("SELECT * FROM approvals WHERE tenant_id=1 AND kind='leave_request' ORDER BY id DESC LIMIT 1");
  if (ap) applyDecision(dbx, ap, { status: "approved", user_id: 2, now: at(yesterday, 16, 30) });

  // Collections — Rawabi: yesterday's run + replies
  runJob(dbx, { tenant_id: 1, agent_id: ag(1, "collections"), now: at(yesterday, 8, 0), lang: "ar" });
  const cust = n => dbx.get("SELECT * FROM customers WHERE tenant_id=1 ORDER BY id LIMIT 1 OFFSET ?", [n]);
  const asCust = c => ({ type: "customer", id: c.id, name: c.contact_name, phone: c.phone });
  let c = cust(0); say(1, "collections", asCust(c), "صباح النور، كم المستحق علينا بالضبط؟", at(yesterday, 9, 20));
  say(1, "collections", asCust(c), "بنحول المبلغ يوم الخميس الجاي إن شاء الله", at(yesterday, 9, 26));
  c = cust(1); say(1, "collections", asCust(c), "We transferred the payment yesterday, reference TRX88231", at(yesterday, 11, 2));
  c = cust(2); say(1, "collections", asCust(c), "Can you resend the invoice copy please?", at(now, 8, 30));

  // Sales — Rawabi
  const lead1 = { type: "lead", name: "Faris Al-Mutlaq", phone: "+9665XX880101" };
  say(1, "sales", lead1, "السلام عليكم، بكم عقد النظافة لمبنى إداري 6 أدوار في الرياض؟", at(yesterday, 19, 5));
  say(1, "sales", lead1, "نبغى نبدأ الشهر الجاي، شركة رواسي القابضة", at(yesterday, 19, 9));
  say(1, "sales", lead1, "2", at(yesterday, 19, 11));
  const lead2 = { type: "lead", name: "Jason Miller", phone: "+9665XX880102" };
  say(1, "sales", lead2, "Hi, we need security guards for our warehouse in Tabuk, around 8 guards", at(now, 7, 50));

  // Masar — HR + sales
  e = emp(2, 2); say(2, "hr", asContact(e), "ابغى خطاب تعريف بالراتب لبنك الرياض", at(yesterday, 10, 0));
  e = emp(2, 5); say(2, "hr", asContact(e), "كم يوم إجازة مرضية مدفوعة؟", at(now, 9, 0));
  const lead3 = { type: "lead", name: "Saleh Barakat", phone: "+9665XX881101" };
  say(2, "sales", lead3, "نحتاج تخزين حوالي 500 بالتة في الدمام من بداية الشهر الجاي", at(now, 9, 30));
}
