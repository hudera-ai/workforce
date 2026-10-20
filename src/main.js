// App shell + hash router. Views in src/views/*.js
import { createApi } from "./api.js";
import { t, LANG, setLang } from "./i18n.js";
import { h, $, ic, toast } from "./ui.js";
import * as views from "./views/index.js";

export const app = { api: null, session: null, route: { name: "dashboard" } };
export const rpc = (op, args) => app.api.rpc(op, args);

const NAV = [
  ["dashboard", "Overview", "dash", true], ["agents", "AI employees", "bot", true], ["simulator", "Try it live", "chat", true], ["conversations", "Conversations", "inbox", true],
  ["approvals", "Approvals", "shield", true], ["automations", "Automations", "flow"], ["data", "Company data", "db"], ["developers", "Developers & API", "key"], ["billing", "Plan & usage", "card"], ["settings", "Settings", "cog"],
];
const ALIAS = { agent: "agents", conversation: "conversations" };

export const navigate = hash => { location.hash = hash; };
export function parseRoute() {
  const [path, qs] = location.hash.replace(/^#\/?/, "").split("?");
  const [name = "", id = null, sub = null] = path.split("/");
  return { name, id, sub, params: Object.fromEntries(new URLSearchParams(qs || "")) };
}
export function setTheme(v) { if (v === "system") { delete document.documentElement.dataset.theme; localStorage.removeItem("workforce.theme"); } else { document.documentElement.dataset.theme = v; localStorage.setItem("workforce.theme", v); } }

function shell() {
  const s = app.session, u = s.user, isPlat = u.role === "platform";
  const cur = ALIAS[app.route.name] || app.route.name;
  const counts = { approvals: s.counts?.approvals, conversations: s.counts?.human };
  const items = s.tenant ? NAV : [];
  const link = ([n, label, icon], cls = "") => h("a", { href: `#/${n}`, class: cls + (cur === n ? " on" : "") }, ic(icon), h("span", {}, t(label)), counts[n] ? h("span", { class: "cnt" }, counts[n]) : null);
  const initials = u.name.split(" ").filter(Boolean).slice(0, 2).map(x => x[0]).join("").toUpperCase();
  const tenantName = s.tenant ? (LANG === "ar" ? s.tenant.name_ar : s.tenant.name_en) : t("HUDERA platform");
  return h("div", { class: "shell" },
    h("aside", { class: "side" },
      h("div", { class: "brand" }, h("span", { class: "mark" }, "W"), h("span", {}, "Workforce", h("small", {}, "HUDERA · " + t("AI employee platform")))),
      h("div", { class: "tenant-box" }, h("div", { class: "xs faint" }, isPlat ? t("Viewing workspace") : t("Workspace")), h("div", { class: "tn" }, tenantName),
        s.tenant ? h("div", { class: "xs muted" }, `${s.tenant.plan_name} · ${s.agents.length}/${s.tenant.max_agents} ${t("AI employees")}`) : null),
      isPlat ? h("nav", { class: "nav col", style: { gap: "2px" } }, link(["platform", "Platform console", "layers"])) : null,
      h("nav", { class: "nav col", style: { gap: "2px" } }, ...items.map(i => link(i))),
      h("div", { class: "user" }, h("span", { class: "avatar" }, initials), h("div", { style: { minWidth: 0 } }, h("div", { class: "small", style: { fontWeight: 600, color: "var(--ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, u.name), h("div", { class: "xs muted" }, t(u.role))),
        h("span", { class: "sp" }), h("button", { class: "btn ghost sm", title: LANG === "ar" ? "English" : "العربية", onclick: () => { setLang(LANG === "ar" ? "en" : "ar"); render(); } }, LANG === "ar" ? "EN" : "ع"),
        h("button", { class: "btn ghost sm", title: t("Sign out"), onclick: logout }, ic("out")))),
    h("main", { class: "main", id: "view" }),
    h("nav", { class: "mobile-nav" }, ...(isPlat ? [link(["platform", "Platform", "layers"])] : []), ...items.filter(i => i[3]).map(i => link(i))));
}

async function logout() { await app.api.logout(); app.session = null; render(); }
export async function refreshSession() { app.session = await rpc("session.info"); }

export async function render() {
  setLang(LANG);
  document.body.replaceChildren();
  if (!app.session) { document.body.append(views.login(app)); return; }
  app.route = parseRoute();
  if (!app.route.name) app.route.name = app.session.user.role === "platform" && !app.session.tenant ? "platform" : "dashboard";
  if (!app.session.tenant && app.route.name !== "platform") app.route.name = "platform";
  document.body.append(shell());
  const view = $("#view"); view.replaceChildren(h("div", { class: "empty" }, h("span", { class: "spinner" })));
  const fn = views[app.route.name] || views[ALIAS[app.route.name]] || views.dashboard;
  try { view.replaceChildren(await fn(app, app.route)); }
  catch (e) { console.error(e); view.replaceChildren(h("div", { class: "card" }, h("div", { class: "bd" }, h("h2", {}, t("Something went wrong")), h("p", { class: "muted small mono" }, e.message)))); }
  window.scrollTo(0, 0);
}
export async function updateBadges() {
  try { await refreshSession(); } catch { return; }
  const counts = { approvals: app.session.counts?.approvals, conversations: app.session.counts?.human };
  for (const [n, c] of Object.entries(counts)) document.querySelectorAll(`.nav a[href="#/${n}"], .mobile-nav a[href="#/${n}"]`).forEach(a => { a.querySelector(".cnt")?.remove(); if (c) a.append(h("span", { class: "cnt" }, c)); });
}
export async function rerender() { await refreshSession(); await render(); }

window.addEventListener("hashchange", () => { if (app.session) render(); });
window.addEventListener("unhandledrejection", e => toast(e.reason?.message || String(e.reason), true));

(async () => {
  const th = localStorage.getItem("workforce.theme"); if (th) document.documentElement.dataset.theme = th;
  setLang(LANG);
  app.api = await createApi();
  try { await refreshSession(); } catch { app.session = null; }
  render();
})();
