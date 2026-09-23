// S5 step 5 — custom `systemPrompt` (a short role prompt, ~150 words) vs
// the default preset, on the same small task: tool behaviour, input
// tokens on the first turn, cache creation/read tokens, and cost.
// See M0-SPIKE-PLAN.md §4 S5 step 5.

import fs from "node:fs";
import path from "node:path";
import { runQuery, CostCapExceededError } from "../../src/lib/run.js";
import { createEngagementFixture } from "../../src/lib/fixture.js";
import { check } from "../../src/lib/report.js";

const EXP = "s05-resume";

// ~150 words.
const CUSTOM_SYSTEM_PROMPT = `You are a Work Agent, a narrowly-scoped autonomous worker inside a consulting engagement platform called Workbench. You are given one work item at a time and a working directory scoped to that item ("work/"). Your job is to read the inputs you are told to read, do the analysis or drafting task described in the prompt, and either produce the requested output or raise a clear, specific question if you are blocked. Never guess at facts you were not given; when uncertain, say so explicitly. You do not manage the engagement, do not talk to the client directly, and do not modify anything outside your own working directory. Use the Read tool to inspect files before summarizing them. Keep your final reply concise: state what you found or did, in plain prose, with no preamble such as "Great question!" or "I'd be happy to help." When a task is complete, stop; do not add unrequested extra work.`;

const TASK_PROMPT = "Read notes.md and reply with a one-sentence summary of it. Do not write any files. Do not call any tool other than Read.";

const NOTES_CONTENT = `Acme Manufacturing is evaluating three ERP vendors for its warehouse management overhaul: Contoso ERP, Northwind Systems, and Fabrikam Logistics. The CFO has set a soft target of completing vendor selection within one fiscal quarter. Key stakeholders include the VP of Operations and the incoming CIO, who joined two weeks ago and has not yet stated a preference.`;

type Arm = "custom" | "default";

async function runArm(arm: Arm, runIndex: number): Promise<{
  costUsd: number;
  inputTokens: number | undefined;
  cacheCreation: number | undefined;
  cacheRead: number | undefined;
  toolNames: string[];
  isError: boolean;
}> {
  const fixture = createEngagementFixture({ items: ["WI-001", "WI-002"] });
  const itemWork = fixture.paths.itemWork("WI-001");
  try {
    fs.writeFileSync(path.join(itemWork, "notes.md"), NOTES_CONTENT, "utf8");

    const result = await runQuery({
      exp: EXP,
      label: `sysprompt-${arm}-${runIndex}`,
      prompt: TASK_PROMPT,
      options: {
        cwd: itemWork,
        settingSources: [],
        tools: ["Read"],
        allowedTools: ["Read"],
        disallowedTools: ["Write", "Edit", "Bash", "Glob", "Grep"],
        permissionMode: "dontAsk",
        ...(arm === "custom" ? { systemPrompt: CUSTOM_SYSTEM_PROMPT } : {}),
        // "default" arm: systemPrompt omitted entirely.
      },
      timeoutMs: 90_000,
    });

    return {
      costUsd: result.costUsd,
      inputTokens: result.usage?.input_tokens,
      cacheCreation: result.usage?.cache_creation_input_tokens,
      cacheRead: result.usage?.cache_read_input_tokens,
      toolNames: result.toolCalls.map((t) => t.name),
      isError: result.isError,
    };
  } finally {
    fixture.cleanup();
  }
}

export async function runSystemPromptComparison(runsPerArm = 3): Promise<{ pass: boolean; costUsd: number }> {
  console.log(`\n=== S5 step 5: systemPrompt custom vs default, ${runsPerArm} runs/arm ===`);
  let costUsd = 0;
  const customRuns: Awaited<ReturnType<typeof runArm>>[] = [];
  const defaultRuns: Awaited<ReturnType<typeof runArm>>[] = [];
  let pass = true;

  try {
    for (let i = 0; i < runsPerArm; i++) {
      const r = await runArm("custom", i);
      costUsd += r.costUsd;
      customRuns.push(r);
      console.log(`  custom[${i}]: costUsd=${r.costUsd} input_tokens=${r.inputTokens} cache_creation=${r.cacheCreation} cache_read=${r.cacheRead} tools=[${r.toolNames.join(",")}]`);
    }
    for (let i = 0; i < runsPerArm; i++) {
      const r = await runArm("default", i);
      costUsd += r.costUsd;
      defaultRuns.push(r);
      console.log(`  default[${i}]: costUsd=${r.costUsd} input_tokens=${r.inputTokens} cache_creation=${r.cacheCreation} cache_read=${r.cacheRead} tools=[${r.toolNames.join(",")}]`);
    }

    const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : NaN);
    const customCost = avg(customRuns.map((r) => r.costUsd));
    const defaultCost = avg(defaultRuns.map((r) => r.costUsd));
    const customInput = avg(customRuns.map((r) => r.inputTokens ?? 0));
    const defaultInput = avg(defaultRuns.map((r) => r.inputTokens ?? 0));
    const customCacheCreate = avg(customRuns.map((r) => r.cacheCreation ?? 0));
    const defaultCacheCreate = avg(defaultRuns.map((r) => r.cacheCreation ?? 0));

    check(
      EXP,
      "sysprompt-both-arms-complete-task-with-read-only",
      customRuns.every((r) => !r.isError && r.toolNames.every((n) => n === "Read")) &&
        defaultRuns.every((r) => !r.isError && r.toolNames.every((n) => n === "Read")),
      `custom tool sets=${JSON.stringify(customRuns.map((r) => r.toolNames))} default tool sets=${JSON.stringify(defaultRuns.map((r) => r.toolNames))}`,
    );

    check(
      EXP,
      "sysprompt-token-cost-comparison",
      true,
      `avg over ${runsPerArm} runs/arm — custom: costUsd=${customCost.toFixed(6)} input_tokens=${customInput.toFixed(1)} cache_creation_input_tokens=${customCacheCreate.toFixed(1)}; ` +
        `default: costUsd=${defaultCost.toFixed(6)} input_tokens=${defaultInput.toFixed(1)} cache_creation_input_tokens=${defaultCacheCreate.toFixed(1)}. ` +
        `Per-run raw: custom=${JSON.stringify(customRuns)} default=${JSON.stringify(defaultRuns)}`,
    );

    pass = customRuns.every((r) => !r.isError) && defaultRuns.every((r) => !r.isError);
  } catch (err) {
    if (err instanceof CostCapExceededError) {
      check(EXP, "sysprompt-cost-cap", "skip", err.message);
      pass = false;
    } else {
      console.error("system-prompt comparison failed:", err);
      pass = false;
    }
  }

  console.log(`=== S5 step 5 verdict: ${pass ? "PASS" : "FAIL/PARTIAL"} (cost $${costUsd.toFixed(4)}) ===`);
  return { pass, costUsd };
}
