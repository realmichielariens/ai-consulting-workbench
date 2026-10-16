import { describe, expect, it } from "vitest";
import { computeRollup, leafDescendantStatuses, rollupFor, type RollupTreeItem } from "./rollup.js";

describe("computeRollup", () => {
  it("counts per status and picks the worst by STATUS_SEVERITY", () => {
    const r = computeRollup(["done", "done", "in_progress", "blocked"]);
    expect(r).toEqual({ total: 4, done: 2, byStatus: { done: 2, in_progress: 1, blocked: 1 }, worst: "blocked" });
  });

  it("worst is null for an empty composite", () => {
    expect(computeRollup([])).toEqual({ total: 0, done: 0, byStatus: {}, worst: null });
  });

  it("all done -> worst is done", () => {
    const r = computeRollup(["done", "done"]);
    expect(r.worst).toBe("done");
  });
});

describe("leafDescendantStatuses / rollupFor", () => {
  const items: RollupTreeItem[] = [
    { id: "ENG", parent: null, executor: null, status: null },
    { id: "PH-1", parent: "ENG", executor: null, status: null },
    { id: "WI-002", parent: "PH-1", executor: "agent", status: "at_gate" },
    { id: "WI-003", parent: "PH-1", executor: "human", status: "ready" },
    { id: "PH-2", parent: "ENG", executor: null, status: null },
    { id: "WI-004", parent: "PH-2", executor: "agent", status: "waiting" },
  ];

  it("collects leaf statuses at any depth, skipping composites", () => {
    expect(leafDescendantStatuses(items, "ENG").sort()).toEqual(["at_gate", "ready", "waiting"].sort());
  });

  it("scopes to the given composite's subtree", () => {
    expect(leafDescendantStatuses(items, "PH-1").sort()).toEqual(["at_gate", "ready"].sort());
  });

  it("rollupFor combines both steps", () => {
    const r = rollupFor(items, "PH-1");
    expect(r).toEqual({ total: 2, done: 0, byStatus: { at_gate: 1, ready: 1 }, worst: "at_gate" });
  });

  it("a leaf with no children returns itself", () => {
    expect(leafDescendantStatuses(items, "WI-002")).toEqual([]);
  });
});
