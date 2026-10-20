import { h, ic, toast, chip, modal } from "../ui.js";
import { t, tt, LANG, ago, fdate, money, nf } from "../i18n.js";
import { rpc, app, navigate, rerender } from "../main.js";
import { agentTag, statusChip, KIND_LABEL } from "./common.js";

const KIND_ICON = { leave_request: "clock", letter: "rep", payment_claim: "card", promise_extension: "clock", legal_notice: "warn" };

function detailOf(a) {
  const d = a.detail || {};
  if (a.kind === "leave_request" && d.from_date) return h("dl", { class: "kv" }, h("dt", {}, t("Employee")), h("dd", {}, `${LANG === "ar" ? d.name_ar : d.name_en} · ${d.department}`), h("dt", {}, t("Dates")), h("dd", {}, `${fdate(d.from_date)} → ${fdate(d.to_date)} (${nf(d.days)} ${t("working days")})`),
    h("dt", {}, t("Type")), h("dd", {}, t(d.type)), h("dt", {}, t("Balance now")), h("dd", {}, `${nf(d.annual_leave_balance)} ${t("days")}`));
  if (a.kind === "letter" && d.body) return h("div", { class: "letter" }, d.body);
  if (d.invoices) return h("div", { class: "col", style: { gap: "4px" } }, ...d.invoices.map(i => h("div", { class: "row small" }, h("code", {}, i.invoice_no), money(i.amount - i.paid_amount), h("span", { class: "xs muted" }, `${t("due")} ${fdate(i.due_date)}`), statusChip(i.status))),
    d.ref ? h("div", { class: "xs muted" }, `${t("Bank reference")}: ${d.ref}`) : null, d.date ? h("div", { class: "xs muted" }, `${t("Requested date")}: ${fdate(d.date)}`) : null);
  return null;
}

export async function approvals(app_, route) {
  const status = route.params.status || "pending";
  const list = await rpc("approvals.list", { status });
  const decide = async (a, st) => {
    const ta = h("textarea", { rows: 3, placeholder: t("Optional note — the AI employee passes it on") });
    modal(st === "approved" ? t("Approve") : t("Reject"), h("div", { class: "col" }, h("p", { class: "small" }, tt(a.title)), ta), [{ label: t("Cancel") }, { label: st === "approved" ? t("Approve") : t("Reject"), cls: st === "approved" ? "primary" : "danger", onClick: async () => {
      try { const r = await rpc("approvals.decide", { id: a.id, status: st, comment: ta.value }); toast(r.notified ? t("Done — the AI employee informed the requester on WhatsApp") : t("Done")); await rerender(); } catch (e) { toast(e.message, true); return false; } } }]);
  };
  return h("div", {},
    h("div", { class: "topbar" }, h("div", {}, h("div", { class: "crumb" }, t("Approvals")), h("h1", {}, t("Decisions that need a human"))),
      h("div", { class: "seg" }, ...["pending", "approved", "rejected", "all"].map(s => h("button", { class: status === s ? "on" : "", onclick: () => navigate(`#/approvals?status=${s}`) }, t(s))))),
    h("p", { class: "muted small", style: { marginBottom: "14px" } }, t("AI employees prepare everything and stop here when a rule says a person must decide. Your decision is applied to the records and sent back to the requester automatically.")),
    list.length ? h("div", { class: "col" }, ...list.map(a => h("div", { class: "card appr" },
      h("div", { class: "hd" }, h("span", { class: "ti" }, ic(KIND_ICON[a.kind] || "hand")), h("div", { style: { minWidth: 0 } }, h("h2", {}, tt(a.title)), h("div", { class: "xs muted" }, `${t(KIND_LABEL[a.kind] || a.kind)} · ${ago(a.created_at)}${a.summary ? " · " + a.summary : ""}`)), h("span", { class: "sp" }), chip(t(a.approver_role), "amber", false), statusChip(a.status)),
      h("div", { class: "bd grid", style: { gridTemplateColumns: "1fr auto", alignItems: "start" } }, h("div", {}, detailOf(a)), agentTag(a)),
      a.status === "pending" ? h("div", { class: "ft" }, a.can_decide ? [h("button", { class: "btn primary", onclick: () => decide(a, "approved") }, ic("check"), t("Approve")), h("button", { class: "btn danger", onclick: () => decide(a, "rejected") }, ic("x"), t("Reject"))]
        : h("span", { class: "xs muted" }, t("Only the {r} (or the owner) can decide this.", { r: t(a.approver_role) })), h("span", { class: "sp" }), a.payload.conversation_id ? h("a", { class: "btn sm ghost", href: `#/conversation/${a.payload.conversation_id}` }, ic("chat"), t("Open conversation")) : null)
        : h("div", { class: "ft xs muted" }, `${t(a.status)} ${t("by")} ${a.decided_by_name || "—"} · ${fdate(a.decided_at, true)}${a.comment ? " · “" + a.comment + "”" : ""}`))))
      : h("div", { class: "card" }, h("div", { class: "empty" }, ic("check"), h("div", {}, t("Nothing waiting — your AI team is handling it.")))));
}
