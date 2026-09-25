// REDESIGN-PLAN §6.3, UX1-PLAN §Build 2: home once the plan has more than
// ENG (D1). "In 30 seconds, see what needs you and act on it."

import { useQuery } from "@tanstack/react-query";
import type { EngagementId, ItemNode, SlotNode } from "@workbench/core";
import { api, qk } from "../../api/index.js";
import { openDoc } from "../../shell/nav.js";
import { HarveyBall, harveyFromRatio, Status, ExecGlyph, Version } from "../../ui/index.js";
import { DecisionList } from "../../components/decisions/DecisionList.js";
import { briefHeadline, formatBriefDate } from "./briefHeadline.js";
import "./BriefPage.css";

export function BriefPage({ eid }: { eid: EngagementId }) {
  const inbox = useQuery({ queryKey: qk.inbox(eid), queryFn: () => api.getInbox(eid) });
  const plan = useQuery({ queryKey: qk.plan(eid), queryFn: () => api.getPlan(eid) });

  if (inbox.status === "pending" || plan.status === "pending") return <p className="muted">Loading the Brief…</p>;
  if (inbox.status === "error") return <p role="alert">Could not load the Inbox: {(inbox.error as Error).message}</p>;
  if (plan.status === "error") return <p role="alert">Could not load the plan: {(plan.error as Error).message}</p>;

  const { title, standfirst } = briefHeadline(inbox.data.entries, plan.data);
  const decisionsCount = inbox.data.entries.filter((e) => e.kind !== "fyi").length;

  const runningAgentItems = plan.data.items.filter((i) => i.activeRunId != null);
  const humanInProgress = plan.data.items.filter((i) => i.executor === "human" && i.status === "in_progress" && i.activeRunId == null);
  const published = plan.data.slots
    .filter((s): s is SlotNode & { latest: NonNullable<SlotNode["latest"]> } => s.latest != null)
    .sort((a, b) => new Date(b.latest.at).getTime() - new Date(a.latest.at).getTime())
    .slice(0, 5);
  const phases = plan.data.items.filter((i) => i.kind === "composite");

  return (
    <div className="brief-page" data-testid="brief-page">
      <div className="brief-kicker">{formatBriefDate(new Date())}</div>
      <h1 className="brief-title" data-testid="brief-title">
        {title}
      </h1>
      {standfirst && <p className="brief-standfirst">{standfirst}</p>}

      <div className="brief-cols">
        <div>
          <div className="col-h">
            <span className="label">Needs you · by consequence</span>
            <span className="muted">{decisionsCount}</span>
          </div>
          <DecisionList eid={eid} entries={inbox.data.entries} />
        </div>

        <div className="brief-side">
          <div className="col-h">
            <span className="label">In flight</span>
            <span className="muted">{runningAgentItems.length + humanInProgress.length}</span>
          </div>
          <div className="running-list" data-testid="inflight-list">
            {runningAgentItems.length + humanInProgress.length === 0 && <p className="muted">Nothing running right now.</p>}
            {runningAgentItems.map((item) => (
              <InFlightAgentRow key={item.id} eid={eid} item={item} />
            ))}
            {humanInProgress.map((item) => (
              <InFlightHumanRow key={item.id} item={item} />
            ))}
          </div>

          <div className="col-h brief-side-gap">
            <span className="label">Published recently</span>
          </div>
          <div className="running-list" data-testid="published-list">
            {published.length === 0 && <p className="muted">Nothing published yet.</p>}
            {published.map((slot) => (
              <button type="button" className="published-row" key={slot.ref} onClick={() => openDoc(eid, slot.ref)}>
                <span>
                  {slot.name}.{slot.format} <Version version={slot.latest.version} kind={slot.latest.kind} />
                </span>
                <span className="muted">{shortTime(slot.latest.at)}</span>
              </button>
            ))}
          </div>

          <div className="col-h brief-side-gap">
            <span className="label">Plan health</span>
          </div>
          <div className="plan-health">
            {phases.map((phase) => (
              <span key={phase.id} className="plan-health-phase">
                <span className="id">{phase.id}</span>
                <HarveyBall quarters={harveyFromRatio(phase.rollup?.done ?? 0, phase.rollup?.total ?? 0)} label={`${phase.title}: ${phase.rollup?.done ?? 0} of ${phase.rollup?.total ?? 0} done`} />
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function InFlightAgentRow({ eid, item }: { eid: EngagementId; item: ItemNode }) {
  const q = useQuery({
    queryKey: qk.runActivity(eid, item.activeRunId!),
    queryFn: () => api.getRunActivity(eid, item.activeRunId!),
    enabled: item.activeRunId != null,
    refetchInterval: false,
  });
  const last = q.data?.activity[q.data.activity.length - 1];
  return (
    <div className="running-row">
      <div>
        <span className="id">{item.id}</span> {item.title}
        {item.status && <Status status={item.status} bare />}
      </div>
      {last && <div className="running-line">{last.summary}</div>}
    </div>
  );
}

function InFlightHumanRow({ item }: { item: ItemNode }) {
  return (
    <div className="running-row">
      <div>
        <span className="id">{item.id}</span> {item.title}
        <span className="running-exec">
          <ExecGlyph executor="human" /> You
        </span>
      </div>
    </div>
  );
}

function shortTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : d.toLocaleDateString([], { day: "2-digit", month: "short" });
}
