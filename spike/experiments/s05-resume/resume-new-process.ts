// S5 step 2 — "restart": resume a session from a SEPARATE node process.
// This is the critical, deterministic, re-runnable script for S5
// (M0-SPIKE-PLAN.md §4 S5 step 2). The main session re-runs this file
// independently, so it must be self-contained: it builds its own fixture,
// runs the initial ("process 1") blocking-question turn in this process,
// then spawns experiments/s05-resume/resume-child.ts as a brand-new `node`
// process (via `npx tsx`) to resume that session ("process 2"), and
// prints a PASS/FAIL verdict with evidence to stdout. It also spawns a
// third child with CLAUDE_CONFIG_DIR unset, to document that cross-process
// resume depends on both processes agreeing on CLAUDE_CONFIG_DIR.
//
// Run with:
//   cd spike
//   npx tsx experiments/s05-resume/resume-new-process.ts

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { runQuery, CostCapExceededError } from "../../src/lib/run.js";
import { rawDir, spikeRoot } from "../../src/lib/env.js";
import { createEngagementFixture } from "../../src/lib/fixture.js";
import { check } from "../../src/lib/report.js";
import {
  makeRaiseQuestionServer,
  baseOptions,
  blockingQuestionPrompt,
  resumeAnswerPrompt,
  randMemoryWord,
  findDescendantProcesses,
  isProcessAlive,
  sleep,
} from "./shared.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const EXP = "s05-resume";

type ChildOutput = {
  ok: boolean;
  threw?: string;
  childPid?: number;
  sessionId?: string;
  isError?: boolean;
  subtype?: string;
  resultText?: string;
  costUsd?: number;
  usage?: { cache_read_input_tokens?: number; cache_creation_input_tokens?: number; input_tokens?: number };
  toolCallNames?: string[];
  raisedQuestions?: unknown[];
  timedOut?: boolean;
};

function spawnChild(
  payloadPath: string,
): Promise<{ exitCode: number | null; stdout: string; stderr: string; pid: number | undefined }> {
  return new Promise((resolve) => {
    // `node --import tsx <script>` rather than `npx tsx <script>`: npx's
    // .cmd shim triggers `spawn EINVAL` from plain child_process.spawn() on
    // this Windows/Node 26 combination (no shell). Direct node invocation
    // with the tsx loader is what actually spawns a brand-new, separate
    // `node` process here — which is the thing S5 step 2 needs to prove.
    const child = spawn(
      process.execPath,
      ["--import", "tsx", path.join(__dirname, "resume-child.ts"), payloadPath],
      { cwd: spikeRoot, env: process.env, windowsHide: true },
    );
    const pid = child.pid;
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("close", (exitCode) => resolve({ exitCode, stdout, stderr, pid }));
  });
}

