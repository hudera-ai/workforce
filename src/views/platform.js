// HUDERA operator console: every tenant, plan, usage and MRR on one page.
import { h, ic, table, chip, lineChart, toast } from "../ui.js";
import { t, LANG, money, nf, fdate } from "../i18n.js";
import { rpc, app, rerender, navigate } from "../main.js";
import { ROLE_LABEL } from "./common.js";

export async function platform() {
  if (app.session.user.role !== "platform") return h("div", { class: "empty" }, t("Platform operators only"));
  const o = await rpc("platform.overview");
  const open = async id => { await rpc("session.switch_tenant", { tenant_id: id }); await rerender(); navigate("#/dashboard"); };
  return h("div", {},
    h("div", { class: "topbar" }, h("div", {}, h("div", { class: "crumb" }, t("Platform console")), h("h1", {}, t("All tenants"))), chip(t("Sample pricing"), "amber")),
    h("div", { class: "grid g4" },
      h("div", { class: "card stat" }, h("div", { class: "lbl" }, t("Tenants")), h("div", { class: "val" }, o.tenants.length)),
      h("div", { class: "card stat" }, h("div", { class: "lbl" }, t("AI employees")), h("div", { class: "val" }, o.agents)),
      h("div", { class: "card stat" }, h("div", { class: "lbl" }, t("Tasks this month")), h("div", { class: "val" }, nf(o.tasks_month))),
      h("div", { class: "card stat" }, h("div", { class: "lbl" }, t("MRR (this month)")), h("div", { class: "val" }, money(o.mrr)))),
    h("div", { class: "card", style: { marginTop: "14px" } }, h("div", { class: "hd" }, h("h2", {}, t("Tenants"))),
      table([{ l: t("Company"), v: x => h("div", {}, h("b", { class: "small" }, LANG === "ar" ? x.name_ar : x.name_en), h("div", { class: "xs muted" }, `${x.industry} · ${x.city} · ${nf(x.employees_count)} ${t("employees")}`)) },
        { l: t("Plan"), v: x => chip(x.plan_name, "blue", false) }, { l: t("AI employees"), v: x => x.agents, r: 1 }, { l: t("Users"), v: x => x.users, r: 1 }, { l: t("Tasks this month"), v: x => `${nf(x.tasks_month)} / ${nf(x.included_tasks)}`, r: 1 },
        { l: t("Pending approvals"), v: x => x.pending, r: 1 }, { l: "MRR", v: x => money(x.mrr), r: 1 }, { l: t("Since"), v: x => fdate(x.created_at) },
        { l: "", v: x => h("button", { class: "btn sm primary", onclick: e => { e.stopPropagation(); open(x.id); } }, t("Open workspace")) }], o.tenants, { onRow: x => open(x.id) })),
    h("div", { class: "grid g2", style: { marginTop: "14px" } },
      h("div", { class: "card" }, h("div", { class: "hd" }, h("h2", {}, t("Tasks per day, all tenants"))), h("div", { class: "bd" }, lineChart([{ name: "tasks", area: true, points: o.daily.map(d => ({ x: d.d, y: d.n })) }], { height: 170 }))),
      h("div", { class: "card" }, h("div", { class: "hd" }, h("h2", {}, t("By role template"))), table([{ l: t("Role"), v: r => t(ROLE_LABEL[r.role] || r.role) }, { l: t("AI employees"), v: r => r.agents, r: 1 }, { l: t("Tasks this month"), v: r => nf(r.tasks), r: 1 }], o.by_role))));
}
