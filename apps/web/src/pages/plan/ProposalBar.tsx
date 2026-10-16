// UX1 brief B §Build 1: the proposal bar, shown at the top of the stage
// while `?preview=` is set (REDESIGN-PLAN §6.4). Replaces the old separate
// ProcessView preview banner.

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { EngagementId, PlanPreviewView, PlanView, ProposalId } from "@workbench/core";
import { api, qk } from "../../api/index.js";
import { Button } from "../../ui/index.js";
import { openHome } from "../../shell/nav.js";
import { focusComposer } from "../../shell/rail.js";

function proposalNumber(pid: ProposalId): string {
  return pid.replace(/^P-0*/, "") || "0";
}

export function ProposalBar({ eid, pid, preview, onExit }: { eid: EngagementId; pid: ProposalId; preview: PlanPreviewView | undefined; onExit: () => void }) {
  const qc = useQueryClient();
  const approve = useMutation({
    mutationFn: () => api.approveProposal(eid, pid),
    // Approving the first plan ends the Kick-off: the Brief becomes home, so go
    // there (REDESIGN-PLAN §6.2). Later proposals keep the user on the Plan.
    // Read before the request: the WebSocket event can refetch the plan before the response lands.
    onMutate: () => ({ endsKickoff: (qc.getQueryData<PlanView>(qk.plan(eid))?.items.length ?? 0) <= 1 }),
    onSuccess: (_view, _vars, context) => {
      void qc.invalidateQueries({ queryKey: qk.plan(eid) });
      void qc.invalidateQueries({ queryKey: qk.inbox(eid) });
      void qc.invalidateQueries({ queryKey: qk.engagement(eid) });
      void qc.invalidateQueries({ queryKey: qk.proposals(eid) });
      if (context?.endsKickoff) openHome(eid);
      else onExit();
    },
  });

  const changeCount = preview ? preview.added.length + preview.changed.length + preview.cancelled.length : null;

  return (
    <div className="preview-banner" data-testid="preview-banner">
      <span>
        Proposal #{proposalNumber(pid)}
        {changeCount != null && ` · ${changeCount} change${changeCount === 1 ? "" : "s"}`}
      </span>
      <span className="pv-spacer" />
      <Button variant="primary" size="sm" data-testid="proposal-bar-approve" disabled={approve.isPending} onClick={() => approve.mutate()}>
        Approve
      </Button>
      <Button size="sm" data-testid="proposal-bar-discuss" onClick={focusComposer}>
        Discuss
      </Button>
      <Button variant="ghost" size="sm" data-testid="preview-exit" onClick={onExit}>
        Exit preview
      </Button>
    </div>
  );
}
