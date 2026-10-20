import { h, ic, table, modal, toast, chip } from "../ui.js";
import { t, LANG, fdate, ago } from "../i18n.js";
import { rpc, app, rerender } from "../main.js";
import { agentName } from "./common.js";

const code = s => h("pre", { class: "code" }, h("button", { class: "btn sm ghost cp", onclick: () => { navigator.clipboard?.writeText(s); toast(t("Copied")); } }, ic("copy")), s);

export async function developers() {
  const keys = await rpc("keys.list");
  const base = app.api.mode === "http" ? location.origin : "https://workforce.your-domain.com";
  const ag = app.session.agents[0];
  return h("div", {},
    h("div", { class: "topbar" }, h("div", {}, h("div", { class: "crumb" }, t("Developers & API")), h("h1", {}, t("Plug AI employees into your systems"))),
      h("button", { class: "btn primary", onclick: () => {
        const nm = h("input", { value: "ERP integration" });
        modal(t("Create API key"), h("label", { class: "f" }, h("span", {}, t("Key name")), nm), [{ label: t("Cancel") }, { label: t("Create"), cls: "primary", onClick: async () => {
          try { const r = await rpc("keys.create", { name: nm.value }); setTimeout(() => modal(t("Your new API key"), h("div", { class: "col" }, h("div", { class: "banner" }, ic("warn"), t("Copy it now — it is stored hashed and won't be shown again.")), code(r.key)), [{ label: t("Done"), cls: "primary", onClick: () => rerender() }])); } catch (e) { toast(e.message, true); return false; } } }]);
      } }, ic("key"), t("Create API key"))),
    h("div", { class: "grid g2" },
      h("div", { class: "card" }, h("div", { class: "hd" }, h("h2", {}, t("API keys"))),
        table([{ l: t("Name"), v: k => h("b", { class: "small" }, k.name) }, { l: t("Key"), v: k => h("code", { class: "xs" }, k.prefix + "…") }, { l: t("Created"), v: k => fdate(k.created_at) }, { l: t("Last used"), v: k => k.last_used_at ? ago(k.last_used_at) : "—" },
          { l: "", v: k => k.revoked ? chip(t("revoked"), "grey") : h("button", { class: "btn sm ghost", onclick: async () => { await rpc("keys.revoke", { id: k.id }); toast(t("Revoked")); rerender(); } }, t("Revoke")) }], keys)),
      h("div", { class: "card" }, h("div", { class: "hd" }, h("h2", {}, t("AI employee IDs"))), h("div", { class: "bd col", style: { gap: "6px" } }, ...app.session.agents.map(a => h("div", { class: "row small" }, h("code", {}, `#${a.id}`), agentName(a), h("span", { class: "xs muted" }, a.role)))))),
    h("div", { class: "card", style: { marginTop: "14px" } }, h("div", { class: "hd" }, h("h2", {}, t("Send a message to an AI employee")), h("span", { class: "sp" }), chip("REST", "blue", false)),
      h("div", { class: "bd col" }, h("p", { class: "small muted" }, t("Use this from your website chat, mobile app, ERP or any channel. The response contains the reply and the full decision trace.")),
        code(`curl -X POST ${base}/api/v1/agents/${ag?.id || 1}/messages \\\n  -H "x-api-key: hw_live_…" -H "content-type: application/json" \\\n  -d '{"from":"+9665XXXXXXXX","name":"Sara","text":"كم رصيد إجازتي؟","channel":"web_chat"}'`),
        code(`{\n  "conversation_id": 42,\n  "reply": "رصيد إجازتك السنوية: 14 يوم ...",\n  "trace": [ {"k":"identify","label":"Identified sender"}, {"k":"tool","label":"hr.leave_balance"}, ... ],\n  "approvals": [], "tasks": [311]\n}`))),
    h("div", { class: "grid g2", style: { marginTop: "14px" } },
      h("div", { class: "card" }, h("div", { class: "hd" }, h("h2", {}, t("WhatsApp Business (Cloud API)"))), h("div", { class: "bd col" },
        h("p", { class: "small muted" }, t("Point your Meta app's webhook to this URL. Set WHATSAPP_VERIFY_TOKEN, WHATSAPP_TOKEN and WHATSAPP_PHONE_ID on the server — without them replies are logged, not sent.")),
        code(`${base}/webhooks/whatsapp/${ag?.id || 1}`))),
      h("div", { class: "card" }, h("div", { class: "hd" }, h("h2", {}, t("Pending approvals feed"))), h("div", { class: "bd col" },
        h("p", { class: "small muted" }, t("Pull pending approvals into your own tools (Teams, Slack, ERP).")),
        code(`curl ${base}/api/v1/approvals -H "x-api-key: hw_live_…"`)))),
    h("div", { class: "card", style: { marginTop: "14px" } }, h("div", { class: "hd" }, ic("bot"), h("h2", {}, t("The AI engine"))), h("div", { class: "bd small col" },
      h("p", {}, t("Structured work — recognising the sender, reading balances and invoices, applying your rules, creating requests and approvals — runs on a deterministic built-in engine (Arabic + English understanding, dates, amounts, CV scoring, policy search). It is predictable and fully traceable.")),
      h("p", {}, t("Optionally, set ANTHROPIC_API_KEY or OPENAI_API_KEY on the server: free-text questions the engine can't classify are then answered by the LLM strictly from your own documents, or handed to a human.")),
      h("p", { class: "muted" }, t("This page is running in {m} mode.", { m: app.api.mode === "http" ? t("server") : t("in-browser demo") })))));
}
