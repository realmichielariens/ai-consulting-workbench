// J1.4, J1.5, J1.6, R3: every Inbox entry is actionable in place.

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { EngagementId, InboxEntry, Request } from "@workbench/core";
import { api, qk } from "../api/index.js";
import { selectAsset, selectItem } from "../state/url.js";

// InboxEntry's per-kind `request` field is typed as the full `Request`
// union (api.ts), not narrowed to the matching variant — the server
// guarantees the match at runtime, but the type doesn't carry it. These
// assert the one invariant the API contract leaves implicit; see the look
// report's "contract change requests".
function asQuestion(req: Request): Extract<Request, { type: "question" }> {
  if (req.type !== "question") throw new Error(`expected a question request, got "${req.type}"`);
  return req;
}
function asGateRequest(req: Request): Extract<Request, { type: "gate_request" }> {
  if (req.type !== "gate_request") throw new Error(`expected a gate_request, got "${req.type}"`);
  return req;
}
function asRunIssue(req: Request): Extract<Request, { type: "run_issue" }> {
  if (req.type !== "run_issue") throw new Error(`expected a run_issue, got "${req.type}"`);
  return req;
}

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
  return { answer, verdict, issue, markDone, upload };
}

export function Inbox({ eid }: { eid: EngagementId }) {
  const inbox = useQuery({ queryKey: qk.inbox(eid), queryFn: () => api.getInbox(eid) });
  const m = useInboxMutations(eid);

  if (inbox.status === "pending") return <p>Loading inbox…</p>;
  if (inbox.status === "error") return <p role="alert">Could not load inbox: {(inbox.error as Error).message}</p>;

  if (inbox.data.entries.length === 0) return <p className="muted" data-testid="inbox-empty">Nothing waiting.</p>;

  return (
    <ul className="inbox-list" data-testid="inbox-list">
      {inbox.data.entries.map((entry) => (
        <li key={entryKey(entry)}>
          <InboxCard entry={entry} m={m} />
        </li>
      ))}
    </ul>
  );
}

function entryKey(entry: InboxEntry): string {
  return entry.kind === "human_item" ? `human_item:${entry.item.id}` : `${entry.kind}:${entry.request.id}`;
}

function InboxCard({ entry, m }: { entry: InboxEntry; m: ReturnType<typeof useInboxMutations> }) {
  switch (entry.kind) {
    case "question":
      return <QuestionCard entry={entry} m={m} />;
    case "review":
      return <ReviewCard entry={entry} m={m} />;
    case "human_item":
      return <HumanItemCard entry={entry} m={m} />;
    case "run_issue":
      return <RunIssueCard entry={entry} m={m} />;
  }
}

