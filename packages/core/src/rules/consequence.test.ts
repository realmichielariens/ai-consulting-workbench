import { describe, expect, it } from "vitest";
import { compareByConsequence, computeConsequence, downstreamOf, type ConsequencePlan } from "./consequence.js";

// WI-002 → guide → WI-003 → notes → WI-004 → themes → WI-005; WI-006 also reads notes.
const plan: ConsequencePlan = {
  items: [
    { id: "WI-002", status: "at_gate", outputs: ["WI-002/guide"] },
    { id: "WI-003", status: "waiting", outputs: ["WI-003/notes"] },
    { id: "WI-004", status: "waiting", outputs: ["WI-004/themes"] },
    { id: "WI-005", status: "waiting", outputs: [] },
    { id: "WI-006", status: "cancelled", outputs: [] },
  ],
  slots: [
    { ref: "WI-002/guide", consumers: ["WI-003"] },
    { ref: "WI-003/notes", consumers: ["WI-004", "WI-006"] },
    { ref: "WI-004/themes", consumers: ["WI-005"] },
  ],
};

describe("downstreamOf", () => {
  it("follows producer → slot → consumers transitively, skipping finished items", () => {
    expect(downstreamOf(plan, "WI-002")).toEqual(["WI-003", "WI-004", "WI-005"]);
  });

  it("walks through a done item to reach the unfinished items behind it", () => {
    const p: ConsequencePlan = { ...plan, items: plan.items.map((i) => (i.id === "WI-003" ? { ...i, status: "done" as const } : i)) };
    expect(downstreamOf(p, "WI-002")).toEqual(["WI-004", "WI-005"]);
  });

  it("is empty for a leaf and for an unknown item, and terminates on a cycle", () => {
    expect(downstreamOf(plan, "WI-005")).toEqual([]);
    expect(downstreamOf(plan, "WI-099")).toEqual([]);
    const cyclic: ConsequencePlan = {
      items: [
        { id: "WI-001", status: "ready", outputs: ["WI-001/a"] },
        { id: "WI-002", status: "ready", outputs: ["WI-002/b"] },
      ],
      slots: [
        { ref: "WI-001/a", consumers: ["WI-002"] },
        { ref: "WI-002/b", consumers: ["WI-001"] },
      ],
    };
    expect(downstreamOf(cyclic, "WI-001")).toEqual(["WI-002"]);
  });
});

describe("computeConsequence", () => {
  it("scores kind weight plus 10 per blocked item", () => {
    expect(computeConsequence(plan, "review", "WI-002")).toEqual({ score: 65, blocks: ["WI-003", "WI-004", "WI-005"], reason: "Blocks 3 items" });
    expect(computeConsequence(plan, "question", "WI-004")).toEqual({ score: 50, blocks: ["WI-005"], reason: "Blocks 1 item" });
    expect(computeConsequence(plan, "run_issue", "WI-005")).toEqual({ score: 50, blocks: [], reason: "Blocks nothing yet" });
    expect(computeConsequence(plan, "human_item", "WI-005").score).toBe(25);
  });

  it("gives proposals and FYIs no blocked items and a fixed reason", () => {
    expect(computeConsequence(plan, "proposal", null)).toEqual({ score: 30, blocks: [], reason: "Plan change" });
    expect(computeConsequence(plan, "fyi", "WI-002")).toEqual({ score: 0, blocks: [], reason: "For your information" });
  });
});

describe("compareByConsequence", () => {
  it("sorts by score desc, then oldest first, then untimed last", () => {
    const entries = [
      { id: "a", score: 30, at: "2026-09-25T10:00:00.000Z" },
      { id: "b", score: 50, at: null },
      { id: "c", score: 30, at: null },
      { id: "d", score: 30, at: "2026-09-25T09:00:00.000Z" },
      { id: "e", score: 50, at: "2026-09-25T11:00:00.000Z" },
    ];
    expect([...entries].sort(compareByConsequence).map((e) => e.id)).toEqual(["e", "b", "d", "a", "c"]);
  });
});
