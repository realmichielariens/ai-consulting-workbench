// S1 — Skills through a local plugin, scoped per query (M0-SPIKE-PLAN.md §4
// "S1", ARCHITECTURE.md §17.1). Runs both halves in order: core.ts (the main
// checklist: scoped plugin skills, naming variants, personal-skill absence,
// bundled-skill denial, the PreToolUse fallback for skills, gamma's
// script-directory resolution, allowed-tools vs. disallowedTools, and the
// settingSources:["project"] fallback) then addendum.ts (follow-up probes
// triggered by surprises found while running core.ts — see its own header
// comment). Kept as separate files, like S9's run-local.ts/run-agent.ts, so
// either half can be re-run alone.
//
// Run with: npx tsx experiments/s01-skills/run.ts
// (or run-local pieces individually: npx tsx experiments/s01-skills/core.ts,
//  npx tsx experiments/s01-skills/addendum.ts,
//  npx tsx experiments/s01-skills/probe-bash-scope.ts — an extra, minimal,
//  skill/plugin-free confirmation of one addendum finding, safe to skip)
//
// Total cost across every run.ts + addendum.ts + probe-bash-scope.ts
// invocation so far: ~$0.19 of the $0.50 cap (see results/s01-skills/summary.json).

import { fileURLToPath } from "node:url";
import path from "node:path";
import { execFileSync } from "node:child_process";

const EXP_DIR = path.dirname(fileURLToPath(import.meta.url));

console.log("[s01] === core.ts (steps 1-7 of the S1 checklist) ===");
execFileSync(process.execPath, [
  "--import",
  "tsx",
  path.join(EXP_DIR, "core.ts"),
], { stdio: "inherit", cwd: path.resolve(EXP_DIR, "..", "..") });

console.log("\n[s01] === addendum.ts (follow-up probes) ===");
execFileSync(process.execPath, [
  "--import",
  "tsx",
  path.join(EXP_DIR, "addendum.ts"),
], { stdio: "inherit", cwd: path.resolve(EXP_DIR, "..", "..") });

console.log("\n[s01] run.ts done — see results/s01-skills/summary.json");
