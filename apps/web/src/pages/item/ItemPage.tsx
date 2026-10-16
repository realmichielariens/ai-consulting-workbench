// UX1 brief B §Build 2: the Item page — header with Run/Stop/Resume, brief +
// acceptance criteria (reading face) on the left, inputs/outputs/gate on the
// right, tabs for activity/worklog/runs/requests, and Your work for human
// items. Replaces components/item/ItemDetail.tsx (pre-UX1 reference).

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { EngagementId, ItemId, Run, SourceBinding } from "@workbench/core";
import { api, qk } from "../../api/index.js";
import { openDoc, openItem, openSources, type ItemTab } from "../../shell/nav.js";
import { ActionButton } from "../../components/item/ActionButton.js";
import { ActivityStream } from "../../components/item/ActivityStream.js";
import { ExecGlyph, GateGlyph, SourceChip, Status, Version } from "../../ui/index.js";
import { YourWork } from "./YourWork.js";
import "./ItemPage.css";

const TABS: { key: ItemTab; label: string }[] = [
  { key: "activity", label: "Activity" },
  { key: "worklog", label: "Worklog" },
  { key: "runs", label: "Runs" },
  { key: "requests", label: "Requests" },
];

export function ItemPage({
  eid,
  itemId,
  tab,
  run,
}: {
  eid: EngagementId;
  itemId: ItemId;
  tab?: ItemTab;
  run?: string | null;
}) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: qk.item(eid, itemId), queryFn: () => api.getItem(eid, itemId) });
  const plan = useQuery({ queryKey: qk.plan(eid), queryFn: () => api.getPlan(eid) });
  const [editing, setEditing] = useState(false);
  const [briefDraft, setBriefDraft] = useState("");
  const [acceptanceDraft, setAcceptanceDraft] = useState<string[]>([]);

  useEffect(() => setEditing(false), [itemId]);

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

  const { node, def, inputs, outputs, runs, activeRun, openRequests, actions } = q.data;
  const phase = plan.data?.items.find((i) => i.id === node.parent);

  // The URL always resolves a tab (shell/nav.ts defaults it to "activity"); to tell "the human
  // asked for activity" from "no ?tab= was given" (which should default to worklog once the item
  // isn't running — plan §4.3/brief B §Build 2), read the search string directly rather than the
  // already-defaulted `tab` prop.
  const explicitTab = typeof window !== "undefined" ? (new URLSearchParams(window.location.search).get("tab") as ItemTab | null) : null;
  const isRunning = node.status === "in_progress" || activeRun != null;
  const activeTab: ItemTab = explicitTab ?? tab ?? (isRunning ? "activity" : "worklog");

  const isHumanWork = node.executor === "human" && (node.status === "ready" || node.status === "in_progress");
  const shownRun: Run | null = activeRun ?? runs.find((r) => r.id === run) ?? runs[0] ?? null;

  return (
    <div className="item-page" data-testid="item-detail" data-item-id={itemId}>
      <header className="item-page-header">
        <div className="item-breadcrumb mono">
          {phase ? `${phase.id} › ${node.id}` : node.id}
        </div>
        <div className="item-page-title-row">
          <h1>{node.title}</h1>
          <ExecGlyph executor={node.executor ?? "agent"} />
          <Status status={node.status ?? "waiting"} />
        </div>
        {node.notReadyBecause.length > 0 && (
          <p className="helper-text" data-testid="not-ready-reason">
            Not ready because: {node.notReadyBecause.map(describeBlocker).join("; ")}
          </p>
        )}
        <div className="item-page-actions">
          <ActionButton label="Run" testId="action-start" allowed={actions.start} pending={start.isPending} onClick={() => start.mutate()} variant="ink" kbd="R" />
          <ActionButton label="Stop" testId="action-stop" allowed={actions.stop} pending={stop.isPending} onClick={() => stop.mutate()} />
          <ActionButton label="Resume" testId="action-resume" allowed={actions.resume} pending={resume.isPending} onClick={() => resume.mutate()} />
        </div>
      </header>

      <div className="item-page-columns">
        <section className="item-page-brief">
          <div className="section-header">
            <h3>Brief</h3>
            {!editing &&
              (actions.edit.allowed ? (
                <button
                  type="button"
                  className="link"
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
                <input key={i} type="text" value={a} onChange={(e) => setAcceptanceDraft((prev) => prev.map((x, idx) => (idx === i ? e.target.value : x)))} />
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
              <div className="reading markdown">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{def.brief}</ReactMarkdown>
              </div>
              {def.acceptance.length > 0 && (
                <>
                  <h4>Acceptance criteria</h4>
                  <ul className="reading acceptance-list">
                    {def.acceptance.map((a, i) => (
                      <li key={i}>{a}</li>
                    ))}
                  </ul>
                </>
              )}
            </>
          )}
        </section>

        <aside className="item-page-side">
          {inputs.length > 0 && (
            <div className="item-page-side-block">
              <span className="label">Inputs</span>
              <div className="row-wrap">
                {inputs.map((inp) =>
                  inp.available ? (
                    <SourceChip key={inp.slot} onClick={() => openDoc(eid, inp.slot, inp.available!.version)}>
                      {`${inp.slot} v${inp.available.version}`}
                    </SourceChip>
                  ) : (
                    <span key={inp.slot} className="muted">
                      {inp.slot} — not yet available (from {inp.producer})
                    </span>
                  ),
                )}
              </div>
            </div>
          )}

          {outputs.length > 0 && (
            <div className="item-page-side-block">
              <span className="label">Outputs</span>
              {outputs.map((out) => {
                const latest = out.versions.at(-1) ?? null;
                return (
                  <div key={out.slot} className="item-page-output-row">
                    <SourceChip onClick={() => latest && openDoc(eid, out.slotRef, latest.version)}>{out.slot}</SourceChip>
                    {latest ? <Version version={latest.version} kind={latest.kind} /> : <span className="muted">not yet published</span>}
                  </div>
                );
              })}
            </div>
          )}

          {node.gate.length > 0 && (
            <div className="item-page-side-block">
              <span className="label">Gate</span>
              <div className="pv-owner">
                <GateGlyph kind={node.gate[0]!.type === "endorsement" ? "endorse" : "review"} />
                {node.gate.map((g) => g.type.replace(/-/g, " ")).join(" → ")}
              </div>
            </div>
          )}

          {def.sources.length > 0 && <ItemSources eid={eid} sources={def.sources} />}

          {def.skills.length > 0 && (
            <div className="item-page-side-block" data-testid="item-skills">
              <span className="label">Skills</span>
              <div className="row-wrap">
                {def.skills.map((s) => (
                  <span key={s} className="tag tag-outline">
                    {s}
                  </span>
                ))}
              </div>
            </div>
          )}
        </aside>
      </div>

      {isHumanWork && <YourWork eid={eid} itemId={itemId} detail={q.data} />}

      <nav className="item-tabs">
        {TABS.map((t) => (
          <button key={t.key} type="button" className={activeTab === t.key ? "active" : ""} data-testid={`item-tab-${t.key}`} onClick={() => openItem(eid, itemId, { tab: t.key })}>
            {t.label}
          </button>
        ))}
      </nav>

      {activeTab === "worklog" && <Worklog eid={eid} itemId={itemId} />}
      {activeTab === "activity" && (shownRun ? <ActivityStream eid={eid} runId={shownRun.id} /> : <p className="muted">No run yet.</p>)}
      {activeTab === "runs" && (
        <table className="tracker runs-table" data-testid="runs-table">
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
              <tr key={r.id} className={r.id === activeRun?.id ? "run-active" : ""} onClick={() => openItem(eid, itemId, { tab: "activity", run: r.id })} data-testid={`run-row-${r.id}`}>
                <td className="mono">{r.id}</td>
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
      )}
      {activeTab === "requests" && (
        <ul className="item-requests-list">
          {openRequests.length === 0 && <li className="muted">No open requests.</li>}
          {openRequests.map((r) => (
            <li key={r.id}>
              {r.type} — {r.id}
              {r.type === "question" && r.to === "approach" && (
                <p className="helper-text" data-testid="question-routed-note">
                  Question sent to the Approach Agent
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function describeBlocker(b: { kind: string; slot?: string; item?: string; producer?: string }): string {
  if (b.kind === "missing_input") return `waiting for ${b.slot} (from ${b.producer})`;
  if (b.kind === "sequencing") return `waiting for ${b.item}`;
  if (b.kind === "input_not_approved") return `${b.slot} not yet approved`;
  return "no executor";
}

/** The task's attached Sources, named from the catalog; each links to the Source Catalog. */
function ItemSources({ eid, sources }: { eid: EngagementId; sources: SourceBinding[] }) {
  const catalog = useQuery({ queryKey: qk.sources(eid), queryFn: () => api.listSources(eid) });
  const byId = new Map((catalog.data ?? []).map((s) => [s.id, s]));
  return (
    <div className="item-page-side-block" data-testid="item-sources">
      <span className="label">Sources</span>
      <ul className="item-sources-list">
        {sources.map((b) => {
          const s = byId.get(b.id);
          return (
            <li key={b.id}>
              <button type="button" className="link" onClick={() => openSources(eid)}>
                {s?.title ?? b.id}
              </button>
              {s && <span className="muted"> · {s.freshness === "live" ? "live" : `edition ${s.edition ?? ""}`.trim()}</span>}
              <div className="helper-text">{b.purpose}</div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Worklog({ eid, itemId }: { eid: EngagementId; itemId: ItemId }) {
  const q = useQuery({ queryKey: qk.worklog(eid, itemId), queryFn: () => api.getWorklog(eid, itemId) });
  if (q.status === "pending") return <p>Loading worklog…</p>;
  if (q.status === "error") return <p role="alert">Could not load worklog: {(q.error as Error).message}</p>;
  return (
    <div className="reading markdown" data-testid="worklog-content">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{q.data.markdown}</ReactMarkdown>
    </div>
  );
}
