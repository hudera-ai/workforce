import { h, ic, toast, table, chip } from "../ui.js";
import { t, tt, LANG, ago, fdate, money, nf } from "../i18n.js";
import { rpc, app, navigate, rerender } from "../main.js";
import { avatar, agentName, agentTag, trace, bubbles, statusChip, KIND_LABEL } from "./common.js";

export async function conversations(app_, route) {
  if (route.name === "conversation" && route.id) return detail(route.id);
  const f = { agent_id: route.params.agent || "", status: route.params.status || "", q: route.params.q || "" };
  const list = await rpc("conversations.list", f);
  const go = p => navigate(`#/conversations?${new URLSearchParams({ ...f, ...p }).toString()}`);
  return h("div", {},
    h("div", { class: "topbar" }, h("div", {}, h("div", { class: "crumb" }, t("Conversations")), h("h1", {}, t("Every conversation, with its reasoning")))),
    h("div", { class: "card" }, h("div", { class: "hd", style: { flexWrap: "wrap" } },
      h("select", { style: { width: "auto" }, onchange: e => go({ agent: e.target.value }) }, h("option", { value: "" }, t("All AI employees")), ...app.session.agents.map(a => h("option", { value: a.id, selected: +f.agent_id === a.id }, agentName(a)))),
      h("div", { class: "seg" }, ...[["", "All"], ["open", "open"], ["waiting_human", "waiting_human"], ["resolved", "resolved"]].map(([v, l]) => h("button", { class: f.status === v ? "on" : "", onclick: () => go({ status: v }) }, t(l)))),
      h("span", { class: "sp" }), h("input", { placeholder: t("Search name, number or text"), value: f.q, style: { maxWidth: "260px" }, onchange: e => go({ q: e.target.value }) })),
      table([
        { l: t("Contact"), v: c => h("div", {}, h("b", { class: "small", style: { color: "var(--ink)" } }, c.contact_name), h("div", { class: "xs muted mono" }, c.contact_phone || "")) },
        { l: t("AI employee"), v: c => agentTag({ ...c, name: c.agent_name, name_ar: c.agent_name_ar }) },
        { l: t("Last message"), v: c => h("div", { class: "small muted clamp" }, c.last_body || "") },
        { l: t("Status"), v: c => statusChip(c.status) }, { l: t("When"), v: c => h("span", { class: "xs muted" }, ago(c.last_at)), r: 1 },
      ], list, { onRow: c => navigate(`#/conversation/${c.id}`), empty: t("No conversations match") })));
}

async function detail(id) {
  const c = await rpc("conversations.get", { id });
  let sel = [...c.messages].reverse().find(m => m.direction === "out" && m.trace);
  const tr = h("div", {}); const chat = h("div", { class: "wa-body tall" });
  const draw = () => { chat.replaceChildren(...bubbles(c.messages, { selected: sel?.id, onTrace: m => { sel = m; draw(); } })); tr.replaceChildren(sel ? trace(sel.trace) : h("div", { class: "empty small" }, t("Pick a reply to see how it was decided"))); chat.scrollTop = chat.scrollHeight; };
  const reply = h("textarea", { rows: 2, placeholder: t("Reply as a human colleague…") });
  const act = async (op, msg) => { try { await rpc(op, { id: c.id }); toast(msg); await rerender(); } catch (e) { toast(e.message, true); } };
  setTimeout(draw);
  const agent = { name: c.agent_name, name_ar: c.agent_name_ar, color: c.color, role: c.role };
  return h("div", {},
    h("div", { class: "crumb" }, h("a", { href: "#/conversations" }, t("Conversations")), " / ", c.contact_name),
    h("div", { class: "topbar" }, h("div", {}, h("h1", {}, c.contact_name), h("div", { class: "small muted" }, `${c.contact_phone || ""} · ${t(c.contact_type)} · ${t(c.channel)}`)), h("span", { class: "sp" }), statusChip(c.status),
      c.status !== "waiting_human" ? h("button", { class: "btn", onclick: () => act("conversations.takeover", t("You have the conversation — the AI stays silent")) }, ic("hand"), t("Take over")) : h("button", { class: "btn", onclick: () => act("conversations.handback", t("Handed back to the AI employee")) }, ic("bot"), t("Hand back to AI")),
      c.status !== "resolved" ? h("button", { class: "btn", onclick: () => act("conversations.resolve", t("Marked resolved")) }, ic("check"), t("Resolve")) : null),
    h("div", { class: "conv" },
      h("div", { class: "phone wide" }, h("div", { class: "wa-head" }, avatar(agent, 32), h("div", {}, h("b", {}, agentName(agent)), h("small", {}, t("AI employee")))), chat,
        app.session.user.role !== "viewer" ? h("div", { class: "wa-in" }, reply, h("button", { class: "btn primary", onclick: async () => { if (!reply.value.trim()) return; await rpc("conversations.reply", { id: c.id, text: reply.value }); toast(t("Sent — the AI is paused on this conversation")); await rerender(); } }, ic("send"))) : null),
      h("div", { class: "col" },
        h("div", { class: "card" }, h("div", { class: "hd" }, ic("flow"), h("h2", {}, t("How it decided"))), h("div", { class: "bd" }, tr)),
        c.tasks.length ? h("div", { class: "card" }, h("div", { class: "hd" }, h("h2", {}, t("Tasks from this conversation"))), h("div", { class: "bd col", style: { gap: "6px" } }, ...c.tasks.map(k => h("div", { class: "row small" }, statusChip(k.status), tt(k.title), h("span", { class: "sp" }), h("span", { class: "xs faint" }, `${nf(k.minutes_saved)} ${t("min saved")}`))))) : null,
        c.approvals.length ? h("div", { class: "card" }, h("div", { class: "hd" }, h("h2", {}, t("Approvals"))), h("div", { class: "bd col", style: { gap: "6px" } }, ...c.approvals.map(a => h("a", { class: "row small", href: "#/approvals?status=all", style: { textDecoration: "none" } }, statusChip(a.status), tt(a.title))))) : null)));
}
