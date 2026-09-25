// J2.2, J2.5: a pending proposal's ops, rationale and origin, with Preview /
// Approve / Reject. Used inline in the Chat (a system message with a
// proposalId) and wrapped in the Inbox (kind "proposal").

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { EngagementId, ProposalView } from "@workbench/core";
import { api, qk } from "../api/index.js";
import { useUiStore } from "../state/ui.js";

export function ProposalCard({ eid, view }: { eid: EngagementId; view: ProposalView }) {
  const { proposal, readableOps, suggestedByTitle, actions } = view;
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const qc = useQueryClient();
  const previewProposalId = useUiStore((s) => s.previewProposalId);
  const setPreviewProposal = useUiStore((s) => s.setPreviewProposal);
  const exitPreview = useUiStore((s) => s.exitPreview);
  const previewing = previewProposalId === proposal.id;

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: qk.proposals(eid) });
    void qc.invalidateQueries({ queryKey: qk.proposal(eid, proposal.id) });
    void qc.invalidateQueries({ queryKey: qk.plan(eid) });
    void qc.invalidateQueries({ queryKey: qk.inbox(eid) });
    void qc.invalidateQueries({ queryKey: qk.engagement(eid) });
  };

  const approve = useMutation({
    mutationFn: () => api.approveProposal(eid, proposal.id),
    onSuccess: () => {
      invalidate();
      if (previewing) exitPreview();
    },
  });
  const reject = useMutation({
    mutationFn: () => api.rejectProposal(eid, proposal.id, { reason }),
    onSuccess: () => {
      invalidate();
      if (previewing) exitPreview();
      setRejecting(false);
      setReason("");
    },
  });

  const compact = proposal.status !== "pending";

  return (
    <div className="card proposal-card" data-testid="proposal-card" data-proposal-id={proposal.id}>
      <div className="card-header">
        <strong>{proposal.id}</strong>
        <span className="badge" data-testid="proposal-status">
          {proposal.status}
        </span>
      </div>

      {suggestedByTitle && (
        <p className="muted" data-testid="proposal-suggested-by">
          Suggested by {proposal.suggestedBy} {suggestedByTitle}
        </p>
      )}

      <p data-testid="proposal-rationale">{proposal.rationale}</p>

      {!compact && (
        <ul className="proposal-ops">
          {readableOps.map((op, i) => (
            <li key={i} data-testid="proposal-op">
              {op}
            </li>
          ))}
        </ul>
      )}

      {proposal.status === "rejected" && proposal.rejectReason && <p className="muted">Rejected: {proposal.rejectReason}</p>}
      {proposal.status === "superseded" && proposal.supersededBy && <p className="muted">Superseded by {proposal.supersededBy}.</p>}

      {!compact && (
        <div className="actions">
          <button
            type="button"
            data-testid="proposal-preview-toggle"
            onClick={() => (previewing ? exitPreview() : setPreviewProposal(proposal.id))}
          >
            {previewing ? "Stop previewing" : "Preview in process view"}
          </button>
          <button
            type="button"
            data-testid="proposal-approve"
            disabled={!actions.approve.allowed || approve.isPending}
            title={actions.approve.reason ?? undefined}
            onClick={() => approve.mutate()}
          >
            Approve
          </button>
          <button
            type="button"
            data-testid="proposal-reject-open"
            disabled={!actions.reject.allowed || reject.isPending}
            title={actions.reject.reason ?? undefined}
            onClick={() => setRejecting(true)}
          >
            Reject
          </button>
        </div>
      )}

      {rejecting && (
        <div className="answer-editor">
          <textarea
            data-testid="proposal-reject-reason"
            placeholder="Why reject this proposal?"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
          />
          <div className="actions">
            <button
              type="button"
              data-testid="proposal-reject-submit"
              disabled={reason.trim().length === 0 || reject.isPending}
              onClick={() => reject.mutate()}
            >
              Send
            </button>
            <button type="button" disabled={reject.isPending} onClick={() => setRejecting(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {(approve.isError || reject.isError) && (
        <p role="alert" className="error">
          {((approve.error ?? reject.error) as Error).message}
        </p>
      )}
    </div>
  );
}
