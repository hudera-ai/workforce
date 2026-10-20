import { h, ic, toast, modal, chip, table } from "../ui.js";
import { t, LANG, nf, fdate, ago } from "../i18n.js";
import { rpc, app, navigate, rerender } from "../main.js";
import { avatar, agentName, ROLE_LABEL, statusChip } from "./common.js";
import { kindLabel } from "./dashboard.js";

const COLORS = ["#7C5CFF", "#0FA97A", "#F2A33A", "#0B83C5", "#D9363E", "#3D5AFE", "#C2185B", "#00897B"];
const RULES = {
  hr: [["auto_approve_max_days", "Auto-approve annual leave up to (days)", "number"], ["min_notice_days", "Minimum notice for auto-approval (days)", "number"], ["letters_require_approval", "HR letters need human sign-off", "bool"],
    ["shortlist_threshold", "Shortlist CVs scoring at least (%)", "number"], ["payday", "Payday (day of month)", "number"], ["id_expiry_warn_days", "Warn about iqama expiry (days before)", "number"]],
  collections: [["reminder_days", "Reminder cadence (days overdue)", "list"], ["min_days_between", "Minimum days between reminders", "number"], ["max_promise_days", "Accept promises to pay up to (days)", "number"], ["escalate_after_days", "Ask finance before a formal notice after (days)", "number"]],
  sales: [["qualify_threshold", "Offer a meeting when lead score ≥", "number"], ["followup_after_days", "Follow up quiet leads after (days)", "number"], ["served_cities", "Cities you serve", "list"]],
};
const RISK = { read: ["Reads data", "sky"], write: ["Changes data", "amber"], send: ["Sends messages", "violet"] };

export async function agents(app_, route) {
  if (route.name === "agent" && route.id) return agentDetail(route);
  const list = await rpc("agents.list");
  if (route.params.hire) setTimeout(() => hireWizard(), 50);
  return h("div", {},
    h("div", { class: "topbar" }, h("div", {}, h("div", { class: "crumb" }, t("AI employees")), h("h1", {}, t("Your AI team"))), h("button", { class: "btn primary", onclick: () => hireWizard() }, ic("plus"), t("Hire an AI employee"))),
    h("div", { class: "grid g3" }, ...list.map(a => h("div", { class: "card agent-card" },
      h("div", { class: "bd col", style: { gap: "12px" } },
        h("div", { class: "row", style: { flexWrap: "nowrap" } }, avatar(a, 48), h("div", { style: { minWidth: 0 } }, h("h3", {}, agentName(a)), h("div", { class: "xs muted" }, t(ROLE_LABEL[a.role]))), h("span", { class: "sp" }), statusChip(a.status)),
        h("div", { class: "row", style: { gap: "6px" } }, ...a.channels.map(c => chip(t(c), "sky", false))),
        h("div", { class: "mini3" }, h("div", {}, h("b", {}, nf(a.stats.tasks)), h("span", {}, t("tasks this month"))), h("div", {}, h("b", {}, `${a.stats.tasks ? nf(100 * a.stats.done / a.stats.tasks, 0) : 0}%`), h("span", {}, t("automated"))), h("div", {}, h("b", {}, a.tools.length), h("span", {}, t("permissions")))),
        h("div", { class: "xs muted" }, t("Supervisor"), ": ", a.supervisor_name || "—")),
      h("div", { class: "ft" }, h("a", { class: "btn sm", href: `#/agent/${a.id}` }, ic("cog"), t("Configure")), h("a", { class: "btn sm primary", href: `#/simulator?agent=${a.id}` }, ic("chat"), t("Talk"))))),
      h("button", { class: "card hire-card", onclick: () => hireWizard() }, ic("plus"), h("b", {}, t("Hire an AI employee")), h("span", { class: "xs muted" }, t("HR, collections or sales — ready in a minute")))));
}

