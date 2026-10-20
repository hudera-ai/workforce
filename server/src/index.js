// HUDERA Workforce server: RPC for the console, a public REST API for inbound messages,
// a WhatsApp Cloud API webhook, and a scheduler for automations. Same service code as the browser demo.
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openDb } from "./db.js";
import { call, ApiError, tenantForKey, runAutomation, afterInbound, OPS } from "../../shared/service.js";
import { handleInbound } from "../../shared/agent/runtime.js";
import { llmAnswer, llmEnabled, llmInfo } from "./llm.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, "..", "..");
const PORT = +process.env.PORT || 3000;
const dbx = await openDb();
const app = express();
app.use(express.json({ limit: "1mb" }));
app.disable("x-powered-by");

// ---------- sessions (in memory; put Redis behind this for multi-instance deployments)
const sessions = new Map();
const ctxOf = req => { const tok = (req.headers.authorization || "").replace(/^Bearer\s+/i, ""); return tok && sessions.get(tok) ? sessions.get(tok) : {}; };
const send = (res, e) => { const status = e instanceof ApiError ? e.status : 500; if (status === 500) console.error(e); res.status(status).json({ error: e.code || "server_error", message: e.message }); };

app.get("/api/health", (req, res) => res.json({ ok: true, service: "hudera-workforce", llm: llmInfo() }));
app.post("/api/rpc/auth.login", async (req, res) => { try { const r = await call(dbx, {}, "auth.login", req.body); sessions.set(r.token, { user: r.user }); res.json(r); } catch (e) { send(res, e); } });
app.post("/api/rpc/auth.logout", (req, res) => { sessions.delete((req.headers.authorization || "").replace(/^Bearer\s+/i, "")); res.json({ ok: true }); });
app.post("/api/rpc/:op", async (req, res) => {
  try {
    const ctx = ctxOf(req); let r = await call(dbx, ctx, req.params.op, req.body);
    if (req.params.op === "simulate.send" && llmEnabled()) r = await withLlm(r, { agent_id: req.body.agent_id });
    res.json(r ?? { ok: true });
  } catch (e) { send(res, e); }
});

// ---------- LLM fallback for messages the engine could not classify
async function withLlm(result, { agent_id }) {
  const understood = result.trace?.find(s => s.k === "understand");
  if (!understood || !/^unknown/.test(understood.detail || "")) return result;
  const agent = dbx.get("SELECT * FROM agents WHERE id=?", [agent_id]); const tenant = dbx.get("SELECT * FROM tenants WHERE id=?", [agent.tenant_id]);
  const docs = dbx.all("SELECT title, body FROM knowledge_docs WHERE tenant_id=? AND (agent_role IS NULL OR agent_role=?)", [tenant.id, agent.role]);
  const last = dbx.get("SELECT body FROM messages WHERE conversation_id=? AND direction='in' ORDER BY id DESC LIMIT 1", [result.conversation_id]);
  const ans = await llmAnswer({ agent, tenant, lang: result.lang, docs, text: last.body });
  if (!ans || ans === "HANDOFF") return result;
  const msg = dbx.get("SELECT id, trace FROM messages WHERE conversation_id=? AND direction='out' ORDER BY id DESC LIMIT 1", [result.conversation_id]);
  const trace = [...JSON.parse(msg.trace || "[]").filter(s => s.k !== "reply"), { k: "llm", label: "LLM answer from company documents", detail: llmInfo().model }, { k: "reply", label: "Reply sent", detail: `${ans.length} chars` }];
  dbx.run("UPDATE messages SET body=?, trace=? WHERE id=?", [ans, JSON.stringify(trace), msg.id]);
  return { ...result, reply: ans, trace };
}

