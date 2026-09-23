#!/usr/bin/env node
// pnpm agents:try <seed> <itemId> [--fake] [--answer approve|"text"] [--save]
// (I1-PLAN §6 W1). Runs one item from a seed against a throwaway,
// self-contained engagement (seed-fixture.ts) and an in-memory WorkPort, with
// the real or fake runtime, printing the activity stream readably. At most
// two real queries (+ a nudge) per invocation: the initial run, and — only if
// it ends "blocked" and --answer was given — one resume-answer run.

import fs from "node:fs";
import path from "node:path";
import type { ActivityItem, ItemDef, RunId, RunObserver, StartRunRequest } from "@workbench/core";
import { activeProfile, Settings } from "@workbench/core";
import { loadConfig, repoRoot } from "@workbench/core/node";
import { createSdkRuntime } from "../runtime.js";
import { createFakeRuntime } from "../fake/index.js";
import { InMemoryWorkPort } from "./in-memory-engagement.js";
import { buildSeedFixture } from "./seed-fixture.js";

interface Args {
  seed: string;
  itemId: string;
  fake: boolean;
  answer: string | null;
  save: boolean;
}

function parseArgs(argv: string[]): Args {
  const positional: string[] = [];
  let fake = false;
  let answer: string | null = null;
  let save = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--") continue; // an args-separator artifact from `pnpm run ... -- <args>` chains, not a real argument
    if (a === "--fake") fake = true;
    else if (a === "--save") save = true;
    else if (a === "--answer") answer = argv[++i] ?? null;
    else positional.push(a);
  }
  const [seed, itemId] = positional;
  if (!seed || !itemId) {
    throw new Error('Usage: pnpm agents:try <seed> <itemId> [--fake] [--answer approve|"text"] [--save]');
  }
  return { seed, itemId, fake, answer, save };
}

function makeRunId(n: number): RunId {
  return `R-${String(n).padStart(4, "0")}` as RunId;
}

function fmtCost(usd: number): string {
  return `$${usd.toFixed(4)}`;
}

/** Every line printed goes through this, so --save captures the WHOLE console transcript, not just the activity stream. */
class Printer {
  readonly lines: string[] = [];
  print(line = ""): void {
    this.lines.push(line);
    console.log(line);
  }
}

class ConsoleObserver implements RunObserver {
  constructor(private readonly out: Printer) {}
  onActivity(item: ActivityItem): void {
    const tag = item.kind.toUpperCase().padEnd(8);
    this.out.print(`  [${item.idx}] ${tag} ${item.summary}`);
    if ((item.kind === "denial" || item.kind === "error") && item.detail && item.detail !== item.summary) {
      this.out.print(`           ${item.detail}`);
    }
  }
  onSession(sessionId: string): void {
    this.out.print(`  (session: ${sessionId})`);
  }
  onPid(pid: number): void {
    this.out.print(`  (child pid: ${pid})`);
  }
  onRead(): void {
    // implicit-read audit is server-side bookkeeping; nothing to print here
  }
}

function printRunResult(
  out: Printer,
  label: string,
  result: { outcome: string; costUsd: number; turns: number; nudged: boolean; denials: number; promptHash: string | null; error: string | null },
): void {
  out.print(`\n--- ${label} ---`);
  out.print(`  outcome: ${result.outcome}`);
  out.print(`  cost:    ${fmtCost(result.costUsd)}`);
  out.print(`  turns:   ${result.turns}`);
  out.print(`  nudged:  ${result.nudged}`);
  out.print(`  denials: ${result.denials}`);
  out.print(`  prompt hash: ${result.promptHash ?? "(none)"}`);
  if (result.error) out.print(`  error:   ${result.error}`);
}

