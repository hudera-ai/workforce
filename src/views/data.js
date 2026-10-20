// The company data AI employees read and write — the same records a human team would use.
import { h, ic, table, chip, modal, toast } from "../ui.js";
import { t, LANG, fdate, money, nf } from "../i18n.js";
import { rpc, app, navigate, rerender } from "../main.js";
import { statusChip } from "./common.js";

const TABS = [["employees", "Employees", "hr"], ["leave", "Leave requests", "hr"], ["letters", "HR letters", "hr"], ["hiring", "Jobs & candidates", "hr"], ["customers", "Customers & invoices", "collections"], ["leads", "Leads", "sales"], ["services", "Services & prices", "sales"]];

export async function data(app_, route) {
  const roles = new Set(app.session.agents.map(a => a.role));
  const tabs = TABS.filter(x => roles.has(x[2]));
  const tab = tabs.find(x => x[0] === route.params.tab)?.[0] || tabs[0]?.[0];
  const q = route.params.q || "";
  let content;
  const nm = r => (LANG === "ar" ? r.name_ar : r.name_en);
  if (tab === "employees") {
    const rows = await rpc("data.employees", { q });
    content = h("div", { class: "card" }, h("div", { class: "hd" }, h("input", { placeholder: t("Search name, number or phone"), value: q, style: { maxWidth: "300px" }, onchange: e => navigate(`#/data?tab=employees&q=${encodeURIComponent(e.target.value)}`) }), h("span", { class: "sp" }), h("span", { class: "xs muted" }, `${rows.length} ${t("employees")}`)),
      table([{ l: "#", v: r => h("code", { class: "xs" }, r.emp_no) }, { l: t("Name"), v: r => h("b", { class: "small" }, nm(r)) }, { l: t("Department"), v: r => h("span", { class: "small" }, `${r.department} · ${r.title}`) }, { l: t("Mobile"), v: r => h("span", { class: "mono xs" }, r.phone) },
        { l: t("Annual leave"), v: r => `${nf(r.annual_leave_balance)} ${t("days")}`, r: 1 }, { l: t("Iqama expiry"), v: r => r.id_expiry ? h("span", { class: daysTo(r.id_expiry) < 60 ? "warn-t" : "" }, fdate(r.id_expiry)) : h("span", { class: "faint" }, t("Saudi national")) },
        { l: "", v: r => h("a", { class: "btn sm ghost", href: `#/simulator?agent=${agentId("hr")}&phone=${encodeURIComponent(r.phone)}`, title: t("Message the HR AI as this employee") }, ic("chat")) }], rows));
  } else if (tab === "leave") {
    const rows = await rpc("data.leave_requests");
    content = h("div", { class: "card" }, table([{ l: "#", v: r => r.id }, { l: t("Employee"), v: r => nm(r) }, { l: t("Type"), v: r => t(r.type) }, { l: t("Dates"), v: r => `${fdate(r.from_date)} → ${fdate(r.to_date)}` }, { l: t("Days"), v: r => nf(r.days), r: 1 }, { l: t("Source"), v: r => chip(r.source === "agent" ? t("AI employee") : r.source, "violet", false) }, { l: t("Status"), v: r => statusChip(r.status) }], rows, { empty: t("No leave requests yet — try one in the simulator") }));
  } else if (tab === "letters") {
    const rows = await rpc("data.letters");
    content = h("div", { class: "card" }, table([{ l: t("Ref"), v: r => r.ref_no ? h("code", {}, r.ref_no) : "—" }, { l: t("Employee"), v: r => nm(r) }, { l: t("Letter"), v: r => t(r.type) }, { l: t("Addressed to"), v: r => r.addressed_to || "—" }, { l: t("Status"), v: r => statusChip(r.status) }, { l: t("Created"), v: r => fdate(r.created_at) }], rows, { onRow: r => modal(t(r.type), h("div", { class: "letter" }, r.body)), empty: t("No letters yet") }));
  } else if (tab === "hiring") {
    const [jobs, cands] = await Promise.all([rpc("data.jobs"), rpc("data.candidates")]);
    content = h("div", { class: "col" }, h("div", { class: "card" }, h("div", { class: "hd" }, h("h2", {}, t("Open jobs"))), table([{ l: t("Job"), v: j => h("b", {}, j.title) }, { l: t("Department"), v: j => j.department }, { l: t("Must have"), v: j => h("div", { class: "row", style: { gap: "4px" } }, ...j.requirements.must.map(x => chip(x, "blue", false))) }, { l: t("Min. years"), v: j => j.requirements.min_years, r: 1 }, { l: t("Candidates"), v: j => j.candidates, r: 1 }], jobs)),
      h("div", { class: "card" }, h("div", { class: "hd" }, h("h2", {}, t("Candidates screened by the AI"))), table([{ l: t("Name"), v: c => h("b", {}, c.name) }, { l: t("Job"), v: c => c.job_title }, { l: t("Score"), v: c => h("b", { class: c.score >= 70 ? "ok" : "" }, `${c.score}%`), r: 1 }, { l: t("Status"), v: c => statusChip(c.status) }, { l: t("Interview"), v: c => c.interview_at ? fdate(c.interview_at, true) : "—" }], cands, { onRow: c => modal(c.name, h("div", { class: "col" }, h("div", { class: "col", style: { gap: "4px" } }, ...c.breakdown.map(b => h("div", { class: "small" }, b.ok ? "✓ " : "✗ ", b.item, h("span", { class: "faint" }, ` (${b.points})`)))), h("div", { class: "letter" }, c.cv_text))), empty: t("No candidates yet — apply as a job seeker in the simulator") })));
  } else if (tab === "customers") {
    const [cus, inv] = await Promise.all([rpc("data.customers"), rpc("data.invoices", { status: "open" })]);
    content = h("div", { class: "col" }, h("div", { class: "card" }, h("div", { class: "hd" }, h("h2", {}, t("Customers"))), table([{ l: t("Customer"), v: c => h("b", { class: "small" }, c.name) }, { l: t("Contact"), v: c => c.contact_name }, { l: t("Outstanding"), v: c => money(c.outstanding), r: 1 }, { l: t("Overdue"), v: c => h("b", { class: c.overdue ? "warn-t" : "" }, money(c.overdue)), r: 1 }, { l: "", v: c => h("a", { class: "btn sm ghost", href: `#/simulator?agent=${agentId("collections")}&phone=${encodeURIComponent(c.phone)}`, title: t("Message the collections AI as this customer") }, ic("chat")) }], cus)),
      h("div", { class: "card" }, h("div", { class: "hd" }, h("h2", {}, t("Open invoices"))), table([{ l: t("Invoice"), v: i => h("code", {}, i.invoice_no) }, { l: t("Customer"), v: i => i.customer }, { l: t("Amount"), v: i => money(i.amount - i.paid_amount), r: 1 }, { l: t("Due"), v: i => h("span", { class: daysTo(i.due_date) < 0 ? "warn-t" : "" }, fdate(i.due_date)) }, { l: t("Promised"), v: i => i.promise_date ? fdate(i.promise_date) : "—" }, { l: t("Reminders"), v: i => i.reminders_count, r: 1 }, { l: t("Status"), v: i => i.escalated ? chip(t("escalated"), "violet") : statusChip(i.status) }], inv)));
  } else if (tab === "leads") {
    const rows = await rpc("data.leads");
    content = h("div", { class: "card" }, table([{ l: t("Lead"), v: r => h("div", {}, h("b", { class: "small" }, r.name), h("div", { class: "xs muted" }, r.company || "")) }, { l: t("Need"), v: r => h("span", { class: "small" }, r.need || "—") }, { l: t("City"), v: r => r.city || "—" }, { l: t("Score"), v: r => h("b", { class: r.score >= 60 ? "ok" : "" }, r.score), r: 1 }, { l: t("Stage"), v: r => statusChip(r.stage) }, { l: t("Meeting"), v: r => r.meeting_at ? fdate(r.meeting_at, true) : "—" }, { l: t("Source"), v: r => t(r.source || "") }], rows));
  } else if (tab === "services") {
    const rows = await rpc("data.services");
    content = h("div", { class: "card" }, table([{ l: t("Service"), v: r => h("b", {}, LANG === "ar" ? r.name_ar : r.name_en) }, { l: t("Starting price / month"), v: r => money(r.price_from), r: 1 }, { l: t("Words customers use"), v: r => h("span", { class: "xs muted" }, r.keywords) }], rows));
  }
  return h("div", {},
    h("div", { class: "topbar" }, h("div", {}, h("div", { class: "crumb" }, t("Company data")), h("h1", {}, t("The records your AI team works with")))),
    h("p", { class: "muted small", style: { marginBottom: "12px" } }, t("In production these sync from your HR / ERP / CRM system through the API; in this demo they are sample records.")),
    h("div", { class: "tabs" }, ...tabs.map(([k, l]) => h("a", { href: `#/data?tab=${k}`, class: tab === k ? "on" : "" }, t(l)))),
    content);
}
const daysTo = d => Math.round((new Date(d) - new Date()) / 864e5);
const agentId = role => app.session.agents.find(a => a.role === role)?.id || "";
