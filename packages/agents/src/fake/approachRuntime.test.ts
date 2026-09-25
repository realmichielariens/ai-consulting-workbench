// End-to-end test of the scripted fake Approach Agent against the in-memory
// ApproachPort: kick-off turn 1 (clarifying questions), kick-off turn 2
// (publishes context+stakeholders and proposes the acme seed's plan), a
// matched turn ("where are we?"), a question task session and a suggestion
// task session. No SDK/API calls; delayMs: 0 for speed.
import { describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { ActivityItem, ApproachTaskRequest, ApproachTurnRequest, ItemDef, Request, RunObserver, ThreadId } from "@workbench/core";
import { engagementPaths, workspacePaths } from "@workbench/core/node";
import { createFakeApproachRuntime, defaultApproachFakeScriptsDir } from "./approachRuntime.js";
import { InMemoryApproachPort, InMemoryEngagement } from "../dev/in-memory-engagement.js";

const scriptsDir = defaultApproachFakeScriptsDir();

function newEngagement(): InMemoryEngagement {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "workbench-fake-approach-test-"));
  const eng = new InMemoryEngagement(engagementPaths(path.join(root, "eng")).root, [
    { id: "ENG", title: "New engagement", parent: null, order: 0, executor: null, inputs: [], sequencing: [], outputs: [
      { slot: "context", format: "md", scope: "project", description: "Context", required: true },
      { slot: "stakeholders", format: "md", scope: "project", description: "Stakeholders", required: true },
    ], skills: [], gate: [], autostart: true, acceptance: [], brief: "Not yet described." },
  ]);
  fs.mkdirSync(eng.paths.itemWork("ENG"), { recursive: true });
  return eng;
}

function collectObserver(): { observer: RunObserver; activity: ActivityItem[] } {
  const activity: ActivityItem[] = [];
  return {
    activity,
    observer: { onActivity: (item) => activity.push(item), onSession: () => {}, onPid: () => {}, onRead: () => {} },
  };
}

const workspace = workspacePaths(path.join(os.tmpdir(), "workbench-fake-approach-test-ws"));
const threadId = "T-0001" as ThreadId;

function makeTurnReq(eng: InMemoryEngagement, observer: RunObserver, runId: string, message: string, resumeSessionId: string | null): ApproachTurnRequest {
  const port = new InMemoryApproachPort(eng, runId as never, "conversation", threadId, null);
  return {
    runId: runId as never,
    engagementId: "acme-1",
    paths: eng.paths,
    workspace,
    port,
    observer,
    model: "fake",
    maxTurns: 40,
    settings: { questionHandling: "aa-first", itemStart: "auto", planChanges: "propose", readPolicy: "project-with-tracking" },
    threadId,
    resumeSessionId,
    situation: "",
    message,
  };
}

