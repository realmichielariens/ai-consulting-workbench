// Starting, observing and ending Work Agent runs (ARCHITECTURE.md §8.2, §8.4,
// §8.5 layer 5). `launchRun` is the single entry point: fresh start, resume
// (R1/R5), resume-answer (J1.4) and changes-requested (J1.5) all go through
// it, distinguished only by which lifecycle transition the caller already
// applied (see the `status` check below) and which RunReason/RunInput it's
// given.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  agentActor,
  applyItemEvent,
  slotRef as makeSlotRef,
  openGateRound,
  type Actor,
  type ItemId,
  type RunId,
  type RunInput,
  type RunObserver,
  type RunReason,
  type RunResult,
} from "@workbench/core";
import { normalize } from "@workbench/core/node";
import {
  consumptionsRepo,
  gateStepsRepo,
  itemsRepo,
  leasesRepo,
  nextRequestId,
  nextRunId,
  requestsRepo,
  runsRepo,
} from "@workbench/db";
import { readItemMd } from "@workbench/store";
import { checkpointCommit } from "./checkpoint.js";
import { conflict } from "./errors.js";
import { emitEvent, pushActivity, type EngagementContext } from "./engagementContext.js";
import { syncPlanState } from "./scheduler.js";
import { createWorkPortImpl } from "./workPort.js";

const LEASE_MS = 5 * 60 * 1000;
const LEASE_RENEW_MS = 60 * 1000;

function scopeKeyOf(itemId: ItemId): string {
  return `work:${itemId}`;
}

/** Called once per engagement context (services.ts) so scheduler.ts can trigger autostart without importing this module. */
export function wireAutostart(ctx: EngagementContext): void {
  ctx.startAgentRun = (itemId) => {
    void launchRun(ctx, itemId, "start", { reason: "start" }, null, "system").catch((err: unknown) => {
      // Autostart failures (e.g. a lease race with a manual start) are not
      // fatal to the caller; they show up as a run_issue-free no-op here and
      // the item simply stays ready for a manual Start.
      // eslint-disable-next-line no-console
      console.error(`autostart of ${itemId} failed:`, err);
    });
  };
}

/**
 * Starts or continues a run. If the item's current DB status is "ready", the
 * lifecycle "start" transition (ready -> in_progress) is applied here. If it
 * is already "in_progress" (the caller already applied question_answered /
 * changes_requested / issue_retry), no transition is applied — the run just
 * continues that session.
 */
export async function launchRun(
  ctx: EngagementContext,
  itemId: ItemId,
  reason: RunReason,
  input: RunInput,
  resumeSessionId: string | null,
  actor: Actor,
): Promise<runsRepo.RunRow> {
  const itemRow = itemsRepo.getItem(ctx.dbCtx, itemId);
  if (!itemRow) throw conflict(`no such item: ${itemId}`);
  const def = readItemMd(ctx.paths.itemMd(itemId));

  const scopeKey = scopeKeyOf(itemId);
  const runId = nextRunId(ctx.dbCtx);
  const now = Date.now();
  const lease = leasesRepo.acquireLease(ctx.dbCtx, { scopeKey, role: "work", holder: runId, leaseMs: LEASE_MS, now });
  if (!lease.acquired) throw conflict(`${itemId} is already running.`);

  if (itemRow.status === "ready") {
    const t = applyItemEvent("ready", { type: "start" }, { executor: "agent" });
    if (!t.ok) throw conflict(t.reason);
    itemsRepo.setStatus(ctx.dbCtx, itemId, t.to, now);
    emitEvent(ctx, { type: "ItemStatusChanged", actor, payload: { itemId, from: "ready", to: t.to } });
  }

  // Pin declared inputs (ARCHITECTURE.md §10.1) before the runtime's first
  // getBrief() call, which reads these rows back.
  const nowIso = new Date(now).toISOString();
  for (const row of itemsRepo.listInputs(ctx.dbCtx, itemId)) {
    const version = latestVersionOf(ctx, row.slot);
    if (version) {
      consumptionsRepo.recordConsumption(ctx.dbCtx, {
        runId,
        slot: row.slot,
        major: version.major,
        minor: version.minor,
        mode: "declared",
        at: now,
      });
    }
  }

  runsRepo.createRun(ctx.dbCtx, {
    id: runId,
    itemId,
    sessionId: resumeSessionId,
    reason,
    runtime: ctx.runtime.kind,
    model: ctx.profile.models.work,
    promptHash: null,
    startedAt: nowIso,
  });
  emitEvent(ctx, { type: "RunStarted", actor, payload: { runId, itemId, reason, model: ctx.profile.models.work } });

  const workPort = createWorkPortImpl(ctx, itemId, runId);
  const observer = buildObserver(ctx, itemId, runId, scopeKey);

  const handle = ctx.runtime.startRun({
    runId,
    engagementId: ctx.id,
    item: def,
    reason,
    input,
    resumeSessionId,
    paths: ctx.paths,
    workspace: ctx.workspace,
    workPort,
    observer,
    model: ctx.profile.models.work,
    maxTurns: ctx.profile.limits.maxTurnsPerRun,
    settings: ctx.meta.settings,
  });

  ctx.activeRuns.set(itemId, { runId, handle });

  const renewTimer = setInterval(() => {
    leasesRepo.renewLease(ctx.dbCtx, scopeKey, runId, LEASE_MS, Date.now());
  }, LEASE_RENEW_MS);
  renewTimer.unref?.();

  handle.done
    .then((result) => onRunEnd(ctx, itemId, runId, scopeKey, result))
    .catch((err: unknown) => {
      // eslint-disable-next-line no-console
      console.error(`run ${runId} (${itemId}) end handling failed:`, err);
    })
    .finally(() => clearInterval(renewTimer));

  const row = runsRepo.getRun(ctx.dbCtx, runId);
  if (!row) throw new Error(`launchRun: run ${runId} vanished after creation`);
  return row;
}

