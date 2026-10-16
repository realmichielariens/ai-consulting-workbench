// REDESIGN-PLAN §6.3 "Needs you · by consequence": the server-ordered Inbox
// list, FYIs collapsed into one expandable row, plus the Brief's J/K/A/E/R/
// Enter keyboard (plan §Build 2, EXHIBIT §7.3/§9). Server order is never
// re-sorted here (brief C's read-only note on api.ts).

import { useRef, useState } from "react";
import type { EngagementId, InboxEntry } from "@workbench/core";
import { openDoc, openItem, openPlan } from "../../shell/nav.js";
import { useShortcut } from "../../shell/shortcuts.js";
import { useInboxMutations } from "./useInboxMutations.js";
import { entryKey } from "./ids.js";
import { QuestionCard } from "./QuestionCard.js";
import { ReviewCard } from "./ReviewCard.js";
import { HumanItemCard } from "./HumanItemCard.js";
import { RunIssueCard } from "./RunIssueCard.js";
import { ProposalCard } from "./ProposalCard.js";
import { FyiCard } from "./FyiCard.js";
import "./DecisionCard.css";

function clickTestId(root: HTMLElement | null, testid: string): boolean {
  const el = root?.querySelector<HTMLButtonElement>(`[data-testid="${testid}"]`);
  if (!el || el.disabled) return false;
  el.click();
  return true;
}

function openEntry(eid: EngagementId, entry: InboxEntry): void {
  switch (entry.kind) {
    case "question":
    case "human_item":
    case "run_issue":
      openItem(eid, entry.item.id);
      return;
    case "review": {
      const first = entry.request.type === "gate_request" ? entry.request.payload.submitted[0] : undefined;
      if (first) openDoc(eid, first.slot, first.version);
      return;
    }
    case "proposal":
      openPlan(eid, { preview: entry.proposal.proposal.id });
      return;
    case "fyi":
      return;
  }
}

export function DecisionList({ eid, entries }: { eid: EngagementId; entries: InboxEntry[] }) {
  const m = useInboxMutations(eid);
  const [showFyis, setShowFyis] = useState(false);
  const [focusedIdx, setFocusedIdx] = useState(0);
  const refs = useRef<Record<number, HTMLLIElement | null>>({});

  const decisions = entries.filter((e): e is Exclude<InboxEntry, Extract<InboxEntry, { kind: "fyi" }>> => e.kind !== "fyi");
  const fyis = entries.filter((e): e is Extract<InboxEntry, { kind: "fyi" }> => e.kind === "fyi");
  const hasFocus = decisions.length > 0;
  const focused = decisions[Math.min(focusedIdx, decisions.length - 1)];

  useShortcut("j", () => setFocusedIdx((i) => Math.min(decisions.length - 1, i + 1)), { when: hasFocus });
  useShortcut("k", () => setFocusedIdx((i) => Math.max(0, i - 1)), { when: hasFocus });
  useShortcut(
    "a",
    () => {
      const root = refs.current[Math.min(focusedIdx, decisions.length - 1)] ?? null;
      clickTestId(root, "question-approve") || clickTestId(root, "proposal-approve");
    },
    { when: hasFocus },
  );
  useShortcut("e", () => clickTestId(refs.current[Math.min(focusedIdx, decisions.length - 1)] ?? null, "question-amend-open"), { when: hasFocus });
  useShortcut("r", () => clickTestId(refs.current[Math.min(focusedIdx, decisions.length - 1)] ?? null, "question-replace-open"), { when: hasFocus });
  useShortcut("enter", () => focused && openEntry(eid, focused), { when: hasFocus });

  if (entries.length === 0) {
    return (
      <p className="muted" data-testid="inbox-empty">
        Nothing waiting.
      </p>
    );
  }

  return (
    <ul className="inbox-list" data-testid="inbox-list">
      {decisions.map((entry, i) => (
        <li
          key={entryKey(entry)}
          ref={(el) => {
            refs.current[i] = el;
          }}
          className={i === focusedIdx ? "decision-item decision-item-focused" : "decision-item"}
        >
          <DecisionCardFor eid={eid} entry={entry} m={m} />
        </li>
      ))}
      {fyis.length > 0 && (
        <li className="fyi-updates">
          <button type="button" className="fyi-updates-toggle" data-testid="fyi-updates-toggle" onClick={() => setShowFyis((v) => !v)}>
            {showFyis ? "Hide updates" : `${fyis.length} update${fyis.length === 1 ? "" : "s"}`}
          </button>
          {showFyis && fyis.map((entry) => <FyiCard key={entryKey(entry)} eid={eid} entry={entry} m={m} />)}
        </li>
      )}
    </ul>
  );
}

function DecisionCardFor({ eid, entry, m }: { eid: EngagementId; entry: InboxEntry; m: ReturnType<typeof useInboxMutations> }) {
  switch (entry.kind) {
    case "question":
      return <QuestionCard eid={eid} entry={entry} m={m} />;
    case "review":
      return <ReviewCard eid={eid} entry={entry} />;
    case "human_item":
      return <HumanItemCard eid={eid} entry={entry} />;
    case "run_issue":
      return <RunIssueCard entry={entry} m={m} />;
    case "proposal":
      return (
        <div data-testid="inbox-card-proposal">
          <ProposalCard eid={eid} view={entry.proposal} />
        </div>
      );
    case "fyi":
      return <FyiCard eid={eid} entry={entry} m={m} />;
  }
}
