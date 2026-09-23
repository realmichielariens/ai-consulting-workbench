// S5 — Resume, restart and streaming input. Master orchestration script:
// runs every step and writes results/s05-resume/summary.json via
// src/lib/report.ts. Re-run with:
//
//   cd spike
//   npx tsx experiments/s05-resume/run.ts
//
// Individual steps are also independently re-runnable:
//   npx tsx experiments/s05-resume/resume-new-process.ts   (step 2 alone)
//
// See M0-SPIKE-PLAN.md §4 S5 and spike/README.md for conventions.

import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { spikeRoot } from "../../src/lib/env.js";
import { check, summarize } from "../../src/lib/report.js";
import { runSameProcessResumeTest } from "./same-process-resume.js";
import { runStreamingScenario } from "./streaming.js";
import { runSystemPromptComparison } from "./system-prompt.js";
import { runForkSessionTest } from "./fork.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const EXP = "s05-resume";

function runChildScript(scriptPath: string): Promise<{ exitCode: number | null; stdout: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--import", "tsx", scriptPath], {
      cwd: spikeRoot,
      env: process.env,
      windowsHide: true,
    });
    let stdout = "";
    child.stdout.on("data", (d) => {
      const s = d.toString();
      stdout += s;
      process.stdout.write(s);
    });
    child.stderr.on("data", (d) => process.stderr.write(d.toString()));
    child.on("close", (exitCode) => resolve({ exitCode, stdout }));
  });
}

async function main() {
  console.log(`S5 — Resume, restart and streaming input. Starting at ${new Date().toISOString()}`);
  const results: Record<string, { pass: boolean; costUsd: number }> = {};

  // Step 1: blocking question, resume in the SAME process.
  try {
    results.step1 = await runSameProcessResumeTest();
  } catch (err) {
    console.error("Step 1 crashed:", err);
    results.step1 = { pass: false, costUsd: 0 };
  }

  // Step 2: restart — resume from a SEPARATE node process. This is the
  // critical, independently re-runnable script; run it as a real
  // subprocess here too, exactly as the main session will run it alone.
  console.log("\n=== S5 step 2: delegating to resume-new-process.ts as a subprocess ===");
  const step2Result = await runChildScript(path.join(__dirname, "resume-new-process.ts"));
  results.step2 = { pass: step2Result.exitCode === 0, costUsd: 0 }; // cost already recorded via its own runQuery() calls / ledger

  // Step 3+4: streaming input, mid-turn push, interrupt(), resume-after-exit.
  try {
    results.step3and4 = await runStreamingScenario();
  } catch (err) {
    console.error("Step 3+4 crashed:", err);
    results.step3and4 = { pass: false, costUsd: 0 };
  }

  // Step 5: systemPrompt custom vs default.
  try {
    results.step5 = await runSystemPromptComparison(3);
  } catch (err) {
    console.error("Step 5 crashed:", err);
    results.step5 = { pass: false, costUsd: 0 };
  }

  // Step 6 (optional): forkSession: true.
  try {
    results.step6 = await runForkSessionTest();
  } catch (err) {
    console.error("Step 6 crashed:", err);
    results.step6 = { pass: false, costUsd: 0 };
  }

  const overallPass = Object.values(results).every((r) => r.pass);
  check(
    EXP,
    "s05-overall",
    overallPass ? true : "partial",
    `per-step results: ${JSON.stringify(results)}`,
  );

  const summary = summarize(EXP);
  console.log(`\n=== S5 overall: ${overallPass ? "PASS" : "PARTIAL/FAIL"} — total experiment cost so far: $${summary.costUsd.toFixed(4)} ===`);
  console.log("Per-step:", JSON.stringify(results, null, 2));
}

main().catch((err) => {
  console.error("run.ts fatal:", err);
  process.exit(1);
});
