// Run termination (ARCHITECTURE.md §8.2): the engine, not the agent, decides how a
// run ended, from the tool calls made during it. The runtime (W1) calls this after
// each SDK result; "nudge" means: resume the same session once with NUDGE_MESSAGE.

import type { RunOutcome } from "./domain.js";

export interface TerminationInput {
  /** The human stopped the run, or the server is shutting down. */
  interrupted: boolean;
  /** SDK result subtype: "success", "error_max_turns", "error_during_execution", … */
  resultSubtype: string | null;
  /** SDK result is_error (can be true with subtype "success", M0 harness note). */
  isError: boolean;
  /** submit_outputs was called and accepted during this run. */
  submitted: boolean;
  /** A blocking raise_question was recorded during this run. */
  openBlockingQuestion: boolean;
  /** Nudges already sent in this run (the limit is one). */
  nudgesUsed: number;
}

export type TerminationDecision = { action: "end"; outcome: RunOutcome } | { action: "nudge"; message: string };

export const MAX_NUDGES = 1;

export const NUDGE_MESSAGE =
  "Your turn ended without calling submit_outputs or raising a blocking question. " +
  "If your outputs are published and meet the acceptance criteria, call submit_outputs now. " +
  "If you cannot continue without an answer, call raise_question with blocking=true and your hypothesis. " +
  "Then end your turn.";

export function decideRunTermination(i: TerminationInput): TerminationDecision {
  if (i.interrupted) return { action: "end", outcome: "interrupted" };
  if (i.submitted) return { action: "end", outcome: "submitted" };
  if (i.openBlockingQuestion) return { action: "end", outcome: "blocked" };
  if (i.resultSubtype === "error_max_turns") return { action: "end", outcome: "max_turns" };
  if (i.isError || (i.resultSubtype !== null && i.resultSubtype !== "success")) return { action: "end", outcome: "error" };
  if (i.nudgesUsed < MAX_NUDGES) return { action: "nudge", message: NUDGE_MESSAGE };
  return { action: "end", outcome: "no_submit" };
}
