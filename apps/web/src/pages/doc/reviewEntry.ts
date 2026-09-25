// UX1 brief B §Build 3: the review bar is shown only when the Inbox has an
// open "review" entry whose submitted outputs cover this document's slot
// (plan §4.6 "Document (B)"). Pure so it's cheap to unit test.

import type { InboxEntry, InboxView } from "@workbench/core";

export type ReviewEntry = Extract<InboxEntry, { kind: "review" }>;

/** slotRef = "WI-004/themes" (matches shell/nav's openDoc convention). */
export function findReviewEntry(inbox: InboxView | undefined, slotRef: string): ReviewEntry | null {
  if (!inbox) return null;
  for (const entry of inbox.entries) {
    if (entry.kind !== "review") continue;
    if (entry.request.type !== "gate_request") continue;
    if (entry.request.payload.submitted.some((sv) => sv.slot === slotRef)) return entry;
  }
  return null;
}
