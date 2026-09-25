// Requests between actors (ARCHITECTURE.md §9, domain.ts Request). I1 has
// three types (question, gate_request, run_issue); each carries its own
// payload shape, validated against the matching Zod schema on both write and
// read so a corrupt or hand-edited JSON column fails loudly.

import { and, eq } from "drizzle-orm";
import {
  Escalation,
  GateRequestPayload,
  QuestionPayload,
  Request,
  RequestResponse,
  RunIssuePayload,
  SuggestionPayload,
  type Actor,
  type Escalation as EscalationT,
  type IsoTime,
  type ItemId,
  type RequestId,
  type RequestStatus,
  type RequestType,
  type RunId,
} from "@workbench/core";
import type { Db } from "../client.js";
import { requests } from "../schema.js";
import { parseJsonColumn, toEpochMs, toIsoTime, toJsonColumn } from "../mappers.js";

const payloadSchemaFor = (type: RequestType) => {
  switch (type) {
    case "question":
      return QuestionPayload;
    case "gate_request":
      return GateRequestPayload;
    case "run_issue":
      return RunIssuePayload;
    case "proposal":
      return SuggestionPayload;
    default:
      throw new Error(`requests repository: unsupported request type "${type}" in I2`);
  }
};

function mapRow(row: typeof requests.$inferSelect): Request {
  const type = row.type as RequestType;
  // payloadSchemaFor's return type is a union of three different Zod object
  // schemas (picked at runtime by `type`), so it does not fit
  // parseJsonColumn's single-T generic; Request.parse below re-validates and
  // narrows the whole object by its discriminant anyway.
  let payloadJson: unknown;
  try {
    payloadJson = JSON.parse(row.payload);
  } catch (err) {
    throw new Error(`corrupt JSON in column "payload": ${(err as Error).message}`);
  }
  const payload: unknown = payloadSchemaFor(type).parse(payloadJson);
  const response = row.response == null ? null : parseJsonColumn("response", row.response, RequestResponse);
  const escalation = row.escalation == null ? null : parseJsonColumn("escalation", row.escalation, Escalation);
  return Request.parse({
    id: row.id,
    type,
    from: row.fromActor,
    to: row.toActor,
    routedTo: row.routedTo,
    escalation,
    itemId: row.itemId,
    runId: row.runId,
    status: row.status,
    blocking: row.blocking,
    payload,
    response,
    createdAt: toIsoTime(row.createdAt),
    resolvedAt: row.resolvedAt == null ? null : toIsoTime(row.resolvedAt),
  });
}

export interface CreateRequestInput {
  id: RequestId;
  type: RequestType;
  from: Actor;
  to: Actor | "approach";
  itemId: ItemId;
  runId: RunId | null;
  blocking: boolean;
  payload: unknown;
  createdAt: IsoTime;
  /** Where the request was first routed (I2 question routing, D3); defaults to "human" (I1 behaviour). */
  routedTo?: "approach" | "human";
}

export function createRequest(ctx: Db, input: CreateRequestInput): Request {
  const payload = payloadSchemaFor(input.type).parse(input.payload);
  ctx.db
    .insert(requests)
    .values({
      id: input.id,
      type: input.type,
      fromActor: input.from,
      toActor: input.to,
      itemId: input.itemId,
      runId: input.runId,
      status: "open",
      blocking: input.blocking,
      payload: JSON.stringify(payload),
      response: null,
      agendaId: null,
      threadId: null,
      routedTo: input.routedTo ?? "human",
      escalation: null,
      createdAt: toEpochMs(input.createdAt),
      resolvedAt: null,
    })
    .run();
  const row = getRequest(ctx, input.id);
  if (!row) throw new Error(`createRequest: row for ${input.id} vanished after insert`);
  return row;
}

/** Moves the current addressee (J2.3/J2.4 handoffs). Does not touch `routedTo`, which records the *first* routing. */
export function setAddressee(ctx: Db, id: RequestId, to: Actor | "approach"): void {
  ctx.db.update(requests).set({ toActor: to }).where(eq(requests.id, id)).run();
}

/** The Approach Agent hands a question to the human (J2.4): addressee -> human, escalation recorded, request stays open. */
export function setEscalation(ctx: Db, id: RequestId, escalation: EscalationT): Request {
  ctx.db
    .update(requests)
    .set({ toActor: "human", escalation: toJsonColumn(escalation, Escalation) })
    .where(eq(requests.id, id))
    .run();
  const row = getRequest(ctx, id);
  if (!row) throw new Error(`setEscalation: no such request ${id}`);
  return row;
}

/** J2.3 override: withdraws an open gate_request (its round is being redone via a resumed run), so it drops off the Inbox review list. */
export function withdrawRequest(ctx: Db, id: RequestId, resolvedAt: IsoTime): Request {
  ctx.db.update(requests).set({ status: "withdrawn", resolvedAt: toEpochMs(resolvedAt) }).where(eq(requests.id, id)).run();
  const row = getRequest(ctx, id);
  if (!row) throw new Error(`withdrawRequest: no such request ${id}`);
  return row;
}

/** J2.3 override: replaces an already-resolved response (kept "answered") with the human's own, e.g. after the Approach Agent answered. */
export function replaceResponse(ctx: Db, id: RequestId, response: RequestResponse, resolvedAt: IsoTime): Request {
  ctx.db
    .update(requests)
    .set({ response: toJsonColumn(response, RequestResponse), resolvedAt: toEpochMs(resolvedAt) })
    .where(eq(requests.id, id))
    .run();
  const row = getRequest(ctx, id);
  if (!row) throw new Error(`replaceResponse: no such request ${id}`);
  return row;
}

export function getRequest(ctx: Db, id: RequestId): Request | null {
  const row = ctx.db.select().from(requests).where(eq(requests.id, id)).get();
  return row ? mapRow(row) : null;
}

export function listByItem(ctx: Db, itemId: ItemId): Request[] {
  return ctx.db.select().from(requests).where(eq(requests.itemId, itemId)).all().map(mapRow);
}

/** Open questions/gate_requests/run_issues addressed to `to` (I1: always "human"). */
export function listOpenByRecipient(ctx: Db, to: Actor | "approach"): Request[] {
  return ctx.db
    .select()
    .from(requests)
    .where(and(eq(requests.status, "open"), eq(requests.toActor, to)))
    .all()
    .map(mapRow);
}

export function resolveRequest(ctx: Db, id: RequestId, status: RequestStatus, response: RequestResponse, resolvedAt: IsoTime): Request {
  ctx.db
    .update(requests)
    .set({ status, response: toJsonColumn(response, RequestResponse), resolvedAt: toEpochMs(resolvedAt) })
    .where(eq(requests.id, id))
    .run();
  const row = getRequest(ctx, id);
  if (!row) throw new Error(`resolveRequest: no such request ${id}`);
  return row;
}
