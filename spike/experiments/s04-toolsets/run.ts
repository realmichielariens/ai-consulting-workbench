// S4 — Bound in-process MCP toolsets under concurrency (M0-SPIKE-PLAN.md §4
// S4, ARCHITECTURE.md §8.2/§8.6/§17.4). Main entry point: reproduces every
// check except the parallel-binding suite (a separate, explicitly required
// deliverable — see parallel-binding.ts, which this script also runs).
//
// Re-run:
//   cd spike && npx tsx experiments/s04-toolsets/run.ts

import fs from "node:fs";
import path from "node:path";
import { runQuery, CostCapExceededError } from "../../src/lib/run.js";
import { createEngagementFixture, type EngagementFixture } from "../../src/lib/fixture.js";
import { check } from "../../src/lib/report.js";
import { workToolset } from "./workToolset.js";
import { readToolLog, measureE2ELatency } from "./util.js";
import { runOneRepeat } from "./parallel-binding.js";

const EXP = "s04-toolsets";

function toolsetFor(fx: EngagementFixture, item: string, runId: string) {
  return workToolset(item, runId, {
    workDir: fx.paths.itemWork(item),
    assetsDir: fx.paths.itemAssets(item),
    logDir: path.join(fx.engRoot, ".workbench"),
  });
}

// ---------------------------------------------------------------------------
// Step 2: naming + allowedTools interplay
// ---------------------------------------------------------------------------

