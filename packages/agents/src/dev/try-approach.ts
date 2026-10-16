#!/usr/bin/env node
// pnpm agents:try-approach [--fake] [--real] --message "<text>"
// (I2-PLAN §4.1). Runs ONE Approach Agent conversation turn against a
// throwaway blank-engagement fixture (seed-fixture.ts) and an in-memory
// ApproachPort (InMemoryApproachPort, in-memory-engagement.ts), with the
// real or fake ApproachRuntime, printing the activity stream readably.
// One real query() at most per invocation.

import fs from "node:fs";
import type { ActivityItem, ApproachTurnRequest, RunObserver, ThreadId } from "@workbench/core";
import { activeProfile, Settings } from "@workbench/core";
import { describeAuth, loadConfig, repoRoot, workspacePaths } from "@workbench/core/node";
import { createSdkApproachRuntime } from "../approachRuntime.js";
import { createFakeApproachRuntime } from "../fake/index.js";
import { InMemoryApproachPort } from "./in-memory-engagement.js";
import { buildSeedFixture } from "./seed-fixture.js";

interface Args {
  fake: boolean;
  message: string;
}

function parseArgs(argv: string[]): Args {
  let fake = true;
  let message: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--") continue; // an args-separator artifact from `pnpm run ... -- <args>` chains, not a real argument
    if (a === "--fake") fake = true;
    else if (a === "--real") fake = false;
    else if (a === "--message") message = argv[++i] ?? null;
  }
  if (!message) {
    throw new Error('Usage: pnpm agents:try-approach [--fake|--real] --message "<text>"');
  }
  return { fake, message };
}

function fmtCost(usd: number): string {
  return `$${usd.toFixed(4)}`;
}

class Printer {
  print(line = ""): void {
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

function buildRuntimeConfig(root: string) {
  const config = loadConfig(root);
  return {
    promptsDir: config.resolved.promptsDir,
    skillsPluginPath: config.resolved.skillsPlugin,
    sourcesCatalogDir: config.resolved.sourcesCatalog,
    repoRoot: root,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const out = new Printer();
  const fixture = buildSeedFixture("blank");

  const root = repoRoot();
  // The fixture's workspace is throwaway; the user's own source listings live in the real one.
  const userSourcesDir = workspacePaths(loadConfig(root).resolved.home).userSourcesDir;
  const runtime = args.fake
    ? createFakeApproachRuntime()
    : createSdkApproachRuntime(buildRuntimeConfig(root), { ...fixture.workspace, userSourcesDir });
  const profile = args.fake ? null : activeProfile(loadConfig(root));
  const model = args.fake ? "fake" : profile!.models.work;
  const maxTurns = args.fake ? 40 : profile!.limits.maxTurnsPerRun;

  out.print(`Engagement: ${fixture.engagementId} (${fixture.eng.paths.root})`);
  out.print(`Runtime: ${runtime.kind}${args.fake ? "" : ` (model: ${model}, auth: ${describeAuth(root)})`}`);
  out.print(`Message: ${args.message}\n`);

  const observer = new ConsoleObserver(out);
  const threadId = "T-0001" as ThreadId;
  const port = new InMemoryApproachPort(fixture.eng, "R-0001", "conversation", threadId, null);
  const digest = await port.getPlan();
  const situation = `Engagement: ${fixture.engagementId} — ${fixture.manifest.title}.\n\n${digest.text}`;

  const req: ApproachTurnRequest = {
    runId: "R-0001",
    engagementId: fixture.engagementId,
    paths: fixture.eng.paths,
    workspace: fixture.workspace,
    port,
    observer,
    model,
    maxTurns,
    settings: Settings.parse(fixture.settings),
    threadId,
    resumeSessionId: null,
    situation,
    message: args.message,
  };

  out.print(`--- Turn: aa-turn ---`);
  const result = await runtime.startTurn(req).done;

  out.print(`\n--- Result ---`);
  out.print(`  outcome: ${result.outcome}`);
  out.print(`  cost:    ${fmtCost(result.costUsd)}`);
  out.print(`  turns:   ${result.turns}`);
  out.print(`  denials: ${result.denials}`);
  out.print(`  prompt hash: ${result.promptHash ?? "(none)"}`);
  if (result.error) out.print(`  error:   ${result.error}`);

  const workDir = fixture.eng.paths.itemWork("ENG");
  const workFiles = fs.existsSync(workDir) ? fs.readdirSync(workDir) : [];
  out.print(`\nENG/work files: ${workFiles.length === 0 ? "(none)" : workFiles.join(", ")}`);

  out.print(`\nPublished ENG assets:`);
  for (const slot of ["context", "stakeholders"]) {
    const latest = fixture.eng.latest(`ENG/${slot}`);
    out.print(`  ENG/${slot}: ${latest ? `v${latest.version} (${latest.kind}) -> ${latest.path}` : "(not published)"}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : err);
  process.exitCode = 1;
});
