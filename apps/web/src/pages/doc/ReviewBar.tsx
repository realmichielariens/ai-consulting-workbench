// UX1 brief B §Build 3: the review bar (EXHIBIT §7.4). The verdict applies
// to the whole gate request, so Approve/Request changes act once even when
// several outputs were submitted together — "1 of n" + review-next-output
// just moves which document is on screen.

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { EngagementId } from "@workbench/core";
import { api, qk } from "../../api/index.js";
import { openDoc } from "../../shell/nav.js";
import { Button, CriterionGlyph, GateGlyph } from "../../ui/index.js";
import type { ReviewEntry } from "./reviewEntry.js";

export function ReviewBar({ eid, slotRef, entry }: { eid: EngagementId; slotRef: string; entry: ReviewEntry }) {
  const qc = useQueryClient();
  const [requesting, setRequesting] = useState(false);
  const [comments, setComments] = useState("");

  const verdict = useMutation({
    mutationFn: (vars: { verdict: "approved" | "changes_requested"; comments: string }) => api.recordVerdict(eid, entry.request.id, vars),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.inbox(eid) });
      void qc.invalidateQueries({ queryKey: qk.plan(eid) });
      void qc.invalidateQueries({ queryKey: qk.item(eid, entry.item.id) });
    },
  });

  if (entry.request.type !== "gate_request") return null;
  const { submitted, gateType, report } = entry.request.payload;
  const index = submitted.findIndex((sv) => sv.slot === slotRef);
  const thisVersion = submitted[index]?.version;

  return (
    <div className="review-bar" data-testid="review-bar">
      <span className="pv-owner">
        <GateGlyph kind={gateType === "endorsement" ? "endorse" : "review"} />
        <strong>{gateType === "human-review" ? "Human review" : gateType === "ai-review" ? "AI review" : "Endorsement"}</strong>
      </span>

      <div className="review-bar-criteria">
        {report.selfCheck.map((c, i) => (
          <span key={i} className="review-bar-criterion" title={c.note || undefined}>
            <CriterionGlyph met={c.met} />
            {c.criterion}
          </span>
        ))}
      </div>

      {submitted.length > 1 && (
        <span className="review-bar-count">
          {index + 1} of {submitted.length}
          <button
            type="button"
            className="link"
            data-testid="review-next-output"
            onClick={() => {
              const next = submitted[(index + 1) % submitted.length]!;
              openDoc(eid, next.slot, next.version);
            }}
          >
            Next
          </button>
        </span>
      )}

      <span className="pv-spacer" />

      {!requesting ? (
        <>
          <Button size="sm" data-testid="review-request-changes-open" disabled={verdict.isPending} onClick={() => setRequesting(true)}>
            Request changes
          </Button>
          <Button variant="primary" size="sm" data-testid="review-approve" disabled={verdict.isPending} onClick={() => verdict.mutate({ verdict: "approved", comments: "" })}>
            Approve {thisVersion}
          </Button>
        </>
      ) : (
        <div className="review-bar-comments">
          <textarea data-testid="review-comments" placeholder="What needs to change?" value={comments} onChange={(e) => setComments(e.target.value)} rows={2} />
          <Button
            size="sm"
            variant="primary"
            data-testid="review-request-changes-submit"
            disabled={verdict.isPending || comments.trim().length === 0}
            onClick={() => verdict.mutate({ verdict: "changes_requested", comments })}
          >
            Send
          </Button>
          <Button size="sm" variant="ghost" disabled={verdict.isPending} onClick={() => setRequesting(false)}>
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}
