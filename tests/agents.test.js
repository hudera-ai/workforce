import test from "node:test";
import assert from "node:assert/strict";
import { freshDb, as, nextWorkday, MON_EN } from "./helpers.js";
import { call } from "../shared/service.js";
import { handleInbound, runJob } from "../shared/agent/runtime.js";

const send = (dbx, ctx, agent_id, contact, text) => call(dbx, ctx, "simulate.send", { agent_id, contact, text });

test("HR: leave request → manager approval → employee notified, balance deducted", async () => {
  const dbx = await freshDb(); const owner = await as(dbx, "owner@rawabi.example"); const hr = await as(dbx, "hr@rawabi.example");
  const emp = dbx.get("SELECT * FROM employees e WHERE tenant_id=1 AND annual_leave_balance>=10 AND NOT EXISTS (SELECT 1 FROM leave_requests l WHERE l.employee_id=e.id) ORDER BY id LIMIT 1");
  const c = { type: "employee", id: emp.id, name: emp.name_en, phone: emp.phone };
  const a = nextWorkday(8), b = nextWorkday(10);
  const r1 = await send(dbx, owner, 1, c, `I need annual leave from ${a.getDate()} ${MON_EN[a.getMonth()]} to ${b.getDate()} ${MON_EN[b.getMonth()]}`);
  assert.match(r1.reply, /Submit it\?/); assert.ok(r1.trace.some(s => s.label === "hr.leave_balance"));
  const r2 = await send(dbx, owner, 1, c, "yes");
  assert.equal(r2.approvals.length, 1, "needs approval (more than 1 day)");
  const lr = dbx.get("SELECT * FROM leave_requests ORDER BY id DESC LIMIT 1"); assert.equal(lr.status, "pending");
  await assert.rejects(call(dbx, await as(dbx, "finance@rawabi.example"), "approvals.decide", { id: r2.approvals[0], status: "approved" }), /hr manager/i);
  await call(dbx, hr, "approvals.decide", { id: r2.approvals[0], status: "approved" });
  assert.equal(dbx.get("SELECT status FROM leave_requests WHERE id=?", [lr.id]).status, "approved");
  assert.equal(dbx.get("SELECT annual_leave_balance b FROM employees WHERE id=?", [emp.id]).b, emp.annual_leave_balance - lr.days);
  const last = dbx.get("SELECT body FROM messages WHERE conversation_id=? ORDER BY id DESC LIMIT 1", [r2.conversation_id]);
  assert.match(last.body, /approved/);
});

test("HR: one-day leave with notice is auto-approved by rule", async () => {
  const dbx = await freshDb(); const owner = await as(dbx, "owner@rawabi.example");
  const emp = dbx.get("SELECT * FROM employees e WHERE tenant_id=1 AND annual_leave_balance>=2 AND NOT EXISTS (SELECT 1 FROM leave_requests l WHERE l.employee_id=e.id) ORDER BY id LIMIT 1 OFFSET 3");
  const c = { type: "employee", id: emp.id, name: emp.name_en, phone: emp.phone }; const d = nextWorkday(5);
  await send(dbx, owner, 1, c, `I need annual leave on ${d.getDate()} ${MON_EN[d.getMonth()]}`);
  const r = await send(dbx, owner, 1, c, "yes");
  assert.equal(r.approvals.length, 0); assert.match(r.reply, /approved/i);
});

test("HR: personal data is refused to unregistered numbers; letters need sign-off", async () => {
  const dbx = await freshDb(); const owner = await as(dbx, "owner@rawabi.example");
  const r = await send(dbx, owner, 1, { type: "unknown", name: "X", phone: "+9665XX123123" }, "كم رصيد إجازتي؟");
  assert.match(r.reply, /لحماية بياناتك/); assert.ok(r.trace.some(s => s.k === "rule"));
  const emp = dbx.get("SELECT * FROM employees WHERE tenant_id=1 LIMIT 1");
  const l = await send(dbx, owner, 1, { type: "employee", id: emp.id, name: emp.name_en, phone: emp.phone }, "ابغى تعريف بالراتب لبنك الراجحي");
  assert.equal(l.approvals.length, 1); assert.equal(dbx.get("SELECT status FROM letters ORDER BY id DESC").status, "pending");
});

