// Inbox query building block (I1-PLAN.md §6 W3): open requests addressed to
// the human (question, gate_request, run_issue) plus human items that are
// ready or in_progress. The server (W5) assembles the full InboxView
// (api.ts) from these two lists plus item titles, upload state, etc.

import type { Actor, Request } from "@workbench/core";
import type { Db } from "../client.js";
import { listOpenByRecipient } from "./requests.js";
import { listHumanReadyOrInProgress, type ItemRow } from "./items.js";

const INBOX_REQUEST_TYPES = ["question", "gate_request", "run_issue"] as const;

/** Open questions, reviews and run issues addressed to `to` (I1: always "human"). */
export function listInboxRequests(ctx: Db, to: Actor = "human"): Request[] {
  return listOpenByRecipient(ctx, to).filter((r) => (INBOX_REQUEST_TYPES as readonly string[]).includes(r.type));
}

/** Human items ready for input, or already being worked (J1.6). */
export function listInboxHumanItems(ctx: Db): ItemRow[] {
  return listHumanReadyOrInProgress(ctx);
}