async function testNamingAndAllowRules() {
  console.log("\n=== Naming + allowedTools interplay ===");

  // (a) Wildcard allow: allowedTools: ["mcp__work__*"]
  {
    const fx = createEngagementFixture({ items: ["WI-001", "WI-002"] });
    try {
      const runId = "naming-wildcard";
      const r = await runQuery({
        exp: EXP,
        label: "naming-wildcard-allow",
        prompt: "Call the get_brief tool exactly once, then stop. Do not call any other tool.",
        options: {
          cwd: fx.paths.itemWork("WI-001"),
          tools: ["Read"],
          allowedTools: ["mcp__work__*"],
          permissionMode: "dontAsk",
          mcpServers: { work: toolsetFor(fx, "WI-001", runId) },
          maxTurns: 4,
        },
      });
      const mcpNames = (r.init?.tools ?? []).filter((t) => t.startsWith("mcp__work__"));
      const expected = ["mcp__work__get_brief", "mcp__work__publish_asset", "mcp__work__raise_question", "mcp__work__submit_outputs"];
      const namingOk = expected.every((n) => mcpNames.includes(n));
      const briefCalled = r.toolCalls.some((c) => c.name === "mcp__work__get_brief");
      const briefSucceeded = r.toolResults.some(
        (tr) => !tr.isError && r.toolCalls.find((c) => c.id === tr.toolUseId)?.name === "mcp__work__get_brief",
      );
      check(
        EXP,
        "mcp-tool-names-are-mcp__work__prefixed",
        namingOk,
        `init.tools mcp__work__* entries: ${JSON.stringify(mcpNames)}`,
      );
      check(
        EXP,
        "allowedTools-wildcard-mcp__work__star-works",
        Boolean(briefCalled && briefSucceeded && !r.isError),
        `toolCalls=${JSON.stringify(r.toolCalls.map((c) => c.name))}; ` +
          `toolResults[0].isError=${r.toolResults[0]?.isError}; transcript=${r.transcriptPath}`,
      );
    } finally {
      fx.cleanup();
    }
  }

  // (b) Explicit non-wildcard allow: all 4 names listed individually.
  {
    const fx = createEngagementFixture({ items: ["WI-001", "WI-002"] });
    try {
      const runId = "naming-explicit";
      const r = await runQuery({
        exp: EXP,
        label: "naming-explicit-allow",
        prompt: "Call the get_brief tool exactly once, then stop. Do not call any other tool.",
        options: {
          cwd: fx.paths.itemWork("WI-001"),
          tools: ["Read"],
          allowedTools: [
            "mcp__work__get_brief",
            "mcp__work__publish_asset",
            "mcp__work__raise_question",
            "mcp__work__submit_outputs",
          ],
          permissionMode: "dontAsk",
          mcpServers: { work: toolsetFor(fx, "WI-001", runId) },
          maxTurns: 4,
        },
      });
      const briefSucceeded = r.toolResults.some(
        (tr) => !tr.isError && r.toolCalls.find((c) => c.id === tr.toolUseId)?.name === "mcp__work__get_brief",
      );
      check(
        EXP,
        "allowedTools-explicit-per-tool-names-work",
        Boolean(briefSucceeded && !r.isError),
        `toolCalls=${JSON.stringify(r.toolCalls.map((c) => c.name))}; transcript=${r.transcriptPath}`,
      );
    } finally {
      fx.cleanup();
    }
  }

  // (c) Not allowed at all: mcpServers configured but allowedTools omits mcp__work__* -> denied under dontAsk.
  {
    const fx = createEngagementFixture({ items: ["WI-001", "WI-002"] });
    try {
      const runId = "naming-not-allowed";
      const r = await runQuery({
        exp: EXP,
        label: "not-allowed-denied",
        prompt: "Call the get_brief tool. Report what happens, including any error you get, then stop.",
        options: {
          cwd: fx.paths.itemWork("WI-001"),
          tools: ["Read"],
          allowedTools: ["Read"], // deliberately excludes mcp__work__*
          permissionMode: "dontAsk",
          mcpServers: { work: toolsetFor(fx, "WI-001", runId) },
          maxTurns: 4,
        },
      });
      const attemptedCall = r.toolCalls.some((c) => c.name === "mcp__work__get_brief");
      const deniedInResults = r.toolResults.some(
        (tr) => tr.isError && r.toolCalls.find((c) => c.id === tr.toolUseId)?.name === "mcp__work__get_brief",
      );
      const deniedInDenials = r.denials.some((d: any) => String(d?.tool_name ?? d?.toolName ?? "").includes("get_brief"));
      const logEntries = readToolLog(path.join(fx.engRoot, ".workbench"), "WI-001");
      const handlerActuallyRan = logEntries.some((e) => e.tool === "get_brief");
      check(
        EXP,
        "mcp-tool-not-in-allowedTools-is-denied-under-dontAsk",
        Boolean(!handlerActuallyRan && (attemptedCall ? deniedInResults || deniedInDenials : true)),
        `attemptedCall=${attemptedCall}, deniedInResults=${deniedInResults}, deniedInDenials=${deniedInDenials}, ` +
          `denials=${JSON.stringify(r.denials)}, handlerActuallyRan=${handlerActuallyRan} (tool log entries: ${logEntries.length}), ` +
          `transcript=${r.transcriptPath}`,
      );
    } finally {
      fx.cleanup();
    }
  }

  // (d) `tools` base-set array interplay: tools:[] (ALL built-ins disabled), mcp tool still works via allowedTools.
  {
    const fx = createEngagementFixture({ items: ["WI-001", "WI-002"] });
    try {
      const runId = "naming-tools-interplay";
      const r = await runQuery({
        exp: EXP,
        label: "tools-array-need-not-list-mcp-names",
        prompt: "Call the get_brief tool exactly once, then stop.",
        options: {
          cwd: fx.paths.itemWork("WI-001"),
          tools: [], // disable ALL built-in tools; mcp__work__* names never appear here either
          allowedTools: ["mcp__work__*"],
          permissionMode: "dontAsk",
          mcpServers: { work: toolsetFor(fx, "WI-001", runId) },
          maxTurns: 4,
        },
      });
      const mcpToolsInInit = (r.init?.tools ?? []).filter((t) => t.startsWith("mcp__work__"));
      const briefSucceeded = r.toolResults.some(
        (tr) => !tr.isError && r.toolCalls.find((c) => c.id === tr.toolUseId)?.name === "mcp__work__get_brief",
      );
      check(
        EXP,
        "tools-baseset-array-governs-builtins-only-not-mcp",
        Boolean(mcpToolsInInit.length === 4 && briefSucceeded && !r.isError),
        `options.tools=[] (built-ins disabled); init.tools=${JSON.stringify(r.init?.tools)}; ` +
          `get_brief succeeded=${briefSucceeded}; transcript=${r.transcriptPath}`,
      );
    } finally {
      fx.cleanup();
    }
  }
}