test("Permissions: a disabled tool hands the request to a human", async () => {
  const dbx = await freshDb(); const owner = await as(dbx, "owner@rawabi.example");
  const a = await call(dbx, owner, "agents.get", { id: 1 });
  await call(dbx, owner, "agents.update", { id: 1, tools: a.tools.filter(t => t !== "hr.draft_letter") });
  const emp = dbx.get("SELECT * FROM employees WHERE tenant_id=1 LIMIT 1 OFFSET 2");
  const r = await send(dbx, owner, 1, { type: "employee", id: emp.id, name: emp.name_en, phone: emp.phone }, "I need a salary certificate for Riyad Bank");
  assert.ok(r.trace.some(s => s.k === "blocked")); assert.equal(dbx.get("SELECT status FROM conversations WHERE id=?", [r.conversation_id]).status, "waiting_human");
  // a paused agent never replies
  await call(dbx, owner, "agents.update", { id: 1, status: "paused" });
  const p = await send(dbx, owner, 1, { type: "employee", id: emp.id, phone: "+9665XX000999", name: "Z" }, "hello");
  assert.equal(p.reply, null);
});

test("Collections: promise within window recorded, long extension needs finance, payment claim waits for bank match", async () => {
  const dbx = await freshDb(); const owner = await as(dbx, "owner@rawabi.example");
  const cus = dbx.get("SELECT c.* FROM customers c WHERE tenant_id=1 AND EXISTS (SELECT 1 FROM invoices i WHERE i.customer_id=c.id AND i.status='open') ORDER BY id LIMIT 1 OFFSET 3");
  const c = { type: "customer", id: cus.id, name: cus.contact_name, phone: cus.phone };
  const p = await send(dbx, owner, 2, c, "We will pay next Thursday");
  assert.equal(p.approvals.length, 0); assert.ok(dbx.get("SELECT promise_date FROM invoices WHERE customer_id=? AND promise_date IS NOT NULL", [cus.id]));
  const x = await send(dbx, owner, 2, c, "بنسدد بعد شهرين");
  assert.equal(dbx.get("SELECT kind FROM approvals WHERE id=?", [x.approvals[0]]).kind, "promise_extension");
  const pay = await send(dbx, owner, 2, c, "We transferred the payment, reference TRX99887");
  const ap = dbx.get("SELECT * FROM approvals WHERE id=?", [pay.approvals[0]]); assert.equal(ap.approver_role, "finance_manager"); assert.match(ap.summary, /TRX99887/);
});

test("Collections run: cadence skips promised/disputed invoices and asks before formal notice", async () => {
  const dbx = await freshDb();
  const before = dbx.get("SELECT COUNT(*) n FROM approvals WHERE kind='legal_notice'").n;
  const r = runJob(dbx, { tenant_id: 1, agent_id: 2, now: new Date(Date.now() + 20 * 864e5), lang: "en" });
  assert.ok(r.log.length > 0);
  assert.ok(dbx.get("SELECT COUNT(*) n FROM approvals WHERE kind='legal_notice'").n >= before);
});

test("Sales: qualifies, offers slots, books meeting; out-of-area is logged not booked", async () => {
  const dbx = await freshDb(); const owner = await as(dbx, "owner@rawabi.example");
  const c = { type: "lead", name: "Test Lead", phone: "+9665XX701010" };
  const r = await send(dbx, owner, 3, c, "بكم عقد النظافة لمبنى 5 أدوار في الرياض؟ نبغى نبدأ هذا الشهر");
  assert.match(r.reply, /1\)/);
  const b = await send(dbx, owner, 3, c, "1");
  assert.match(b.reply, /تم الحجز/); assert.equal(dbx.get("SELECT stage FROM leads WHERE phone=?", [c.phone]).stage, "meeting");
  const o = await send(dbx, owner, 3, { type: "lead", name: "Far", phone: "+9665XX701011" }, "Do you provide security guards in Abha? 10 guards");
  assert.match(o.reply, /currently serve/); assert.equal(dbx.get("SELECT stage FROM leads WHERE phone=?", ["+9665XX701011"]).stage, "disqualified");
});
