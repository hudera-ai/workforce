// Shared pieces: agent avatars, the step-by-step trace, WhatsApp-style bubbles.
import { h, ic, chip } from "../ui.js";
import { t, LANG, fdate } from "../i18n.js";

export const ROLE_LABEL = { hr: "HR officer", collections: "Collections officer", sales: "Sales rep" };
export const ROLE_ICON = { hr: "user", collections: "card", sales: "chat" };
export const agentName = a => (LANG === "ar" ? a.name_ar || a.agent_name_ar : a.name || a.agent_name) || a.name || a.agent_name;
export function avatar(a, size = 36) {
  const n = agentName(a) || "?";
  return h("span", { class: "ag-av", style: { width: size + "px", height: size + "px", background: a.color || "var(--primary)", fontSize: Math.round(size * 0.42) + "px" } }, n.slice(0, 1), h("i", { class: `st ${a.status === "paused" ? "off" : ""}` }));
}
export function agentTag(a) { return h("span", { class: "row", style: { gap: "8px", flexWrap: "nowrap" } }, avatar(a, 26), h("span", {}, h("b", { class: "small", style: { color: "var(--ink)" } }, agentName(a)), h("span", { class: "xs muted", style: { display: "block" } }, t(ROLE_LABEL[a.role] || a.role)))); }

const STEP_ICON = { receive: "inbox", identify: "user", understand: "search", entities: "layers", tool: "db", rule: "shield", approval: "hand", escalate: "hand", blocked: "x", knowledge: "book", score: "dash", plan: "flow", reply: "send", notify: "bolt", schedule: "clock", human: "user", llm: "bot", error: "warn" };
const STEP_CLS = { approval: "amber", escalate: "violet", blocked: "red", error: "red", rule: "sky", tool: "blue", reply: "green", llm: "violet" };
export function trace(steps, { animate = false } = {}) {
  if (!steps?.length) return h("div", { class: "empty small" }, t("No steps"));
  const list = h("ol", { class: "trace" }, ...steps.map((s, i) => h("li", { class: `${STEP_CLS[s.k] || ""}${animate ? " in" : ""}`, style: animate ? { animationDelay: `${i * 110}ms` } : null },
    h("span", { class: "ti" }, ic(STEP_ICON[s.k] || "check")),
    h("div", {}, h("div", { class: "tl", dir: "auto" }, s.k === "tool" ? h("code", {}, s.label) : s.label), s.detail ? h("div", { class: "td", dir: "auto" }, s.detail) : null))));
  return list;
}

export function bubbles(messages, { onTrace, selected } = {}) {
  return messages.map(m => {
    const out = m.direction === "out";
    const b = h("div", { class: `bub ${out ? "out" : "in"} ${m.author === "human" ? "human" : ""} ${selected === m.id ? "sel" : ""}` },
      m.author === "human" ? h("div", { class: "who" }, t("Human colleague")) : null,
      h("div", { class: "tx", dir: "auto" }, m.body),
      h("div", { class: "meta" }, fdate(m.at, true), out && m.trace ? h("button", { class: "tr-btn", onclick: () => onTrace?.(m) }, ic("flow"), t("How it decided")) : null));
    return b;
  });
}

export const statusChip = (s, color) => chip(t(s), color || { open: "blue", waiting_human: "amber", resolved: "grey", pending: "amber", approved: "green", rejected: "red", done: "green", escalated: "violet", waiting_approval: "amber", failed: "red", active: "green", paused: "amber" }[s] || "grey");
export const KIND_LABEL = { leave_request: "Leave request", letter: "HR letter", payment_claim: "Payment confirmation", promise_extension: "Payment extension", legal_notice: "Formal notice" };
