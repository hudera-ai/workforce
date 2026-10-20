import { h, ic, toast, modal, chip } from "../ui.js";
import { t, LANG, ago, fdate } from "../i18n.js";
import { rpc, app, rerender } from "../main.js";
import { statusChip } from "./common.js";

const EVENTS = [["approval.requested", "An AI employee asks for approval"], ["approval.decided", "A human approves or rejects"], ["conversation.handoff", "A conversation is handed to a human"], ["candidate.screened", "A CV is screened"], ["lead.scored", "A lead is scored"]];
const ROLES = [["hr", "HR officer"], ["collections", "Collections officer"], ["sales", "Sales rep"]];
const PEOPLE = ["owner", "hr_manager", "finance_manager", "sales_manager"];
const DAYS = [["Sun-Thu", "Every Sun–Thu"], ["Sun-Sat", "Every day"], ["Sun", "Every Sunday"], ["Thu", "Every Thursday"]];

function describeTrigger(tr) {
  if (tr.type === "schedule") return `${t((DAYS.find(d => d[0] === tr.params?.days) || [, tr.params?.days])[1])} ${t("at")} ${tr.params?.time}`;
  return t((EVENTS.find(e => e[0] === tr.params?.event) || [, tr.params?.event])[1]);
}
function describeStep(s) {
  if (s.type === "agent_job") return [ic("bot"), t("Run the {r}'s scheduled work", { r: t((ROLES.find(r => r[0] === s.role) || [, s.role])[1]) })];
  if (s.type === "condition") return [ic("shield"), `${t("Only if")} ${s.field} ${s.op} ${s.value}`];
  if (s.type === "notify") return [ic("bolt"), `${t("Notify")} ${t(s.role)}: ${s.text}`];
  if (s.type === "agent_action") return [ic("play"), `${t((ROLES.find(r => r[0] === s.role) || [, s.role])[1])} → ${s.action.replace(/_/g, " ")}`];
  return [ic("check"), s.type];
}

export async function automations() {
  const list = await rpc("automations.list");
  const canEdit = ["owner", "platform", "hr_manager", "finance_manager", "sales_manager"].includes(app.session.user.role);
  return h("div", {},
    h("div", { class: "topbar" }, h("div", {}, h("div", { class: "crumb" }, t("Automations")), h("h1", {}, t("Workflows around your AI team"))), canEdit ? h("button", { class: "btn primary", onclick: () => builder() }, ic("plus"), t("New automation")) : null),
    h("p", { class: "muted small", style: { marginBottom: "14px" } }, t("A trigger (a schedule or an event) runs steps: an AI employee's scheduled work, a condition, a notification. Schedules run on the server; here you can run any of them now.")),
    h("div", { class: "col" }, ...list.map(a => h("div", { class: "card" },
      h("div", { class: "hd" }, h("span", { class: "ti" }, ic("flow")), h("div", {}, h("h2", {}, a.name), h("div", { class: "xs muted" }, `${a.runs_count} ${t("runs")}${a.last_run_at ? " · " + t("last") + " " + ago(a.last_run_at) : ""}`)), h("span", { class: "sp" }),
        canEdit ? h("label", { class: "switch", title: a.enabled ? t("Enabled") : t("Disabled") }, h("input", { type: "checkbox", checked: !!a.enabled, onchange: async e => { await rpc("automations.toggle", { id: a.id, enabled: e.target.checked }); toast(e.target.checked ? t("Enabled") : t("Disabled")); } }), h("i")) : null,
        h("button", { class: "btn sm", onclick: async () => { const r = await rpc("automations.run", { id: a.id, lang: LANG }); showLog(a.name, r.log); rerender(); } }, ic("play"), t("Run now")),
        canEdit ? h("button", { class: "btn sm ghost", onclick: () => builder(a) }, ic("edit")) : null),
      h("div", { class: "bd" }, h("div", { class: "flow" }, h("div", { class: "node trig" }, ic(a.trigger.type === "schedule" ? "clock" : "bolt"), h("span", {}, describeTrigger(a.trigger))),
        ...a.steps.flatMap(s => [h("span", { class: "arrow" }, "→"), h("div", { class: "node" }, ...describeStep(s))]))),
      a.runs.length ? h("div", { class: "ft col", style: { alignItems: "stretch", gap: "4px" } }, h("b", { class: "xs muted" }, t("Recent runs")), ...a.runs.slice(0, 3).map(r => h("button", { class: "run-row", onclick: () => showLog(a.name, r.log) }, statusChip(r.status), h("span", { class: "xs" }, fdate(r.at, true)), h("span", { class: "xs muted clamp" }, r.log.map(l => l.detail).join(" · "))))) : null))));
}

