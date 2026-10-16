// Consequence of an open Inbox entry (UX1 C1): how much work waits on the
// human's decision. The Brief ranks "Needs you" by this score, and the
// server sorts the Inbox with it so every surface shows one order.

import type { ItemId, ItemStatus, SlotRef } from "../domain.js";

export interface ConsequencePlan {
  items: readonly { id: ItemId; status: ItemStatus | null; outputs: readonly SlotRef[] }[];
  slots: readonly { ref: SlotRef; consumers: readonly ItemId[] }[];
}

export type ConsequenceKind = "run_issue" | "question" | "review" | "proposal" | "human_item" | "fyi";

export interface ConsequenceResult {
  score: number;
  blocks: ItemId[];
  reason: string;
}

/** A run issue stops work outright; an FYI asks nothing of the human. */
export const CONSEQUENCE_KIND_WEIGHT: Readonly<Record<ConsequenceKind, number>> = {
  run_issue: 50,
  question: 40,
  review: 35,
  proposal: 30,
  human_item: 25,
  fyi: 0,
};

const FINISHED: ReadonlySet<ItemStatus> = new Set(["done", "cancelled"]);

/**
 * Items transitively downstream of `itemId` (producer → slot → consumers), in
 * breadth-first order. The walk passes through finished items, because their
 * consumers still depend on the chain, but only unfinished items are reported:
 * those are the ones actually waiting.
 */
export function downstreamOf(plan: ConsequencePlan, itemId: ItemId): ItemId[] {
  const byId = new Map(plan.items.map((i) => [i.id, i]));
  const consumersOf = new Map(plan.slots.map((s) => [s.ref, s.consumers]));
  const seen = new Set<ItemId>([itemId]);
  const result: ItemId[] = [];
  const queue: ItemId[] = [itemId];
  while (queue.length > 0) {
    const current = byId.get(queue.shift()!);
    if (!current) continue;
    for (const slot of current.outputs) {
      for (const consumer of consumersOf.get(slot) ?? []) {
        if (seen.has(consumer)) continue;
        seen.add(consumer);
        queue.push(consumer);
        const status = byId.get(consumer)?.status ?? null;
        if (status == null || !FINISHED.has(status)) result.push(consumer);
      }
    }
  }
  return result;
}

/** Score and kicker reason for one entry. `itemId` is null for proposals and item-less FYIs. */
export function computeConsequence(plan: ConsequencePlan, kind: ConsequenceKind, itemId: ItemId | null): ConsequenceResult {
  // A proposal changes the plan rather than holding up an item; an FYI holds up nothing.
  const blocks = kind === "proposal" || kind === "fyi" || itemId == null ? [] : downstreamOf(plan, itemId);
  return { score: CONSEQUENCE_KIND_WEIGHT[kind] + 10 * blocks.length, blocks, reason: reasonFor(kind, blocks.length) };
}

function reasonFor(kind: ConsequenceKind, blocked: number): string {
  if (kind === "proposal") return "Plan change";
  if (kind === "fyi") return "For your information";
  if (blocked === 0) return "Blocks nothing yet";
  return `Blocks ${blocked} ${blocked === 1 ? "item" : "items"}`;
}

/** Highest score first; equal scores oldest first; entries without a time go last among equals. Stable. */
export function compareByConsequence(a: { score: number; at: string | null }, b: { score: number; at: string | null }): number {
  if (a.score !== b.score) return b.score - a.score;
  if (a.at === b.at) return 0;
  if (a.at == null) return 1;
  if (b.at == null) return -1;
  return a.at < b.at ? -1 : 1;
}
