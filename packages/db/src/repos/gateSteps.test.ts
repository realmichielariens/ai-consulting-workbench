import { afterEach, describe, expect, it } from "vitest";
import { openGateRound } from "@workbench/core";
import { openTestDb, type TestDb } from "../testDb.js";
import { getCurrentRound, getOpenStep, getStep, insertGateRound, listByItem, resolveStep, withdrawStep } from "./gateSteps.js";

const humanReviewChain = [{ type: "human-review" as const }];
const submitted = [{ slot: "WI-002/interview-guide" as const, version: "1.0" as const }];

describe("gateSteps repository", () => {
  let t: TestDb;
  afterEach(() => t?.cleanup());

  it("stores the rows rules/gates.ts's openGateRound computes, round by round", () => {
    t = openTestDb();
    expect(getCurrentRound(t.ctx, "WI-002")).toBe(0);

    const round1 = openGateRound(humanReviewChain, getCurrentRound(t.ctx, "WI-002"), submitted);
    insertGateRound(t.ctx, "WI-002", round1);

    expect(getCurrentRound(t.ctx, "WI-002")).toBe(1);
    expect(getOpenStep(t.ctx, "WI-002")).toMatchObject({ round: 1, seq: 0, status: "open" });
    expect(getStep(t.ctx, "WI-002", 1, 0)?.assetVersions).toEqual(submitted);
  });

  it("resolveStep records the verdict and moves status", () => {
    t = openTestDb();
    insertGateRound(t.ctx, "WI-002", openGateRound(humanReviewChain, 0, submitted));
    resolveStep(t.ctx, "WI-002", 1, 0, "passed", "approved", "human", new Date().toISOString());

    const step = getStep(t.ctx, "WI-002", 1, 0);
    expect(step).toMatchObject({ status: "passed", verdict: "approved", by: "human" });
    expect(getOpenStep(t.ctx, "WI-002")).toBeNull(); // no longer open
  });

  it("a resubmission opens the next round", () => {
    t = openTestDb();
    insertGateRound(t.ctx, "WI-002", openGateRound(humanReviewChain, 0, submitted));
    resolveStep(t.ctx, "WI-002", 1, 0, "changes_requested", "changes_requested", "human", new Date().toISOString());

    const v11 = [{ slot: "WI-002/interview-guide" as const, version: "1.1" as const }];
    insertGateRound(t.ctx, "WI-002", openGateRound(humanReviewChain, getCurrentRound(t.ctx, "WI-002"), v11));

    expect(getCurrentRound(t.ctx, "WI-002")).toBe(2);
    expect(getOpenStep(t.ctx, "WI-002")).toMatchObject({ round: 2, assetVersions: v11 });
    expect(listByItem(t.ctx, "WI-002")).toHaveLength(2);
  });

  it("withdraws an open review so the next submission has the only open step", () => {
    t = openTestDb();
    insertGateRound(t.ctx, "WI-002", openGateRound(humanReviewChain, 0, submitted));
    withdrawStep(t.ctx, "WI-002", 1, 0, new Date().toISOString());
    expect(getStep(t.ctx, "WI-002", 1, 0)).toMatchObject({ status: "withdrawn", verdict: null });
    expect(getOpenStep(t.ctx, "WI-002")).toBeNull();
    insertGateRound(t.ctx, "WI-002", openGateRound(humanReviewChain, getCurrentRound(t.ctx, "WI-002"), submitted));
    expect(getOpenStep(t.ctx, "WI-002")?.round).toBe(2);
  });
});