function showLog(name, log) {
  modal(`${t("Run log")} — ${name}`, h("ol", { class: "trace" }, ...log.map(l => h("li", { class: l.status === "ok" ? "green" : "" }, h("span", { class: "ti" }, ic(l.status === "ok" ? "check" : "x")),
    h("div", {}, h("div", { class: "tl" }, `${l.step} · ${t(l.status)}`), h("div", { class: "td" }, l.detail), l.items?.length ? h("ul", { class: "xs muted", style: { margin: "4px 0 0", paddingInlineStart: "16px" } }, ...l.items.map(i => h("li", {}, i))) : null)))));
}

function builder(a) {
  let name = a?.name || "", trig = a ? structuredClone(a.trigger) : { type: "schedule", params: { time: "08:00", days: "Sun-Thu" } }, steps = a ? structuredClone(a.steps) : [{ type: "agent_job", role: "collections" }];
  const body = h("div", {});
  const sel = (opts, v, on) => h("select", { onchange: e => on(e.target.value) }, ...opts.map(([k, l]) => h("option", { value: k, selected: k === v }, t(l))));
  const draw = () => body.replaceChildren(
    h("label", { class: "f" }, h("span", {}, t("Name")), h("input", { value: name, oninput: e => (name = e.target.value) })),
    h("h3", { style: { margin: "14px 0 8px" } }, t("When")),
    h("div", { class: "form" }, sel([["schedule", "On a schedule"], ["event", "When something happens"]], trig.type, v => { trig = v === "schedule" ? { type: v, params: { time: "08:00", days: "Sun-Thu" } } : { type: v, params: { event: EVENTS[0][0] } }; draw(); }),
      ...(trig.type === "schedule" ? [h("input", { type: "time", value: trig.params.time, oninput: e => (trig.params.time = e.target.value) }), sel(DAYS, trig.params.days, v => (trig.params.days = v))] : [sel(EVENTS, trig.params.event, v => (trig.params.event = v))])),
    h("h3", { style: { margin: "14px 0 8px" } }, t("Then")),
    h("div", { class: "col" }, ...steps.map((s, i) => h("div", { class: "step-row" }, h("b", { class: "xs muted" }, i + 1),
      sel([["agent_job", "Run AI employee work"], ["condition", "Only continue if"], ["notify", "Notify a person"]], s.type, v => { steps[i] = v === "agent_job" ? { type: v, role: "hr" } : v === "condition" ? { type: v, field: "score", op: ">=", value: 70 } : { type: v, role: "owner", text: "" }; draw(); }),
      ...(s.type === "agent_job" ? [sel(ROLES, s.role, v => (s.role = v))]
        : s.type === "condition" ? [h("input", { value: s.field, style: { maxWidth: "110px" }, oninput: e => (s.field = e.target.value) }), sel([[">=", "≥"], ["<=", "≤"], ["=", "="], ["!=", "≠"]], s.op, v => (s.op = v)), h("input", { value: s.value, style: { maxWidth: "90px" }, oninput: e => (s.value = e.target.value) })]
        : s.type === "notify" ? [sel(PEOPLE.map(p => [p, p]), s.role, v => (s.role = v)), h("input", { value: s.text, placeholder: t("Message"), oninput: e => (s.text = e.target.value) })] : [h("span", { class: "small" }, `${s.role} → ${s.action}`)]),
      h("button", { class: "btn sm ghost", onclick: () => { steps.splice(i, 1); draw(); } }, ic("trash")))),
      h("button", { class: "btn sm", onclick: () => { steps.push({ type: "notify", role: "owner", text: "" }); draw(); } }, ic("plus"), t("Add step"))));
  draw();
  modal(a ? t("Edit automation") : t("New automation"), body, [
    ...(a ? [{ label: t("Delete"), cls: "danger", onClick: async () => { await rpc("automations.remove", { id: a.id }); toast(t("Deleted")); rerender(); } }] : []),
    { label: t("Cancel") }, { label: t("Save"), cls: "primary", onClick: async () => { try { await rpc("automations.save", { id: a?.id, name, trigger: trig, steps, enabled: a ? a.enabled : 1 }); toast(t("Saved")); rerender(); } catch (e) { toast(e.message, true); return false; } } }]);
}