function buildRuntimeConfig(root: string) {
  const config = loadConfig(root);
  return {
    promptsDir: config.resolved.promptsDir,
    skillsPluginPath: config.resolved.skillsPlugin,
    devCapUsd: config.dev.totalCapUsd,
    repoRoot: root,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const out = new Printer();
  const fixture = buildSeedFixture(args.seed);
  const item: ItemDef | undefined = fixture.eng.items.get(args.itemId);
  if (!item) {
    throw new Error(`Seed "${args.seed}" has no item "${args.itemId}". Known items: ${[...fixture.eng.items.keys()].join(", ")}`);
  }
  if (item.executor !== "agent") {
    throw new Error(`${args.itemId} is a ${item.executor === "human" ? "human" : "composite"} item, not an agent item — agents:try only runs agent items.`);
  }

  const root = repoRoot();
  const runtime = args.fake ? createFakeRuntime() : createSdkRuntime(buildRuntimeConfig(root), fixture.workspace);
  const profile = args.fake ? null : activeProfile(loadConfig(root));
  const model = args.fake ? "fake" : profile!.models.work;
  const maxTurns = args.fake ? 40 : profile!.limits.maxTurnsPerRun;

  out.print(`Engagement: ${fixture.engagementId} (${fixture.eng.paths.root})`);
  out.print(`Item: ${args.itemId} — ${item.title}`);
  out.print(`Runtime: ${runtime.kind}${args.fake ? "" : ` (model: ${model})`}\n`);

  const observer = new ConsoleObserver(out);
  const workPort1 = new InMemoryWorkPort(fixture.eng, item.id, makeRunId(1));
  const req1: StartRunRequest = {
    runId: makeRunId(1),
    engagementId: fixture.engagementId,
    item,
    reason: "start",
    input: { reason: "start" },
    resumeSessionId: null,
    paths: fixture.eng.paths,
    workspace: fixture.workspace,
    workPort: workPort1,
    observer,
    model,
    maxTurns,
    settings: Settings.parse(fixture.settings),
  };

  out.print(`--- Run 1: start ---`);
  const result1 = await runtime.startRun(req1).done;
  printRunResult(out, "Run 1 (start)", result1);

  let finalOutcome = result1.outcome;

  if (result1.outcome === "blocked" && args.answer) {
    const question = [...fixture.eng.questions].reverse().find((q) => q.itemId === item.id);
    if (!question) {
      out.print("\n(No recorded question found to answer — skipping the resume run.)");
    } else {
      const mode = args.answer === "approve" ? ("approve" as const) : ("replace" as const);
      const answerText = args.answer === "approve" ? question.hypothesis : args.answer;
      const workPort2 = new InMemoryWorkPort(fixture.eng, item.id, makeRunId(2));
      const req2: StartRunRequest = {
        runId: makeRunId(2),
        engagementId: fixture.engagementId,
        item,
        reason: "resume-answer",
        input: { reason: "resume-answer", requestId: question.requestId, question: question.question, mode, answer: answerText },
        resumeSessionId: result1.sessionId,
        paths: fixture.eng.paths,
        workspace: fixture.workspace,
        workPort: workPort2,
        observer,
        model,
        maxTurns,
        settings: Settings.parse(fixture.settings),
      };
      out.print(`\n--- Run 2: resume-answer (${mode}) ---`);
      out.print(`  Question: ${question.question}`);
      out.print(`  Hypothesis: ${question.hypothesis}`);
      out.print(`  Answering (${mode}): ${answerText}`);
      const result2 = await runtime.startRun(req2).done;
      printRunResult(out, "Run 2 (resume-answer)", result2);
      finalOutcome = result2.outcome;
    }
  }

  out.print(`\n=== Summary ===`);
  out.print(`Final outcome: ${finalOutcome}`);
  out.print(`Engagement temp path: ${fixture.eng.paths.root}`);

  const workDir = fixture.eng.paths.itemWork(item.id);
  const workFiles = fs.existsSync(workDir) ? fs.readdirSync(workDir) : [];
  out.print(`\nwork/ files: ${workFiles.length === 0 ? "(none)" : workFiles.join(", ")}`);

  out.print(`\nPublished versions for ${item.id}:`);
  for (const output of item.outputs) {
    const slot = `${item.id}/${output.slot}`;
    const latest = fixture.eng.latest(slot);
    out.print(`  ${slot}: ${latest ? `v${latest.version} (${latest.kind}) -> ${latest.path}` : "(not published)"}`);
  }

  const worklogPath = fixture.eng.paths.worklog(item.id);
  out.print(`\nWorklog (${worklogPath}):`);
  out.print(fs.existsSync(worklogPath) ? fs.readFileSync(worklogPath, "utf8") : "  (empty)");

  if (args.save) {
    const outPath = path.join(root, "iterations", "I1", "looks", "L1-run-output.txt");
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    const header = `pnpm agents:try ${args.seed} ${args.itemId}${args.fake ? " --fake" : ""}${args.answer ? ` --answer ${args.answer}` : ""}\n\n`;
    fs.writeFileSync(outPath, header + out.lines.join("\n") + "\n", "utf8");
    console.log(`\nSaved console output to ${outPath}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : err);
  process.exitCode = 1;
});
