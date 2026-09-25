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
  MessageId,
  NotificationId,
  ProposalId,
  ProposalOrigin,
  ChatRole,
  ThreadId,
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
  /** Approach Agent runs carry itemId "ENG"; conversation turns also carry their threadId. */
  ev("RunStarted", z.object({ runId: RunId, itemId: ItemId, reason: RunReason, model: z.string(), threadId: ThreadId.optional() })),
  ev(
    "RunEnded",
    z.object({
      runId: RunId,
      itemId: ItemId,
      outcome: RunOutcome,
      costUsd: z.number(),
      turns: z.number().int(),
      threadId: ThreadId.optional(),
    }),
  ),
  ev(
    "GuardDenied",
    z.object({ runId: RunId, itemId: ItemId, tool: z.string(), reason: z.string(), agentId: z.string().optional() }),
  ),
  /** Post-run Git audit (ARCHITECTURE.md §8.5 layer 5) found changes outside the item's work/. */
  ev("LocusViolation", z.object({ runId: RunId, itemId: ItemId, paths: z.array(z.string()), reverted: z.boolean() })),
  ev("CheckpointCommitted", z.object({ sha: z.string(), message: z.string() })),
  ev("FeedbackNoted", z.object({ note: z.string(), view: z.string(), itemId: ItemId.nullable() })),

  // I2: proposals and plan changes
  ev(
    "ProposalCreated",
    z.object({
      proposalId: ProposalId,
      origin: ProposalOrigin,
      suggestedBy: ItemId.nullable(),
      threadId: ThreadId.nullable(),
      opCount: z.number().int(),
    }),
  ),
  ev("ProposalApplied", z.object({ proposalId: ProposalId, planVersion: z.number().int() })),
  ev("ProposalRejected", z.object({ proposalId: ProposalId, reason: z.string() })),
  ev("ProposalSuperseded", z.object({ proposalId: ProposalId, by: ProposalId })),
  /** Every plan-version bump: an applied proposal, or a human edit of a brief (J1.7). */
  ev(
    "PlanChanged",
    z.object({ planVersion: z.number().int(), cause: z.enum(["proposal", "edit"]), proposalId: ProposalId.nullable() }),
  ),

  // I2: conversation, routing, notifications, settings, journal
  ev("ChatMessagePosted", z.object({ threadId: ThreadId, messageId: MessageId, role: ChatRole })),
  ev("QuestionRouted", z.object({ requestId: RequestId, itemId: ItemId, to: z.enum(["approach", "human"]) })),
  ev("QuestionEscalated", z.object({ requestId: RequestId, itemId: ItemId })),
  ev("SuggestionDeclined", z.object({ requestId: RequestId, itemId: ItemId, reason: z.string() })),
  ev("HumanNotified", z.object({ notificationId: NotificationId, text: z.string() })),
  ev("NotificationDismissed", z.object({ notificationId: NotificationId })),
  /** Only the changed keys. */
  ev("SettingsChanged", z.object({ changes: z.record(z.string(), z.string()) })),
  ev("JournalAppended", z.object({ entry: z.string() })),
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
