// Sources end to end over the HTTP API, on the fake runtimes:
// the Approach Agent proposes a research task with sources attached (an
// unknown source id is rejected first) -> approve -> item.md carries the
// bindings and the Source Catalog shows "used by" -> the task runs on the
// fake Work Agent, whose source steps query the real mock datasets in
// workbench-sources/, and its activity is tagged per source.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import multipart from "@fastify/multipart";
import {
  ItemDef,
  type ApproachRuntime,
  type ApproachTaskRequest,
  type ApproachTurnRequest,
  type ItemDetailView,
  type ProposalView,
  type RunActivityView,
  type RunHandle,
  type RunResult,
  type SourceCatalogEntry,
} from "@workbench/core";
import { loadConfig, repoRoot, workspacePaths } from "@workbench/core/node";
import { openEngagement, type ServerContext } from "./engagementContext.js";
import { registerRoutes } from "./routes.js";

process.env.WORKBENCH_RUNTIME = "fake";
process.env.WORKBENCH_FAKE_DELAY_MS = "0";

const REPO_ROOT = repoRoot();

const WI005 = ItemDef.parse({
  id: "WI-005",
  title: "Short benchmarking scan",
  parent: null,
  order: 1,
  executor: "agent",
  inputs: [{ slot: "ENG/context", required: true }],
  outputs: [{ slot: "benchmark", format: "md", scope: "project", description: "Benchmark scan", required: true }],
  skills: ["desk-research"],
  sources: [
    { id: "open-web", purpose: "Public case studies to corroborate the panel" },
    { id: "mfg-it-benchmarks", purpose: "Peer figures on ERP phasing and OEM visibility" },
  ],
  gate: [],
  autostart: true,
  acceptance: ["Cites at least two sources"],
  brief: "A short benchmarking scan.",
});

function result(model: string, lastMessage: string): RunResult {
  return { outcome: "completed", sessionId: "fake-aa", costUsd: 0, turns: 1, model, promptHash: null, nudged: false, denials: 0, lastMessage, error: null };
}

/** Turn 1: publish ENG/context, try an unknown source (must be rejected), then propose WI-005 with real sources. Tasks approve the hypothesis. */
function scriptedApproach(rejections: string[][]): ApproachRuntime {
  const handle = (runId: string, work: () => Promise<RunResult>): RunHandle => ({ runId: runId as never, interrupt: async () => {}, done: work() });
  return {
    kind: "fake",
    startTurn(req: ApproachTurnRequest): RunHandle {
      return handle(req.runId, async () => {
        const workDir = req.paths.itemWork("ENG");
        fs.mkdirSync(workDir, { recursive: true });
        fs.writeFileSync(path.join(workDir, "context.md"), "# Context\n\nAcme, mid-size manufacturer.\n");
        await req.port.publishEngagementAsset({ slot: "context", sourcePath: "context.md", kind: "material", note: "Initial context." });
        const bad = await req.port.proposeOps({
          ops: [{ op: "add_item", def: { ...WI005, sources: [{ id: "dark-web", purpose: "x" }] } }],
          rationale: "Should be rejected.",
        });
        rejections.push(bad.errors);
        const ok = await req.port.proposeOps({ ops: [{ op: "add_item", def: WI005 }], rationale: "Research task with two sources." });
        if (!ok.ok) throw new Error(`propose_ops failed: ${ok.errors.join("; ")}`);
        return result(req.model, "Proposed.");
      });
    },
    startTask(req: ApproachTaskRequest): RunHandle {
      return handle(req.runId, async () => {
        if (req.kind === "question" && req.request.type === "question") {
          await req.port.answerRequest({ requestId: req.request.id, mode: "approve", text: req.request.payload.hypothesis });
        }
        return result(req.model, "Answered.");
      });
    },
  };
}

