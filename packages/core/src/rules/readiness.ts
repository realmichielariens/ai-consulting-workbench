// Readiness (ARCHITECTURE.md §7.2, DESIGN.md §4.2). Pure: the caller supplies
// a plain snapshot of the plan (item defs plus which slots have at least one
// published version); this module never touches the DB or the filesystem.
//
// An item becomes ready when: it is waiting, it has an executor, every
// required input slot is published, and every sequencing item is done.
// I1 has no wildcard slots (SLOT_REF_RE has no "*"; they arrive in I4), so
// "every expected child slot is published" for a wildcard input does not
// apply yet.

import { parseSlotRef, type Executor, type ItemId, type ItemStatus, type ReadinessBlocker, type SlotRef } from "../domain.js";
import type { ItemDef } from "../domain.js";

export interface ReadinessItem {
  id: ItemId;
  /** null = composite or ENG; readiness is computed only for items with an executor. */
  executor: Executor | null;
  status: ItemStatus | null;
  inputs: readonly { slot: SlotRef; required: boolean }[];
  sequencing: readonly ItemId[];
  /** Does this item have a non-empty gate chain? Read by *consumers* of its outputs (I2 decision D1). */
  hasGate?: boolean;
}

export interface ReadinessPlan {
  items: readonly ReadinessItem[];
  /** Slots with at least one published version. */
  publishedSlots: ReadonlySet<SlotRef>;
}

export interface Readiness {
  ready: boolean;
  blockers: ReadinessBlocker[];
}

/**
 * Readiness for every leaf item (executor != null) in the plan, keyed by item
 * id. Composites and ENG produce no readiness of their own, but callers
 * should still include them in `plan.items` (with status/hasGate) so their
 * outputs' consumers can look them up as producers (D1, below). Computed
 * regardless of the item's *current* status — the caller diffs this against
 * the DB to decide whether to fire `inputs_ready` / `inputs_missing`
 * (lifecycle.ts), and the UI shows `blockers` only while the item is
 * "waiting" (ItemNode.notReadyBecause, api.ts).
 */
export function computeReadiness(plan: ReadinessPlan): Map<ItemId, Readiness> {
  const infoById = new Map(plan.items.map((it) => [it.id, it]));
  const result = new Map<ItemId, Readiness>();

  for (const item of plan.items) {
    // Composites/ENG: no readiness of their own (DESIGN.md §4.2, they show a
    // rollup instead). ReadinessBlocker's "no_executor" case is therefore
    // never produced here; it exists in the domain contract for a definition
    // that reaches this stage malformed (a leaf item.md with no executor).
    if (item.executor == null) continue;

    const blockers: ReadinessBlocker[] = [];

    for (const input of item.inputs) {
      if (!input.required) continue;
      if (!plan.publishedSlots.has(input.slot)) {
        blockers.push({ kind: "missing_input", slot: input.slot, producer: parseSlotRef(input.slot).itemId });
        continue;
      }
      // I2 decision D1: a published input from a leaf producer with a gate
      // counts only once that producer is done — being at_gate is not
      // enough. ENG and composite producers (no gate of their own) are
      // unaffected: published is enough for them, as in I1.
      const producerId = parseSlotRef(input.slot).itemId;
      const producer = infoById.get(producerId);
      if (producer && producer.executor != null && producer.hasGate && producer.status !== "done") {
        blockers.push({ kind: "input_not_approved", slot: input.slot, producer: producerId, status: producer.status });
      }
    }

    for (const after of item.sequencing) {
      const status = infoById.get(after)?.status ?? null;
      if (status !== "done") {
        blockers.push({ kind: "sequencing", item: after, status });
      }
    }

    result.set(item.id, { ready: blockers.length === 0, blockers });
  }

  return result;
}

/** Leaf items start "waiting" (no draft/brief-approval step in I1); composites and ENG have no status. */
export function initialStatus(def: Pick<ItemDef, "id" | "executor">): ItemStatus | null {
  return def.executor == null ? null : "waiting";
}
