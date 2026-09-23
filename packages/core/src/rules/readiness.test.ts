import { describe, expect, it } from "vitest";
import { computeReadiness, initialStatus, type ReadinessPlan } from "./readiness.js";

describe("computeReadiness", () => {
  it("is ready when every required input is published and sequencing items are done", () => {
    const plan: ReadinessPlan = {
      items: [
        { id: "WI-002", executor: "agent", status: "waiting", inputs: [{ slot: "ENG/context", required: true }], sequencing: [] },
        { id: "ENG", executor: null, status: null, inputs: [], sequencing: [] },
      ],
      publishedSlots: new Set(["ENG/context"]),
    };
    const r = computeReadiness(plan).get("WI-002");
    expect(r).toEqual({ ready: true, blockers: [] });
  });

  it("blocks on a missing required input, naming the producer", () => {
    const plan: ReadinessPlan = {
      items: [
        { id: "WI-004", executor: "agent", status: "waiting", inputs: [{ slot: "WI-003/notes-cfo", required: true }], sequencing: [] },
      ],
      publishedSlots: new Set(),
    };
    const r = computeReadiness(plan).get("WI-004");
    expect(r?.ready).toBe(false);
    expect(r?.blockers).toEqual([{ kind: "missing_input", slot: "WI-003/notes-cfo", producer: "WI-003" }]);
  });

  it("ignores an unpublished optional input", () => {
    const plan: ReadinessPlan = {
      items: [{ id: "WI-004", executor: "agent", status: "waiting", inputs: [{ slot: "WI-003/notes-cfo", required: false }], sequencing: [] }],
      publishedSlots: new Set(),
    };
    expect(computeReadiness(plan).get("WI-004")).toEqual({ ready: true, blockers: [] });
  });

  it("blocks on a sequencing item that is not done", () => {
    const plan: ReadinessPlan = {
      items: [
        { id: "WI-003", executor: "human", status: "in_progress", inputs: [], sequencing: [] },
        { id: "WI-004", executor: "agent", status: "waiting", inputs: [], sequencing: ["WI-003"] },
      ],
      publishedSlots: new Set(),
    };
    const r = computeReadiness(plan).get("WI-004");
    expect(r).toEqual({ ready: false, blockers: [{ kind: "sequencing", item: "WI-003", status: "in_progress" }] });
  });

  it("treats a missing sequencing item's status as null", () => {
    const plan: ReadinessPlan = {
      items: [{ id: "WI-004", executor: "agent", status: "waiting", inputs: [], sequencing: ["WI-999"] }],
      publishedSlots: new Set(),
    };
    const r = computeReadiness(plan).get("WI-004");
    expect(r).toEqual({ ready: false, blockers: [{ kind: "sequencing", item: "WI-999", status: null }] });
  });

  it("collects multiple blockers at once", () => {
    const plan: ReadinessPlan = {
      items: [
        { id: "WI-003", executor: "human", status: "ready", inputs: [], sequencing: [] },
        {
          id: "WI-004",
          executor: "agent",
          status: "waiting",
          inputs: [{ slot: "WI-003/notes-cfo", required: true }],
          sequencing: ["WI-003"],
        },
      ],
      publishedSlots: new Set(),
    };
    const r = computeReadiness(plan).get("WI-004");
    expect(r?.ready).toBe(false);
    expect(r?.blockers).toHaveLength(2);
  });

  it("skips composites and ENG (no readiness of their own)", () => {
    const plan: ReadinessPlan = {
      items: [{ id: "PH-1", executor: null, status: null, inputs: [], sequencing: [] }],
      publishedSlots: new Set(),
    };
    expect(computeReadiness(plan).has("PH-1")).toBe(false);
  });
});

describe("initialStatus", () => {
  it("leaf items start waiting", () => {
    expect(initialStatus({ id: "WI-002", executor: "agent" })).toBe("waiting");
    expect(initialStatus({ id: "WI-003", executor: "human" })).toBe("waiting");
  });

  it("composites and ENG have no status", () => {
    expect(initialStatus({ id: "PH-1", executor: null })).toBeNull();
    expect(initialStatus({ id: "ENG", executor: null })).toBeNull();
  });
});
