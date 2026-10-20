// Tiny DOM helpers — no framework. h() builds elements, the rest are shared widgets.
import { t } from "./i18n.js";

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "html") el.innerHTML = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else if (k in el && k !== "list" && k !== "form") { try { el[k] = v; } catch { el.setAttribute(k, v); } }
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat(Infinity)) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
  return el;
}

export const ICONS = {
  dash: '<path d="M3 13h8V3H3zm0 8h8v-6H3zm10 0h8V11h-8zm0-18v6h8V3z"/>',
  proj: '<path d="M3 7l9-4 9 4v10l-9 4-9-4z"/><path d="M12 11l9-4M12 11L3 7m9 4v10"/>',
  rep: '<path d="M6 2h9l5 5v15H6z"/><path d="M14 2v6h6M9 13h6M9 17h6"/>',
  inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5 5h14l3 7v7H2v-7z"/>',
  cog: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', check: '<path d="M20 6L9 17l-5-5"/>', x: '<path d="M18 6L6 18M6 6l12 12"/>', print: '<path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v8H6z"/>',
  send: '<path d="M22 2L11 13M22 2l-7 20-4-9-9-4z"/>', back: '<path d="M19 12H5M12 19l-7-7 7-7"/>', trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>', edit: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>', warn: '<path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>', out: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>', refresh: '<path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.5 9a9 9 0 0 1 14.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0 0 20.5 15"/>',
  bot: '<rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 4v4M9 13h.01M15 13h.01M9 17h6"/><circle cx="12" cy="3" r="1"/>',
  play: '<path d="M6 4l14 8-14 8z"/>', pause: '<path d="M7 4h3v16H7zM14 4h3v16h-3z"/>', bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
  flow: '<rect x="3" y="3" width="6" height="6" rx="1.5"/><rect x="15" y="15" width="6" height="6" rx="1.5"/><path d="M6 9v4a2 2 0 0 0 2 2h7"/>',
  key: '<circle cx="7.5" cy="15.5" r="4.5"/><path d="M10.7 12.3L21 2M17 6l3 3M14 9l2 2"/>', card: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h4"/>',
  db: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  shield: '<path d="M12 2l8 4v6c0 5-3.4 8.7-8 10-4.6-1.3-8-5-8-10V6z"/><path d="M9 12l2 2 4-4"/>', globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20"/>',
  layers: '<path d="M12 2l10 5-10 5L2 7z"/><path d="M2 17l10 5 10-5M2 12l10 5 10-5"/>', clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>', book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/><path d="M4 19.5V21h16"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>', search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>', hand: '<path d="M18 11V6a2 2 0 0 0-4 0M14 10V4a2 2 0 0 0-4 0v2M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.9-6-2.4l-3.6-3.6a2 2 0 0 1 2.8-2.8L7 15"/>',
  sun: '<circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/>', moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
};
export const ic = n => { const s = document.createElementNS("http://www.w3.org/2000/svg", "svg"); s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("fill", "none"); s.setAttribute("stroke", "currentColor"); s.setAttribute("stroke-width", "2"); s.setAttribute("stroke-linecap", "round"); s.setAttribute("stroke-linejoin", "round"); s.innerHTML = ICONS[n] || ""; return s; };

export const STATUS_COLOR = { pending: "amber", rejected: "red", issued: "green", waiting_human: "amber", resolved: "grey", done: "green", waiting_approval: "amber", escalated: "violet", failed: "red", paused: "amber", qualifying: "sky", qualified: "blue", meeting: "violet", won: "green", lost: "grey", disqualified: "grey", shortlisted: "blue", interview: "violet", hired: "green", paid: "green", disputed: "red", ok: "green", error: "red", skipped: "grey", draft: "grey", submitted: "amber", approved: "green", returned: "red", active: "green", on_hold: "amber", closed: "grey", open: "red", closed_issue: "grey", working: "green", idle: "amber", breakdown: "red", high: "red", medium: "amber", low: "grey", new: "blue", parsed: "violet", applied: "green", ignored: "grey" };
export const chip = (label, color = "grey", dot = true) => h("span", { class: `chip ${color}` }, dot ? h("i", { class: "dot" }) : null, label);
export const statusChip = s => chip(t(s), STATUS_COLOR[s] || "grey");

let toastEl = null;
export function toast(msg, err = false) {
  toastEl?.remove(); toastEl = h("div", { class: `toast${err ? " err" : ""}` }, msg); document.body.append(toastEl);
  setTimeout(() => toastEl?.remove(), err ? 4200 : 2200);
}
export function modal(title, body, actions = []) {
  const bg = h("div", { class: "modal-bg", onclick: e => { if (e.target === bg) close(); } });
  const close = () => bg.remove();
  const el = h("div", { class: "modal card" }, h("div", { class: "hd" }, h("h2", {}, title), h("span", { class: "sp" }), h("button", { class: "btn ghost sm", onclick: close, "aria-label": t("Close") }, ic("x"))), h("div", { class: "bd" }, body),
    actions.length ? h("div", { class: "ft" }, h("span", { class: "sp" }), ...actions.map(a => h("button", { class: `btn ${a.cls || ""}`, onclick: async () => { if ((await a.onClick?.(close)) !== false) close(); } }, a.label))) : null);
  bg.append(el); document.body.append(bg); return { close, el };
}
export function confirm(title, text) { return new Promise(ok => modal(title, h("p", {}, text), [{ label: t("Cancel"), onClick: () => ok(false) }, { label: title, cls: "danger", onClick: () => ok(true) }])); }