async function waitFor<T>(check: () => Promise<T | undefined>, timeoutMs = 10000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error("waitFor: timed out");
    await new Promise((r) => setTimeout(r, 15));
  }
}

describe("Sources flow: propose with sources -> approve -> catalog 'used by' -> source-tagged run", () => {
  let app: FastifyInstance;
  let server: ServerContext;
  let tmpHome: string;

  beforeEach(async () => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "workbench-sources-flow-"));
    server = { repoRoot: REPO_ROOT, config: loadConfig(REPO_ROOT), workspace: workspacePaths(tmpHome), runtimeKind: "fake", engagements: new Map() };
    app = Fastify({ logger: false });
    await app.register(websocket);
    await app.register(multipart);
    registerRoutes(app, server);
  });

  afterEach(async () => {
    for (const ctx of server.engagements.values()) ctx.dbCtx.close();
    await app.close();
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it("attaches, shows and uses sources", async () => {
    const eid = ((await app.inject({ method: "POST", url: "/api/engagements", payload: { seedId: "blank", name: "Sources flow" } })).json() as { id: string }).id;
    const ctx = openEngagement(server, eid);
    const rejections: string[][] = [];
    ctx.approachRuntime = scriptedApproach(rejections);

    await app.inject({ method: "POST", url: `/api/engagements/${eid}/threads/T-0001/messages`, payload: { text: "Add a benchmark scan." } });
    const proposal = await waitFor(async () =>
      ((await app.inject({ method: "GET", url: `/api/engagements/${eid}/proposals` })).json() as ProposalView[]).find((p) => p.proposal.status === "pending"),
    );

    expect(rejections).toEqual([[expect.stringContaining("source dark-web is not in the Source Catalog")]]);
    expect(proposal.readableOps[0]).toContain("; sources: open-web (Public case studies to corroborate the panel), mfg-it-benchmarks (");

    expect((await app.inject({ method: "POST", url: `/api/engagements/${eid}/proposals/${proposal.proposal.id}/approve` })).statusCode).toBe(200);

    const detail = (await app.inject({ method: "GET", url: `/api/engagements/${eid}/items/WI-005` })).json() as ItemDetailView;
    expect(detail.def.sources.map((s) => s.id)).toEqual(["open-web", "mfg-it-benchmarks"]);
    expect(fs.readFileSync(ctx.paths.itemMd("WI-005"), "utf8")).toContain("id: mfg-it-benchmarks");

    const catalog = (await app.inject({ method: "GET", url: `/api/engagements/${eid}/sources` })).json() as SourceCatalogEntry[];
    expect(catalog.find((s) => s.id === "mfg-it-benchmarks")!.usedBy).toEqual([
      { itemId: "WI-005", title: "Short benchmarking scan", purpose: "Peer figures on ERP phasing and OEM visibility" },
    ]);
    expect(catalog.find((s) => s.id === "analyst-briefs")!.usedBy).toEqual([]);
    expect(catalog.every((s) => !("connection" in s))).toBe(true);

    // The fake WI-005 script blocks on a question, the scripted Approach task answers it, then it publishes and submits.
    const done = await waitFor(async () => {
      const d = (await app.inject({ method: "GET", url: `/api/engagements/${eid}/items/WI-005` })).json() as ItemDetailView;
      return d.node.status === "done" ? d : undefined;
    });
    expect(done.outputs.find((o) => o.slot === "benchmark")!.versions).toHaveLength(1);

    const sourceIds = new Set<string>();
    for (const run of done.runs) {
      const view = (await app.inject({ method: "GET", url: `/api/engagements/${eid}/runs/${run.id}/activity` })).json() as RunActivityView;
      for (const a of view.activity) if (a.sourceId) sourceIds.add(a.sourceId);
      expect(view.activity.filter((a) => a.kind === "denial")).toEqual([]);
    }
    expect([...sourceIds].sort()).toEqual(["mfg-it-benchmarks", "open-web"]);
  });
});
