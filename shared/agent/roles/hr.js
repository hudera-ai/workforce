// HR Officer AI — skills. Each branch records what it understood, which tools it called,
// which policy rule applied, and whether a human has to approve.
import { classify, extractDateRange, leaveType, letterType, addressedTo, yesNo, pickNumberChoice, screenCv, normalize, iso, has } from "../nlu.js";
import { nextPayday, slots, stamp } from "../tools.js";
import { fmtDay, fmtDateTime, money, LEAVE_LABEL, LETTER_LABEL } from "../format.js";

export function hr(ctx) {
  const L = ctx.L, st = ctx.state || {};
  const rules = ctx.rules;

  // ---------- who is writing?
  let emp = st.employee_id ? ctx.dbx.get("SELECT e.*, u.name AS manager_name FROM employees e LEFT JOIN users u ON u.id=e.manager_user_id WHERE e.id=?", [st.employee_id]) : null;
  if (!emp && ctx.contact.phone) {
    emp = ctx.tool("hr.find_employee", { phone: ctx.contact.phone });
    if (emp) { ctx.step("identify", L("تعرّفت على المرسل", "Identified sender"), `${emp.name_en} · ${emp.emp_no} · ${emp.department} (${L("مطابقة رقم الجوال المسجل", "matched registered mobile")})`); ctx.patchState({ employee_id: emp.id }); }
    else ctx.step("identify", L("رقم غير مسجل لموظف", "Number not registered to an employee"), ctx.contact.phone);
  }
  const first = emp ? (ctx.lang === "ar" ? emp.name_ar : emp.name_en).split(" ")[0] : "";

  // ---------- continue an open flow
  if (st.flow && continueFlow(ctx, emp, st)) return;

  const c = classify(ctx.text, "hr");
  ctx.step("understand", L("فهم الطلب", "Understood intent"), `${c.intent} · ${L("ثقة", "confidence")} ${Math.round(c.confidence * 100)}%${c.matched?.length ? ` · ${L("كلمات", "cues")}: ${c.matched.join("، ")}` : ""}`);

  const PERSONAL = ["leave_balance", "leave_request", "leave_status", "letter_request", "id_expiry"];
  if (!emp && PERSONAL.includes(c.intent)) {
    ctx.step("rule", L("حماية البيانات", "Data protection"), L("البيانات الشخصية تُعطى فقط لرقم الجوال المسجل في ملف الموظف", "Personal data is only shared with the mobile number on the employee file"));
    ctx.say(L("لحماية بياناتك، الطلبات الشخصية (الإجازات، الخطابات، الإقامة) متاحة فقط من رقم الجوال المسجل في ملفك لدى الموارد البشرية. أقدر أساعدك في أسئلة السياسات العامة أو الوظائف المتاحة.", "To protect your data, personal requests (leave, letters, iqama) are only available from the mobile number registered on your HR file. I can still help with general policy questions or open jobs."));
    ctx.task("policy", ctx.T("رفض طلب من رقم غير مسجل", "Blocked request from unregistered number"));
    return;
  }

  switch (c.intent) {
    case "greeting": {
      ctx.say(L(`أهلًا${first ? " " + first : ""} 👋 أنا ${ctx.agent.name_ar}، موظفة الموارد البشرية الرقمية في ${ctx.tenant.name_ar}.\nأقدر أساعدك في: رصيد الإجازات وطلبها، الخطابات (تعريف بالراتب وغيره)، مواعيد الرواتب، وأسئلة السياسات. وش تحتاج؟`,
        `Hi${first ? " " + first : ""} 👋 I'm ${ctx.agent.name}, the digital HR officer at ${ctx.tenant.name_en}.\nI can help with leave balance and requests, HR letters (salary certificate and more), payday, and policy questions. What do you need?`));
      return ctx.task("greeting", ctx.T("ترحيب", "Greeting"));
    }
    case "thanks": ctx.say(L("العفو! أي وقت 🌷", "You're welcome! Anytime.")); return;
    case "human": return handoff(ctx, L("طلب التحدث مع موظف", "Asked for a human"));
    case "leave_balance": {
      const b = ctx.tool("hr.leave_balance", { employee_id: emp.id });
      ctx.say(L(`رصيد إجازتك السنوية: ${b.balance} يوم.${b.pending ? `\nمنها ${b.pending} يوم في طلبات قيد الاعتماد، فالمتاح للطلب الآن ${b.available} يوم.` : ""}\nأيام الإجازة المرضية المستخدمة هذا العام: ${b.sick_days_used}.\nتبغى تقدم طلب إجازة؟`,
        `Your annual leave balance: ${b.balance} days.${b.pending ? `\n${b.pending} days are in pending requests, so you can request up to ${b.available} days now.` : ""}\nSick days used this year: ${b.sick_days_used}.\nWould you like to request leave?`));
      return ctx.task("leave_balance", ctx.T(`رصيد إجازات — ${emp.name_ar}`, `Leave balance — ${emp.name_en}`), "done", "employee", emp.id);
    }
    case "leave_request": return startLeave(ctx, emp, { type: leaveType(ctx.text) });
    case "leave_status": {
      const rows = ctx.tool("hr.leave_status", { employee_id: emp.id });
      if (!rows.length) { ctx.say(L("ما عندك طلبات إجازة مسجلة حاليًا.", "You have no leave requests on file.")); return ctx.task("leave_status", ctx.T("استعلام حالة إجازة", "Leave status")); }
      const r = rows[0];
      const stl = { pending: L("قيد الاعتماد", "pending approval"), approved: L("معتمدة ✅", "approved ✅"), rejected: L("مرفوضة", "rejected") }[r.status];
      ctx.say(L(`آخر طلب (#${r.id}): إجازة ${LEAVE_LABEL.ar[r.type]} من ${fmtDay(r.from_date, "ar")} إلى ${fmtDay(r.to_date, "ar")} — ${stl}.`, `Latest request (#${r.id}): ${LEAVE_LABEL.en[r.type]} leave ${fmtDay(r.from_date, "en")} – ${fmtDay(r.to_date, "en")} — ${stl}.`));
      return ctx.task("leave_status", ctx.T("استعلام حالة إجازة", "Leave status"), "done", "leave_request", r.id);
    }
    case "letter_request": return startLetter(ctx, emp, { type: letterType(ctx.text), to: addressedTo(ctx.text) });
    case "payday": {
      const d = nextPayday(ctx.now, rules.payday || 27);
      ctx.step("rule", L("سياسة الرواتب", "Payroll policy"), L(`الصرف يوم ${rules.payday || 27} من كل شهر، وإذا وافق عطلة يُقدَّم لآخر يوم عمل`, `Paid on day ${rules.payday || 27}; if it falls on a weekend, the last working day before`));
      ctx.say(L(`الرواتب تُصرف يوم ${rules.payday || 27} من كل شهر، وإذا وافق إجازة نهاية الأسبوع تُصرف قبله.\nالدفعة الجاية: ${fmtDay(iso(d), "ar")} إن شاء الله.`, `Salaries are paid on the ${rules.payday || 27}th of each month (earlier if it falls on a weekend).\nNext payday: ${fmtDay(iso(d), "en")}.`));
      return ctx.task("payday", ctx.T("سؤال موعد الراتب", "Payday question"));
    }
    case "id_expiry": {
      if (!emp.id_expiry) { ctx.say(L("ما عندي تاريخ انتهاء مسجل لهويتك، حولت سؤالك لـ HR.", "I don't have an expiry date on file — I've passed this to HR.")); return handoff(ctx, "id expiry missing", true); }
      const left = Math.round((new Date(emp.id_expiry) - new Date(iso(ctx.now))) / 864e5);
      ctx.step("tool", "hr.find_employee → id_expiry", `${emp.id_expiry} (${left} ${L("يوم", "days")})`);
      if (left <= (rules.id_expiry_warn_days || 60)) {
        ctx.step("rule", L("تنبيه تجديد", "Renewal alert"), L(`أقل من ${rules.id_expiry_warn_days || 60} يوم → إشعار HR لبدء التجديد`, `< ${rules.id_expiry_warn_days || 60} days → notify HR to start renewal`));
        ctx.say(L(`إقامتك تنتهي ${fmtDay(emp.id_expiry, "ar")} (بعد ${left} يوم). رفعت تنبيه لفريق الموارد البشرية يبدأ إجراءات التجديد، وبيتواصلون معك لو احتاجوا شي.`, `Your iqama expires on ${fmtDay(emp.id_expiry, "en")} (${left} days). I've alerted HR to start the renewal; they'll contact you if anything is needed.`));
        return ctx.task("id_expiry", ctx.T(`تجديد إقامة — ${emp.name_ar}`, `Iqama renewal — ${emp.name_en}`), "escalated", "employee", emp.id);
      }
      ctx.say(L(`إقامتك سارية حتى ${fmtDay(emp.id_expiry, "ar")} (باقي ${left} يوم). بنذكرك قبل الانتهاء بوقت كافٍ.`, `Your iqama is valid until ${fmtDay(emp.id_expiry, "en")} (${left} days left). We'll remind you well before it expires.`));
      return ctx.task("id_expiry", ctx.T("استعلام إقامة", "Iqama question"));
    }
    case "apply_job": return startApply(ctx);
    case "policy": return answerPolicy(ctx);
    default: {
      // try the knowledge base before giving up
      const hits = ctx.tool("hr.search_policy", { query: ctx.text, lang: ctx.lang });
      if (hits?.[0]?.score >= 3) return answerPolicy(ctx, hits);
      ctx.say(L("ما فهمت طلبك بالضبط 🙏 أقدر أساعدك في:\n1) رصيد الإجازات\n2) طلب إجازة\n3) خطاب تعريف / تعريف بالراتب\n4) موعد الراتب\n5) أسئلة السياسات\nأو اكتب «موظف» وأحولك لزميل من الموارد البشرية.", "I didn't quite get that 🙏 I can help with:\n1) Leave balance\n2) Leave request\n3) Employment / salary certificate\n4) Payday\n5) Policy questions\nOr type \"human\" to reach the HR team."));
      ctx.patchState({ flow: "menu" });
    }
  }
}