export function field(label, input, extra = {}) { return h("label", { class: `f ${extra.class || ""}` }, h("span", {}, label), input); }
export const inp = (attrs = {}) => h("input", attrs);
export const sel = (options, value, attrs = {}) => h("select", attrs, ...options.map(([v, l]) => h("option", { value: v, selected: String(v) === String(value) }, l)));

export function table(cols, rows, { onRow, empty, foot } = {}) {
  const thead = h("thead", {}, h("tr", {}, ...cols.map(c => h("th", { class: c.r ? "r" : "" }, c.l))));
  const tbody = h("tbody", {}, rows.length ? rows.map(r => h("tr", { class: onRow ? "click" : "", onclick: onRow ? () => onRow(r) : null }, ...cols.map(c => h("td", { class: `${c.r ? "r " : ""}${c.num ? "num " : ""}${c.cls || ""}` }, c.v(r))))) : h("tr", {}, h("td", { colSpan: cols.length, class: "empty" }, empty || t("Nothing here yet"))));
  const tbl = h("table", { class: "tbl" }, thead, tbody);
  if (foot) tbl.append(h("tfoot", {}, foot));
  return h("div", { class: "tbl-wrap" }, tbl);
}

export function progressBar(pct, cls = "") { return h("div", { class: "bar", title: `${pct}%` }, h("i", { class: cls, style: { width: `${Math.max(0, Math.min(100, pct))}%` } })); }

// Minimal SVG charts (no library) ----------------------------------------------------------
export function lineChart(series, { height = 160, yLabel = "", pct = false } = {}) {
  const W = 600, H = height, P = { t: 12, r: 10, b: 26, l: 38 };
  const all = series.flatMap(s => s.points);
  if (!all.length) return h("div", { class: "empty small" }, t("Nothing here yet"));
  const xs = [...new Set(all.map(p => p.x))].sort();
  const ymax = pct ? 100 : Math.max(1, ...all.map(p => p.y)) * 1.1;
  const X = x => P.l + (xs.indexOf(x) / Math.max(1, xs.length - 1)) * (W - P.l - P.r);
  const Y = y => P.t + (1 - y / ymax) * (H - P.t - P.b);
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"); svg.setAttribute("viewBox", `0 0 ${W} ${H}`); svg.classList.add("chart");
  let g = "";
  for (let i = 0; i <= 4; i++) { const y = P.t + i * (H - P.t - P.b) / 4; const v = Math.round(ymax * (1 - i / 4)); g += `<line x1="${P.l}" x2="${W - P.r}" y1="${y}" y2="${y}" stroke="var(--line)" stroke-width="1"/><text x="${P.l - 6}" y="${y + 4}" font-size="10" fill="var(--faint)" text-anchor="end">${v}${pct ? "%" : ""}</text>`; }
  const step = Math.ceil(xs.length / 6); let lastX = -99;
  xs.forEach((x, i) => { const px = X(x); if ((i % step === 0 || i === xs.length - 1) && px - lastX > 48) { lastX = px; g += `<text x="${px}" y="${H - 8}" font-size="10" fill="var(--faint)" text-anchor="middle">${x.slice(5)}</text>`; } });
  series.forEach((s, i) => {
    const pts = s.points.filter(p => p.y != null).map(p => `${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`);
    if (!pts.length) return;
    g += `<polyline points="${pts.join(" ")}" fill="none" stroke="var(--chart-${(i % 4) + 1})" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>`;
    if (s.area) g += `<polygon points="${X(s.points[0].x)},${Y(0)} ${pts.join(" ")} ${X(s.points.at(-1).x)},${Y(0)}" fill="var(--chart-${(i % 4) + 1})" opacity=".08"/>`;
  });
  svg.innerHTML = g; return svg;
}
export function barChart(items, { height = 140 } = {}) {
  const W = 600, H = height, P = { t: 10, r: 10, b: 30, l: 10 };
  if (!items.length) return h("div", { class: "empty small" }, t("Nothing here yet"));
  const max = Math.max(1, ...items.map(i => i.v));
  const bw = (W - P.l - P.r) / items.length;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"); svg.setAttribute("viewBox", `0 0 ${W} ${H}`); svg.classList.add("chart");
  svg.innerHTML = items.map((it, i) => { const bh = (it.v / max) * (H - P.t - P.b); const x = P.l + i * bw + bw * 0.15; return `<rect x="${x}" y="${H - P.b - bh}" width="${bw * 0.7}" height="${bh}" rx="4" fill="${it.color || "var(--chart-1)"}"/><text x="${x + bw * 0.35}" y="${H - P.b - bh - 4}" font-size="10" fill="var(--muted)" text-anchor="middle">${it.v}</text><text x="${x + bw * 0.35}" y="${H - 10}" font-size="10" fill="var(--faint)" text-anchor="middle">${it.l}</text>`; }).join("");
  return svg;
}
