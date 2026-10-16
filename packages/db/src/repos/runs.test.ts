import { afterEach, describe, expect, it } from "vitest";
import { openTestDb, type TestDb } from "../testDb.js";
import { createRun, finishRun, getRun, listActiveRuns, listByItem, updateRunProgress } from "./runs.js";

const now = () => new Date().toISOString();

describe("runs repository", () => {
  let t: TestDb;
  afterEach(() => t?.cleanup());

  it("create -> active (outcome null) -> finish", () => {
    t = openTestDb();
    const created = createRun(t.ctx, {
      id: "R-0001",
      itemId: "WI-002",
      sessionId: null,
      reason: "start",
      runtime: "fake",
      model: "claude-haiku-4-5",
      promptHash: "abc",
      startedAt: now(),
    });
    expect(created.outcome).toBeNull();
    expect(listActiveRuns(t.ctx).map((r) => r.id)).toEqual(["R-0001"]);

    updateRunProgress(t.ctx, "R-0001", { sessionId: "sess-1", costUsd: 0.01, turns: 2 });
    expect(getRun(t.ctx, "R-0001")).toMatchObject({ sessionId: "sess-1", costUsd: 0.01, turns: 2 });

    const finished = finishRun(t.ctx, "R-0001", {
      outcome: "submitted",
      costUsd: 0.03,
      turns: 5,
      promptHash: "abc",
      nudged: false,
      denials: 0,
      error: null,
      report: { summary: "done", selfCheck: [{ criterion: "x", met: "yes", note: "" }], openIssues: [] },
      endedAt: now(),
    });
    expect(finished.outcome).toBe("submitted");
    expect(finished.report?.summary).toBe("done");
    expect(listActiveRuns(t.ctx)).toEqual([]);
  });

  it("listByItem is newest first", () => {
    t = openTestDb();
    createRun(t.ctx, { id: "R-0001", itemId: "WI-002", sessionId: null, reason: "start", runtime: "fake", model: "m", promptHash: null, startedAt: "2026-01-01T00:00:00.000Z" });
    createRun(t.ctx, { id: "R-0002", itemId: "WI-002", sessionId: null, reason: "resume", runtime: "fake", model: "m", promptHash: null, startedAt: "2026-01-02T00:00:00.000Z" });
    expect(listByItem(t.ctx, "WI-002").map((r) => r.id)).toEqual(["R-0002", "R-0001"]);
  });
});
