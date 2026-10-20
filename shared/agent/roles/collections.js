// Collections Officer AI — inbound replies from customers and the proactive reminder cadence.
import { classify, extractDateRange, findDates, invoiceNo, bankRef, amount, iso, relativeDate } from "../nlu.js";
import { fmtDay, money } from "../format.js";

export function collections(ctx) {
  const L = ctx.L;
  let cust = ctx.state?.customer_id ? ctx.dbx.get("SELECT * FROM customers WHERE id=?", [ctx.state.customer_id]) : null;
  if (!cust && ctx.contact.phone) {
    cust = ctx.dbx.get("SELECT * FROM customers WHERE tenant_id=? AND phone=?", [ctx.tenant.id, ctx.contact.phone]);
    if (cust) { ctx.step("identify", L("تعرّفت على العميل", "Identified customer"), `${cust.name} · ${cust.contact_name}`); ctx.patchState({ customer_id: cust.id }); }
  }
  const c = classify(ctx.text, "collections");
  ctx.step("understand", L("فهم الرسالة", "Understood intent"), `${c.intent} · ${L("ثقة", "confidence")} ${Math.round(c.confidence * 100)}%${c.matched?.length ? ` · ${c.matched.join("، ")}` : ""}`);
  if (!cust) {
    ctx.step("rule", L("حماية البيانات", "Data protection"), L("أرصدة العملاء تُعطى فقط لأرقام جهات الاتصال المسجلة", "Balances are only shared with registered customer contacts"));
    ctx.say(L("أهلًا! هذه الخدمة لعملائنا المسجلين. ما لقيت رقمك ضمن جهات اتصال العملاء — حولتك لزميل من الحسابات يتواصل معك.", "Hello! This line is for registered customers. Your number isn't on a customer account — I've passed you to our accounts team."));
    ctx.tool("common.handoff", { reason: "unknown number" }); return ctx.task("handoff", ctx.T("رقم غير مسجل", "Unknown number"), "escalated");
  }
  const bal = () => ctx.tool("fin.customer_balance", { customer_id: cust.id });
  const pickInvoices = b => { const no = invoiceNo(ctx.text); if (no) { const inv = b.invoices.find(i => i.invoice_no.toUpperCase().endsWith(no.replace(/^INV-?/, ""))); if (inv) return [inv]; } const od = b.invoices.filter(i => i.days_overdue > 0); return od.length ? od : b.invoices.slice(0, 1); };

  switch (c.intent) {
    case "greeting": ctx.say(L(`أهلًا ${cust.contact_name} 👋 معك ${ctx.agent.name_ar} من قسم التحصيل في ${ctx.tenant.name_ar}. أقدر أعطيك كشف الحساب، نسخ الفواتير، أو أسجل موعد السداد. كيف أخدمك؟`, `Hello ${cust.contact_name} 👋 This is ${ctx.agent.name} from ${ctx.tenant.name_en} accounts receivable. I can share your statement, invoice copies, or record a payment date. How can I help?`)); return ctx.task("greeting", ctx.T("ترحيب", "Greeting"));
    case "thanks": ctx.say(L("شكرًا لكم، نقدّر تعاونكم 🌷", "Thank you — we appreciate it.")); return;
    case "human": ctx.tool("common.handoff", { reason: "asked for human" }); ctx.step("escalate", L("تحويل للحسابات", "Handed to accounts"), ""); ctx.say(L("حولتك لزميل من الحسابات وبيرد عليك قريبًا.", "I've passed you to a colleague in accounts — they'll reply shortly.")); return ctx.task("handoff", ctx.T("تحويل لموظف", "Handed over"), "escalated");
    case "balance": {
      const b = bal();
      if (!b.invoices.length) { ctx.say(L("حسابكم لا يوجد عليه مبالغ مستحقة ✅ شكرًا لكم.", "Your account has no outstanding balance ✅ Thank you.")); return ctx.task("balance", ctx.T(`كشف حساب — ${cust.name}`, `Statement — ${cust.name}`)); }
      const lines = b.invoices.map(i => `• ${i.invoice_no}: ${money(i.due, ctx.lang)} — ${L("استحقاق", "due")} ${fmtDay(i.due_date, ctx.lang)}${i.days_overdue ? ` (${L("متأخرة", "overdue")} ${i.days_overdue} ${L("يوم", "days")})` : ""}`).join("\n");
      ctx.say(L(`كشف حساب ${cust.name}:\n${lines}\nالإجمالي المستحق: ${money(b.total, "ar")}${b.overdue ? `، منها متأخر ${money(b.overdue, "ar")}` : ""}.\nمتى نتوقع السداد؟`, `Statement for ${cust.name}:\n${lines}\nTotal outstanding: ${money(b.total, "en")}${b.overdue ? `, of which overdue ${money(b.overdue, "en")}` : ""}.\nWhen can we expect payment?`));
      return ctx.task("balance", ctx.T(`كشف حساب — ${cust.name}`, `Statement — ${cust.name}`), "done", "customer", cust.id);
    }
    case "promise": {
      const b = bal(); const inv = pickInvoices(b);
      const r = extractDateRange(ctx.text, ctx.now); const date = r?.from || relativeDate(ctx.text, ctx.now);
      if (!date) { ctx.say(L("ممتاز 🙏 في أي تاريخ بالضبط نتوقع التحويل؟", "Great 🙏 On which exact date should we expect the transfer?")); ctx.patchState({ customer_id: cust.id, flow: "promise" }); return; }
      const days = Math.round((new Date(date) - new Date(iso(ctx.now))) / 864e5);
      const total = inv.reduce((a, i) => a + i.due, 0);
      ctx.step("entities", L("وعد بالسداد", "Promise to pay"), `${date} (${days} ${L("يوم", "days")}) · ${inv.map(i => i.invoice_no).join(", ")} · ${money(total, ctx.lang)}`);
      if (days > (ctx.rules.max_promise_days || 14)) {
        ctx.step("rule", L("مهلة أطول من المسموح", "Longer than allowed"), `${days} > ${ctx.rules.max_promise_days || 14} → ${L("موافقة المدير المالي", "finance manager approval")}`);
        const t = ctx.task("promise", ctx.T(`طلب مهلة سداد — ${cust.name}`, `Payment extension — ${cust.name}`), "waiting_approval", "customer", cust.id);
        ctx.approval({ kind: "promise_extension", approver_role: "finance_manager", task_id: t, title: ctx.T(`مهلة سداد ${days} يوم — ${cust.name}`, `${days}-day payment extension — ${cust.name}`), summary: `${money(total, ctx.lang)} · ${date}`, payload: { customer_id: cust.id, invoice_ids: inv.map(i => i.id), date, amount: total } });
        ctx.say(L(`تمام، الموعد ${fmtDay(date, "ar")} أبعد من المهلة المعتادة (${ctx.rules.max_promise_days || 14} يوم)، فرفعته للمدير المالي للموافقة وبأرجع لكم اليوم.`, `Noted — ${fmtDay(date, "en")} is beyond our usual ${ctx.rules.max_promise_days || 14}-day window, so I've asked our finance manager to approve it. I'll get back to you today.`));
        ctx.patchState({ customer_id: cust.id }); return;
      }
      ctx.tool("fin.record_promise", { invoice_ids: inv.map(i => i.id), date });
      ctx.say(L(`سجّلت موعد السداد ${fmtDay(date, "ar")} بمبلغ ${money(total, "ar")} (${inv.map(i => i.invoice_no).join("، ")}) ✅\nبأرسل لكم تذكير قبلها بيوم. شكرًا لتعاونكم.`, `Recorded: payment of ${money(total, "en")} on ${fmtDay(date, "en")} (${inv.map(i => i.invoice_no).join(", ")}) ✅\nI'll send a reminder the day before. Thank you.`));
      ctx.patchState({ customer_id: cust.id });
      return ctx.task("promise", ctx.T(`وعد سداد — ${cust.name}`, `Promise to pay — ${cust.name}`), "done", "customer", cust.id);
    }
    case "paid": {
      const b = bal(); const inv = pickInvoices(b); const ref = bankRef(ctx.text); const amt = amount(ctx.text) || inv.reduce((a, i) => a + i.due, 0);
      ctx.step("entities", L("إشعار سداد", "Payment claim"), `${inv.map(i => i.invoice_no).join(", ")} · ${money(amt, ctx.lang)}${ref ? " · ref " + ref : ""}`);
      ctx.tool("fin.payment_claim", { invoice_ids: inv.map(i => i.id), ref, amount: amt });
      ctx.step("rule", L("مطابقة بنكية", "Bank matching"), L("أي سداد يُؤكَّد من المالية بعد مطابقة كشف البنك", "Payments are confirmed by finance after bank reconciliation"));
      const t = ctx.task("paid", ctx.T(`تأكيد سداد — ${cust.name}`, `Confirm payment — ${cust.name}`), "waiting_approval", "customer", cust.id);
      ctx.approval({ kind: "payment_claim", approver_role: "finance_manager", task_id: t, title: ctx.T(`تأكيد استلام ${money(amt, "ar")} — ${cust.name}`, `Confirm receipt of ${money(amt, "en")} — ${cust.name}`), summary: ref ? `ref ${ref}` : "", payload: { customer_id: cust.id, invoice_ids: inv.map(i => i.id), ref, amount: amt } });
      ctx.say(L(`شكرًا لكم 🙏 سجّلت التحويل${ref ? ` (مرجع ${ref})` : ""} بمبلغ ${money(amt, "ar")} وأرسلته لقسم المالية للمطابقة مع كشف البنك. بأرسل لكم إيصال الاستلام فور التأكيد.`, `Thank you 🙏 I've logged the transfer${ref ? ` (ref ${ref})` : ""} of ${money(amt, "en")} and sent it to finance to match against the bank statement. I'll send your receipt as soon as it's confirmed.`));
      return;
    }
    case "dispute": {
      const b = bal(); const inv = pickInvoices(b)[0];
      if (inv) ctx.tool("fin.open_dispute", { invoice_id: inv.id });
      ctx.tool("common.handoff", { reason: "dispute" });
      ctx.step("escalate", L("اعتراض → المالية", "Dispute → finance"), inv ? inv.invoice_no : "");
      ctx.say(L(`آسفين على الإزعاج. فتحت اعتراض على الفاتورة ${inv?.invoice_no || ""} وأوقفت التذكيرات عليها، وحولته لمسؤول الحسابات يراجع التفاصيل معكم.`, `Sorry for the trouble. I've opened a dispute on invoice ${inv?.invoice_no || ""}, paused reminders on it, and passed it to our accounts lead to review with you.`));
      return ctx.task("dispute", ctx.T(`اعتراض فاتورة — ${cust.name}`, `Invoice dispute — ${cust.name}`), "escalated", "invoice", inv?.id);
    }
    case "invoice_copy": {
      const b = bal(); const inv = pickInvoices(b)[0];
      if (!inv) { ctx.say(L("لا توجد فواتير مفتوحة على حسابكم.", "There are no open invoices on your account.")); return; }
      ctx.tool("fin.send_invoice_copy", { invoice: { ...inv, email: cust.email } });
      ctx.say(L(`أرسلت نسخة الفاتورة ${inv.invoice_no} (${money(inv.amount, "ar")}) على بريدكم ${cust.email} 📎`, `I've emailed a copy of invoice ${inv.invoice_no} (${money(inv.amount, "en")}) to ${cust.email} 📎`));
      return ctx.task("invoice_copy", ctx.T(`نسخة فاتورة — ${cust.name}`, `Invoice copy — ${cust.name}`), "done", "invoice", inv.id);
    }
    default: {
      if (ctx.state?.flow === "promise" && findDates(ctx.text, ctx.now).length) { ctx.text = "بنحول " + ctx.text; return collections(ctx); }
      ctx.say(L("أقدر أساعدك في: كشف الحساب، نسخة فاتورة، تسجيل موعد السداد، أو إبلاغنا بتحويل تم. أو اكتب «موظف» للتحدث مع الحسابات.", "I can help with: your statement, an invoice copy, recording a payment date, or telling us about a transfer. Or type \"human\" for our accounts team."));
    }
  }
}