function handoff(ctx, reason, silent) {
  const L = ctx.L;
  ctx.tool("common.handoff", { reason });
  ctx.step("escalate", L("تحويل لموظف بشري", "Handed over to a human"), reason);
  if (!silent) ctx.say(L("حوّلت محادثتك لزميل من فريق الموارد البشرية، وبيرد عليك هنا خلال ساعات العمل.", "I've handed this conversation to a colleague in HR — they'll reply here during working hours."));
  ctx.task("handoff", ctx.T("تحويل لموظف بشري", "Handed over to a human"), "escalated");
}

function answerPolicy(ctx, hits) {
  const L = ctx.L;
  hits = hits || ctx.tool("hr.search_policy", { query: ctx.text, lang: ctx.lang });
  const best = hits?.[0];
  if (!best || best.score < 2.2) { ctx.step("knowledge", L("لا توجد إجابة موثوقة في السياسات", "No confident answer in the policies"), best ? `${L("أفضل نتيجة", "best")}: ${best.title} (${best.score})` : "—"); return handoff(ctx, L("سؤال سياسات بدون إجابة في المستندات", "Policy question not covered by documents")); }
  ctx.step("knowledge", L("وجدت الإجابة في", "Found the answer in"), `${best.title} · ${L("فقرة", "§")} ${best.n} · score ${best.score} · ${best.hit.slice(0, 5).join(", ")}`);
  const text = best.text.length > 520 ? best.text.slice(0, 520).replace(/\s+\S*$/, "") + "…" : best.text;
  ctx.say(L(`${text}\n\n📄 المصدر: ${best.title}`, `${text}\n\n📄 Source: ${best.title}`));
  ctx.task("policy", ctx.T(`سؤال سياسات — ${best.title}`, `Policy question — ${best.title}`));
}

