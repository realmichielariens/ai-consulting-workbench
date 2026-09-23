// S8 §4 step 4: leases. Orchestrates the multi-process race
// (see lease-worker.ts), then runs expiry and renewal checks in-process.

import Database from "better-sqlite3";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export type RaceResult = {
  rounds: number;
  workers: number;
  totalAttempts: number;
  roundsWithExactlyOneWinner: number;
  roundsWithZeroWinners: number;
  roundsWithMultipleWinners: number;
  winnersByWorker: Record<string, number>;
  sampleWinnerLog: { round: number; winner: string }[];
};

/**
 * Spawns `workers` separate `node`/`tsx` processes, each racing all
 * `rounds` rounds for `race:<r>` scope keys against a shared SQLite file.
 * Exactly one process should win each round (see lease-worker.ts for the
 * SQL). Verified here by merging every worker's win log and checking for
 * duplicate or missing winners per round.
 */
export async function runLeaseRace(
  dbPath: string,
  workers: number,
  rounds: number,
  workDir: string,
): Promise<RaceResult> {
  const setupDb = new Database(dbPath);
  setupDb.pragma("journal_mode = WAL");
  setupDb.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      session_id   TEXT PRIMARY KEY,
      role         TEXT NOT NULL,
      scope_key    TEXT NOT NULL UNIQUE,
      lease_holder TEXT,
      lease_until  INTEGER,
      status       TEXT NOT NULL DEFAULT 'active'
    );
  `);
  setupDb.close();

  const workerScript = path.join(__dirname, "lease-worker.ts");
  const outFiles = Array.from({ length: workers }, (_, i) => path.join(workDir, `race-out-${i}.json`));
  const barrierDir = path.join(workDir, "barrier");
  fs.mkdirSync(barrierDir, { recursive: true });

  // Spawn plain `node --import tsx <script>` rather than the tsx.cmd shim:
  // on Windows, spawning a .cmd file needs shell:true (cmd.exe as the real
  // executable) or it fails with EINVAL. Using node directly with --import
  // avoids that and is what the shared package.json's own "test" script
  // already does (node --import tsx --test ...).
  const runs = outFiles.map(
    (outFile, i) =>
      new Promise<void>((resolve, reject) => {
        const child = spawn(
          process.execPath,
          [
            "--import",
            "tsx",
            workerScript,
            dbPath,
            `w${i}`,
            String(rounds),
            outFile,
            barrierDir,
            String(workers),
          ],
          { stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
        );
        let stderr = "";
        child.stderr.on("data", (d) => (stderr += d.toString()));
        child.on("exit", (code) => {
          if (code === 0) resolve();
          else reject(new Error(`lease-worker w${i} exited ${code}: ${stderr}`));
        });
        child.on("error", reject);
      }),
  );

  await Promise.all(runs);

  // Merge every worker's win log.
  const winnersByRound = new Map<number, string[]>();
  const winnersByWorker: Record<string, number> = {};
  for (const outFile of outFiles) {
    const { workerId, wins } = JSON.parse(fs.readFileSync(outFile, "utf8")) as {
      workerId: string;
      wins: { round: number; sessionId: string }[];
    };
    winnersByWorker[workerId] = wins.length;
    for (const w of wins) {
      const list = winnersByRound.get(w.round) ?? [];
      list.push(w.sessionId);
      winnersByRound.set(w.round, list);
    }
  }

  let exactlyOne = 0;
  let zero = 0;
  let multiple = 0;
  const sampleWinnerLog: { round: number; winner: string }[] = [];
  for (let r = 0; r < rounds; r++) {
    const list = winnersByRound.get(r) ?? [];
    if (list.length === 0) zero++;
    else if (list.length === 1) exactlyOne++;
    else multiple++;
    if (r < 10) sampleWinnerLog.push({ round: r, winner: list.join(",") || "(none)" });
  }

  return {
    rounds,
    workers,
    totalAttempts: rounds * workers,
    roundsWithExactlyOneWinner: exactlyOne,
    roundsWithZeroWinners: zero,
    roundsWithMultipleWinners: multiple,
    winnersByWorker,
    sampleWinnerLog,
  };
}

export type ExpiryResult = {
  firstAcquireChanges: number;
  immediateStealAttemptChanges: number; // should be 0 (not yet expired)
  afterExpiryStealChanges: number; // should be 1 (expired, stolen)
  newHolder: string;
};

/** §4 step 4: an expired lease can be taken over by a different holder. */
export function testExpiry(dbPath: string): ExpiryResult {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions_expiry (
      session_id   TEXT PRIMARY KEY,
      role         TEXT NOT NULL,
      scope_key    TEXT NOT NULL UNIQUE,
      lease_holder TEXT,
      lease_until  INTEGER,
      status       TEXT NOT NULL DEFAULT 'active'
    );
  `);

  const upsert = db.prepare(`
    INSERT INTO sessions_expiry (session_id, role, scope_key, lease_holder, lease_until, status)
    VALUES (@sessionId, 'work', @scopeKey, @holder, @leaseUntil, 'active')
    ON CONFLICT(scope_key) DO UPDATE SET
      session_id = excluded.session_id, lease_holder = excluded.lease_holder,
      lease_until = excluded.lease_until, status = 'active'
    WHERE sessions_expiry.lease_until < @now
  `);

  const scopeKey = "work:WI-EXPIRY-TEST";
  const shortLeaseMs = 80;

  const now1 = Date.now();
  const r1 = upsert.run({ sessionId: "holder-A", scopeKey, holder: "holder-A", leaseUntil: now1 + shortLeaseMs, now: now1 });

  const now2 = Date.now();
  const r2 = upsert.run({ sessionId: "holder-B", scopeKey, holder: "holder-B", leaseUntil: now2 + 60000, now: now2 });

  const waitUntil = now1 + shortLeaseMs + 30;
  while (Date.now() < waitUntil) {
    /* busy-wait a few ms so we don't need an async sleep in this sync helper */
  }

  const now3 = Date.now();
  const r3 = upsert.run({ sessionId: "holder-C", scopeKey, holder: "holder-C", leaseUntil: now3 + 60000, now: now3 });

  const row = db.prepare("SELECT lease_holder FROM sessions_expiry WHERE scope_key = ?").get(scopeKey) as
    | { lease_holder: string }
    | undefined;

  db.close();

  return {
    firstAcquireChanges: r1.changes,
    immediateStealAttemptChanges: r2.changes,
    afterExpiryStealChanges: r3.changes,
    newHolder: row?.lease_holder ?? "(none)",
  };
}

