import test from "node:test";
import assert from "node:assert/strict";
import { freshDb, as } from "./helpers.js";
import { call, tenantForKey } from "../shared/service.js";

test("tenant isolation: one company can never read another's agents, conversations or data", async () => {
  const dbx = await freshDb(); const masar = await as(dbx, "owner@masar.example");
  await assert.rejects(call(dbx, masar, "agents.get", { id: 1 }), /agent_not_found/);
  const conv = dbx.get("SELECT id FROM conversations WHERE tenant_id=1 LIMIT 1");
  await assert.rejects(call(dbx, masar, "conversations.get", { id: conv.id }), /not_found/);
  const emps = await call(dbx, masar, "data.employees", {}); assert.ok(emps.every(e => e.tenant_id === 2));
});

test("roles: viewers can't change agents; plan limits stop extra hires", async () => {
  const dbx = await freshDb(); const viewer = await as(dbx, "khalid@rawabi.example");
  await assert.rejects(call(dbx, viewer, "agents.update", { id: 1, status: "paused" }), /forbidden|Requires/);
  const masar = await as(dbx, "owner@masar.example"); // Starter = 2 agents, already 2
  await assert.rejects(call(dbx, masar, "agents.hire", { role: "collections", name: "Turki", name_ar: "تركي" }), /plan allows/);
  await call(dbx, masar, "billing.change_plan", { code: "growth" });
  const r = await call(dbx, masar, "agents.hire", { role: "collections", name: "Turki", name_ar: "تركي" }); assert.ok(r.id);
});

test("API keys are shown once, stored hashed, and resolve to their tenant", async () => {
  const dbx = await freshDb(); const owner = await as(dbx, "owner@rawabi.example");
  const k = await call(dbx, owner, "keys.create", { name: "test" });
  assert.match(k.key, /^hw_live_/); assert.ok(!dbx.get("SELECT 1 FROM api_keys WHERE key_hash=?", [k.key]));
  assert.equal(await tenantForKey(dbx, k.key), 1); assert.equal(await tenantForKey(dbx, "hw_live_wrong"), null);
  await call(dbx, owner, "keys.revoke", { id: k.id }); assert.equal(await tenantForKey(dbx, k.key), null);
});

test("automations: condition steps gate the run; logs are stored", async () => {
  const dbx = await freshDb(); const owner = await as(dbx, "owner@rawabi.example");
  const { id } = await call(dbx, owner, "automations.save", { name: "t", trigger: { type: "event", params: { event: "lead.scored" } }, steps: [{ type: "condition", field: "score", op: ">=", value: 60 }, { type: "notify", role: "sales_manager", text: "hot lead" }] });
  await call(dbx, owner, "simulate.send", { agent_id: 3, contact: { type: "lead", name: "Cold", phone: "+9665XX702020" }, text: "hello, what services do you have?" });
  let run = dbx.get("SELECT * FROM automation_runs WHERE automation_id=? ORDER BY id DESC", [id]);
  assert.ok(run); assert.ok(!JSON.parse(run.log).some(l => l.step === "notify"), "cold lead stops at the condition");
  await call(dbx, owner, "simulate.send", { agent_id: 3, contact: { type: "lead", name: "Hot", phone: "+9665XX702021" }, text: "نحتاج عقد نظافة لمبنى 6 أدوار في الرياض هذا الشهر، شركة النخبة" });
  run = dbx.get("SELECT * FROM automation_runs WHERE automation_id=? ORDER BY id DESC", [id]);
  assert.ok(JSON.parse(run.log).some(l => l.step === "notify"));
});

test("dashboard and billing figures are consistent", async () => {
  const dbx = await freshDb(); const owner = await as(dbx, "owner@rawabi.example");
  const d = await call(dbx, owner, "dashboard.summary", { days: 30 });
  assert.ok(d.current.tasks > 0 && d.current.auto_rate > 50 && d.current.auto_rate <= 100);
  assert.equal(d.agents.reduce((a, x) => a + x.tasks, 0), d.current.tasks);
  const b = await call(dbx, owner, "billing.summary", {});
  assert.equal(b.estimate, +(b.plan.price_month + b.overage_tasks * b.plan.overage_per_task).toFixed(2));
  const plat = await as(dbx, "platform@hudera.example");
  const o = await call(dbx, plat, "platform.overview", {}); assert.equal(o.tenants.length, 3);
  await assert.rejects(call(dbx, owner, "platform.overview", {}), /forbidden/);
});
