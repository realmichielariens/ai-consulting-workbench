// S5 step 1 — blocking question, resumed with `resume: sessionId` in the
// SAME process (a second runQuery() call). Exported so run.ts can call it
// and record checks; contrast with resume-new-process.ts (step 2), which
// does the same thing but the resume happens from a brand-new node
// process. See M0-SPIKE-PLAN.md §4 S5 step 1.

import fs from "node:fs";
import path from "node:path";
import { runQuery } from "../../src/lib/run.js";
import { createEngagementFixture } from "../../src/lib/fixture.js";
import { check } from "../../src/lib/report.js";
import { makeRaiseQuestionServer, baseOptions, blockingQuestionPrompt, resumeAnswerPrompt, randMemoryWord } from "./shared.js";

const EXP = "s05-resume";

export async function runSameProcessResumeTest(): Promise<{ pass: boolean; costUsd: number }> {
  console.log("\n=== S5 step 1: blocking question, resume in the SAME process ===");
  const fixture = createEngagementFixture({ items: ["WI-001", "WI-002"] });
  const itemWork = fixture.paths.itemWork("WI-001");
  const memoryWord = randMemoryWord();
  const topic = "Acme's warehouse management system selection";

  let pass = true;
  let costUsd = 0;

  try {
    const { server } = makeRaiseQuestionServer();
    const initial = await runQuery({
      exp: EXP,
      label: "sameproc-initial",
      prompt: blockingQuestionPrompt(memoryWord, topic),
      options: baseOptions(itemWork, server),
      timeoutMs: 120_000,
    });
    costUsd += initial.costUsd;

    const writeCalls = initial.toolCalls.filter((t) => t.name === "Write").length;
    const raiseCalls = initial.toolCalls.filter((t) => t.name.includes("raise_question")).length;
    check(
      EXP,
      "sameproc-initial-drafts-and-raises-question",
      !initial.isError && writeCalls === 1 && raiseCalls === 1 && Boolean(initial.sessionId),
      `isError=${initial.isError} Write calls=${writeCalls} raise_question calls=${raiseCalls} sessionId=${initial.sessionId}`,
    );
    if (initial.isError || !initial.sessionId) {
      pass = false;
      return { pass, costUsd };
    }

    // Resume: a SECOND runQuery() call in this same process, with resume: sessionId.
    const { server: server2 } = makeRaiseQuestionServer();
    const resumed = await runQuery({
      exp: EXP,
      label: "sameproc-resume",
      prompt: resumeAnswerPrompt(memoryWord),
      options: { ...baseOptions(itemWork, server2), resume: initial.sessionId },
      timeoutMs: 120_000,
    });
    costUsd += resumed.costUsd;

    const sameSession = resumed.sessionId === initial.sessionId;
    const recalled = (resumed.resultText ?? "").includes(`MEMORY_WORD_RECALL: ${memoryWord}`);
    const editCalls = resumed.toolCalls.filter((t) => t.name === "Edit").length;
    const writeCallsResume = resumed.toolCalls.filter((t) => t.name === "Write").length;
    const cacheRead = resumed.usage?.cache_read_input_tokens ?? 0;

    check(EXP, "sameproc-resume-succeeds", !resumed.isError, `isError=${resumed.isError} subtype=${resumed.subtype}`);
    check(EXP, "sameproc-resume-same-session-id", sameSession, `initial=${initial.sessionId} resumed=${resumed.sessionId}`);
    check(
      EXP,
      "sameproc-resume-recalls-memory-word",
      recalled,
      `resultText="${resumed.resultText}" expected substring="MEMORY_WORD_RECALL: ${memoryWord}"`,
    );
    check(
      EXP,
      "sameproc-resume-continues-via-edit-not-rewrite",
      editCalls >= 1 && writeCallsResume === 0,
      `toolCalls=[${resumed.toolCalls.map((t) => t.name).join(",")}] (want >=1 Edit, 0 Write)`,
    );
    check(
      EXP,
      "sameproc-resume-cost-and-cache-tokens",
      true,
      `initial costUsd=${initial.costUsd} resumed costUsd=${resumed.costUsd} resumed usage=${JSON.stringify(resumed.usage)} (cache_read_input_tokens=${cacheRead})`,
    );

    const draftPath = path.join(itemWork, "draft.md");
    const draftContent = fs.existsSync(draftPath) ? fs.readFileSync(draftPath, "utf8") : "";
    // Evidence of continuation (not a from-scratch rewrite): the appended
    // sentence about the hard constraint is present, AND the file is
    // substantial prose (not just that one sentence alone — i.e. the
    // original draft survived underneath it). Line-count is not a valid
    // proxy: the model wrote the original draft as a single prose
    // paragraph, not one sentence per line.
    const hasAppendedContent = /hard constraint/i.test(draftContent);
    const isSubstantialPriorContent = draftContent.length > 400;
    check(
      EXP,
      "sameproc-draft-continued-not-recreated",
      hasAppendedContent && isSubstantialPriorContent,
      `hasAppendedContent("hard constraint")=${hasAppendedContent} length=${draftContent.length} (>400 expected if original draft survived) ` +
        `draft.md final content:\n${draftContent}`,
    );

    pass = !resumed.isError && sameSession && recalled && editCalls >= 1 && writeCallsResume === 0;
  } finally {
    fixture.cleanup();
  }

  console.log(`=== S5 step 1 verdict: ${pass ? "PASS" : "FAIL"} (cost $${costUsd.toFixed(4)}) ===`);
  return { pass, costUsd };
}
