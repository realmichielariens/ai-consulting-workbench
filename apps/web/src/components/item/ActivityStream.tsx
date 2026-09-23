// The live/selected run's activity (J1.3, R4): readable summaries, raw
// detail/tool.input collapsed by default, auto-scroll that yields once the
// human scrolls up.

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ActivityItem, EngagementId, RunId } from "@workbench/core";
import { api, qk } from "../../api/index.js";

const KIND_ICON: Record<ActivityItem["kind"], string> = {
  text: "\u{1F4AC}",
  tool: "\u{1F527}",
  denial: "\u{26D4}",
  progress: "⏳",
  publish: "\u{1F4E4}",
  question: "❓",
  submit: "✅",
  nudge: "\u{1F449}",
  result: "\u{1F3C1}",
  error: "❌",
  system: "⚙️",
};

export function ActivityStream({ eid, runId }: { eid: EngagementId; runId: RunId }) {
  const q = useQuery({ queryKey: qk.runActivity(eid, runId), queryFn: () => api.getRunActivity(eid, runId), refetchInterval: false });
  const listRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  useEffect(() => {
    if (!autoScroll || !listRef.current) return;
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [q.data?.activity.length, autoScroll]);

  if (q.status === "pending") return <p>Loading activity…</p>;
  if (q.status === "error") return <p role="alert">Could not load activity: {(q.error as Error).message}</p>;

  return (
    <div
      className="activity-stream"
      data-testid="activity-stream"
      ref={listRef}
      onScroll={() => {
        const el = listRef.current;
        if (!el) return;
        setAutoScroll(el.scrollHeight - el.scrollTop - el.clientHeight < 24);
      }}
    >
      {q.data.activity.map((item) => (
        <ActivityRow key={item.idx} item={item} />
      ))}
    </div>
  );
}

export function ActivityRow({ item }: { item: ActivityItem }) {
  const [open, setOpen] = useState(false);
  const hasRaw = item.detail != null || item.tool?.input != null;
  return (
    <div className={`activity-row activity-${item.kind}`} data-testid="activity-item" data-kind={item.kind}>
      <span className="activity-icon" aria-hidden="true">
        {KIND_ICON[item.kind]}
      </span>
      <div className="activity-body">
        <div className="activity-summary">
          {item.summary}
          {item.agentId && <span className="badge subagent-badge"> subagent: {item.agentId}</span>}
        </div>
        <div className="activity-time">{new Date(item.at).toLocaleTimeString()}</div>
        {hasRaw && (
          <>
            <button type="button" className="link" data-testid="activity-raw-toggle" onClick={() => setOpen((v) => !v)}>
              {open ? "Hide" : "Show"} raw
            </button>
            {open && (
              <pre className="activity-raw">
                {item.detail}
                {item.tool?.input ? JSON.stringify(item.tool.input, null, 2) : ""}
              </pre>
            )}
          </>
        )}
      </div>
    </div>
  );
}
