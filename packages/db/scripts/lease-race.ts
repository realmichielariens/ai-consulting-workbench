// Multi-process lease race: 5 processes x 200 rounds by default, ported from
// spike/experiments/s08-sqlite (M0 S8, FINDINGS.md: "200/200 rounds, exactly
// one winner across 5 processes"). Exercises the *production* leases.ts
// acquireLease() against the real schema, not a copy.
//
// This is part of I1's full validation (I1-PLAN.md §6 W3), not a quick
// check: CLAUDE.md rule 5 and I1-PLAN.md §3.1 both list "multi-process
// stress tests (the lease race)" as something that runs only after a "go",
// never before. Run explicitly with `pnpm --filter @workbench/db run
// test:stress`; it is not part of `pnpm test`.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { openEngagementDb } from "../src/client.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const WORKERS = Number(process.env.LEASE_RACE_WORKERS ?? 5);
const ROUNDS = Number(process.env.LEASE_RACE_ROUNDS ?? 200);

async function main(): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "workbench-lease-race-"));
  const dbFile = path.join(dir, "state.db");

  // Run migrations once, up front, so the N worker processes race only on
  // the sessions table, not on creating the schema concurrently.
  const setup = openEngagementDb(dbFile);
  setup.close();

  const workerScript = path.join(__dirname, "lease-race-worker.ts");
  const outFiles = Array.from({ length: WORKERS }, (_, i) => path.join(dir, `race-out-${i}.json`));
  const barrierDir = path.join(dir, "barrier");
  fs.mkdirSync(barrierDir, { recursive: true });

  console.log(`Lease race: ${WORKERS} processes x ${ROUNDS} rounds, db=${dbFile}`);

  // Spawn plain `node --import tsx <script>`, never the tsx.cmd shim
  // (CLAUDE.md rule 11): on Windows, spawning a .cmd needs shell:true, which
  // this deliberately avoids.
  const runs = outFiles.map(
    (outFile, i) =>
      new Promise<void>((resolve, reject) => {
        const child = spawn(
          process.execPath,
          ["--import", "tsx", workerScript, dbFile, `w${i}`, String(ROUNDS), outFile, barrierDir, String(WORKERS)],
          { stdio: ["ignore", "inherit", "inherit"], windowsHide: true },
        );
        child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`worker w${i} exited ${code}`))));
        child.on("error", reject);
      }),
  );

  await Promise.all(runs);

  const winnersByRound = new Map<number, string[]>();
  for (const outFile of outFiles) {
    const { workerId, wins } = JSON.parse(fs.readFileSync(outFile, "utf8")) as { workerId: string; wins: { round: number }[] };
    for (const w of wins) {
      const list = winnersByRound.get(w.round) ?? [];
      list.push(workerId);
      winnersByRound.set(w.round, list);
    }
  }

  let exactlyOne = 0;
  let zero = 0;
  let multiple = 0;
  for (let r = 0; r < ROUNDS; r++) {
    const list = winnersByRound.get(r) ?? [];
    if (list.length === 0) zero++;
    else if (list.length === 1) exactlyOne++;
    else multiple++;
  }

  console.log(`Rounds with exactly one winner: ${exactlyOne}/${ROUNDS}`);
  console.log(`Rounds with zero winners:       ${zero}/${ROUNDS}`);
  console.log(`Rounds with multiple winners:   ${multiple}/${ROUNDS}`);

  fs.rmSync(dir, { recursive: true, force: true });

  if (exactlyOne !== ROUNDS) {
    console.error("FAIL: expected exactly one winner in every round.");
    process.exit(1);
  }
  console.log("PASS: exactly one winner in every round.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
