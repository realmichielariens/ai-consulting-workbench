// S4 step 4 — 3 parallel runQuery() calls (WI-001, WI-002, WI-003) in ONE
// Node process, each with its own workToolset() instance bound to its own
// itemId/runId via closure. Verifies from disk + tool logs that every
// publish lands under the right item with the right versions, and that
// there is zero cross-talk between items.
//
// Re-run standalone:
//   cd spike && npx tsx experiments/s04-toolsets/parallel-binding.ts [repeats]
//
// Deterministic pass/fail logic; content differs run to run only in its
// random per-item marker token (used to detect cross-talk), which is
// printed as evidence.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";
import { runQuery, CostCapExceededError } from "../../src/lib/run.js";
import { createEngagementFixture, type EngagementFixture } from "../../src/lib/fixture.js";
import { check } from "../../src/lib/report.js";
import { workToolset } from "./workToolset.js";
import { readToolLog, measureE2ELatency, type ToolLogEntry } from "./util.js";

const EXP = "s04-toolsets";
const ITEMS = ["WI-001", "WI-002", "WI-003"] as const;

type ItemRunOutcome = {
  item: string;
  runId: string;
  marker: string;
  isError: boolean;
  costUsd: number;
  turns: number | undefined;
  toolCallNames: string[];
  transcriptPath: string;
};

function buildPrompt(item: string, marker: string): string {
  return [
    `You are the Work Agent for item ${item}. Work only in your current directory (this is items/${item}/work/).`,
    `1. Use the Write tool to create a file named draft.md in your current directory. Its content must be exactly these two lines:`,
    `${marker}`,
    `Draft for ${item}.`,
    `2. Call publish_asset with slot="draft", source_path="draft.md", kind="minor", note="initial draft".`,
    `3. Without changing the file, call publish_asset again with slot="draft", source_path="draft.md", kind="material", note="finalized draft".`,
    `4. Call submit_outputs with summary="Draft published for ${item}." and self_check=["draft written","published minor","published material"].`,
    `Do these steps in order. Do not read or write anything outside your current directory. Do not mention any work item other than ${item}.`,
  ].join("\n");
}

async function runOneItem(
  fx: EngagementFixture,
  item: string,
  repeatTag: string,
): Promise<ItemRunOutcome> {
  const runId = `${repeatTag}-${item}-${crypto.randomBytes(3).toString("hex")}`;
  const marker = `MARK-${repeatTag}-${item}-${crypto.randomBytes(4).toString("hex")}`;

  const server = workToolset(item, runId, {
    workDir: fx.paths.itemWork(item),
    assetsDir: fx.paths.itemAssets(item),
    logDir: path.join(fx.engRoot, ".workbench"),
  });

  const result = await runQuery({
    exp: EXP,
    label: `parallel-${repeatTag}-${item}`,
    prompt: buildPrompt(item, marker),
    options: {
      cwd: fx.paths.itemWork(item),
      tools: ["Write"],
      allowedTools: ["Write", "mcp__work__*"],
      permissionMode: "dontAsk",
      mcpServers: { work: server },
      maxTurns: 8,
    },
  });

  return {
    item,
    runId,
    marker,
    isError: result.isError,
    costUsd: result.costUsd,
    turns: result.turns,
    toolCallNames: result.toolCalls.map((t) => t.name),
    transcriptPath: result.transcriptPath,
  };
}

export type RepeatEvidence = {
  repeatTag: string;
  pass: boolean;
  notes: string[];
  outcomes: ItemRunOutcome[];
};

/**
 * Runs one repeat of the 3-parallel-item test against a fresh fixture.
 * Returns pass/fail plus a list of human-readable evidence lines.
 */
