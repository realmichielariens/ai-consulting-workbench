// J2.2/J2.5 — approve, reject and preview plan-change proposals. Only this
// module writes item.md files and bumps planVersion for a proposal; the
// validate -> write -> DB -> events -> checkpoint order follows CLAUDE.md
// rule 12 exactly as services.ts's other commands do.

import { execFileSync } from "node:child_process";
import {
  applyItemEvent,
  applyOps,
  describeOp,
  initialStatus,
  itemKindOf,
  rollupFor,
  slotRef as makeSlotRef,
  validateOps,
  type Actor,
  type Allowed,
  type ItemId,
  type ItemNode,
  type ItemStatus,
  type PlanPreviewView,
  type Proposal,
  type ProposalId,
  type ProposalView,
  type RollupTreeItem,
  type SlotNode,
} from "@workbench/core";
import { assetVersionsRepo, itemsRepo, nextMessageId, proposalsRepo, threadsRepo } from "@workbench/db";
import { ensureItemDirs, readItemMd, writeEngagementYaml, writeItemMd } from "@workbench/store";
import { checkpointCommit } from "./checkpoint.js";
import { conflict, notFound } from "./errors.js";
import { emitEvent, reloadMeta, type EngagementContext } from "./engagementContext.js";
import { syncPlanState } from "./scheduler.js";

function requireProposal(ctx: EngagementContext, id: ProposalId): Proposal {
  const proposal = proposalsRepo.getProposal(ctx.dbCtx, id);
  if (!proposal) throw notFound(`no such proposal: ${id}`);
  return proposal;
}

function currentDefs(ctx: EngagementContext) {
  return itemsRepo.listItems(ctx.dbCtx).map((r) => readItemMd(ctx.paths.itemMd(r.id)));
}

export function getProposalView(ctx: EngagementContext, id: ProposalId): ProposalView {
  const proposal = requireProposal(ctx, id);
  const readableOps = proposal.ops.map((op) => describeOp(op, currentDefs(ctx)));
  const suggestedByTitle = proposal.suggestedBy ? (itemsRepo.getItem(ctx.dbCtx, proposal.suggestedBy)?.title ?? null) : null;
  const allowed: Allowed =
    proposal.status === "pending" ? { allowed: true, reason: null } : { allowed: false, reason: `This proposal is already ${proposal.status}.` };
  return { proposal, readableOps, suggestedByTitle, actions: { approve: allowed, reject: allowed } };
}

export function listProposalViews(ctx: EngagementContext): ProposalView[] {
  return proposalsRepo.listProposals(ctx.dbCtx).map((p) => getProposalView(ctx, p.id));
}

function tagPlanVersion(ctx: EngagementContext, version: number): void {
  try {
    execFileSync("git", ["tag", "-f", `plan/v${version}`], { cwd: ctx.paths.root, stdio: "ignore" });
  } catch (err) {
    // Non-fatal: the tag is a convenience for `git log`/`git diff` between plan
    // versions, not part of the source of truth (the DB row + the commit already are).
    // eslint-disable-next-line no-console
    console.error(`failed to tag plan/v${version}:`, err);
  }
}

async function rejectInternal(ctx: EngagementContext, proposal: Proposal, reason: string, actor: Actor): Promise<ProposalView> {
  const now = new Date().toISOString();
  proposalsRepo.markRejected(ctx.dbCtx, proposal.id, reason, now);
  emitEvent(ctx, { type: "ProposalRejected", actor, payload: { proposalId: proposal.id, reason } });

  if (proposal.threadId) {
    const messageId = nextMessageId(ctx.dbCtx);
    threadsRepo.insertChatMessage(ctx.dbCtx, {
      id: messageId,
      threadId: proposal.threadId,
      role: "system",
      body: `Proposal ${proposal.id} rejected: ${reason}`,
      at: now,
    });
    emitEvent(ctx, { type: "ChatMessagePosted", actor, payload: { threadId: proposal.threadId, messageId, role: "system" } });
  }

  await checkpointCommit(ctx, { message: `Reject proposal ${proposal.id}`, actor });
  return getProposalView(ctx, proposal.id);
}

export async function rejectProposal(ctx: EngagementContext, id: ProposalId, reason: string): Promise<ProposalView> {
  const proposal = requireProposal(ctx, id);
  if (proposal.status !== "pending") throw conflict(`${id} is already ${proposal.status}`);
  return rejectInternal(ctx, proposal, reason, "human");
}