function latestVersionOf(ctx: EngagementContext, slot: string): { major: number; minor: number } | null {
  // Local require-free lookup to avoid importing views.ts here (would cycle).
  const row = ctx.dbCtx.sqlite
    .prepare("SELECT major, minor FROM asset_versions WHERE slot_ref = ? ORDER BY major DESC, minor DESC LIMIT 1")
    .get(slot) as { major: number; minor: number } | undefined;
  return row ?? null;
}

function buildObserver(ctx: EngagementContext, itemId: ItemId, runId: RunId, scopeKey: string): RunObserver {
  let denials = 0;
  const activityFile = ctx.paths.runActivity(runId);

  return {
    onActivity(item) {
      fs.mkdirSync(path.dirname(activityFile), { recursive: true });
      fs.appendFileSync(activityFile, `${JSON.stringify(item)}\n`, "utf8");
      pushActivity(ctx, runId, itemId, item);

      if (item.kind === "denial") {
        denials += 1;
        runsRepo.updateRunProgress(ctx.dbCtx, runId, { denials });
        emitEvent(ctx, {
          type: "GuardDenied",
          actor: agentActor(itemId),
          payload: { runId, itemId, tool: item.tool?.name ?? "unknown", reason: item.summary, agentId: item.agentId },
        });
      }
    },
    onSession(sessionId) {
      const now = Date.now();
      runsRepo.updateRunProgress(ctx.dbCtx, runId, { sessionId });
      itemsRepo.setLastSession(ctx.dbCtx, itemId, sessionId, now);
      leasesRepo.setSessionId(ctx.dbCtx, scopeKey, sessionId, now);
    },
    onPid(pid) {
      leasesRepo.setPid(ctx.dbCtx, scopeKey, pid, Date.now());
    },
    onRead(absPath) {
      const mapped = mapPathToVersion(ctx, absPath);
      if (!mapped) return;
      consumptionsRepo.recordConsumption(ctx.dbCtx, {
        runId,
        slot: mapped.slot,
        major: mapped.major,
        minor: mapped.minor,
        mode: "implicit",
        at: Date.now(),
      });
    },
  };
}

const VERSION_FILE_RE = /^items\/([^/]+)\/assets\/([^/]+)\/v(\d+)\.(\d+)\.[^/]+$/;

function mapPathToVersion(ctx: EngagementContext, absPath: string): { slot: string; major: number; minor: number } | null {
  const normAbs = normalize(absPath).toLowerCase();
  const normRoot = `${normalize(ctx.paths.root).toLowerCase()}/`;
  if (!normAbs.startsWith(normRoot)) return null;
  const rel = normalize(absPath).slice(normRoot.length);
  const m = VERSION_FILE_RE.exec(rel);
  if (!m) return null;
  const [, itemId, slot, major, minor] = m;
  return { slot: makeSlotRef(itemId as ItemId, slot!), major: Number(major), minor: Number(minor) };
}

