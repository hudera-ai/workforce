// "Try it live": message an AI employee as an employee / customer / lead and watch every step it takes.
import { h, ic, toast, chip } from "../ui.js";
import { t, tt, LANG, nf, money } from "../i18n.js";
import { rpc, app, navigate, updateBadges } from "../main.js";
import { avatar, agentName, ROLE_LABEL, trace, bubbles, KIND_LABEL } from "./common.js";

const MON_AR = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"], MON_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function workday(n) { let d = new Date(), k = 0; while (k < n) { d.setDate(d.getDate() + 1); if (![5, 6].includes(d.getDay())) k++; } return d; }
const dAr = d => `${d.getDate()} ${MON_AR[d.getMonth()]}`, dEn = d => `${d.getDate()} ${MON_EN[d.getMonth()]}`;

function samples(role, contactType) {
  const a = workday(6), b = workday(8);
  if (role === "hr" && contactType === "candidate") return [["عندكم وظائف؟", "Asks for jobs"], ["1", "Picks job 1"],
    ["Ahmed Saleh — HR Officer with 4 years experience. Payroll for 250 staff, GOSI and Qiwa contracts, Mudad, Saudi labor law, advanced Excel, English.", "Sends a CV"], ["1", "Books slot 1"]];
  if (role === "hr") return [["السلام عليكم", "Greeting"], ["كم رصيد إجازتي؟", "Leave balance"], [`ابغى اجازة من ${dAr(a)} الى ${dAr(b)}`, "Leave request"], ["نعم", "Confirms"],
    ["ابغى تعريف بالراتب لبنك الراجحي", "Salary certificate"], ["وين وصل طلب اجازتي؟", "Request status"], ["متى ينزل الراتب؟", "Payday"], ["كم يوم إجازة مرضية مدفوعة؟", "Policy (Arabic)"],
    [`I need annual leave from ${dEn(a)} to ${dEn(b)}`, "Leave (English)"], ["What is the overtime policy?", "Policy (English)"], ["Can I bring my cat to the office?", "Not in the policy"], ["ابغى اكلم موظف", "Ask for a human"]];
  if (role === "collections") return [["كم المستحق علينا؟", "Statement"], ["بنحول المبلغ يوم الخميس الجاي", "Promise to pay"], ["بنسدد بعد شهرين إن شاء الله", "Long extension"],
    ["We transferred the payment yesterday, reference TRX55120", "Payment claim"], ["Please resend the invoice copy", "Invoice copy"], ["في خطأ في الفاتورة، ما استلمنا الخدمة كاملة", "Dispute"]];
  return [["السلام عليكم، بكم عقد النظافة لمبنى إداري 4 أدوار في جدة؟", "Price inquiry"], ["نبغى نبدأ الشهر الجاي، شركة الأفق القابضة", "Adds details"], ["1", "Books slot 1"],
    ["We need pest control for 2 warehouses in Dammam next week", "English inquiry"], ["Do you provide security guards in Abha?", "Outside area"], ["محتاج اكلم حد من المبيعات", "Ask for a human"]];
}