async function hireWizard() {
  const { templates, tools } = await rpc("agents.templates");
  let step = 0, role = null, name = "", nameAr = "", color = COLORS[3], channels = ["whatsapp"];
  const body = h("div", {});
  const m = modal(t("Hire an AI employee"), body, []);
  const draw = () => {
    if (step === 0) body.replaceChildren(h("p", { class: "muted small", style: { marginBottom: "12px" } }, t("Pick a role. Each comes with its skills, permissions and rules — you can change all of them later.")),
      h("div", { class: "col" }, ...templates.map(tp => h("button", { class: `tpl ${role === tp.key ? "on" : ""}`, onclick: () => { role = tp.key; name = { hr: "Layla", collections: "Turki", sales: "Nawaf" }[tp.key]; nameAr = { hr: "ليلى", collections: "تركي", sales: "نواف" }[tp.key]; step = 1; draw(); } },
        h("span", { class: "ti" }, ic({ hr: "user", collections: "card", sales: "chat" }[tp.key])), h("span", {}, h("b", {}, LANG === "ar" ? tp.name_ar : tp.name), h("span", { class: "xs muted", style: { display: "block" } }, LANG === "ar" ? tp.description_ar : tp.description))))));
    else if (step === 1) {
      const tp = templates.find(x => x.key === role);
      body.replaceChildren(h("div", { class: "form" },
        h("label", { class: "f" }, h("span", {}, t("Name (English)")), h("input", { value: name, oninput: e => (name = e.target.value) })),
        h("label", { class: "f" }, h("span", {}, t("Name (Arabic)")), h("input", { value: nameAr, dir: "rtl", oninput: e => (nameAr = e.target.value) })),
        h("div", { class: "f wide" }, h("span", { class: "small muted" }, t("Colour")), h("div", { class: "row" }, ...COLORS.map(c => h("button", { class: `sw ${c === color ? "on" : ""}`, style: { background: c }, onclick: () => { color = c; draw(); } })))),
        h("div", { class: "f wide" }, h("span", { class: "small muted" }, t("Channels")), h("div", { class: "row" }, ...["whatsapp", "email", "web_chat"].map(c => h("label", { class: "chk" }, h("input", { type: "checkbox", checked: channels.includes(c), onchange: e => { channels = e.target.checked ? [...channels, c] : channels.filter(x => x !== c); } }), t(c)))))),
        h("h3", { style: { margin: "16px 0 8px" } }, t("Permissions it starts with")),
        h("div", { class: "perm-list" }, ...tp.tools.map(k => h("div", { class: "row small" }, ic("check"), LANG === "ar" ? tools[k].label_ar : tools[k].label, h("span", { class: "sp" }), chip(t(RISK[tools[k].risk][0]), RISK[tools[k].risk][1], false)))),
        h("div", { class: "row", style: { marginTop: "16px" } }, h("button", { class: "btn", onclick: () => { step = 0; draw(); } }, t("Back")), h("span", { class: "sp" }),
          h("button", { class: "btn primary", onclick: async () => {
            try { const r = await rpc("agents.hire", { role, name, name_ar: nameAr, color, channels }); m.close(); toast(t("{n} has joined your team", { n: LANG === "ar" ? nameAr : name })); await rerender(); navigate(`#/agent/${r.id}`); }
            catch (e) { toast(e.message, true); } } }, ic("check"), t("Hire"))));
    }
  };
  draw();
}

