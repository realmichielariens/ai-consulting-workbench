// One contestant in the lease race, run as its own OS process (spawned by
// lease-race.ts via `process.execPath --import tsx`, never a .cmd shim,
// per CLAUDE.md rule 11) so it has its own better-sqlite3 connection to the
// shared DB file — real inter-process concurrency, not two calls on one
// connection. Ported from spike/experiments/s08-sqlite/src/lease-worker.ts
// (M0 S8), adapted to the production leases.ts repository and schema
// (scope_key-keyed `sessions`, not the spike's session_id-keyed table).
//
// Usage: tsx lease-race-worker.ts <dbFile> <workerId> <rounds> <outFile> <barrierDir> <workerCount>
//
// For each round r, every worker calls the *production* acquireLease() for
// scope_key = `race:<r>`. A file-based barrier makes every worker attempt
// BEGIN IMMEDIATE for the same round at close to the same instant — without
// it, process-start jitter alone (tens of ms) means whichever worker starts
// first just wins every round on its own, which would not exercise SQLite's
// write-lock serialization under WAL + busy_timeout at all.

import fs from "node:fs";
import path from "node:path";
import { openEngagementDb } from "../src/client.js";
import { acquireLease } from "../src/repos/leases.js";

const [, , dbFile, workerId, roundsArg, outFile, barrierDir, workerCountArg] = process.argv;
const rounds = Number(roundsArg);
const workerCount = Number(workerCountArg);

function barrierWait(round: number): void {
  const marker = path.join(barrierDir!, `r${round}-${workerId}.ready`);
  fs.writeFileSync(marker, "");
  const prefix = `r${round}-`;
  const deadline = Date.now() + 10_000;
  for (;;) {
    const ready = fs.readdirSync(barrierDir!).filter((f) => f.startsWith(prefix)).length;
    if (ready >= workerCount) return;
    if (Date.now() > deadline) throw new Error(`barrier timeout at round ${round} (${ready}/${workerCount})`);
  }
}

const ctx = openEngagementDb(dbFile!);

const wins: { round: number; holder: string; tookMs: number }[] = [];

for (let r = 0; r < rounds; r++) {
  barrierWait(r);
  const holder = `${workerId}-r${r}`;
  const now = Date.now();

  const t0 = performance.now();
  const { acquired } = acquireLease(ctx, { scopeKey: `race:${r}`, role: "work", holder, leaseMs: 5000, now });
  const tookMs = performance.now() - t0;

  if (acquired) wins.push({ round: r, holder, tookMs });
}

fs.writeFileSync(outFile!, JSON.stringify({ workerId, wins }, null, 2));
ctx.close();
