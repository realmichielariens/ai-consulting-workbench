// The Feedback button (ITERATIONS.md §1.3): a note plus the current view and
// selected item, written to workspace/feedback.jsonl by the server. Same ids
// as before; only the styling is UX1 (brief A owns this file).

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { EngagementId, ItemId } from "@workbench/core";
import { api } from "../api/index.js";
import { useUiStore } from "../state/ui.js";
import { Button } from "../ui/index.js";
import "./FeedbackModal.css";

export function FeedbackModal({ eid, view, itemId }: { eid: EngagementId; view: string; itemId: ItemId | null }) {
  const open = useUiStore((s) => s.feedbackOpen);
  const close = useUiStore((s) => s.closeFeedback);
  const [note, setNote] = useState("");

  const submit = useMutation({
    mutationFn: () => api.addFeedback(eid, { note, view, itemId }),
    onSuccess: () => setNote(""),
  });

  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={close}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Feedback" data-testid="feedback-modal" onClick={(e) => e.stopPropagation()}>
        <h2>Feedback</h2>
        <p className="muted">
          View: {view}
          {itemId ? ` · Item: ${itemId}` : ""}
        </p>
        <textarea
          className="feedback-textarea"
          data-testid="feedback-text"
          rows={5}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="What did you notice?"
          autoFocus
        />
        <div className="modal-actions">
          <Button variant="primary" size="sm" data-testid="feedback-submit" disabled={submit.isPending || note.trim().length === 0} onClick={() => submit.mutate()}>
            Send
          </Button>
          <Button variant="ghost" size="sm" onClick={close}>
            Cancel
          </Button>
        </div>
        {submit.isPending && <p className="muted">Sending…</p>}
        {submit.isSuccess && <p data-testid="feedback-sent">Thanks — noted.</p>}
        {submit.isError && (
          <p role="alert" className="feedback-error">
            {(submit.error as Error).message}
          </p>
        )}
      </div>
    </div>
  );
}
