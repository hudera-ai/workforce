// One client, two transports, same operations (shared/service.js OPS):
//  • http  — POST /api/rpc/<op> on the Node server
//  • local — runs the service in the browser against SQLite (sql.js + IndexedDB)
// GitHub Pages / file:// / ?mode=local force local; otherwise the server is tried first.
import { call, ApiError } from "../shared/service.js";
import { wrap } from "../shared/dbx.js";
import { applySeed } from "../shared/seed.js";

const TOKEN_KEY = "workforce.token", SESSION_KEY = "workforce.session", DB_VERSION = 3;

function httpClient() {
  let token = localStorage.getItem(TOKEN_KEY) || "";
  async function rpc(op, args) {
    const res = await fetch(`/api/rpc/${op}`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(args || {}) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.message || data.error || res.statusText), { status: res.status, code: data.error });
    return data;
  }
  return {
    mode: "http", rpc,
    async login(email, password) { const r = await rpc("auth.login", { email, password }); token = r.token; localStorage.setItem(TOKEN_KEY, token); return r.user; },
    async logout() { try { await rpc("auth.logout"); } catch {} token = ""; localStorage.removeItem(TOKEN_KEY); },
    async reset() { throw new Error("Use `npm run seed` on the server"); },
  };
}

const IDB = { name: "hudera-workforce", store: "db", key: "main" };
function idb() { return new Promise((ok, err) => { const r = indexedDB.open(IDB.name, 1); r.onupgradeneeded = () => r.result.createObjectStore(IDB.store); r.onsuccess = () => ok(r.result); r.onerror = () => err(r.error); }); }
async function idbGet() { try { const d = await idb(); return await new Promise((ok, err) => { const t = d.transaction(IDB.store).objectStore(IDB.store).get(IDB.key); t.onsuccess = () => ok(t.result); t.onerror = () => err(t.error); }); } catch { return null; } }
async function idbSet(v) { try { const d = await idb(); await new Promise((ok, err) => { const t = d.transaction(IDB.store, "readwrite").objectStore(IDB.store).put(v, IDB.key); t.onsuccess = ok; t.onerror = () => err(t.error); }); } catch {} }

async function localClient() {
  const SQL = await window.initSqlJs({ locateFile: f => `vendor/${f}` });
  const schema = await (await fetch("db/schema.sql")).text();
  const saved = await idbGet();
  const fresh = !saved || saved.v !== DB_VERSION;
  const db = new SQL.Database(fresh ? undefined : new Uint8Array(saved.bytes));
  const dbx = wrap(db); dbx.exec(schema);
  if (fresh || !dbx.get("SELECT 1 FROM tenants")) applySeed(dbx);
  let t = null; const persist = () => { clearTimeout(t); t = setTimeout(() => idbSet({ v: DB_VERSION, bytes: dbx.export() }), 400); };
  for (const m of ["run", "exec", "tx"]) { const o = dbx[m]; dbx[m] = (...a) => { const r = o(...a); persist(); return r; }; }
  persist();
  let ctx = JSON.parse(sessionStorage.getItem(SESSION_KEY) || "{}");
  const save = () => sessionStorage.setItem(SESSION_KEY, JSON.stringify(ctx));
  async function rpc(op, args) {
    try { const r = await call(dbx, ctx, op, args); if (op === "session.switch_tenant") save(); return r; }
    catch (e) { if (e instanceof ApiError) throw Object.assign(new Error(e.message), { status: e.status, code: e.code }); throw e; }
  }
  return {
    mode: "local", rpc,
    async login(email, password) { const r = await rpc("auth.login", { email, password }); ctx = { user: r.user }; save(); return r.user; },
    async logout() { ctx = {}; sessionStorage.removeItem(SESSION_KEY); },
    async reset() { applySeed(dbx); },
  };
}

export async function createApi() {
  const params = new URLSearchParams(location.search);
  const forced = params.get("mode");
  const onPages = /github\.io$/.test(location.hostname) || location.protocol === "file:";
  if (forced === "local" || (onPages && forced !== "http")) return localClient();
  try { const r = await fetch("/api/health", { cache: "no-store" }); if (r.ok && (await r.json()).service === "hudera-workforce") return httpClient(); } catch {}
  return localClient();
}
