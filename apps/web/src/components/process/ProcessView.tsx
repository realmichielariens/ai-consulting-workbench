// Process view v0 (J1.2): React Flow + ELK layered layout. Phases are
// always-expanded frames with a roll-up badge; tasks show 🤖/👤, status and a
// ◇ gate marker; data objects show their slot + version, dashed while empty.
// Read-only (no drag), click opens the detail panel. Re-layout on plan
// changes without a jarring jump: fitView only runs on the very first mount.

import { useEffect, useMemo, useRef, useState } from "react";
import { ReactFlow, Background, Controls, type Edge, type Node, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useQuery } from "@tanstack/react-query";
import type { EngagementId, ItemNode, PlanView, SlotNode } from "@workbench/core";
import { api, qk } from "../../api/index.js";
import { selectAsset, selectItem } from "../../state/url.js";
import { layoutPlan, type LayoutResult } from "./layout.js";

type FlowNodeData = { plan: PlanView } & ({ kind: "composite"; item: ItemNode } | { kind: "task"; item: ItemNode } | { kind: "data"; slot: SlotNode });

function statusClass(status: string | null): string {
  return status ? `status-${status}` : "status-none";
}

function CompositeNode({ data }: NodeProps<Node<FlowNodeData, "composite">>) {
  if (data.kind !== "composite") return null;
  const { item } = data;
  const rollup = item.rollup;
  return (
    <div className="pv-composite" data-testid={`process-node-${item.id}`}>
      <div className="pv-composite-header">
        <span>{item.title}</span>
        {rollup && (
          <span className="badge" data-testid={`process-rollup-${item.id}`}>
            {rollup.done}/{rollup.total} done{rollup.worst && rollup.worst !== "done" ? ` · worst: ${rollup.worst.replace(/_/g, " ")}` : ""}
          </span>
        )}
      </div>
    </div>
  );
}

function TaskNode({ data }: NodeProps<Node<FlowNodeData, "task">>) {
  if (data.kind !== "task") return null;
  const { item } = data;
  const icon = item.executor === "agent" ? "\u{1F916}" : "\u{1F464}";
  const hasGate = item.gate.length > 0;
  return (
    <button
      type="button"
      className={`pv-task ${statusClass(item.status)}`}
      data-testid={`process-node-${item.id}`}
      title={item.notReadyBecause.length > 0 ? describeBlockers(item) : undefined}
      onClick={() => selectItem(item.id)}
    >
      <div className="pv-task-top">
        <span aria-hidden="true">{icon}</span>
        <span className="pv-task-id">{item.id}</span>
        {hasGate && (
          <span className="pv-gate" title="Human-review gate" aria-label="review gate">
            {"◇"}
          </span>
        )}
        {item.activeRunId && (
          <span className="pv-active-dot" data-testid={`process-active-${item.id}`} title="A run is active" aria-label="running" />
        )}
      </div>
      <div className="pv-task-title">{item.title}</div>
      <div className="pv-task-status">
        {(item.status ?? "").replace(/_/g, " ")}
        {item.resumable && " · resumable"}
      </div>
    </button>
  );
}

function describeBlockers(item: ItemNode): string {
  return item.notReadyBecause
    .map((b) => (b.kind === "missing_input" ? `waiting for ${b.slot}` : b.kind === "sequencing" ? `waiting for ${b.item}` : "no executor"))
    .join("; ");
}

function DataNode({ data }: NodeProps<Node<FlowNodeData, "data">>) {
  if (data.kind !== "data") return null;
  const { slot } = data;
  const filled = slot.latest != null;
  return (
    <button
      type="button"
      className={`pv-data ${filled ? "pv-data-filled" : "pv-data-empty"}`}
      data-testid={`process-slot-${slot.ref}`}
      title={filled ? `${slot.name} v${slot.latest!.version}` : `Not yet published — produced by ${slot.owner}`}
      onClick={() => {
        if (filled) selectAsset(slot.owner, slot.name, slot.latest!.version);
      }}
      disabled={!filled}
    >
      <span aria-hidden="true">{"\u{1F4C4}"}</span>
      <span className="pv-data-name">{slot.name}</span>
      <span className="pv-data-version">{filled ? `v${slot.latest!.version}` : "not yet published"}</span>
    </button>
  );
}

const nodeTypes = { composite: CompositeNode, task: TaskNode, data: DataNode };

export function ProcessView({ eid }: { eid: EngagementId }) {
  const plan = useQuery({ queryKey: qk.plan(eid), queryFn: () => api.getPlan(eid) });
  const [layout, setLayout] = useState<LayoutResult | null>(null);
  const laidOutOnce = useRef(false);

  useEffect(() => {
    if (!plan.data) return;
    let cancelled = false;
    void layoutPlan(plan.data).then((result) => {
      if (!cancelled) {
        setLayout(result);
        laidOutOnce.current = true;
      }
    });
    return () => {
      cancelled = true;
    };
    // Re-layout whenever the plan's structural shape or statuses/versions change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan.dataUpdatedAt]);

  const { nodes, edges } = useMemo<{ nodes: Node[]; edges: Edge[] }>(() => {
    if (!layout || !plan.data) return { nodes: [], edges: [] };
    const itemsById = new Map(plan.data.items.map((i) => [i.id, i]));
    const slotsByRef = new Map(plan.data.slots.map((s) => [s.ref, s]));
    const rfNodes: Node[] = layout.nodes.map((n) => {
      const base = { id: n.id, position: { x: n.x, y: n.y }, style: { width: n.width, height: n.height }, draggable: false, selectable: true, ...(n.parentId ? { parentId: n.parentId, extent: "parent" as const } : {}) };
      if (n.kind === "composite") return { ...base, type: "composite", data: { plan: plan.data!, kind: "composite", item: itemsById.get(n.id)! } };
      if (n.kind === "task") return { ...base, type: "task", data: { plan: plan.data!, kind: "task", item: itemsById.get(n.id)! } };
      return { ...base, type: "data", data: { plan: plan.data!, kind: "data", slot: slotsByRef.get(n.id)! } };
    });
    const rfEdges: Edge[] = layout.edges.map((e) => ({ id: e.id, source: e.source, target: e.target, type: "smoothstep" }));
    return { nodes: rfNodes, edges: rfEdges };
  }, [layout, plan.data]);

  if (plan.status === "pending" || !layout) return <p>Loading process view…</p>;
  if (plan.status === "error") return <p role="alert">Could not load the plan: {(plan.error as Error).message}</p>;

  return (
    <div className="process-view" data-testid="process-view">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView={!laidOutOnce.current || undefined}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        proOptions={{ hideAttribution: true }}
      >
        <Background />
        <Controls showInteractive={false} />
      </ReactFlow>
      <ProcessLegend />
    </div>
  );
}

function ProcessLegend() {
  return (
    <div className="pv-legend" data-testid="process-legend">
      <span>{"\u{1F916}"} agent</span>
      <span>{"\u{1F464}"} human</span>
      <span>{"◇"} review gate</span>
      <span>{"\u{1F4C4}"} data object (dashed = unpublished)</span>
    </div>
  );
}
