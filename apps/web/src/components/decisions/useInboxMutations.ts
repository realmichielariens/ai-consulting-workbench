// J1.4-J1.6, R3, I2 overrides/dismiss: the mutations every decision-card
// variant fires. Moved verbatim from the old components/Inbox.tsx (C owns
// this logic now); behaviour is unchanged.

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { EngagementId } from "@workbench/core";
import { api, qk } from "../../api/index.js";

export function useInboxMutations(eid: EngagementId) {
  const qc = useQueryClient();
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: qk.inbox(eid) });
    void qc.invalidateQueries({ queryKey: qk.plan(eid) });
    void qc.invalidateQueries({ queryKey: qk.engagement(eid) });
  };
  const answer = useMutation({
    mutationFn: (vars: { rid: string; mode: "approve" | "amend" | "replace"; text: string }) => api.answerQuestion(eid, vars.rid, { mode: vars.mode, text: vars.text }),
    onSuccess: invalidate,
  });
  const verdict = useMutation({
    mutationFn: (vars: { rid: string; verdict: "approved" | "changes_requested"; comments: string }) => api.recordVerdict(eid, vars.rid, { verdict: vars.verdict, comments: vars.comments }),
    onSuccess: invalidate,
  });
  const issue = useMutation({
    mutationFn: (vars: { rid: string; action: "retry" | "stop" }) => api.resolveRunIssue(eid, vars.rid, { action: vars.action }),
    onSuccess: invalidate,
  });
  const markDone = useMutation({
    mutationFn: (itemId: string) => api.markDone(eid, itemId),
    onSuccess: invalidate,
  });
  const upload = useMutation({
    mutationFn: (vars: { itemId: string; slot: string; file: File }) => api.uploadOutput(eid, vars.itemId, vars.slot, vars.file),
    onSuccess: invalidate,
  });
  const override = useMutation({
    mutationFn: (vars: { rid: string; mode: "approve" | "amend" | "replace"; text: string }) => api.overrideAnswer(eid, vars.rid, { mode: vars.mode, text: vars.text }),
    onSuccess: invalidate,
  });
  const dismiss = useMutation({
    mutationFn: (nid: string) => api.dismissNotification(eid, nid),
    onSuccess: invalidate,
  });
  return { answer, verdict, issue, markDone, upload, override, dismiss };
}
