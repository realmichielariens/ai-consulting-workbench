// Process view v0 (J1.2): React Flow + ELK layered layout. Phases are
// always-expanded frames with a roll-up badge; tasks show 🤖/👤, status and a
// ◇ gate marker; data objects show their slot + version, dashed while empty.
// Read-only (no drag), click opens the detail panel. Re-layout on plan
// changes without a jarring jump: fitView only runs on the very first mount.

import { useEffect, useMemo, useRef, useState } from "react";
import { ReactFlow, Background, Controls, Handle, Position, type Edge, type Node, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useQuery } from "@tanstack/react-query";
import type { EngagementId, ItemId, ItemNode, PlanPreviewView, PlanView, SlotNode } from "@workbench/core";
import { api, qk } from "../../api/index.js";
import { selectAsset, selectItem } from "../../state/url.js";
import { useUiStore } from "../../state/ui.js";
import { layoutPlan, type LayoutResult } from "./layout.js";

/** J2.2: which of the previewed proposal's item ids this node is, if any. */
type PreviewMark = "added" | "changed" | "cancelled" | null;

type FlowNodeData = { plan: PlanView; mark: PreviewMark } & (
  | { kind: "composite"; item: ItemNode }
  | { kind: "task"; item: ItemNode }
  | { kind: "data"; slot: SlotNode }
);

function statusClass(status: string | null): string {
  return status ? `status-${status}` : "status-none";
}

function CompositeNode({ data }: NodeProps<Node<FlowNodeData, "composite">>) {
  if (data.kind !== "composite") return null;
  const { item, mark } = data;
  const rollup = item.rollup;
  return (
    <div className={`pv-composite ${mark ? `pv-mark-${mark}` : ""}`} data-testid={`process-node-${item.id}`}>
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
  const { item, mark } = data;
  const icon = item.executor === "agent" ? "\u{1F916}" : "\u{1F464}";
  const hasGate = item.gate.length > 0;
  return (
    <>
    <Ports />
    <button
      type="button"
      className={`pv-task ${statusClass(item.status)} ${mark ? `pv-mark-${mark}` : ""}`}
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
    </>
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
    <>
    <Ports />
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
    </>
  );
}

/** React Flow only draws edges between handles; the view is read-only, so they stay invisible. */
function Ports() {
  return (
    <>
      <Handle type="target" position={Position.Left} className="pv-port" isConnectable={false} />
      <Handle type="source" position={Position.Right} className="pv-port" isConnectable={false} />
    </>
  );
}

const nodeTypes = { composite: CompositeNode, task: TaskNode, data: DataNode };

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

export function ProcessView({ eid }: { eid: EngagementId }) {
  const previewProposalId = useUiStore((s) => s.previewProposalId);
  const exitPreview = useUiStore((s) => s.exitPreview);
  const plan = useQuery({ queryKey: qk.plan(eid), queryFn: () => api.getPlan(eid), enabled: previewProposalId == null });
  const preview = useQuery({
    queryKey: previewProposalId ? qk.proposalPreview(eid, previewProposalId) : ["proposalPreview", eid, "none"],
    queryFn: () => api.previewProposal(eid, previewProposalId!),
    enabled: previewProposalId != null,
  });
  const active: PlanView | PlanPreviewView | undefined = previewProposalId ? preview.data : plan.data;
  const activeUpdatedAt = previewProposalId ? preview.dataUpdatedAt : plan.dataUpdatedAt;

  // `active` changes a render before its new layout lands (a live update, or toggling
  // the preview). An older layout is only reused while every one of its nodes still
  // exists in `active`; otherwise its nodes would dereference items that aren't there.
  const [laidOut, setLaidOut] = useState<{ view: PlanView | PlanPreviewView; layout: LayoutResult } | null>(null);
  const layout = laidOut && active && (laidOut.view === active || layoutFits(laidOut.layout, active)) ? laidOut.layout : null;
  const laidOutOnce = useRef(false);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    void layoutPlan(active).then((result) => {
      if (!cancelled) {
        setLaidOut({ view: active, layout: result });
        laidOutOnce.current = true;
      }
    });
    return () => {
      cancelled = true;
    };
    // Re-layout whenever the plan's structural shape or statuses/versions change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeUpdatedAt, previewProposalId]);

  const { nodes, edges } = useMemo<{ nodes: Node[]; edges: Edge[] }>(() => {
    if (!layout || !active) return { nodes: [], edges: [] };
    const itemsById = new Map(active.items.map((i) => [i.id, i]));
    const slotsByRef = new Map(active.slots.map((s) => [s.ref, s]));
    const previewView = previewProposalId ? (active as PlanPreviewView) : undefined;
    const rfNodes: Node[] = layout.nodes.map((n) => {
      const base = { id: n.id, position: { x: n.x, y: n.y }, style: { width: n.width, height: n.height }, draggable: false, selectable: true, ...(n.parentId ? { parentId: n.parentId, extent: "parent" as const } : {}) };
      if (n.kind === "composite") {
        const item = itemsById.get(n.id)!;
        return { ...base, type: "composite", data: { plan: active, kind: "composite", item, mark: markFor(previewView, item.id) } };
      }
      if (n.kind === "task") {
        const item = itemsById.get(n.id)!;
        return { ...base, type: "task", data: { plan: active, kind: "task", item, mark: markFor(previewView, item.id) } };
      }
      return { ...base, type: "data", data: { plan: active, kind: "data", slot: slotsByRef.get(n.id)!, mark: null } };
    });
    const rfEdges: Edge[] = layout.edges.map((e) => ({ id: e.id, source: e.source, target: e.target, type: "smoothstep", style: { stroke: "var(--pv-edge, #8a94a6)", strokeWidth: 1.5 } }));
    return { nodes: rfNodes, edges: rfEdges };
  }, [layout, active, previewProposalId]);

  // Remount React Flow on every new layout: re-measuring a fresh graph is the
  // robust way to keep nodes and edges visible across live updates.
  const layoutKey = useMemo(() => Math.random().toString(36).slice(2), [layout]);

  const loading = previewProposalId ? preview.status === "pending" : plan.status === "pending";
  const error = previewProposalId ? preview.status === "error" : plan.status === "error";
  if (loading || !layout) return <p>Loading process view…</p>;
  if (error) return <p role="alert">Could not load the plan: {((previewProposalId ? preview.error : plan.error) as Error).message}</p>;

  return (
    <div className="process-view" data-testid="process-view">
      {previewProposalId && (
        <div className="preview-banner" data-testid="preview-banner">
          <span>Previewing {previewProposalId} — not applied</span>
          <button type="button" data-testid="preview-exit" onClick={exitPreview}>
            Exit preview
          </button>
        </div>
      )}
      <ReactFlow
        key={layoutKey}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.08 }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
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
