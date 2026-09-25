// The real ApproachPort (ports.ts, I2-PLAN §4.1/§4.2), bound to one Approach
// Agent run. Like workPort.ts, this is the ONLY place `plan` tool calls turn
// into file writes and DB rows. `kind`/`threadId`/`requestId` gate which
// tools are legal in this session (answer_request/escalate: question only;
// decline_suggestion: suggestion only), matching CLAUDE.md rule 12.

import path from "node:path";
import fs from "node:fs";
import {
  applyOps,
  nextVersion,
  slotRef as makeSlotRef,
  validateOps,
  WorkPortError,
  type AnswerRequestInput,
  type ApproachPort,
  type ApproachSessionKind,
  type DeclineSuggestionInput,
  type EscalateInput,
  type GetItemInput,
  type ItemDigest,
  type ItemId,
  type ItemStatus,
  type JournalAppendInput,
  type NotifyHumanInput,
  type PlanDigest,
  type PlanToolAck,
  type ProposeOpsInput,
  type ProposeOpsResult,
  type PublishAssetResult,
  type PublishEngagementAssetInput,
  type RequestId,
  type RunId,
  type ThreadId,
} from "@workbench/core";
import { isInside } from "@workbench/core/node";
import { assetVersionsRepo, itemsRepo, nextMessageId, nextNotificationId, nextProposalId, notificationsRepo, proposalsRepo, requestsRepo, threadsRepo } from "@workbench/db";
import { appendJournal, appendWorklog, readItemMd, writeVersionFile } from "@workbench/store";
import { buildBriefing } from "./briefing.js";
import { checkpointCommit } from "./checkpoint.js";
import { emitEvent, type EngagementContext } from "./engagementContext.js";
import { resolveQuestionAnswer } from "./questionAnswering.js";
import { syncPlanState } from "./scheduler.js";
import { ensureThread } from "./threadService.js";

/** Live holder for the run's session id: set by the RunObserver.onSession callback, read here for attribution ("approach:<sessionId or runId>"). */
export interface SessionBox {
  sessionId: string | null;
}

function authorOf(runId: RunId, sessionBox: SessionBox): `approach:${string}` {
  return `approach:${sessionBox.sessionId ?? runId}`;
}

function itemIdOfRequest(ctx: EngagementContext, requestId: RequestId): ItemId {
  return requestsRepo.getRequest(ctx.dbCtx, requestId)?.itemId ?? ("ENG" as ItemId);
}

function requestSummaryFor(r: { type: string; payload: unknown }): string {
  if (r.type === "question") return (r.payload as { question: string }).question;
  if (r.type === "proposal") return (r.payload as { summary: string }).summary;
  return r.type;
}

/** PH ids are single-digit ("PH-3"), WI ids are zero-padded to 3 ("WI-005"); both default from zero on a blank plan (get_plan example, ports.ts). */
function suggestedNextIds(ctx: EngagementContext): string[] {
  const rows = itemsRepo.listItems(ctx.dbCtx);
  const maxOf = (prefix: string) =>
    rows.reduce((max, r) => {
      const m = new RegExp(`^${prefix}-(\\d+)`).exec(r.id);
      return m ? Math.max(max, Number(m[1])) : max;
    }, 0);
  return [`PH-${maxOf("PH") + 1}`, `WI-${String(maxOf("WI") + 1).padStart(3, "0")}`];
}

