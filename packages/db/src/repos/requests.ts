// Requests between actors (ARCHITECTURE.md §9, domain.ts Request). I1 has
// three types (question, gate_request, run_issue); each carries its own
// payload shape, validated against the matching Zod schema on both write and
// read so a corrupt or hand-edited JSON column fails loudly.

import { and, eq } from "drizzle-orm";
import {
  GateRequestPayload,
  QuestionPayload,
  Request,
  RequestResponse,
  RunIssuePayload,
  type Actor,
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
    default:
      throw new Error(`requests repository: unsupported request type "${type}" in I1`);
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
  return Request.parse({
    id: row.id,
    type,
    from: row.fromActor,
    to: row.toActor,
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
      createdAt: toEpochMs(input.createdAt),
      resolvedAt: null,
    })
    .run();
  const row = getRequest(ctx, input.id);
  if (!row) throw new Error(`createRequest: row for ${input.id} vanished after insert`);
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
