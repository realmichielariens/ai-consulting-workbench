// EXHIBIT §7.3 "Run issue": what happened, the last activity line, then
// Retry / Stop. Kept ids from the old Inbox.tsx (plan §4.6).

import type { InboxEntry, Request } from "@workbench/core";
import { Button } from "../../ui/index.js";
import { useInboxMutations } from "./useInboxMutations.js";
import { ageLabel } from "./ids.js";
import "./DecisionCard.css";

function asRunIssue(req: Request): Extract<Request, { type: "run_issue" }> {
  if (req.type !== "run_issue") throw new Error(`expected a run_issue, got "${req.type}"`);
  return req;
}

export function RunIssueCard({ entry, m }: { entry: Extract<InboxEntry, { kind: "run_issue" }>; m: ReturnType<typeof useInboxMutations> }) {
  const request = asRunIssue(entry.request);
  const pending = m.issue.isPending && m.issue.variables?.rid === request.id;
  return (
    <div className="card" data-testid="inbox-card-run-issue" data-request-id={request.id}>
      <div className="card-kicker">
        <span className="kind">Run issue</span>
        <span className="id">{entry.item.id}</span>
        <span>· {ageLabel(request.createdAt)}</span>
        <span>· {entry.consequence.reason}</span>
      </div>
      <h4 className="card-title">{entry.item.title}</h4>
      <div className="card-evidence">
        <p className="why">{request.payload.reason.replace(/_/g, " ")}</p>
        <p className="muted">{request.payload.lastMessage}</p>
        {pending && <p className="muted">Sending…</p>}
      </div>
      <div className="card-actions">
        <Button variant="primary" size="sm" data-testid="issue-retry" disabled={pending} onClick={() => m.issue.mutate({ rid: request.id, action: "retry" })}>
          Retry
        </Button>
        <Button size="sm" data-testid="issue-stop" disabled={pending} onClick={() => m.issue.mutate({ rid: request.id, action: "stop" })}>
          Stop
        </Button>
      </div>
    </div>
  );
}