export function QuestionCard({ entry, m }: { entry: Extract<InboxEntry, { kind: "question" }>; m: ReturnType<typeof useInboxMutations> }) {
  const request = asQuestion(entry.request);
  const [mode, setMode] = useState<"idle" | "amend" | "replace">("idle");
  const [text, setText] = useState(request.payload.hypothesis);
  const pending = m.answer.isPending && m.answer.variables?.rid === request.id;

  const submit = (finalMode: "approve" | "amend" | "replace", finalText: string) => {
    m.answer.mutate({ rid: request.id, mode: finalMode, text: finalText });
  };

  return (
    <div className="card inbox-card" data-testid="inbox-card-question" data-request-id={request.id}>
      <div className="card-header">
        <button type="button" className="link" onClick={() => selectItem(entry.item.id)}>
          {entry.item.title}
        </button>
        {request.blocking && <span className="badge badge-blocking">Blocking</span>}
      </div>
      <p className="question-text">{request.payload.question}</p>
      <p>
        <strong>Hypothesis:</strong> {request.payload.hypothesis}
      </p>
      {request.payload.alternatives.length > 0 && (
        <ul className="alternatives">
          {request.payload.alternatives.map((alt, i) => (
            <li key={i}>{alt}</li>
          ))}
        </ul>
      )}

      {mode === "idle" && (
        <div className="actions">
          <button type="button" data-testid="question-approve" disabled={pending} onClick={() => submit("approve", request.payload.hypothesis)}>
            Approve
          </button>
          <button type="button" data-testid="question-amend-open" disabled={pending} onClick={() => setMode("amend")}>
            Amend
          </button>
          <button
            type="button"
            data-testid="question-replace-open"
            disabled={pending}
            onClick={() => {
              setText("");
              setMode("replace");
            }}
          >
            Replace
          </button>
        </div>
      )}
      {mode !== "idle" && (
        <div className="answer-editor">
          <textarea data-testid="question-answer-text" value={text} onChange={(e) => setText(e.target.value)} rows={4} />
          <div className="actions">
            <button type="button" data-testid="question-answer-submit" disabled={pending || text.trim().length === 0} onClick={() => submit(mode, text)}>
              Send {mode === "amend" ? "amended" : "replacement"} answer
            </button>
            <button type="button" disabled={pending} onClick={() => setMode("idle")}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {pending && <p className="pending">Sending…</p>}
      {m.answer.isError && m.answer.variables?.rid === request.id && (
        <p role="alert" className="error">
          {(m.answer.error as Error).message}
        </p>
      )}
    </div>
  );
}

export function ReviewCard({ entry, m }: { entry: Extract<InboxEntry, { kind: "review" }>; m: ReturnType<typeof useInboxMutations> }) {
  const request = asGateRequest(entry.request);
  const [comments, setComments] = useState("");
  const [requesting, setRequesting] = useState(false);
  const pending = m.verdict.isPending && m.verdict.variables?.rid === request.id;
  const report = request.payload.report;

  return (
    <div className="card inbox-card" data-testid="inbox-card-review" data-request-id={request.id}>
      <div className="card-header">
        <button type="button" className="link" onClick={() => selectItem(entry.item.id)}>
          Review {entry.item.title}
        </button>
      </div>
      <ul className="version-links">
        {request.payload.submitted.map((sv) => {
          const [itemId, slot] = sv.slot.split("/") as [string, string];
          return (
            <li key={sv.slot}>
              <button type="button" className="link" onClick={() => selectAsset(itemId, slot, sv.version)}>
                {slot} v{sv.version}
              </button>
            </li>
          );
        })}
      </ul>
      <details className="report">
        <summary>Completion report</summary>
        <p>{report.summary}</p>
        <table>
          <tbody>
            {report.selfCheck.map((c, i) => (
              <tr key={i}>
                <td>{c.criterion}</td>
                <td className={`met-${c.met}`}>{c.met}</td>
                <td>{c.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {report.openIssues.length > 0 && (
          <>
            <strong>Open issues</strong>
            <ul>
              {report.openIssues.map((i, idx) => (
                <li key={idx}>{i}</li>
              ))}
            </ul>
          </>
        )}
      </details>

      <div className="actions">
        <button
          type="button"
          data-testid="review-approve"
          disabled={pending}
          onClick={() => m.verdict.mutate({ rid: request.id, verdict: "approved", comments: "" })}
        >
          Approve
        </button>
        <button type="button" data-testid="review-request-changes-open" disabled={pending} onClick={() => setRequesting(true)}>
          Request changes
        </button>
      </div>
      {requesting && (
        <div className="answer-editor">
          <textarea
            data-testid="review-comments"
            placeholder="What needs to change?"
            value={comments}
            onChange={(e) => setComments(e.target.value)}
            rows={3}
          />
          <div className="actions">
            <button
              type="button"
              data-testid="review-request-changes-submit"
              disabled={pending || comments.trim().length === 0}
              onClick={() => m.verdict.mutate({ rid: request.id, verdict: "changes_requested", comments })}
            >
              Send
            </button>
            <button type="button" disabled={pending} onClick={() => setRequesting(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {pending && <p className="pending">Sending…</p>}
    </div>
  );
}

export function HumanItemCard({ entry, m }: { entry: Extract<InboxEntry, { kind: "human_item" }>; m: ReturnType<typeof useInboxMutations> }) {
  const uploadPending = m.upload.isPending && m.upload.variables?.itemId === entry.item.id;
  const donePending = m.markDone.isPending && m.markDone.variables === entry.item.id;

  return (
    <div className="card inbox-card" data-testid="inbox-card-human-item" data-item-id={entry.item.id}>
      <div className="card-header">
        <button type="button" className="link" onClick={() => selectItem(entry.item.id)}>
          {entry.item.title}
        </button>
        <span className="badge">{entry.status.replace(/_/g, " ")}</span>
      </div>

      {entry.inputs.length > 0 && (
        <div className="inputs">
          <strong>Inputs</strong>
          <ul>
            {entry.inputs.map((inp) => {
              const [itemId, slot] = inp.slot.split("/") as [string, string];
              return (
                <li key={inp.slot}>
                  {inp.available ? (
                    <button type="button" className="link" onClick={() => selectAsset(itemId, slot, inp.available!.version)}>
                      {slot} v{inp.available.version}
                    </button>
                  ) : (
                    <span className="muted">{slot} — not yet available</span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="outputs">
        <strong>Outputs</strong>
        <ul>
          {entry.outputs.map((out) => (
            <li key={out.slot} data-testid={`upload-slot-${out.slot}`}>
              <span>
                {out.slot}
                {out.latest ? ` — v${out.latest.version}` : out.required ? " — required" : " — optional"}
              </span>
              <input
                type="file"
                accept=".md"
                aria-label={`Upload ${out.slot}`}
                data-testid={`upload-input-${out.slot}`}
                disabled={uploadPending}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) m.upload.mutate({ itemId: entry.item.id, slot: out.slot, file });
                  e.target.value = "";
                }}
              />
            </li>
          ))}
        </ul>
      </div>

      <div className="actions">
        <button
          type="button"
          data-testid="mark-done"
          disabled={!entry.markDone.allowed || donePending}
          onClick={() => m.markDone.mutate(entry.item.id)}
        >
          Mark done
        </button>
        {!entry.markDone.allowed && <p className="helper-text">{entry.markDone.reason}</p>}
      </div>
      {uploadPending && <p className="pending">Uploading…</p>}
      {m.upload.isError && m.upload.variables?.itemId === entry.item.id && (
        <p role="alert" className="error">
          {(m.upload.error as Error).message}
        </p>
      )}
    </div>
  );
}

export function RunIssueCard({ entry, m }: { entry: Extract<InboxEntry, { kind: "run_issue" }>; m: ReturnType<typeof useInboxMutations> }) {
  const request = asRunIssue(entry.request);
  const pending = m.issue.isPending && m.issue.variables?.rid === request.id;
  return (
    <div className="card inbox-card" data-testid="inbox-card-run-issue" data-request-id={request.id}>
      <div className="card-header">
        <button type="button" className="link" onClick={() => selectItem(entry.item.id)}>
          Run issue — {entry.item.title}
        </button>
      </div>
      <p>
        <strong>Reason:</strong> {request.payload.reason.replace(/_/g, " ")}
      </p>
      <p className="muted">{request.payload.lastMessage}</p>
      <div className="actions">
        <button type="button" data-testid="issue-retry" disabled={pending} onClick={() => m.issue.mutate({ rid: request.id, action: "retry" })}>
          Retry
        </button>
        <button type="button" data-testid="issue-stop" disabled={pending} onClick={() => m.issue.mutate({ rid: request.id, action: "stop" })}>
          Stop
        </button>
      </div>
      {pending && <p className="pending">Sending…</p>}
    </div>
  );
}
