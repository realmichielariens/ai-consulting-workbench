// S8 §4 step 6: performance smoke test. 10k events inserted (single
// transaction, and separately per-row autocommit) and queried.

import Database from "better-sqlite3";

export type PerfResult = {
  n: number;
  insertSingleTxnMs: number;
  insertPerRowAutocommitMs: number;
  queryCountMs: number;
  queryFilterMs: number;
  queryOrderLimitMs: number;
};

export function runPerfSmoke(dbPath: string, n = 10_000): PerfResult {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(`
    DROP TABLE IF EXISTS events;
    CREATE TABLE events (
      seq     INTEGER PRIMARY KEY AUTOINCREMENT,
      type    TEXT NOT NULL,
      actor   TEXT NOT NULL,
      payload TEXT,
      at      INTEGER NOT NULL
    );
  `);

  const insertStmt = db.prepare(
    "INSERT INTO events (type, actor, payload, at) VALUES (@type, @actor, @payload, @at)",
  );

  // 1. Single transaction (better-sqlite3's db.transaction() wrapper).
  const t0 = performance.now();
  const insertMany = db.transaction((rows: any[]) => {
    for (const row of rows) insertStmt.run(row);
  });
  const rows1 = Array.from({ length: n }, (_, i) => ({
    type: i % 5 === 0 ? "AssetPublished" : "RunProgress",
    actor: `agent:WI-${(i % 40).toString().padStart(3, "0")}`,
    payload: JSON.stringify({ i, note: "synthetic perf event" }),
    at: Date.now() + i,
  }));
  insertMany(rows1);
  const insertSingleTxnMs = performance.now() - t0;

  // Reset for the per-row (autocommit) case, same row count.
  db.exec("DELETE FROM events;");

  const t1 = performance.now();
  for (let i = 0; i < n; i++) {
    insertStmt.run({
      type: i % 5 === 0 ? "AssetPublished" : "RunProgress",
      actor: `agent:WI-${(i % 40).toString().padStart(3, "0")}`,
      payload: JSON.stringify({ i, note: "synthetic perf event" }),
      at: Date.now() + i,
    });
  }
  const insertPerRowAutocommitMs = performance.now() - t1;

  // Re-insert the transaction batch on top so queries run against a full n*2 table
  // is unnecessary; instead restore just n rows for clean query timings.
  db.exec("DELETE FROM events;");
  insertMany(rows1);

  const t2 = performance.now();
  const countRow = db.prepare("SELECT count(*) as n FROM events").get() as { n: number };
  const queryCountMs = performance.now() - t2;

  const t3 = performance.now();
  const filterRows = db.prepare("SELECT * FROM events WHERE type = ?").all("AssetPublished");
  const queryFilterMs = performance.now() - t3;

  const t4 = performance.now();
  const orderRows = db.prepare("SELECT * FROM events ORDER BY at DESC LIMIT 50").all();
  const queryOrderLimitMs = performance.now() - t4;

  db.close();

  if (countRow.n !== n) throw new Error(`expected ${n} rows, got ${countRow.n}`);
  if (filterRows.length !== Math.ceil(n / 5)) {
    throw new Error(`expected ${Math.ceil(n / 5)} AssetPublished rows, got ${filterRows.length}`);
  }
  if (orderRows.length !== 50) throw new Error(`expected 50 rows from LIMIT 50, got ${orderRows.length}`);

  return {
    n,
    insertSingleTxnMs,
    insertPerRowAutocommitMs,
    queryCountMs,
    queryFilterMs,
    queryOrderLimitMs,
  };
}
