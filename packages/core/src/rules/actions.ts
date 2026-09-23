// What can be done to an item right now, and why not otherwise (api.ts
// ItemActions / Allowed). This keeps the rule out of the UI and the API
// routes (CLAUDE.md rule 12: "API routes contain no business logic") — W6
// only disables a button and shows `reason` as its tooltip.

import type { Allowed, ItemActions } from "../api.js";
import type { Executor, ItemStatus } from "../domain.js";
import { humanStatus } from "./lifecycle.js";

export interface ItemActionState {
  /** null = composite: no actions of its own. */
  executor: Executor | null;
  status: ItemStatus | null;
  /** True once a run/lease is active for this item (R6: refuses a second start). */
  hasActiveRun: boolean;
  /** The last run was interrupted and its session can be resumed (R1, R5). */
  resumable: boolean;
  /** Every required output slot has a published version (human items, J1.6). */
  allRequiredOutputsPublished: boolean;
}

const YES: Allowed = { allowed: true, reason: null };
const no = (reason: string): Allowed => ({ allowed: false, reason });

export function computeItemActions(state: ItemActionState): ItemActions {
  if (state.executor == null) {
    const reason = "Composite items have no actions of their own.";
    return { start: no(reason), stop: no(reason), resume: no(reason), markDone: no(reason), edit: no(reason), upload: no(reason) };
  }

  const isAgent = state.executor === "agent";
  const isHuman = state.executor === "human";
  const status = state.status;

  let start: Allowed;
  if (!isAgent) start = no("Only agent items are started; human items begin with an upload.");
  else if (state.hasActiveRun) start = no("This item is already running.");
  else if (state.resumable) start = no("This item has an interrupted run. Use Resume to continue it.");
  else if (status !== "ready") start = no(`Starting is only possible once the item is ready (it is ${humanStatus(status)}).`);
  else start = YES;

  let stop: Allowed;
  if (status !== "in_progress" || !state.hasActiveRun) stop = no("Stop is only possible while the item is running.");
  else stop = YES;

  let resume: Allowed;
  if (!isAgent) resume = no("Only agent items can be resumed.");
  else if (state.hasActiveRun) resume = no("This item is already running.");
  else if (!state.resumable) resume = no("There is no interrupted run to resume.");
  else resume = YES;

  let markDone: Allowed;
  if (!isHuman) markDone = no("Mark done applies only to human items.");
  else if (status !== "in_progress") markDone = no(`Mark done is only possible while the item is in progress (it is ${humanStatus(status)}).`);
  else if (!state.allRequiredOutputsPublished) markDone = no("Every required output slot needs a version before this item can be marked done.");
  else markDone = YES;

  let edit: Allowed;
  if (status === "waiting" || status === "ready") edit = YES;
  else {
    edit = no(
      `Editing is only possible before the item starts (it is ${humanStatus(status)}). ` +
        "Plan changes to running items arrive with the Approach Agent (I2).",
    );
  }

  let upload: Allowed;
  if (!isHuman) upload = no("Only human items accept uploads.");
  else if (status === "ready" || status === "in_progress") upload = YES;
  else upload = no(`Uploads are only possible while the item is ready or in progress (it is ${humanStatus(status)}).`);

  return { start, stop, resume, markDone, edit, upload };
}
