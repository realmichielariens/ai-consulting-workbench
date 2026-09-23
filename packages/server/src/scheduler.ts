// Readiness recompute + autostart (ARCHITECTURE.md §7.2, §7.6). Called after
// every publish and every item-status change. Kept separate from
// runService.ts / workPort.ts so both can call it without a circular import
// (workPort publishes assets; runService starts the runs this schedules).

import { applyItemEvent, computeReadiness, type ItemId, type ReadinessItem } from "@workbench/core";
import { assetVersionsRepo, itemsRepo } from "@workbench/db";
import { emitEvent, type EngagementContext } from "./engagementContext.js";

/** waiting <-> ready, from itemInputs/sequencing vs. published slots (readiness.ts). Pure DB read + writes. */
export function recomputeReadiness(ctx: EngagementContext): void {
  const rows = itemsRepo.listItems(ctx.dbCtx);
  const allInputs = itemsRepo.listAllInputs(ctx.dbCtx);
  const allSeq = itemsRepo.listAllSequencing(ctx.dbCtx);
  const publishedSlots = assetVersionsRepo.publishedSlots(ctx.dbCtx);

  const inputsByItem = new Map<string, { slot: string; required: boolean }[]>();
  for (const row of allInputs) {
    const list = inputsByItem.get(row.itemId) ?? [];
    list.push({ slot: row.slot, required: row.required });
    inputsByItem.set(row.itemId, list);
  }
  const seqByItem = new Map<string, ItemId[]>();
  for (const row of allSeq) {
    const list = seqByItem.get(row.itemId) ?? [];
    list.push(row.afterItemId);
    seqByItem.set(row.itemId, list);
  }

  const readinessItems: ReadinessItem[] = rows
    .filter((r) => r.executor != null)
    .map((r) => ({ id: r.id, executor: r.executor, status: r.status, inputs: inputsByItem.get(r.id) ?? [], sequencing: seqByItem.get(r.id) ?? [] }));
  const readiness = computeReadiness({ items: readinessItems, publishedSlots });

  const now = Date.now();
  for (const row of rows) {
    if (row.executor == null) continue;
    const r = readiness.get(row.id);
    if (!r) continue;
    if (row.status === "waiting" && r.ready) {
      const t = applyItemEvent("waiting", { type: "inputs_ready" }, { executor: row.executor });
      if (t.ok) {
        itemsRepo.setStatus(ctx.dbCtx, row.id, t.to, now);
        emitEvent(ctx, { type: "ItemStatusChanged", actor: "system", payload: { itemId: row.id, from: "waiting", to: t.to } });
      }
    } else if (row.status === "ready" && !r.ready) {
      const t = applyItemEvent("ready", { type: "inputs_missing" }, { executor: row.executor });
      if (t.ok) {
        itemsRepo.setStatus(ctx.dbCtx, row.id, t.to, now);
        emitEvent(ctx, { type: "ItemStatusChanged", actor: "system", payload: { itemId: row.id, from: "ready", to: t.to } });
      }
    }
  }
}

/** Autostarts ready agent items (settings.itemStart === "auto", autostart, never run before) up to the concurrency limit. */
export function scheduleAutostart(ctx: EngagementContext): void {
  if (ctx.meta.settings.itemStart !== "auto" || !ctx.startAgentRun) return;
  const max = ctx.profile.limits.maxConcurrentRuns;
  if (ctx.activeRuns.size >= max) return;

  const rows = itemsRepo
    .listItems(ctx.dbCtx)
    .filter(
      (r) =>
        r.executor === "agent" &&
        r.status === "ready" &&
        r.autostart &&
        r.lastSessionId == null &&
        !ctx.activeRuns.has(r.id),
    )
    .sort((a, b) => a.ord - b.ord);

  for (const row of rows) {
    if (ctx.activeRuns.size >= max) break;
    ctx.startAgentRun(row.id);
  }
}

/** Convenience: recompute readiness, then let newly-ready items autostart. */
export function syncPlanState(ctx: EngagementContext): void {
  recomputeReadiness(ctx);
  scheduleAutostart(ctx);
}
