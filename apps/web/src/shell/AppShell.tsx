// UX1 brief A §Build 5: the Exhibit shell for an open engagement — nav rail,
// top bar, stage tabs, stage, Approach rail, dev strip. Mounted by App.tsx
// for every /e/:eid/** route. Replaces components/EngagementLayout.tsx.

import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { EngagementId } from "@workbench/core";
import { api, qk, useEngagementSocket } from "../api/index.js";
import {
  openConversation,
  openDoc,
  openDocuments,
  openHome,
  openItem,
  openJournal,
  openPlan,
  useLegacyRedirect,
  useStageRoute,
  backToStart,
} from "./nav.js";
import { useTabsStore } from "./tabs.js";
import { useRailStore } from "./rail.js";
import { useShortcut } from "./shortcuts.js";
import { useUiStore } from "../state/ui.js";
import { useApplyPreferences, usePreferencesStore } from "../state/preferences.js";
import { HarveyBall, harveyFromRatio, DocGlyph } from "../ui/index.js";
import { SettingsPanel } from "../components/SettingsPanel.js";
import { FeedbackModal } from "../components/FeedbackModal.js";
import { RailContent } from "../rail/RailContent.js";
import { PlanPage } from "../pages/plan/PlanPage.js";
import { ItemPage } from "../pages/item/ItemPage.js";
import { DocumentPage } from "../pages/doc/DocumentPage.js";
import { DocumentsPage } from "../pages/documents/DocumentsPage.js";
import { BriefPage } from "../pages/brief/BriefPage.js";
import { KickoffPage } from "../pages/kickoff/KickoffPage.js";
import { JournalPage } from "../pages/journal/JournalPage.js";
import "./AppShell.css";

