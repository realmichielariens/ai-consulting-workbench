import { describe, expect, it } from "vitest";
import type { ItemDef, ItemId, ItemStatus, PlanOp, SlotRef } from "../domain.js";
import { applyOps, describeOp, validateOps, type PlanOpsSnapshot } from "./planOps.js";

function def(partial: Partial<ItemDef> & Pick<ItemDef, "id" | "title" | "parent" | "executor">): ItemDef {
  return {
    order: 0,
    inputs: [],
    sequencing: [],
    outputs: [],
    skills: [],
    sources: [],
    gate: [],
    autostart: true,
    acceptance: [],
    brief: "brief",
    ...partial,
  };
}

const ENG = def({ id: "ENG", title: "Engagement", parent: null, executor: null });
const PH1 = def({ id: "PH-1", title: "Discovery", parent: null, executor: null });
const WI002 = def({
  id: "WI-002",
  title: "Prepare interview guide",
  parent: "PH-1",
  executor: "agent",
  outputs: [{ slot: "interview-guide", format: "md", scope: "project", description: "", required: true }],
  gate: [{ type: "human-review" }],
});
const WI003 = def({
  id: "WI-003",
  title: "Conduct interviews",
  parent: "PH-1",
  executor: "human",
  outputs: [{ slot: "notes-cfo", format: "md", scope: "project", description: "", required: true }],
});

function snapshot(defs: ItemDef[], statuses: Record<string, ItemStatus | null>, versions: SlotRef[] = []): PlanOpsSnapshot {
  return {
    defs,
    statusById: new Map(Object.entries(statuses)) as ReadonlyMap<ItemId, ItemStatus | null>,
    slotsWithVersions: new Set(versions),
  };
}

describe("validateOps: add_item", () => {
  it("accepts a leaf under a composite parent", () => {
    const errors = validateOps(snapshot([ENG, PH1], { PH1: null }), [
      { op: "add_item", def: def({ id: "WI-004", title: "New", parent: "PH-1", executor: "agent" }) },
    ]);
    expect(errors).toEqual([]);
  });

  it("rejects a duplicate id", () => {
    const errors = validateOps(snapshot([ENG, PH1, WI002], { "WI-002": "waiting" }), [
      { op: "add_item", def: def({ id: "WI-002", title: "Dup", parent: "PH-1", executor: "agent" }) },
    ]);
    expect(errors).toEqual(["op 1 (add_item WI-002): item id WI-002 is already in use"]);
  });

  it("rejects a parent that does not exist", () => {
    const errors = validateOps(snapshot([ENG], {}), [
      { op: "add_item", def: def({ id: "WI-004", title: "New", parent: "PH-9", executor: "agent" }) },
    ]);
    expect(errors).toEqual(["op 1 (add_item WI-004): parent PH-9 does not exist"]);
  });

  it("rejects a leaf as a parent", () => {
    const errors = validateOps(snapshot([ENG, WI002], { "WI-002": "waiting" }), [
      { op: "add_item", def: def({ id: "WI-004", title: "New", parent: "WI-002", executor: "agent" }) },
    ]);
    expect(errors).toEqual(["op 1 (add_item WI-004): parent WI-002 is not a composite or ENG"]);
  });

  it("a later op can reference an item added earlier in the same proposal", () => {
    const ops: PlanOp[] = [
      { op: "add_item", def: def({ id: "PH-2", title: "Synthesis", parent: null, executor: null }) },
      { op: "add_item", def: def({ id: "WI-005", title: "New", parent: "PH-2", executor: "agent" }) },
    ];
    expect(validateOps(snapshot([ENG], {}), ops)).toEqual([]);
  });
});

describe("validateOps: update_brief", () => {
  it("allows a waiting leaf", () => {
    expect(validateOps(snapshot([WI002], { "WI-002": "waiting" }), [{ op: "update_brief", itemId: "WI-002", brief: "new" }])).toEqual([]);
  });

  it("rejects a leaf that is in_progress", () => {
    const errors = validateOps(snapshot([WI002], { "WI-002": "in_progress" }), [{ op: "update_brief", itemId: "WI-002", brief: "new" }]);
    expect(errors).toEqual(["op 1 (update_brief WI-002): WI-002 is in_progress, not waiting or ready"]);
  });

  it("always allows a composite", () => {
    expect(validateOps(snapshot([PH1], {}), [{ op: "update_brief", itemId: "PH-1", brief: "new" }])).toEqual([]);
  });
});

