// Domain events (ARCHITECTURE.md §9). Persisted to the `events` table, pushed to
// the UI over the WebSocket, and (from I5) evaluated by the Agenda Service.
// Run activity is NOT an event: it is high-volume and lives in the per-run
// activity file (see activity.ts and api.ts WsServerMessage).

import { z } from "zod";
import {
  Actor,
  EngagementId,
  IsoTime,
  ItemId,
  ItemStatus,
  RequestId,
  RequestType,
  RunId,
  RunOutcome,
  RunReason,
  SlotRef,
  SlotVersionRef,
  Version,
  VersionKind,
  GateVerdict,
} from "./domain.js";

const ev = <T extends string, P extends z.ZodType>(type: T, payload: P) =>
  z.object({ type: z.literal(type), payload });

export const EventBody = z.discriminatedUnion("type", [
  ev("EngagementCreated", z.object({ name: z.string(), seedId: z.string().nullable() })),
  ev(
    "ItemStatusChanged",
    z.object({ itemId: ItemId, from: ItemStatus.nullable(), to: ItemStatus, reason: z.string().optional() }),
  ),
  /** A human edit of an item definition (J1.7). */
  ev("ItemEdited", z.object({ itemId: ItemId, fields: z.array(z.string()) })),
  ev(
    "AssetPublished",
    z.object({ slot: SlotRef, version: Version, kind: VersionKind, author: Actor, runId: RunId.nullable() }),
  ),
  ev("WorklogAppended", z.object({ itemId: ItemId, entry: z.string() })),
  ev("RequestOpened", z.object({ requestId: RequestId, type: RequestType, itemId: ItemId, to: z.string() })),
  ev(
    "RequestResolved",
    z.object({ requestId: RequestId, type: RequestType, itemId: ItemId, summary: z.string() }),
  ),
  ev(
    "GateVerdictRecorded",
    z.object({ itemId: ItemId, requestId: RequestId, verdict: GateVerdict, versions: z.array(SlotVersionRef) }),
  ),
  ev("RunStarted", z.object({ runId: RunId, itemId: ItemId, reason: RunReason, model: z.string() })),
  ev(
    "RunEnded",
    z.object({ runId: RunId, itemId: ItemId, outcome: RunOutcome, costUsd: z.number(), turns: z.number().int() }),
  ),
  ev(
    "GuardDenied",
    z.object({ runId: RunId, itemId: ItemId, tool: z.string(), reason: z.string(), agentId: z.string().optional() }),
  ),
  /** Post-run Git audit (ARCHITECTURE.md §8.5 layer 5) found changes outside the item's work/. */
  ev("LocusViolation", z.object({ runId: RunId, itemId: ItemId, paths: z.array(z.string()), reverted: z.boolean() })),
  ev("CheckpointCommitted", z.object({ sha: z.string(), message: z.string() })),
  ev("FeedbackNoted", z.object({ note: z.string(), view: z.string(), itemId: ItemId.nullable() })),
]);
export type EventBody = z.infer<typeof EventBody>;
export type EventType = EventBody["type"];

export const WorkbenchEvent = z.intersection(
  z.object({
    /** Monotonic per engagement DB. */
    seq: z.number().int().positive(),
    at: IsoTime,
    actor: Actor,
    engagementId: EngagementId,
  }),
  EventBody,
);
export type WorkbenchEvent = z.infer<typeof WorkbenchEvent>;

/** Narrow a WorkbenchEvent by type: `EventOf<"AssetPublished">`. */
export type EventOf<T extends EventType> = WorkbenchEvent & { type: T };
