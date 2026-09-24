// ELK layered layout for the process view v0 (DESIGN.md §10.2, J1.2): tasks
// nested inside their phase (compound nodes). A data object sits in its
// producer's phase so a phase reads left to right (WI-002 -> guide -> WI-003);
// engagement assets stay top-level. Edges: producer -> slot -> consumers.

import ELK from "elkjs/lib/elk.bundled.js";
import type { PlanView } from "@workbench/core";

const elk = new ELK();

export const TASK_W = 200;
export const TASK_H = 74;
export const DATA_W = 150;
export const DATA_H = 56;

export interface LaidOutNode {
  id: string;
  kind: "composite" | "task" | "data";
  x: number;
  y: number;
  width: number;
  height: number;
  parentId?: string;
}

export interface LaidOutEdge {
  id: string;
  source: string;
  target: string;
}

export interface LayoutResult {
  nodes: LaidOutNode[];
  edges: LaidOutEdge[];
  width: number;
  height: number;
}

interface ElkNodeIn {
  id: string;
  width?: number;
  height?: number;
  children?: ElkNodeIn[];
  layoutOptions?: Record<string, string>;
}

export async function layoutPlan(plan: PlanView): Promise<LayoutResult> {
  const composites = plan.items.filter((i) => i.kind === "composite");
  const tasks = plan.items.filter((i) => i.kind === "task");

  const children: ElkNodeIn[] = [];

  for (const comp of composites) {
    const kids = tasks.filter((t) => t.parent === comp.id);
    const kidSlots = plan.slots.filter((s) => kids.some((t) => t.id === s.owner));
    children.push({
      id: comp.id,
      layoutOptions: { "elk.padding": "[top=36,left=16,bottom=16,right=16]" },
      children: [
        ...kids.map((t) => ({ id: t.id, width: TASK_W, height: TASK_H })),
        ...kidSlots.map((s) => ({ id: s.ref, width: DATA_W, height: DATA_H })),
      ],
    });
  }
  // Tasks with no composite parent shown in the plan (defensive; I1's seed has none).
  for (const t of tasks) {
    if (!composites.some((c) => c.id === t.parent)) children.push({ id: t.id, width: TASK_W, height: TASK_H });
  }
  const nestedSlots = new Set(children.flatMap((c) => (c.children ?? []).map((k) => k.id)));
  for (const slot of plan.slots) {
    if (!nestedSlots.has(slot.ref)) children.push({ id: slot.ref, width: DATA_W, height: DATA_H });
  }

  const edges: LaidOutEdge[] = [];
  for (const slot of plan.slots) {
    if (slot.owner !== "ENG") edges.push({ id: `e-${slot.owner}-${slot.ref}`, source: slot.owner, target: slot.ref });
    for (const consumer of slot.consumers) edges.push({ id: `e-${slot.ref}-${consumer}`, source: slot.ref, target: consumer });
  }

  const graph: ElkNodeIn & { edges: { id: string; sources: string[]; targets: string[] }[] } = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.hierarchyHandling": "INCLUDE_CHILDREN",
      "elk.layered.spacing.nodeNodeBetweenLayers": "56",
      "elk.spacing.nodeNode": "32",
      "elk.spacing.componentComponent": "48",
    },
    children,
    edges: edges.map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] })),
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- elkjs's own types are loose
  const result: any = await elk.layout(graph as any);

  const nodes: LaidOutNode[] = [];
  for (const comp of result.children ?? []) {
    const isComposite = composites.some((c) => c.id === comp.id);
    nodes.push({ id: comp.id, kind: isComposite ? "composite" : plan.slots.some((s) => s.ref === comp.id) ? "data" : "task", x: comp.x ?? 0, y: comp.y ?? 0, width: comp.width ?? DATA_W, height: comp.height ?? DATA_H });
    for (const kid of comp.children ?? []) {
      const isSlot = plan.slots.some((s) => s.ref === kid.id);
      nodes.push({ id: kid.id, kind: isSlot ? "data" : "task", x: kid.x ?? 0, y: kid.y ?? 0, width: kid.width ?? (isSlot ? DATA_W : TASK_W), height: kid.height ?? (isSlot ? DATA_H : TASK_H), parentId: comp.id });
    }
  }

  return { nodes, edges, width: result.width ?? 0, height: result.height ?? 0 };
}
