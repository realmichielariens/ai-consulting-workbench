// The deterministic "situation" text handed to the Approach Agent (I2-PLAN
// §4.1, ports.ts ApproachTurnRequest/ApproachTaskRequest). No LLM involved:
// a new session gets the full briefing; a resumed conversation turn gets
// "Since your last turn:" plus at most 20 readable event lines.

import {
  humanStatus,
  type EngagementId,
  type ItemId,
  type ItemNode,
  type PlanView,
  type Request,
  type WorkbenchEvent,
} from "@workbench/core";
import { eventsRepo, proposalsRepo, requestsRepo } from "@workbench/db";
import { buildPlanView } from "./checkpoint.js";
import type { EngagementContext } from "./engagementContext.js";

const MAX_DEPTH = 2;

function orderedChildren(items: ItemNode[], parent: ItemId | null): ItemNode[] {
  return items.filter((i) => i.parent === parent).sort((a, b) => a.order - b.order);
}

function versionLabel(view: PlanView, ref: string): string {
  const slot = view.slots.find((s) => s.ref === ref);
  return slot?.latest ? `v${slot.latest.version}` : "not yet published";
}

function renderPlanAtDepth(view: PlanView): string[] {
  const lines: string[] = [];
  const walk = (item: ItemNode, depth: number) => {
    const indent = "  ".repeat(depth);
    if (item.kind === "task") {
      lines.push(`${indent}- ${item.id} ${item.title} (${item.executor}) — ${humanStatus(item.status)}`);
      if (item.inputs.length > 0) lines.push(`${indent}  inputs: ${item.inputs.map((i) => i.slot).join(", ")}`);
      if (item.outputs.length > 0) {
        lines.push(`${indent}  outputs: ${item.outputs.map((ref) => `${ref} (${versionLabel(view, ref)})`).join(", ")}`);
      }
      if (item.gate.length > 0) lines.push(`${indent}  gate: ${item.gate.map((g) => g.type).join(", ")}`);
    } else {
      const rollup = item.rollup;
      const summary = rollup && rollup.total > 0 ? ` (${rollup.done}/${rollup.total} done)` : "";
      lines.push(`${indent}- ${item.id} ${item.title}${summary}`);
    }
    if (depth >= MAX_DEPTH) return;
    for (const child of orderedChildren(view.items, item.id)) walk(child, depth + 1);
  };
  for (const root of orderedChildren(view.items, null)) walk(root, 0);
  return lines;
}

function requestSummary(r: Request): string {
  const routed = r.routedTo === "approach" ? " (routed to Approach)" : "";
  if (r.type === "question") return `${r.id} question on ${r.itemId}: ${r.payload.question}${routed}`;
  if (r.type === "gate_request") return `${r.id} review on ${r.itemId} (step ${r.payload.step})`;
  if (r.type === "run_issue") return `${r.id} run issue on ${r.itemId}: ${r.payload.reason}`;
  return `${r.id} suggestion from ${r.itemId}: ${r.payload.summary}`;
}

/** Full briefing for a brand-new Approach Agent session (a new conversation, or any task session). */
export function buildBriefing(ctx: EngagementContext): string {
  const view = buildPlanView(ctx);
  const lines: string[] = [];

  lines.push(`# ${ctx.meta.name}`);
  lines.push("");
  lines.push(
    `Settings: question handling = ${ctx.meta.settings.questionHandling}, item start = ${ctx.meta.settings.itemStart}, ` +
      `plan changes = ${ctx.meta.settings.planChanges}, read policy = ${ctx.meta.settings.readPolicy}.`,
  );
  lines.push(`Plan version: ${view.planVersion}.`);
  lines.push("");

  lines.push("## Plan");
  lines.push(...renderPlanAtDepth(view));
  lines.push("");

  const openRequests = requestsRepo.listOpenByRecipient(ctx.dbCtx, "human").concat(requestsRepo.listOpenByRecipient(ctx.dbCtx, "approach"));
  lines.push("## Open requests");
  if (openRequests.length === 0) lines.push("None.");
  else for (const r of openRequests) lines.push(`- ${requestSummary(r)}`);
  lines.push("");

  const pending = proposalsRepo.listPending(ctx.dbCtx);
  lines.push("## Pending proposals");
  if (pending.length === 0) lines.push("None.");
  else for (const p of pending) lines.push(`- ${p.id}: ${p.rationale} (${p.ops.length} op${p.ops.length === 1 ? "" : "s"})`);
  lines.push("");

  return lines.join("\n");
}

const MAX_SINCE_LINES = 20;

function readableEventLine(e: WorkbenchEvent): string | null {
  switch (e.type) {
    case "ItemStatusChanged":
      return `${e.payload.itemId} moved from ${humanStatus(e.payload.from)} to ${humanStatus(e.payload.to)}.`;
    case "AssetPublished":
      return `${e.payload.slot} published at v${e.payload.version} by ${e.payload.author}.`;
    case "RequestOpened":
      return `${e.payload.type} ${e.payload.requestId} opened on ${e.payload.itemId} (to ${e.payload.to}).`;
    case "RequestResolved":
      return `${e.payload.requestId} resolved: ${e.payload.summary}.`;
    case "GateVerdictRecorded":
      return `Gate verdict on ${e.payload.itemId}: ${e.payload.verdict}.`;
    case "ProposalCreated":
      return `Proposal ${e.payload.proposalId} created (${e.payload.opCount} ops).`;
    case "ProposalApplied":
      return `Proposal ${e.payload.proposalId} approved; plan is now v${e.payload.planVersion}.`;
    case "ProposalRejected":
      return `Proposal ${e.payload.proposalId} rejected: ${e.payload.reason}.`;
    case "QuestionRouted":
      return `${e.payload.requestId} on ${e.payload.itemId} was routed to ${e.payload.to}.`;
    case "QuestionEscalated":
      return `${e.payload.requestId} on ${e.payload.itemId} was escalated to the human.`;
    case "SuggestionDeclined":
      return `Suggestion ${e.payload.requestId} on ${e.payload.itemId} was declined: ${e.payload.reason}.`;
    case "RunEnded":
      return `Run ${e.payload.runId} on ${e.payload.itemId} ended (${e.payload.outcome}).`;
    default:
      return null; // low-signal events (RunStarted, WorklogAppended, CheckpointCommitted, GuardDenied, …) are left out of the digest
  }
}

/** "Since your last turn:" section for a resumed conversation, or "" if nothing happened. */
export function buildSinceLastTurn(ctx: EngagementContext, sinceSeq: number): string {
  const events = eventsRepo.listSince(ctx.dbCtx, ctx.id as EngagementId, sinceSeq);
  const lines = events.map(readableEventLine).filter((l): l is string => l != null).slice(0, MAX_SINCE_LINES);
  if (lines.length === 0) return "";
  return ["Since your last turn:", ...lines.map((l) => `- ${l}`)].join("\n");
}
