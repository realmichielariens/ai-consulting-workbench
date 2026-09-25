// Starting, observing and ending Approach Agent runs (I2-PLAN §4.1): one
// conversation turn per postMessage, and one task session per routed
// question/suggestion, run strictly one task at a time (FIFO queue on
// EngagementContext.approachTaskQueue). Mirrors runService.ts's shape for
// Work Agent runs, but Approach runs are tracked in `ctx.approachRuns`
// (never `ctx.activeRuns`) so they never count against the Work Agent
// autostart concurrency limit (CLAUDE.md rule 12, I2-PLAN §4.1).

import fs from "node:fs";
import path from "node:path";
import {
  type Actor,
  type ApproachSessionKind,
  type PostMessageResult,
  type RequestId,
  type RunId,
  type RunObserver,
  type RunResult,
  type StageContext,
  type ThreadId,
} from "@workbench/core";
import { leasesRepo, nextMessageId, nextNotificationId, nextRunId, notificationsRepo, requestsRepo, runsRepo, threadsRepo, eventsRepo } from "@workbench/db";
import { readItemMd } from "@workbench/store";
import { createApproachPortImpl, type SessionBox } from "./approachPort.js";
import { buildBriefing, buildSinceLastTurn } from "./briefing.js";
import { checkpointCommit } from "./checkpoint.js";
import { conflict } from "./errors.js";
import { emitEvent, pushActivity, type EngagementContext } from "./engagementContext.js";
import { currentModelProfile } from "./profileService.js";
import { describeStageContext } from "./stageContext.js";
import { ensureThread } from "./threadService.js";

const LEASE_MS = 5 * 60 * 1000;
const LEASE_RENEW_MS = 60 * 1000;

/** Called once per engagement context (services.createEngagement, startup.reconcileEngagement) so other modules can pump the task queue without importing this module. */
export function wireApproachHooks(ctx: EngagementContext): void {
  ctx.pumpApproachTasks = () => pumpApproachTaskQueue(ctx);
}

function buildApproachObserver(ctx: EngagementContext, runId: RunId, threadId: ThreadId | null, scopeKey: string, sessionBox: SessionBox): RunObserver {
  const activityFile = ctx.paths.runActivity(runId);
  return {
    onActivity(item) {
      fs.mkdirSync(path.dirname(activityFile), { recursive: true });
      fs.appendFileSync(activityFile, `${JSON.stringify(item)}\n`, "utf8");
      pushActivity(ctx, runId, "ENG", item, threadId ?? undefined);
    },
    onSession(sessionId) {
      sessionBox.sessionId = sessionId;
      runsRepo.updateRunProgress(ctx.dbCtx, runId, { sessionId });
      leasesRepo.setSessionId(ctx.dbCtx, scopeKey, sessionId, Date.now());
    },
    onPid(pid) {
      leasesRepo.setPid(ctx.dbCtx, scopeKey, pid, Date.now());
    },
    onRead() {
      // Approach runs don't pin/consume declared inputs the way Work Agent runs do (I2 scope).
    },
  };
}

