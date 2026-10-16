// UX1 brief B §Build 2: the live/selected run's activity, restyled as the
// Exhibit stream (EXHIBIT §7.4): a mono timestamp, a signal dot, then a line
// of prose. No emoji (EXHIBIT §8) — the icon map is replaced by a coloured
// dot. Reused as-is by the rail's ChatPanel (plan §4: "Become the Item
// page"), so the exported names and props stay stable.

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ActivityItem, EngagementId, RunId } from "@workbench/core";
import { api, qk } from "../../api/index.js";
import "./ActivityStream.css";

// "implicit" (a dotted caution outline) is EXHIBIT §7.4's fourth stream dot; it needs the
// implicit-read tracking that arrives in I4, so only read/write/ask/positive/caution/critical are reachable here.
type DotKind = "read" | "write" | "ask" | "positive" | "caution" | "critical";

function dotKind(item: ActivityItem): DotKind {
  switch (item.kind) {
    case "text":
    case "result":
    case "system":
    case "progress":
      return "read";
    case "tool":
      // Web search and fetch take information in, like Read.
      return /read|^Web/i.test(item.tool?.name ?? "") ? "read" : "write";
    case "publish":
    case "submit":
      return "positive";
    case "question":
      return "ask";
    case "nudge":
      return "caution";
    case "denial":
    case "error":
      return "critical";
  }
}

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
      <time className="mono">{new Date(item.at).toLocaleTimeString()}</time>
      <i className={`activity-dot activity-dot-${dotKind(item)}`} aria-hidden="true" />
      <div className="activity-body">
        <div className="activity-summary">
          {item.summary}
          {item.sourceId && (
            <span className="tag tag-src" data-testid="activity-source">
              {item.sourceId}
            </span>
          )}
          {item.agentId && <span className="tag">subagent: {item.agentId}</span>}
        </div>
        {item.links && item.links.length > 0 && (
          <ul className="activity-links" data-testid="activity-links">
            {item.links.map((l) => (
              <li key={l.url}>
                <a href={l.url} target="_blank" rel="noreferrer noopener" title={l.url}>
                  {l.title ?? l.url}
                </a>
              </li>
            ))}
          </ul>
        )}
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
