// Runtime termination-loop test: a scripted (mocked) runOnce, no SDK/API
// calls. Proves the nudge-then-no_submit path (R3) end to end through
// createSdkRuntime()'s injectable deps, including that the second call
// resumes the SAME session with NUDGE_MESSAGE.
import { describe, expect, test, vi } from "vitest";
import path from "node:path";
import { NUDGE_MESSAGE, type ActivityItem, type ItemDef, type RunObserver, type StartRunRequest, type WorkPort } from "@workbench/core";
import { engagementPaths, workspacePaths } from "@workbench/core/node";
import { createSdkRuntime, type RuntimeConfig } from "./runtime.js";
import type { RunOnceArgs, RunOnceResult } from "./sdk.js";

const promptsDir = path.resolve(import.meta.dirname, "../prompts");

function makeItem(): ItemDef {
  return {
    id: "WI-002",
    title: "Prepare interview guide",
    parent: "PH-1",
    order: 1,
    executor: "agent",
    inputs: [],
    sequencing: [],
    outputs: [{ slot: "interview-guide", format: "md", scope: "project", description: "The guide", required: true }],
    skills: ["interview-guide-design"],
    gate: [{ type: "human-review" }],
    autostart: true,
    acceptance: ["A distinct set of questions per stakeholder"],
    brief: "Prepare the interview guide.",
  };
}

function makeWorkPort(paths: ReturnType<typeof engagementPaths>): WorkPort {
  return {
    itemId: "WI-002",
    runId: "R-0001",
    getBrief: async () => ({
      itemId: "WI-002",
      title: "Prepare interview guide",
      brief: "Prepare the interview guide.",
      acceptance: ["A distinct set of questions per stakeholder"],
      inputs: [],
      outputs: [{ slot: "interview-guide", format: "md", scope: "project", description: "The guide", required: true, latestVersion: null }],
      gate: [{ type: "human-review" }],
      workDir: paths.itemWork("WI-002"),
      engagementContextPath: null,
    }),
    publishAsset: async () => {
      throw new Error("not exercised in this test");
    },
    appendWorklog: async () => {},
    raiseQuestion: async () => ({ requestId: "RQ-0001", instruction: "Recorded. End your turn now." }),
    reportProgress: async () => {},
    submitOutputs: async () => ({ accepted: false, missing: ["interview-guide"], instruction: "Not accepted." }),
    proposePlanChange: async () => ({ requestId: "RQ-9999", instruction: "Recorded." }),
  };
}

function makeReq(paths: ReturnType<typeof engagementPaths>, workspace: ReturnType<typeof workspacePaths>): StartRunRequest {
  return {
    runId: "R-0001",
    engagementId: "acme-1",
    item: makeItem(),
    reason: "start",
    input: { reason: "start" },
    resumeSessionId: null,
    paths,
    workspace,
    workPort: makeWorkPort(paths),
    observer: undefined as unknown as RunObserver, // set by the test
    model: "claude-haiku-4-5",
    maxTurns: 40,
    settings: { questionHandling: "always-human", itemStart: "auto", planChanges: "propose", readPolicy: "project-with-tracking" },
  };
}

describe("runtime nudge/termination loop", () => {
  test("no submit, no question -> one nudge, then outcome no_submit (R3)", async () => {
    const paths = engagementPaths(path.join("C:/fake/engagements", "acme-1"));
    const workspace = workspacePaths("C:/fake/workspace");
    const activityLog: ActivityItem[] = [];
    const observer: RunObserver = {
      onActivity: (item) => activityLog.push(item),
      onSession: () => {},
      onPid: () => {},
      onRead: () => {},
    };
    const req = { ...makeReq(paths, workspace), observer };

    let calls = 0;
    const seenResume: Array<string | undefined> = [];
    const seenPrompts: string[] = [];
    const runOnce = vi.fn(async (args: RunOnceArgs): Promise<RunOnceResult> => {
      calls += 1;
      seenResume.push(args.resume);
      seenPrompts.push(args.prompt);
      return {
        sessionId: "sess-abc",
        subtype: "success",
        isError: false,
        costUsd: 0.01,
        turns: 3,
        lastMessageText: calls === 1 ? "I looked around but didn't finish." : "Still not done.",
        retries: 0,
      };
    });

    const config: RuntimeConfig = {
      promptsDir,
      skillsPluginPath: "C:/fake/skills",
      devCapUsd: 100,
      repoRoot: "C:/fake/repo",
    };
    const runtime = createSdkRuntime(config, workspace, { runOnce, buildEnv: () => ({}) });

    const handle = runtime.startRun(req);
    const result = await handle.done;

    expect(calls).toBe(2); // initial call + exactly one nudge (MAX_NUDGES = 1)
    expect(seenResume[0]).toBeUndefined(); // reason "start": no session to resume yet
    expect(seenResume[1]).toBe("sess-abc"); // the nudge resumes the SAME session
    expect(seenPrompts[1]).toBe(NUDGE_MESSAGE);

    expect(result.outcome).toBe("no_submit");
    expect(result.nudged).toBe(true);
    expect(result.sessionId).toBe("sess-abc");
    expect(result.costUsd).toBeCloseTo(0.02, 5); // summed across both calls
    expect(result.turns).toBe(6);
    expect(result.denials).toBe(0);
    expect(result.error).toBeNull();

    const kinds = activityLog.map((a) => a.kind);
    expect(kinds).toContain("nudge");
    expect(kinds.at(-1)).toBe("result");
    expect(activityLog.at(-1)!.summary).toContain("no_submit");
  });

  test("resume-answer reason resumes the given session from the first call", async () => {
    const paths = engagementPaths(path.join("C:/fake/engagements", "acme-1"));
    const workspace = workspacePaths("C:/fake/workspace");
    const observer: RunObserver = { onActivity: () => {}, onSession: () => {}, onPid: () => {}, onRead: () => {} };
    const req: StartRunRequest = {
      ...makeReq(paths, workspace),
      observer,
      reason: "resume-answer",
      input: { reason: "resume-answer", requestId: "RQ-0001", question: "q", mode: "approve", answer: "a" },
      resumeSessionId: "sess-original",
    };

    const runOnce = vi.fn(async (args: RunOnceArgs): Promise<RunOnceResult> => {
      expect(args.resume).toBe("sess-original");
      return { sessionId: "sess-original", subtype: "success", isError: false, costUsd: 0.01, turns: 2, lastMessageText: "", retries: 0 };
    });

    const config: RuntimeConfig = { promptsDir, skillsPluginPath: "C:/fake/skills", devCapUsd: 100, repoRoot: "C:/fake/repo" };
    const runtime = createSdkRuntime(config, workspace, { runOnce, buildEnv: () => ({}) });
    // submitOutputs never called by this workPort -> ends as no_submit after one nudge, same as above;
    // the point of this test is only the resume wiring, asserted inside the mock.
    await runtime.startRun(req).done;
    expect(runOnce).toHaveBeenCalled();
  });
});
