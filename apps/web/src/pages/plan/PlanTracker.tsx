// UX1 brief B §Build 1: the Tracker view — the consultant's scan view of the
// plan (EXHIBIT §7.4). Grouped by phase, one row per leaf task, the same
// selection and peek as the canvas. Filters: All / Mine (human) / Running.

import { useState } from "react";
import type { ItemId, ItemNode, ItemStatus, PlanPreviewView, PlanView, SlotNode } from "@workbench/core";
import { ExecGlyph, GateGlyph, HarveyBall, Status, Tracker, Version, harveyFromRatio, type TrackerRow } from "../../ui/index.js";

type Filter = "all" | "mine" | "running";

/**
 * A Harvey ball is the share of children done (EXHIBIT §5.2). A leaf task is a
 * single child, so it is either done or not; a partial ball would invent progress.
 */
function taskQuarters(status: ItemStatus | null): 0 | 4 {
  return status === "done" ? 4 : 0;
}

export function PlanTracker({
  plan,
  sel,
  onSelect,
  onOpen,
}: {
  plan: PlanView | PlanPreviewView;
  sel: string | null;
  onSelect: (id: string) => void;
  onOpen: (id: string) => void;
}) {
  const [filter, setFilter] = useState<Filter>("all");

  const phases = plan.items.filter((i) => i.kind === "composite" && i.parent == null).sort((a, b) => a.order - b.order);
  const tasksByPhase = new Map<ItemId, ItemNode[]>();
  for (const item of plan.items) {
    if (item.kind !== "task") continue;
    if (filter === "mine" && item.executor !== "human") continue;
    if (filter === "running" && item.status !== "in_progress" && !item.activeRunId) continue;
    const key = item.parent ?? "__none__";
    const list = tasksByPhase.get(key) ?? [];
    list.push(item);
    tasksByPhase.set(key, list);
  }
  const slotsByRef = new Map(plan.slots.map((s) => [s.ref, s]));

  const rows: TrackerRow[] = [];
  for (const phase of phases) {
    const tasks = (tasksByPhase.get(phase.id) ?? []).sort((a, b) => a.order - b.order);
    if (tasks.length === 0) continue;
    rows.push({
      kind: "group",
      key: `group-${phase.id}`,
      label: (
        <>
          {phase.title}
          {phase.rollup && (
            <span className="pv-rollup">
              <HarveyBall quarters={harveyFromRatio(phase.rollup.done, phase.rollup.total)} /> {phase.rollup.done}/{phase.rollup.total}
            </span>
          )}
        </>
      ),
    });
    for (const item of tasks) rows.push(taskRow(item, slotsByRef, sel, onSelect, onOpen));
  }

  return (
    <div className="plan-tracker">
      <div className="seg" role="group" aria-label="Filter">
        {(["all", "mine", "running"] as const).map((f) => (
          <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}>
            {f === "all" ? "All" : f === "mine" ? "Mine" : "Running"}
          </button>
        ))}
      </div>
      <Tracker
        testId="tracker-table"
        columns={[
          { key: "item", header: "Item" },
          { key: "owner", header: "Owner" },
          { key: "status", header: "Status" },
          { key: "gate", header: "Gate" },
          { key: "outputs", header: "Outputs" },
          { key: "done", header: "Done", align: "right" },
        ]}
        rows={rows}
      />
    </div>
  );
}

function taskRow(item: ItemNode, slotsByRef: Map<string, SlotNode>, sel: string | null, onSelect: (id: string) => void, onOpen: (id: string) => void): TrackerRow {
  const outputs = item.outputs.map((ref) => slotsByRef.get(ref)).filter((s): s is SlotNode => s != null);
  return {
    kind: "row",
    key: item.id,
    testId: `tracker-row-${item.id}`,
    onClick: () => onSelect(item.id),
    cells: {
      item: (
        <span
          className={`tracker-item-cell${item.id === sel ? " tracker-row-selected" : ""}`}
          onDoubleClick={(e) => {
            e.stopPropagation();
            onOpen(item.id);
          }}
        >
          <span className="id">{item.id}</span> {item.title}
        </span>
      ),
      owner: (
        <span className="pv-owner">
          <ExecGlyph executor={item.executor ?? "agent"} /> {item.executor === "human" ? "You" : "Agent"}
        </span>
      ),
      status: <Status status={item.status ?? "waiting"} />,
      gate: item.gate.length > 0 ? <GateGlyph kind={item.gate[0]!.type === "endorsement" ? "endorse" : "review"} /> : <span className="muted">—</span>,
      outputs:
        outputs.length === 0 ? (
          <span className="muted">—</span>
        ) : (
          <span className="pv-outputs-cell">
            {outputs.map((s) => (s.latest ? <Version key={s.ref} version={s.latest.version} kind={s.latest.kind} /> : <span key={s.ref} className="muted">{s.name}: —</span>))}
          </span>
        ),
      done: <HarveyBall quarters={taskQuarters(item.status)} />,
    },
  };
}