export type RenewalResult = {
  acquireChanges: number;
  renewChanges: number;
  leaseUntilBefore: number;
  leaseUntilAfter: number;
  stealAttemptAfterRenewChanges: number; // should be 0: renewal pushed expiry out
};

/** §4 step 4: the holder renews its own lease before expiry, extending it. */
export function testRenewal(dbPath: string): RenewalResult {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions_renewal (
      session_id   TEXT PRIMARY KEY,
      role         TEXT NOT NULL,
      scope_key    TEXT NOT NULL UNIQUE,
      lease_holder TEXT,
      lease_until  INTEGER,
      status       TEXT NOT NULL DEFAULT 'active'
    );
  `);

  const upsert = db.prepare(`
    INSERT INTO sessions_renewal (session_id, role, scope_key, lease_holder, lease_until, status)
    VALUES (@sessionId, 'work', @scopeKey, @holder, @leaseUntil, 'active')
    ON CONFLICT(scope_key) DO UPDATE SET
      session_id = excluded.session_id, lease_holder = excluded.lease_holder,
      lease_until = excluded.lease_until, status = 'active'
    WHERE sessions_renewal.lease_until < @now
  `);

  // A renewal is just the holder updating its own row directly (it already
  // owns the scope_key; no ON CONFLICT race needed for its own renewal).
  const renew = db.prepare(`
    UPDATE sessions_renewal SET lease_until = @leaseUntil
    WHERE scope_key = @scopeKey AND session_id = @sessionId
  `);

  const scopeKey = "work:WI-RENEW-TEST";
  const now1 = Date.now();
  const r1 = upsert.run({ sessionId: "holder-A", scopeKey, holder: "holder-A", leaseUntil: now1 + 100, now: now1 });

  const before = db.prepare("SELECT lease_until FROM sessions_renewal WHERE scope_key = ?").get(scopeKey) as {
    lease_until: number;
  };

  const r2 = renew.run({ sessionId: "holder-A", scopeKey, leaseUntil: Date.now() + 60000 });

  const after = db.prepare("SELECT lease_until FROM sessions_renewal WHERE scope_key = ?").get(scopeKey) as {
    lease_until: number;
  };

  // Another holder tries to steal right after renewal — should fail since
  // lease_until is now far in the future.
  const now3 = Date.now();
  const r3 = upsert.run({ sessionId: "holder-B", scopeKey, holder: "holder-B", leaseUntil: now3 + 60000, now: now3 });

  db.close();

  return {
    acquireChanges: r1.changes,
    renewChanges: r2.changes,
    leaseUntilBefore: before.lease_until,
    leaseUntilAfter: after.lease_until,
    stealAttemptAfterRenewChanges: r3.changes,
  };
}