export async function simulator(app_, route) {
  const agents = app.session.agents;
  if (!agents.length) return h("div", { class: "empty" }, t("Hire an AI employee first."), " ", h("a", { href: "#/agents?hire=1" }, t("Hire")));
  const agent = agents.find(a => a.id === +route.params.agent) || agents[0];
  const contacts = await rpc("simulate.contacts", { agent_id: agent.id });
  if (!Array.isArray(contacts)) throw new Error("contacts: " + JSON.stringify(contacts).slice(0, 120));
  let contact = contacts.find(c => c.phone === route.params.phone) || contacts[agent.role === "sales" ? 0 : 0];
  let messages = [], lastTrace = null, lastResult = null, selected = null;

  const chat = h("div", { class: "wa-body" });
  const traceBox = h("div", { class: "trace-wrap" });
  const effects = h("div", { class: "effects" });
  const input = h("textarea", { rows: 1, placeholder: t("Type a message…"), onkeydown: e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } } });
  const sampleBox = h("div", { class: "samples" });

  async function loadConv() {
    const list = await rpc("conversations.list", { agent_id: agent.id, q: contact.phone, limit: 1 });
    const conv = list.find(c => c.contact_phone === contact.phone);
    messages = conv ? await rpc("conversations.messages", { id: conv.id }) : [];
    const last = [...messages].reverse().find(m => m.direction === "out" && m.trace);
    lastTrace = last?.trace || null; selected = last?.id; drawChat(); drawTrace(false); effects.replaceChildren();
    if (conv?.status === "waiting_human") effects.append(h("div", { class: "banner" }, ic("hand"), t("A human has this conversation — the AI stays silent until it is handed back."), " ", h("button", { class: "btn sm", onclick: async () => { await rpc("conversations.handback", { id: conv.id }); loadConv(); } }, t("Hand back to AI"))));
  }
  function drawChat(typing) {
    chat.replaceChildren(h("div", { class: "wa-day" }, t("Conversation with {n}", { n: agentName(agent) })),
      ...bubbles(messages, { selected, onTrace: m => { selected = m.id; lastTrace = m.trace; drawChat(); drawTrace(false); } }),
      ...(typing ? [h("div", { class: "bub out typing" }, h("i"), h("i"), h("i"))] : []));
    chat.scrollTop = chat.scrollHeight;
  }
  function drawTrace(animate) {
    traceBox.replaceChildren(lastTrace ? trace(lastTrace, { animate }) : h("div", { class: "empty small" }, ic("flow"), h("div", {}, t("Send a message — every step the AI employee takes appears here: who it identified, what it understood, which data it read, which rule applied, and whether a human must approve."))));
  }
  function drawSamples() {
    sampleBox.replaceChildren(...samples(agent.role, contact.type).map(([txt, lbl]) => h("button", { class: "smp", title: txt, onclick: () => { input.value = txt; send(); } }, h("b", {}, t(lbl)), h("span", {}, txt.length > 46 ? txt.slice(0, 46) + "…" : txt))));
  }
  async function send() {
    const text = input.value.trim(); if (!text) return;
    input.value = ""; messages.push({ id: -1, direction: "in", author: "contact", body: text, at: new Date().toISOString() }); drawChat(true);
    try {
      const [r] = await Promise.all([rpc("simulate.send", { agent_id: agent.id, contact: { type: contact.type, id: contact.id, name: contact.name?.split(" · ")[0].replace(/ \(job seeker\)$/, ""), phone: contact.phone }, text }), new Promise(ok => setTimeout(ok, 650))]);
      messages = r.messages; lastTrace = r.trace; lastResult = r; selected = [...messages].reverse().find(m => m.direction === "out")?.id;
      drawChat(); drawTrace(true); drawEffects(r);
      updateBadges();
    } catch (e) { messages.pop(); drawChat(); toast(e.message, true); }
  }
  async function drawEffects(r) {
    effects.replaceChildren();
    if (!r.reply) effects.append(h("div", { class: "banner" }, ic("hand"), t("No automatic reply — a human has this conversation.")));
    if (r.tasks?.length) effects.append(h("div", { class: "eff" }, ic("check"), t("{n} task(s) logged for {a}", { n: r.tasks.length, a: agentName(agent) })));
    if (!r.approvals?.length) return;
    const pend = (await rpc("approvals.list", { status: "pending" })).filter(a => r.approvals.includes(a.id));
    for (const ap of pend) effects.append(h("div", { class: "card appr-mini" }, h("div", { class: "bd col", style: { gap: "8px" } },
      h("div", { class: "row" }, ic("hand"), h("b", { class: "small" }, t("Needs human approval")), h("span", { class: "sp" }), chip(t(ap.approver_role), "amber")),
      h("div", { class: "small", style: { color: "var(--ink)" } }, tt(ap.title)), ap.summary ? h("div", { class: "xs muted" }, ap.summary) : null,
      ap.can_decide ? h("div", { class: "row" },
        h("button", { class: "btn sm primary", onclick: async () => { await rpc("approvals.decide", { id: ap.id, status: "approved" }); toast(t("Approved — the AI employee notified the requester")); await loadConv(); updateBadges(); } }, ic("check"), t("Approve")),
        h("button", { class: "btn sm", onclick: async () => { await rpc("approvals.decide", { id: ap.id, status: "rejected", comment: LANG === "ar" ? "يرجى التنسيق مع المدير المباشر" : "Please coordinate with your manager" }); toast(t("Rejected — the requester was told why")); await loadConv(); updateBadges(); } }, ic("x"), t("Reject")))
        : h("div", { class: "xs muted" }, t("Sign in as the {r} to decide, or open Approvals.", { r: t(ap.approver_role) })))));
  }

  const agentTabs = h("div", { class: "agent-tabs" }, ...agents.map(a => h("button", { class: a.id === agent.id ? "on" : "", onclick: () => navigate(`#/simulator?agent=${a.id}`) }, avatar(a, 28), h("span", {}, h("b", {}, agentName(a)), h("small", {}, t(ROLE_LABEL[a.role]))))));
  const contactSel = h("select", { onchange: e => { contact = contacts[+e.target.value]; drawSamples(); loadConv(); } }, ...contacts.map((c, i) => h("option", { value: i, selected: c === contact },
    `${LANG === "ar" && c.name_ar ? c.name_ar : c.name}${c.sub ? ` — ${c.type === "customer" ? money(c.sub) + " " + t("open") : t(c.sub)}` : ""}`)));

  drawSamples(); await loadConv();
  return h("div", {},
    h("div", { class: "topbar" }, h("div", {}, h("div", { class: "crumb" }, t("Try it live")), h("h1", {}, t("Message an AI employee"))),
      h("span", { class: "chip violet" }, ic("bot"), t("Built-in AI engine · runs in your browser"))),
    agentTabs,
    h("div", { class: "sim" },
      h("div", { class: "card sim-left" }, h("div", { class: "hd" }, h("h2", {}, t("You are"))),
        h("div", { class: "bd col" }, contactSel,
          h("div", { class: "xs muted" }, contact.type === "employee" ? t("A registered employee — the AI recognises the mobile number on the HR file.") : contact.type === "customer" ? t("A customer contact — the AI reads this customer's invoices.") : contact.type === "candidate" ? t("An unregistered number — personal HR data is protected; jobs and policies are open.") : t("A new or existing lead writing on WhatsApp.")),
          h("button", { class: "btn sm ghost", onclick: async () => { await rpc("simulate.reset", { agent_id: agent.id, phone: contact.phone }); toast(t("Conversation state cleared")); loadConv(); } }, ic("refresh"), t("Restart flow"))),
        h("div", { class: "hd", style: { borderTop: "1px solid var(--line)" } }, h("h2", {}, t("Try these"))), h("div", { class: "bd" }, sampleBox)),
      h("div", { class: "phone" },
        h("div", { class: "wa-head" }, avatar(agent, 34), h("div", {}, h("b", {}, `${agentName(agent)} · ${LANG === "ar" ? app.session.tenant.name_ar : app.session.tenant.name_en}`), h("small", {}, t("AI employee · replies in seconds")))),
        chat,
        h("div", { class: "wa-in" }, input, h("button", { class: "btn primary", onclick: send, "aria-label": t("Send") }, ic("send")))),
      h("div", { class: "card sim-right" }, h("div", { class: "hd" }, ic("flow"), h("h2", {}, t("How it decided")), h("span", { class: "sp" }), h("span", { class: "xs faint" }, t("live trace"))),
        h("div", { class: "bd" }, effects, traceBox))));
}