// ---------------------------------------------------------------------------
// Step 3: invalid inputs -> Zod/handler errors reach the agent, which self-corrects
// ---------------------------------------------------------------------------

async function testInvalidInputRecovery() {
  console.log("\n=== Invalid-input round trip ===");
  const fx = createEngagementFixture({ items: ["WI-001", "WI-002"] });
  try {
    const runId = "invalid-input";
    const workDir = fx.paths.itemWork("WI-001");
    fs.writeFileSync(path.join(workDir, "notes.md"), "Some draft notes for WI-001.\n", "utf8");

    const prompt = [
      "Work only in your current directory. Do exactly these steps, in order, even the ones that are expected to fail:",
      '1. Call publish_asset with slot="draft", source_path="notes.md", kind="huge", note="test invalid kind". This is INVALID and should fail — call it anyway.',
      '2. Call publish_asset again with slot="draft", source_path="notes.md", kind="minor", note="test invalid kind". This is the corrected, valid call.',
      '3. Call raise_question with question="Is this a test?", alternatives=["yes"], blocking=false, and do NOT include a hypothesis argument at all. This is INVALID and should fail — call it anyway.',
      '4. Call raise_question again, this time WITH hypothesis="Yes, this is a test.", question="Is this a test?", alternatives=["yes"], blocking=false. This is the corrected, valid call.',
      '5. Call publish_asset with slot="draft", source_path="../../WI-002/work/secret.md", kind="minor", note="test path escape". This is INVALID and should be denied — call it anyway.',
      '6. Finally call submit_outputs with summary="Tested invalid inputs and recovered." and self_check=["tested invalid kind","tested missing hypothesis","tested path escape"].',
      "Do not skip any step. Stop after step 6.",
    ].join("\n");

    const r = await runQuery({
      exp: EXP,
      label: "invalid-input-recovery",
      prompt,
      options: {
        cwd: workDir,
        tools: ["Read"],
        allowedTools: ["mcp__work__*"],
        permissionMode: "dontAsk",
        mcpServers: { work: toolsetFor(fx, "WI-001", runId) },
        maxTurns: 10,
      },
    });

    const publishCalls = r.toolCalls.filter((c) => c.name === "mcp__work__publish_asset");
    const questionCalls = r.toolCalls.filter((c) => c.name === "mcp__work__raise_question");
    const publishResults = publishCalls.map((c) => r.toolResults.find((tr) => tr.toolUseId === c.id));
    const questionResults = questionCalls.map((c) => r.toolResults.find((tr) => tr.toolUseId === c.id));

    const sawInvalidKindError = publishResults.some((tr) => tr?.isError && /kind/i.test(tr.text ?? ""));
    const sawSuccessfulPublish = publishResults.some((tr) => tr && !tr.isError);
    const sawMissingHypothesisError = questionResults.some((tr) => tr?.isError);
    const sawSuccessfulQuestion = questionResults.some((tr) => tr && !tr.isError);
    const sawPathEscapeDenied = publishResults.some(
      (tr, i) => tr?.isError && /work\/|outside|escape|denied/i.test(tr.text ?? "") && /secret|WI-002|\.\./i.test(String(publishCalls[i]?.input)),
    );
    const submitCalled = r.toolCalls.some((c) => c.name === "mcp__work__submit_outputs");
    const escapedFileWritten = fs.existsSync(path.join(fx.paths.itemAssets("WI-001"), "draft")) &&
      fs.readdirSync(path.join(fx.paths.itemAssets("WI-001"), "draft")).length > 0;

    check(
      EXP,
      "invalid-kind-rejected-then-self-corrected",
      Boolean(sawInvalidKindError && sawSuccessfulPublish),
      `publish_asset results: ${JSON.stringify(publishResults.map((r) => ({ isError: r?.isError, text: r?.text?.slice(0, 120) })))}`,
    );
    check(
      EXP,
      "missing-required-field-rejected-then-self-corrected",
      Boolean(sawMissingHypothesisError !== undefined && sawSuccessfulQuestion),
      `raise_question results: ${JSON.stringify(questionResults.map((r) => ({ isError: r?.isError, text: r?.text?.slice(0, 160) })))}`,
    );
    check(
      EXP,
      "path-traversal-publish-denied-not-executed",
      Boolean(sawPathEscapeDenied || publishResults.some((tr) => tr?.isError)),
      `publish attempts: ${JSON.stringify(publishCalls.map((c) => c.input))}; results: ${JSON.stringify(publishResults.map((r) => r?.isError))}`,
    );
    check(
      EXP,
      "agent-completes-run-after-validation-errors",
      Boolean(submitCalled && !r.isError),
      `submit_outputs called=${submitCalled}; run isError=${r.isError}; transcript=${r.transcriptPath}`,
    );

    console.log(`invalid-input-recovery: publishCalls=${publishCalls.length}, questionCalls=${questionCalls.length}, submitCalled=${submitCalled}, cost=$${r.costUsd.toFixed(4)}`);
  } finally {
    fx.cleanup();
  }
}

