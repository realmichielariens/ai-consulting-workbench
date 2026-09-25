// Plan operations (I2, I2-PLAN §4.3, domain.ts PlanOp). Pure: the caller
// supplies a snapshot of the plan (defs, current status per item, and which
// output slots have at least one published version); this module never
// touches the DB or the filesystem.
//
// Ops within one proposal apply in order: `validateOps` simulates them
// sequentially against a working copy, so op 3 can reference a slot that
// op 1 just added. A failed op's effect is not applied to the working copy,
// so later ops are validated against the plan as it stood before the failure
// (compounding errors are expected and fine — the human never sees an
// invalid proposal; the agent gets every error back at once to fix).

import {
  parseSlotRef,
  slotRef as makeSlotRef,
  type Executor,
  type GateStep,
  type InputRef,
  type ItemDef,
  type ItemId,
  type ItemStatus,
  type OutputSlot,
  type PlanOp,
  type SlotRef,
} from "../domain.js";

export interface PlanOpsSnapshot {
  defs: readonly ItemDef[];
  /** Current status per item; null for composites and ENG. */
  statusById: ReadonlyMap<ItemId, ItemStatus | null>;
  /** Output slots with at least one published version. */
  slotsWithVersions: ReadonlySet<SlotRef>;
}

interface WorkingItem {
  def: ItemDef;
  status: ItemStatus | null;
}

type WorkingMap = Map<ItemId, WorkingItem>;

function cloneMap(snapshot: PlanOpsSnapshot): WorkingMap {
  const map: WorkingMap = new Map();
  for (const def of snapshot.defs) map.set(def.id, { def, status: snapshot.statusById.get(def.id) ?? null });
  return map;
}

const isComposite = (item: WorkingItem | undefined): boolean => item != null && item.def.executor == null;

function outputSlotRefsOf(item: WorkingItem): SlotRef[] {
  return item.def.outputs.map((o) => makeSlotRef(item.def.id, o.slot));
}

function consumersOf(map: WorkingMap, slot: SlotRef): ItemId[] {
  const result: ItemId[] = [];
  for (const item of map.values()) if (item.def.inputs.some((i) => i.slot === slot)) result.push(item.def.id);
  return result;
}

/** Producer -> consumer (from every declared input) plus sequencing (after -> item) edges; true if that graph has a cycle. */
function hasCycle(map: WorkingMap): boolean {
  const graph = new Map<ItemId, ItemId[]>();
  const addEdge = (from: ItemId, to: ItemId) => graph.set(from, [...(graph.get(from) ?? []), to]);
  for (const item of map.values()) {
    for (const input of item.def.inputs) addEdge(parseSlotRef(input.slot).itemId, item.def.id);
    for (const after of item.def.sequencing) addEdge(after, item.def.id);
  }
  const WHITE = 0,
    GRAY = 1,
    BLACK = 2;
  const color = new Map<ItemId, number>();
  const visit = (id: ItemId): boolean => {
    color.set(id, GRAY);
    for (const next of graph.get(id) ?? []) {
      const c = color.get(next) ?? WHITE;
      if (c === GRAY) return true;
      if (c === WHITE && visit(next)) return true;
    }
    color.set(id, BLACK);
    return false;
  };
  for (const id of map.keys()) if ((color.get(id) ?? WHITE) === WHITE && visit(id)) return true;
  return false;
}

function opLabel(op: PlanOp): string {
  switch (op.op) {
    case "add_item":
      return `add_item ${op.def.id}`;
    case "update_brief":
      return `update_brief ${op.itemId}`;
    case "rewire":
      return `rewire ${op.itemId}`;
    case "add_slot":
      return `add_slot ${op.itemId}/${op.output.slot}`;
    case "remove_slot":
      return `remove_slot ${op.itemId}/${op.slot}`;
    case "set_gate":
      return `set_gate ${op.itemId}`;
    case "cancel_item":
      return `cancel_item ${op.itemId}`;
  }
}

const waitingOrReady = (status: ItemStatus | null): boolean => status === "waiting" || status === "ready";

