// D§10.1 (simplified for I1/I2): header, left panel (Chat / Inbox / Approach
// tabs), center process view v0, right detail panel (item detail or asset
// viewer). Mounts the WebSocket once per open engagement (useEngagementSocket)
// — no page refresh is ever needed from here on.

import { useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { EngagementId } from "@workbench/core";
import { api, qk, useEngagementSocket } from "../api/index.js";
import { goHome, useRoute } from "../state/url.js";
import { useUiStore, type EngagementTab } from "../state/ui.js";
import { Inbox } from "./Inbox.js";
import { ChatPanel } from "./chat/ChatPanel.js";
import { ApproachTab } from "./ApproachTab.js";
import { SettingsPanel } from "./SettingsPanel.js";
import { ProcessView } from "./process/ProcessView.js";
import { ItemDetail } from "./item/ItemDetail.js";
import { AssetViewer } from "./AssetViewer.js";
import { FeedbackModal } from "./FeedbackModal.js";

export function EngagementLayout({ eid }: { eid: EngagementId }) {
  const route = useRoute();
  const wsStatus = useEngagementSocket(api, eid);
  const engagement = useQuery({ queryKey: qk.engagement(eid), queryFn: () => api.getEngagement(eid) });
  const plan = useQuery({ queryKey: qk.plan(eid), queryFn: () => api.getPlan(eid) });
  const openFeedback = useUiStore((s) => s.openFeedback);
  const openSettings = useUiStore((s) => s.openSettings);
  const tab = useUiStore((s) => s.tabs[eid]);
  const setTab = useUiStore((s) => s.setTab);

  const openFolder = useMutation({ mutationFn: () => api.openFolder(eid) });

  // Brief C §3: default to Chat for an engagement whose plan has only ENG
  // (nothing proposed yet), else Inbox. Picked once per engagement, then remembered.
  useEffect(() => {
    if (tab || !plan.data) return;
    setTab(eid, plan.data.items.length <= 1 ? "chat" : "inbox");
  }, [tab, plan.data, eid, setTab]);

  if (engagement.status === "pending") return <p>Loading engagement…</p>;
  if (engagement.status === "error") return <p role="alert">Could not load engagement: {(engagement.error as Error).message}</p>;
  const eng = engagement.data;
  const activeTab: EngagementTab = tab ?? "inbox";

  const currentView = route.item ? "item" : route.asset ? "asset" : "plan";

  return (
    <div className="engagement-layout">
      <header className="eng-header">
        <button type="button" className="link" data-testid="back-to-start" onClick={goHome}>
          {"←"} Start
        </button>
        <h1>{eng.name}</h1>
        <span className="muted" data-testid="plan-version">
          plan v{eng.planVersion}
        </span>
        <span className="badge" data-testid="runtime-badge">
          {eng.runtime} · {eng.profile} · work {eng.workModel} · approach {eng.approachModel}
        </span>
        <span className="badge" data-testid="cost-total">
          ${eng.costUsd.toFixed(3)}
        </span>
        <span className="badge" data-testid="inbox-count">
          Inbox ({eng.inboxCount})
        </span>
        <button type="button" data-testid="open-folder" onClick={() => openFolder.mutate()}>
          Open folder
        </button>
        {openFolder.data && (
          <span className="folder-path" data-testid="folder-path">
            {openFolder.data.path}
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(openFolder.data.path);
              }}
            >
              Copy
            </button>
          </span>
        )}
        <button type="button" data-testid="open-settings" onClick={openSettings}>
          Settings
        </button>
        <button type="button" data-testid="open-feedback" onClick={openFeedback}>
          Feedback
        </button>
        <span className={`ws-indicator ws-${wsStatus}`} data-testid="ws-status" title={`WebSocket: ${wsStatus}`}>
          {"●"} {wsStatus}
        </span>
      </header>

      <div className="eng-body">
        <aside className="eng-inbox">
          <nav className="eng-tabs">
            <button type="button" data-testid="tab-chat" className={activeTab === "chat" ? "active" : ""} onClick={() => setTab(eid, "chat")}>
              Chat
            </button>
            <button type="button" data-testid="tab-inbox" className={activeTab === "inbox" ? "active" : ""} onClick={() => setTab(eid, "inbox")}>
              Inbox ({eng.inboxCount})
            </button>
            <button type="button" data-testid="tab-approach" className={activeTab === "approach" ? "active" : ""} onClick={() => setTab(eid, "approach")}>
              Approach
            </button>
          </nav>
          {activeTab === "chat" && <ChatPanel eid={eid} />}
          {activeTab === "inbox" && <Inbox eid={eid} />}
          {activeTab === "approach" && <ApproachTab eid={eid} />}
        </aside>

        <main className="eng-process">
          <ProcessView eid={eid} />
        </main>

        <aside className="eng-detail">
          {currentView === "item" && route.item && <ItemDetail eid={eid} itemId={route.item} />}
          {currentView === "asset" && route.asset && <AssetViewer eid={eid} itemId={route.asset.itemId} slot={route.asset.slot} version={route.asset.version} />}
          {currentView === "plan" && <p className="muted">Select a task or a data object to see its detail.</p>}
        </aside>
      </div>

      <FeedbackModal eid={eid} view={currentView} itemId={route.item ?? route.asset?.itemId ?? null} />
      <SettingsPanel eid={eid} engagement={eng} />
    </div>
  );
}