// Proactive cadence: friendly → firm → escalation (finance approval before a formal notice).
export function collectionsRun(ctx, { send }) {
  const L = ctx.L, R = ctx.rules; const todayStr = iso(ctx.now);
  const rows = ctx.dbx.all("SELECT i.*, c.name AS customer, c.contact_name, c.phone, c.email FROM invoices i JOIN customers c ON c.id=i.customer_id WHERE i.tenant_id=? AND i.status='open' AND i.due_date < ? ORDER BY i.due_date", [ctx.tenant.id, todayStr]);
  const log = [];
  for (const inv of rows) {
    const od = Math.round((new Date(todayStr) - new Date(inv.due_date)) / 864e5);
    const due = inv.amount - inv.paid_amount;
    if (inv.promise_date && inv.promise_date >= todayStr) { log.push(`${inv.invoice_no}: ${L("وعد سداد", "promise")} ${inv.promise_date} → ${L("لا تذكير", "skip")}`); continue; }
    if (inv.last_reminder_at && (new Date(todayStr) - new Date(inv.last_reminder_at.slice(0, 10))) / 864e5 < (R.min_days_between || 3)) { log.push(`${inv.invoice_no}: ${L("تذكير حديث", "recent reminder")} → skip`); continue; }
    const brokenPromise = inv.promise_date && inv.promise_date < todayStr;
    const stage = od >= (R.escalate_after_days || 15) ? "escalate" : od >= 7 ? "firm" : "friendly";
    if (stage === "escalate" && !inv.escalated) {
      const t = ctx.taskFor("reminder", ctx.T(`تصعيد — ${inv.customer} ${inv.invoice_no}`, `Escalation — ${inv.customer} ${inv.invoice_no}`), "waiting_approval", "invoice", inv.id);
      ctx.approvalFor({ kind: "legal_notice", approver_role: "finance_manager", task_id: t, title: ctx.T(`إنذار رسمي — ${inv.customer} (${od} يوم تأخير)`, `Formal notice — ${inv.customer} (${od} days overdue)`), summary: `${inv.invoice_no} · ${money(due, ctx.lang)}`, payload: { invoice_id: inv.id, customer_id: inv.customer_id, days: od, amount: due } });
      ctx.dbx.run("UPDATE invoices SET escalated=1 WHERE id=?", [inv.id]);
      log.push(`${inv.invoice_no}: ${od}d → ${L("طلب موافقة لإنذار رسمي", "approval requested for formal notice")}`);
      continue;
    }
    if (stage === "escalate") { log.push(`${inv.invoice_no}: ${L("بانتظار قرار التصعيد", "awaiting escalation decision")}`); continue; }
    const msg = brokenPromise
      ? L(`مساء الخير ${inv.contact_name}، كان موعد السداد المتفق عليه للفاتورة ${inv.invoice_no} (${money(due, "ar")}) يوم ${fmtDay(inv.promise_date, "ar")} ولم يصلنا التحويل بعد. متى نتوقعه؟`, `Hello ${inv.contact_name}, the agreed payment date for invoice ${inv.invoice_no} (${money(due, "en")}) was ${fmtDay(inv.promise_date, "en")} and we haven't received it yet. When can we expect it?`)
      : stage === "friendly"
        ? L(`صباح الخير ${inv.contact_name} 🌤️ تذكير لطيف: الفاتورة ${inv.invoice_no} بمبلغ ${money(due, "ar")} استحقت يوم ${fmtDay(inv.due_date, "ar")}. لو تم التحويل تجاهل الرسالة، وإلا متى نتوقع السداد؟`, `Good morning ${inv.contact_name} 🌤️ Friendly reminder: invoice ${inv.invoice_no} for ${money(due, "en")} was due on ${fmtDay(inv.due_date, "en")}. If it's been paid please ignore this; otherwise, when can we expect payment?`)
        : L(`السلام عليكم ${inv.contact_name}، الفاتورة ${inv.invoice_no} بمبلغ ${money(due, "ar")} متأخرة ${od} يوم. نأمل تحديد موعد السداد اليوم لتجنب التصعيد للإدارة المالية.`, `Hello ${inv.contact_name}, invoice ${inv.invoice_no} for ${money(due, "en")} is ${od} days overdue. Please confirm a payment date today to avoid escalation to our finance management.`);
    ctx.tool("fin.send_reminder", { invoice_id: inv.id });
    send({ contact_type: "customer", contact_id: inv.customer_id, contact_name: inv.contact_name, contact_phone: inv.phone, body: msg, step: `${stage}${brokenPromise ? " (broken promise)" : ""} · ${od}d overdue` });
    ctx.taskFor("reminder", ctx.T(`تذكير ${stage === "friendly" ? "ودي" : "حازم"} — ${inv.customer} ${inv.invoice_no}`, `${stage} reminder — ${inv.customer} ${inv.invoice_no}`), "done", "invoice", inv.id);
    log.push(`${inv.invoice_no}: ${od}d → ${L("تذكير", "reminder")} ${stage}${brokenPromise ? " (broken promise)" : ""}`);
  }
  return log;
}
