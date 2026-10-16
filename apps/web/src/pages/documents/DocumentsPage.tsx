// UX1 brief B §Build 4: the Documents register — "what have we produced,
// and what state is it in?" (REDESIGN-PLAN §6.7). A Tracker over
// PlanView.slots, grouped by the owner's phase.

import { useQuery } from "@tanstack/react-query";
import type { EngagementId, ItemId, SlotNode } from "@workbench/core";
import { api, qk } from "../../api/index.js";
import { openDoc } from "../../shell/nav.js";
import { Tracker, Version, type TrackerRow } from "../../ui/index.js";
import "./DocumentsPage.css";

const ENGAGEMENT_GROUP = "__engagement__";

export function DocumentsPage({ eid }: { eid: EngagementId }) {
  const plan = useQuery({ queryKey: qk.plan(eid), queryFn: () => api.getPlan(eid) });

  if (plan.status === "pending") return <p>Loading documents…</p>;
  if (plan.status === "error") return <p role="alert">Could not load documents: {(plan.error as Error).message}</p>;

  const itemsById = new Map(plan.data.items.map((i) => [i.id, i]));
  const phases = plan.data.items.filter((i) => i.kind === "composite" && i.parent == null).sort((a, b) => a.order - b.order);

  const byGroup = new Map<ItemId | typeof ENGAGEMENT_GROUP, typeof plan.data.slots>();
  for (const slot of plan.data.slots) {
    const owner = itemsById.get(slot.owner);
    const key = owner?.parent ?? ENGAGEMENT_GROUP;
    byGroup.set(key, [...(byGroup.get(key) ?? []), slot]);
  }

  const rows: TrackerRow[] = [];
  const engSlots = byGroup.get(ENGAGEMENT_GROUP) ?? [];
  if (engSlots.length > 0) {
    rows.push({ kind: "group", key: "group-eng", label: "Engagement" });
    for (const slot of engSlots) rows.push(slotRow(eid, slot, itemsById));
  }
  for (const phase of phases) {
    const slots = byGroup.get(phase.id) ?? [];
    if (slots.length === 0) continue;
    rows.push({ kind: "group", key: `group-${phase.id}`, label: phase.title });
    for (const slot of slots) rows.push(slotRow(eid, slot, itemsById));
  }

  if (rows.length === 0) return <p className="muted">No documents yet.</p>;

  return (
    <div className="documents-page">
      <Tracker
        testId="documents-table"
        columns={[
          { key: "name", header: "Name" },
          { key: "owner", header: "Owner" },
          { key: "format", header: "Format" },
          { key: "scope", header: "Scope" },
          { key: "latest", header: "Latest" },
          { key: "versions", header: "Versions", align: "right" },
          { key: "consumers", header: "Consumers", align: "right" },
          { key: "published", header: "Last published" },
        ]}
        rows={rows}
      />
    </div>
  );
}

function slotRow(eid: EngagementId, slot: SlotNode, itemsById: ReadonlyMap<ItemId, { title: string }>): TrackerRow {
  return {
    kind: "row",
    key: slot.ref,
    testId: `documents-row-${slot.ref}`,
    onClick: () => openDoc(eid, slot.ref, slot.latest?.version ?? null),
    cells: {
      name: <span className="mono">{slot.name}</span>,
      owner: <span>{itemsById.get(slot.owner)?.title ?? slot.owner}</span>,
      format: <span className="muted">{slot.format}</span>,
      scope: <span className="muted">{slot.scope}</span>,
      latest: slot.latest ? <Version version={slot.latest.version} kind={slot.latest.kind} /> : <span className="muted">not published</span>,
      versions: <span>{slot.versionCount}</span>,
      consumers: <span>{slot.consumers.length}</span>,
      published: <span className="muted">{slot.latest ? new Date(slot.latest.at).toLocaleDateString() : "—"}</span>,
    },
  };
}
