// Domain service for HUDERA Workforce. Every operation is a plain function (dbx, ctx, args) in OPS,
// so the Node server exposes the same map over RPC and the browser demo calls it directly.
// ctx = { user, as_tenant } — tenant scoping is enforced here, never in the UI.
import { verifyPassword, hashPassword, randomToken } from "./auth.js";
import { handleInbound, runJob, applyDecision, loadAgent, TOOL_CATALOG, ROLE_TEMPLATES } from "./agent/runtime.js";
import { classify } from "./agent/nlu.js";
import { stamp } from "./agent/tools.js";

export class ApiError extends Error { constructor(status, code, message) { super(message || code); this.status = status; this.code = code; } }
const J = (s, d) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };
const iso = d => d.toISOString().slice(0, 10);
const nowDate = () => new Date();
const monthStart = (d = nowDate()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
export const FTE_HOURS_MONTH = 160;              // working hours in one full-time month
export const DEFAULT_FTE_COST = 12000;            // assumed fully-loaded monthly cost of one back-office employee (SAR) — editable per tenant

const MANAGER_OF = { hr: "hr_manager", collections: "finance_manager", sales: "sales_manager" };

function tenantId(ctx) {
  if (!ctx?.user) throw new ApiError(401, "unauthenticated");
  const id = ctx.user.tenant_id ?? ctx.as_tenant;
  if (!id) throw new ApiError(400, "no_tenant", "Choose a tenant workspace first");
  return id;
}
function needRole(ctx, roles) {
  if (!ctx?.user) throw new ApiError(401, "unauthenticated");
  if (ctx.user.role === "owner" || ctx.user.role === "platform") return;
  if (!roles.includes(ctx.user.role)) throw new ApiError(403, "forbidden", `Requires one of: owner, ${roles.join(", ")}`);
}
function canManageAgent(ctx, agent) { needRole(ctx, [MANAGER_OF[agent.role]]); }
function audit(dbx, ctx, action, entity, entity_id, detail) {
  dbx.run("INSERT INTO audit_log (tenant_id,at,user_id,action,entity,entity_id,detail) VALUES (?,?,?,?,?,?,?)",
    [ctx?.user?.tenant_id ?? ctx?.as_tenant ?? null, stamp(nowDate()), ctx?.user?.id ?? null, action, entity, entity_id ?? null, detail ? JSON.stringify(detail).slice(0, 600) : null]);
}
function agentOf(dbx, ctx, id) {
  const a = loadAgent(dbx, +id);
  if (!a || a.tenant_id !== tenantId(ctx)) throw new ApiError(404, "agent_not_found");
  return a;
}
const pub = u => { if (!u) return u; const { password_hash, ...rest } = u; return rest; };

// -------------------------------------------------------------------- metrics
function metrics(dbx, tid, { from, to }) {
  const r = dbx.get(`SELECT COUNT(*) AS tasks, SUM(status='done') AS done, SUM(status='escalated') AS escalated, SUM(status='waiting_approval') AS waiting, SUM(status='failed') AS failed,
    COALESCE(SUM(CASE WHEN status IN ('done','waiting_approval') THEN minutes_saved ELSE 0 END),0) AS minutes FROM tasks WHERE tenant_id=? AND created_at>=? AND created_at<?`, [tid, from, to]);
  const hours = +(r.minutes / 60).toFixed(1);
  return { tasks: r.tasks || 0, done: r.done || 0, escalated: r.escalated || 0, waiting: r.waiting || 0, failed: r.failed || 0, auto_rate: r.tasks ? +(100 * (r.done || 0) / r.tasks).toFixed(1) : 0, hours_saved: hours, fte: +(hours / FTE_HOURS_MONTH).toFixed(2) };
}
function tenantSettings(dbx, tid) { const t = dbx.get("SELECT * FROM tenants WHERE id=?", [tid]); return { ...t, settings: J(t?.settings, {}) }; }

// -------------------------------------------------------------------- operations
export const OPS = {
  // ---------- session
  async "auth.login"(dbx, ctx, { email, password }) {
    const u = dbx.get("SELECT * FROM users WHERE lower(email)=lower(?) AND active=1", [String(email || "").trim()]);
    if (!u || !(await verifyPassword(String(password || ""), u.password_hash))) throw new ApiError(401, "bad_credentials", "Wrong email or password");
    return { token: randomToken(), user: pub(u) };
  },
  "session.info"(dbx, ctx) {
    if (!ctx?.user) throw new ApiError(401, "unauthenticated");
    const tid = ctx.user.tenant_id ?? ctx.as_tenant ?? null;
    const tenant = tid ? dbx.get("SELECT t.*, p.code AS plan_code, p.name AS plan_name, p.max_agents FROM tenants t LEFT JOIN plans p ON p.id=t.plan_id WHERE t.id=?", [tid]) : null;
    const agents = tid ? dbx.all("SELECT id,name,name_ar,role,color,status FROM agents WHERE tenant_id=? ORDER BY id", [tid]) : [];
    const pending = tid ? dbx.all("SELECT approver_role, COUNT(*) n FROM approvals WHERE tenant_id=? AND status='pending' GROUP BY approver_role", [tid]) : [];
    const mine = pending.filter(p => ctx.user.role === "owner" || ctx.user.role === "platform" || p.approver_role === ctx.user.role).reduce((a, p) => a + p.n, 0);
    const human = tid ? dbx.get("SELECT COUNT(*) n FROM conversations WHERE tenant_id=? AND status='waiting_human'", [tid]).n : 0;
    return { user: ctx.user, tenant, agents, counts: { approvals: mine, human } };
  },
  "session.switch_tenant"(dbx, ctx, { tenant_id }) {
    if (ctx?.user?.role !== "platform") throw new ApiError(403, "forbidden");
    ctx.as_tenant = tenant_id ? +tenant_id : null; return { ok: true, tenant_id: ctx.as_tenant };
  },
  "users.list"(dbx, ctx) { return dbx.all("SELECT id,name,email,phone,role,active FROM users WHERE tenant_id=? ORDER BY CASE role WHEN 'owner' THEN 0 ELSE 1 END, name", [tenantId(ctx)]); },

  // ---------- dashboard
  "dashboard.summary"(dbx, ctx, { days = 30 } = {}) {
    const tid = tenantId(ctx); const now = nowDate();
    const from = stamp(new Date(now.getTime() - days * 864e5)), to = stamp(new Date(now.getTime() + 864e5));
    const prevFrom = stamp(new Date(now.getTime() - 2 * days * 864e5));
    const cur = metrics(dbx, tid, { from, to }), prev = metrics(dbx, tid, { from: prevFrom, to: from });
    const t = tenantSettings(dbx, tid); const plan = dbx.get("SELECT * FROM plans WHERE id=?", [t.plan_id]);
    const fteCost = t.settings.fte_cost || DEFAULT_FTE_COST;
    const agents = dbx.all("SELECT * FROM agents WHERE tenant_id=? ORDER BY id", [tid]).map(a => {
      const m = dbx.get(`SELECT COUNT(*) n, SUM(status='done') done, SUM(status='escalated') esc, COALESCE(SUM(CASE WHEN status IN ('done','waiting_approval') THEN minutes_saved END),0) mins FROM tasks WHERE agent_id=? AND created_at>=?`, [a.id, from]);
      const pend = dbx.get("SELECT COUNT(*) n FROM approvals WHERE agent_id=? AND status='pending'", [a.id]).n;
      const last = dbx.get("SELECT title, created_at FROM tasks WHERE agent_id=? ORDER BY created_at DESC LIMIT 1", [a.id]);
      return { id: a.id, name: a.name, name_ar: a.name_ar, role: a.role, color: a.color, status: a.status, tasks: m.n, auto_rate: m.n ? +(100 * m.done / m.n).toFixed(1) : 0, escalated: m.esc || 0, hours: +(m.mins / 60).toFixed(1), pending: pend, last };
    });
    const series = dbx.all(`SELECT substr(t.created_at,1,10) d, a.role, COUNT(*) n FROM tasks t JOIN agents a ON a.id=t.agent_id WHERE t.tenant_id=? AND t.created_at>=? GROUP BY d, a.role ORDER BY d`, [tid, from]);
    const kinds = dbx.all("SELECT kind, COUNT(*) n FROM tasks WHERE tenant_id=? AND created_at>=? GROUP BY kind ORDER BY n DESC LIMIT 8", [tid, from]);
    const recent = dbx.all("SELECT t.*, a.name AS agent_name, a.name_ar AS agent_name_ar, a.color FROM tasks t JOIN agents a ON a.id=t.agent_id WHERE t.tenant_id=? ORDER BY t.created_at DESC, t.id DESC LIMIT 12", [tid]);
    const hours = dbx.all("SELECT CAST(substr(created_at,12,2) AS INTEGER) h, COUNT(*) n FROM tasks WHERE tenant_id=? AND created_at>=? GROUP BY h", [tid, from]);
    const offHours = hours.filter(x => x.h < 8 || x.h >= 17).reduce((a, x) => a + x.n, 0);
    const conv = dbx.get("SELECT COUNT(*) total, SUM(status='waiting_human') human, SUM(status='open') open FROM conversations WHERE tenant_id=?", [tid]);
    const monthUsage = dbx.get("SELECT COUNT(*) n FROM tasks WHERE tenant_id=? AND created_at>=?", [tid, monthStart(now)]).n;
    const value = Math.round(cur.fte * fteCost * (30 / days));
    return { days, current: cur, previous: prev, agents, series, kinds, recent, off_hours_pct: cur.tasks ? +(100 * offHours / cur.tasks).toFixed(1) : 0,
      conversations: conv, approvals_pending: dbx.get("SELECT COUNT(*) n FROM approvals WHERE tenant_id=? AND status='pending'", [tid]).n,
      plan, month_usage: monthUsage, fte_cost: fteCost, value_month: value, roi: plan ? +(value / plan.price_month).toFixed(1) : null };
  },

  // ---------- AI employees
  "agents.templates"() {
    return { templates: Object.entries(ROLE_TEMPLATES).map(([key, t]) => ({ key, ...t })), tools: TOOL_CATALOG };
  },
  "agents.list"(dbx, ctx) {
    const tid = tenantId(ctx);
    return dbx.all("SELECT a.*, u.name AS supervisor_name FROM agents a LEFT JOIN users u ON u.id=a.supervisor_user_id WHERE a.tenant_id=? ORDER BY a.id", [tid]).map(a => ({ ...a, channels: J(a.channels, []), tools: J(a.tools, []), rules: J(a.rules, {}),
      stats: dbx.get("SELECT COUNT(*) tasks, SUM(status='done') done, COALESCE(SUM(minutes_saved),0) mins FROM tasks WHERE agent_id=? AND created_at>=?", [a.id, monthStart()]) }));
  },
  "agents.get"(dbx, ctx, { id }) {
    const a = agentOf(dbx, ctx, id); const tid = a.tenant_id;
    const sup = a.supervisor_user_id ? dbx.get("SELECT id,name,role FROM users WHERE id=?", [a.supervisor_user_id]) : null;
    const docs = dbx.all("SELECT id,title,lang,agent_role,length(body) AS size,updated_at FROM knowledge_docs WHERE tenant_id=? AND (agent_role IS NULL OR agent_role=?) ORDER BY id", [tid, a.role]);
    const kinds = dbx.all("SELECT kind, COUNT(*) n, SUM(status='done') done FROM tasks WHERE agent_id=? AND created_at>=? GROUP BY kind ORDER BY n DESC", [a.id, stamp(new Date(Date.now() - 30 * 864e5))]);
    return { ...a, supervisor: sup, template: ROLE_TEMPLATES[a.role], catalog: Object.fromEntries(Object.entries(TOOL_CATALOG).filter(([, t]) => t.role === a.role || t.role === "*")), docs, kinds,
      users: dbx.all("SELECT id,name,role FROM users WHERE tenant_id=? ORDER BY name", [tid]) };
  },
  "agents.hire"(dbx, ctx, { role, name, name_ar, color, tone = "friendly", channels = ["whatsapp"] }) {
    needRole(ctx, []); const tid = tenantId(ctx);
    const tpl = ROLE_TEMPLATES[role]; if (!tpl) throw new ApiError(400, "validation", "Unknown role template");
    if (!name || !name_ar) throw new ApiError(400, "validation", "Name (EN and AR) is required");
    const plan = dbx.get("SELECT p.* FROM plans p JOIN tenants t ON t.plan_id=p.id WHERE t.id=?", [tid]);
    const n = dbx.get("SELECT COUNT(*) n FROM agents WHERE tenant_id=?", [tid]).n;
    if (plan && n >= plan.max_agents) throw new ApiError(402, "plan_limit", `Your ${plan.name} plan allows ${plan.max_agents} AI employees — upgrade to hire more`);
    const sup = dbx.get("SELECT id FROM users WHERE tenant_id=? AND role=? LIMIT 1", [tid, MANAGER_OF[role]]) || dbx.get("SELECT id FROM users WHERE tenant_id=? AND role='owner' LIMIT 1", [tid]);
    const id = dbx.run("INSERT INTO agents (tenant_id,name,name_ar,role,color,status,channels,tools,rules,tone,supervisor_user_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
      [tid, name.trim(), name_ar.trim(), role, color || "#3D5AFE", "active", JSON.stringify(channels), JSON.stringify(tpl.tools), JSON.stringify(tpl.rules), tone, sup?.id ?? null, stamp(nowDate())]).lastId;
    if (role === "hr" && !dbx.get("SELECT 1 FROM knowledge_docs WHERE tenant_id=? AND agent_role='hr'", [tid])) dbx.run("INSERT INTO knowledge_docs (tenant_id,agent_role,lang,title,body) VALUES (?,?,?,?,?)", [tid, "hr", "en", "HR Policy Handbook (add yours)", "Annual leave\nEmployees are entitled to 21 days of paid annual leave per year."]);
    audit(dbx, ctx, "hire", "agent", id, { role, name });
    return { id };
  },
  "agents.update"(dbx, ctx, { id, ...p }) {
    const a = agentOf(dbx, ctx, id); canManageAgent(ctx, a);
    const allowedTools = Object.entries(TOOL_CATALOG).filter(([, t]) => t.role === a.role || t.role === "*").map(([k]) => k);
    const f = {};
    for (const k of ["name", "name_ar", "color", "tone", "working_hours"]) if (p[k] != null) f[k] = String(p[k]).trim();
    if (p.status) { if (!["active", "paused"].includes(p.status)) throw new ApiError(400, "validation"); f.status = p.status; }
    if (p.tools) f.tools = JSON.stringify(p.tools.filter(t => allowedTools.includes(t)));
    if (p.channels) f.channels = JSON.stringify(p.channels);
    if (p.rules) f.rules = JSON.stringify({ ...J(dbx.get("SELECT rules FROM agents WHERE id=?", [a.id]).rules, {}), ...p.rules });
    if (p.supervisor_user_id != null) f.supervisor_user_id = +p.supervisor_user_id || null;
    if (!Object.keys(f).length) return { ok: true };
    dbx.run(`UPDATE agents SET ${Object.keys(f).map(k => `${k}=?`).join(",")} WHERE id=?`, [...Object.values(f), a.id]);
    audit(dbx, ctx, "update", "agent", a.id, Object.keys(f));
    return { ok: true };
  },
  "agents.run_job"(dbx, ctx, { id, lang = "ar" }) {
    const a = agentOf(dbx, ctx, id); canManageAgent(ctx, a);
    const r = runJob(dbx, { tenant_id: a.tenant_id, agent_id: a.id, now: nowDate(), lang });
    audit(dbx, ctx, "run_job", "agent", a.id, { log: r.log?.length });
    return r;
  },

  // ---------- knowledge
  "knowledge.get"(dbx, ctx, { id }) { const d = dbx.get("SELECT * FROM knowledge_docs WHERE id=? AND tenant_id=?", [+id, tenantId(ctx)]); if (!d) throw new ApiError(404, "not_found"); return d; },
  "knowledge.save"(dbx, ctx, { id, title, body, lang = "ar", agent_role = "hr" }) {
    needRole(ctx, Object.values(MANAGER_OF)); const tid = tenantId(ctx);
    if (!title?.trim() || !body?.trim()) throw new ApiError(400, "validation", "Title and text are required");
    if (id) { dbx.run("UPDATE knowledge_docs SET title=?, body=?, lang=?, updated_at=? WHERE id=? AND tenant_id=?", [title, body, lang, stamp(nowDate()), +id, tid]); audit(dbx, ctx, "update", "knowledge", +id); return { id: +id }; }
    const nid = dbx.run("INSERT INTO knowledge_docs (tenant_id,agent_role,lang,title,body,updated_at) VALUES (?,?,?,?,?,?)", [tid, agent_role, lang, title, body, stamp(nowDate())]).lastId;
    audit(dbx, ctx, "create", "knowledge", nid); return { id: nid };
  },
  "knowledge.remove"(dbx, ctx, { id }) { needRole(ctx, Object.values(MANAGER_OF)); dbx.run("DELETE FROM knowledge_docs WHERE id=? AND tenant_id=?", [+id, tenantId(ctx)]); audit(dbx, ctx, "delete", "knowledge", +id); return { ok: true }; },

  // ---------- simulator / inbound
  "simulate.contacts"(dbx, ctx, { agent_id }) {
    const a = agentOf(dbx, ctx, agent_id); const tid = a.tenant_id;
    if (a.role === "hr") return [
      ...dbx.all("SELECT id, name_en AS name, name_ar, phone, department AS sub, 'employee' AS type FROM employees WHERE tenant_id=? ORDER BY id LIMIT 14", [tid]),
      { id: null, type: "candidate", name: "Ahmed Saleh (job seeker)", name_ar: "أحمد صالح (باحث عن عمل)", phone: "+9665XX999" + String(100 + Math.floor(Math.random() * 800)), sub: "unregistered" }];
    if (a.role === "collections") return dbx.all(`SELECT c.id, c.contact_name || ' · ' || c.name AS name, c.phone, 'customer' AS type,
        (SELECT printf('%.0f', COALESCE(SUM(amount-paid_amount),0)) FROM invoices i WHERE i.customer_id=c.id AND i.status='open') AS sub FROM customers c WHERE c.tenant_id=? ORDER BY c.id`, [tid]);
    const NEW = [["Turki Al-Rashed", "تركي الراشد"], ["Nasser Al-Qahtani", "ناصر القحطاني"], ["Reem Al-Saud", "ريم السعود"], ["Omar Haddad", "عمر حداد"]][Math.floor(Math.random() * 4)];
    return [{ id: null, type: "lead", name: NEW[0], name_ar: `${NEW[1]} (رقم جديد)`, phone: "+9665XX77" + String(1000 + Math.floor(Math.random() * 8000)), sub: "new lead" },
      ...dbx.all("SELECT id, name, phone, 'lead' AS type, stage AS sub FROM leads WHERE tenant_id=? AND phone IS NOT NULL ORDER BY id DESC LIMIT 8", [tid])];
  },
  "simulate.send"(dbx, ctx, { agent_id, contact, text }) {
    const a = agentOf(dbx, ctx, agent_id);
    if (!String(text || "").trim()) throw new ApiError(400, "validation", "Type a message");
    if (!contact?.phone) throw new ApiError(400, "validation", "Pick a contact");
    const r = handleInbound(dbx, { tenant_id: a.tenant_id, agent_id: a.id, contact, text: String(text).slice(0, 2000), channel: contact.channel || "whatsapp", now: nowDate() });
    afterInbound(dbx, a, r);
    return { ...r, messages: OPS["conversations.messages"](dbx, ctx, { id: r.conversation_id }) };
  },
  "simulate.reset"(dbx, ctx, { agent_id, phone }) {
    const a = agentOf(dbx, ctx, agent_id);
    const c = dbx.get("SELECT id FROM conversations WHERE tenant_id=? AND agent_id=? AND contact_phone=? ORDER BY id DESC", [a.tenant_id, a.id, phone]);
    if (c) dbx.run("UPDATE conversations SET state=NULL, status='open' WHERE id=?", [c.id]);
    return { ok: true };
  },
  "classify"(dbx, ctx, { text, role }) { return classify(text, role); },

  // ---------- conversations
  "conversations.list"(dbx, ctx, { agent_id, status, q, limit = 60 } = {}) {
    const tid = tenantId(ctx); const w = ["c.tenant_id=?"], p = [tid];
    if (agent_id) { w.push("c.agent_id=?"); p.push(+agent_id); }
    if (status) { w.push("c.status=?"); p.push(status); }
    if (q) { w.push("(c.contact_name LIKE ? OR c.contact_phone LIKE ? OR EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id=c.id AND m.body LIKE ?))"); p.push(`%${q}%`, `%${q}%`, `%${q}%`); }
    return dbx.all(`SELECT c.id,c.agent_id,c.channel,c.contact_type,c.contact_name,c.contact_phone,c.status,c.last_at, a.name AS agent_name, a.name_ar AS agent_name_ar, a.color, a.role,
      (SELECT body FROM messages m WHERE m.conversation_id=c.id ORDER BY m.id DESC LIMIT 1) AS last_body, (SELECT COUNT(*) FROM messages m WHERE m.conversation_id=c.id) AS n
      FROM conversations c JOIN agents a ON a.id=c.agent_id WHERE ${w.join(" AND ")} ORDER BY c.last_at DESC, c.id DESC LIMIT ?`, [...p, +limit]);
  },
  "conversations.get"(dbx, ctx, { id }) {
    const c = dbx.get("SELECT c.*, a.name AS agent_name, a.name_ar AS agent_name_ar, a.color, a.role FROM conversations c JOIN agents a ON a.id=c.agent_id WHERE c.id=? AND c.tenant_id=?", [+id, tenantId(ctx)]);
    if (!c) throw new ApiError(404, "not_found");
    return { ...c, state: J(c.state, {}), messages: OPS["conversations.messages"](dbx, ctx, { id }),
      tasks: dbx.all("SELECT * FROM tasks WHERE conversation_id=? ORDER BY id", [c.id]), approvals: dbx.all("SELECT * FROM approvals WHERE json_extract(payload,'$.conversation_id')=? ORDER BY id", [c.id]) };
  },
  "conversations.messages"(dbx, ctx, { id }) {
    if (!dbx.get("SELECT 1 FROM conversations WHERE id=? AND tenant_id=?", [+id, tenantId(ctx)])) throw new ApiError(404, "not_found");
    return dbx.all("SELECT * FROM messages WHERE conversation_id=? ORDER BY id", [+id]).map(m => ({ ...m, trace: J(m.trace, null) }));
  },
  "conversations.takeover"(dbx, ctx, { id }) { const c = OPS["conversations.get"](dbx, ctx, { id }); dbx.run("UPDATE conversations SET status='waiting_human' WHERE id=?", [c.id]); audit(dbx, ctx, "takeover", "conversation", c.id); return { ok: true }; },
  "conversations.handback"(dbx, ctx, { id }) { const c = OPS["conversations.get"](dbx, ctx, { id }); dbx.run("UPDATE conversations SET status='open', state=NULL WHERE id=?", [c.id]); audit(dbx, ctx, "handback", "conversation", c.id); return { ok: true }; },
  "conversations.resolve"(dbx, ctx, { id }) { const c = OPS["conversations.get"](dbx, ctx, { id }); dbx.run("UPDATE conversations SET status='resolved' WHERE id=?", [c.id]); return { ok: true }; },
  "conversations.reply"(dbx, ctx, { id, text }) {
    const c = OPS["conversations.get"](dbx, ctx, { id }); if (!String(text || "").trim()) throw new ApiError(400, "validation");
    if (ctx.user.role === "viewer") throw new ApiError(403, "forbidden");
    dbx.run("INSERT INTO messages (conversation_id,direction,author,body,trace,at) VALUES (?,?,?,?,?,?)", [c.id, "out", "human", text, JSON.stringify([{ k: "human", label: ctx.user.name, detail: ctx.user.role }]), stamp(nowDate())]);
    dbx.run("UPDATE conversations SET status='waiting_human', last_at=? WHERE id=?", [stamp(nowDate()), c.id]);
    audit(dbx, ctx, "human_reply", "conversation", c.id); return { ok: true };
  },

  // ---------- approvals
  "approvals.list"(dbx, ctx, { status = "pending" } = {}) {
    const tid = tenantId(ctx);
    return dbx.all(`SELECT ap.*, a.name AS agent_name, a.name_ar AS agent_name_ar, a.color, a.role, u.name AS decided_by_name FROM approvals ap JOIN agents a ON a.id=ap.agent_id LEFT JOIN users u ON u.id=ap.decided_by
      WHERE ap.tenant_id=? ${status === "all" ? "" : "AND ap.status=?"} ORDER BY ap.created_at DESC, ap.id DESC LIMIT 100`, status === "all" ? [tid] : [tid, status])
      .map(x => ({ ...x, payload: J(x.payload, {}), can_decide: x.status === "pending" && (["owner", "platform"].includes(ctx.user.role) || ctx.user.role === x.approver_role), detail: approvalDetail(dbx, x) }));
  },
  "approvals.decide"(dbx, ctx, { id, status, comment }) {
    const ap = dbx.get("SELECT * FROM approvals WHERE id=? AND tenant_id=?", [+id, tenantId(ctx)]);
    if (!ap) throw new ApiError(404, "not_found");
    if (ap.status !== "pending") throw new ApiError(409, "already_decided", "This request was already decided");
    if (!["approved", "rejected"].includes(status)) throw new ApiError(400, "validation");
    if (!["owner", "platform"].includes(ctx.user.role) && ctx.user.role !== ap.approver_role) throw new ApiError(403, "forbidden", `Only the ${ap.approver_role.replace("_", " ")} can decide this`);
    const r = applyDecision(dbx, ap, { status, comment, user_id: ctx.user.id, now: nowDate() });
    audit(dbx, ctx, status, "approval", ap.id, { kind: ap.kind, comment });
    fireEvent(dbx, ap.tenant_id, "approval.decided", { kind: ap.kind, status, approver_role: ap.approver_role });
    return r;
  },

  // ---------- tasks & audit
  "tasks.list"(dbx, ctx, { agent_id, status, kind, limit = 100 } = {}) {
    const w = ["t.tenant_id=?"], p = [tenantId(ctx)];
    if (agent_id) { w.push("t.agent_id=?"); p.push(+agent_id); } if (status) { w.push("t.status=?"); p.push(status); } if (kind) { w.push("t.kind=?"); p.push(kind); }
    return dbx.all(`SELECT t.*, a.name AS agent_name, a.name_ar AS agent_name_ar, a.color FROM tasks t JOIN agents a ON a.id=t.agent_id WHERE ${w.join(" AND ")} ORDER BY t.created_at DESC, t.id DESC LIMIT ?`, [...p, +limit]);
  },
  "audit.list"(dbx, ctx, { limit = 80 } = {}) { return dbx.all("SELECT l.*, u.name AS user_name FROM audit_log l LEFT JOIN users u ON u.id=l.user_id WHERE l.tenant_id=? ORDER BY l.id DESC LIMIT ?", [tenantId(ctx), +limit]); },

  // ---------- automations
  "automations.list"(dbx, ctx) {
    const tid = tenantId(ctx);
    return dbx.all("SELECT * FROM automations WHERE tenant_id=? ORDER BY id", [tid]).map(a => ({ ...a, trigger: J(a.trigger, {}), steps: J(a.steps, []),
      runs: dbx.all("SELECT * FROM automation_runs WHERE automation_id=? ORDER BY id DESC LIMIT 5", [a.id]).map(r => ({ ...r, log: J(r.log, []) })) }));
  },
  "automations.save"(dbx, ctx, { id, name, trigger, steps, enabled = 1 }) {
    needRole(ctx, Object.values(MANAGER_OF)); const tid = tenantId(ctx);
    if (!name?.trim() || !trigger?.type || !Array.isArray(steps) || !steps.length) throw new ApiError(400, "validation", "Name, trigger and at least one step are required");
    if (id) { dbx.run("UPDATE automations SET name=?, trigger=?, steps=?, enabled=? WHERE id=? AND tenant_id=?", [name, JSON.stringify(trigger), JSON.stringify(steps), enabled ? 1 : 0, +id, tid]); audit(dbx, ctx, "update", "automation", +id); return { id: +id }; }
    const nid = dbx.run("INSERT INTO automations (tenant_id,name,enabled,trigger,steps,created_at) VALUES (?,?,?,?,?,?)", [tid, name, enabled ? 1 : 0, JSON.stringify(trigger), JSON.stringify(steps), stamp(nowDate())]).lastId;
    audit(dbx, ctx, "create", "automation", nid); return { id: nid };
  },
  "automations.toggle"(dbx, ctx, { id, enabled }) { needRole(ctx, Object.values(MANAGER_OF)); dbx.run("UPDATE automations SET enabled=? WHERE id=? AND tenant_id=?", [enabled ? 1 : 0, +id, tenantId(ctx)]); return { ok: true }; },
  "automations.remove"(dbx, ctx, { id }) { needRole(ctx, Object.values(MANAGER_OF)); dbx.run("DELETE FROM automations WHERE id=? AND tenant_id=?", [+id, tenantId(ctx)]); audit(dbx, ctx, "delete", "automation", +id); return { ok: true }; },
  "automations.run"(dbx, ctx, { id, lang = "ar" }) {
    const tid = tenantId(ctx);
    const au = dbx.get("SELECT * FROM automations WHERE id=? AND tenant_id=?", [+id, tid]); if (!au) throw new ApiError(404, "not_found");
    const log = runAutomation(dbx, au, { lang, by: ctx.user.name });
    audit(dbx, ctx, "run", "automation", au.id);
    return { log };
  },

  // ---------- company data the agents work on
  "data.employees"(dbx, ctx, { q } = {}) { const tid = tenantId(ctx); return dbx.all(`SELECT e.*, u.name AS manager_name FROM employees e LEFT JOIN users u ON u.id=e.manager_user_id WHERE e.tenant_id=? ${q ? "AND (e.name_en LIKE ? OR e.name_ar LIKE ? OR e.emp_no LIKE ? OR e.phone LIKE ?)" : ""} ORDER BY e.emp_no`, q ? [tid, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`] : [tid]); },
  "data.leave_requests"(dbx, ctx) { return dbx.all("SELECT l.*, e.name_en, e.name_ar, e.emp_no FROM leave_requests l JOIN employees e ON e.id=l.employee_id WHERE l.tenant_id=? ORDER BY l.id DESC", [tenantId(ctx)]); },
  "data.letters"(dbx, ctx) { return dbx.all("SELECT l.*, e.name_en, e.name_ar, e.emp_no FROM letters l JOIN employees e ON e.id=l.employee_id WHERE l.tenant_id=? ORDER BY l.id DESC", [tenantId(ctx)]); },
  "data.jobs"(dbx, ctx) { const tid = tenantId(ctx); return dbx.all("SELECT j.*, (SELECT COUNT(*) FROM candidates c WHERE c.job_id=j.id) AS candidates FROM jobs j WHERE j.tenant_id=? ORDER BY j.id", [tid]).map(j => ({ ...j, requirements: J(j.requirements, {}) })); },
  "data.candidates"(dbx, ctx) { return dbx.all("SELECT c.*, j.title AS job_title FROM candidates c JOIN jobs j ON j.id=c.job_id WHERE c.tenant_id=? ORDER BY c.id DESC", [tenantId(ctx)]).map(c => ({ ...c, breakdown: J(c.breakdown, []) })); },
  "data.customers"(dbx, ctx) {
    return dbx.all(`SELECT c.*, COALESCE(SUM(CASE WHEN i.status='open' THEN i.amount-i.paid_amount END),0) AS outstanding,
      COALESCE(SUM(CASE WHEN i.status='open' AND i.due_date < date('now') THEN i.amount-i.paid_amount END),0) AS overdue, COUNT(i.id) AS invoices
      FROM customers c LEFT JOIN invoices i ON i.customer_id=c.id WHERE c.tenant_id=? GROUP BY c.id ORDER BY overdue DESC`, [tenantId(ctx)]);
  },
  "data.invoices"(dbx, ctx, { status } = {}) { const tid = tenantId(ctx); return dbx.all(`SELECT i.*, c.name AS customer FROM invoices i JOIN customers c ON c.id=i.customer_id WHERE i.tenant_id=? ${status ? "AND i.status=?" : ""} ORDER BY i.due_date`, status ? [tid, status] : [tid]); },
  "data.leads"(dbx, ctx) { return dbx.all("SELECT * FROM leads WHERE tenant_id=? ORDER BY created_at DESC", [tenantId(ctx)]); },
  "data.services"(dbx, ctx) { return dbx.all("SELECT * FROM services_catalog WHERE tenant_id=? ORDER BY id", [tenantId(ctx)]); },
  "data.update_lead"(dbx, ctx, { id, stage }) { needRole(ctx, ["sales_manager"]); dbx.run("UPDATE leads SET stage=? WHERE id=? AND tenant_id=?", [stage, +id, tenantId(ctx)]); audit(dbx, ctx, "update", "lead", +id, { stage }); return { ok: true }; },

  // ---------- developers
  "keys.list"(dbx, ctx) { return dbx.all("SELECT id,name,prefix,created_at,last_used_at,revoked FROM api_keys WHERE tenant_id=? ORDER BY id DESC", [tenantId(ctx)]); },
  async "keys.create"(dbx, ctx, { name }) {
    needRole(ctx, []); const tid = tenantId(ctx);
    const secret = randomToken(18); const key = `hw_live_${secret}`; const prefix = key.slice(0, 12);
    const id = dbx.run("INSERT INTO api_keys (tenant_id,name,prefix,key_hash,created_at) VALUES (?,?,?,?,?)", [tid, String(name || "API key").slice(0, 60), prefix, await hashPassword(key, { iterations: 10_000 }), stamp(nowDate())]).lastId;
    audit(dbx, ctx, "create", "api_key", id, { name });
    return { id, key, prefix };
  },
  "keys.revoke"(dbx, ctx, { id }) { needRole(ctx, []); dbx.run("UPDATE api_keys SET revoked=1 WHERE id=? AND tenant_id=?", [+id, tenantId(ctx)]); audit(dbx, ctx, "revoke", "api_key", +id); return { ok: true }; },

  // ---------- billing
  "billing.summary"(dbx, ctx) {
    const tid = tenantId(ctx); const t = tenantSettings(dbx, tid);
    const plan = dbx.get("SELECT * FROM plans WHERE id=?", [t.plan_id]); const plans = dbx.all("SELECT * FROM plans ORDER BY price_month");
    const now = nowDate(); const ms = monthStart(now);
    const used = dbx.get("SELECT COUNT(*) n FROM tasks WHERE tenant_id=? AND created_at>=?", [tid, ms]).n;
    const byAgent = dbx.all("SELECT a.name, a.name_ar, a.color, COUNT(t.id) n FROM agents a LEFT JOIN tasks t ON t.agent_id=a.id AND t.created_at>=? WHERE a.tenant_id=? GROUP BY a.id ORDER BY n DESC", [ms, tid]);
    const daysIn = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate(); const projected = Math.round(used / Math.max(1, now.getDate()) * daysIn);
    const over = Math.max(0, projected - plan.included_tasks);
    const history = dbx.all("SELECT substr(created_at,1,7) m, COUNT(*) n FROM tasks WHERE tenant_id=? GROUP BY m ORDER BY m", [tid]);
    return { plan, plans, used, included: plan.included_tasks, projected, overage_tasks: over, overage_cost: +(over * plan.overage_per_task).toFixed(2), estimate: +(plan.price_month + over * plan.overage_per_task).toFixed(2), by_agent: byAgent, history,
      agents: dbx.get("SELECT COUNT(*) n FROM agents WHERE tenant_id=?", [tid]).n, sample_pricing: true };
  },
  "billing.change_plan"(dbx, ctx, { code }) {
    needRole(ctx, []); const tid = tenantId(ctx);
    const p = dbx.get("SELECT * FROM plans WHERE code=?", [code]); if (!p) throw new ApiError(400, "validation");
    const n = dbx.get("SELECT COUNT(*) n FROM agents WHERE tenant_id=?", [tid]).n; if (n > p.max_agents) throw new ApiError(409, "plan_limit", `You have ${n} AI employees; ${p.name} allows ${p.max_agents}`);
    dbx.run("UPDATE tenants SET plan_id=? WHERE id=?", [p.id, tid]); audit(dbx, ctx, "change_plan", "tenant", tid, { code }); return { ok: true };
  },
  "settings.save"(dbx, ctx, { fte_cost }) {
    needRole(ctx, []); const tid = tenantId(ctx); const t = tenantSettings(dbx, tid);
    const s = { ...t.settings }; if (fte_cost != null) s.fte_cost = Math.max(1000, +fte_cost || DEFAULT_FTE_COST);
    dbx.run("UPDATE tenants SET settings=? WHERE id=?", [JSON.stringify(s), tid]); return { ok: true };
  },

  // ---------- platform console (HUDERA operators)
  "platform.overview"(dbx, ctx) {
    if (ctx?.user?.role !== "platform") throw new ApiError(403, "forbidden");
    const ms = monthStart();
    const tenants = dbx.all(`SELECT t.*, p.name AS plan_name, p.price_month, p.included_tasks, p.overage_per_task,
      (SELECT COUNT(*) FROM agents a WHERE a.tenant_id=t.id) AS agents, (SELECT COUNT(*) FROM tasks k WHERE k.tenant_id=t.id AND k.created_at>=?) AS tasks_month,
      (SELECT COUNT(*) FROM approvals x WHERE x.tenant_id=t.id AND x.status='pending') AS pending, (SELECT COUNT(*) FROM users u WHERE u.tenant_id=t.id) AS users
      FROM tenants t LEFT JOIN plans p ON p.id=t.plan_id ORDER BY t.id`, [ms]).map(t => ({ ...t, mrr: t.price_month + Math.max(0, t.tasks_month - t.included_tasks) * t.overage_per_task }));
    const byRole = dbx.all("SELECT a.role, COUNT(DISTINCT a.id) agents, COUNT(k.id) tasks FROM agents a LEFT JOIN tasks k ON k.agent_id=a.id AND k.created_at>=? GROUP BY a.role", [ms]);
    const daily = dbx.all("SELECT substr(created_at,1,10) d, COUNT(*) n FROM tasks WHERE created_at>=? GROUP BY d ORDER BY d", [stamp(new Date(Date.now() - 30 * 864e5))]);
    return { tenants, mrr: tenants.reduce((a, t) => a + t.mrr, 0), agents: tenants.reduce((a, t) => a + t.agents, 0), tasks_month: tenants.reduce((a, t) => a + t.tasks_month, 0), by_role: byRole, daily, plans: dbx.all("SELECT * FROM plans ORDER BY price_month") };
  },
};

function approvalDetail(dbx, ap) {
  const p = J(ap.payload, {});
  if (ap.kind === "letter" && p.letter_id) return dbx.get("SELECT body, addressed_to, type FROM letters WHERE id=?", [p.letter_id]);
  if (ap.kind === "leave_request" && p.leave_request_id) return dbx.get(`SELECT l.*, e.name_en, e.name_ar, e.annual_leave_balance, e.department FROM leave_requests l JOIN employees e ON e.id=l.employee_id WHERE l.id=?`, [p.leave_request_id]);
  if (["payment_claim", "promise_extension", "legal_notice"].includes(ap.kind)) {
    const ids = p.invoice_ids || (p.invoice_id ? [p.invoice_id] : []);
    return { invoices: ids.length ? dbx.all(`SELECT invoice_no, amount, paid_amount, due_date, status FROM invoices WHERE id IN (${ids.map(() => "?").join(",")})`, ids) : [], ...p };
  }
  return p;
}

// Automations: trigger → steps. Steps: agent_job (run an AI employee's scheduled work), condition, notify.
const CMP = { ">=": (a, b) => a >= b, "<=": (a, b) => a <= b, ">": (a, b) => a > b, "<": (a, b) => a < b, "=": (a, b) => String(a) === String(b), "!=": (a, b) => String(a) !== String(b) };
export function runAutomation(dbx, au, { lang = "ar", by = "scheduler", data = {} } = {}) {
  const steps = J(au.steps, []); const log = [{ step: "trigger", status: "ok", detail: by }]; const now = nowDate();
  for (const s of steps) {
    if (s.type === "condition") {
      const v = data[s.field]; const pass = v !== undefined ? (CMP[s.op] || CMP["="])(isNaN(+v) ? v : +v, isNaN(+s.value) ? s.value : +s.value) : true;
      log.push({ step: "condition", status: pass ? "ok" : "skipped", detail: `${s.field} ${s.op} ${s.value}${v !== undefined ? ` (= ${v})` : " (no data → pass)"}` });
      if (!pass) break; continue;
    }
    if (s.type === "agent_job") {
      const a = dbx.get("SELECT id, name FROM agents WHERE tenant_id=? AND role=? ORDER BY id LIMIT 1", [au.tenant_id, s.role]);
      if (!a) { log.push({ step: s.type, status: "skipped", detail: `no ${s.role} agent` }); continue; }
      const r = runJob(dbx, { tenant_id: au.tenant_id, agent_id: a.id, now, lang });
      log.push({ step: s.type, status: "ok", detail: `${a.name}: ${(r.log || []).length} item(s)`, items: (r.log || []).slice(0, 20) });
    } else if (s.type === "notify") log.push({ step: "notify", status: "ok", detail: `→ ${s.role}: ${s.text}` });
    else if (s.type === "agent_action") log.push({ step: "agent_action", status: "ok", detail: `${s.role}.${s.action}` });
    else log.push({ step: s.type, status: "skipped", detail: "unknown step" });
  }
  dbx.run("INSERT INTO automation_runs (automation_id,at,status,log) VALUES (?,?,?,?)", [au.id, stamp(now), log.some(l => l.status === "error") ? "error" : "ok", JSON.stringify(log)]);
  dbx.run("UPDATE automations SET runs_count=runs_count+1, last_run_at=? WHERE id=?", [stamp(now), au.id]);
  return log;
}

// Events → automations with an event trigger. A condition step that fails stops the run.
export function fireEvent(dbx, tenant_id, event, data = {}) {
  for (const au of dbx.all("SELECT * FROM automations WHERE tenant_id=? AND enabled=1", [tenant_id])) {
    const tr = J(au.trigger, {}); if (tr.type !== "event" || tr.params?.event !== event) continue;
    runAutomation(dbx, au, { data, by: event });
  }
}
export function afterInbound(dbx, agent, r) {
  if (r.trace?.some(s => s.k === "escalate")) fireEvent(dbx, agent.tenant_id, "conversation.handoff", { role: agent.role });
  const sc = r.trace?.find(s => s.k === "score"); const score = sc ? +(String(sc.detail).match(/^(\d+)\/100/) || [])[1] : NaN;
  if (!isNaN(score)) fireEvent(dbx, agent.tenant_id, agent.role === "hr" ? "candidate.screened" : "lead.scored", { score, role: agent.role });
  if (r.approvals?.length) fireEvent(dbx, agent.tenant_id, "approval.requested", { role: agent.role, count: r.approvals.length });
}

// Public inbound API (server): authenticate an API key → tenant.
export async function tenantForKey(dbx, key) {
  if (!/^hw_live_/.test(key || "")) return null;
  const { verifyPassword: vp } = await import("./auth.js");
  for (const k of dbx.all("SELECT * FROM api_keys WHERE prefix=? AND revoked=0", [key.slice(0, 12)])) if (await vp(key, k.key_hash)) { dbx.run("UPDATE api_keys SET last_used_at=? WHERE id=?", [stamp(nowDate()), k.id]); return k.tenant_id; }
  return null;
}

export async function call(dbx, ctx, op, args = {}) {
  const fn = OPS[op]; if (!fn) throw new ApiError(404, "unknown_op", `Unknown operation ${op}`);
  if (op !== "auth.login" && !ctx?.user) throw new ApiError(401, "unauthenticated");
  return await fn(dbx, ctx, args || {});
}
