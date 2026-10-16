// Runs (ARCHITECTURE.md §8.2, domain.ts Run). `runtime` (real|fake) and
// `report` (the CompletionReport from submit_outputs) are schema.ts additions
// beyond the Run contract; RunRow carries them alongside the contract fields.

import { desc, eq, isNull } from "drizzle-orm";
import { CompletionReport, type IsoTime, type ItemId, type Run, type RunId, type RunOutcome, type RunReason } from "@workbench/core";
import type { Db } from "../client.js";
import { runs } from "../schema.js";
import { parseJsonColumn, toEpochMs, toIsoTime, toJsonColumn } from "../mappers.js";

export interface RunRow extends Run {
  runtime: "real" | "fake";
  report: CompletionReport | null;
}

function mapRow(row: typeof runs.$inferSelect): RunRow {
  return {
    id: row.id as RunId,
    itemId: row.itemId as ItemId,
    sessionId: row.sessionId,
    reason: row.reason as RunReason,
    outcome: row.outcome as RunOutcome | null,
    runtime: row.runtime as "real" | "fake",
    model: row.model,
    costUsd: row.costUsd,
    turns: row.turns,
    promptHash: row.promptHash,
    startedAt: toIsoTime(row.startedAt),
    endedAt: row.endedAt == null ? null : toIsoTime(row.endedAt),
    nudged: row.nudged,
    denials: row.denials,
    error: row.error,
    report: row.report == null ? null : parseJsonColumn("report", row.report, CompletionReport),
  };
}

export interface CreateRunInput {
  id: RunId;
  itemId: ItemId;
  sessionId: string | null;
  reason: RunReason;
  runtime: "real" | "fake";
  model: string;
  promptHash: string | null;
  startedAt: IsoTime;
}

export function createRun(ctx: Db, input: CreateRunInput): RunRow {
  ctx.db
    .insert(runs)
    .values({
      id: input.id,
      itemId: input.itemId,
      sessionId: input.sessionId,
      reason: input.reason,
      outcome: null,
      runtime: input.runtime,
      model: input.model,
      costUsd: 0,
      turns: 0,
      promptHash: input.promptHash,
      nudged: false,
      denials: 0,
      error: null,
      report: null,
      startedAt: toEpochMs(input.startedAt),
      endedAt: null,
    })
    .run();
  const row = getRun(ctx, input.id);
  if (!row) throw new Error(`createRun: row for ${input.id} vanished after insert`);
  return row;
}

export interface RunProgressPatch {
  sessionId?: string;
  costUsd?: number;
  turns?: number;
  denials?: number;
  nudged?: boolean;
}

/** Patches applied while the run is still active (session id as soon as known; cost/turns/denials as they accrue). */
export function updateRunProgress(ctx: Db, runId: RunId, patch: RunProgressPatch): void {
  ctx.db.update(runs).set(patch).where(eq(runs.id, runId)).run();
}

export interface FinishRunInput {
  outcome: RunOutcome;
  costUsd: number;
  turns: number;
  promptHash: string | null;
  nudged: boolean;
  denials: number;
  error: string | null;
  report: CompletionReport | null;
  endedAt: IsoTime;
}

export function finishRun(ctx: Db, runId: RunId, input: FinishRunInput): RunRow {
  ctx.db
    .update(runs)
    .set({
      outcome: input.outcome,
      costUsd: input.costUsd,
      turns: input.turns,
      promptHash: input.promptHash,
      nudged: input.nudged,
      denials: input.denials,
      error: input.error,
      report: input.report == null ? null : toJsonColumn(input.report, CompletionReport),
      endedAt: toEpochMs(input.endedAt),
    })
    .where(eq(runs.id, runId))
    .run();
  const row = getRun(ctx, runId);
  if (!row) throw new Error(`finishRun: no such run ${runId}`);
  return row;
}

export function getRun(ctx: Db, runId: RunId): RunRow | null {
  const row = ctx.db.select().from(runs).where(eq(runs.id, runId)).get();
  return row ? mapRow(row) : null;
}

/** Newest first. */
export function listByItem(ctx: Db, itemId: ItemId): RunRow[] {
  return ctx.db.select().from(runs).where(eq(runs.itemId, itemId)).orderBy(desc(runs.startedAt)).all().map(mapRow);
}

/** outcome IS NULL: still running (startup reconciliation, R1). */
export function listActiveRuns(ctx: Db): RunRow[] {
  return ctx.db.select().from(runs).where(isNull(runs.outcome)).all().map(mapRow);
}
