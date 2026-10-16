// The item lifecycle state machine for I1 (DESIGN.md §4.2, ARCHITECTURE.md §7.1).
//
// Only this module decides whether a requested status transition is legal
// (CLAUDE.md rule 12: "only the engine rules decide status transitions").
// Callers (server services) turn a tool call or a human action into one
// ItemEvent, call applyItemEvent, and persist `to` only when `ok` is true.
//
// Composite items and ENG have no status (null, DESIGN.md §4.2) and never
// reach this module; readiness.ts's initialStatus() reflects that. I1 does
// not reach:
//   - "draft": items start at "waiting" (there is no brief-approval step in
//     I1, see readiness.ts);
//   - "cancelled": no cancel operation exists before I2;
//   - "stale": recorded asset kind has no effect until I4 (DESIGN.md §5.2).
// Those stay in the ItemStatus enum (domain.ts) for forward compatibility,
// but are not part of the I1 transition table below.

import type { Executor, ItemStatus, RunOutcome } from "../domain.js";

export type ItemEvent =
  | { type: "inputs_ready" }
  | { type: "inputs_missing" }
  | { type: "start" }
  | { type: "run_ended"; outcome: RunOutcome }
  | { type: "question_answered" }
  | { type: "issue_retry" }
  | { type: "issue_stop" }
  | { type: "gate_approved" }
  | { type: "changes_requested" }
  | { type: "human_upload" }
  | { type: "mark_done" }
  | { type: "stop" }
  // I2:
  | { type: "cancel" }
  | { type: "answer_overridden" };

export type ItemEventType = ItemEvent["type"];

export interface ItemEventContext {
  /** Composites/ENG have no status and never reach applyItemEvent. */
  executor: Executor;
  /** Required for run_ended{outcome:"submitted"}: does the item have a (non-empty) gate chain? */
  hasGateChain?: boolean;
  /** Required for gate_approved: is this the last step in the chain? I1 chains have exactly one step, so always true. */
  isLastGateStep?: boolean;
  /** Required for mark_done: every required output slot has a published version. */
  allRequiredOutputsPublished?: boolean;
}

export type ItemTransitionResult = { ok: true; to: ItemStatus } | { ok: false; reason: string };

/** "in_progress" -> "in progress", for reasons shown to a non-developer. */
export function humanStatus(status: ItemStatus | null): string {
  return status === null ? "not applicable" : status.replace(/_/g, " ");
}

export function applyItemEvent(status: ItemStatus, event: ItemEvent, ctx: ItemEventContext): ItemTransitionResult {
  const deny = (reason: string): ItemTransitionResult => ({ ok: false, reason });
  const ok = (to: ItemStatus): ItemTransitionResult => ({ ok: true, to });

  switch (event.type) {
    case "inputs_ready":
      if (status !== "waiting") return deny(`Inputs became ready, but the item is ${humanStatus(status)}, not waiting.`);
      return ok("ready");

    case "inputs_missing":
      if (status !== "ready") return deny(`An input was withdrawn, but the item is ${humanStatus(status)}, not ready.`);
      return ok("waiting");

    case "start":
      if (ctx.executor !== "agent") return deny("Only agent items are started; human items begin with an upload.");
      if (status !== "ready") return deny(`Starting is only possible once the item is ready (it is ${humanStatus(status)}).`);
      return ok("in_progress");

    case "human_upload":
      if (ctx.executor !== "human") return deny("Only human items accept uploads.");
      if (status !== "ready" && status !== "in_progress") {
        return deny(`Uploading is only possible while the item is ready or in progress (it is ${humanStatus(status)}).`);
      }
      // Ready -> in_progress on the first upload (J1.6 step 2); further uploads
      // before Mark done keep the item in_progress.
      return ok("in_progress");

    case "mark_done":
      if (ctx.executor !== "human") return deny("Mark done applies only to human items.");
      if (status !== "in_progress") return deny(`Mark done is only possible while the item is in progress (it is ${humanStatus(status)}).`);
      if (!ctx.allRequiredOutputsPublished) return deny("Every required output slot needs a version before this item can be marked done.");
      return ok("done");

    case "run_ended": {
      if (status !== "in_progress") return deny(`A run ended, but the item is ${humanStatus(status)}, not in progress.`);
      const { outcome } = event;
      if (outcome === "completed") return deny("run_ended(completed) is an Approach Agent outcome; it carries no Work Agent item transition.");
      if (outcome === "submitted") return ok(ctx.hasGateChain ? "at_gate" : "done");
      if (outcome === "blocked") return ok("blocked"); // opens a blocking question request (J1.4)
      if (outcome === "no_submit" || outcome === "max_turns" || outcome === "error") return ok("blocked"); // opens a run_issue request (R3)
      // outcome === "interrupted": resumable, session kept (R1, R5)
      return ok("ready");
    }

    case "question_answered":
      if (status !== "blocked") return deny(`An answer arrived, but the item is ${humanStatus(status)}, not blocked.`);
      return ok("in_progress");

    case "issue_retry":
      if (status !== "blocked") return deny(`Retry only applies to a blocked item with an open run issue (it is ${humanStatus(status)}).`);
      return ok("in_progress");

    case "issue_stop":
      if (status !== "blocked") return deny(`Stop only applies to a blocked item with an open run issue (it is ${humanStatus(status)}).`);
      return ok("ready");

    case "gate_approved":
      if (status !== "at_gate") return deny(`A gate verdict arrived, but the item is ${humanStatus(status)}, not at gate.`);
      // Not the last step: the next step in the chain opens, item stays at_gate (arrives in I6; I1 chains have one step).
      return ok(ctx.isLastGateStep ? "done" : "at_gate");

    case "changes_requested":
      if (status !== "at_gate") return deny(`Changes were requested, but the item is ${humanStatus(status)}, not at gate.`);
      return ok("in_progress");

    case "stop":
      if (status !== "in_progress") return deny(`Stop is only possible while the item is in progress (it is ${humanStatus(status)}).`);
      return ok("ready"); // interrupt(); resumable, session kept (R5)

    case "cancel":
      if (status !== "waiting" && status !== "ready") {
        return deny(`Cancel is only possible while the item is waiting or ready (it is ${humanStatus(status)}).`);
      }
      return ok("cancelled");

    case "answer_overridden":
      if (status !== "ready" && status !== "at_gate") {
        return deny(`Override is only possible while the item is ready or at gate (it is ${humanStatus(status)}).`);
      }
      return ok("in_progress"); // launchRun(resume-answer) follows

    default: {
      const exhaustive: never = event;
      throw new Error(`unhandled item event: ${JSON.stringify(exhaustive)}`);
    }
  }
}