/** Validates and (if valid) applies one op against `map` in place. Returns error messages, without the "op N (...)" prefix. */
function checkAndApply(map: WorkingMap, op: PlanOp, snapshot: PlanOpsSnapshot): string[] {
  switch (op.op) {
    case "add_item": {
      const errors: string[] = [];
      if (map.has(op.def.id)) errors.push(`item id ${op.def.id} is already in use`);
      if (op.def.parent != null) {
        const parentItem = map.get(op.def.parent);
        if (!parentItem) errors.push(`parent ${op.def.parent} does not exist`);
        else if (!isComposite(parentItem)) errors.push(`parent ${op.def.parent} is not a composite or ENG`);
      }
      if (errors.length > 0) return errors;
      map.set(op.def.id, { def: op.def, status: op.def.executor == null ? null : "waiting" });
      return [];
    }

    case "update_brief": {
      const item = map.get(op.itemId);
      if (!item) return [`item ${op.itemId} does not exist`];
      if (!isComposite(item) && !waitingOrReady(item.status)) {
        return [`${op.itemId} is ${item.status ?? "unknown"}, not waiting or ready`];
      }
      const def = { ...item.def };
      if (op.title !== undefined) def.title = op.title;
      if (op.brief !== undefined) def.brief = op.brief;
      if (op.acceptance !== undefined) def.acceptance = op.acceptance;
      map.set(op.itemId, { ...item, def });
      return [];
    }

    case "rewire": {
      const item = map.get(op.itemId);
      if (!item) return [`item ${op.itemId} does not exist`];
      if (isComposite(item)) return [`${op.itemId} is a composite; rewire applies to leaf items only`];
      if (!waitingOrReady(item.status)) return [`${op.itemId} is ${item.status ?? "unknown"}, not waiting or ready`];
      const errors: string[] = [];
      for (const input of op.inputs) {
        const producer = map.get(parseSlotRef(input.slot).itemId);
        const exists = producer?.def.outputs.some((o) => makeSlotRef(producer.def.id, o.slot) === input.slot) ?? false;
        if (!exists) errors.push(`input slot ${input.slot} does not exist`);
      }
      if (errors.length > 0) return errors;
      map.set(op.itemId, { ...item, def: { ...item.def, inputs: op.inputs } });
      return [];
    }

    case "add_slot": {
      const item = map.get(op.itemId);
      if (!item) return [`item ${op.itemId} does not exist`];
      if (item.def.outputs.some((o) => o.slot === op.output.slot)) {
        return [`output slot ${op.output.slot} already exists on ${op.itemId}`];
      }
      map.set(op.itemId, { ...item, def: { ...item.def, outputs: [...item.def.outputs, op.output] } });
      return [];
    }

    case "remove_slot": {
      const item = map.get(op.itemId);
      if (!item) return [`item ${op.itemId} does not exist`];
      const out = item.def.outputs.find((o) => o.slot === op.slot);
      if (!out) return [`output slot ${op.slot} does not exist on ${op.itemId}`];
      const ref = makeSlotRef(op.itemId, op.slot);
      const errors: string[] = [];
      if (snapshot.slotsWithVersions.has(ref)) errors.push(`slot ${ref} has published versions`);
      const consumers = consumersOf(map, ref);
      if (consumers.length > 0) errors.push(`slot ${ref} is still consumed by ${consumers.join(", ")}`);
      if (errors.length > 0) return errors;
      map.set(op.itemId, { ...item, def: { ...item.def, outputs: item.def.outputs.filter((o) => o.slot !== op.slot) } });
      return [];
    }

    case "set_gate": {
      const item = map.get(op.itemId);
      if (!item) return [`item ${op.itemId} does not exist`];
      const valid = op.gate.length === 0 || (op.gate.length === 1 && op.gate[0]!.type === "human-review");
      if (!valid) return [`gate must be [] or a single human-review step`];
      map.set(op.itemId, { ...item, def: { ...item.def, gate: op.gate } });
      return [];
    }

    case "cancel_item": {
      const item = map.get(op.itemId);
      if (!item) return [`item ${op.itemId} does not exist`];
      if (isComposite(item)) return [`${op.itemId} is a composite; cancel_item applies to leaf items only`];
      if (!waitingOrReady(item.status)) return [`${op.itemId} is ${item.status ?? "unknown"}, not waiting or ready`];
      const errors: string[] = [];
      for (const ref of outputSlotRefsOf(item)) {
        for (const consumerId of consumersOf(map, ref)) {
          const consumer = map.get(consumerId);
          if (consumer && consumer.status !== "cancelled") errors.push(`${consumerId} still consumes ${ref}`);
        }
      }
      if (errors.length > 0) return errors;
      map.set(op.itemId, { ...item, status: "cancelled" });
      return [];
    }
  }
}

/** One error line per problem, e.g. "op 2 (rewire WI-004): input slot WI-003/notes-cxo does not exist". Empty = the proposal validates. */
export function validateOps(snapshot: PlanOpsSnapshot, ops: readonly PlanOp[]): string[] {
  const map = cloneMap(snapshot);
  const errors: string[] = [];
  ops.forEach((op, idx) => {
    for (const e of checkAndApply(map, op, snapshot)) errors.push(`op ${idx + 1} (${opLabel(op)}): ${e}`);
  });
  if (errors.length === 0 && hasCycle(map)) {
    errors.push("the resulting plan has a cycle in its input/sequencing graph");
  }
  return errors;
}

