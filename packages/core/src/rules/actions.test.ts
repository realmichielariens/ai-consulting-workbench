import { describe, expect, it } from "vitest";
import { computeItemActions, type ItemActionState } from "./actions.js";

const base: ItemActionState = {
  executor: "agent",
  status: "ready",
  hasActiveRun: false,
  resumable: false,
  allRequiredOutputsPublished: false,
};

describe("computeItemActions: composites", () => {
  it("disallows every action with the same reason", () => {
    const a = computeItemActions({ ...base, executor: null });
    for (const action of [a.start, a.stop, a.resume, a.markDone, a.edit, a.upload]) {
      expect(action.allowed).toBe(false);
      expect(action.reason).toContain("Composite items have no actions");
    }
  });
});

describe("computeItemActions: start (agent)", () => {
  it("allowed when ready, no active run, not resumable", () => {
    expect(computeItemActions(base).start).toEqual({ allowed: true, reason: null });
  });

  it("refused when already running", () => {
    const a = computeItemActions({ ...base, hasActiveRun: true, status: "in_progress" });
    expect(a.start.allowed).toBe(false);
  });

  it("refused when resumable (use Resume instead)", () => {
    const a = computeItemActions({ ...base, resumable: true });
    expect(a.start).toEqual({ allowed: false, reason: expect.stringContaining("Use Resume") });
  });

  it("refused for a human item", () => {
    expect(computeItemActions({ ...base, executor: "human" }).start.allowed).toBe(false);
  });

  it("refused when not ready", () => {
    expect(computeItemActions({ ...base, status: "waiting" }).start.allowed).toBe(false);
  });

  it("allowed when in progress with no active run (a run that never got going)", () => {
    expect(computeItemActions({ ...base, status: "in_progress" }).start).toEqual({ allowed: true, reason: null });
  });
});

describe("computeItemActions: stop", () => {
  it("allowed only while in_progress with an active run", () => {
    const a = computeItemActions({ ...base, status: "in_progress", hasActiveRun: true });
    expect(a.stop).toEqual({ allowed: true, reason: null });
  });

  it("refused otherwise", () => {
    expect(computeItemActions({ ...base, status: "in_progress", hasActiveRun: false }).stop.allowed).toBe(false);
    expect(computeItemActions(base).stop.allowed).toBe(false);
  });
});

describe("computeItemActions: resume", () => {
  it("allowed when resumable, agent, not running", () => {
    const a = computeItemActions({ ...base, status: "ready", resumable: true });
    expect(a.resume).toEqual({ allowed: true, reason: null });
  });

  it("refused for human items", () => {
    expect(computeItemActions({ ...base, executor: "human", resumable: true }).resume.allowed).toBe(false);
  });

  it("refused when not resumable", () => {
    expect(computeItemActions(base).resume.allowed).toBe(false);
  });
});

describe("computeItemActions: markDone (human)", () => {
  const human: ItemActionState = { ...base, executor: "human", status: "in_progress" };

  it("refused until every required output is published", () => {
    const a = computeItemActions({ ...human, allRequiredOutputsPublished: false });
    expect(a.markDone.allowed).toBe(false);
  });

  it("allowed once outputs are published", () => {
    const a = computeItemActions({ ...human, allRequiredOutputsPublished: true });
    expect(a.markDone).toEqual({ allowed: true, reason: null });
  });

  it("refused for agent items", () => {
    expect(computeItemActions({ ...base, status: "in_progress", allRequiredOutputsPublished: true }).markDone.allowed).toBe(false);
  });
});

describe("computeItemActions: edit", () => {
  it("allowed while waiting or ready", () => {
    expect(computeItemActions({ ...base, status: "waiting" }).edit.allowed).toBe(true);
    expect(computeItemActions({ ...base, status: "ready" }).edit.allowed).toBe(true);
  });

  it("disabled once in progress, with the I2 explanation", () => {
    const a = computeItemActions({ ...base, status: "in_progress" });
    expect(a.edit.allowed).toBe(false);
    expect(a.edit.reason).toContain("Approach Agent (I2)");
  });
});

describe("computeItemActions: upload (human)", () => {
  it("allowed while ready or in_progress", () => {
    expect(computeItemActions({ ...base, executor: "human", status: "ready" }).upload.allowed).toBe(true);
    expect(computeItemActions({ ...base, executor: "human", status: "in_progress" }).upload.allowed).toBe(true);
  });

  it("refused for agent items", () => {
    expect(computeItemActions({ ...base, status: "ready" }).upload.allowed).toBe(false);
  });

  it("refused once done", () => {
    expect(computeItemActions({ ...base, executor: "human", status: "done" }).upload.allowed).toBe(false);
  });
});
