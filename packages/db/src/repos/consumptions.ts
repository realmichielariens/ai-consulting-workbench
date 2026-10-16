// Pins (declared, at run start) and implicit reads (PostToolUse audit).
// Staleness queries run on this table from I4; I1 only needs to record and
// list them (the item detail view can show "read but not declared").

import { eq } from "drizzle-orm";
import type { RunId, SlotRef } from "@workbench/core";
import type { Db } from "../client.js";
import { consumptions } from "../schema.js";

export type ConsumptionMode = "declared" | "implicit" | "library";

export interface ConsumptionRow {
  runId: RunId;
  slot: SlotRef;
  major: number;
  minor: number;
  mode: ConsumptionMode;
  at: number;
}

/** Idempotent: the same (run, slot, version, mode) can be recorded more than once (e.g. two reads of the same declared input) without erroring. */
export function recordConsumption(ctx: Db, row: ConsumptionRow): void {
  ctx.sqlite
    .prepare(
      `INSERT OR IGNORE INTO consumptions (run_id, slot_ref, major, minor, mode, at)
       VALUES (@runId, @slotRef, @major, @minor, @mode, @at)`,
    )
    .run({ runId: row.runId, slotRef: row.slot, major: row.major, minor: row.minor, mode: row.mode, at: row.at });
}

export function listByRun(ctx: Db, runId: RunId): ConsumptionRow[] {
  return ctx.db
    .select()
    .from(consumptions)
    .where(eq(consumptions.runId, runId))
    .all()
    .map((r) => ({ runId: r.runId as RunId, slot: r.slotRef as SlotRef, major: r.major, minor: r.minor, mode: r.mode as ConsumptionMode, at: r.at }));
}