export async function runOneRepeat(repeatIndex: number): Promise<RepeatEvidence> {
  const repeatTag = `r${repeatIndex}`;
  const fx = createEngagementFixture({ items: [...ITEMS] });
  const notes: string[] = [];
  let pass = true;

  try {
    const outcomes = await Promise.all(ITEMS.map((item) => runOneItem(fx, item, repeatTag)));

    for (const o of outcomes) {
      if (o.isError) {
        pass = false;
        notes.push(`[FAIL] ${o.item}: query errored (see ${o.transcriptPath})`);
      }
    }

    // --- Disk check: each item's assets/draft/ has exactly v1.0.md and v2.0.md, containing its own marker only.
    const outcomeByItem = new Map(outcomes.map((o) => [o.item, o]));
    for (const item of ITEMS) {
      const o = outcomeByItem.get(item)!;
      const slotDir = path.join(fx.paths.itemAssets(item), "draft");
      const v10 = path.join(slotDir, "v1.0.md");
      const v20 = path.join(slotDir, "v2.0.md");

      if (!fs.existsSync(v10) || !fs.existsSync(v20)) {
        pass = false;
        notes.push(
          `[FAIL] ${item}: expected v1.0.md and v2.0.md in ${slotDir}, found: ${
            fs.existsSync(slotDir) ? fs.readdirSync(slotDir).join(", ") : "(slot dir missing)"
          }`,
        );
        continue;
      }
      const files = fs.readdirSync(slotDir).sort();
      if (files.length !== 2) {
        pass = false;
        notes.push(`[FAIL] ${item}: expected exactly 2 published versions, found ${files.length}: ${files.join(", ")}`);
      } else {
        notes.push(`[ok] ${item}: published versions ${files.join(", ")} in ${slotDir}`);
      }

      const v10text = fs.readFileSync(v10, "utf8");
      const v20text = fs.readFileSync(v20, "utf8");
      if (!v10text.includes(o.marker) || !v20text.includes(o.marker)) {
        pass = false;
        notes.push(`[FAIL] ${item}: own marker ${o.marker} missing from published content`);
      }

      // Cross-talk: no OTHER item's marker should appear in this item's published files or work dir.
      for (const other of ITEMS) {
        if (other === item) continue;
        const otherMarker = outcomeByItem.get(other)!.marker;
        if (v10text.includes(otherMarker) || v20text.includes(otherMarker)) {
          pass = false;
          notes.push(`[FAIL] CROSS-TALK: ${item}'s published assets contain ${other}'s marker (${otherMarker})`);
        }
      }
    }

    // --- Tool log check: tool-log-<item>.jsonl only ever mentions its own itemId/runId.
    const logDir = path.join(fx.engRoot, ".workbench");
    for (const item of ITEMS) {
      const o = outcomeByItem.get(item)!;
      const entries: ToolLogEntry[] = readToolLog(logDir, item);
      if (entries.length === 0) {
        pass = false;
        notes.push(`[FAIL] ${item}: tool log is empty (expected write/publish/submit log lines)`);
        continue;
      }
      const badEntries = entries.filter((e) => e.itemId !== item || e.runId !== o.runId);
      if (badEntries.length > 0) {
        pass = false;
        notes.push(
          `[FAIL] CROSS-TALK: tool-log-${item}.jsonl contains ${badEntries.length} entries not matching itemId=${item}/runId=${o.runId}: ${JSON.stringify(badEntries.slice(0, 3))}`,
        );
      } else {
        notes.push(`[ok] ${item}: tool log has ${entries.length} entries, all itemId=${item} runId=${o.runId}`);
      }
      const publishOk = entries.filter((e) => e.tool === "publish_asset" && e.ok).length;
      const submitOk = entries.filter((e) => e.tool === "submit_outputs" && e.ok).length;
      if (publishOk < 2) {
        pass = false;
        notes.push(`[FAIL] ${item}: expected 2 successful publish_asset log entries, found ${publishOk}`);
      }
      if (submitOk < 1) {
        pass = false;
        notes.push(`[FAIL] ${item}: expected submit_outputs to be called, found ${submitOk} log entries`);
      }
    }

    // --- No other item's log file mentions this item's runId at all (belt and braces).
    for (const item of ITEMS) {
      for (const other of ITEMS) {
        if (other === item) continue;
        const otherEntries = readToolLog(logDir, other);
        const o = outcomeByItem.get(item)!;
        const leaked = otherEntries.some((e) => e.runId === o.runId || JSON.stringify(e).includes(o.marker));
        if (leaked) {
          pass = false;
          notes.push(`[FAIL] CROSS-TALK: tool-log-${other}.jsonl mentions ${item}'s runId or marker`);
        }
      }
    }

    const totalCost = outcomes.reduce((s, o) => s + o.costUsd, 0);
    notes.push(
      `[info] cost this repeat: $${totalCost.toFixed(4)} (turns: ${outcomes.map((o) => o.turns).join("/")})`,
    );

    return { repeatTag, pass, notes, outcomes };
  } finally {
    fx.cleanup();
  }
}

async function main() {
  const repeatsArg = Number(process.argv[2] ?? process.env.S4_PARALLEL_REPEATS ?? 2);
  const repeats = Number.isFinite(repeatsArg) && repeatsArg > 0 ? Math.floor(repeatsArg) : 2;

  console.log(`S4 parallel-binding: running ${repeats} repeat(s) of 3 concurrent query() calls (WI-001/002/003)\n`);

  const results: RepeatEvidence[] = [];
  let capHit = false;

  for (let i = 1; i <= repeats; i++) {
    console.log(`--- repeat ${i}/${repeats} ---`);
    try {
      const r = await runOneRepeat(i);
      results.push(r);
      for (const n of r.notes) console.log(n);
      console.log(r.pass ? `repeat ${i}: PASS\n` : `repeat ${i}: FAIL\n`);
    } catch (err) {
      if (err instanceof CostCapExceededError) {
        console.log(`Cost cap hit before repeat ${i} could run: ${err.message}`);
        capHit = true;
        break;
      }
      throw err;
    }
  }

  const allPass = results.length > 0 && results.every((r) => r.pass);
  const summaryLine = `S4 parallel-binding: ${results.filter((r) => r.pass).length}/${results.length} repeats PASS` + (capHit ? " (stopped early: cost cap)" : "");
  console.log("=".repeat(70));
  console.log(summaryLine);
  console.log(allPass ? "OVERALL: PASS" : "OVERALL: FAIL");
  console.log("=".repeat(70));

  const evidence = results
    .map((r) => `${r.repeatTag}: ${r.pass ? "PASS" : "FAIL"} — ${r.notes.filter((n) => n.startsWith("[FAIL]")).join("; ") || "no failures"}`)
    .join("\n");

  check(
    EXP,
    "parallel-binding-3-items-no-crosstalk",
    results.length === 0 ? "skip" : allPass,
    `${summaryLine}\n${evidence}`,
    { repeats: results.length, capHit },
  );

  if (results.length === 0) {
    process.exitCode = 1;
    return;
  }
  process.exitCode = allPass ? 0 : 1;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
