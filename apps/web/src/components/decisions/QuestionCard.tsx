// EXHIBIT §7.3 "Question": hypothesis in the reading face, approve/amend/
// replace, kept ids from the old Inbox.tsx (plan §4.6).

import { useState } from "react";
import type { InboxEntry, Request } from "@workbench/core";
import { openItem } from "../../shell/nav.js";
import { Card, Button } from "../../ui/index.js";
import { useInboxMutations } from "./useInboxMutations.js";
import { ageLabel } from "./ids.js";
import "./DecisionCard.css";

function asQuestion(req: Request): Extract<Request, { type: "question" }> {
  if (req.type !== "question") throw new Error(`expected a question request, got "${req.type}"`);
  return req;
}

export function QuestionCard({
  eid,
  entry,
  m,
}: {
  eid: string;
  entry: Extract<InboxEntry, { kind: "question" }>;
  m: ReturnType<typeof useInboxMutations>;
}) {
  const request = asQuestion(entry.request);
  const [mode, setMode] = useState<"idle" | "amend" | "replace">("idle");
  const [text, setText] = useState(request.payload.hypothesis);
  const pending = m.answer.isPending && m.answer.variables?.rid === request.id;

  const submit = (finalMode: "approve" | "amend" | "replace", finalText: string) => {
    m.answer.mutate({ rid: request.id, mode: finalMode, text: finalText });
  };

  return (
    <div className="card" data-testid="inbox-card-question" data-request-id={request.id}>
      <div className="card-kicker">
        <span className="kind">Question</span>
        <span className="id">{entry.item.id}</span>
        <button type="button" className="link" onClick={() => openItem(eid, entry.item.id)}>
          {entry.item.title}
        </button>
        <span>· {ageLabel(request.createdAt)}</span>
        <span>· {entry.consequence.reason}</span>
      </div>
      <h4 className="card-title">{request.payload.question}</h4>
      <div className="card-evidence">
        <div className="hypo">
          <span className="label">Agent's hypothesis</span>
          <p>{request.payload.hypothesis}</p>
        </div>
        {request.escalation && (
          <div className="escalation-view">
            <strong>The Approach Agent escalated this</strong>
            <p data-testid="question-escalation-view">{request.escalation.view}</p>
          </div>
        )}
        {request.payload.alternatives.length > 0 && (
          <ul className="alternatives">
            {request.payload.alternatives.map((alt, i) => (
              <li key={i}>{alt}</li>
            ))}
          </ul>
        )}
        {mode !== "idle" && (
          <div className="amend-field">
            <textarea
              className="textarea"
              data-testid="question-answer-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={4}
            />
          </div>
        )}
        {pending && <p className="muted">Sending…</p>}
        {m.answer.isError && m.answer.variables?.rid === request.id && (
          <p role="alert" className="error">
            {(m.answer.error as Error).message}
          </p>
        )}
      </div>
      <div className="card-actions">
        {mode === "idle" ? (
          <>
            <Button variant="primary" size="sm" kbd="A" data-testid="question-approve" disabled={pending} onClick={() => submit("approve", request.payload.hypothesis)}>
              Approve
            </Button>
            <Button size="sm" kbd="E" data-testid="question-amend-open" disabled={pending} onClick={() => setMode("amend")}>
              Amend
            </Button>
            <Button size="sm" kbd="R" data-testid="question-replace-open" disabled={pending} onClick={() => { setText(""); setMode("replace"); }}>
              Replace
            </Button>
          </>
        ) : (
          <>
            <Button size="sm" data-testid="question-answer-submit" disabled={pending || text.trim().length === 0} onClick={() => submit(mode, text)}>
              Send {mode === "amend" ? "amended" : "replacement"} answer
            </Button>
            <Button variant="ghost" size="sm" disabled={pending} onClick={() => setMode("idle")}>
              Cancel
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
