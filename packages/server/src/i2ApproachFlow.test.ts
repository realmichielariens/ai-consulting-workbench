// One API-level flow test for I2 "Talk to the Approach Agent" (I2-PLAN §4,
// brief A "Checks"): blank seed -> post a message -> the turn publishes
// ENG/context + ENG/stakeholders and proposes the Discovery/Synthesis plan
// -> approve -> WI-002 autostarts on the existing fake Work Agent runtime,
// raises its scripted blocking question -> aa-first routes it to an
// Approach Agent task -> the scripted task answers it -> WI-002 resumes and
// reaches at_gate (its gate). Drives the real HTTP API via Fastify's
// app.inject, with the fake Work Agent runtime (delay 0) and an in-test
// scripted ApproachRuntime (ctx.approachRuntime is a stub until package B
// lands — CLAUDE.md/brief A: "your tests inject their own scripted
// ApproachRuntime").

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import multipart from "@fastify/multipart";
import { ItemDef, type ApproachRuntime, type ApproachTaskRequest, type ApproachTurnRequest, type InboxEntry, type ItemDetailView, type PlanOp, type ProposalView, type RunHandle, type RunResult } from "@workbench/core";
import { loadConfig, repoRoot, workspacePaths } from "@workbench/core/node";
import { createServerContext, openEngagement, type ServerContext } from "./engagementContext.js";
import { registerRoutes } from "./routes.js";

process.env.WORKBENCH_RUNTIME = "fake";
process.env.WORKBENCH_FAKE_DELAY_MS = "0";

const REPO_ROOT = repoRoot();

function mkDef(partial: Record<string, unknown> & { id: string; title: string; parent: string | null; executor: "agent" | "human" | null }): ItemDef {
  return ItemDef.parse({
    order: 0,
    inputs: [],
    sequencing: [],
    outputs: [],
    skills: [],
    gate: [],
    autostart: true,
    acceptance: [],
    brief: `Brief for ${partial.title}.`,
    ...partial,
  });
}

// Copied from demo/seeds/acme-discovery/plan.template.yaml (I2-PLAN §4, brief A checks).
const PH1 = mkDef({ id: "PH-1", title: "Discovery", parent: null, order: 1, executor: null });
const WI002 = mkDef({
  id: "WI-002",
  title: "Prepare interview guide",
  parent: "PH-1",
  order: 1,
  executor: "agent",
  inputs: [
    { slot: "ENG/context", required: true },
    { slot: "ENG/stakeholders", required: true },
  ],
  outputs: [{ slot: "interview-guide", format: "md", scope: "project", description: "Interview guide", required: true }],
  skills: ["interview-guide-design"],
  gate: [{ type: "human-review" }],
});
const WI003 = mkDef({
  id: "WI-003",
  title: "Conduct CxO interviews",
  parent: "PH-1",
  order: 2,
  executor: "human",
  inputs: [{ slot: "WI-002/interview-guide", required: true }],
  outputs: [
    { slot: "notes-ceo", format: "md", scope: "project", description: "CEO notes", required: true },
    { slot: "notes-cfo", format: "md", scope: "project", description: "CFO notes", required: true },
    { slot: "notes-coo", format: "md", scope: "project", description: "COO notes", required: true },
    { slot: "notes-cio", format: "md", scope: "project", description: "CIO notes", required: true },
  ],
});
const PH2 = mkDef({ id: "PH-2", title: "Synthesis", parent: null, order: 2, executor: null });
const WI004 = mkDef({
  id: "WI-004",
  title: "Consolidate interview themes",
  parent: "PH-2",
  order: 1,
  executor: "agent",
  inputs: [
    { slot: "WI-003/notes-ceo", required: true },
    { slot: "WI-003/notes-cfo", required: true },
    { slot: "WI-003/notes-coo", required: true },
    { slot: "WI-003/notes-cio", required: true },
    { slot: "ENG/context", required: true },
  ],
  outputs: [{ slot: "themes", format: "md", scope: "project", description: "Cross-cutting themes", required: true }],
  skills: ["thematic-synthesis"],
  gate: [{ type: "human-review" }],
});

const ACME_PLAN_OPS: PlanOp[] = [
  { op: "add_item", def: PH1 },
  { op: "add_item", def: WI002 },
  { op: "add_item", def: WI003 },
  { op: "add_item", def: PH2 },
  { op: "add_item", def: WI004 },
];