export function AppShell({ eid }: { eid: EngagementId }) {
  useApplyPreferences();
  useLegacyRedirect();

  const route = useStageRoute();
  const wsStatus = useEngagementSocket(api, eid);
  const engagement = useQuery({ queryKey: qk.engagement(eid), queryFn: () => api.getEngagement(eid) });
  const plan = useQuery({ queryKey: qk.plan(eid), queryFn: () => api.getPlan(eid) });
  const openFolder = useMutation({ mutationFn: () => api.openFolder(eid) });
  const [folderCopied, setFolderCopied] = useState(false);

  const openSettings = useUiStore((s) => s.openSettings);
  const openFeedback = useUiStore((s) => s.openFeedback);

  const rail = useRailStore();
  const railRef = useRef<HTMLElement>(null);
  const resizing = useRef(false);
  useShortcut("\\", () => rail.toggle());

  const hydrateTabs = useTabsStore((s) => s.hydrate);
  const openTab = useTabsStore((s) => s.openTab);
  const closeTab = useTabsStore((s) => s.closeTab);
  const objectTabs = useTabsStore((s) => s.tabsFor(eid));

  useEffect(() => hydrateTabs(eid), [eid, hydrateTabs]);

  const isKickoff = (plan.data?.items.length ?? 2) <= 1;

  // Register/focus the object tab for whatever the route currently shows (brief A §Build 4).
  useEffect(() => {
    if (route.page === "item") {
      const item = plan.data?.items.find((i) => i.id === route.itemId);
      openTab(eid, { key: `item-${route.itemId}`, kind: "item", label: item ? item.title : route.itemId });
    } else if (route.page === "doc") {
      const slotNode = plan.data?.slots.find((s) => s.owner === route.itemId && s.name === route.slot);
      const version = route.version ?? slotNode?.latest?.version ?? "";
      const fileLabel = slotNode ? `${slotNode.name}.${slotNode.format}` : route.slot;
      openTab(eid, { key: `doc-${route.itemId}/${route.slot}`, kind: "doc", label: version ? `${fileLabel} ${version}` : fileLabel });
    } else if (route.page === "journal") {
      openTab(eid, { key: "journal", kind: "journal", label: "Journal" });
    } else if (route.page === "conversation") {
      openTab(eid, { key: "conversation", kind: "conversation", label: "Conversation" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-run when the route target or the plan data changes
  }, [eid, route.page, route.page === "item" ? route.itemId : null, route.page === "doc" ? `${route.itemId}/${route.slot}/${route.version}` : null, plan.data]);

  function navigateToKey(key: string): void {
    if (key === "home") return openHome(eid);
    if (key === "plan") return openPlan(eid);
    if (key === "journal") return openJournal(eid);
    if (key === "conversation") return openConversation(eid);
    if (key.startsWith("item-")) return openItem(eid, key.slice("item-".length));
    if (key.startsWith("doc-")) return openDoc(eid, key.slice("doc-".length));
  }

  function handleCloseTab(key: string, isActive: boolean): void {
    const orderedBefore: string[] = ["home", "plan", ...objectTabs.map((t) => t.key)];
    const idx = orderedBefore.indexOf(key);
    closeTab(eid, key);
    if (!isActive) return;
    const neighbour = orderedBefore[Math.max(0, idx - 1)] ?? "home";
    navigateToKey(neighbour);
  }

  // Rail resize by drag (320-480px, brief A §Build 5).
  function startResize(e: ReactPointerEvent<HTMLDivElement>): void {
    e.preventDefault();
    resizing.current = true;
    const startX = e.clientX;
    const startWidth = rail.width;
    function onMove(ev: PointerEvent): void {
      if (!resizing.current) return;
      const delta = startX - ev.clientX;
      rail.setWidth(startWidth + delta);
    }
    function onUp(): void {
      resizing.current = false;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  if (engagement.status === "pending" || plan.status === "pending") return <p className="shell-loading">Loading engagement…</p>;
  if (engagement.status === "error") return <p role="alert">Could not load engagement: {(engagement.error as Error).message}</p>;
  const eng = engagement.data;

  const activeKey = activeTabKey(route);
  const homeLabel = isKickoff ? "Kick-off" : "Brief";
  const liveCount = plan.data?.items.filter((i) => i.activeRunId).length ?? 0;
  const hideRail = (route.page === "home" && isKickoff) || route.page === "conversation";

  return (
    <div className="app-shell" data-testid="app-shell" data-rail-open={rail.open && !hideRail ? "true" : "false"}>
      <nav className="nav-rail" aria-label="Engagement">
        <button type="button" className="nav-logo" data-testid="back-to-start" title="Back to Engagements" onClick={backToStart}>
          W
        </button>
        <button type="button" data-testid="nav-home" title="Home" aria-current={route.page === "home"} onClick={() => openHome(eid)}>
          <HomeIcon />
          {eng.inboxCount > 0 && (
            <span className="nav-badge" data-testid="inbox-count">
              {eng.inboxCount}
            </span>
          )}
        </button>
        <button type="button" data-testid="nav-plan" title="Plan" aria-current={route.page === "plan"} onClick={() => openPlan(eid)}>
          <PlanIcon />
        </button>
        <button type="button" data-testid="nav-documents" title="Documents" aria-current={route.page === "documents"} onClick={() => openDocuments(eid)}>
          <DocumentsIcon />
        </button>
        <span className="nav-spacer" />
        <button type="button" data-testid="open-settings" title="Settings" onClick={openSettings}>
          <SettingsIcon />
        </button>
      </nav>

      <header className="topbar">
        <div className="topbar-eng">
          <b>{eng.name}</b>
        </div>
        <span className="topbar-sep" />
        <div className="topbar-kpi" data-testid="progress-kpi">
          <span className="label">Progress</span>
          <b>
            <HarveyBall quarters={harveyFromRatio(eng.progress.done, eng.progress.total)} />
            {eng.progress.done} / {eng.progress.total}
          </b>
        </div>
        <div className="topbar-kpi" data-testid="plan-version">
          <span className="label">Plan</span>
          <b>v{eng.planVersion}</b>
        </div>
        <div className="topbar-kpi">
          <span className="label">Spend</span>
          <b>${eng.costUsd.toFixed(2)}</b>
        </div>
        <span className="topbar-spacer" />
        {liveCount > 0 && (
          <span className="live-indicator">
            <i /> {liveCount} agent{liveCount === 1 ? "" : "s"} running
          </span>
        )}
        <button type="button" className="btn btn-ghost btn-sm" data-testid="rail-toggle" onClick={rail.toggle}>
          {rail.open ? "Approach ›" : "‹ Approach"}
        </button>
      </header>

      <div className="stage">
        <div className="stage-tabs" role="tablist">
          <button type="button" role="tab" data-testid="stage-tab-home" aria-selected={activeKey === "home"} onClick={() => openHome(eid)}>
            {homeLabel}
          </button>
          <button type="button" role="tab" data-testid="stage-tab-plan" aria-selected={activeKey === "plan"} onClick={() => openPlan(eid)}>
            Plan
          </button>
          {objectTabs.map((tab) => (
            <button
              type="button"
              role="tab"
              key={tab.key}
              data-testid={`stage-tab-${tab.key}`}
              aria-selected={activeKey === tab.key}
              onClick={() => navigateToKey(tab.key)}
            >
              {tab.kind === "doc" && <DocGlyph filled />}
              {tab.label}
              <span
                className="stage-tab-close"
                data-testid={`stage-tab-close-${tab.key}`}
                onClick={(e) => {
                  e.stopPropagation();
                  handleCloseTab(tab.key, activeKey === tab.key);
                }}
              >
                {"✕"}
              </span>
            </button>
          ))}
        </div>

        <div className="stage-body">
          {route.page === "home" && (isKickoff ? <KickoffPage eid={eid} /> : <BriefPage eid={eid} />)}
          {route.page === "plan" && <PlanPage eid={eid} sel={route.sel} view={route.view} preview={route.preview} />}
          {route.page === "documents" && <DocumentsPage eid={eid} />}
          {route.page === "item" && <ItemPage eid={eid} itemId={route.itemId} tab={route.tab} run={route.run} />}
          {route.page === "doc" && <DocumentPage eid={eid} itemId={route.itemId} slot={route.slot} version={route.version} />}
          {route.page === "journal" && <JournalPage eid={eid} />}
          {route.page === "conversation" && <RailContent eid={eid} />}
        </div>
      </div>

      {!hideRail && (
        <aside className={`approach-rail${rail.open ? "" : " approach-rail-closed"}`} data-testid="approach-rail" ref={railRef} style={{ width: rail.open ? rail.width : 0 }}>
          {rail.open && (
            <>
              <div className="rail-resize-handle" onPointerDown={startResize} />
              <div className="rail-head">
                <span className="avatar avatar-aa">A</span>
                <b>Approach Agent</b>
                <span className="topbar-spacer" />
                <button type="button" className="btn btn-ghost btn-sm" data-testid="rail-journal" title="Journal" onClick={() => openJournal(eid)}>
                  Journal
                </button>
                <button type="button" className="btn btn-ghost btn-sm" data-testid="rail-expand" title="Expand" onClick={() => openConversation(eid)}>
                  {"⤤"}
                </button>
                <button type="button" className="btn btn-ghost btn-sm" title="Collapse" onClick={() => rail.setOpen(false)}>
                  {"✕"}
                </button>
              </div>
              <div className="rail-body">
                <RailContent eid={eid} />
              </div>
            </>
          )}
        </aside>
      )}

      <SettingsPanel eid={eid} engagement={eng} />
      <FeedbackModal eid={eid} view={route.page} itemId={route.page === "item" ? route.itemId : null} />

      <DevStrip eng={eng} wsStatus={wsStatus} openFolder={() => openFolder.mutate()} folderPath={openFolder.data?.path ?? null} onCopyFolder={() => setFolderCopied(true)} folderCopied={folderCopied} onFeedback={openFeedback} />
    </div>
  );
}

function activeTabKey(route: ReturnType<typeof useStageRoute>): string {
  switch (route.page) {
    case "home":
      return "home";
    case "plan":
      return "plan";
    case "item":
      return `item-${route.itemId}`;
    case "doc":
      return `doc-${route.itemId}/${route.slot}`;
    case "journal":
      return "journal";
    case "conversation":
      return "conversation";
    default:
      return "";
  }
}

function DevStrip({
  eng,
  wsStatus,
  openFolder,
  folderPath,
  onCopyFolder,
  folderCopied,
  onFeedback,
}: {
  eng: { runtime: string; profile: string; workModel: string; approachModel: string; costUsd: number };
  wsStatus: string;
  openFolder: () => void;
  folderPath: string | null;
  onCopyFolder: () => void;
  folderCopied: boolean;
  onFeedback: () => void;
}) {
  const devStripVisible = usePreferencesStore((s) => s.devStrip);
  if (!devStripVisible) return null;

  return (
    <footer className="dev-strip" data-testid="dev-strip">
      <span className="dev-strip-item" data-testid="runtime-badge">
        {eng.runtime} · {eng.profile} · work {eng.workModel} · approach {eng.approachModel}
      </span>
      <span className={`dev-strip-item ws-${wsStatus}`} data-testid="ws-status">
        {"●"} {wsStatus}
      </span>
      <span className="dev-strip-item" data-testid="cost-total">
        ${eng.costUsd.toFixed(3)}
      </span>
      <button type="button" className="btn btn-ghost btn-sm" data-testid="open-folder" onClick={openFolder}>
        Open folder
      </button>
      {folderPath && (
        <span className="dev-strip-item" data-testid="folder-path">
          {folderPath}
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              void navigator.clipboard?.writeText(folderPath);
              onCopyFolder();
            }}
          >
            {folderCopied ? "Copied" : "Copy"}
          </button>
        </span>
      )}
      <span className="dev-strip-spacer" />
      <button type="button" className="btn btn-ghost btn-sm" data-testid="open-feedback" onClick={onFeedback}>
        Feedback
      </button>
    </footer>
  );
}

function HomeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M3 3h12v12H3z" />
      <path d="M6 7h6M6 10h6M6 13h3" />
    </svg>
  );
}
function PlanIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="2" y="3" width="5" height="4" />
      <rect x="11" y="3" width="5" height="4" />
      <rect x="6.5" y="11" width="5" height="4" />
      <path d="M7 5h4M4.5 7v2.5H9V11M13.5 7v2.5H9" />
    </svg>
  );
}
function DocumentsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M4 2h7l3 3v11H4z" />
      <path d="M11 2v3h3M6.5 9h5M6.5 12h5" />
    </svg>
  );
}
function SettingsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="9" cy="9" r="2.5" />
      <path d="M9 1.5v2.5M9 14v2.5M1.5 9H4M14 9h2.5M3.7 3.7l1.8 1.8M12.5 12.5l1.8 1.8M3.7 14.3l1.8-1.8M12.5 5.5l1.8-1.8" />
    </svg>
  );
}