// ---------------------------------------------------------------- leave
function startLeave(ctx, emp, seed) {
  const L = ctx.L;
  const type = seed.type || "annual";
  const r = extractDateRange(ctx.text, ctx.now);
  ctx.step("entities", L("استخراج التفاصيل", "Extracted details"), `${L("النوع", "type")}: ${type}${r?.from ? ` · ${r.from} → ${r.to} · ${r.days} ${L("يوم عمل", "working days")}` : ` · ${L("بدون تواريخ", "no dates")}`}`);
  if (!r || !r.from) {
    ctx.patchState({ flow: "leave", step: "dates", type });
    ctx.say(L(`أكيد. إجازة ${LEAVE_LABEL.ar[type]} — من أي تاريخ إلى أي تاريخ؟\nمثال: «من 12 إلى 14 نوفمبر» أو «بكرة يوم واحد».`, `Sure — ${LEAVE_LABEL.en[type]} leave. Which dates?\nE.g. "12–14 Nov" or "tomorrow, one day".`));
    return;
  }
  return reviewLeave(ctx, emp, { type, ...r });
}
function reviewLeave(ctx, emp, req) {
  const L = ctx.L, rules = ctx.rules;
  const todayStr = iso(ctx.now);
  if (req.from < todayStr && req.type !== "sick") { ctx.patchState({ flow: "leave", step: "dates", type: req.type }); ctx.say(L(`التاريخ ${fmtDay(req.from, "ar")} فات. أرسل تواريخ قادمة لو سمحت.`, `${fmtDay(req.from, "en")} is in the past — please send upcoming dates.`)); return; }
  if (req.days <= 0) { ctx.say(L("الفترة اللي ذكرتها كلها إجازة نهاية أسبوع، ما تحتاج طلب 🙂", "Those dates fall entirely on the weekend — no request needed 🙂")); ctx.patchState(null); return; }
  const overlap = ctx.dbx.get("SELECT * FROM leave_requests WHERE employee_id=? AND status IN ('pending','approved') AND NOT (to_date < ? OR from_date > ?)", [emp.id, req.from, req.to]);
  if (overlap) { ctx.step("rule", L("تعارض", "Overlap"), `#${overlap.id} ${overlap.from_date}→${overlap.to_date}`); ctx.say(L(`عندك طلب إجازة سابق (#${overlap.id}) يتداخل مع نفس الفترة (${fmtDay(overlap.from_date, "ar")} – ${fmtDay(overlap.to_date, "ar")}).`, `You already have a request (#${overlap.id}) overlapping these dates (${fmtDay(overlap.from_date, "en")} – ${fmtDay(overlap.to_date, "en")}).`)); ctx.patchState(null); return ctx.task("leave_request", ctx.T("طلب إجازة متعارض", "Overlapping leave request")); }
  let after = null;
  if (req.type === "annual") {
    const b = ctx.tool("hr.leave_balance", { employee_id: emp.id });
    if (req.days > b.available) {
      ctx.step("rule", L("الرصيد غير كافٍ", "Insufficient balance"), `${req.days} > ${b.available}`);
      ctx.say(L(`رصيدك المتاح ${b.available} يوم، والطلب ${req.days} أيام. تقدر تطلب ${b.available} أيام سنوية والباقي بدون راتب — تبغى كذا؟`, `You have ${b.available} days available and asked for ${req.days}. You could take ${b.available} annual days and the rest unpaid — shall I do that?`));
      ctx.patchState(null); return ctx.task("leave_request", ctx.T("طلب إجازة — رصيد غير كافٍ", "Leave request — insufficient balance"));
    }
    after = b.available - req.days;
  }
  ctx.patchState({ flow: "leave", step: "confirm", req });
  ctx.say(L(`تمام، هذا ملخص الطلب:\n• النوع: إجازة ${LEAVE_LABEL.ar[req.type]}\n• من ${fmtDay(req.from, "ar")} إلى ${fmtDay(req.to, "ar")}\n• المدة: ${req.days} يوم عمل${after != null ? `\n• رصيدك بعد الطلب: ${after} يوم` : ""}\nأرفعه؟ (نعم / لا)`,
    `Here's the request:\n• Type: ${LEAVE_LABEL.en[req.type]} leave\n• ${fmtDay(req.from, "en")} → ${fmtDay(req.to, "en")}\n• ${req.days} working day(s)${after != null ? `\n• Balance after: ${after} days` : ""}\nSubmit it? (yes / no)`));
}
function submitLeave(ctx, emp, req) {
  const L = ctx.L, rules = ctx.rules;
  const notice = Math.round((new Date(req.from) - new Date(iso(ctx.now))) / 864e5);
  const auto = req.type === "annual" && req.days <= (rules.auto_approve_max_days ?? 1) && notice >= (rules.min_notice_days ?? 2);
  ctx.step("rule", L("قاعدة الاعتماد", "Approval rule"), auto
    ? L(`سنوية ≤ ${rules.auto_approve_max_days} يوم وبإشعار ${notice} أيام ≥ ${rules.min_notice_days} → اعتماد تلقائي`, `annual ≤ ${rules.auto_approve_max_days} day and ${notice} days' notice ≥ ${rules.min_notice_days} → auto-approve`)
    : L(`تحتاج موافقة المدير (${req.type !== "annual" ? "نوع " + LEAVE_LABEL.ar[req.type] : req.days > (rules.auto_approve_max_days ?? 1) ? "أكثر من " + rules.auto_approve_max_days + " يوم" : "إشعار أقل من " + rules.min_notice_days + " أيام"})`, `needs manager approval (${req.type !== "annual" ? req.type + " leave" : req.days > (rules.auto_approve_max_days ?? 1) ? "more than " + rules.auto_approve_max_days + " day" : "less than " + rules.min_notice_days + " days' notice"})`));
  const { id } = ctx.tool("hr.create_leave_request", { employee_id: emp.id, type: req.type, from_date: req.from, to_date: req.to, days: req.days, status: auto ? "approved" : "pending" });
  ctx.patchState(null);
  if (auto) {
    ctx.say(L(`تم ✅ اعتمدت إجازتك تلقائيًا (طلب #${id}) حسب السياسة.\n${fmtDay(req.from, "ar")}${req.from !== req.to ? " – " + fmtDay(req.to, "ar") : ""}. أبلغت مديرك ${emp.manager_name || ""} للعلم.`, `Done ✅ Your leave was auto-approved (request #${id}) under the policy.\n${fmtDay(req.from, "en")}${req.from !== req.to ? " – " + fmtDay(req.to, "en") : ""}. Your manager ${emp.manager_name || ""} has been notified.`));
    return ctx.task("leave_request", ctx.T(`إجازة معتمدة تلقائيًا — ${emp.name_ar}`, `Leave auto-approved — ${emp.name_en}`), "done", "leave_request", id);
  }
  const t = ctx.task("leave_request", ctx.T(`طلب إجازة — ${emp.name_ar}`, `Leave request — ${emp.name_en}`), "waiting_approval", "leave_request", id);
  ctx.approval({ kind: "leave_request", approver_role: "hr_manager", task_id: t, title: ctx.T(`إجازة ${LEAVE_LABEL.ar[req.type]} — ${emp.name_ar} (${req.days} يوم)`, `${LEAVE_LABEL.en[req.type]} leave — ${emp.name_en} (${req.days} days)`),
    summary: `${req.from} → ${req.to}`, payload: { leave_request_id: id, employee_id: emp.id, ...req } });
  const extra = req.type === "sick" && req.days > 1 ? L("\nللإجازة المرضية أكثر من يوم: أرسل صورة التقرير الطبي هنا لو سمحت.", "\nFor sick leave over one day, please send a photo of the medical report here.") : "";
  ctx.say(L(`رفعت طلبك (#${id}) لمديرك ${emp.manager_name || "المباشر"} للموافقة ✅\nبأبلغك هنا أول ما يتم الرد.${extra}`, `I've sent your request (#${id}) to ${emp.manager_name || "your manager"} for approval ✅\nI'll update you here as soon as there's a decision.${extra}`));
}