async function main() {
  console.log("=== S5 step 2: resume from a separate node process ===");

  const fixture = createEngagementFixture({ items: ["WI-001", "WI-002"] });
  const itemWork = fixture.paths.itemWork("WI-001");
  const memoryWord = randMemoryWord();
  const topic = "Acme's ERP replacement";

  let verdictPass = true;
  const evidence: string[] = [];
  const tempFiles: string[] = []; // cleaned up in the outer finally, even on an early exception

  try {
    // --- Process 1 (this process): initial run, ends on a blocking question ---
    const { server: server1 } = makeRaiseQuestionServer();
    console.log(`[proc1 pid=${process.pid}] running initial blocking-question turn...`);
    const initial = await runQuery({
      exp: EXP,
      label: "newproc-initial",
      prompt: blockingQuestionPrompt(memoryWord, topic),
      options: baseOptions(itemWork, server1),
      timeoutMs: 120_000,
    });

    if (initial.isError || !initial.sessionId) {
      verdictPass = false;
      evidence.push(`FAIL: initial run errored or produced no sessionId. subtype=${initial.subtype} resultText=${initial.resultText}`);
      throw new Error("initial run failed");
    }

    const draftWriteCalls = initial.toolCalls.filter((t) => t.name === "Write");
    const raiseCalls = initial.toolCalls.filter((t) => t.name.includes("raise_question"));
    evidence.push(
      `Process 1 (pid ${process.pid}, this node process): sessionId=${initial.sessionId} ` +
        `costUsd=${initial.costUsd} turns=${initial.turns} ` +
        `toolCalls=[${initial.toolCalls.map((t) => t.name).join(",")}] ` +
        `Write(draft.md) calls=${draftWriteCalls.length} raise_question calls=${raiseCalls.length}`,
    );
    check(EXP, "newproc-initial-run-succeeds", !initial.isError, evidence[evidence.length - 1]);
    check(
      EXP,
      "newproc-initial-drafts-and-raises-question",
      draftWriteCalls.length === 1 && raiseCalls.length === 1,
      `Write calls=${draftWriteCalls.length} raise_question calls=${raiseCalls.length}`,
    );

    const draftPath = path.join(itemWork, "draft.md");
    const draftExistsAfterProc1 = fs.existsSync(draftPath);
    check(EXP, "newproc-draft-file-exists-on-disk", draftExistsAfterProc1, `fs.existsSync(${draftPath})=${draftExistsAfterProc1}`);

    // --- Process 2 (separate node process, spawned via npx tsx): resume, success case ---
    const outPathSuccess = path.join(os.tmpdir(), `s05-resume-child-success-${Date.now()}.json`);
    const payloadSuccessPath = path.join(os.tmpdir(), `s05-resume-payload-success-${Date.now()}.json`);
    tempFiles.push(outPathSuccess, payloadSuccessPath);
    fs.writeFileSync(
      payloadSuccessPath,
      JSON.stringify({
        exp: EXP,
        label: "newproc-resume-success",
        sessionId: initial.sessionId,
        prompt: resumeAnswerPrompt(memoryWord),
        cwd: itemWork,
        outPath: outPathSuccess,
        // configDirOverride omitted -> resume-child.ts uses childEnv() with the
        // harness default CLAUDE_CONFIG_DIR, the SAME fixed path process 1 used.
      }),
      "utf8",
    );

    console.log("[proc2] spawning `npx tsx resume-child.ts` as a separate process...");
    const spawnResult = await spawnChild(payloadSuccessPath);
    console.log(`[proc2] exited with code ${spawnResult.exitCode}`);

    if (!fs.existsSync(outPathSuccess)) {
      verdictPass = false;
      evidence.push(
        `FAIL: child process produced no output file. exitCode=${spawnResult.exitCode} ` +
          `stderr(tail)=${spawnResult.stderr.slice(-800)}`,
      );
    } else {
      const childOut: ChildOutput = JSON.parse(fs.readFileSync(outPathSuccess, "utf8"));
      evidence.push(`Process 2 (separate node process, pid ${childOut.childPid}) raw result: ${JSON.stringify(childOut)}`);

      const sameSession = childOut.sessionId === initial.sessionId;
      const recalledWord = (childOut.resultText ?? "").includes(`MEMORY_WORD_RECALL: ${memoryWord}`);
      const editCalls = (childOut.toolCallNames ?? []).filter((n) => n === "Edit").length;
      const writeCalls = (childOut.toolCallNames ?? []).filter((n) => n === "Write").length;
      const cacheRead = childOut.usage?.cache_read_input_tokens ?? 0;

      check(EXP, "newproc-resume-succeeds", childOut.ok === true && childOut.isError === false, `ok=${childOut.ok} isError=${childOut.isError} subtype=${childOut.subtype}`);
      check(EXP, "newproc-resume-same-session-id", sameSession, `initial sessionId=${initial.sessionId} child sessionId=${childOut.sessionId}`);
      check(
        EXP,
        "newproc-resume-recalls-memory-word-without-rereading",
        recalledWord,
        `resultText="${childOut.resultText}" expected substring="MEMORY_WORD_RECALL: ${memoryWord}"`,
      );
      check(
        EXP,
        "newproc-resume-continues-via-edit-not-rewrite",
        editCalls >= 1 && writeCalls === 0,
        `toolCallNames=[${(childOut.toolCallNames ?? []).join(",")}] (want >=1 Edit, 0 Write)`,
      );
      check(
        EXP,
        "newproc-resume-cost-and-cache",
        true,
        `costUsd=${childOut.costUsd} usage=${JSON.stringify(childOut.usage)} (cache_read_input_tokens=${cacheRead})`,
      );

      if (!(childOut.ok && !childOut.isError && sameSession && recalledWord && editCalls >= 1 && writeCalls === 0)) {
        verdictPass = false;
      }
    }

    // Orphan-process check: scoped to the specific pid we spawned (a global
    // "any new claude.exe" diff is unreliable — sibling M0-spike subagents
    // run their own claude.exe processes concurrently on this machine; see
    // findDescendantProcesses() in shared.ts for the false positive this
    // caught during development). After `spawn` reports 'close', the
    // resume-child.ts node process (spawnResult.pid) should have no live
    // descendants left.
    await sleep(1500);
    const childStillAlive = spawnResult.pid !== undefined && isProcessAlive(spawnResult.pid);
    const descendants = spawnResult.pid !== undefined ? findDescendantProcesses(spawnResult.pid) : [];
    check(
      EXP,
      "newproc-no-orphan-claude-processes",
      !childStillAlive && descendants.length === 0,
      `spawned resume-child.ts pid=${spawnResult.pid} stillAlive(+1.5s)=${childStillAlive} ` +
        `live descendants=${JSON.stringify(descendants)}`,
    );
    evidence.push(
      `Orphan check: resume-child.ts pid=${spawnResult.pid} stillAlive=${childStillAlive} descendants=${JSON.stringify(descendants)}`,
    );

    // --- CLAUDE_CONFIG_DIR dependency: resume with it UNSET in the child ---
    const outPathWrongDir = path.join(os.tmpdir(), `s05-resume-child-wrongdir-${Date.now()}.json`);
    const payloadWrongDirPath = path.join(os.tmpdir(), `s05-resume-payload-wrongdir-${Date.now()}.json`);
    tempFiles.push(outPathWrongDir, payloadWrongDirPath);
    fs.writeFileSync(
      payloadWrongDirPath,
      JSON.stringify({
        exp: EXP,
        label: "newproc-resume-wrong-configdir",
        sessionId: initial.sessionId,
        prompt: "Say OK.",
        cwd: itemWork,
        outPath: outPathWrongDir,
        configDirOverride: null, // unset CLAUDE_CONFIG_DIR -> child looks in its own default (~/.claude), where this transcript does NOT live
      }),
      "utf8",
    );
    console.log("[proc3] spawning a second child with CLAUDE_CONFIG_DIR UNSET (expect resume to fail)...");
    const spawnResult2 = await spawnChild(payloadWrongDirPath);
    let wrongDirEvidence = `exitCode=${spawnResult2.exitCode}`;
    let wrongDirFailedAsExpected = false;
    if (fs.existsSync(outPathWrongDir)) {
      const childOut2: ChildOutput = JSON.parse(fs.readFileSync(outPathWrongDir, "utf8"));
      wrongDirEvidence = JSON.stringify(childOut2);
      // Expect either a thrown error, or a result that is an error / a fresh
      // unrelated session (proving the CLI could not find our transcript).
      wrongDirFailedAsExpected =
        Boolean(childOut2.threw) ||
        childOut2.isError === true ||
        (typeof childOut2.resultText === "string" && !childOut2.resultText.toLowerCase().includes("ok") && childOut2.sessionId !== initial.sessionId);
      // The strongest unambiguous signal: the CLI refuses to resume a session
      // id it cannot find under its own CLAUDE_CONFIG_DIR.
    } else {
      wrongDirEvidence = `no output file; stderr(tail)=${spawnResult2.stderr.slice(-800)}`;
    }
    check(
      EXP,
      "newproc-resume-depends-on-matching-CLAUDE_CONFIG_DIR",
      wrongDirFailedAsExpected ? true : "partial",
      `With CLAUDE_CONFIG_DIR unset in the child (falls back to ~/.claude, which does not hold this transcript): ${wrongDirEvidence}`,
    );
    evidence.push(`CLAUDE_CONFIG_DIR dependency check: ${wrongDirEvidence}`);

  } catch (err) {
    if (err instanceof CostCapExceededError) {
      console.error(`Cost cap exceeded: ${err.message}`);
      check(EXP, "newproc-cost-cap", "skip", err.message);
      verdictPass = false;
    } else {
      console.error("resume-new-process.ts failed:", err);
      verdictPass = false;
      evidence.push(`EXCEPTION: ${String((err as Error)?.message ?? err)}`);
    }
  } finally {
    fixture.cleanup();
    for (const p of tempFiles) {
      try {
        fs.rmSync(p, { force: true });
      } catch {
        /* best effort */
      }
    }
  }

  console.log("\n--- Evidence ---");
  for (const line of evidence) console.log("- " + line);
  console.log(`\n=== VERDICT: ${verdictPass ? "PASS" : "FAIL"} ===`);
  process.exit(verdictPass ? 0 : 1);
}

main();