describe("validateOps: rewire", () => {
  it("accepts an existing plan slot", () => {
    const errors = validateOps(snapshot([WI002, WI003], { "WI-002": "waiting", "WI-003": "waiting" }), [
      { op: "rewire", itemId: "WI-002", inputs: [{ slot: "WI-003/notes-cfo", required: true }] },
    ]);
    expect(errors).toEqual([]);
  });

  it("rejects a slot that does not exist", () => {
    const errors = validateOps(snapshot([WI002], { "WI-002": "waiting" }), [
      { op: "rewire", itemId: "WI-002", inputs: [{ slot: "WI-003/notes-cxo", required: true }] },
    ]);
    expect(errors).toEqual(["op 1 (rewire WI-002): input slot WI-003/notes-cxo does not exist"]);
  });

  it("accepts a slot added earlier in the same proposal", () => {
    const ops: PlanOp[] = [
      { op: "add_slot", itemId: "WI-003", output: { slot: "notes-cio", format: "md", scope: "project", description: "", required: true } },
      { op: "rewire", itemId: "WI-002", inputs: [{ slot: "WI-003/notes-cio", required: true }] },
    ];
    expect(validateOps(snapshot([WI002, WI003], { "WI-002": "waiting", "WI-003": "waiting" }), ops)).toEqual([]);
  });

  it("rejects rewiring an item that is in_progress", () => {
    const errors = validateOps(snapshot([WI002], { "WI-002": "in_progress" }), [{ op: "rewire", itemId: "WI-002", inputs: [] }]);
    expect(errors[0]).toContain("not waiting or ready");
  });
});

describe("validateOps: add_slot / remove_slot", () => {
  it("rejects a duplicate slot name", () => {
    const errors = validateOps(snapshot([WI002], { "WI-002": "waiting" }), [
      { op: "add_slot", itemId: "WI-002", output: { slot: "interview-guide", format: "md", scope: "project", description: "", required: true } },
    ]);
    expect(errors).toEqual(["op 1 (add_slot WI-002/interview-guide): output slot interview-guide already exists on WI-002"]);
  });

  it("rejects removing a slot with published versions", () => {
    const errors = validateOps(snapshot([WI002], { "WI-002": "waiting" }, ["WI-002/interview-guide"]), [
      { op: "remove_slot", itemId: "WI-002", slot: "interview-guide" },
    ]);
    expect(errors).toEqual(["op 1 (remove_slot WI-002/interview-guide): slot WI-002/interview-guide has published versions"]);
  });

  it("rejects removing a slot with a consumer", () => {
    const consumer = def({
      id: "WI-004",
      title: "Consumer",
      parent: null,
      executor: "agent",
      inputs: [{ slot: "WI-002/interview-guide", required: true }],
    });
    const errors = validateOps(snapshot([WI002, consumer], { "WI-002": "waiting", "WI-004": "waiting" }), [
      { op: "remove_slot", itemId: "WI-002", slot: "interview-guide" },
    ]);
    expect(errors).toEqual(["op 1 (remove_slot WI-002/interview-guide): slot WI-002/interview-guide is still consumed by WI-004"]);
  });

  it("allows removing an unpublished, unconsumed slot", () => {
    expect(validateOps(snapshot([WI002], { "WI-002": "waiting" }), [{ op: "remove_slot", itemId: "WI-002", slot: "interview-guide" }])).toEqual([]);
  });
});

describe("validateOps: set_gate", () => {
  it("accepts empty and single human-review", () => {
    expect(validateOps(snapshot([WI002], { "WI-002": "waiting" }), [{ op: "set_gate", itemId: "WI-002", gate: [] }])).toEqual([]);
    expect(
      validateOps(snapshot([WI002], { "WI-002": "waiting" }), [{ op: "set_gate", itemId: "WI-002", gate: [{ type: "human-review" }] }]),
    ).toEqual([]);
  });

  it("rejects any other gate shape", () => {
    const errors = validateOps(snapshot([WI002], { "WI-002": "waiting" }), [{ op: "set_gate", itemId: "WI-002", gate: [{ type: "ai-review" }] }]);
    expect(errors).toEqual(["op 1 (set_gate WI-002): gate must be [] or a single human-review step"]);
  });
});