// ---------------------------------------------------------------- letters
function startLetter(ctx, emp, seed) {
  const L = ctx.L;
  if (!seed.type) {
    ctx.patchState({ flow: "letter", step: "type", to: seed.to });
    ctx.say(L("أي خطاب تحتاج؟\n1) تعريف بالراتب\n2) خطاب تعريف (بدون راتب)\n3) شهادة خبرة\n4) خطاب عدم ممانعة", "Which letter do you need?\n1) Salary certificate\n2) Employment letter (no salary)\n3) Experience letter\n4) No-objection letter (NOC)"));
    return;
  }
  if (!seed.to && seed.type === "salary_certificate") {
    ctx.patchState({ flow: "letter", step: "to", type: seed.type });
    ctx.step("entities", L("نوع الخطاب", "Letter type"), seed.type);
    ctx.say(L("لأي جهة يكون الخطاب؟ (مثال: بنك الراجحي) أو اكتب «لمن يهمه الأمر».", "Who should it be addressed to? (e.g. Al Rajhi Bank) or type \"To whom it may concern\"."));
    return;
  }
  return draftLetter(ctx, emp, seed.type, seed.to);
}
function draftLetter(ctx, emp, type, to) {
  const L = ctx.L;
  ctx.step("entities", L("تفاصيل الخطاب", "Letter details"), `${type} · ${L("إلى", "to")}: ${to || L("لمن يهمه الأمر", "whom it may concern")} · ${L("اللغة", "language")}: ${ctx.lang}`);
  const { id } = ctx.tool("hr.draft_letter", { employee: emp, type, addressed_to: to, lang: ctx.lang });
  ctx.patchState(null);
  if (ctx.rules.letters_require_approval !== false) {
    ctx.step("rule", L("قاعدة الخطابات", "Letters rule"), L("كل خطاب رسمي يُراجع ويُعتمد من HR قبل الإصدار", "Every official letter is reviewed by HR before it is issued"));
    const t = ctx.task("letter", ctx.T(`${LETTER_LABEL.ar[type]} — ${emp.name_ar}`, `${LETTER_LABEL.en[type]} — ${emp.name_en}`), "waiting_approval", "letter", id);
    ctx.approval({ kind: "letter", approver_role: "hr_manager", task_id: t, title: ctx.T(`${LETTER_LABEL.ar[type]} — ${emp.name_ar}`, `${LETTER_LABEL.en[type]} — ${emp.name_en}`), summary: to || "", payload: { letter_id: id, employee_id: emp.id } });
    ctx.say(L(`جهزت مسودة ${LETTER_LABEL.ar[type]}${to ? " موجهة إلى " + to : ""} وأرسلتها لمسؤول الموارد البشرية للاعتماد ✍️\nبأرسلك الرقم المرجعي هنا بعد الاعتماد (عادة نفس اليوم).`, `I've drafted your ${LETTER_LABEL.en[type].toLowerCase()}${to ? " addressed to " + to : ""} and sent it to HR for sign-off ✍️\nI'll send you the reference number here once it's approved (usually same day).`));
    return;
  }
  ctx.dbx.run("UPDATE letters SET status='issued', issued_at=?, ref_no=? WHERE id=?", [ctx.nowStr, `HR-${iso(ctx.now).slice(0, 4)}-${String(id).padStart(4, "0")}`, id]);
  ctx.say(L(`خطابك جاهز ✅ أرسلته على بريدك ${emp.email}.`, `Your letter is ready ✅ — sent to ${emp.email}.`));
  ctx.task("letter", ctx.T(`${LETTER_LABEL.ar[type]} — ${emp.name_ar}`, `${LETTER_LABEL.en[type]} — ${emp.name_en}`), "done", "letter", id);
}