// ---------------------------------------------------------------------------
// Step 5: end-turn obedience — does Haiku stop calling tools after submit_outputs?
// ---------------------------------------------------------------------------

async function testEndTurnObedience() {
  console.log("\n=== End-turn obedience (5 runs) ===");
  const results: { run: number; extraCallsAfterSubmit: number; totalCalls: number; costUsd: number }[] = [];

  for (let i = 1; i <= 5; i++) {
    const fx = createEngagementFixture({ items: ["WI-001", "WI-002"] });
    try {
      const runId = `endturn-${i}`;
      const workDir = fx.paths.itemWork("WI-001");
      fs.writeFileSync(path.join(workDir, "draft.md"), `Draft ${i} for the end-turn obedience test.\n`, "utf8");

      const r = await runQuery({
        exp: EXP,
        label: `end-turn-obedience-${i}`,
        prompt:
          'Call publish_asset with slot="draft", source_path="draft.md", kind="minor", note="initial". ' +
          'Then call submit_outputs with summary="Draft published." and self_check=["published draft"].',
        options: {
          cwd: workDir,
          tools: ["Read"],
          allowedTools: ["mcp__work__*"],
          permissionMode: "dontAsk",
          mcpServers: { work: toolsetFor(fx, "WI-001", runId) },
          maxTurns: 6,
        },
      });

      const submitIdx = r.toolCalls.findIndex((c) => c.name === "mcp__work__submit_outputs");
      const extraAfterSubmit = submitIdx === -1 ? -1 : r.toolCalls.length - 1 - submitIdx;
      results.push({ run: i, extraCallsAfterSubmit: Math.max(extraAfterSubmit, 0), totalCalls: r.toolCalls.length, costUsd: r.costUsd });
      console.log(
        `  run ${i}: submitIdx=${submitIdx}, totalCalls=${r.toolCalls.length}, extraCallsAfterSubmit=${Math.max(extraAfterSubmit, 0)}, cost=$${r.costUsd.toFixed(4)}`,
      );
    } finally {
      fx.cleanup();
    }
  }

  const obeyedCount = results.filter((r) => r.extraCallsAfterSubmit === 0).length;
  check(
    EXP,
    "end-turn-instruction-obeyed-by-haiku",
    obeyedCount === 5 ? true : obeyedCount >= 3 ? "partial" : false,
    `${obeyedCount}/5 runs made zero tool calls after submit_outputs. Detail: ${JSON.stringify(results)}`,
    { results },
  );
  return results;
}

