import { afterEach, describe, expect, it } from "vitest";
import { openTestDb, type TestDb } from "../testDb.js";
import { createProposal, findPendingByThread, getProposal, listPending, listProposals, markApplied, markRejected, markSuperseded } from "./proposals.js";

const now = () => new Date().toISOString();

const ops = [{ op: "set_gate" as const, itemId: "WI-002" as const, gate: [] }];

describe("proposals repository", () => {
  let t: TestDb;
  afterEach(() => t?.cleanup());

  it("creates a pending proposal and reads it back", () => {
    t = openTestDb();
    const p = createProposal(t.ctx, {
      id: "P-0001",
      origin: "conversation",
      suggestedBy: null,
      requestId: null,
      threadId: "T-0001",
      author: "approach:sess-1",
      basePlanVersion: 1,
      rationale: "tighten the gate",
      ops,
      createdAt: now(),
    });
    expect(p.status).toBe("pending");
    expect(getProposal(t.ctx, "P-0001")).toEqual(p);
  });

  it("findPendingByThread finds only the pending one from that thread", () => {
    t = openTestDb();
    createProposal(t.ctx, { id: "P-0001", origin: "conversation", suggestedBy: null, requestId: null, threadId: "T-0001", author: "approach:s", basePlanVersion: 1, rationale: "r", ops, createdAt: now() });
    expect(findPendingByThread(t.ctx, "T-0001")?.id).toBe("P-0001");
    expect(findPendingByThread(t.ctx, "T-0002")).toBeNull();
    markRejected(t.ctx, "P-0001", "no longer needed", now());
    expect(findPendingByThread(t.ctx, "T-0001")).toBeNull();
  });

  it("markApplied sets status, appliedPlanVersion and resolvedAt", () => {
    t = openTestDb();
    createProposal(t.ctx, { id: "P-0001", origin: "conversation", suggestedBy: null, requestId: null, threadId: "T-0001", author: "approach:s", basePlanVersion: 1, rationale: "r", ops, createdAt: now() });
    const applied = markApplied(t.ctx, "P-0001", 2, now());
    expect(applied.status).toBe("approved");
    expect(applied.appliedPlanVersion).toBe(2);
    expect(applied.resolvedAt).not.toBeNull();
  });

  it("markSuperseded links to the replacing proposal", () => {
    t = openTestDb();
    createProposal(t.ctx, { id: "P-0001", origin: "conversation", suggestedBy: null, requestId: null, threadId: "T-0001", author: "approach:s", basePlanVersion: 1, rationale: "r", ops, createdAt: now() });
    const sup = markSuperseded(t.ctx, "P-0001", "P-0002", now());
    expect(sup.status).toBe("superseded");
    expect(sup.supersededBy).toBe("P-0002");
  });

  it("listPending excludes resolved proposals; listProposals includes everything", () => {
    t = openTestDb();
    createProposal(t.ctx, { id: "P-0001", origin: "conversation", suggestedBy: null, requestId: null, threadId: "T-0001", author: "approach:s", basePlanVersion: 1, rationale: "r", ops, createdAt: now() });
    createProposal(t.ctx, { id: "P-0002", origin: "suggestion", suggestedBy: "WI-004", requestId: "RQ-0001", threadId: null, author: "approach:s", basePlanVersion: 1, rationale: "r2", ops, createdAt: now() });
    markApplied(t.ctx, "P-0001", 2, now());
    expect(listPending(t.ctx).map((p) => p.id)).toEqual(["P-0002"]);
    expect(listProposals(t.ctx)).toHaveLength(2);
  });
});
