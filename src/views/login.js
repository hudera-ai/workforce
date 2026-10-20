import { h, ic, toast } from "../ui.js";
import { t, LANG, setLang } from "../i18n.js";
import { refreshSession, render } from "../main.js";

const DEMO = [
  ["owner@rawabi.example", "Abdulrahman Al-Shammari", "owner", "Rawabi Facilities Management"],
  ["hr@rawabi.example", "Hessa Al-Otaibi", "hr_manager", "Rawabi Facilities Management"],
  ["finance@rawabi.example", "Waleed Kamal", "finance_manager", "Rawabi Facilities Management"],
  ["sales@rawabi.example", "Majed Al-Harthi", "sales_manager", "Rawabi Facilities Management"],
  ["owner@masar.example", "Yousef Al-Dossari", "owner", "Masar Logistics"],
  ["platform@hudera.example", "HUDERA Platform Ops", "platform", "HUDERA (all tenants)"],
];

export function login(app) {
  const email = h("input", { type: "email", value: "owner@rawabi.example", autocomplete: "username" });
  const pass = h("input", { type: "password", value: "demo1234", autocomplete: "current-password" });
  const go = async (e, p) => {
    try { await app.api.login(e || email.value, p || pass.value); await refreshSession(); location.hash = ""; render(); }
    catch (err) { toast(t("Wrong email or password"), true); }
  };
  return h("div", { class: "login" },
    h("div", { class: "card" },
      h("div", { class: "bd col", style: { gap: "16px" } },
        h("div", { class: "row" }, h("div", { class: "brand", style: { padding: 0 } }, h("span", { class: "mark" }, "W"), h("span", {}, "Workforce", h("small", {}, "HUDERA · " + t("AI employee platform")))), h("span", { class: "sp" }),
          h("button", { class: "btn ghost sm", onclick: () => { setLang(LANG === "ar" ? "en" : "ar"); render(); } }, LANG === "ar" ? "English" : "العربية")),
        h("p", { class: "muted small" }, t("Hire AI employees for HR, collections and sales. They work on WhatsApp with your company data and ask a human before anything sensitive.")),
        h("div", { class: "banner blue" }, ic("shield"), t("Demo with fictional companies and sample data. Nothing here is a real client.")),
        h("form", { class: "col", onsubmit: e => { e.preventDefault(); go(); } },
          h("label", { class: "f" }, h("span", {}, t("Email")), email), h("label", { class: "f" }, h("span", {}, t("Password")), pass),
          h("button", { class: "btn primary", type: "submit" }, t("Sign in"))),
        h("div", { class: "col", style: { gap: "6px" } }, h("div", { class: "xs muted" }, t("Or pick a demo user"), " · ", t("password"), " ", h("code", {}, "demo1234")),
          h("div", { class: "demo-users" }, ...DEMO.map(([e, n, r, c]) => h("button", { onclick: () => go(e, "demo1234") }, h("span", { class: "avatar" }, n.split(" ").map(x => x[0]).slice(0, 2).join("")),
            h("span", { style: { minWidth: 0 } }, h("b", { class: "small", style: { display: "block", color: "var(--ink)" } }, n), h("span", { class: "xs muted" }, `${t(r)} · ${c}`)))))))));
}
