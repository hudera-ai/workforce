// SQLite via sql.js (WebAssembly) persisted to a file. Zero native dependencies, so
// `npm install` works on any machine. Every write is flushed to disk shortly after.

import initSqlJs from "sql.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { wrap } from "../../shared/dbx.js";
import { applySeed } from "../../shared/seed.js";

const here = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = process.env.DATA_DIR || path.join(here, "..", "..", "data");
export const DB_FILE = path.join(DATA_DIR, "workforce.sqlite");
const SCHEMA = fs.readFileSync(path.join(here, "..", "..", "db", "schema.sql"), "utf8");

export async function openDb({ seed = "auto" } = {}) {
  const SQL = await initSqlJs();
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const exists = fs.existsSync(DB_FILE);
  const db = new SQL.Database(exists ? fs.readFileSync(DB_FILE) : undefined);
  const dbx = wrap(db);
  dbx.exec(SCHEMA);
  const empty = !dbx.get("SELECT 1 FROM tenants");
  if (seed === "force" || (seed === "auto" && empty)) { applySeed(dbx); console.log("[db] sample data loaded"); }

  let timer = null;
  dbx.save = () => { fs.writeFileSync(DB_FILE, Buffer.from(db.export())); };
  dbx.touch = () => { clearTimeout(timer); timer = setTimeout(dbx.save, 250); };
  // Persist after every mutating call
  for (const m of ["run", "exec", "tx"]) { const orig = dbx[m]; dbx[m] = (...a) => { const r = orig(...a); dbx.touch(); return r; }; }
  dbx.save();
  process.on("SIGINT", () => { dbx.save(); process.exit(0); });
  process.on("SIGTERM", () => { dbx.save(); process.exit(0); });
  return dbx;
}