function fakeHandle(runId: string, work: () => Promise<RunResult>): RunHandle {
  return { runId: runId as never, interrupt: async () => {}, done: work() };
}

/** The scripted ApproachRuntime for this test: turn 1 publishes ENG's two slots and proposes the plan; the only task answers WI-002's question. */
function createScriptedApproachRuntime(): ApproachRuntime {
  return {
    kind: "fake",
    startTurn(req: ApproachTurnRequest): RunHandle {
      return fakeHandle(req.runId, async (): Promise<RunResult> => {
        req.observer.onSession("fake-aa-session-1");
        if (req.resumeSessionId == null) {
          const workDir = req.paths.itemWork("ENG");
          fs.mkdirSync(workDir, { recursive: true });
          fs.writeFileSync(path.join(workDir, "context.md"), "# Context\n\nAcme Manufacturing IT strategy engagement.\n");
          fs.writeFileSync(path.join(workDir, "stakeholders.md"), "# Stakeholders\n\nCEO, CFO, COO, CIO.\n");
          await req.port.publishEngagementAsset({ slot: "context", sourcePath: "context.md", kind: "material", note: "Initial context." });
          await req.port.publishEngagementAsset({ slot: "stakeholders", sourcePath: "stakeholders.md", kind: "material", note: "Initial stakeholders." });
          const result = await req.port.proposeOps({ ops: ACME_PLAN_OPS, rationale: "Set up Discovery (interview guide, interviews) and Synthesis (themes)." });
          if (!result.ok) throw new Error(`propose_ops failed: ${result.errors.join("; ")}`);
        }
        return {
          outcome: "completed",
          sessionId: "fake-aa-session-1",
          costUsd: 0,
          turns: 1,
          model: req.model,
          promptHash: null,
          nudged: false,
          denials: 0,
          lastMessage: "Set up and proposed the Discovery/Synthesis plan for approval.",
          error: null,
        };
      });
    },
    startTask(req: ApproachTaskRequest): RunHandle {
      return fakeHandle(req.runId, async (): Promise<RunResult> => {
        if (req.kind === "question" && req.request.type === "question") {
          await req.port.answerRequest({ requestId: req.request.id, mode: "approve", text: req.request.payload.hypothesis });
        }
        return { outcome: "completed", sessionId: null, costUsd: 0, turns: 1, model: req.model, promptHash: null, nudged: false, denials: 0, lastMessage: "Answered.", error: null };
      });
    },
  };
}

async function waitFor<T>(check: () => Promise<T | undefined>, timeoutMs = 5000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error("waitFor: timed out");
    await new Promise((r) => setTimeout(r, 15));
  }
}

