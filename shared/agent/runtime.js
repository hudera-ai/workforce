// Agent runtime: one message in → understanding → tool calls (permission-checked) → rules →
// reply / task / approval, with a step-by-step trace. Same code on the server and in the browser demo.
import { detectLang, normalize, iso } from "./nlu.js";
import { TOOLS, TOOL_CATALOG, ROLE_TEMPLATES, stamp } from "./tools.js";
import { buildIndex, search } from "./kb.js";
import { hr } from "./roles/hr.js";
import { collections, collectionsRun } from "./roles/collections.js";
import { sales, salesFollowups } from "./roles/sales.js";
import { fmtDay, money, LEAVE_LABEL, LETTER_LABEL } from "./format.js";

const HANDLERS = { hr, collections, sales };
class Blocked extends Error { constructor(tool) { super(`tool ${tool} not enabled`); this.tool = tool; } }
const J = (s, d) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };

export function loadAgent(dbx, id) {
  const a = dbx.get("SELECT * FROM agents WHERE id=?", [id]); if (!a) return null;
  return { ...a, channels: J(a.channels, []), tools: J(a.tools, []), rules: { ...ROLE_TEMPLATES[a.role]?.rules, ...J(a.rules, {}) } };
}

function makeCtx(dbx, { tenant, agent, conv, contact, text, now }) {
  const state = J(conv?.state, {}) || {};
  const shortReply = /^\s*(\d|نعم|لا|yes|no|ok|ايوه|تمام)\s*$/i.test(text || "");
  const lang = shortReply && state.lang ? state.lang : detectLang(text || "");
  const ctx = {
    dbx, tenant, agent, conv, contact, text, now, nowStr: stamp(now), lang, rules: agent.rules,
    state, trace: [], replies: [], tasks: [], approvals: [], newState: { ...state, lang },
    L: (ar, en) => (ctx.lang === "ar" ? ar : en),
    T: (ar, en) => JSON.stringify({ ar: arDays(ar), en }),           // bilingual titles for tasks/approvals (shown in the viewer's language)
    step(k, label, detail = "") { ctx.trace.push({ k, label, detail: String(detail ?? "") }); },
    say(t) { ctx.replies.push(t); },
    patchState(p) { ctx.newState = p === null ? { lang: ctx.lang, ...pick(ctx.newState, ["employee_id", "customer_id", "lead_id"]) } : { ...ctx.newState, ...p }; ctx.state = ctx.newState; },
    tool(name, args = {}) {
      if (!agent.tools.includes(name) && name !== "hr.find_employee") { ctx.step("blocked", ctx.L("صلاحية غير مفعلة", "Permission not enabled"), name); throw new Blocked(name); }
      const fn = TOOLS[name]; const r = fn(dbx, ctx, args);
      const brief = summarize(name, r);
      if (name !== "hr.find_employee") ctx.step("tool", name, brief);
      return r;
    },
    kbSearch(query, lang) {
      const docs = dbx.all("SELECT * FROM knowledge_docs WHERE tenant_id=? AND (agent_role IS NULL OR agent_role=?)", [tenant.id, agent.role]);
      return search(buildIndex(docs), query, lang);
    },
    task(kind, title, status = "done", ref_type = null, ref_id = null) {
      const minutes = ROLE_TEMPLATES[agent.role]?.minutes?.[kind] ?? 3;
      const id = dbx.run("INSERT INTO tasks (tenant_id,agent_id,kind,title,status,conversation_id,ref_type,ref_id,minutes_saved,created_at,completed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        [tenant.id, agent.id, kind, title, status, conv?.id ?? null, ref_type, ref_id, minutes, ctx.nowStr, status === "done" ? ctx.nowStr : null]).lastId;
      ctx.tasks.push(id); return id;
    },
    approval({ kind, approver_role, task_id, title, summary, payload }) {
      const id = dbx.run("INSERT INTO approvals (tenant_id,agent_id,task_id,kind,title,summary,payload,approver_role,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
        [tenant.id, agent.id, task_id ?? null, kind, title, summary || null, JSON.stringify({ ...payload, conversation_id: conv?.id, lang: ctx.lang }), approver_role, "pending", ctx.nowStr]).lastId;
      const tl = J(title, null); ctx.step("approval", ctx.L("بانتظار موافقة بشرية", "Waiting for human approval"), `#${id} · ${approver_role} · ${tl ? tl[ctx.lang] || tl.en : title}`);
      ctx.approvals.push(id); return id;
    },
  };
  ctx.taskFor = ctx.task; ctx.approvalFor = ctx.approval;
  return ctx;
}
// Arabic number agreement: 1 يوم → يوم واحد, 2 يوم → يومين, 3–10 يوم → أيام
export const arDays = s => String(s).replace(/(^|[^\d])1 يوم عمل/g, "$1يوم عمل واحد").replace(/(^|[^\d])2 يوم عمل/g, "$1يومي عمل").replace(/(^|[^\d])([12]) أيام/g, (m, p, n) => `${p}${n === "1" ? "يوم واحد" : "يومين"}`).replace(/(^|[^\d])(\d+) يوم/g, (m, p, n) => +n === 1 ? `${p}يوم واحد` : +n === 2 ? `${p}يومين` : +n <= 10 ? `${p}${n} أيام` : m);
const pick = (o, ks) => Object.fromEntries(ks.filter(k => o && o[k] != null).map(k => [k, o[k]]));
function summarize(name, r) {
  if (r == null) return "∅";
  if (name === "hr.leave_balance") return `balance ${r.balance} · pending ${r.pending} · available ${r.available}`;
  if (name === "hr.search_policy") return r.length ? r.map(h => `${h.title} §${h.n} (${h.score})`).join(" · ") : "no match";
  if (name === "fin.customer_balance") return `${r.invoices.length} open · total ${r.total.toLocaleString("en-US")} · overdue ${r.overdue.toLocaleString("en-US")}`;
  if (name === "crm.match_service") return r.length ? r.map(s => s.name_en).join(", ") : "no match";
  if (name === "hr.leave_status") return `${r.length} request(s)`;
  if (Array.isArray(r)) return `${r.length} row(s)`;
  if (r.id) return `#${r.id}`;
  return Object.entries(r).slice(0, 4).map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`).join(" · ");
}

function findConversation(dbx, tenant_id, agent_id, contact, channel, now) {
  let conv = contact.phone ? dbx.get("SELECT * FROM conversations WHERE tenant_id=? AND agent_id=? AND contact_phone=? ORDER BY id DESC", [tenant_id, agent_id, contact.phone]) : null;
  if (!conv) {
    const id = dbx.run("INSERT INTO conversations (tenant_id,agent_id,channel,contact_type,contact_id,contact_name,contact_phone,status,last_at) VALUES (?,?,?,?,?,?,?,?,?)",
      [tenant_id, agent_id, channel, contact.type || "unknown", contact.id || null, contact.name || contact.phone || "Unknown", contact.phone || null, "open", stamp(now)]).lastId;
    conv = dbx.get("SELECT * FROM conversations WHERE id=?", [id]);
  }
  return conv;
}

export function handleInbound(dbx, { tenant_id, agent_id, contact, text, channel = "whatsapp", now = new Date() }) {
  const tenant = dbx.get("SELECT * FROM tenants WHERE id=?", [tenant_id]);
  const agent = loadAgent(dbx, agent_id);
  if (!tenant || !agent || agent.tenant_id !== tenant.id) throw new Error("agent_not_found");
  const conv = findConversation(dbx, tenant.id, agent.id, contact, channel, now);
  const nowStr = stamp(now);
  dbx.run("INSERT INTO messages (conversation_id,direction,author,body,at) VALUES (?,?,?,?,?)", [conv.id, "in", "contact", text, nowStr]);
  const ctx = makeCtx(dbx, { tenant, agent, conv, contact, text, now });
  ctx.step("receive", ctx.L("رسالة واردة", "Message received"), `${channel} · ${contact.name || contact.phone || ""} · ${ctx.lang.toUpperCase()}`);
  if (agent.status === "paused") { ctx.step("rule", ctx.L("الموظف الرقمي متوقف", "AI employee paused"), ctx.L("الرسالة بانتظار رد بشري", "message waits for a human")); dbx.run("UPDATE conversations SET status='waiting_human', last_at=? WHERE id=?", [nowStr, conv.id]); return { conversation_id: conv.id, reply: null, trace: ctx.trace }; }
  if (conv.status === "waiting_human") { ctx.step("rule", ctx.L("المحادثة مع موظف بشري", "A human has this conversation"), ctx.L("الموظف الرقمي لا يرد حتى تُعاد له المحادثة", "the AI stays silent until the conversation is handed back")); dbx.run("UPDATE conversations SET last_at=? WHERE id=?", [nowStr, conv.id]); return { conversation_id: conv.id, reply: null, trace: ctx.trace }; }
  try { HANDLERS[agent.role](ctx); }
  catch (e) {
    if (e instanceof Blocked) {
      ctx.say(ctx.L("هذه العملية غير مفعلة ضمن صلاحياتي حاليًا، حولت طلبك لزميل مختص وبيرد عليك قريبًا.", "That action isn't enabled in my permissions yet — I've passed your request to a colleague who will reply shortly."));
      dbx.run("UPDATE conversations SET status='waiting_human' WHERE id=?", [conv.id]); ctx.step("escalate", ctx.L("تحويل لموظف بشري", "Handed over to a human"), e.tool); ctx.task("handoff", ctx.T(`عملية غير مصرح بها: ${e.tool}`, `Action not permitted: ${e.tool}`), "escalated");
    } else { ctx.step("error", "error", e.message); ctx.say(ctx.L("حصل خطأ بسيط عندي، حولت رسالتك لزميل بشري.", "Something went wrong on my side — I've passed your message to a colleague.")); dbx.run("UPDATE conversations SET status='waiting_human' WHERE id=?", [conv.id]); ctx.task("handoff", "error: " + e.message.slice(0, 60), "failed"); }
  }
  if (ctx.lang === "ar") { ctx.replies = ctx.replies.map(arDays); ctx.trace.forEach(x => { x.label = arDays(x.label); x.detail = arDays(x.detail); }); }
  const reply = ctx.replies.join("\n\n");
  if (reply) { ctx.step("reply", ctx.L("تم إرسال الرد", "Reply sent"), `${channel} · ${reply.length} ${ctx.L("حرف", "chars")}`); }
  const replyAt = stamp(new Date(now.getTime() + 4000));
  if (reply) dbx.run("INSERT INTO messages (conversation_id,direction,author,body,trace,at) VALUES (?,?,?,?,?,?)", [conv.id, "out", "agent", reply, JSON.stringify(ctx.trace), replyAt]);
  dbx.run("UPDATE conversations SET state=?, last_at=?, contact_type=COALESCE(NULLIF(contact_type,'unknown'),?) WHERE id=?", [JSON.stringify(ctx.newState), replyAt, contact.type || "unknown", conv.id]);
  return { conversation_id: conv.id, reply, trace: ctx.trace, tasks: ctx.tasks, approvals: ctx.approvals, lang: ctx.lang };
}

// Outbound message started by the agent (reminders, follow-ups, approval outcomes).
export function sendOutbound(dbx, { tenant_id, agent_id, contact, body, trace, now = new Date(), author = "agent" }) {
  const conv = findConversation(dbx, tenant_id, agent_id, contact, "whatsapp", now);
  dbx.run("INSERT INTO messages (conversation_id,direction,author,body,trace,at) VALUES (?,?,?,?,?,?)", [conv.id, "out", author, body, trace ? JSON.stringify(trace) : null, stamp(now)]);
  dbx.run("UPDATE conversations SET last_at=? WHERE id=?", [stamp(now), conv.id]);
  return conv.id;
}

// Scheduled work: collections cadence, sales follow-ups, iqama watch.
export function runJob(dbx, { tenant_id, agent_id, now = new Date(), lang = "en" }) {
  const tenant = dbx.get("SELECT * FROM tenants WHERE id=?", [tenant_id]); const agent = loadAgent(dbx, agent_id);
  const ctx = makeCtx(dbx, { tenant, agent, conv: null, contact: {}, text: "", now }); ctx.lang = lang;
  const send = ({ contact_type, contact_id, contact_name, contact_phone, body, step }) => {
    const trace = [{ k: "schedule", label: ctx.L("مهمة مجدولة", "Scheduled job"), detail: step }, { k: "reply", label: ctx.L("رسالة استباقية", "Proactive message"), detail: "whatsapp" }];
    sendOutbound(dbx, { tenant_id, agent_id, contact: { type: contact_type, id: contact_id, name: contact_name, phone: contact_phone }, body, trace, now });
  };
  if (agent.status === "paused") return { log: [ctx.L("الموظف الرقمي متوقف", "Agent paused")] };
  let log = [];
  if (agent.role === "collections") log = collectionsRun(ctx, { send });
  else if (agent.role === "sales") log = salesFollowups(ctx, { send });
  else if (agent.role === "hr") {
    const due = TOOLS["hr.id_expiry_scan"](dbx, ctx, { days: agent.rules.id_expiry_warn_days || 60 });
    for (const e of due) {
      const left = Math.round((new Date(e.id_expiry) - new Date(iso(now))) / 864e5);
      const exists = dbx.get("SELECT 1 FROM tasks WHERE tenant_id=? AND kind='id_expiry' AND ref_type='employee' AND ref_id=? AND created_at >= date(?, '-30 day')", [tenant_id, e.id, iso(now)]);
      if (exists) { log.push(`${e.emp_no}: ${ctx.L("تم التنبيه سابقًا", "already alerted")}`); continue; }
      ctx.task("id_expiry", ctx.T(`تجديد إقامة — ${e.name_ar} (${left} يوم)`, `Iqama renewal — ${e.name_en} (${left} days)`), "escalated", "employee", e.id);
      if (e.phone) send({ contact_type: "employee", contact_id: e.id, contact_name: e.name_en, contact_phone: e.phone, body: ctx.L(`مرحبًا ${e.name_ar.split(" ")[0]}، إقامتك تنتهي ${fmtDay(e.id_expiry, "ar")} (بعد ${left} يوم). بدأنا إجراءات التجديد — نرجو تجهيز صورة جواز سفر سارية.`, `Hi ${e.name_en.split(" ")[0]}, your iqama expires on ${fmtDay(e.id_expiry, "en")} (${left} days). We've started the renewal — please have a valid passport copy ready.`), step: `iqama ${left}d` });
      log.push(`${e.emp_no}: ${left}d → ${ctx.L("تنبيه HR + رسالة للموظف", "HR alert + employee message")}`);
    }
  }
  return { log, tasks: ctx.tasks, approvals: ctx.approvals };
}