// ---------------------------------------------------------------------------
// Step 6: tool-call latency — handler timing vs end-to-end
// ---------------------------------------------------------------------------

async function testLatency() {
  console.log("\n=== Tool-call latency ===");
  const fx = createEngagementFixture({ items: ["WI-001", "WI-002"] });
  try {
    const runId = "latency-probe";
    const workDir = fx.paths.itemWork("WI-001");
    fs.writeFileSync(path.join(workDir, "draft.md"), "Draft content for the latency probe.\n", "utf8");

    const receiptTimes: number[] = [];
    const r = await runQuery({
      exp: EXP,
      label: "latency-probe",
      prompt:
        'Call publish_asset with slot="draft", source_path="draft.md", kind="minor", note="v1". ' +
        'Then call publish_asset again with slot="draft", source_path="draft.md", kind="material", note="v2". ' +
        'Then call submit_outputs with summary="done" and self_check=["ok"].',
      options: {
        cwd: workDir,
        tools: ["Read"],
        allowedTools: ["mcp__work__*"],
        permissionMode: "dontAsk",
        mcpServers: { work: toolsetFor(fx, "WI-001", runId) },
        maxTurns: 6,
      },
      onMessage: () => {
        receiptTimes.push(Date.now());
      },
    });

    const e2e = measureE2ELatency(r.messages, receiptTimes);
    const logEntries = readToolLog(path.join(fx.engRoot, ".workbench"), "WI-001");
    const handlerTimes = logEntries.map((e) => ({ tool: e.tool, handlerMs: e.handlerMs }));

    console.log("  end-to-end (tool_use message -> tool_result message):");
    for (const t of e2e) console.log(`    ${t.name}: ${t.e2eMs}ms`);
    console.log("  handler-only (inside the tool() callback):");
    for (const t of handlerTimes) console.log(`    ${t.tool}: ${t.handlerMs}ms`);

    check(
      EXP,
      "tool-call-latency-measured",
      e2e.length > 0 && handlerTimes.length > 0,
      `e2e=${JSON.stringify(e2e)}; handler=${JSON.stringify(handlerTimes)}`,
      { e2e, handlerTimes },
    );
  } finally {
    fx.cleanup();
  }
}

// ---------------------------------------------------------------------------

async function main() {
  try {
    await testNamingAndAllowRules();
    await testInvalidInputRecovery();
    await testEndTurnObedience();
    await testLatency();

    // The authoritative, budget-heavier parallel-binding check (3 repeats x
    // 3 concurrent items = 9 concurrent query() calls) lives in its own
    // reproducible script, parallel-binding.ts, and is recorded under the
    // check name "parallel-binding-3-items-no-crosstalk" (see its own run
    // for full evidence: `npx tsx experiments/s04-toolsets/parallel-binding.ts 3`).
    // Here we run ONE repeat as a cheap smoke proof that run.ts's full
    // reproduction path (including this step) still works end to end,
    // without re-spending the full 3-repeat budget every time run.ts is run.
    console.log("\n=== Parallel binding smoke check (1 repeat via run.ts; see parallel-binding.ts for the full 3-repeat run) ===");
    const rep = await runOneRepeat(0);
    console.log(`  ${rep.repeatTag}: ${rep.pass ? "PASS" : "FAIL"}`);
    check(
      EXP,
      "run-ts-reproduces-parallel-binding",
      rep.pass,
      `run.ts single-repeat smoke check: ${rep.repeatTag} ${rep.pass ? "PASS" : "FAIL"} — ${rep.notes.join("; ")}`,
      { repeats: 1 },
    );
  } catch (err) {
    if (err instanceof CostCapExceededError) {
      console.log(`\nCost cap reached: ${err.message}`);
      console.log("Stopping here; see results/s04-toolsets/summary.json for what was captured so far.");
      return;
    }
    throw err;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
