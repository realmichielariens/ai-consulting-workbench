// Gate chain state per submission round (ARCHITECTURE.md §6.2, schema.ts
// gate_steps). Thin persistence over rules/gates.ts: this module stores and
// retrieves GateRoundStep rows; the round/verdict *decisions* belong to gates.ts.

import { and, desc, eq } from "drizzle-orm";
import {
  SlotVersionRef,
  type GateRoundStep,
  type GateStepStatus,
  type GateType,
  type GateVerdict,
  type IsoTime,
  type ItemId,
  type RequestId,
} from "@workbench/core";
import type { Db } from "../client.js";
import { gateSteps } from "../schema.js";
import { parseJsonColumn, toEpochMs, toIsoTime, toJsonColumn } from "../mappers.js";

const SlotVersionRefArray = SlotVersionRef.array();

export interface GateStepRow extends GateRoundStep {
  itemId: ItemId;
  requestId: RequestId | null;
  verdict: GateVerdict | null;
  by: string | null;
  decisionId: string | null;
  at: IsoTime | null;
}

function mapRow(row: typeof gateSteps.$inferSelect): GateStepRow {
  return {
    itemId: row.itemId as ItemId,
    round: row.round,
    seq: row.seq,
    type: row.type as GateType,
    status: row.status as GateStepStatus,
    requestId: row.requestId as RequestId | null,
    assetVersions: parseJsonColumn("asset_versions", row.assetVersions, SlotVersionRefArray),
    verdict: row.verdict as GateVerdict | null,
    by: row.by,
    decisionId: row.decisionId,
    at: row.at == null ? null : toIsoTime(row.at),
  };
}

/** Inserts every step of a freshly opened round (rules/gates.ts's openGateRound output). */
export function insertGateRound(ctx: Db, itemId: ItemId, steps: readonly GateRoundStep[]): void {
  ctx.sqlite.transaction(() => {
    for (const step of steps) {
      ctx.db
        .insert(gateSteps)
        .values({
          itemId,
          round: step.round,
          seq: step.seq,
          type: step.type,
          status: step.status,
          requestId: null,
          assetVersions: toJsonColumn(step.assetVersions, SlotVersionRefArray),
          verdict: null,
          by: null,
          decisionId: null,
          at: null,
        })
        .run();
    }
  })();
}

export function setRequestId(ctx: Db, itemId: ItemId, round: number, seq: number, requestId: RequestId): void {
  ctx.db
    .update(gateSteps)
    .set({ requestId })
    .where(and(eq(gateSteps.itemId, itemId), eq(gateSteps.round, round), eq(gateSteps.seq, seq)))
    .run();
}

/** Resolves one step: records the verdict and moves its status (rules/gates.ts's resolveGateVerdict decided `stepStatus`). */
export function resolveStep(
  ctx: Db,
  itemId: ItemId,
  round: number,
  seq: number,
  status: GateStepStatus,
  verdict: GateVerdict,
  by: string,
  at: IsoTime,
): void {
  ctx.db
    .update(gateSteps)
    .set({ status, verdict, by, at: toEpochMs(at) })
    .where(and(eq(gateSteps.itemId, itemId), eq(gateSteps.round, round), eq(gateSteps.seq, seq)))
    .run();
}

/** Closes a review round without a verdict when its submission is withdrawn. */
export function withdrawStep(ctx: Db, itemId: ItemId, round: number, seq: number, at: IsoTime): void {
  ctx.db
    .update(gateSteps)
    .set({ status: "withdrawn", at: toEpochMs(at) })
    .where(and(eq(gateSteps.itemId, itemId), eq(gateSteps.round, round), eq(gateSteps.seq, seq), eq(gateSteps.status, "open")))
    .run();
}

export function getStep(ctx: Db, itemId: ItemId, round: number, seq: number): GateStepRow | null {
  const row = ctx.db
    .select()
    .from(gateSteps)
    .where(and(eq(gateSteps.itemId, itemId), eq(gateSteps.round, round), eq(gateSteps.seq, seq)))
    .get();
  return row ? mapRow(row) : null;
}

/** The step currently open for an item, if any (there is at most one at a time). */
export function getOpenStep(ctx: Db, itemId: ItemId): GateStepRow | null {
  const row = ctx.db
    .select()
    .from(gateSteps)
    .where(and(eq(gateSteps.itemId, itemId), eq(gateSteps.status, "open")))
    .get();
  return row ? mapRow(row) : null;
}

/** The highest round number opened for this item (0 if the item has never submitted). */
export function getCurrentRound(ctx: Db, itemId: ItemId): number {
  const row = ctx.db.select().from(gateSteps).where(eq(gateSteps.itemId, itemId)).orderBy(desc(gateSteps.round)).limit(1).get();
  return row?.round ?? 0;
}

export function listByItem(ctx: Db, itemId: ItemId): GateStepRow[] {
  return ctx.db.select().from(gateSteps).where(eq(gateSteps.itemId, itemId)).all().map(mapRow);
}
