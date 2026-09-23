// S9 — Document extraction and export (M0-SPIKE-PLAN.md §4 "S9"). Runs both
// halves in order: the no-API part (steps 1/2/4) then the agent part (step
// 3). See run-local.ts and run-agent.ts for what each does; they are kept
// as separate entry points so the agent part alone can be re-run once the
// account has API credit, without repeating the local-only work.
//
// Run with: npx tsx experiments/s09-documents/run.ts

import { fileURLToPath } from "node:url";
import path from "node:path";
import { execFileSync } from "node:child_process";

const EXP_DIR = path.dirname(fileURLToPath(import.meta.url));

console.log("[s09] === run-local.ts (steps 1, 2, 4 — no API) ===");
execFileSync(process.execPath, [
  "--import",
  "tsx",
  path.join(EXP_DIR, "run-local.ts"),
], { stdio: "inherit", cwd: path.resolve(EXP_DIR, "..", "..") });

console.log("\n[s09] === run-agent.ts (step 3 — one API call) ===");
execFileSync(process.execPath, [
  "--import",
  "tsx",
  path.join(EXP_DIR, "run-agent.ts"),
], { stdio: "inherit", cwd: path.resolve(EXP_DIR, "..", "..") });

console.log("\n[s09] run.ts done — see results/s09-documents/summary.json");
