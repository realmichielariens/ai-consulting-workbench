// End-to-end test of the scripted fake agent against the in-memory WorkPort:
// WI-002 start -> blocked (raises its blocking CIO question), then
// resume-answer -> submitted; plus a generic item with no dedicated script
// (the fallback path). No SDK/API calls; delayMs: 0 for speed.
import { describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { parse as parseYaml } from "yaml";
import { PlanTemplate, type ActivityItem, type ItemDef, type RunObserver, type StartRunRequest } from "@workbench/core";
import { workspacePaths } from "@workbench/core/node";
import { createFakeRuntime } from "./runtime.js";
import { InMemoryEngagement, InMemoryWorkPort, seedPublish } from "../dev/in-memory-engagement.js";

const repoRoot = path.resolve(import.meta.dirname, "../../../.."); // packages/agents/src/fake -> repo root
const seedDir = path.join(repoRoot, "demo", "seeds", "acme-discovery");
const scriptsDir = path.resolve(import.meta.dirname, "../../fake-scripts");

function loadSeedItems(): ItemDef[] {
  const raw = parseYaml(fs.readFileSync(path.join(seedDir, "plan.template.yaml"), "utf8"));
  return PlanTemplate.parse(raw).items;
}

function newFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "workbench-fake-runtime-test-"));
  const workspace = workspacePaths(path.join(root, "workspace"));
  const items = loadSeedItems();
  const eng = new InMemoryEngagement(path.join(workspace.engagementsDir, "acme-1"), items);
  for (const dir of fs.readdirSync(path.join(seedDir, "assets"))) {
    for (const file of fs.readdirSync(path.join(seedDir, "assets", dir))) {
      const slot = path.parse(file).name;
      seedPublish(eng, `${dir}/${slot}`, path.join(seedDir, "assets", dir, file), "human", `From seed acme-discovery`);
    }
  }
  for (const item of items) {
    fs.mkdirSync(eng.paths.itemWork(item.id), { recursive: true });
  }
  return { eng, workspace, root };
}

function collectObserver(): { observer: RunObserver; activity: ActivityItem[] } {
  const activity: ActivityItem[] = [];
  return {
    activity,
    observer: { onActivity: (item) => activity.push(item), onSession: () => {}, onPid: () => {}, onRead: () => {} },
  };
}

describe("fake runtime end-to-end", () => {
  test("WI-002 start -> blocked (raises the CIO-focus question with a hypothesis)", async () => {
    const { eng, workspace } = newFixture();
    const item = eng.items.get("WI-002")!;
    const workPort = new InMemoryWorkPort(eng, "WI-002", "R-0001");
    const { observer, activity } = collectObserver();
    const runtime = createFakeRuntime({ scriptsDir, delayMs: 0 });

    const req: StartRunRequest = {
      runId: "R-0001",
      engagementId: "acme-1",
      item,
      reason: "start",
      input: { reason: "start" },
      resumeSessionId: null,
      paths: eng.paths,
      workspace,
      workPort,
      observer,
      model: "fake",
      maxTurns: 40,
      settings: { questionHandling: "always-human", itemStart: "auto", planChanges: "propose", readPolicy: "project-with-tracking" },
    };

    const result = await runtime.startRun(req).done;

    expect(result.outcome).toBe("blocked");
    expect(result.model).toBe("fake");
    expect(eng.latest("WI-002/interview-guide")?.version).toBe("1.0");
    expect(eng.questions).toHaveLength(1);
    expect(eng.questions[0]!.blocking).toBe(true);
    expect(eng.questions[0]!.hypothesis.length).toBeGreaterThan(0);

    const kinds = activity.map((a) => a.kind);
    expect(kinds).toContain("publish");
    expect(kinds).toContain("question");
    expect(kinds.at(-1)).toBe("result");
    // The real guide file was actually written into work/, not just simulated.
    expect(fs.existsSync(path.join(eng.paths.itemWork("WI-002"), "interview-guide.md"))).toBe(true);
  });

  test("WI-002 resume-answer -> submitted, incorporating the answer", async () => {
    const { eng, workspace } = newFixture();
    const item = eng.items.get("WI-002")!;
    // Publish v1.0 first, as the "start" run would have.
    seedPublish(eng, "WI-002/interview-guide", path.join(seedDir, "assets", "ENG", "context.md"), "human", "seed");
    const workPort = new InMemoryWorkPort(eng, "WI-002", "R-0002");
    const { observer, activity } = collectObserver();
    const runtime = createFakeRuntime({ scriptsDir, delayMs: 0 });

    const req: StartRunRequest = {
      runId: "R-0002",
      engagementId: "acme-1",
      item,
      reason: "resume-answer",
      input: { reason: "resume-answer", requestId: "RQ-0001", question: "CIO focus?", mode: "approve", answer: "Lean into vision." },
      resumeSessionId: "fake-R-0001",
      paths: eng.paths,
      workspace,
      workPort,
      observer,
      model: "fake",
      maxTurns: 40,
      settings: { questionHandling: "always-human", itemStart: "auto", planChanges: "propose", readPolicy: "project-with-tracking" },
    };

    const result = await runtime.startRun(req).done;

    expect(result.outcome).toBe("submitted");
    const kinds = activity.map((a) => a.kind);
    expect(kinds).toContain("submit");
    expect(kinds.at(-1)!).toBe("result");
  });

  test("a generic agent item with no dedicated script uses the fallback: publishes a placeholder per required output and submits", async () => {
    const { eng, workspace } = newFixture();
    const genericItem: ItemDef = {
      id: "WI-900",
      title: "A generic future item",
      parent: "PH-2",
      order: 5,
      executor: "agent",
      inputs: [],
      sequencing: [],
      outputs: [{ slot: "summary", format: "md", scope: "project", description: "A summary", required: true }],
      skills: [],
      sources: [],
      gate: [],
      autostart: true,
      acceptance: ["Something reasonable"],
      brief: "Do a generic thing.",
    };
    eng.items.set("WI-900", genericItem);
    fs.mkdirSync(eng.paths.itemWork("WI-900"), { recursive: true });
    const workPort = new InMemoryWorkPort(eng, "WI-900", "R-0003");
    const { observer, activity } = collectObserver();
    const runtime = createFakeRuntime({ scriptsDir, delayMs: 0 });

    const req: StartRunRequest = {
      runId: "R-0003",
      engagementId: "acme-1",
      item: genericItem,
      reason: "start",
      input: { reason: "start" },
      resumeSessionId: null,
      paths: eng.paths,
      workspace,
      workPort,
      observer,
      model: "fake",
      maxTurns: 40,
      settings: { questionHandling: "always-human", itemStart: "auto", planChanges: "propose", readPolicy: "project-with-tracking" },
    };

    const result = await runtime.startRun(req).done;

    expect(result.outcome).toBe("submitted");
    expect(eng.latest("WI-900/summary")?.version).toBe("1.0");
    expect(activity.map((a) => a.kind)).toContain("publish");
  });
});