describe("fake Approach runtime: conversation turns", () => {
  test("kick-off turn 1: a text-only clarifying turn, nothing published, no session resumed", async () => {
    const eng = newEngagement();
    const { observer, activity } = collectObserver();
    const runtime = createFakeApproachRuntime({ scriptsDir, delayMs: 0 });

    const result = await runtime.startTurn(makeTurnReq(eng, observer, "R-0001", "We need an IT strategy.", null)).done;

    expect(result.outcome).toBe("completed");
    expect(activity.map((a) => a.kind)).toEqual(["system", "text", "result"]);
    expect(eng.latest("ENG/context")).toBeUndefined();
  });

  test("kick-off turn 2: publishes context+stakeholders and proposes update_brief + the 5 acme-seed items", async () => {
    const eng = newEngagement();
    const { observer, activity } = collectObserver();
    const runtime = createFakeApproachRuntime({ scriptsDir, delayMs: 0 });

    await runtime.startTurn(makeTurnReq(eng, observer, "R-0001", "unmatched turn 1", null)).done;
    const result = await runtime.startTurn(makeTurnReq(eng, observer, "R-0002", "Acme is a manufacturer.", "fake-R-0001")).done;

    expect(result.outcome).toBe("completed");
    expect(eng.latest("ENG/context")?.version).toBe("1.0");
    expect(eng.latest("ENG/stakeholders")?.version).toBe("1.0");
    expect(fs.existsSync(path.join(eng.paths.itemWork("ENG"), "context.md"))).toBe(true);

    const proposeActivity = activity.find((a) => typeof a.summary === "string" && a.summary.startsWith("Proposed "));
    expect(proposeActivity).toBeDefined();
    expect(proposeActivity!.summary).toContain("6 operations"); // update_brief ENG + add_item x5 (PH-1, WI-002, WI-003, PH-2, WI-004)
  });

  test('match "where are we" builds a text reply from the live plan (get_plan), independent of kick-off sequencing', async () => {
    const eng = newEngagement();
    const { observer, activity } = collectObserver();
    const runtime = createFakeApproachRuntime({ scriptsDir, delayMs: 0 });

    const result = await runtime.startTurn(makeTurnReq(eng, observer, "R-0001", "Where are we on this?", null)).done;

    expect(result.outcome).toBe("completed");
    const textActivity = activity.find((a) => a.kind === "text");
    expect(textActivity!.detail).toContain("# Plan");
    expect(textActivity!.detail).toContain("ENG");
  });

  test('match "benchmark" proposes add_item WI-005 regardless of kick-off turn position', async () => {
    const eng = newEngagement();
    const { observer, activity } = collectObserver();
    const runtime = createFakeApproachRuntime({ scriptsDir, delayMs: 0 });

    const result = await runtime.startTurn(makeTurnReq(eng, observer, "R-0001", "Should we add a benchmark item?", null)).done;

    expect(result.outcome).toBe("completed");
    const proposeActivity = activity.find((a) => typeof a.summary === "string" && a.summary.startsWith("Proposed "));
    expect(proposeActivity!.summary).toContain("1 operation");
  });
});

