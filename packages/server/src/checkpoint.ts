// Checkpoint commits (ARCHITECTURE.md §11): WAL checkpoint, re-render
// plan.md, then `git add -A` + commit with actor attribution and trailers.
// Called after every command that changes files or item status (publish,
// run end, gate verdict, brief edit, human upload, mark done, engagement
// creation) — never from inside a DB transaction, always after it commits.

import { walCheckpoint } from "@workbench/db";
import { itemsRepo, assetVersionsRepo } from "@workbench/db";
import { checkpoint, renderPlanMd, writePlanMd } from "@workbench/store";
import type { Actor, ItemNode, PlanView, SlotNode } from "@workbench/core";
import { computeReadiness, rollupFor, type ReadinessItem, type RollupTreeItem } from "@workbench/core";
import { emitEvent, type EngagementContext } from "./engagementContext.js";

/** Builds the current PlanView straight from the DB (views.ts's getPlan reuses this). */
export function buildPlanView(ctx: EngagementContext): PlanView {
  const rows = itemsRepo.listItems(ctx.dbCtx);
  const allInputs = itemsRepo.listAllInputs(ctx.dbCtx);
  const allOutputs = itemsRepo.listAllOutputs(ctx.dbCtx);
  const allSeq = itemsRepo.listAllSequencing(ctx.dbCtx);
  const latestPerSlot = assetVersionsRepo.listLatestPerSlot(ctx.dbCtx);
  const publishedSlots = new Set(latestPerSlot.keys());

  const inputsByItem = new Map<string, typeof allInputs>();
  for (const row of allInputs) {
    const list = inputsByItem.get(row.itemId) ?? [];
    list.push(row);
    inputsByItem.set(row.itemId, list);
  }
  const outputsByItem = new Map<string, typeof allOutputs>();
  for (const row of allOutputs) {
    const list = outputsByItem.get(row.itemId) ?? [];
    list.push(row);
    outputsByItem.set(row.itemId, list);
  }
  const seqByItem = new Map<string, string[]>();
  for (const row of allSeq) {
    const list = seqByItem.get(row.itemId) ?? [];
    list.push(row.afterItemId);
    seqByItem.set(row.itemId, list);
  }
  const consumersBySlot = new Map<string, string[]>();
  for (const row of allInputs) {
    const list = consumersBySlot.get(row.slot) ?? [];
    list.push(row.itemId);
    consumersBySlot.set(row.slot, list);
  }

  const readinessItems: ReadinessItem[] = rows
    .filter((r) => r.executor != null)
    .map((r) => ({
      id: r.id,
      executor: r.executor,
      status: r.status,
      inputs: (inputsByItem.get(r.id) ?? []).map((i) => ({ slot: i.slot, required: i.required })),
      sequencing: seqByItem.get(r.id) ?? [],
    }));
  const readiness = computeReadiness({ items: readinessItems, publishedSlots });

  const rollupTreeItems: RollupTreeItem[] = rows.map((r) => ({ id: r.id, parent: r.parent, executor: r.executor, status: r.status }));

  const items: ItemNode[] = rows.map((r) => {
    const isTask = r.kind === "task";
    const active = ctx.activeRuns.get(r.id);
    const resumable = isTask && r.executor === "agent" && r.status === "ready" && r.lastSessionId != null && !active;
    return {
      id: r.id,
      title: r.title,
      kind: r.kind,
      parent: r.parent,
      order: r.ord,
      executor: r.executor,
      status: isTask ? r.status : null,
      rollup: isTask ? null : rollupFor(rollupTreeItems, r.id),
      gate: r.gate,
      inputs: (inputsByItem.get(r.id) ?? []).map((i) => ({ slot: i.slot, required: i.required, pin: i.pin ?? undefined })),
      outputs: (outputsByItem.get(r.id) ?? []).map((o) => o.slotRef),
      notReadyBecause: isTask && r.status === "waiting" ? (readiness.get(r.id)?.blockers ?? []) : [],
      activeRunId: active?.runId ?? null,
      resumable,
    };
  });

  const slots: SlotNode[] = allOutputs.map((o) => ({
    ref: o.slotRef,
    owner: o.itemId,
    name: o.slot,
    format: o.format,
    scope: o.scope,
    description: o.description,
    required: o.required,
    latest: latestPerSlot.get(o.slotRef) ?? null,
    versionCount: assetVersionsRepo.listVersions(ctx.dbCtx, o.slotRef).length,
    consumers: consumersBySlot.get(o.slotRef) ?? [],
  }));

  return { engagementId: ctx.id, planVersion: ctx.meta.planVersion, items, slots };
}

export interface CheckpointCommitOptions {
  message: string;
  actor: Actor;
  trailers?: Record<string, string>;
}

/**
 * WAL checkpoint + re-render plan.md + `git add -A` + commit; emits
 * CheckpointCommitted if anything changed. Serialized through the
 * engagement's write queue: several runs can publish concurrently, but only
 * one `git` process may touch the repo at a time (a concurrent `git add`+
 * `commit` from two callers races for `.git/index.lock`).
 */
export async function checkpointCommit(ctx: EngagementContext, opts: CheckpointCommitOptions): Promise<string | null> {
  return ctx.writeQueue.run(async () => {
    const sha = await checkpoint(ctx.paths.root, {
      message: opts.message,
      actor: opts.actor,
      trailers: opts.trailers,
      beforeCommit: () => {
        walCheckpoint(ctx.dbCtx);
        const view = buildPlanView(ctx);
        writePlanMd(ctx.paths, renderPlanMd(view, ctx.meta));
      },
    });
    if (sha) emitEvent(ctx, { type: "CheckpointCommitted", actor: "system", payload: { sha, message: opts.message } });
    return sha;
  });
}
