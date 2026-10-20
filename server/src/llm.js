// Optional LLM layer. The built-in engine (shared/agent) handles the structured work — identity checks,
// data lookups, rules, approvals — deterministically. When an LLM key is configured, the server also
// uses it for one narrow job: answering free-text questions the engine could not classify, strictly
// from the tenant's own knowledge documents, and handing over to a human when the documents are silent.
// No key → this module is inert and the platform runs fully on the built-in engine.

const PROVIDER = process.env.LLM_PROVIDER || (process.env.ANTHROPIC_API_KEY ? "anthropic" : process.env.OPENAI_API_KEY ? "openai" : null);
export const llmEnabled = () => !!PROVIDER;
export const llmInfo = () => (PROVIDER ? { provider: PROVIDER, model: process.env.LLM_MODEL || (PROVIDER === "anthropic" ? "claude-sonnet-5-5" : "gpt-4o-mini") } : null);

function prompt({ agent, tenant, lang, docs }) {
  return [
    `You are ${agent.name} (${agent.name_ar}), a ${agent.role} assistant for ${tenant.name_en} (${tenant.name_ar}), replying on WhatsApp.`,
    `Reply in ${lang === "ar" ? "Arabic (Gulf/Saudi tone, short)" : "English (short)"}.`,
    "Answer ONLY from the company documents below. If the answer is not clearly in them, reply exactly: HANDOFF",
    "Never invent numbers, dates or policies. Never ask for passwords, ID numbers or card numbers.",
    "--- Company documents ---", ...docs.map(d => `# ${d.title}\n${d.body}`),
  ].join("\n");
}

export async function llmAnswer({ agent, tenant, lang, docs, text }) {
  if (!PROVIDER) return null;
  const system = prompt({ agent, tenant, lang, docs }); const model = llmInfo().model;
  try {
    if (PROVIDER === "anthropic") {
      const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model, max_tokens: 400, system, messages: [{ role: "user", content: text }] }) });
      const j = await r.json(); return j?.content?.[0]?.text?.trim() || null;
    }
    const r = await fetch("https://api.openai.com/v1/chat/completions", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({ model, max_tokens: 400, messages: [{ role: "system", content: system }, { role: "user", content: text }] }) });
    const j = await r.json(); return j?.choices?.[0]?.message?.content?.trim() || null;
  } catch (e) { console.error("[llm]", e.message); return null; }
}