describe("fake Approach runtime: task sessions", () => {
  function questionRequest(itemId: string): Request {
    return {
      id: "RQ-0001",
      from: `agent:${itemId}` as never,
      to: "approach",
      routedTo: "approach",
      escalation: null,
      itemId: itemId as never,
      runId: null,
      status: "open",
      blocking: true,
      response: null,
      createdAt: new Date().toISOString(),
      resolvedAt: null,
      type: "question",
      payload: { question: "Which focus?", hypothesis: "Lean into vision.", alternatives: ["Lean into history."] },
    };
  }

  function makeItem(id: string): ItemDef {
    return {
      id: id as never,
      title: `Item ${id}`,
      parent: "PH-1" as never,
      order: 1,
      executor: "agent",
      inputs: [],
      sequencing: [],
      outputs: [],
      skills: [],
      gate: [],
      autostart: true,
      acceptance: [],
      brief: "Some brief.",
    };
  }

  test("question from WI-002 is answered (approve), per question.yaml's byItem", async () => {
    const eng = newEngagement();
    const { observer, activity } = collectObserver();
    const runtime = createFakeApproachRuntime({ scriptsDir, delayMs: 0 });
    const port = new InMemoryApproachPort(eng, "R-0003" as never, "question", null, "RQ-0001" as never);

    const req: ApproachTaskRequest = {
      runId: "R-0003" as never,
      engagementId: "acme-1",
      paths: eng.paths,
      workspace,
      port,
      observer,
      model: "fake",
      maxTurns: 40,
      settings: { questionHandling: "aa-first", itemStart: "auto", planChanges: "propose", readPolicy: "project-with-tracking" },
      kind: "question",
      request: questionRequest("WI-002"),
      item: makeItem("WI-002"),
      situation: "",
    };

    const result = await runtime.startTask(req).done;
    expect(result.outcome).toBe("completed");
    expect(activity.some((a) => a.summary.startsWith("Answered RQ-0001"))).toBe(true);
  });

  test("question from another item falls back to escalate", async () => {
    const eng = newEngagement();
    const { observer, activity } = collectObserver();
    const runtime = createFakeApproachRuntime({ scriptsDir, delayMs: 0 });
    const port = new InMemoryApproachPort(eng, "R-0004" as never, "question", null, "RQ-0002" as never);

    const req: ApproachTaskRequest = {
      runId: "R-0004" as never,
      engagementId: "acme-1",
      paths: eng.paths,
      workspace,
      port,
      observer,
      model: "fake",
      maxTurns: 40,
      settings: { questionHandling: "aa-first", itemStart: "auto", planChanges: "propose", readPolicy: "project-with-tracking" },
      kind: "question",
      request: { ...questionRequest("WI-004"), id: "RQ-0002" as never },
      item: makeItem("WI-004"),
      situation: "",
    };

    const result = await runtime.startTask(req).done;
    expect(result.outcome).toBe("completed");
    expect(activity.some((a) => a.summary.startsWith("Escalated RQ-0002"))).toBe(true);
  });

  test("suggestion with non-empty suggestedOps calls propose_ops", async () => {
    const eng = newEngagement();
    const { observer, activity } = collectObserver();
    const runtime = createFakeApproachRuntime({ scriptsDir, delayMs: 0 });
    const port = new InMemoryApproachPort(eng, "R-0005" as never, "suggestion", null, "RQ-0003" as never);

    const req: ApproachTaskRequest = {
      runId: "R-0005" as never,
      engagementId: "acme-1",
      paths: eng.paths,
      workspace,
      port,
      observer,
      model: "fake",
      maxTurns: 40,
      settings: { questionHandling: "aa-first", itemStart: "auto", planChanges: "propose", readPolicy: "project-with-tracking" },
      kind: "suggestion",
      request: {
        id: "RQ-0003" as never,
        from: "agent:WI-004" as never,
        to: "approach",
        routedTo: "approach",
        escalation: null,
        itemId: "WI-004" as never,
        runId: null,
        status: "open",
        blocking: false,
        response: null,
        createdAt: new Date().toISOString(),
        resolvedAt: null,
        type: "proposal",
        payload: {
          summary: "CFO follow-up needed.",
          suggestedOps: [{ op: "cancel_item", itemId: "WI-900", reason: "test op, just needs to be a valid PlanOp" }],
        },
      },
      item: makeItem("WI-004"),
      situation: "",
    };

    const result = await runtime.startTask(req).done;
    expect(result.outcome).toBe("completed");
    expect(activity.some((a) => typeof a.summary === "string" && a.summary.startsWith("Proposed "))).toBe(true);
  });

  test("suggestion with empty suggestedOps calls decline_suggestion", async () => {
    const eng = newEngagement();
    const { observer, activity } = collectObserver();
    const runtime = createFakeApproachRuntime({ scriptsDir, delayMs: 0 });
    const port = new InMemoryApproachPort(eng, "R-0006" as never, "suggestion", null, "RQ-0004" as never);

    const req: ApproachTaskRequest = {
      runId: "R-0006" as never,
      engagementId: "acme-1",
      paths: eng.paths,
      workspace,
      port,
      observer,
      model: "fake",
      maxTurns: 40,
      settings: { questionHandling: "aa-first", itemStart: "auto", planChanges: "propose", readPolicy: "project-with-tracking" },
      kind: "suggestion",
      request: {
        id: "RQ-0004" as never,
        from: "agent:WI-004" as never,
        to: "approach",
        routedTo: "approach",
        escalation: null,
        itemId: "WI-004" as never,
        runId: null,
        status: "open",
        blocking: false,
        response: null,
        createdAt: new Date().toISOString(),
        resolvedAt: null,
        type: "proposal",
        payload: { summary: "Vague idea, no concrete ops.", suggestedOps: [] },
      },
      item: makeItem("WI-004"),
      situation: "",
    };

    const result = await runtime.startTask(req).done;
    expect(result.outcome).toBe("completed");
    expect(activity.some((a) => a.summary.startsWith("Declined RQ-0004"))).toBe(true);
  });
});