// ---------------------------------------------------------------- recruitment
function startApply(ctx) {
  const L = ctx.L;
  const jobs = ctx.dbx.all("SELECT * FROM jobs WHERE tenant_id=? AND status='open' ORDER BY id", [ctx.tenant.id]);
  if (!jobs.length) { ctx.say(L("حاليًا ما عندنا شواغر مفتوحة، تابع حساباتنا للإعلانات القادمة.", "We have no open positions right now — follow our pages for upcoming roles.")); return ctx.task("cv_screen", ctx.T("استفسار وظائف", "Jobs inquiry")); }
  ctx.patchState({ flow: "apply", step: "job", jobs: jobs.map(j => j.id) });
  ctx.say(L(`أهلًا بك! الشواغر المتاحة:\n${jobs.map((j, i) => `${i + 1}) ${j.title} — ${j.department}`).join("\n")}\nاكتب رقم الوظيفة.`, `Welcome! Open positions:\n${jobs.map((j, i) => `${i + 1}) ${j.title} — ${j.department}`).join("\n")}\nReply with the number.`));
}

function continueFlow(ctx, emp, st) {
  const L = ctx.L; const t = normalize(ctx.text);
  if (has(t, ["الغاء", "الغي", "cancel", "stop", "خلاص"]) && st.flow !== "menu") { ctx.patchState(null); ctx.say(L("تم الإلغاء. تحتاج شي ثاني؟", "Cancelled. Anything else?")); return true; }
  if (st.flow === "menu") {
    const n = pickNumberChoice(ctx.text, 5); ctx.patchState(null); if (!n) return false;
    ctx.step("understand", L("اختيار من القائمة", "Menu choice"), String(n));
    if (n === 5) { ctx.say(L("اكتب سؤالك عن السياسات (مثال: كم ساعات الدوام في رمضان؟)", "Type your policy question (e.g. What are the working hours in Ramadan?)")); return true; }
    ctx.text = ["كم رصيد اجازتي", "ابغى اجازة", "ابغى خطاب", "متى ينزل الراتب"][n - 1]; return false;
  }
  if (st.flow === "leave" && st.step === "dates") {
    const r = extractDateRange(ctx.text, ctx.now);
    if (!r || !r.from) { const c = classify(ctx.text, "hr"); if (c.confidence > 0.75 && c.intent !== "leave_request") { ctx.patchState(null); return false; } ctx.say(L("ما قدرت أحدد التاريخ 🙏 اكتبه مثل: «من 12 إلى 14 نوفمبر» أو «بكرة».", "I couldn't read the dates 🙏 Try \"12–14 Nov\" or \"tomorrow\".")); return true; }
    ctx.step("entities", L("التواريخ", "Dates"), `${r.from} → ${r.to} · ${r.days}`);
    reviewLeave(ctx, emp, { type: st.type || "annual", ...r }); return true;
  }
  if (st.flow === "leave" && st.step === "confirm") {
    const yn = yesNo(ctx.text);
    if (yn === true) { ctx.step("understand", L("تأكيد", "Confirmed"), L("نعم", "yes")); submitLeave(ctx, emp, st.req); return true; }
    if (yn === false) { ctx.patchState(null); ctx.say(L("تمام، ما رفعت الطلب. تحتاج شي ثاني؟", "OK, I didn't submit it. Anything else?")); return true; }
    const r = extractDateRange(ctx.text, ctx.now); if (r?.from) { reviewLeave(ctx, emp, { type: st.req.type, ...r }); return true; }
    ctx.say(L("أرفع الطلب؟ اكتب نعم أو لا.", "Shall I submit it? Reply yes or no.")); return true;
  }
  if (st.flow === "letter" && st.step === "type") {
    const n = pickNumberChoice(ctx.text, 4); const ty = n ? ["salary_certificate", "employment_certificate", "experience_letter", "noc"][n - 1] : letterType(ctx.text);
    if (!ty) { ctx.patchState(null); return false; }
    startLetter(ctx, emp, { type: ty, to: st.to || addressedTo(ctx.text) }); return true;
  }
  if (st.flow === "letter" && st.step === "to") {
    const to = has(t, ["لمن يهمه", "whom it may concern", "اي جهه", "any"]) ? null : (addressedTo(ctx.text) || ctx.text.trim().slice(0, 60));
    draftLetter(ctx, emp, st.type, to); return true;
  }
  if (st.flow === "apply" && st.step === "job") {
    const n = pickNumberChoice(ctx.text, st.jobs.length); if (!n) { ctx.say(L("اكتب رقم الوظيفة من القائمة لو سمحت.", "Please reply with the job number.")); return true; }
    const job = ctx.dbx.get("SELECT * FROM jobs WHERE id=?", [st.jobs[n - 1]]);
    ctx.patchState({ flow: "apply", step: "cv", job_id: job.id });
    ctx.say(L(`ممتاز — ${job.title}. أرسل سيرتك الذاتية كنص هنا (الخبرات، سنوات الخبرة، المهارات والشهادات).`, `Great — ${job.title}. Paste your CV here as text (experience, years, skills and certificates).`)); return true;
  }
  if (st.flow === "apply" && st.step === "cv") {
    if (ctx.text.length < 60) { ctx.say(L("أرسل السيرة الذاتية كاملة كنص لو سمحت (الخبرات والمهارات).", "Please paste the full CV text (experience and skills).")); return true; }
    const job = ctx.dbx.get("SELECT * FROM jobs WHERE id=?", [st.job_id]);
    const r = ctx.tool("hr.screen_cv", { job, cv_text: ctx.text, name: ctx.contact.name || "Candidate", phone: ctx.contact.phone, screen: screenCv });
    ctx.step("score", L("تقييم السيرة الذاتية", "CV score"), `${r.score}/100 · ${r.breakdown.map(b => `${b.ok ? "✓" : "✗"} ${b.item}`).join(" · ")}`);
    const th = ctx.rules.shortlist_threshold || 70;
    if (r.score >= th) {
      const s = slots(ctx.now, 2);
      ctx.step("rule", L("قائمة مختصرة", "Shortlist"), `${r.score} ≥ ${th} → ${L("عرض موعد مقابلة", "offer interview slots")}`);
      ctx.patchState({ flow: "apply", step: "slot", candidate_id: r.id, slots: s.map(stamp), job_id: job.id });
      ctx.say(L(`شكرًا! ملفك مطابق بنسبة ${r.score}% لوظيفة ${job.title} 👏\nنبغى نحدد مقابلة أولية (30 دقيقة، مكالمة فيديو):\n1) ${fmtDateTime(stamp(s[0]), "ar")}\n2) ${fmtDateTime(stamp(s[1]), "ar")}\nاختر رقم الموعد.`, `Thank you! Your profile is a ${r.score}% match for ${job.title} 👏\nLet's book a first interview (30-min video call):\n1) ${fmtDateTime(stamp(s[0]), "en")}\n2) ${fmtDateTime(stamp(s[1]), "en")}\nReply with 1 or 2.`));
      ctx.task("cv_screen", ctx.T(`فرز سيرة ذاتية — ${job.title} (${r.score}%)`, `CV screened — ${job.title} (${r.score}%)`), "done", "candidate", r.id);
      return true;
    }
    ctx.step("rule", L("أقل من حد القائمة المختصرة", "Below shortlist threshold"), `${r.score} < ${th}${r.missing_must.length ? " · " + L("ناقص", "missing") + ": " + r.missing_must.join(", ") : ""}`);
    ctx.patchState(null);
    ctx.say(L("شكرًا على اهتمامك! استلمنا سيرتك الذاتية وبيراجعها فريق التوظيف، ونتواصل معك إذا كان ملفك مناسبًا للمرحلة القادمة.", "Thank you for your interest! We've received your CV; our recruitment team will review it and contact you if it fits the next stage."));
    ctx.task("cv_screen", ctx.T(`فرز سيرة ذاتية — ${job.title} (${r.score}%)`, `CV screened — ${job.title} (${r.score}%)`), "done", "candidate", r.id);
    return true;
  }
  if (st.flow === "apply" && st.step === "slot") {
    const n = pickNumberChoice(ctx.text, 2); if (!n) { ctx.say(L("اختر 1 أو 2 لو سمحت.", "Please reply 1 or 2.")); return true; }
    const at = st.slots[n - 1];
    ctx.tool("hr.schedule_interview", { candidate_id: st.candidate_id, at });
    ctx.patchState(null);
    ctx.say(L(`تم حجز مقابلتك ${fmtDateTime(at, "ar")} ✅ بيوصلك رابط الاجتماع قبلها بساعة. بالتوفيق!`, `Your interview is booked for ${fmtDateTime(at, "en")} ✅ You'll get the meeting link an hour before. Good luck!`));
    ctx.task("interview", ctx.T("حجز مقابلة", "Interview booked"), "done", "candidate", st.candidate_id);
    return true;
  }
  ctx.patchState(null);
  return false;
}
