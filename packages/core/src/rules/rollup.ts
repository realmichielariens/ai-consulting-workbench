// Composite roll-up (DESIGN.md §4.2, ARCHITECTURE.md §6.1 Rollup). A
// composite shows the count per status and the "worst" status over its leaf
// descendants (not just direct children), using STATUS_SEVERITY (domain.ts)
// to decide "worst". An empty composite (no leaves yet) has `worst: null`.

import { STATUS_SEVERITY, type Executor, type ItemId, type ItemStatus, type Rollup } from "../domain.js";

export interface RollupTreeItem {
  id: ItemId;
  parent: ItemId | null;
  /** null = composite (recurse into it); non-null = leaf (count its status). */
  executor: Executor | null;
  status: ItemStatus | null;
}

/** Depth-first collection of every leaf's status under `rootId`, at any depth. */
export function leafDescendantStatuses(items: readonly RollupTreeItem[], rootId: ItemId): ItemStatus[] {
  const childrenByParent = new Map<ItemId, RollupTreeItem[]>();
  for (const it of items) {
    if (it.parent == null) continue;
    const list = childrenByParent.get(it.parent) ?? [];
    list.push(it);
    childrenByParent.set(it.parent, list);
  }

  const statuses: ItemStatus[] = [];
  const walk = (id: ItemId) => {
    for (const child of childrenByParent.get(id) ?? []) {
      if (child.executor == null) walk(child.id);
      else if (child.status != null) statuses.push(child.status);
    }
  };
  walk(rootId);
  return statuses;
}

export function computeRollup(leafStatuses: readonly ItemStatus[]): Rollup {
  const byStatus: Partial<Record<ItemStatus, number>> = {};
  for (const s of leafStatuses) byStatus[s] = (byStatus[s] ?? 0) + 1;
  const worst = STATUS_SEVERITY.find((s) => (byStatus[s] ?? 0) > 0) ?? null;
  return { total: leafStatuses.length, done: byStatus.done ?? 0, byStatus, worst };
}

/** Convenience: roll up a composite directly from the item tree. */
export function rollupFor(items: readonly RollupTreeItem[], rootId: ItemId): Rollup {
  return computeRollup(leafDescendantStatuses(items, rootId));
}