describe("I2 flow: blank engagement -> conversation turn -> proposal -> approve -> aa-first question routing", () => {
  let app: FastifyInstance;
  let server: ServerContext;
  let tmpHome: string;

  beforeEach(async () => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "workbench-i2-flow-"));
    const config = loadConfig(REPO_ROOT);
    server = { repoRoot: REPO_ROOT, config, workspace: workspacePaths(tmpHome), runtimeKind: "fake", engagements: new Map() };

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

  it("runs the whole J2.1/J2.2/J2.3-adjacent path end to end", async () => {
    // J2.1: create a blank engagement (Approach-only, aa-first by the seed's defaults.yaml).
    const createRes = await app.inject({ method: "POST", url: "/api/engagements", payload: { seedId: "blank", name: "Acme (I2 flow test)" } });
    expect(createRes.statusCode).toBe(201);
    const eid = (createRes.json() as { id: string }).id;

    // Inject the scripted ApproachRuntime (B's real one is a stub in I2).
    const ctx = openEngagement(server, eid);
    ctx.approachRuntime = createScriptedApproachRuntime();

    // Post the human's opening message: starts the first turn.
    const postRes = await app.inject({ method: "POST", url: `/api/engagements/${eid}/threads/T-0001/messages`, payload: { text: "Let's scope Acme's IT strategy." } });
    expect(postRes.statusCode).toBe(202);

    // The turn publishes ENG's two slots and proposes the plan.
    const proposal = await waitFor(async () => {
      const res = await app.inject({ method: "GET", url: `/api/engagements/${eid}/proposals` });
      const proposals = res.json() as ProposalView[];
      return proposals.find((p) => p.proposal.status === "pending");
    });
    expect(proposal.proposal.origin).toBe("conversation");
    expect(proposal.readableOps).toHaveLength(5);

    const engAfterTurn = await app.inject({ method: "GET", url: `/api/engagements/${eid}/items/ENG` });
    const engDetail = engAfterTurn.json() as ItemDetailView;
    expect(engDetail.outputs.find((o) => o.slot === "context")?.versions).toHaveLength(1);
    expect(engDetail.outputs.find((o) => o.slot === "stakeholders")?.versions).toHaveLength(1);

    // Approve: WI-002 autostarts on the fake Work Agent runtime.
    const approveRes = await app.inject({ method: "POST", url: `/api/engagements/${eid}/proposals/${proposal.proposal.id}/approve` });
    expect(approveRes.statusCode).toBe(200);
    expect((approveRes.json() as ProposalView).proposal.status).toBe("approved");

    // WI-002 raises its scripted blocking question; aa-first routes it to the Approach task queue,
    // which only starts once WI-002's own run has ended (I2-PLAN §4.1) — then the scripted task answers it.
    await waitFor(async () => {
      const res = await app.inject({ method: "GET", url: `/api/engagements/${eid}/items/WI-002` });
      const detail = res.json() as ItemDetailView;
      return detail.node.status === "at_gate" ? true : undefined;
    }, 10000);

    const wi002 = ((await app.inject({ method: "GET", url: `/api/engagements/${eid}/items/WI-002` })).json() as ItemDetailView).node;
    expect(wi002.status).toBe("at_gate");
    const wi003BeforeGate = ((await app.inject({ method: "GET", url: `/api/engagements/${eid}/items/WI-003` })).json() as ItemDetailView).node;
    expect(wi003BeforeGate.status).toBe("waiting"); // D1: WI-002's published output still needs its gate approval

    // The question was routed to and answered by the Approach Agent (not a plain human answer).
    const inbox = (await app.inject({ method: "GET", url: `/api/engagements/${eid}/inbox` })).json() as { entries: InboxEntry[] };
    const fyi = inbox.entries.find((e): e is Extract<InboxEntry, { kind: "fyi" }> => e.kind === "fyi" && e.item?.id === "WI-002");
    expect(fyi).toBeDefined();
    expect(fyi?.request?.response).toMatchObject({ kind: "answer", mode: "approve" });
    expect((fyi?.request?.response as { by: string } | undefined)?.by).toMatch(/^approach:/);
    expect(fyi?.override.allowed).toBe(true); // ready/at_gate, not running: override should be offered

    const oldReview = inbox.entries.find((e): e is Extract<InboxEntry, { kind: "review" }> => e.kind === "review" && e.item.id === "WI-002");
    expect(oldReview).toBeDefined();
    const override = await app.inject({
      method: "POST",
      url: `/api/engagements/${eid}/requests/${fyi!.request!.id}/override`,
      payload: { mode: "replace", text: "Focus on the CIO's vision, with one question on prior commitments." },
    });
    expect(override.statusCode).toBe(200);

    const newReview = await waitFor(async () => {
      const res = await app.inject({ method: "GET", url: `/api/engagements/${eid}/inbox` });
      const next = (res.json() as { entries: InboxEntry[] }).entries.find(
        (e): e is Extract<InboxEntry, { kind: "review" }> => e.kind === "review" && e.item.id === "WI-002" && e.request.id !== oldReview!.request.id,
      );
      return next;
    }, 10000);
    const verdict = await app.inject({
      method: "POST",
      url: `/api/engagements/${eid}/requests/${newReview.request.id}/verdict`,
      payload: { verdict: "approved", comments: "" },
    });
    expect(verdict.statusCode).toBe(200);
    const afterVerdict = (await app.inject({ method: "GET", url: `/api/engagements/${eid}/items/WI-002` })).json() as ItemDetailView;
    expect(afterVerdict.node.status).toBe("done");
    const wi003AfterGate = ((await app.inject({ method: "GET", url: `/api/engagements/${eid}/items/WI-003` })).json() as ItemDetailView).node;
    expect(wi003AfterGate.status).toBe("ready");
  });
});
