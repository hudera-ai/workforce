import { h, ic, toast, chip, progressBar, barChart } from "../ui.js";
import { t, LANG, money, nf } from "../i18n.js";
import { rpc, app, rerender } from "../main.js";
import { agentName } from "./common.js";

export async function billing() {
  const b = await rpc("billing.summary");
  const pct = Math.min(100, (100 * b.used) / b.included);
  const isOwner = ["owner", "platform"].includes(app.session.user.role);
  return h("div", {},
    h("div", { class: "topbar" }, h("div", {}, h("div", { class: "crumb" }, t("Plan & usage")), h("h1", {}, t("Pay for work done, not for seats"))), chip(t("Sample pricing"), "amber")),
    h("div", { class: "grid g3" },
      h("div", { class: "card stat" }, h("div", { class: "lbl" }, t("Current plan")), h("div", { class: "val" }, b.plan.name), h("div", { class: "sub" }, `${money(b.plan.price_month)} / ${t("month")} · ${b.agents}/${b.plan.max_agents} ${t("AI employees")}`)),
      h("div", { class: "card stat" }, h("div", { class: "lbl" }, t("Tasks this month")), h("div", { class: "val" }, `${nf(b.used)} / ${nf(b.included)}`), h("div", { style: { marginTop: "8px" } }, progressBar(pct, pct > 90 ? "a" : "g")), h("div", { class: "sub" }, t("Projected by month end: {n}", { n: nf(b.projected) }))),
      h("div", { class: "card stat" }, h("div", { class: "lbl" }, t("Estimated invoice")), h("div", { class: "val" }, money(b.estimate)), h("div", { class: "sub" }, b.overage_tasks ? t("includes {n} extra tasks × {p}", { n: nf(b.overage_tasks), p: money(b.plan.overage_per_task) }) : t("within your included tasks")))),
    h("div", { class: "grid g2", style: { marginTop: "14px" } },
      h("div", { class: "card" }, h("div", { class: "hd" }, h("h2", {}, t("Usage by AI employee"))), h("div", { class: "bd col" }, ...b.by_agent.map(a => h("div", { class: "col", style: { gap: "4px" } }, h("div", { class: "row small" }, h("b", {}, agentName(a)), h("span", { class: "sp" }), nf(a.n)), progressBar(b.used ? (100 * a.n) / b.used : 0))))),
      h("div", { class: "card" }, h("div", { class: "hd" }, h("h2", {}, t("Tasks per month"))), h("div", { class: "bd" }, barChart(b.history.map(x => ({ l: x.m.slice(2), v: x.n })), { height: 160 })))),
    h("h2", { style: { margin: "22px 0 10px" } }, t("Plans")),
    h("div", { class: "grid g3" }, ...b.plans.map(p => h("div", { class: `card plan ${p.id === b.plan.id ? "cur" : ""}` }, h("div", { class: "bd col" },
      h("div", { class: "row" }, h("h3", {}, p.name), h("span", { class: "sp" }), p.id === b.plan.id ? chip(t("Current"), "blue") : null),
      h("div", { class: "big" }, money(p.price_month), h("small", {}, ` / ${t("month")}`)),
      h("ul", { class: "small" }, h("li", {}, t("{n} tasks included", { n: nf(p.included_tasks) })), h("li", {}, t("then {p} per task", { p: money(p.overage_per_task) })), h("li", {}, t("up to {n} AI employees", { n: p.max_agents })), h("li", {}, t("WhatsApp, e-mail, web chat & API")), h("li", {}, t("Human approvals, audit log, automations"))),
      isOwner && p.id !== b.plan.id ? h("button", { class: "btn", onclick: async () => { try { await rpc("billing.change_plan", { code: p.code }); toast(t("Plan changed")); rerender(); } catch (e) { toast(e.message, true); } } }, t("Switch to {p}", { p: p.name })) : null)))),
    h("p", { class: "xs faint", style: { marginTop: "12px" } }, t("A task is one unit of finished work: a reply that resolved a request, a reminder sent, a CV screened, a leave request filed. Prices are illustrative for this demo.")));
}