// What happens after a human approves or rejects.
export function applyDecision(dbx, approval, { status, comment, user_id, now = new Date() }) {
  const p = J(approval.payload, {}); const lang = p.lang || "ar"; const L = (a, e) => (lang === "ar" ? a : e);
  const nowStr = stamp(now); const ok = status === "approved";
  let notify = null; // {contact, body}
  const conv = p.conversation_id ? dbx.get("SELECT * FROM conversations WHERE id=?", [p.conversation_id]) : null;
  const contactOf = () => conv ? { type: conv.contact_type, id: conv.contact_id, name: conv.contact_name, phone: conv.contact_phone } : null;
  switch (approval.kind) {
    case "leave_request": {
      const r = dbx.get("SELECT * FROM leave_requests WHERE id=?", [p.leave_request_id]); if (!r) break;
      dbx.run("UPDATE leave_requests SET status=?, decided_by=?, decided_at=? WHERE id=?", [ok ? "approved" : "rejected", user_id, nowStr, r.id]);
      if (ok && r.type === "annual") dbx.run("UPDATE employees SET annual_leave_balance=annual_leave_balance-? WHERE id=?", [r.days, r.employee_id]);
      if (ok && r.type === "sick") dbx.run("UPDATE employees SET sick_days_used=sick_days_used+? WHERE id=?", [r.days, r.employee_id]);
      notify = { contact: contactOf(), body: ok ? L(`أبشرك ✅ تم اعتماد إجازتك (#${r.id}) من ${fmtDay(r.from_date, "ar")} إلى ${fmtDay(r.to_date, "ar")}. إجازة سعيدة!`, `Good news ✅ Your leave (#${r.id}) from ${fmtDay(r.from_date, "en")} to ${fmtDay(r.to_date, "en")} is approved. Enjoy!`)
        : L(`للأسف لم يتم اعتماد طلب الإجازة (#${r.id})${comment ? ": " + comment : "."} تقدر تقترح تواريخ ثانية.`, `Unfortunately your leave request (#${r.id}) wasn't approved${comment ? ": " + comment : "."} You can propose other dates.`) };
      break;
    }
    case "letter": {
      const l = dbx.get("SELECT l.*, e.email FROM letters l JOIN employees e ON e.id=l.employee_id WHERE l.id=?", [p.letter_id]); if (!l) break;
      const ref = `HR-${iso(now).slice(0, 4)}-${String(l.id).padStart(4, "0")}`;
      dbx.run("UPDATE letters SET status=?, ref_no=?, issued_at=? WHERE id=?", [ok ? "issued" : "rejected", ok ? ref : null, ok ? nowStr : null, l.id]);
      notify = { contact: contactOf(), body: ok ? L(`خطابك جاهز ✅ (${LETTER_LABEL.ar[l.type]}، رقم مرجعي ${ref}). أرسلته موقّعًا على بريدك ${l.email}، وتقدر تستلم النسخة الأصلية من مكتب الموارد البشرية.`, `Your letter is ready ✅ (${LETTER_LABEL.en[l.type]}, ref ${ref}). The signed copy is in your inbox (${l.email}); the original is at the HR office.`)
        : L(`راجع فريق الموارد البشرية طلب الخطاب ولديهم ملاحظة${comment ? ": " + comment : ""}. بيتواصلون معك.`, `HR reviewed your letter request and has a note${comment ? ": " + comment : ""}. They'll contact you.`) };
      break;
    }
    case "payment_claim": {
      if (ok) for (const id of p.invoice_ids || []) dbx.run("UPDATE invoices SET paid_amount=amount, status='paid' WHERE id=?", [id]);
      notify = { contact: contactOf(), body: ok ? L(`تم تأكيد استلام دفعتكم بمبلغ ${money(p.amount, "ar")} ✅ شكرًا لكم، وأرسلنا إيصال الاستلام على البريد.`, `Payment of ${money(p.amount, "en")} confirmed ✅ Thank you — the receipt has been emailed.`)
        : L(`لم نجد التحويل في كشف البنك حتى الآن${comment ? " (" + comment + ")" : ""}. نرجو إرسال صورة إيصال التحويل هنا.`, `We couldn't find the transfer on our bank statement yet${comment ? " (" + comment + ")" : ""}. Please send a photo of the transfer receipt here.`) };
      break;
    }
    case "promise_extension": {
      if (ok) for (const id of p.invoice_ids || []) dbx.run("UPDATE invoices SET promise_date=? WHERE id=?", [p.date, id]);
      notify = { contact: contactOf(), body: ok ? L(`تمت الموافقة على موعد السداد ${fmtDay(p.date, "ar")} ✅ شكرًا لكم.`, `Your payment date of ${fmtDay(p.date, "en")} is approved ✅ Thank you.`)
        : L(`نعتذر، لا نستطيع تمديد السداد إلى ${fmtDay(p.date, "ar")}${comment ? " — " + comment : ""}. هل يمكن السداد خلال 14 يومًا؟`, `Sorry, we can't extend payment to ${fmtDay(p.date, "en")}${comment ? " — " + comment : ""}. Could you settle within 14 days?`) };
      break;
    }
    case "legal_notice": {
      const inv = dbx.get("SELECT i.*, c.contact_name, c.phone, c.name AS customer FROM invoices i JOIN customers c ON c.id=i.customer_id WHERE i.id=?", [p.invoice_id]);
      if (ok && inv) notify = { contact: { type: "customer", id: inv.customer_id, name: inv.contact_name, phone: inv.phone }, body: L(`إشعار رسمي: الفاتورة ${inv.invoice_no} بمبلغ ${money(p.amount, "ar")} متأخرة ${p.days} يوم. نرجو السداد خلال 5 أيام عمل لتجنب إيقاف الخدمة واتخاذ الإجراءات النظامية. للتواصل مع المدير المالي اكتب «موظف».`, `Formal notice: invoice ${inv.invoice_no} for ${money(p.amount, "en")} is ${p.days} days overdue. Please settle within 5 working days to avoid suspension of service and formal action. Type "human" to reach our finance manager.`) };
      if (!ok && inv) dbx.run("UPDATE invoices SET escalated=0 WHERE id=?", [inv.id]);
      break;
    }
  }
  dbx.run("UPDATE approvals SET status=?, decided_by=?, decided_at=?, comment=? WHERE id=?", [status, user_id, nowStr, comment || null, approval.id]);
  if (approval.task_id) dbx.run("UPDATE tasks SET status=?, completed_at=? WHERE id=?", [ok ? "done" : "failed", nowStr, approval.task_id]);
  if (notify?.contact) sendOutbound(dbx, { tenant_id: approval.tenant_id, agent_id: approval.agent_id, contact: notify.contact, body: notify.body, now: new Date(now.getTime() + 2000),
    trace: [{ k: "approval", label: L("قرار بشري", "Human decision"), detail: `#${approval.id} · ${status}${comment ? " · " + comment : ""}` }, { k: "reply", label: L("إبلاغ صاحب الطلب", "Requester notified"), detail: "whatsapp" }] });
  return { notified: !!notify?.contact };
}

export { TOOL_CATALOG, ROLE_TEMPLATES };
