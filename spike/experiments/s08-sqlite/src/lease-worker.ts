// S8 §4 step 4: one contestant in the lease race, run as its own OS
// process (via child_process.spawn from leases.ts) so it has its own
// better-sqlite3 connection to the same DB file — this is the "two
// contexts concurrently" the plan asks for, not two calls on one
// connection in one process.
//
// Usage: tsx lease-worker.ts <dbPath> <workerId> <rounds> <outFile> <barrierDir> <workers>
//
// <barrierDir> + <workers> implement a simple file-based barrier: before
// racing round r, each worker drops a `r<r>-<workerId>.ready` marker and
// busy-polls the directory until all <workers> markers for that round
// exist. Without this, worker processes drift apart (process-start jitter
// alone is tens of ms) and each round stops being a real race — whichever
// worker happens to be ahead just wins every round on its own. The barrier
// forces every worker to hit BEGIN IMMEDIATE for the same scope_key at
// close to the same instant, which is what actually exercises SQLite's
// write-lock serialization under WAL + busy_timeout.
//
// For each round r in [0, rounds), it races every other worker for
// scope_key = `race:<r>` using a single BEGIN IMMEDIATE transaction:
//
//   INSERT INTO sessions (session_id, role, scope_key, lease_holder, lease_until, status)
//   VALUES (?, 'work', ?, ?, ?, 'active')
//   ON CONFLICT(scope_key) DO UPDATE SET
//     session_id   = excluded.session_id,
//     lease_holder = excluded.lease_holder,
//     lease_until  = excluded.lease_until,
//     status       = 'active'
//   WHERE sessions.lease_until < ?   -- only steal an expired lease
//
// BEGIN IMMEDIATE takes the write lock up front, so under WAL + a
// busy_timeout the other worker processes block (and retry) rather than
// failing with SQLITE_BUSY. changes === 1 after the statement means this
// attempt won the round (fresh insert, or the previous lease had expired).
// changes === 0 means an active, unexpired lease already held the row.

import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const [, , dbPath, workerId, roundsArg, outFile, barrierDir, workersArg] = process.argv;
const rounds = Number(roundsArg);
const workerCount = Number(workersArg);

function barrierWait(round: number): void {
  const marker = path.join(barrierDir, `r${round}-${workerId}.ready`);
  fs.writeFileSync(marker, "");
  const prefix = `r${round}-`;
  const deadline = Date.now() + 10_000;
  for (;;) {
    const ready = fs.readdirSync(barrierDir).filter((f) => f.startsWith(prefix)).length;
    if (ready >= workerCount) return;
    if (Date.now() > deadline) throw new Error(`barrier timeout at round ${round} (${ready}/${workerCount})`);
  }
}

const db = new Database(dbPath, { timeout: 5000 });
db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 5000");

const upsert = db.prepare(`
  INSERT INTO sessions (session_id, role, scope_key, lease_holder, lease_until, status)
  VALUES (@sessionId, 'work', @scopeKey, @holder, @leaseUntil, 'active')
  ON CONFLICT(scope_key) DO UPDATE SET
    session_id   = excluded.session_id,
    lease_holder = excluded.lease_holder,
    lease_until  = excluded.lease_until,
    status       = 'active'
  WHERE sessions.lease_until < @now
`);

const wins: { round: number; sessionId: string; tookMs: number }[] = [];

for (let r = 0; r < rounds; r++) {
  barrierWait(r);
  const scopeKey = `race:${r}`;
  const sessionId = `${workerId}-r${r}`;
  const now = Date.now();
  const leaseUntil = now + 5000; // 5s lease, well clear of this race's duration

  const t0 = performance.now();
  let changes = 0;

  // better-sqlite3's db.transaction() wrapper always issues a plain BEGIN,
  // so to get BEGIN IMMEDIATE (take the write lock up front, forcing other
  // processes to queue behind busy_timeout instead of racing to read-then-
  // write) we manage the transaction by hand.
  db.exec("BEGIN IMMEDIATE");
  try {
    const info = upsert.run({ sessionId, scopeKey, holder: workerId, leaseUntil, now });
    changes = info.changes;
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  const tookMs = performance.now() - t0;

  if (changes === 1) {
    wins.push({ round: r, sessionId, tookMs });
  }
}

fs.writeFileSync(outFile, JSON.stringify({ workerId, wins }, null, 2));
db.close();
