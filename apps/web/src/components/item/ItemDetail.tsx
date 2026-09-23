// Item detail (J1.2, J1.3, J1.7, R1, R3, R4, R5): definition, actions with
// their disabled reasons, inputs/outputs, gate, open requests, last
// completion report, runs, live activity and the worklog tab.

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { EngagementId, ItemId, Run } from "@workbench/core";
import { api, qk } from "../../api/index.js";
import { selectAsset } from "../../state/url.js";
import { ActivityStream } from "./ActivityStream.js";

export function ItemDetail({ eid, itemId }: { eid: EngagementId; itemId: ItemId }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: qk.item(eid, itemId), queryFn: () => api.getItem(eid, itemId) });
  const [tab, setTab] = useState<"overview" | "worklog">("overview");
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [briefDraft, setBriefDraft] = useState("");
  const [acceptanceDraft, setAcceptanceDraft] = useState<string[]>([]);

  useEffect(() => {
    setTab("overview");
    setSelectedRunId(null);
    setEditing(false);
  }, [itemId]);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: qk.item(eid, itemId) });
    void qc.invalidateQueries({ queryKey: qk.plan(eid) });
    void qc.invalidateQueries({ queryKey: qk.inbox(eid) });
  };

  const start = useMutation({ mutationFn: () => api.startItem(eid, itemId), onSuccess: invalidate });
  const stop = useMutation({ mutationFn: () => api.stopItem(eid, itemId), onSuccess: invalidate });
  const resume = useMutation({ mutationFn: () => api.resumeItem(eid, itemId), onSuccess: invalidate });
  const edit = useMutation({
    mutationFn: () => api.editItem(eid, itemId, { brief: briefDraft, acceptance: acceptanceDraft }),
    onSuccess: () => {
      invalidate();
      setEditing(false);
    },
  });

  if (q.status === "pending") return <p>Loading item…</p>;
  if (q.status === "error") return <p role="alert">Could not load item: {(q.error as Error).message}</p>;

  const { node, def, inputs, outputs, runs, activeRun, openRequests, lastReport, actions } = q.data;
  const shownRun: Run | null = activeRun ?? runs.find((r) => r.id === selectedRunId) ?? null;

  return (
    <div className="item-detail" data-testid="item-detail" data-item-id={itemId}>
      <header className="item-detail-header">
        <h2>
          {node.id} — {node.title}
        </h2>
        <div className="item-detail-meta">
          <span className={`badge status-${node.status ?? "none"}`}>{(node.status ?? "n/a").replace(/_/g, " ")}</span>
          <span className="muted">{node.executor ?? "composite"}</span>
        </div>
      </header>

      {node.notReadyBecause.length > 0 && (
        <p className="helper-text" data-testid="not-ready-reason">
          Not ready because: {node.notReadyBecause.map(describeBlocker).join("; ")}
        </p>
      )}

      <div className="actions item-actions">
        <ActionButton label="Start" testId="action-start" allowed={actions.start} pending={start.isPending} onClick={() => start.mutate()} />
        <ActionButton label="Stop" testId="action-stop" allowed={actions.stop} pending={stop.isPending} onClick={() => stop.mutate()} />
        <ActionButton label="Resume" testId="action-resume" allowed={actions.resume} pending={resume.isPending} onClick={() => resume.mutate()} />
      </div>

      <nav className="item-tabs">
        <button type="button" className={tab === "overview" ? "active" : ""} onClick={() => setTab("overview")}>
          Overview
        </button>
        <button type="button" data-testid="worklog-tab" className={tab === "worklog" ? "active" : ""} onClick={() => setTab("worklog")}>
          Worklog
        </button>
      </nav>

      {tab === "worklog" ? (
        <Worklog eid={eid} itemId={itemId} />
      ) : (
        <>
          <section>
            <div className="section-header">
              <h3>Brief</h3>
              {!editing &&
                (actions.edit.allowed ? (
                  <button
                    type="button"
                    data-testid="edit-brief-open"
                    onClick={() => {
                      setBriefDraft(def.brief);
                      setAcceptanceDraft(def.acceptance);
                      setEditing(true);
                    }}
                  >
                    Edit
                  </button>
                ) : (
                  <span className="helper-text">{actions.edit.reason}</span>
                ))}
            </div>
            {editing ? (
              <div className="edit-brief">
                <textarea data-testid="edit-brief-text" value={briefDraft} onChange={(e) => setBriefDraft(e.target.value)} rows={8} />
                <strong>Acceptance criteria</strong>
                {acceptanceDraft.map((a, i) => (
                  <input
                    key={i}
                    type="text"
                    value={a}
                    onChange={(e) =>
                      setAcceptanceDraft((prev) => prev.map((x, idx) => (idx === i ? e.target.value : x)))
                    }
                  />
                ))}
                <div className="actions">
                  <button type="button" onClick={() => setAcceptanceDraft((prev) => [...prev, ""])}>
                    + criterion
                  </button>
                </div>
                <div className="actions">
                  <button type="button" data-testid="edit-brief-save" disabled={edit.isPending} onClick={() => edit.mutate()}>
                    Save
                  </button>
                  <button type="button" disabled={edit.isPending} onClick={() => setEditing(false)}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="markdown">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{def.brief}</ReactMarkdown>
                </div>
                {def.acceptance.length > 0 && (
                  <ul className="acceptance-list">
                    {def.acceptance.map((a, i) => (
                      <li key={i}>{a}</li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </section>

          {inputs.length > 0 && (
            <section>
              <h3>Inputs</h3>
              <ul>
                {inputs.map((inp) => (
                  <li key={inp.slot}>
                    {inp.available ? (
                      <button type="button" className="link" onClick={() => selectAsset(inp.producer, inp.slot.split("/")[1]!, inp.available!.version)}>
                        {inp.slot} v{inp.available.version}
                      </button>
                    ) : (
                      <span className="muted">
                        {inp.slot} — not yet available (from {inp.producer})
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {outputs.length > 0 && (
            <section>
              <h3>Outputs</h3>
              {outputs.map((out) => (
                <div key={out.slot}>
                  <strong>
                    {out.slot} ({out.format}, {out.scope}
                    {out.required ? "" : ", optional"})
                  </strong>
                  <p className="muted">{out.description}</p>
                  {out.versions.length === 0 ? (
                    <span className="muted">not yet published</span>
                  ) : (
                    <ul className="version-links">
                      {[...out.versions].reverse().map((v) => (
                        <li key={v.version}>
                          <button type="button" className="link" onClick={() => selectAsset(node.id, out.slot, v.version)}>
                            v{v.version} ({v.kind}) — {v.author}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </section>
          )}

          {node.gate.length > 0 && (
            <section>
              <h3>Gate</h3>
              <p>{node.gate.map((g) => g.type).join(" → ")}</p>
            </section>
          )}

          {openRequests.length > 0 && (
            <section>
              <h3>Open requests</h3>
              <ul>
                {openRequests.map((r) => (
                  <li key={r.id}>
                    {r.type} — {r.id}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {lastReport && (
            <section>
              <h3>Last completion report</h3>
              <p>{lastReport.summary}</p>
              <table>
                <tbody>
                  {lastReport.selfCheck.map((c, i) => (
                    <tr key={i}>
                      <td>{c.criterion}</td>
                      <td className={`met-${c.met}`}>{c.met}</td>
                      <td>{c.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {lastReport.openIssues.length > 0 && (
                <ul>
                  {lastReport.openIssues.map((i, idx) => (
                    <li key={idx}>{i}</li>
                  ))}
                </ul>
              )}
            </section>
          )}

          <section>
            <h3>Runs</h3>
            <table className="runs-table" data-testid="runs-table">
              <thead>
                <tr>
                  <th>Run</th>
                  <th>Reason</th>
                  <th>Outcome</th>
                  <th>Turns</th>
                  <th>Cost</th>
                  <th>Model</th>
                  <th>Started</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id} className={r.id === activeRun?.id ? "run-active" : ""} onClick={() => setSelectedRunId(r.id)} data-testid={`run-row-${r.id}`}>
                    <td>{r.id}</td>
                    <td>{r.reason}</td>
                    <td>{r.outcome ?? "running"}</td>
                    <td>{r.turns}</td>
                    <td>${r.costUsd.toFixed(3)}</td>
                    <td>{r.model}</td>
                    <td>{new Date(r.startedAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section>
            <h3>{activeRun ? "Live activity" : "Activity"}</h3>
            {shownRun ? <ActivityStream eid={eid} runId={shownRun.id} /> : <p className="muted">No run selected yet — pick one from the table above.</p>}
          </section>
        </>
      )}
    </div>
  );
}

export function ActionButton({ label, testId, allowed, pending, onClick }: { label: string; testId: string; allowed: { allowed: boolean; reason: string | null }; pending: boolean; onClick: () => void }) {
  return (
    <div className="action-with-reason">
      <button type="button" aria-label={label} data-testid={testId} disabled={!allowed.allowed || pending} onClick={onClick}>
        {label}
      </button>
      {!allowed.allowed && allowed.reason && <span className="helper-text">{allowed.reason}</span>}
    </div>
  );
}

function describeBlocker(b: { kind: string; slot?: string; item?: string; producer?: string }): string {
  if (b.kind === "missing_input") return `waiting for ${b.slot} (from ${b.producer})`;
  if (b.kind === "sequencing") return `waiting for ${b.item}`;
  return "no executor";
}

function Worklog({ eid, itemId }: { eid: EngagementId; itemId: ItemId }) {
  const q = useQuery({ queryKey: qk.worklog(eid, itemId), queryFn: () => api.getWorklog(eid, itemId) });
  if (q.status === "pending") return <p>Loading worklog…</p>;
  if (q.status === "error") return <p role="alert">Could not load worklog: {(q.error as Error).message}</p>;
  return (
    <div className="markdown" data-testid="worklog-content">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{q.data.markdown}</ReactMarkdown>
    </div>
  );
}
