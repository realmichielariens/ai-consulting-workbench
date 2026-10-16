// Wires the per-engagement WebSocket into the React Query cache so the UI
// never needs a manual refresh (ITERATIONS.md §1.1-2). Mount once per open
// engagement (EngagementLayout).

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { parseSlotRef, type EngagementId, type RunActivityView, type WsServerMessage } from "@workbench/core";
import type { WorkbenchApi, WsStatus } from "./types.js";
import { qk } from "./queryKeys.js";

/** True if this query's key touches this engagement (used for the "hello" refetch-everything case). */
function belongsToEngagement(key: readonly unknown[], eid: EngagementId): boolean {
  return key[1] === eid;
}

export function useEngagementSocket(api: WorkbenchApi, eid: EngagementId): WsStatus {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<WsStatus>("connecting");
  // Avoids a stale-closure `queryClient`/`api` inside the WS callbacks across re-renders.
  const qcRef = useRef(queryClient);
  qcRef.current = queryClient;

  useEffect(() => {
    const onMessage = (msg: WsServerMessage) => {
      const qc = qcRef.current;
      if (msg.type === "hello") {
        void qc.invalidateQueries({ predicate: (q) => belongsToEngagement(q.queryKey as readonly unknown[], eid) });
        return;
      }
      if (msg.type === "activity") {
        qc.setQueryData<RunActivityView>(qk.runActivity(eid, msg.runId), (prev) => {
          if (!prev) return prev; // not cached yet; the next getRunActivity fetch will include it (persisted server/mock-side)
          if (prev.activity.some((a) => a.idx === msg.item.idx)) return prev;
          return { ...prev, activity: [...prev.activity, msg.item].sort((a, b) => a.idx - b.idx) };
        });
        return;
      }
      // msg.type === "event"
      const ev = msg.event;
      switch (ev.type) {
        case "EngagementCreated":
          void qc.invalidateQueries({ queryKey: qk.engagements() });
          break;
        case "ItemStatusChanged":
          void qc.invalidateQueries({ queryKey: qk.plan(eid) });
          void qc.invalidateQueries({ queryKey: qk.item(eid, ev.payload.itemId) });
          void qc.invalidateQueries({ queryKey: qk.inbox(eid) });
          void qc.invalidateQueries({ queryKey: qk.engagement(eid) });
          break;
        case "ItemEdited":
          void qc.invalidateQueries({ queryKey: qk.item(eid, ev.payload.itemId) });
          void qc.invalidateQueries({ queryKey: qk.plan(eid) });
          break;
        case "AssetPublished": {
          const { itemId, slot } = parseSlotRef(ev.payload.slot);
          void qc.invalidateQueries({ queryKey: qk.assetVersions(eid, itemId, slot) });
          void qc.invalidateQueries({ queryKey: qk.plan(eid) });
          // Consumers of this slot aren't known client-side; refresh every open item detail in this engagement.
          void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === "item" && q.queryKey[1] === eid });
          break;
        }
        case "WorklogAppended":
          void qc.invalidateQueries({ queryKey: qk.worklog(eid, ev.payload.itemId) });
          break;
        case "RequestOpened":
        case "RequestResolved":
          void qc.invalidateQueries({ queryKey: qk.inbox(eid) });
          void qc.invalidateQueries({ queryKey: qk.engagement(eid) });
          void qc.invalidateQueries({ queryKey: qk.item(eid, ev.payload.itemId) });
          break;
        case "GateVerdictRecorded":
          void qc.invalidateQueries({ queryKey: qk.item(eid, ev.payload.itemId) });
          void qc.invalidateQueries({ queryKey: qk.plan(eid) });
          void qc.invalidateQueries({ queryKey: qk.inbox(eid) });
          break;
        case "RunStarted":
        case "RunEnded":
          void qc.invalidateQueries({ queryKey: qk.item(eid, ev.payload.itemId) });
          void qc.invalidateQueries({ queryKey: qk.plan(eid) });
          void qc.invalidateQueries({ queryKey: qk.engagement(eid) });
          void qc.invalidateQueries({ queryKey: qk.inbox(eid) });
          if (ev.payload.threadId) void qc.invalidateQueries({ queryKey: qk.thread(eid, ev.payload.threadId) });
          break;
        case "GuardDenied":
          void qc.invalidateQueries({ queryKey: qk.item(eid, ev.payload.itemId) });
          break;
        case "LocusViolation":
        case "CheckpointCommitted":
        case "FeedbackNoted":
          break; // no query currently renders these directly

        // I2: conversation, proposals, routing, notifications, settings, journal
        case "ChatMessagePosted":
          void qc.invalidateQueries({ queryKey: qk.thread(eid, ev.payload.threadId) });
          break;
        case "ProposalCreated":
        case "ProposalApplied":
        case "ProposalRejected":
        case "ProposalSuperseded":
        case "PlanChanged":
          void qc.invalidateQueries({ queryKey: qk.proposals(eid) });
          void qc.invalidateQueries({ queryKey: qk.plan(eid) });
          void qc.invalidateQueries({ queryKey: qk.inbox(eid) });
          void qc.invalidateQueries({ queryKey: qk.engagement(eid) });
          break;
        case "QuestionRouted":
        case "QuestionEscalated":
        case "SuggestionDeclined":
          void qc.invalidateQueries({ queryKey: qk.inbox(eid) });
          void qc.invalidateQueries({ queryKey: qk.item(eid, ev.payload.itemId) });
          break;
        case "HumanNotified":
        case "NotificationDismissed":
          void qc.invalidateQueries({ queryKey: qk.inbox(eid) });
          void qc.invalidateQueries({ queryKey: qk.notifications(eid) });
          break;
        case "SettingsChanged":
          void qc.invalidateQueries({ queryKey: qk.engagement(eid) });
          break;
        case "JournalAppended":
          void qc.invalidateQueries({ queryKey: qk.journal(eid) });
          break;
      }
    };

    const close = api.connectWs(eid, onMessage, setStatus);
    return close;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- api is a stable module-level object
  }, [eid]);

  return status;
}