export interface ApplyOpsResult {
  defs: ItemDef[];
  added: ItemId[];
  changed: ItemId[];
  cancelled: ItemId[];
}

/** Applies already-validated ops to `defs`. Callers only ever apply an ops list that `validateOps` accepted. */
export function applyOps(defs: readonly ItemDef[], ops: readonly PlanOp[]): ApplyOpsResult {
  const map: WorkingMap = new Map(defs.map((d) => [d.id, { def: d, status: null }]));
  const added: ItemId[] = [];
  const changed = new Set<ItemId>();
  const cancelled: ItemId[] = [];
  const markChanged = (id: ItemId) => {
    if (!added.includes(id)) changed.add(id);
  };

  for (const op of ops) {
    switch (op.op) {
      case "add_item":
        map.set(op.def.id, { def: op.def, status: null });
        added.push(op.def.id);
        break;
      case "update_brief": {
        const item = map.get(op.itemId)!;
        const def = { ...item.def };
        if (op.title !== undefined) def.title = op.title;
        if (op.brief !== undefined) def.brief = op.brief;
        if (op.acceptance !== undefined) def.acceptance = op.acceptance;
        map.set(op.itemId, { ...item, def });
        markChanged(op.itemId);
        break;
      }
      case "rewire": {
        const item = map.get(op.itemId)!;
        map.set(op.itemId, { ...item, def: { ...item.def, inputs: op.inputs } });
        markChanged(op.itemId);
        break;
      }
      case "add_slot": {
        const item = map.get(op.itemId)!;
        map.set(op.itemId, { ...item, def: { ...item.def, outputs: [...item.def.outputs, op.output] } });
        markChanged(op.itemId);
        break;
      }
      case "remove_slot": {
        const item = map.get(op.itemId)!;
        map.set(op.itemId, { ...item, def: { ...item.def, outputs: item.def.outputs.filter((o) => o.slot !== op.slot) } });
        markChanged(op.itemId);
        break;
      }
      case "set_gate": {
        const item = map.get(op.itemId)!;
        map.set(op.itemId, { ...item, def: { ...item.def, gate: op.gate } });
        markChanged(op.itemId);
        break;
      }
      case "cancel_item":
        cancelled.push(op.itemId);
        break;
    }
  }

  return { defs: [...map.values()].map((w) => w.def), added, changed: [...changed], cancelled };
}

function executorLabel(executor: Executor | null): string {
  return executor ?? "composite";
}

function gateLabel(gate: readonly GateStep[]): string {
  return gate.length === 0 ? "none" : gate.map((g) => g.type.replace("-", " ")).join(", ");
}

function outputsLabel(outputs: readonly OutputSlot[]): string {
  return outputs.length === 0 ? "none" : outputs.map((o) => `${o.slot} (${o.format})`).join(", ");
}

function inputsLabel(inputs: readonly InputRef[]): string {
  return inputs.length === 0 ? "none" : inputs.map((i) => i.slot).join(", ");
}

/** One readable line per op, e.g. "Add WI-004 Consolidate themes under PH-2 (agent), inputs: …; output: themes (md); gate: human review". */
export function describeOp(op: PlanOp, defs: readonly ItemDef[]): string {
  const byId = new Map(defs.map((d) => [d.id, d]));
  switch (op.op) {
    case "add_item":
      return (
        `Add ${op.def.id} ${op.def.title} under ${op.def.parent ?? "top level"} (${executorLabel(op.def.executor)}), ` +
        `inputs: ${inputsLabel(op.def.inputs)}; output: ${outputsLabel(op.def.outputs)}; gate: ${gateLabel(op.def.gate)}`
      );
    case "update_brief": {
      const fields = [
        op.title !== undefined ? "title" : null,
        op.brief !== undefined ? "brief" : null,
        op.acceptance !== undefined ? "acceptance" : null,
      ].filter((f): f is string => f != null);
      return `Update ${op.itemId} (${byId.get(op.itemId)?.title ?? op.itemId}): ${fields.join(", ")}`;
    }
    case "rewire":
      return `Rewire ${op.itemId} inputs: ${inputsLabel(op.inputs)}`;
    case "add_slot":
      return `Add output slot ${op.itemId}/${op.output.slot} (${op.output.format})`;
    case "remove_slot":
      return `Remove output slot ${op.itemId}/${op.slot}`;
    case "set_gate":
      return `Set gate for ${op.itemId}: ${gateLabel(op.gate)}`;
    case "cancel_item":
      return `Cancel ${op.itemId} ${byId.get(op.itemId)?.title ?? op.itemId}: ${op.reason}`;
  }
}