export async function approveProposal(ctx: EngagementContext, id: ProposalId): Promise<ProposalView> {
  const proposal = requireProposal(ctx, id);
  if (proposal.status !== "pending") throw conflict(`${id} is already ${proposal.status}`);

  if (proposal.basePlanVersion !== ctx.meta.planVersion) {
    return rejectInternal(
      ctx,
      proposal,
      `The plan changed since this proposal was made (it was based on v${proposal.basePlanVersion}, the plan is now v${ctx.meta.planVersion}).`,
      "system",
    );
  }

  const rows = itemsRepo.listItems(ctx.dbCtx);
  const defs = rows.map((r) => readItemMd(ctx.paths.itemMd(r.id)));
  const statusById = new Map<ItemId, ItemStatus | null>(rows.map((r) => [r.id, r.status]));
  const slotsWithVersions = assetVersionsRepo.publishedSlots(ctx.dbCtx);
  const errors = validateOps({ defs, statusById, slotsWithVersions }, proposal.ops);
  if (errors.length > 0) {
    // propose_ops already validated this; a failure here means the plan moved
    // in a way basePlanVersion didn't catch (e.g. a status change with no
    // planVersion bump). Never apply an invalid proposal (J2.2).
    return rejectInternal(ctx, proposal, `This proposal no longer validates: ${errors.join("; ")}`, "system");
  }

  const result = applyOps(defs, proposal.ops);
  const touchedIds = new Set([...result.added, ...result.changed]);
  const now = Date.now();

  for (const def of result.defs) {
    if (!touchedIds.has(def.id)) continue;
    ensureItemDirs(ctx.paths, def.id);
    writeItemMd(ctx.paths.itemMd(def.id), def);
  }
  itemsRepo.upsertDefinitions(ctx.dbCtx, result.defs.filter((d) => touchedIds.has(d.id)), now);

  for (const itemId of result.cancelled) {
    const row = itemsRepo.getItem(ctx.dbCtx, itemId);
    if (!row?.status || !row.executor) continue;
    const t = applyItemEvent(row.status, { type: "cancel" }, { executor: row.executor });
    if (t.ok) {
      itemsRepo.setStatus(ctx.dbCtx, itemId, t.to, now);
      emitEvent(ctx, { type: "ItemStatusChanged", actor: "human", payload: { itemId, from: row.status, to: t.to } });
    }
  }

  const newPlanVersion = ctx.meta.planVersion + 1;
  ctx.meta = { ...ctx.meta, planVersion: newPlanVersion };
  writeEngagementYaml(ctx.paths, ctx.meta);

  const resolvedAt = new Date(now).toISOString();
  proposalsRepo.markApplied(ctx.dbCtx, id, newPlanVersion, resolvedAt);
  emitEvent(ctx, { type: "ProposalApplied", actor: "human", payload: { proposalId: id, planVersion: newPlanVersion } });
  emitEvent(ctx, { type: "PlanChanged", actor: "human", payload: { planVersion: newPlanVersion, cause: "proposal", proposalId: id } });

  await checkpointCommit(ctx, {
    message: `Apply proposal ${id} (plan v${newPlanVersion})`,
    actor: "human",
    trailers: { "Workbench-Event": "ProposalApplied", "Workbench-Proposal": id },
  });
  tagPlanVersion(ctx, newPlanVersion);
  reloadMeta(ctx);
  syncPlanState(ctx);

  return getProposalView(ctx, id);
}

/** J2.2 "Preview in process view": applies the proposal's ops to a copy of the current plan. Nothing is written. */
export function previewProposal(ctx: EngagementContext, id: ProposalId): PlanPreviewView {
  const proposal = requireProposal(ctx, id);
  const rows = itemsRepo.listItems(ctx.dbCtx);
  const defs = rows.map((r) => readItemMd(ctx.paths.itemMd(r.id)));
  const result = applyOps(defs, proposal.ops);

  const statusById = new Map<ItemId, ItemStatus | null>(rows.map((r) => [r.id, r.status]));
  for (const addedId of result.added) statusById.set(addedId, initialStatus(result.defs.find((d) => d.id === addedId)!));
  for (const cancelledId of result.cancelled) statusById.set(cancelledId, "cancelled");

  const rollupTreeItems: RollupTreeItem[] = result.defs.map((d) => ({
    id: d.id,
    parent: d.parent,
    executor: d.executor,
    status: statusById.get(d.id) ?? null,
  }));

  const latestPerSlot = assetVersionsRepo.listLatestPerSlot(ctx.dbCtx);

  const items: ItemNode[] = result.defs.map((def) => {
    const isTask = itemKindOf(def) === "task";
    return {
      id: def.id,
      title: def.title,
      kind: itemKindOf(def),
      parent: def.parent,
      order: def.order,
      executor: def.executor,
      status: isTask ? (statusById.get(def.id) ?? null) : null,
      rollup: isTask ? null : rollupFor(rollupTreeItems, def.id),
      gate: def.gate,
      inputs: def.inputs,
      outputs: def.outputs.map((o) => makeSlotRef(def.id, o.slot)),
      notReadyBecause: [],
      activeRunId: null,
      resumable: false,
    };
  });

  const slots: SlotNode[] = result.defs.flatMap((def) =>
    def.outputs.map((o) => {
      const ref = makeSlotRef(def.id, o.slot);
      const consumers = result.defs.filter((d) => d.inputs.some((i) => i.slot === ref)).map((d) => d.id);
      const latest = latestPerSlot.get(ref) ?? null;
      return {
        ref,
        owner: def.id,
        name: o.slot,
        format: o.format,
        scope: o.scope,
        description: o.description,
        required: o.required,
        latest,
        versionCount: latest ? assetVersionsRepo.listVersions(ctx.dbCtx, ref).length : 0,
        consumers,
      };
    }),
  );

  return {
    engagementId: ctx.id,
    planVersion: proposal.basePlanVersion,
    items,
    slots,
    proposalId: id,
    basePlanVersion: proposal.basePlanVersion,
    added: result.added,
    changed: result.changed,
    cancelled: result.cancelled,
  };
}
