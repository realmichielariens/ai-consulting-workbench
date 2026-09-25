// Resolving a question's answer (J1.4, J2.3): shared by the human's own
// POST .../answer (services.ts) and the Approach Agent's answer_request
// (approachPort.ts) so the two paths can't drift apart (CLAUDE.md rule 12
// — only the engine rules decide the item transition this triggers).

import { applyItemEvent, type AnswerMode, type Request, type RequestId } from "@workbench/core";
import { itemsRepo, requestsRepo } from "@workbench/db";
import { appendWorklog } from "@workbench/store";
import { checkpointCommit } from "./checkpoint.js";
import { conflict, invalid, notFound } from "./errors.js";
import { emitEvent, type EngagementContext } from "./engagementContext.js";
import { launchRun } from "./runService.js";

/** Resolves an open question, applies `question_answered` if it was blocking, and resumes the item's run if there is one to resume. */
export async function resolveQuestionAnswer(
  ctx: EngagementContext,
  requestId: RequestId,
  mode: AnswerMode,
  text: string,
  by: "human" | `approach:${string}`,
): Promise<Request> {
  const request = requestsRepo.getRequest(ctx.dbCtx, requestId);
  if (!request) throw notFound(`no such request: ${requestId}`);
  if (request.type !== "question") throw invalid(`${requestId} is not a question`);
  if (request.status !== "open") throw conflict(`${requestId} is already ${request.status}`);

  const now = new Date().toISOString();
  const resolved = requestsRepo.resolveRequest(ctx.dbCtx, requestId, "answered", { kind: "answer", mode, text, by, at: now }, now);
  const label = by === "human" ? "Answered question" : "Answered by the Approach Agent";
  appendWorklog(ctx.paths, request.itemId, { actor: by, at: now, entry: `${label}: ${text}` });
  emitEvent(ctx, { type: "RequestResolved", actor: by, payload: { requestId, type: "question", itemId: request.itemId, summary: `Answered (${mode})` } });

  const row = itemsRepo.getItem(ctx.dbCtx, request.itemId);
  if (row?.status && row.executor === "agent") {
    if (request.blocking) {
      const t = applyItemEvent(row.status, { type: "question_answered" }, { executor: "agent" });
      if (t.ok) {
        itemsRepo.setStatus(ctx.dbCtx, request.itemId, t.to, Date.now());
        emitEvent(ctx, { type: "ItemStatusChanged", actor: by, payload: { itemId: request.itemId, from: row.status, to: t.to } });
      }
      if (row.lastSessionId) {
        await launchRun(ctx, request.itemId, "resume-answer", { reason: "resume-answer", requestId, question: request.payload.question, mode, answer: text, answeredBy: by }, row.lastSessionId, by);
      }
    } else if ((mode === "amend" || mode === "replace") && row.status === "ready" && row.lastSessionId) {
      // Non-blocking question, answer changed after the fact: re-open if the item isn't running.
      await launchRun(ctx, request.itemId, "resume-answer", { reason: "resume-answer", requestId, question: request.payload.question, mode, answer: text, answeredBy: by }, row.lastSessionId, by);
    }
  }

  await checkpointCommit(ctx, { message: `Answer ${requestId} (${mode})`, actor: by });
  return resolved;
}
