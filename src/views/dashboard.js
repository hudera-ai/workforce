import { h, ic, lineChart, barChart, chip } from "../ui.js";
import { t, tt, nf, money, ago, LANG } from "../i18n.js";
import { rpc, navigate } from "../main.js";
import { avatar, agentName, ROLE_LABEL, statusChip } from "./common.js";

const KIND = { leave_balance: "Leave balance", leave_request: "Leave request", policy: "Policy question", letter: "HR letter", payday: "Payday", id_expiry: "Iqama renewal", cv_screen: "CV screening", greeting: "Greeting", handoff: "Handed to human", reminder: "Payment reminder", balance: "Statement", promise: "Promise to pay", paid: "Payment claim", invoice_copy: "Invoice copy", dispute: "Dispute", inquiry: "Inquiry", qualify: "Lead qualified", meeting: "Meeting booked", followup: "Follow-up", interview: "Interview booked", leave_status: "Leave status" };
export const kindLabel = k => t(KIND[k] || k);

export async function dashboard(app, route) {
  const days = +(route.params.days || 30);
  const d = await rpc("dashboard.summary", { days });
  const c = d.current, p = d.previous;
  const delta = (a, b, pct) => { if (!b) return null; const v = pct ? a - b : (100 * (a - b)) / b; const up = v >= 0; return h("span", { class: `delta ${up ? "up" : "down"}` }, `${up ? "▲" : "▼"} ${nf(Math.abs(v), 1)}${pct ? " pt" : "%"}`); };
  const stat = (lbl, val, sub, dl) => h("div", { class: "card stat" }, h("div", { class: "lbl" }, lbl), h("div", { class: "val" }, val), h("div", { class: "sub" }, sub, dl ? " " : "", dl));
  const seg = h("div", { class: "seg" }, ...[7, 30, 90].map(n => h("button", { class: days === n ? "on" : "", onclick: () => navigate(`#/dashboard?days=${n}`) }, t("{n} days", { n }))));

  // tasks per day by role
  const roles = [...new Set(d.series.map(s => s.role))];
  const dates = [...new Set(d.series.map(s => s.d))].sort();
  const series = roles.map(r => ({ name: r, points: dates.map(x => ({ x, y: d.series.find(s => s.d === x && s.role === r)?.n || 0 })) }));
  const roleColor = r => d.agents.find(a => a.role === r)?.color;

  return h("div", {},
    h("div", { class: "topbar" }, h("div", {}, h("div", { class: "crumb" }, t("Overview")), h("h1", {}, t("Your AI team at work"))), seg,
      h("a", { class: "btn primary", href: "#/simulator" }, ic("chat"), t("Try it live"))),
    h("div", { class: "grid g4" },
      stat(t("Tasks handled"), nf(c.tasks), t("last {n} days", { n: days }), delta(c.tasks, p.tasks)),
      stat(t("Resolved without a human"), `${nf(c.auto_rate, 1)}%`, t("the rest went to a person"), delta(c.auto_rate, p.auto_rate, true)),
      stat(t("Hours saved"), nf(c.hours_saved, 0), t("≈ {n} full-time employees", { n: nf(c.fte * (30 / days), 2) }), delta(c.hours_saved, p.hours_saved)),
      stat(t("Waiting for you"), nf(d.approvals_pending), h("a", { href: "#/approvals" }, t("Open approvals")))),
    h("div", { class: "grid", style: { gridTemplateColumns: "2fr 1fr", marginTop: "14px" }, "data-r": "stack" },
      h("div", { class: "card" }, h("div", { class: "hd" }, h("h2", {}, t("Tasks per day")), h("span", { class: "sp" }),
        h("div", { class: "legend" }, ...roles.map((r, i) => h("span", {}, h("i", { style: { background: `var(--chart-${(i % 4) + 1})` } }), t(ROLE_LABEL[r]))))),
        h("div", { class: "bd" }, lineChart(series, { height: 190 }))),
      h("div", { class: "card roi" }, h("div", { class: "hd" }, h("h2", {}, t("Value this month"))),
        h("div", { class: "bd col" },
          h("div", { class: "big" }, money(d.value_month)), h("div", { class: "small muted" }, t("work done, priced at {c} per full-time employee per month", { c: money(d.fte_cost) })),
          h("div", { class: "row", style: { justifyContent: "space-between" } }, h("span", { class: "small muted" }, t("Your plan")), h("b", {}, `${d.plan?.name} · ${money(d.plan?.price_month)}`)),
          h("div", { class: "row", style: { justifyContent: "space-between" } }, h("span", { class: "small muted" }, t("Return on plan")), h("b", { class: "ok" }, `${nf(d.roi, 1)}×`)),
          h("div", { class: "row", style: { justifyContent: "space-between" } }, h("span", { class: "small muted" }, t("Handled outside working hours")), h("b", {}, `${nf(d.off_hours_pct, 0)}%`)),
          h("div", { class: "xs faint" }, t("Assumption you can change in Settings. Sample pricing.")))) ),
    h("div", { class: "row", style: { margin: "22px 0 10px" } }, h("h2", {}, t("AI employees")), h("span", { class: "sp" }), h("a", { class: "btn sm", href: "#/agents?hire=1" }, ic("plus"), t("Hire an AI employee"))),
    h("div", { class: "grid g3" }, ...d.agents.map(a => h("div", { class: "card agent-card" },
      h("div", { class: "bd col", style: { gap: "12px" } },
        h("div", { class: "row", style: { flexWrap: "nowrap" } }, avatar(a, 44), h("div", { style: { minWidth: 0 } }, h("h3", {}, agentName(a)), h("div", { class: "xs muted" }, t(ROLE_LABEL[a.role]))), h("span", { class: "sp" }), statusChip(a.status)),
        h("div", { class: "mini3" }, h("div", {}, h("b", {}, nf(a.tasks)), h("span", {}, t("tasks"))), h("div", {}, h("b", {}, `${nf(a.auto_rate, 0)}%`), h("span", {}, t("automated"))), h("div", {}, h("b", {}, nf(a.hours, 0)), h("span", {}, t("hours saved")))),
        a.pending ? h("a", { class: "banner", href: "#/approvals", style: { textDecoration: "none" } }, ic("hand"), t("{n} waiting for approval", { n: a.pending })) : null,
        a.last ? h("div", { class: "xs muted" }, t("Last"), ": ", tt(a.last.title), " · ", ago(a.last.created_at)) : null),
      h("div", { class: "ft" }, h("a", { class: "btn sm primary", href: `#/simulator?agent=${a.id}` }, ic("chat"), t("Talk to {n}", { n: agentName(a) })), h("a", { class: "btn sm", href: `#/agent/${a.id}` }, ic("cog"), t("Configure")))))),
    h("div", { class: "grid g2", style: { marginTop: "14px" } },
      h("div", { class: "card" }, h("div", { class: "hd" }, h("h2", {}, t("What they handle"))), h("div", { class: "bd" }, barChart(d.kinds.map((k, i) => ({ l: kindLabel(k.kind).slice(0, 12), v: k.n, color: `var(--chart-${(i % 3) + 1})` })), { height: 170 }))),
      h("div", { class: "card" }, h("div", { class: "hd" }, h("h2", {}, t("Live activity")), h("span", { class: "sp" }), h("a", { class: "btn ghost sm", href: "#/conversations" }, t("All conversations"))),
        h("div", { class: "feed" }, ...d.recent.map(r => h("div", { class: "fi" }, avatar({ color: r.color, name: r.agent_name, name_ar: r.agent_name_ar }, 26),
          h("div", { style: { minWidth: 0, flex: 1 } }, h("div", { class: "small", style: { color: "var(--ink)" } }, tt(r.title)), h("div", { class: "xs muted" }, `${LANG === "ar" ? r.agent_name_ar : r.agent_name} · ${kindLabel(r.kind)} · ${ago(r.created_at)}`)), statusChip(r.status)))))));
}
