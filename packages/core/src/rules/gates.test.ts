import { describe, expect, it } from "vitest";
import { openGateRound, resolveGateVerdict, type GateRoundStep } from "./gates.js";

const humanReviewChain = [{ type: "human-review" as const }];
const submitted = [{ slot: "WI-002/interview-guide" as const, version: "1.0" as const }];

describe("openGateRound", () => {
  it("opens round 1, step 0, for a fresh submission", () => {
    const steps = openGateRound(humanReviewChain, 0, submitted);
    expect(steps).toEqual([{ round: 1, seq: 0, type: "human-review", status: "open", assetVersions: submitted }]);
  });

  it("opens the next round on a resubmission", () => {
    const steps = openGateRound(humanReviewChain, 1, submitted);
    expect(steps[0]?.round).toBe(2);
  });

  it("only step 0 opens; later steps start pending", () => {
    const chain = [{ type: "ai-review" as const }, { type: "human-review" as const }];
    const steps = openGateRound(chain, 0, submitted);
    expect(steps.map((s) => s.status)).toEqual(["open", "pending"]);
  });
});

describe("resolveGateVerdict", () => {
  const openStep = (round: number): GateRoundStep => ({ round, seq: 0, type: "human-review", status: "open", assetVersions: submitted });

  it("approving the last step passes the chain", () => {
    const r = resolveGateVerdict(openStep(1), 1, "approved", true);
    expect(r).toEqual({ ok: true, stepStatus: "passed", chainDone: true });
  });

  it("approving a non-last step passes it without finishing the chain", () => {
    const r = resolveGateVerdict(openStep(1), 1, "approved", false);
    expect(r).toEqual({ ok: true, stepStatus: "passed", chainDone: false });
  });

  it("changes_requested never finishes the chain", () => {
    const r = resolveGateVerdict(openStep(1), 1, "changes_requested", true);
    expect(r).toEqual({ ok: true, stepStatus: "changes_requested", chainDone: false });
  });

  it("rejects a verdict on a step that isn't open", () => {
    const passed: GateRoundStep = { ...openStep(1), status: "passed" };
    const r = resolveGateVerdict(passed, 1, "approved", true);
    expect(r).toEqual({ ok: false, reason: expect.stringContaining("not open") });
  });

  it("J1.5: rejects a verdict for a superseded round", () => {
    // The item was reviewed at round 1, but a newer submission opened round 2
    // before the verdict was recorded.
    const r = resolveGateVerdict(openStep(1), 2, "approved", true);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/newer version/i);
  });
});