/** J2.1/J2.6/J2.7 — post a human message to T-0001, starting (or resuming) a conversation turn. 409 while a turn is already running. */
export async function postMessage(ctx: EngagementContext, threadId: ThreadId, text: string, context?: StageContext): Promise<PostMessageResult> {
  if (threadId !== "T-0001") throw conflict(`no such thread: ${threadId}`);
  const thread = ensureThread(ctx);
  const profile = currentModelProfile(ctx.server);

  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const messageId = nextMessageId(ctx.dbCtx);
  threadsRepo.insertChatMessage(ctx.dbCtx, { id: messageId, threadId: thread.id, role: "human", body: text, at: nowIso });
  emitEvent(ctx, { type: "ChatMessagePosted", actor: "human", payload: { threadId: thread.id, messageId, role: "human" } });

  const scopeKey = `aa-thread:${thread.id}`;
  const runId = nextRunId(ctx.dbCtx);
  const lease = leasesRepo.acquireLease(ctx.dbCtx, { scopeKey, role: "approach", holder: runId, leaseMs: LEASE_MS, now });
  if (!lease.acquired) throw conflict(`A turn is already running on ${thread.id}.`);

  const baseSituation = thread.sessionId == null ? buildBriefing(ctx) : buildSinceLastTurn(ctx, thread.lastSeenSeq);
  const situation = context ? `${baseSituation}

${describeStageContext(ctx, context)}` : baseSituation;

  runsRepo.createRun(ctx.dbCtx, {
    id: runId,
    itemId: "ENG",
    sessionId: thread.sessionId,
    reason: "aa-turn",
    runtime: ctx.approachRuntime.kind,
    model: profile.models.approach,
    promptHash: null,
    startedAt: nowIso,
  });
  emitEvent(ctx, { type: "RunStarted", actor: "human", payload: { runId, itemId: "ENG", reason: "aa-turn", model: profile.models.approach, threadId: thread.id } });

  const sessionBox: SessionBox = { sessionId: thread.sessionId };
  const port = createApproachPortImpl(ctx, runId, "conversation", thread.id, null, sessionBox);
  const observer = buildApproachObserver(ctx, runId, thread.id, scopeKey, sessionBox);

  const handle = ctx.approachRuntime.startTurn({
    runId,
    engagementId: ctx.id,
    paths: ctx.paths,
    workspace: ctx.workspace,
    port,
    observer,
    model: profile.models.approach,
    maxTurns: profile.limits.maxTurnsPerRun,
    settings: ctx.meta.settings,
    threadId: thread.id,
    resumeSessionId: thread.sessionId,
    situation,
    message: text,
  });

  ctx.approachRuns.set(runId, { runId, handle, kind: "conversation", threadId: thread.id, requestId: null });
  const renewTimer = setInterval(() => leasesRepo.renewLease(ctx.dbCtx, scopeKey, runId, LEASE_MS, Date.now()), LEASE_RENEW_MS);
  renewTimer.unref?.();

  handle.done
    .then((result) => onApproachRunEnd(ctx, runId, "conversation", thread.id, null, scopeKey, result))
    .catch((err: unknown) => {
      // eslint-disable-next-line no-console
      console.error(`approach run ${runId} (conversation) end handling failed:`, err);
    })
    .finally(() => clearInterval(renewTimer));

  return { messageId, runId };
}

async function launchApproachTask(ctx: EngagementContext, kind: "question" | "suggestion", requestId: RequestId, actor: Actor): Promise<void> {
  const request = requestsRepo.getRequest(ctx.dbCtx, requestId);
  if (!request || request.status !== "open") {
    pumpApproachTaskQueue(ctx); // stale queue entry (e.g. overridden/escalated before its turn) — try the next one
    return;
  }
  const item = readItemMd(ctx.paths.itemMd(request.itemId));
  const profile = currentModelProfile(ctx.server);

  const scopeKey = `aa-task:${requestId}`;
  const runId = nextRunId(ctx.dbCtx);
  const now = Date.now();
  const lease = leasesRepo.acquireLease(ctx.dbCtx, { scopeKey, role: "approach", holder: runId, leaseMs: LEASE_MS, now });
  if (!lease.acquired) return; // defensive: the queue pump already checked no task is running

  const situation = buildBriefing(ctx);
  runsRepo.createRun(ctx.dbCtx, {
    id: runId,
    itemId: "ENG",
    sessionId: null,
    reason: kind === "question" ? "aa-question" : "aa-suggestion",
    runtime: ctx.approachRuntime.kind,
    model: profile.models.approach,
    promptHash: null,
    startedAt: new Date(now).toISOString(),
  });
  emitEvent(ctx, { type: "RunStarted", actor, payload: { runId, itemId: "ENG", reason: kind === "question" ? "aa-question" : "aa-suggestion", model: profile.models.approach } });

  const sessionBox: SessionBox = { sessionId: null };
  const port = createApproachPortImpl(ctx, runId, kind, null, requestId, sessionBox);
  const observer = buildApproachObserver(ctx, runId, null, scopeKey, sessionBox);

  const handle = ctx.approachRuntime.startTask({
    runId,
    engagementId: ctx.id,
    paths: ctx.paths,
    workspace: ctx.workspace,
    port,
    observer,
    model: profile.models.approach,
    maxTurns: profile.limits.maxTurnsPerRun,
    settings: ctx.meta.settings,
    kind,
    request,
    item,
    situation,
  });

  ctx.approachRuns.set(runId, { runId, handle, kind, threadId: null, requestId });
  const renewTimer = setInterval(() => leasesRepo.renewLease(ctx.dbCtx, scopeKey, runId, LEASE_MS, Date.now()), LEASE_RENEW_MS);
  renewTimer.unref?.();

  handle.done
    .then((result) => onApproachRunEnd(ctx, runId, kind, null, requestId, scopeKey, result))
    .catch((err: unknown) => {
      // eslint-disable-next-line no-console
      console.error(`approach run ${runId} (${kind}) end handling failed:`, err);
    })
    .finally(() => clearInterval(renewTimer));
}

