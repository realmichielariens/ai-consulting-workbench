// J2.3/D3 question routing: "always-human" behaves exactly like I1;
// "aa-first" (the default, domain.ts Settings) sends the request to the
// Approach Agent first and gives it an agenda row and a spot in the
// one-at-a-time task queue (approachRunner.ts's ctx.pumpApproachTasks hook).

import { type Actor, type Request, type RequestId } from "@workbench/core";
import { agendaRepo, nextAgendaId } from "@workbench/db";
import { emitEvent, type EngagementContext } from "./engagementContext.js";

export interface Routing {
  to: Actor | "approach";
  routedTo: "approach" | "human";
}

/** Where a newly raised question should go, per Settings.questionHandling (D3). Suggestions always go to "approach" (workPort.proposePlanChange doesn't call this). */
export function questionRoutingFor(ctx: EngagementContext): Routing {
  if (ctx.meta.settings.questionHandling === "aa-first") return { to: "approach", routedTo: "approach" };
  return { to: "human", routedTo: "human" };
}

function summaryOf(request: Request): string {
  if (request.type === "question") return request.payload.question;
  if (request.type === "proposal") return request.payload.summary;
  return request.type;
}

/** Gives a request routed to "approach" an agenda row and enqueues its task session. Called right after the request is created. */
export function routeToApproach(ctx: EngagementContext, request: Request, kind: "question" | "suggestion"): void {
  const agendaId = nextAgendaId(ctx.dbCtx);
  agendaRepo.createAgendaItem(ctx.dbCtx, {
    id: agendaId,
    kind: kind === "question" ? "question" : "proposal",
    title: `${request.itemId}: ${summaryOf(request)}`,
    status: "open",
    links: { items: [request.itemId], requests: [request.id] },
    createdAt: request.createdAt,
  });
  if (kind === "question") {
    emitEvent(ctx, { type: "QuestionRouted", actor: "system", payload: { requestId: request.id, itemId: request.itemId, to: "approach" } });
  }
  enqueueTask(ctx, kind, request.id);
}

export function enqueueTask(ctx: EngagementContext, kind: "question" | "suggestion", requestId: RequestId): void {
  ctx.approachTaskQueue.push({ kind, requestId });
  ctx.pumpApproachTasks?.();
}