export function createApproachPortImpl(
  ctx: EngagementContext,
  runId: RunId,
  kind: ApproachSessionKind,
  threadId: ThreadId | null,
  requestId: RequestId | null,
  sessionBox: SessionBox,
): ApproachPort {
  const now = () => new Date().toISOString();

  const requireKind = (expected: ApproachSessionKind, forRequestId: RequestId): void => {
    if (kind !== expected || requestId !== forRequestId) {
      throw new WorkPortError("not_allowed", `this tool is only available in a "${expected}" session for its own request.`);
    }
  };

  /** Proposals always surface in the conversation thread (T-0001), even a suggestion task's (no thread of its own). */
  const homeThreadId = (): ThreadId => threadId ?? ensureThread(ctx).id;

  return {
    runId,
    kind,
    threadId,
    requestId,

    async getPlan(): Promise<PlanDigest> {
      return { planVersion: ctx.meta.planVersion, text: buildBriefing(ctx), suggestedNextIds: suggestedNextIds(ctx) };
    },

    async getItem(input: GetItemInput): Promise<ItemDigest> {
      const row = itemsRepo.getItem(ctx.dbCtx, input.itemId);
      if (!row) throw new WorkPortError("not_found", `no such item: ${input.itemId}`);
      const def = readItemMd(ctx.paths.itemMd(input.itemId));
      const outputs = itemsRepo.listOutputs(ctx.dbCtx, input.itemId).map((o) => ({
        slot: o.slotRef,
        latestVersion: assetVersionsRepo.latestVersion(ctx.dbCtx, o.slotRef)?.version ?? null,
      }));
      const openRequests = requestsRepo
        .listByItem(ctx.dbCtx, input.itemId)
        .filter((r) => r.status === "open")
        .map((r) => ({ id: r.id, type: r.type, summary: requestSummaryFor(r) }));
      return { def, status: row.status, outputs, openRequests };
    },

    async proposeOps(input: ProposeOpsInput): Promise<ProposeOpsResult> {
      const rows = itemsRepo.listItems(ctx.dbCtx);
      const defs = rows.map((r) => readItemMd(ctx.paths.itemMd(r.id)));
      const statusById = new Map<ItemId, ItemStatus | null>(rows.map((r) => [r.id, r.status]));
      const slotsWithVersions = assetVersionsRepo.publishedSlots(ctx.dbCtx);
      const errors = validateOps({ defs, statusById, slotsWithVersions }, input.ops);
      if (errors.length > 0) {
        return { ok: false, proposalId: null, superseded: null, errors, instruction: "Fix the errors above and call propose_ops again." };
      }
      applyOps(defs, input.ops); // sanity: an already-validated ops list must apply cleanly

      const proposalId = nextProposalId(ctx.dbCtx);
      const at = now();
      const author = authorOf(runId, sessionBox);
      const suggestedBy = kind === "suggestion" && requestId ? itemIdOfRequest(ctx, requestId) : null;
      const superseded = kind === "conversation" && threadId ? proposalsRepo.findPendingByThread(ctx.dbCtx, threadId) : null;

      proposalsRepo.createProposal(ctx.dbCtx, {
        id: proposalId,
        origin: kind === "suggestion" ? "suggestion" : "conversation",
        suggestedBy,
        requestId: kind === "suggestion" ? requestId : null,
        threadId: kind === "conversation" ? threadId : null,
        author,
        basePlanVersion: ctx.meta.planVersion,
        rationale: input.rationale,
        ops: input.ops,
        createdAt: at,
      });
      emitEvent(ctx, {
        type: "ProposalCreated",
        actor: author,
        payload: { proposalId, origin: kind === "suggestion" ? "suggestion" : "conversation", suggestedBy, threadId: kind === "conversation" ? threadId : null, opCount: input.ops.length },
      });

      if (superseded) {
        proposalsRepo.markSuperseded(ctx.dbCtx, superseded.id, proposalId, at);
        emitEvent(ctx, { type: "ProposalSuperseded", actor: author, payload: { proposalId: superseded.id, by: proposalId } });
      }

      const home = homeThreadId();
      const messageId = nextMessageId(ctx.dbCtx);
      threadsRepo.insertChatMessage(ctx.dbCtx, { id: messageId, threadId: home, role: "system", body: `Proposed a plan change: ${input.rationale}`, at, runId, proposalId });
      emitEvent(ctx, { type: "ChatMessagePosted", actor: author, payload: { threadId: home, messageId, role: "system" } });

      if (kind === "suggestion" && requestId) {
        requestsRepo.resolveRequest(ctx.dbCtx, requestId, "answered", { kind: "suggestion", outcome: "proposed", proposalId, reason: "", by: author, at }, at);
        emitEvent(ctx, { type: "RequestResolved", actor: author, payload: { requestId, type: "proposal", itemId: itemIdOfRequest(ctx, requestId), summary: `Proposed ${proposalId}` } });
      }

      await checkpointCommit(ctx, { message: `Propose ${proposalId}`, actor: author, trailers: { "Workbench-Event": "ProposalCreated" } });

      return { ok: true, proposalId, superseded: superseded?.id ?? null, errors: [], instruction: `Recorded ${proposalId}. Waiting on human approval.` };
    },

    async answerRequest(input: AnswerRequestInput): Promise<PlanToolAck> {
      requireKind("question", input.requestId);
      const author = authorOf(runId, sessionBox);
      // Shares the same resolve/transition/resume path as the human's own POST .../answer (services.answerQuestion).
      const resolved = await resolveQuestionAnswer(ctx, input.requestId, input.mode, input.text, author);

      const at = now();
      const notificationId = nextNotificationId(ctx.dbCtx);
      notificationsRepo.createNotification(ctx.dbCtx, {
        id: notificationId,
        from: author,
        text: `Answered ${resolved.itemId}'s question: ${input.text}`,
        itemId: resolved.itemId,
        requestId: input.requestId,
        createdAt: at,
      });
      emitEvent(ctx, { type: "HumanNotified", actor: author, payload: { notificationId, text: `Answered ${resolved.itemId}'s question.` } });

      return { instruction: "Answer recorded." };
    },

    async escalate(input: EscalateInput): Promise<PlanToolAck> {
      requireKind("question", input.requestId);
      const author = authorOf(runId, sessionBox);
      const at = now();
      const request = requestsRepo.getRequest(ctx.dbCtx, input.requestId);
      if (!request) throw new WorkPortError("not_found", `no such question: ${input.requestId}`);
      requestsRepo.setEscalation(ctx.dbCtx, input.requestId, { view: input.view, by: author, at });
      emitEvent(ctx, { type: "QuestionEscalated", actor: author, payload: { requestId: input.requestId, itemId: request.itemId } });
      await checkpointCommit(ctx, { message: `Escalated ${input.requestId}`, actor: author });
      return { instruction: "Escalated to the human." };
    },

    async declineSuggestion(input: DeclineSuggestionInput): Promise<PlanToolAck> {
      requireKind("suggestion", input.requestId);
      const author = authorOf(runId, sessionBox);
      const at = now();
      const request = requestsRepo.getRequest(ctx.dbCtx, input.requestId);
      if (!request) throw new WorkPortError("not_found", `no such suggestion: ${input.requestId}`);
      requestsRepo.resolveRequest(ctx.dbCtx, input.requestId, "answered", { kind: "suggestion", outcome: "declined", proposalId: null, reason: input.reason, by: author, at }, at);
      emitEvent(ctx, { type: "SuggestionDeclined", actor: author, payload: { requestId: input.requestId, itemId: request.itemId, reason: input.reason } });
      appendWorklog(ctx.paths, request.itemId, { actor: author, at, entry: `Suggestion declined by the Approach Agent: ${input.reason}` });
      await checkpointCommit(ctx, { message: `Declined suggestion ${input.requestId}`, actor: author });
      return { instruction: "Declined." };
    },

    async publishEngagementAsset(input: PublishEngagementAssetInput): Promise<PublishAssetResult> {
      const def = readItemMd(ctx.paths.itemMd("ENG"));
      const outputDef = def.outputs.find((o) => o.slot === input.slot);
      if (!outputDef) throw new WorkPortError("unknown_slot", `"${input.slot}" is not one of ENG's declared output slots.`);

      const workDir = ctx.paths.itemWork("ENG");
      const absSource = path.isAbsolute(input.sourcePath) ? input.sourcePath : path.join(workDir, input.sourcePath);
      if (!isInside(absSource, workDir)) throw new WorkPortError("outside_work", `"${input.sourcePath}" is not inside ENG's work/ folder.`);
      if (!fs.existsSync(absSource)) throw new WorkPortError("not_found", `"${input.sourcePath}" does not exist in work/.`);

      const slotRef = makeSlotRef("ENG", input.slot);
      const existing = assetVersionsRepo.listVersionParts(ctx.dbCtx, slotRef);
      const version = nextVersion(existing, input.kind);
      const relPath = writeVersionFile(ctx.paths, slotRef, version, outputDef.format, { fromFile: absSource });

      const [major, minor] = version.split(".").map(Number) as [number, number];
      const at = now();
      const author = authorOf(runId, sessionBox);
      assetVersionsRepo.insertAssetVersion(ctx.dbCtx, { slot: slotRef, version, major, minor, kind: existing.length === 0 ? "material" : input.kind, author, at, note: input.note, runId, path: relPath, format: outputDef.format });
      emitEvent(ctx, { type: "AssetPublished", actor: author, payload: { slot: slotRef, version, kind: input.kind, author, runId } });

      const home = homeThreadId();
      const messageId = nextMessageId(ctx.dbCtx);
      threadsRepo.insertChatMessage(ctx.dbCtx, { id: messageId, threadId: home, role: "system", body: `Published ${slotRef} v${version}`, at, runId, asset: { slot: slotRef, version } });
      emitEvent(ctx, { type: "ChatMessagePosted", actor: author, payload: { threadId: home, messageId, role: "system" } });

      syncPlanState(ctx);
      await checkpointCommit(ctx, { message: `Publish ${slotRef} v${version}`, actor: author, trailers: { "Workbench-Event": "AssetPublished", "Workbench-Run": runId } });

      return { slot: slotRef, version, path: relPath };
    },

    async journalAppend(input: JournalAppendInput): Promise<void> {
      const at = now();
      const author = authorOf(runId, sessionBox);
      appendJournal(ctx.paths, { actor: author, at, entry: input.entry });
      emitEvent(ctx, { type: "JournalAppended", actor: author, payload: { entry: input.entry } });
    },

    async notifyHuman(input: NotifyHumanInput): Promise<void> {
      const at = now();
      const author = authorOf(runId, sessionBox);
      const notificationId = nextNotificationId(ctx.dbCtx);
      notificationsRepo.createNotification(ctx.dbCtx, { id: notificationId, from: author, text: input.text, itemId: input.itemId ?? null, requestId: null, createdAt: at });
      emitEvent(ctx, { type: "HumanNotified", actor: author, payload: { notificationId, text: input.text } });
    },
  };
}