async function onRunEnd(ctx: EngagementContext, itemId: ItemId, runId: RunId, scopeKey: string, result: RunResult): Promise<void> {
  const now = Date.now();
  leasesRepo.releaseLease(ctx.dbCtx, scopeKey, runId, now);
  ctx.activeRuns.delete(itemId);

  const pending = ctx.pendingReports.get(runId);
  ctx.pendingReports.delete(runId);

  const denialsRow = runsRepo.getRun(ctx.dbCtx, runId);
  runsRepo.finishRun(ctx.dbCtx, runId, {
    outcome: result.outcome,
    costUsd: result.costUsd,
    turns: result.turns,
    promptHash: result.promptHash,
    nudged: result.nudged,
    denials: Math.max(result.denials, denialsRow?.denials ?? 0),
    error: result.error,
    report: pending?.report ?? null,
    endedAt: new Date(now).toISOString(),
  });
  emitEvent(ctx, { type: "RunEnded", actor: agentActor(itemId), payload: { runId, itemId, outcome: result.outcome, costUsd: result.costUsd, turns: result.turns } });

  const itemRow = itemsRepo.getItem(ctx.dbCtx, itemId)!;
  const hasGateChain = itemRow.gate.length > 0;
  const transition = applyItemEvent(itemRow.status!, { type: "run_ended", outcome: result.outcome }, { executor: "agent", hasGateChain });
  if (transition.ok) {
    itemsRepo.setStatus(ctx.dbCtx, itemId, transition.to, now);
    emitEvent(ctx, { type: "ItemStatusChanged", actor: agentActor(itemId), payload: { itemId, from: itemRow.status, to: transition.to } });
  }

  if (result.outcome === "submitted" && hasGateChain && pending) {
    const currentRound = gateStepsRepo.getCurrentRound(ctx.dbCtx, itemId);
    const steps = openGateRound(itemRow.gate, currentRound, pending.submittedVersions);
    gateStepsRepo.insertGateRound(ctx.dbCtx, itemId, steps);
    const requestId = nextRequestId(ctx.dbCtx);
    requestsRepo.createRequest(ctx.dbCtx, {
      id: requestId,
      type: "gate_request",
      from: agentActor(itemId),
      to: "human",
      itemId,
      runId,
      blocking: false,
      payload: { step: 0, gateType: steps[0]!.type, submitted: pending.submittedVersions, report: pending.report },
      createdAt: new Date(now).toISOString(),
    });
    gateStepsRepo.setRequestId(ctx.dbCtx, itemId, currentRound + 1, 0, requestId);
    emitEvent(ctx, { type: "RequestOpened", actor: agentActor(itemId), payload: { requestId, type: "gate_request", itemId, to: "human" } });
  } else if (result.outcome === "no_submit" || result.outcome === "max_turns" || result.outcome === "error") {
    const requestId = nextRequestId(ctx.dbCtx);
    requestsRepo.createRequest(ctx.dbCtx, {
      id: requestId,
      type: "run_issue",
      from: "system",
      to: "human",
      itemId,
      runId,
      blocking: false,
      payload: { runId, reason: result.outcome, lastMessage: result.lastMessage || result.error || "" },
      createdAt: new Date(now).toISOString(),
    });
    emitEvent(ctx, { type: "RequestOpened", actor: "system", payload: { requestId, type: "run_issue", itemId, to: "human" } });
  }
  // outcome === "blocked": the request already exists (raiseQuestion, workPort.ts).
  // outcome === "interrupted": nothing further; the item is ready + resumable.

  await postRunLocusAudit(ctx, itemId, runId);

  await checkpointCommit(ctx, {
    message: `Run ${runId} ended (${result.outcome})`,
    actor: agentActor(itemId),
    trailers: { "Workbench-Event": "RunEnded", "Workbench-Run": runId },
  });

  syncPlanState(ctx);
}

// ---------------------------------------------------------------------------
// Post-run locus audit (ARCHITECTURE.md §8.5 layer 5), simplified per scope
// cut: detect + report only (LocusViolation event), no revert. A real revert
// belongs in a later iteration once the guard battery (V1) is validated.
// ---------------------------------------------------------------------------

function isJournaledPath(itemId: ItemId, relPath: string): boolean {
  const p = relPath.replace(/\\/g, "/");
  if (p === `items/${itemId}/worklog.md`) return true;
  if (p.startsWith(`items/${itemId}/assets/`)) return true;
  if (p === "plan.md" || p === "engagement.yaml" || p === ".gitignore" || p === ".gitattributes") return true;
  if (p.startsWith(".workbench/")) return true; // state.db (git-tracked; WAL/-shm are gitignored)
  return false;
}

async function postRunLocusAudit(ctx: EngagementContext, itemId: ItemId, runId: RunId): Promise<void> {
  let status: string;
  try {
    status = execFileSync("git", ["status", "--porcelain"], { cwd: ctx.paths.root, encoding: "utf8" });
  } catch {
    return; // no git repo yet (shouldn't happen after createEngagement) — nothing to audit
  }

  const ownWorkPrefix = `items/${itemId}/work/`;
  const violations: string[] = [];
  for (const line of status.split("\n")) {
    if (!line.trim()) continue;
    const raw = line.slice(3); // porcelain "XY path" (renames: "old -> new")
    const relPath = raw.includes(" -> ") ? raw.split(" -> ")[1]! : raw;
    const norm = relPath.replace(/\\/g, "/").replace(/^"|"$/g, "");
    if (norm.startsWith(ownWorkPrefix) || isJournaledPath(itemId, norm)) continue;
    violations.push(norm);
  }

  if (violations.length === 0) return;
  emitEvent(ctx, { type: "LocusViolation", actor: agentActor(itemId), payload: { runId, itemId, paths: violations, reverted: false } });
}
