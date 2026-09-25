// UX1 brief B §Build 1: the Plan page — Canvas/Tracker toggle, the peek
// card, and the proposal bar while previewing. Selection and the view mode
// live in the URL (shell/nav's openPlan), so every plan state is deep-linkable
// (the proposal preview is `?preview=`).

import { useQuery } from "@tanstack/react-query";
import type { EngagementId, PlanPreviewView, PlanView } from "@workbench/core";
import { api, qk } from "../../api/index.js";
import { openDoc, openItem, openPlan, type PlanViewMode } from "../../shell/nav.js";
import { PlanCanvas } from "./PlanCanvas.js";
import { PlanTracker } from "./PlanTracker.js";
import { PeekCard } from "./PeekCard.js";
import { ProposalBar } from "./ProposalBar.js";
import "./PlanPage.css";

export function PlanPage({
  eid,
  sel = null,
  view = "canvas",
  preview = null,
}: {
  eid: EngagementId;
  sel?: string | null;
  view?: PlanViewMode;
  preview?: string | null;
}) {
  const planQuery = useQuery<PlanView>({ queryKey: qk.plan(eid), queryFn: () => api.getPlan(eid), enabled: preview == null });
  const previewQuery = useQuery<PlanPreviewView>({
    queryKey: preview ? qk.proposalPreview(eid, preview) : ["proposalPreview", eid, "none"],
    queryFn: () => api.previewProposal(eid, preview!),
    enabled: preview != null,
  });

  const active: PlanView | PlanPreviewView | undefined = preview ? previewQuery.data : planQuery.data;
  const loading = preview ? previewQuery.status === "pending" : planQuery.status === "pending";
  const error = preview ? previewQuery.status === "error" : planQuery.status === "error";

  const select = (id: string | null) => openPlan(eid, { view, sel: id, preview });
  const changeView = (v: PlanViewMode) => openPlan(eid, { view: v, sel, preview });
  const exitPreview = () => openPlan(eid, { view, sel, preview: null });

  return (
    <div className="plan-page" data-testid="plan-page">
      {preview && <ProposalBar eid={eid} pid={preview} preview={previewQuery.data} onExit={exitPreview} />}

      <div className="plan-toolbar">
        <div className="seg" role="group" aria-label="Plan view">
          <button type="button" aria-pressed={view === "canvas"} data-testid="plan-view-canvas" onClick={() => changeView("canvas")}>
            Canvas
          </button>
          <button type="button" aria-pressed={view === "tracker"} data-testid="plan-view-tracker" onClick={() => changeView("tracker")}>
            Tracker
          </button>
        </div>
      </div>

      {loading && <p className="muted">Loading the plan…</p>}
      {error && <p role="alert">Could not load the plan.</p>}

      {active &&
        (view === "canvas" ? (
          <PlanCanvas
            plan={active}
            sel={sel}
            isPreview={preview != null}
            onSelect={select}
            onOpen={(id) => openItem(eid, id)}
            onOpenDoc={(slotRef, version) => openDoc(eid, slotRef, version)}
          />
        ) : (
          <PlanTracker plan={active} sel={sel} onSelect={select} onOpen={(id) => openItem(eid, id)} />
        ))}

      {sel && <PeekCard eid={eid} itemId={sel} onClose={() => select(null)} onOpen={(id) => openItem(eid, id)} />}
    </div>
  );
}