/** Starts the next queued task, but only once no task is running and the asking item's own run has ended (I2-PLAN §4.1). */
export function pumpApproachTaskQueue(ctx: EngagementContext): void {
  for (const r of ctx.approachRuns.values()) {
    if (r.kind === "question" || r.kind === "suggestion") return; // one task session at a time
  }

  while (ctx.approachTaskQueue.length > 0) {
    const next = ctx.approachTaskQueue[0]!;
    const request = requestsRepo.getRequest(ctx.dbCtx, next.requestId);
    if (!request || request.status !== "open") {
      ctx.approachTaskQueue.shift();
      continue;
    }
    if (ctx.activeRuns.has(request.itemId)) return; // the asking item is still running — wait for its run to end
    ctx.approachTaskQueue.shift();
    void launchApproachTask(ctx, next.kind, next.requestId, "system").catch((err: unknown) => {
      // eslint-disable-next-line no-console
      console.error(`approach task launch for ${next.requestId} failed:`, err);
    });
    return;
  }
}

async function onApproachRunEnd(
  ctx: EngagementContext,
  runId: RunId,
  kind: ApproachSessionKind,
  threadId: ThreadId | null,
  requestId: RequestId | null,
  scopeKey: string,
  result: RunResult,
): Promise<void> {
  const now = Date.now();
  leasesRepo.releaseLease(ctx.dbCtx, scopeKey, runId, now);
  ctx.approachRuns.delete(runId);

  runsRepo.finishRun(ctx.dbCtx, runId, {
    outcome: result.outcome,
    costUsd: result.costUsd,
    turns: result.turns,
    promptHash: result.promptHash,
    nudged: result.nudged,
    denials: result.denials,
    error: result.error,
    report: null,
    endedAt: new Date(now).toISOString(),
  });
  emitEvent(ctx, { type: "RunEnded", actor: "system", payload: { runId, itemId: "ENG", outcome: result.outcome, costUsd: result.costUsd, turns: result.turns, threadId: threadId ?? undefined } });

  if (kind === "conversation" && threadId) {
    if (result.sessionId) threadsRepo.setSessionId(ctx.dbCtx, threadId, result.sessionId);
    if (result.lastMessage.trim().length > 0) {
      const messageId = nextMessageId(ctx.dbCtx);
      threadsRepo.insertChatMessage(ctx.dbCtx, { id: messageId, threadId, role: "approach", body: result.lastMessage, at: new Date(now).toISOString(), runId });
      emitEvent(ctx, { type: "ChatMessagePosted", actor: "system", payload: { threadId, messageId, role: "approach" } });
    }
    threadsRepo.setLastSeenSeq(ctx.dbCtx, threadId, eventsRepo.latestSeq(ctx.dbCtx));
  }

  if ((kind === "question" || kind === "suggestion") && requestId) {
    const request = requestsRepo.getRequest(ctx.dbCtx, requestId);
    if (request?.status === "open") {
      const at = new Date(now).toISOString();
      if (kind === "question") {
        requestsRepo.setEscalation(ctx.dbCtx, requestId, { view: "The Approach Agent did not decide.", by: "system", at });
        emitEvent(ctx, { type: "QuestionEscalated", actor: "system", payload: { requestId, itemId: request.itemId } });
      } else {
        const reason = "The Approach Agent did not assess this suggestion.";
        requestsRepo.resolveRequest(ctx.dbCtx, requestId, "answered", { kind: "suggestion", outcome: "declined", proposalId: null, reason, by: "system", at }, at);
        emitEvent(ctx, { type: "SuggestionDeclined", actor: "system", payload: { requestId, itemId: request.itemId, reason } });
        const notificationId = nextNotificationId(ctx.dbCtx);
        notificationsRepo.createNotification(ctx.dbCtx, { id: notificationId, from: "system", text: `Suggestion ${requestId} from ${request.itemId} was not assessed: ${reason}`, itemId: request.itemId, requestId, createdAt: at });
        emitEvent(ctx, { type: "HumanNotified", actor: "system", payload: { notificationId, text: `Suggestion ${requestId} was not assessed.` } });
      }
    }
  }

  await checkpointCommit(ctx, { message: `Approach run ${runId} ended (${result.outcome})`, actor: "system", trailers: { "Workbench-Event": "RunEnded", "Workbench-Run": runId } });

  pumpApproachTaskQueue(ctx);
}
