import { h, ic, toast, table, chip, confirm } from "../ui.js";
import { t, LANG, setLang, ago, fdate, money } from "../i18n.js";
import { rpc, app, render, setTheme, rerender } from "../main.js";

export async function settings() {
  const [users, log, dash] = await Promise.all([rpc("users.list"), rpc("audit.list", { limit: 40 }), rpc("dashboard.summary", { days: 30 })]);
  const fte = h("input", { type: "number", value: dash.fte_cost, step: 500, style: { maxWidth: "160px" } });
  return h("div", {},
    h("div", { class: "topbar" }, h("div", {}, h("div", { class: "crumb" }, t("Settings")), h("h1", {}, t("Workspace settings")))),
    h("div", { class: "grid g2" },
      h("div", { class: "card" }, h("div", { class: "hd" }, h("h2", {}, t("Preferences"))), h("div", { class: "bd col" },
        h("div", { class: "row" }, h("span", { class: "small", style: { width: "120px" } }, t("Language")), h("div", { class: "seg" }, h("button", { class: LANG === "ar" ? "on" : "", onclick: () => { setLang("ar"); render(); } }, "العربية"), h("button", { class: LANG === "en" ? "on" : "", onclick: () => { setLang("en"); render(); } }, "English"))),
        h("div", { class: "row" }, h("span", { class: "small", style: { width: "120px" } }, t("Theme")), h("div", { class: "seg" }, ...[["system", "System"], ["light", "Light"], ["dark", "Dark"]].map(([v, l]) => h("button", { class: (document.documentElement.dataset.theme || "system") === v ? "on" : "", onclick: () => { setTheme(v); render(); } }, t(l))))),
        h("div", { class: "row" }, h("span", { class: "small", style: { width: "120px" } }, t("Cost of one employee")), fte, h("button", { class: "btn sm", onclick: async () => { try { await rpc("settings.save", { fte_cost: +fte.value }); toast(t("Saved")); } catch (e) { toast(e.message, true); } } }, t("Save"))),
        h("div", { class: "xs muted" }, t("Fully-loaded monthly cost (salary, housing, GOSI, iqama, office) used to value the hours your AI team saves.")))),
      h("div", { class: "card" }, h("div", { class: "hd" }, h("h2", {}, t("Data"))), h("div", { class: "bd col" },
        h("p", { class: "small muted" }, app.api.mode === "http" ? t("Connected to the Workforce server.") : t("Running in your browser (SQLite via WebAssembly). Your changes stay on this device.")),
        app.api.mode !== "http" ? h("button", { class: "btn danger", onclick: async () => { if (await confirm(t("Reset sample data"), t("All changes in this browser will be replaced with the original sample data."))) { await app.api.reset(); toast(t("Sample data restored")); rerender(); } } }, ic("refresh"), t("Reset sample data")) : null))),
    h("div", { class: "card", style: { marginTop: "14px" } }, h("div", { class: "hd" }, h("h2", {}, t("People in this workspace")), h("span", { class: "sp" }), h("span", { class: "xs muted" }, t("Approvals are routed by role"))),
      table([{ l: t("Name"), v: u => h("b", { class: "small" }, u.name) }, { l: t("Email"), v: u => h("span", { class: "small mono" }, u.email) }, { l: t("Role"), v: u => chip(t(u.role), u.role === "owner" ? "blue" : "grey", false) }], users)),
    h("div", { class: "card", style: { marginTop: "14px" } }, h("div", { class: "hd" }, h("h2", {}, t("Audit log"))),
      table([{ l: t("When"), v: l => h("span", { class: "xs" }, fdate(l.at, true)) }, { l: t("By"), v: l => l.user_name || t("AI employee") }, { l: t("Action"), v: l => h("code", { class: "xs" }, `${l.action} ${l.entity}${l.entity_id ? " #" + l.entity_id : ""}`) }, { l: t("Detail"), v: l => h("span", { class: "xs muted clamp" }, l.detail || "") }], log, { empty: t("Changes you make appear here") })));
}