async function agentDetail(route) {
  const a = await rpc("agents.get", { id: route.id });
  const tab = route.params.tab || "profile";
  const canEdit = ["owner", "platform", { hr: "hr_manager", collections: "finance_manager", sales: "sales_manager" }[a.role]].includes(app.session.user.role);
  const save = async (patch, msg = t("Saved")) => { try { await rpc("agents.update", { id: a.id, ...patch }); toast(msg); await rerender(); } catch (e) { toast(e.message, true); } };
  const tabs = [["profile", "Profile & channels"], ["permissions", "Permissions"], ["rules", "Rules & approvals"], ["knowledge", "Knowledge"], ["performance", "Performance"]];
  const content = h("div", {});

  if (tab === "profile") {
    let f = { name: a.name, name_ar: a.name_ar, tone: a.tone, working_hours: a.working_hours, supervisor_user_id: a.supervisor_user_id, channels: [...a.channels] };
    content.append(h("div", { class: "card" }, h("div", { class: "bd form" },
      h("label", { class: "f" }, h("span", {}, t("Name (English)")), h("input", { value: f.name, oninput: e => (f.name = e.target.value) })),
      h("label", { class: "f" }, h("span", {}, t("Name (Arabic)")), h("input", { value: f.name_ar, dir: "rtl", oninput: e => (f.name_ar = e.target.value) })),
      h("label", { class: "f" }, h("span", {}, t("Tone")), h("select", { onchange: e => (f.tone = e.target.value) }, ...["friendly", "formal", "brief"].map(x => h("option", { value: x, selected: x === f.tone }, t(x))))),
      h("label", { class: "f" }, h("span", {}, t("Human supervisor")), h("select", { onchange: e => (f.supervisor_user_id = +e.target.value) }, ...a.users.map(u => h("option", { value: u.id, selected: u.id === f.supervisor_user_id }, `${u.name} · ${t(u.role)}`)))),
      h("label", { class: "f" }, h("span", {}, t("Human working hours (for hand-overs)")), h("input", { value: f.working_hours, oninput: e => (f.working_hours = e.target.value) })),
      h("div", { class: "f wide" }, h("span", { class: "small muted" }, t("Channels")), h("div", { class: "row" }, ...["whatsapp", "email", "web_chat"].map(c => h("label", { class: "chk" }, h("input", { type: "checkbox", checked: f.channels.includes(c), onchange: e => { f.channels = e.target.checked ? [...f.channels, c] : f.channels.filter(x => x !== c); } }), t(c))))),
      h("div", { class: "wide xs muted" }, t("WhatsApp connects through the WhatsApp Business Cloud API webhook (see Developers). The AI employee replies 24/7; hand-overs reach humans during working hours."))),
      canEdit ? h("div", { class: "ft" }, h("span", { class: "sp" }), h("button", { class: "btn primary", onclick: () => save(f) }, t("Save"))) : null));
  }
  if (tab === "permissions") {
    let sel = new Set(a.tools);
    content.append(h("div", { class: "card" }, h("div", { class: "hd" }, h("h2", {}, t("What this AI employee may do")), h("span", { class: "sp" }), h("span", { class: "xs muted" }, t("Every action is checked against this list and shown in the trace."))),
      h("div", { class: "bd col" }, ...Object.entries(a.catalog).map(([k, tl]) => h("label", { class: "perm" }, h("input", { type: "checkbox", checked: sel.has(k), disabled: !canEdit || k === "hr.find_employee", onchange: e => { e.target.checked ? sel.add(k) : sel.delete(k); } }),
        h("span", { style: { flex: 1 } }, h("b", { class: "small" }, LANG === "ar" ? tl.label_ar : tl.label), h("code", { class: "xs faint", style: { display: "block" } }, k)), chip(t(RISK[tl.risk][0]), RISK[tl.risk][1], false)))),
      h("div", { class: "ft" }, h("span", { class: "xs muted" }, t("Turn a permission off and try it in the simulator: the AI employee hands the request to a human instead.")), h("span", { class: "sp" }), canEdit ? h("button", { class: "btn primary", onclick: () => save({ tools: [...sel] }) }, t("Save permissions")) : null)));
  }
  if (tab === "rules") {
    const r = { ...a.rules };
    content.append(h("div", { class: "card" }, h("div", { class: "hd" }, h("h2", {}, t("Rules the AI employee follows")), h("span", { class: "sp" }), h("span", { class: "xs muted" }, t("Anything outside these rules goes to a human for approval."))),
      h("div", { class: "bd form" }, ...(RULES[a.role] || []).map(([k, lbl, type]) => type === "bool"
        ? h("label", { class: "chk wide" }, h("input", { type: "checkbox", checked: !!r[k], onchange: e => (r[k] = e.target.checked) }), t(lbl))
        : h("label", { class: "f" }, h("span", {}, t(lbl)), h("input", { type: type === "number" ? "number" : "text", value: Array.isArray(r[k]) ? r[k].join(", ") : r[k] ?? "", oninput: e => (r[k] = type === "number" ? +e.target.value : e.target.value.split(",").map(s => s.trim()).filter(Boolean).map(x => (isNaN(+x) ? x.toLowerCase() : +x))) })))),
      canEdit ? h("div", { class: "ft" }, h("span", { class: "sp" }), h("button", { class: "btn primary", onclick: () => save({ rules: r }) }, t("Save rules"))) : null),
      h("div", { class: "card", style: { marginTop: "14px" } }, h("div", { class: "hd" }, h("h2", {}, t("Scheduled work")), h("span", { class: "sp" }), canEdit ? h("button", { class: "btn sm", onclick: async () => { const res = await rpc("agents.run_job", { id: a.id, lang: LANG }); modal(t("Run log"), h("ul", { class: "small" }, ...(res.log?.length ? res.log : [t("Nothing due right now")]).map(l => h("li", {}, l)))); } }, ic("play"), t("Run now")) : null),
        h("div", { class: "bd small muted" }, { hr: t("Scans iqama / ID expiries and messages employees whose documents expire soon."), collections: t("Sends the reminder cadence to overdue customers, skips promised and disputed invoices, and asks finance before any formal notice."), sales: t("Follows up qualified leads that went quiet.") }[a.role])));
  }
  if (tab === "knowledge") {
    const edit = async doc => {
      const full = doc?.id ? await rpc("knowledge.get", { id: doc.id }) : { title: "", body: "", lang: LANG };
      const ti = h("input", { value: full.title }), bo = h("textarea", { rows: 16, value: full.body, dir: full.lang === "ar" ? "rtl" : "ltr" }), lg = h("select", {}, h("option", { value: "ar", selected: full.lang === "ar" }, "العربية"), h("option", { value: "en", selected: full.lang === "en" }, "English"));
      modal(doc ? t("Edit document") : t("Add document"), h("div", { class: "col" }, h("div", { class: "form" }, h("label", { class: "f" }, h("span", {}, t("Title")), ti), h("label", { class: "f" }, h("span", {}, t("Language")), lg)),
        h("label", { class: "f" }, h("span", {}, t("Text — one topic per paragraph; a short heading line before each works best")), bo)),
        [{ label: t("Cancel") }, { label: t("Save"), cls: "primary", onClick: async () => { try { await rpc("knowledge.save", { id: doc?.id, title: ti.value, body: bo.value, lang: lg.value, agent_role: a.role }); toast(t("Saved")); await rerender(); } catch (e) { toast(e.message, true); return false; } } }]);
    };
    content.append(h("div", { class: "card" }, h("div", { class: "hd" }, h("h2", {}, t("Company documents it answers from")), h("span", { class: "sp" }), canEdit ? h("button", { class: "btn sm primary", onclick: () => edit(null) }, ic("plus"), t("Add document")) : null),
      table([{ l: t("Title"), v: d => h("b", {}, d.title) }, { l: t("Language"), v: d => (d.lang === "ar" ? "العربية" : "English") }, { l: t("Size"), v: d => `${nf(d.size)} ${t("chars")}`, r: 1 }, { l: t("Updated"), v: d => fdate(d.updated_at) },
        { l: "", v: d => canEdit ? h("div", { class: "row", style: { justifyContent: "flex-end" } }, h("button", { class: "btn sm", onclick: () => edit(d) }, ic("edit")), h("button", { class: "btn sm ghost", onclick: async () => { await rpc("knowledge.remove", { id: d.id }); await rerender(); } }, ic("trash"))) : null }], a.docs),
      h("div", { class: "ft xs muted" }, t("Answers quote the paragraph and the document name. If nothing matches with confidence, the question is handed to a human — the AI employee never makes up a policy."))));
  }
  if (tab === "performance") {
    content.append(h("div", { class: "card" }, h("div", { class: "hd" }, h("h2", {}, t("Last 30 days by task type"))),
      table([{ l: t("Task"), v: k => kindLabel(k.kind) }, { l: t("Count"), v: k => nf(k.n), r: 1 }, { l: t("Automated"), v: k => `${nf(100 * k.done / k.n, 0)}%`, r: 1 }], a.kinds),
      h("div", { class: "ft" }, h("a", { class: "btn sm", href: `#/conversations?agent=${a.id}` }, t("See conversations")))));
  }

  return h("div", {},
    h("div", { class: "crumb" }, h("a", { href: "#/agents" }, t("AI employees")), " / ", agentName(a)),
    h("div", { class: "topbar" }, avatar(a, 52), h("div", {}, h("h1", {}, agentName(a)), h("div", { class: "muted small" }, `${t(ROLE_LABEL[a.role])} · ${t("since")} ${fdate(a.created_at)} · ${t("Supervisor")}: ${a.supervisor?.name || "—"}`)), h("span", { class: "sp" }),
      statusChip(a.status),
      canEdit ? h("button", { class: "btn", onclick: () => save({ status: a.status === "active" ? "paused" : "active" }, a.status === "active" ? t("Paused — messages now wait for a human") : t("Back at work")) }, ic(a.status === "active" ? "pause" : "play"), a.status === "active" ? t("Pause") : t("Resume")) : null,
      h("a", { class: "btn primary", href: `#/simulator?agent=${a.id}` }, ic("chat"), t("Talk"))),
    h("div", { class: "tabs" }, ...tabs.map(([k, l]) => h("a", { href: `#/agent/${a.id}?tab=${k}`, class: tab === k ? "on" : "" }, t(l)))),
    content);
}