describe("validateOps: cancel_item", () => {
  it("accepts a waiting leaf with no consumers", () => {
    expect(validateOps(snapshot([WI003], { "WI-003": "waiting" }), [{ op: "cancel_item", itemId: "WI-003", reason: "no longer needed" }])).toEqual(
      [],
    );
  });

  it("rejects cancelling an item still consumed by a non-cancelled item", () => {
    const consumer = def({
      id: "WI-004",
      title: "Consumer",
      parent: null,
      executor: "agent",
      inputs: [{ slot: "WI-003/notes-cfo", required: true }],
    });
    const errors = validateOps(snapshot([WI003, consumer], { "WI-003": "waiting", "WI-004": "waiting" }), [
      { op: "cancel_item", itemId: "WI-003", reason: "x" },
    ]);
    expect(errors).toEqual(["op 1 (cancel_item WI-003): WI-004 still consumes WI-003/notes-cfo"]);
  });

  it("rejects cancelling an item that is in_progress", () => {
    const errors = validateOps(snapshot([WI003], { "WI-003": "in_progress" }), [{ op: "cancel_item", itemId: "WI-003", reason: "x" }]);
    expect(errors[0]).toContain("not waiting or ready");
  });
});

describe("validateOps: cycles", () => {
  it("rejects a rewire pair that makes two items consume each other's output", () => {
    const a = def({
      id: "WI-010",
      title: "A",
      parent: null,
      executor: "agent",
      outputs: [{ slot: "out-a", format: "md", scope: "project", description: "", required: true }],
    });
    const b = def({
      id: "WI-011",
      title: "B",
      parent: null,
      executor: "agent",
      outputs: [{ slot: "out-b", format: "md", scope: "project", description: "", required: true }],
      inputs: [{ slot: "WI-010/out-a", required: true }],
    });
    const ops: PlanOp[] = [{ op: "rewire", itemId: "WI-010", inputs: [{ slot: "WI-011/out-b", required: true }] }];
    const errors = validateOps(snapshot([a, b], { "WI-010": "waiting", "WI-011": "waiting" }), ops);
    expect(errors).toEqual(["the resulting plan has a cycle in its input/sequencing graph"]);
  });
});

describe("applyOps", () => {
  it("adds, changes and cancels, reporting each id once", () => {
    const ops: PlanOp[] = [
      { op: "add_item", def: def({ id: "WI-005", title: "New", parent: "PH-1", executor: "agent" }) },
      { op: "update_brief", itemId: "WI-002", brief: "updated brief" },
      { op: "set_gate", itemId: "WI-002", gate: [] },
      { op: "cancel_item", itemId: "WI-003", reason: "no longer needed" },
    ];
    const result = applyOps([ENG, PH1, WI002, WI003], ops);
    expect(result.added).toEqual(["WI-005"]);
    expect(result.changed).toEqual(["WI-002"]);
    expect(result.cancelled).toEqual(["WI-003"]);
    const wi002 = result.defs.find((d) => d.id === "WI-002")!;
    expect(wi002.brief).toBe("updated brief");
    expect(wi002.gate).toEqual([]);
    expect(result.defs.find((d) => d.id === "WI-005")).toBeDefined();
  });

  it("a newly added item does not also appear in changed when later updated", () => {
    const ops: PlanOp[] = [
      { op: "add_item", def: def({ id: "WI-005", title: "New", parent: "PH-1", executor: "agent" }) },
      { op: "update_brief", itemId: "WI-005", brief: "second pass" },
    ];
    const result = applyOps([ENG, PH1], ops);
    expect(result.added).toEqual(["WI-005"]);
    expect(result.changed).toEqual([]);
  });
});

