import initSqlJs from "sql.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { wrap } from "../shared/dbx.js";
import { applySeed } from "../shared/seed.js";
import { call } from "../shared/service.js";
const here = path.dirname(fileURLToPath(import.meta.url));
let SQL;
export async function freshDb() {
  SQL ||= await initSqlJs();
  const dbx = wrap(new SQL.Database());
  dbx.exec(fs.readFileSync(path.join(here, "..", "db", "schema.sql"), "utf8"));
  applySeed(dbx);
  return dbx;
}
export async function as(dbx, email) { const r = await call(dbx, {}, "auth.login", { email, password: "demo1234" }); return { user: r.user }; }
export const nextWorkday = n => { let d = new Date(), k = 0; while (k < n) { d.setDate(d.getDate() + 1); if (![5, 6].includes(d.getDay())) k++; } return d; };
export const MON_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
