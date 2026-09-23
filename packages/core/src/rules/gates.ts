// Gate chain rules (DESIGN.md §8.2, ARCHITECTURE.md §7.5). I1 chains have a
// single human-review step, but this is written for chains of any length so
// I6 can add ai-review and endorsement steps without changing this module.
//
// A submission opens a *round*: round = previousRound + 1, step 0 open, the
// rest pending. J1.5's rule is that a verdict binds to the exact round (and
// therefore the exact asset versions) it was raised for — a verdict for a
// superseded round (a newer submission has since opened a later round) is
// rejected with a reason, never silently applied to the new round.

import type { GateStep, GateType, GateVerdict, SlotVersionRef } from "../domain.js";

export type GateStepStatus = "pending" | "open" | "passed" | "changes_requested";

export interface GateRoundStep {
  round: number;
  seq: number;
  type: GateType;
  status: GateStepStatus;
  /** The exact versions under review (J1.5): a verdict binds to these, not to "the latest". */
  assetVersions: SlotVersionRef[];
}

/**
 * submit_outputs (accepted by lifecycle.ts's run_ended{outcome:"submitted"})
 * opens the next round for the whole chain: step 0 "open", every later step
 * "pending". Any earlier round is assumed already closed by the caller
 * (either "passed" in full, or ended by a changes-requested verdict).
 */
export function openGateRound(chain: readonly GateStep[], previousRound: number, submitted: readonly SlotVersionRef[]): GateRoundStep[] {
  const round = previousRound + 1;
  return chain.map((step, seq) => ({
    round,
    seq,
    type: step.type,
    status: seq === 0 ? "open" : "pending",
    assetVersions: [...submitted],
  }));
}

export type GateVerdictResult =
  | { ok: true; stepStatus: "passed" | "changes_requested"; chainDone: boolean }
  | { ok: false; reason: string };

/**
 * Resolve a verdict against one step. `currentOpenRound` is the round the
 * item's gate chain currently has open (read from gate_steps); `isLastStep`
 * is `seq === chain.length - 1` (always true for I1's single-step chains).
 * `chainDone` tells the caller to fire lifecycle.ts's `gate_approved` with
 * `isLastGateStep: true`; a "passed" non-last step means the next step in
 * the chain opens (arrives in I6) and the item stays at_gate.
 */
export function resolveGateVerdict(
  step: GateRoundStep,
  currentOpenRound: number,
  verdict: GateVerdict,
  isLastStep: boolean,
): GateVerdictResult {
  if (step.status !== "open") {
    return { ok: false, reason: `This review step is "${step.status}", not open.` };
  }
  if (step.round !== currentOpenRound) {
    return {
      ok: false,
      reason: `A newer version has since been submitted (round ${currentOpenRound}). This review (round ${step.round}) can no longer be approved or rejected.`,
    };
  }
  if (verdict === "changes_requested") {
    return { ok: true, stepStatus: "changes_requested", chainDone: false };
  }
  return { ok: true, stepStatus: "passed", chainDone: isLastStep };
}
