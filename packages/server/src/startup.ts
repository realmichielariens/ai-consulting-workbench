// Startup reconciliation (ARCHITECTURE.md §8.4, R1/R2), simplified per scope
// cut: re-read item.md files into the DB index, clear stale leases (mark
// their runs interrupted and their items ready + resumable), and kill any
// recorded child PID that is still alive. Called once per engagement when
// its context is opened.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { applyItemEvent, ItemDef, type ItemId } from "@workbench/core";
import { itemsRepo, leasesRepo, runsRepo } from "@workbench/db";
import { readItemMd } from "@workbench/store";
import { emitEvent, type EngagementContext } from "./engagementContext.js";
import { wireAutostart } from "./runService.js";
import { syncPlanState } from "./scheduler.js";

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function killTree(pid: number): void {
  try {
    if (process.platform === "win32") execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"]);
    else process.kill(pid, "SIGKILL");
  } catch {
    /* best effort — process may have exited between the alive-check and here */
  }
}

/** Re-reads every item's item.md (items/<id>/item.md) into the DB index. Files win for definitions (status is untouched). */
function reconcileDefinitions(ctx: EngagementContext): void {
  if (!fs.existsSync(ctx.paths.itemsDir)) return;
  const defs = fs
    .readdirSync(ctx.paths.itemsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => ctx.paths.itemMd(e.name as ItemId))
    .filter((f) => fs.existsSync(f))
    .map((f) => readItemMd(f));
  const valid: ItemDef[] = [];
  for (const d of defs) {
    const parsed = ItemDef.safeParse(d);
    if (parsed.success) valid.push(parsed.data);
  }
  itemsRepo.upsertDefinitions(ctx.dbCtx, valid, Date.now());
}

/** R2: kill any recorded child process still alive (crash/hard-kill left it orphaned). */
function orphanCleanup(ctx: EngagementContext): void {
  for (const session of leasesRepo.listWithPid(ctx.dbCtx)) {
    if (session.pid != null && isAlive(session.pid)) killTree(session.pid);
  }
}

/** R1: clear expired leases, mark their runs interrupted, and their items ready + resumable. */
function clearStaleLeases(ctx: EngagementContext): void {
  const now = Date.now();
  for (const session of leasesRepo.listExpired(ctx.dbCtx, now)) {
    if (!session.holder) continue;
    leasesRepo.releaseLease(ctx.dbCtx, session.scopeKey, session.holder, now);

    const run = runsRepo.getRun(ctx.dbCtx, session.holder);
    if (run && run.outcome == null) {
      runsRepo.finishRun(ctx.dbCtx, run.id, {
        outcome: "interrupted",
        costUsd: run.costUsd,
        turns: run.turns,
        promptHash: run.promptHash,
        nudged: run.nudged,
        denials: run.denials,
        error: null,
        report: null,
        endedAt: new Date(now).toISOString(),
      });
      emitEvent(ctx, { type: "RunEnded", actor: "system", payload: { runId: run.id, itemId: run.itemId, outcome: "interrupted", costUsd: run.costUsd, turns: run.turns } });

      const itemRow = itemsRepo.getItem(ctx.dbCtx, run.itemId);
      if (itemRow?.status === "in_progress") {
        const t = applyItemEvent("in_progress", { type: "run_ended", outcome: "interrupted" }, { executor: "agent" });
        if (t.ok) {
          itemsRepo.setStatus(ctx.dbCtx, run.itemId, t.to, now);
          emitEvent(ctx, { type: "ItemStatusChanged", actor: "system", payload: { itemId: run.itemId, from: "in_progress", to: t.to } });
        }
      }
    }
  }
}

/** Runs once when an engagement context is opened (createEngagement, or eagerly at process start for existing engagements). */
export function reconcileEngagement(ctx: EngagementContext): void {
  wireAutostart(ctx);
  reconcileDefinitions(ctx);
  orphanCleanup(ctx);
  clearStaleLeases(ctx);
  syncPlanState(ctx);
}
