// S5 step 6 (optional) — `forkSession: true`: resuming with fork gives a
// NEW session id, and leaves the original session resumable at its prior
// state. See M0-SPIKE-PLAN.md §4 S5 step 6.

import { runQuery, CostCapExceededError } from "../../src/lib/run.js";
import { createEngagementFixture } from "../../src/lib/fixture.js";
import { check } from "../../src/lib/report.js";
import { makeRaiseQuestionServer, baseOptions } from "./shared.js";

const EXP = "s05-resume";

export async function runForkSessionTest(): Promise<{ pass: boolean; costUsd: number }> {
  console.log("\n=== S5 step 6 (optional): forkSession: true ===");
  const fixture = createEngagementFixture({ items: ["WI-001", "WI-002"] });
  const itemWork = fixture.paths.itemWork("WI-001");
  let costUsd = 0;
  let pass = true;

  try {
    const { server: server1 } = makeRaiseQuestionServer();
    const initial = await runQuery({
      exp: EXP,
      label: "fork-initial",
      prompt: 'Reply with exactly: "BASE-OK". Do not call any tool.',
      options: baseOptions(itemWork, server1),
      timeoutMs: 60_000,
    });
    costUsd += initial.costUsd;
    if (initial.isError || !initial.sessionId) {
      check(EXP, "fork-initial-run-succeeds", false, `isError=${initial.isError} sessionId=${initial.sessionId}`);
      return { pass: false, costUsd };
    }
    check(EXP, "fork-initial-run-succeeds", true, `sessionId=${initial.sessionId}`);

    // Resume WITH forkSession: true.
    const { server: server2 } = makeRaiseQuestionServer();
    const forked = await runQuery({
      exp: EXP,
      label: "fork-resume-forked",
      prompt: 'Reply with exactly: "FORK-OK".',
      options: { ...baseOptions(itemWork, server2), resume: initial.sessionId, forkSession: true },
      timeoutMs: 60_000,
    });
    costUsd += forked.costUsd;

    const gotNewSessionId = Boolean(forked.sessionId) && forked.sessionId !== initial.sessionId;
    check(
      EXP,
      "fork-resume-gives-new-session-id",
      !forked.isError && gotNewSessionId,
      `initial sessionId=${initial.sessionId} forked sessionId=${forked.sessionId} isError=${forked.isError}`,
    );

    // The ORIGINAL session should still be resumable (not consumed by the fork).
    const { server: server3 } = makeRaiseQuestionServer();
    const resumedOriginal = await runQuery({
      exp: EXP,
      label: "fork-resume-original-still-works",
      prompt: 'Reply with exactly: "ORIGINAL-STILL-OK".',
      options: { ...baseOptions(itemWork, server3), resume: initial.sessionId },
      timeoutMs: 60_000,
    });
    costUsd += resumedOriginal.costUsd;

    const originalStillResumable = !resumedOriginal.isError && resumedOriginal.sessionId === initial.sessionId;
    check(
      EXP,
      "fork-original-session-still-resumable-after-fork",
      originalStillResumable,
      `resumedOriginal sessionId=${resumedOriginal.sessionId} isError=${resumedOriginal.isError} resultText=${resumedOriginal.resultText}`,
    );

    pass = !forked.isError && gotNewSessionId && originalStillResumable;
  } catch (err) {
    if (err instanceof CostCapExceededError) {
      check(EXP, "fork-cost-cap", "skip", err.message);
      pass = false;
    } else {
      console.error("fork test failed:", err);
      pass = false;
    }
  } finally {
    fixture.cleanup();
  }

  console.log(`=== S5 step 6 verdict: ${pass ? "PASS" : "FAIL"} (cost $${costUsd.toFixed(4)}) ===`);
  return { pass, costUsd };
}
