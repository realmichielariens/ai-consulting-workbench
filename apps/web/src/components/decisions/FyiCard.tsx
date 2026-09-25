// EXHIBIT §7.3 "FYI": a one-line row, not a card. Dismiss / Override, kept
// ids from the old Inbox.tsx (plan §4.6).

import { useState } from "react";
import type { InboxEntry } from "@workbench/core";
import { openItem } from "../../shell/nav.js";
import { Button } from "../../ui/index.js";
import { useInboxMutations } from "./useInboxMutations.js";
import { formatActor } from "../../lib/actorLabel.js";
import "./DecisionCard.css";

export function FyiCard({ eid, entry, m }: { eid: string; entry: Extract<InboxEntry, { kind: "fyi" }>; m: ReturnType<typeof useInboxMutations> }) {
  const { notification, request, item, override } = entry;
  const [overriding, setOverriding] = useState(false);
  const answered = request?.status === "answered" && request.response?.kind === "answer" ? request.response : null;
  const [text, setText] = useState(answered?.text ?? "");
  const dismissPending = m.dismiss.isPending && m.dismiss.variables === notification.id;
  const overridePending = m.override.isPending && m.override.variables?.rid === request?.id;

  return (
    <div data-testid="inbox-card-fyi" data-notification-id={notification.id}>
      <div className="fyi-row">
        <span className="fyi-text">
          {item && (
            <button type="button" className="link" onClick={() => openItem(eid, item.id)}>
              {item.title}:{" "}
            </button>
          )}
          {notification.text}
          {answered && ` — answered by ${formatActor(answered.by)}: ${answered.text}`}
        </span>
        <Button variant="ghost" size="sm" data-testid="fyi-dismiss" disabled={dismissPending} onClick={() => m.dismiss.mutate(notification.id)}>
          Dismiss
        </Button>
        {request && (
          <Button
            variant="ghost"
            size="sm"
            data-testid="fyi-override-open"
            disabled={!override.allowed || overriding}
            disabledReason={override.reason ?? undefined}
            onClick={() => setOverriding(true)}
          >
            Override
          </Button>
        )}
      </div>
      {!override.allowed && override.reason && <p className="helper-text">{override.reason}</p>}
      {overriding && request && (
        <div className="fyi-override answer-editor">
          <textarea className="textarea" data-testid="fyi-override-text" value={text} onChange={(e) => setText(e.target.value)} rows={3} />
          <div className="card-actions" style={{ borderTop: "none", marginTop: 0, paddingTop: 0 }}>
            <Button
              size="sm"
              data-testid="fyi-override-submit"
              disabled={overridePending || text.trim().length === 0}
              onClick={() => m.override.mutate({ rid: request.id, mode: "replace", text })}
            >
              Send override
            </Button>
            <Button variant="ghost" size="sm" disabled={overridePending} onClick={() => setOverriding(false)}>
              Cancel
            </Button>
          </div>
          {(dismissPending || overridePending) && <p className="muted">Sending…</p>}
        </div>
      )}
    </div>
  );
}
