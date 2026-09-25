// EXHIBIT §7.3 "Proposal": a diff list (+/↻/~/− inferred from readableOps'
// verbs), kept proposal-* ids (plan §4.6). Used inline in the conversation
// (a message with a proposalId) and wrapped in the Brief's Inbox list.
// `proposal-preview-toggle` now opens the Plan with this proposal previewed
// (openPlan(eid, { preview: id })) instead of the old process-view toggle.

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { EngagementId, ProposalView } from "@workbench/core";
import { api, qk } from "../../api/index.js";
import { openPlan } from "../../shell/nav.js";
import { Button } from "../../ui/index.js";
import "./DecisionCard.css";
import { focusComposer } from "../../shell/rail.js";

type DiffOp = "add" | "chg" | "del";

function inferDiffOp(line: string): { op: DiffOp; symbol: string } {
  const verb = line.trim().split(/\s+/, 1)[0]?.toLowerCase() ?? "";
  if (verb === "add") return { op: "add", symbol: "+" };
  if (verb === "cancel" || verb === "remove" || verb === "drop") return { op: "del", symbol: "−" };
  if (verb === "re-run" || verb === "rerun" || verb === "run") return { op: "chg", symbol: "↻" };
  return { op: "chg", symbol: "~" };
}

export function ProposalCard({ eid, view }: { eid: EngagementId; view: ProposalView }) {
  const { proposal, readableOps, suggestedByTitle, actions } = view;
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const qc = useQueryClient();

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: qk.proposals(eid) });
    void qc.invalidateQueries({ queryKey: qk.proposal(eid, proposal.id) });
    void qc.invalidateQueries({ queryKey: qk.plan(eid) });
    void qc.invalidateQueries({ queryKey: qk.inbox(eid) });
    void qc.invalidateQueries({ queryKey: qk.engagement(eid) });
  };

  const approve = useMutation({
    mutationFn: () => api.approveProposal(eid, proposal.id),
    onSuccess: invalidate,
  });
  const reject = useMutation({
    mutationFn: () => api.rejectProposal(eid, proposal.id, { reason }),
    onSuccess: () => {
      invalidate();
      setRejecting(false);
      setReason("");
    },
  });

  const compact = proposal.status !== "pending";

  return (
    <div className="card" data-testid="proposal-card" data-proposal-id={proposal.id}>
      <div className="card-kicker">
        <span className="kind">Proposal {proposal.id}</span>
        <span data-testid="proposal-status">{proposal.status}</span>
        {suggestedByTitle && <span data-testid="proposal-suggested-by">Suggested by {proposal.suggestedBy} {suggestedByTitle}</span>}
      </div>
      <h4 className="card-title" data-testid="proposal-rationale">
        {proposal.rationale}
      </h4>
      <div className="card-evidence">
        {!compact && (
          <ul className="diff">
            {readableOps.map((op, i) => {
              const { op: kind, symbol } = inferDiffOp(op);
              return (
                <li key={i} data-testid="proposal-op">
                  <span className={`diff-op diff-op-${kind}`}>{symbol}</span>
                  <span>{op}</span>
                </li>
              );
            })}
          </ul>
        )}
        {proposal.status === "rejected" && proposal.rejectReason && <p className="muted">Rejected: {proposal.rejectReason}</p>}
        {proposal.status === "superseded" && proposal.supersededBy && <p className="muted">Superseded by {proposal.supersededBy}.</p>}
        {rejecting && (
          <div className="answer-editor">
            <textarea
              className="textarea"
              data-testid="proposal-reject-reason"
              placeholder="Why reject this proposal?"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
            />
          </div>
        )}
        {(approve.isError || reject.isError) && (
          <p role="alert" className="error">
            {((approve.error ?? reject.error) as Error).message}
          </p>
        )}
      </div>
      {!compact && (
        <div className="card-actions">
          {!rejecting ? (
            <>
              <Button
                variant="primary"
                size="sm"
                kbd="A"
                data-testid="proposal-approve"
                disabled={!actions.approve.allowed || approve.isPending}
                disabledReason={actions.approve.reason ?? undefined}
                onClick={() => approve.mutate()}
              >
                Approve
              </Button>
              <Button size="sm" data-testid="proposal-preview-toggle" onClick={() => openPlan(eid, { preview: proposal.id })}>
                Review on plan
              </Button>
              <Button size="sm" data-testid="proposal-discuss" onClick={focusComposer}>
                Discuss
              </Button>
              <span className="spacer" />
              <Button
                variant="danger"
                size="sm"
                data-testid="proposal-reject-open"
                disabled={!actions.reject.allowed || reject.isPending}
                disabledReason={actions.reject.reason ?? undefined}
                onClick={() => setRejecting(true)}
              >
                Reject
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" data-testid="proposal-reject-submit" disabled={reason.trim().length === 0 || reject.isPending} onClick={() => reject.mutate()}>
                Send
              </Button>
              <Button variant="ghost" size="sm" disabled={reject.isPending} onClick={() => setRejecting(false)}>
                Cancel
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
