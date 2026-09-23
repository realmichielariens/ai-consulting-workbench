// Append-only event log (events.ts EventBody/WorkbenchEvent). One DB file per
// engagement, so `engagementId` is not a column here — the caller (which
// already knows which engagement's DB it opened) supplies it when building
// the full WorkbenchEvent envelope.

import { gt, asc } from "drizzle-orm";
import { EventBody, WorkbenchEvent, type Actor, type EngagementId, type IsoTime } from "@workbench/core";
import type { Db } from "../client.js";
import { events } from "../schema.js";
import { toEpochMs, toIsoTime } from "../mappers.js";

export interface AppendEventInput {
  type: string;
  actor: Actor;
  payload: unknown;
  at: IsoTime;
}

/** Validates {type, payload} against EventBody before writing, then returns the full envelope (with the DB-assigned seq) via RETURNING. */
export function appendEvent(ctx: Db, engagementId: EngagementId, input: AppendEventInput): WorkbenchEvent {
  const body = EventBody.parse({ type: input.type, payload: input.payload });
  const row = ctx.sqlite
    .prepare(
      `INSERT INTO events (type, actor, payload, at) VALUES (@type, @actor, @payload, @at)
       RETURNING seq, type, actor, payload, at`,
    )
    .get({ type: body.type, actor: input.actor, payload: JSON.stringify(body.payload), at: toEpochMs(input.at) }) as {
    seq: number;
    type: string;
    actor: string;
    payload: string;
    at: number;
  };

  return WorkbenchEvent.parse({
    seq: row.seq,
    at: toIsoTime(row.at),
    actor: row.actor,
    engagementId,
    type: row.type,
    payload: JSON.parse(row.payload),
  });
}

/** Events with seq > sinceSeq, ascending (WsServerMessage "hello" + catch-up, api.ts). */
export function listSince(ctx: Db, engagementId: EngagementId, sinceSeq: number): WorkbenchEvent[] {
  return ctx.db
    .select()
    .from(events)
    .where(gt(events.seq, sinceSeq))
    .orderBy(asc(events.seq))
    .all()
    .map((row) =>
      WorkbenchEvent.parse({
        seq: row.seq,
        at: toIsoTime(row.at),
        actor: row.actor,
        engagementId,
        type: row.type,
        payload: JSON.parse(row.payload),
      }),
    );
}

export function latestSeq(ctx: Db): number {
  const row = ctx.sqlite.prepare("SELECT MAX(seq) AS seq FROM events").get() as { seq: number | null };
  return row.seq ?? 0;
}
