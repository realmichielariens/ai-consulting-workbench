// EXHIBIT §7.3: shared helpers for the decision-card variants — kept
// data-testid suffixes (plan §4.6, "inbox-card-<kind>"), the React list key,
// and a short "N min"/"N h"/"N d" age string for the kicker.

import type { InboxEntry } from "@workbench/core";

/** kind -> the exact suffix the old Inbox.tsx used (human_item/run_issue keep their hyphenated form). */
export function kindTestId(kind: InboxEntry["kind"]): string {
  switch (kind) {
    case "human_item":
      return "human-item";
    case "run_issue":
      return "run-issue";
    default:
      return kind;
  }
}

export function entryKey(entry: InboxEntry): string {
  switch (entry.kind) {
    case "human_item":
      return `human_item:${entry.item.id}`;
    case "proposal":
      return `proposal:${entry.proposal.proposal.id}`;
    case "fyi":
      return `fyi:${entry.notification.id}`;
    default:
      return `${entry.kind}:${entry.request.id}`;
  }
}

/** A compact age string for the kicker ("12 min", "3 h", "2 d"), from an ISO timestamp to now. */
export function ageLabel(iso: string, now: Date = new Date()): string {
  const ms = Math.max(0, now.getTime() - new Date(iso).getTime());
  const min = Math.round(ms / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h`;
  const d = Math.round(h / 24);
  return `${d} d`;
}
