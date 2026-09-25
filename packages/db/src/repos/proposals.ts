// Plan-change proposals (domain.ts Proposal, schema.ts `proposals`). Optimistic
// concurrency (basePlanVersion vs. the live planVersion) is checked by the
// caller (proposalService.ts) at approval time, not here.

import { and, desc, eq } from "drizzle-orm";
import {
  PlanOp,
  Proposal,
  type Actor,
  type IsoTime,
  type ItemId,
  type PlanOp as PlanOpT,
  type ProposalId,
  type ProposalOrigin,
  type RequestId,
  type ThreadId,
} from "@workbench/core";
import type { Db } from "../client.js";
import { proposals } from "../schema.js";
import { parseJsonColumn, toEpochMs, toIsoTime, toJsonColumn } from "../mappers.js";

const PlanOpArray = PlanOp.array();

function mapRow(row: typeof proposals.$inferSelect): Proposal {
  return Proposal.parse({
    id: row.id,
    origin: row.origin,
    suggestedBy: row.suggestedBy,
    requestId: row.requestId,
    threadId: row.threadId,
    author: row.author,
    status: row.status,
    basePlanVersion: row.basePlanVersion,
    rationale: row.rationale,
    ops: parseJsonColumn("ops", row.ops, PlanOpArray),
    createdAt: toIsoTime(row.createdAt),
    resolvedAt: row.resolvedAt == null ? null : toIsoTime(row.resolvedAt),
    appliedPlanVersion: row.appliedPlanVersion,
    rejectReason: row.rejectReason,
    supersededBy: row.supersededBy,
  });
}

export interface CreateProposalInput {
  id: ProposalId;
  origin: ProposalOrigin;
  suggestedBy: ItemId | null;
  requestId: RequestId | null;
  threadId: ThreadId | null;
  author: Actor;
  basePlanVersion: number;
  rationale: string;
  ops: PlanOpT[];
  createdAt: IsoTime;
}

export function createProposal(ctx: Db, input: CreateProposalInput): Proposal {
  const ops = PlanOpArray.parse(input.ops);
  ctx.db
    .insert(proposals)
    .values({
      id: input.id,
      origin: input.origin,
      suggestedBy: input.suggestedBy,
      requestId: input.requestId,
      threadId: input.threadId,
      author: input.author,
      status: "pending",
      basePlanVersion: input.basePlanVersion,
      rationale: input.rationale,
      ops: toJsonColumn(ops, PlanOpArray),
      appliedPlanVersion: null,
      rejectReason: null,
      supersededBy: null,
      createdAt: toEpochMs(input.createdAt),
      resolvedAt: null,
    })
    .run();
  const row = getProposal(ctx, input.id);
  if (!row) throw new Error(`createProposal: row for ${input.id} vanished after insert`);
  return row;
}

export function getProposal(ctx: Db, id: ProposalId): Proposal | null {
  const row = ctx.db.select().from(proposals).where(eq(proposals.id, id)).get();
  return row ? mapRow(row) : null;
}

/** Newest first. */
export function listProposals(ctx: Db): Proposal[] {
  return ctx.db.select().from(proposals).orderBy(desc(proposals.createdAt)).all().map(mapRow);
}

export function listPending(ctx: Db): Proposal[] {
  return ctx.db.select().from(proposals).where(eq(proposals.status, "pending")).orderBy(desc(proposals.createdAt)).all().map(mapRow);
}

/** The pending proposal from the same thread, if any — the one a new proposal from that thread supersedes. */
export function findPendingByThread(ctx: Db, threadId: ThreadId): Proposal | null {
  const row = ctx.db
    .select()
    .from(proposals)
    .where(and(eq(proposals.threadId, threadId), eq(proposals.status, "pending")))
    .get();
  return row ? mapRow(row) : null;
}

export function markApplied(ctx: Db, id: ProposalId, appliedPlanVersion: number, resolvedAt: IsoTime): Proposal {
  ctx.db.update(proposals).set({ status: "approved", appliedPlanVersion, resolvedAt: toEpochMs(resolvedAt) }).where(eq(proposals.id, id)).run();
  const row = getProposal(ctx, id);
  if (!row) throw new Error(`markApplied: no such proposal ${id}`);
  return row;
}

export function markRejected(ctx: Db, id: ProposalId, reason: string, resolvedAt: IsoTime): Proposal {
  ctx.db.update(proposals).set({ status: "rejected", rejectReason: reason, resolvedAt: toEpochMs(resolvedAt) }).where(eq(proposals.id, id)).run();
  const row = getProposal(ctx, id);
  if (!row) throw new Error(`markRejected: no such proposal ${id}`);
  return row;
}

export function markSuperseded(ctx: Db, id: ProposalId, by: ProposalId, resolvedAt: IsoTime): Proposal {
  ctx.db.update(proposals).set({ status: "superseded", supersededBy: by, resolvedAt: toEpochMs(resolvedAt) }).where(eq(proposals.id, id)).run();
  const row = getProposal(ctx, id);
  if (!row) throw new Error(`markSuperseded: no such proposal ${id}`);
  return row;
}