// ---------- public API (API key) — plug any channel or system into an AI employee
// POST /api/v1/agents/:id/messages  { from: "+9665…", name: "…", text: "…", channel?: "web_chat" }
app.post("/api/v1/agents/:id/messages", async (req, res) => {
  try {
    const tid = await tenantForKey(dbx, req.headers["x-api-key"]); if (!tid) throw new ApiError(401, "invalid_api_key");
    const agent = dbx.get("SELECT * FROM agents WHERE id=? AND tenant_id=?", [+req.params.id, tid]); if (!agent) throw new ApiError(404, "agent_not_found");
    const { from, name, text, channel = "api" } = req.body || {}; if (!from || !text) throw new ApiError(400, "validation", "from and text are required");
    const emp = dbx.get("SELECT id, name_en FROM employees WHERE tenant_id=? AND phone=?", [tid, from]); const cus = dbx.get("SELECT id, contact_name FROM customers WHERE tenant_id=? AND phone=?", [tid, from]);
    const contact = emp ? { type: "employee", id: emp.id, name: emp.name_en, phone: from } : cus ? { type: "customer", id: cus.id, name: cus.contact_name, phone: from } : { type: agent.role === "sales" ? "lead" : "unknown", name: name || from, phone: from };
    let r = handleInbound(dbx, { tenant_id: tid, agent_id: agent.id, contact, text: String(text).slice(0, 2000), channel }); afterInbound(dbx, agent, r);
    if (llmEnabled()) r = await withLlm(r, { agent_id: agent.id });
    res.json({ conversation_id: r.conversation_id, reply: r.reply, trace: r.trace, approvals: r.approvals, tasks: r.tasks });
  } catch (e) { send(res, e); }
});
app.get("/api/v1/approvals", async (req, res) => {
  try { const tid = await tenantForKey(dbx, req.headers["x-api-key"]); if (!tid) throw new ApiError(401, "invalid_api_key");
    res.json(dbx.all("SELECT id, agent_id, kind, title, summary, approver_role, status, created_at FROM approvals WHERE tenant_id=? AND status='pending' ORDER BY id DESC", [tid])); } catch (e) { send(res, e); }
});

// ---------- WhatsApp Cloud API webhook: /webhooks/whatsapp/:agentId
// Set WHATSAPP_VERIFY_TOKEN, WHATSAPP_TOKEN and WHATSAPP_PHONE_ID to go live; without them replies are only logged.
app.get("/webhooks/whatsapp/:agentId", (req, res) => {
  if (req.query["hub.mode"] === "subscribe" && req.query["hub.verify_token"] === process.env.WHATSAPP_VERIFY_TOKEN) return res.send(req.query["hub.challenge"]);
  res.sendStatus(403);
});
app.post("/webhooks/whatsapp/:agentId", async (req, res) => {
  res.sendStatus(200);
  try {
    const agent = dbx.get("SELECT * FROM agents WHERE id=?", [+req.params.agentId]); if (!agent) return;
    for (const entry of req.body?.entry || []) for (const ch of entry.changes || []) for (const m of ch.value?.messages || []) {
      if (m.type !== "text") continue;
      const from = "+" + m.from; const name = ch.value.contacts?.[0]?.profile?.name;
      const emp = dbx.get("SELECT id, name_en FROM employees WHERE tenant_id=? AND phone=?", [agent.tenant_id, from]);
      const contact = emp ? { type: "employee", id: emp.id, name: emp.name_en, phone: from } : { type: agent.role === "sales" ? "lead" : "unknown", name: name || from, phone: from };
      let r = handleInbound(dbx, { tenant_id: agent.tenant_id, agent_id: agent.id, contact, text: m.text.body, channel: "whatsapp" }); afterInbound(dbx, agent, r);
      if (llmEnabled()) r = await withLlm(r, { agent_id: agent.id });
      if (r.reply) await whatsappSend(m.from, r.reply);
    }
  } catch (e) { console.error("[whatsapp]", e); }
});
async function whatsappSend(to, body) {
  if (!process.env.WHATSAPP_TOKEN || !process.env.WHATSAPP_PHONE_ID) { console.log(`[whatsapp:dry-run] → ${to}: ${body.slice(0, 120)}`); return; }
  await fetch(`https://graph.facebook.com/v20.0/${process.env.WHATSAPP_PHONE_ID}/messages`, { method: "POST", headers: { authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body } }) });
}

// ---------- scheduler: runs enabled schedule-triggered automations at their time (server local time)
const DAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const inDays = (spec, d) => { if (!spec) return true; const [a, b] = spec.split("-"); if (!b) return DAYS[a] === d; let i = DAYS[a]; for (let k = 0; k < 7; k++) { if (i === d) return true; if (i === DAYS[b]) break; i = (i + 1) % 7; } return false; };
setInterval(() => {
  const now = new Date(); const hm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  for (const au of dbx.all("SELECT * FROM automations WHERE enabled=1")) {
    const tr = JSON.parse(au.trigger || "{}");
    if (tr.type === "schedule" && tr.params?.time === hm && inDays(tr.params.days, now.getDay())) { try { runAutomation(dbx, au, { by: "scheduler" }); console.log(`[scheduler] ran #${au.id} ${au.name}`); } catch (e) { console.error("[scheduler]", e.message); } }
  }
}, 60_000);

// ---------- static app
app.use(express.static(ROOT, { index: "index.html", extensions: ["html"] }));
app.get("/{*path}", (req, res) => res.sendFile(path.join(ROOT, "index.html")));
app.listen(PORT, () => console.log(`HUDERA Workforce on http://localhost:${PORT}  (LLM: ${llmInfo() ? llmInfo().provider : "off — built-in engine only"}, ops: ${Object.keys(OPS).length})`));
