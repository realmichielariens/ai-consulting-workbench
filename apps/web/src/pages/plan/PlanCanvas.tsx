// UX1 brief B §Build 1: the Plan canvas, restyled to Exhibit nodes (EXHIBIT
// §7.4 "Canvas node"). The ELK layout and React Flow wiring are ported from
// the pre-UX1 ProcessView (read-only reference) unchanged: phases are
// always-expanded compound frames, data objects are separate graph nodes
// (producer -> slot -> consumers), re-layout never jumps (fitView only runs
// once). What changes is what each node renders and what a click does:
// single click selects (the caller shows the peek card), double-click opens
// the item, and a data object always opens its document directly.

import { useEffect, useMemo, useRef, useState } from "react";
import { ReactFlow, Background, Controls, Handle, Position, type Edge, type Node, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { ItemId, ItemNode, PlanPreviewView, PlanView, SlotNode } from "@workbench/core";
import { ExecGlyph, DocGlyph, GateGlyph, HarveyBall, Status, Version, harveyFromRatio } from "../../ui/index.js";
import { layoutPlan, type LayoutResult } from "../../components/process/layout.js";

type PreviewMark = "added" | "changed" | "cancelled" | null;

type FlowNodeData = { mark: PreviewMark } & (
  | { kind: "composite"; item: ItemNode }
  | { kind: "task"; item: ItemNode }
  | { kind: "data"; slot: SlotNode }
);

function Ports() {
  return (
    <>
      <Handle type="target" position={Position.Left} className="pv-port" isConnectable={false} />
      <Handle type="source" position={Position.Right} className="pv-port" isConnectable={false} />
    </>
  );
}

function CompositeNode({ data }: NodeProps<Node<FlowNodeData, "composite">>) {
  if (data.kind !== "composite") return null;
  const { item, mark } = data;
  const rollup = item.rollup;
  return (
    <div className={`node composite${mark ? ` ghost pv-mark-${mark}` : ""}`} data-testid={`process-node-${item.id}`}>
      <div className="n-top">
        <span className="n-title">{item.title}</span>
        {rollup && (
          <span className="pv-rollup" data-testid={`process-rollup-${item.id}`}>
            <HarveyBall quarters={harveyFromRatio(rollup.done, rollup.total)} />
            {rollup.done}/{rollup.total}
          </span>
        )}
      </div>
    </div>
  );
}

function TaskNode({ data, selected, onSelect, onOpen }: NodeProps<Node<FlowNodeData, "task">> & { onSelect: (id: ItemId) => void; onOpen: (id: ItemId) => void }) {
  if (data.kind !== "task") return null;
  const { item, mark } = data;
  const status = item.status ?? "waiting";
  const hasGate = item.gate.length > 0;
  return (
    <>
      <Ports />
      <button
        type="button"
        className={`node${selected ? " selected" : ""}${mark ? ` ghost pv-mark-${mark}` : ""}`}
        data-st={status}
        data-testid={`process-node-${item.id}`}
        title={item.notReadyBecause.length > 0 ? describeBlockers(item) : undefined}
        onClick={() => onSelect(item.id)}
        onDoubleClick={() => onOpen(item.id)}
      >
        <div className="n-top">
          <span className="id">{item.id}</span>
          <ExecGlyph executor={item.executor ?? "agent"} />
        </div>
        <div className="n-title">{item.title}</div>
        <div className="pv-task-foot">
          <Status status={status} />
          {hasGate && <GateGlyph kind={item.gate[0]!.type === "endorsement" ? "endorse" : "review"} />}
          {item.activeRunId && <span className="pv-active-dot" data-testid={`process-active-${item.id}`} title="A run is active" aria-label="running" />}
        </div>
      </button>
    </>
  );
}

function describeBlockers(item: ItemNode): string {
  return item.notReadyBecause
    .map((b) => (b.kind === "missing_input" ? `waiting for ${b.slot}` : b.kind === "sequencing" ? `waiting for ${b.item}` : b.kind === "input_not_approved" ? `${b.slot} not yet approved` : "no executor"))
    .join("; ");
}

function DataNode({ data, onOpenDoc }: NodeProps<Node<FlowNodeData, "data">> & { onOpenDoc: (slotRef: string, version: string) => void }) {
  if (data.kind !== "data") return null;
  const { slot } = data;
  const filled = slot.latest != null;
  return (
    <>
      <Ports />
      <button
        type="button"
        className="pv-data"
        data-testid={`process-slot-${slot.ref}`}
        title={filled ? `${slot.name}.${slot.format} v${slot.latest!.version}` : `Not yet published — produced by ${slot.owner}`}
        onClick={() => filled && onOpenDoc(slot.ref, slot.latest!.version)}
        disabled={!filled}
      >
        <DocGlyph filled={filled} />
        <span className="pv-data-name">{slot.name}</span>
        {filled && <Version version={slot.latest!.version} kind={slot.latest!.kind} />}
      </button>
    </>
  );
}

function markFor(preview: PlanPreviewView | undefined, itemId: ItemId): PreviewMark {
  if (!preview) return null;
  if (preview.cancelled.includes(itemId)) return "cancelled";
  if (preview.added.includes(itemId)) return "added";
  if (preview.changed.includes(itemId)) return "changed";
  return null;
}

function layoutFits(layout: LayoutResult, view: PlanView | PlanPreviewView): boolean {
  const itemIds = new Set(view.items.map((i) => i.id));
  const slotRefs = new Set(view.slots.map((s) => s.ref));
  return layout.nodes.every((n) => (n.kind === "data" ? slotRefs.has(n.id) : itemIds.has(n.id)));
}

/**
 * Below 0.7 the node text drops under ~8px and can't be read, so a wide plan
 * overflows and is panned instead; a small plan is never blown up past 1:1.
 */
const FIT_VIEW = { padding: 0.08, minZoom: 0.7, maxZoom: 1 };

export function PlanCanvas({
  plan,
  sel,
  isPreview,
  onSelect,
  onOpen,
  onOpenDoc,
}: {
  plan: PlanView | PlanPreviewView;
  sel: string | null;
  isPreview: boolean;
  onSelect: (id: string) => void;
  onOpen: (id: string) => void;
  onOpenDoc: (slotRef: string, version: string) => void;
}) {
  // An older layout is reused only while every one of its nodes still exists in `plan` — a
  // live update or a preview toggle otherwise swaps in a plan whose shape the old layout can't render.
  const [laidOut, setLaidOut] = useState<{ view: PlanView | PlanPreviewView; layout: LayoutResult } | null>(null);
  const layout = laidOut && (laidOut.view === plan || layoutFits(laidOut.layout, plan)) ? laidOut.layout : null;

  useEffect(() => {
    let cancelled = false;
    void layoutPlan(plan).then((result) => {
      if (!cancelled) setLaidOut({ view: plan, layout: result });
    });
    return () => {
      cancelled = true;
    };
    // Re-layout when the plan's shape/statuses/versions change (identity change of `plan`), not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan]);

  const nodeTypes = useMemo(
    () => ({
      composite: CompositeNode,
      task: (props: NodeProps<Node<FlowNodeData, "task">>) => <TaskNode {...props} onSelect={onSelect} onOpen={onOpen} />,
      data: (props: NodeProps<Node<FlowNodeData, "data">>) => <DataNode {...props} onOpenDoc={onOpenDoc} />,
    }),
    [onSelect, onOpen, onOpenDoc],
  );

  const { nodes, edges } = useMemo<{ nodes: Node[]; edges: Edge[] }>(() => {
    if (!layout) return { nodes: [], edges: [] };
    const itemsById = new Map(plan.items.map((i) => [i.id, i]));
    const slotsByRef = new Map(plan.slots.map((s) => [s.ref, s]));
    const previewView = isPreview ? (plan as PlanPreviewView) : undefined;
    const rfNodes: Node[] = layout.nodes.map((n) => {
      const base = { id: n.id, position: { x: n.x, y: n.y }, style: { width: n.width, height: n.height }, draggable: false, selectable: true, ...(n.parentId ? { parentId: n.parentId, extent: "parent" as const } : {}) };
      if (n.kind === "composite") {
        const item = itemsById.get(n.id)!;
        return { ...base, type: "composite", selected: item.id === sel, data: { kind: "composite", item, mark: markFor(previewView, item.id) } };
      }
      if (n.kind === "task") {
        const item = itemsById.get(n.id)!;
        return { ...base, type: "task", selected: item.id === sel, data: { kind: "task", item, mark: markFor(previewView, item.id) } };
      }
      return { ...base, type: "data", data: { kind: "data", slot: slotsByRef.get(n.id)!, mark: null } };
    });
    const rfEdges: Edge[] = layout.edges.map((e) => ({ id: e.id, source: e.source, target: e.target, type: "smoothstep", style: { stroke: "var(--rule-strong)", strokeWidth: 1.5 } }));
    return { nodes: rfNodes, edges: rfEdges };
  }, [layout, plan, sel, isPreview]);

  // Remount on every new layout: re-measuring a fresh graph keeps nodes/edges visible across live updates.
  const layoutKey = useMemo(() => Math.random().toString(36).slice(2), [layout]);

  if (!layout) return <p className="muted">Loading the plan…</p>;

  return (
    <div className="process-view" data-testid="process-view">
      <ReactFlow key={layoutKey} nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView fitViewOptions={FIT_VIEW} nodesDraggable={false} nodesConnectable={false} elementsSelectable>
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
      <span>
        <ExecGlyph executor="agent" /> agent
      </span>
      <span>
        <ExecGlyph executor="human" /> human
      </span>
      <span>
        <GateGlyph kind="review" /> review gate
      </span>
      <span>
        <DocGlyph filled={false} /> data object (dashed = unpublished)
      </span>
    </div>
  );
}
