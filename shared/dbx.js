// Thin wrapper around a sql.js Database so the same service code runs on the
// server (Node) and in the browser demo. No ORM: plain SQL, plain objects.

export function wrap(db) {
  const api = {
    raw: db,
    run(sql, params = []) {
      db.run(sql, params);
      const changes = db.getRowsModified();
      const r = db.exec("SELECT last_insert_rowid() AS id");
      return { lastId: r[0]?.values[0][0] ?? null, changes };
    },
    all(sql, params = []) {
      const st = db.prepare(sql);
      try {
        st.bind(params);
        const rows = [];
        while (st.step()) rows.push(st.getAsObject());
        return rows;
      } finally { st.free(); }
    },
    get(sql, params = []) { return api.all(sql, params)[0] ?? null; },
    exec(sql) { db.exec(sql); },
    tx(fn) {
      db.exec("BEGIN");
      try { const out = fn(); db.exec("COMMIT"); return out; }
      catch (e) { db.exec("ROLLBACK"); throw e; }
    },
    export() { return db.export(); },
  };
  return api;
}

export function applySchema(dbx, schemaSql) { dbx.exec(schemaSql); }