describe("validateOps: sources", () => {
  const known = (defs: ItemDef[], statuses: Record<string, ItemStatus | null>) => ({
    ...snapshot(defs, statuses),
    knownSourceIds: new Set(["open-web", "mfg-it-benchmarks"]),
  });
  const web = { id: "open-web", purpose: "find public case studies" };

  it("set_sources replaces a waiting agent item's sources", () => {
    const op: PlanOp = { op: "set_sources", itemId: "WI-002", sources: [web] };
    expect(validateOps(known([ENG, PH1, WI002], { "WI-002": "waiting" }), [op])).toEqual([]);
    const result = applyOps([ENG, PH1, WI002], [op]);
    expect(result.defs.find((d) => d.id === "WI-002")!.sources).toEqual([web]);
    expect(result.changed).toEqual(["WI-002"]);
  });

  it("set_sources rejects an unknown source, a duplicate, a human item and a running item", () => {
    const unknown = validateOps(known([ENG, PH1, WI002], { "WI-002": "ready" }), [
      { op: "set_sources", itemId: "WI-002", sources: [{ id: "dark-web", purpose: "x" }, web, web] },
    ]);
    expect(unknown).toEqual([
      expect.stringContaining("source dark-web is not in the Source Catalog"),
      "op 1 (set_sources WI-002): source open-web is attached twice",
    ]);
    expect(validateOps(known([ENG, PH1, WI003], { "WI-003": "ready" }), [{ op: "set_sources", itemId: "WI-003", sources: [web] }])).toEqual([
      "op 1 (set_sources WI-003): WI-003 is not an agent item; sources are for Work Agents",
    ]);
    expect(validateOps(known([ENG, PH1, WI002], { "WI-002": "in_progress" }), [{ op: "set_sources", itemId: "WI-002", sources: [] }])).toEqual([
      "op 1 (set_sources WI-002): WI-002 is in_progress, not waiting or ready",
    ]);
  });

  it("add_item checks its sources against the catalog", () => {
    const errors = validateOps(known([ENG, PH1], { "PH-1": null }), [
      { op: "add_item", def: def({ id: "WI-009", title: "Scan", parent: "PH-1", executor: "agent", sources: [{ id: "nope", purpose: "x" }] }) },
    ]);
    expect(errors).toEqual([expect.stringContaining("source nope is not in the Source Catalog")]);
  });

  it("without a catalog in the snapshot, source ids are not checked", () => {
    const op: PlanOp = { op: "set_sources", itemId: "WI-002", sources: [{ id: "anything", purpose: "x" }] };
    expect(validateOps(snapshot([ENG, PH1, WI002], { "WI-002": "waiting" }), [op])).toEqual([]);
  });
});

describe("describeOp", () => {
  it("describes add_item readably", () => {
    const op: PlanOp = {
      op: "add_item",
      def: def({
        id: "WI-004",
        title: "Consolidate themes",
        parent: "PH-2",
        executor: "agent",
        inputs: [{ slot: "WI-003/notes-cxo", required: true }],
        outputs: [{ slot: "themes", format: "md", scope: "project", description: "", required: true }],
        gate: [{ type: "human-review" }],
      }),
    };
    const line = describeOp(op, [ENG]);
    expect(line).toBe(
      "Add WI-004 Consolidate themes under PH-2 (agent), inputs: WI-003/notes-cxo; output: themes (md); gate: human review",
    );
  });

  it("lists an add_item's skills when it has any", () => {
    const op: PlanOp = {
      op: "add_item",
      def: def({ id: "WI-005", title: "Benchmark scan", parent: "PH-2", executor: "agent", skills: ["desk-research"] }),
    };
    expect(describeOp(op, [ENG])).toMatch(/; skills: desk-research$/);
  });

  it("describes set_sources with ids and purposes", () => {
    const op: PlanOp = { op: "set_sources", itemId: "WI-002", sources: [{ id: "open-web", purpose: "peer cases" }] };
    expect(describeOp(op, [WI002])).toBe("Set sources for WI-002 (Prepare interview guide): open-web (peer cases)");
  });

  it("describes cancel_item with the item's title and reason", () => {
    const op: PlanOp = { op: "cancel_item", itemId: "WI-003", reason: "superseded by WI-010" };
    expect(describeOp(op, [WI003])).toBe("Cancel WI-003 Conduct interviews: superseded by WI-010");
  });
});
