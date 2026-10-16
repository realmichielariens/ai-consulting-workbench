// plan.md: the readable projection of the plan (ARCHITECTURE.md §5.2, §5.3).
// `renderPlanMd` is a pure function over the PlanView contract (W5 builds the
// real view from the DB); `buildPreviewPlanView` assembles a PlanView
// straight from seed defs, for `pnpm seed:try` where there is no DB yet.

import fs from "node:fs";
import {
  STATUS_SEVERITY,
  itemKindOf,
  slotRef as makeSlotRef,
  type AssetVersion,
  type EngagementId,
  type EngagementMeta,
  type ItemDef,
  type ItemId,
  type ItemStatus,
  type PlanView,
  type ReadinessBlocker,
  type Rollup,
  type SlotNode,
  type ItemNode,
} from "@workbench/core";
import type { EngagementPaths } from "@workbench/core/node";

const EXECUTOR_ICON: Record<string, string> = { agent: "🤖", human: "👤" };

function formatGate(gate: ItemNode["gate"]): string {
  if (gate.length === 0) return "";
  return ` ◇ ${gate.map((g) => g.type).join(", ")}`;
}

function versionLabel(latest: AssetVersion | null): string {
  return latest ? `v${latest.version}` : "not yet published";
}

/** Depth-first, children ordered by `order`, matching the process view's reading order (J1.2). */
function orderedChildren(items: ItemNode[], parent: ItemId | null): ItemNode[] {
  return items.filter((i) => i.parent === parent).sort((a, b) => a.order - b.order);
}

function renderItem(item: ItemNode, view: PlanView, depth: number, lines: string[]): void {
  const indent = "  ".repeat(depth);
  if (item.kind === "task") {
    const icon = item.executor ? (EXECUTOR_ICON[item.executor] ?? "") : "";
    const status = item.status ?? "unknown";
    lines.push(`${indent}- ${icon} **${item.id}** — ${item.title} — ${status}${formatGate(item.gate)}`);
    for (const ref of item.outputs) {
      const slot = view.slots.find((s) => s.ref === ref);
      lines.push(`${indent}  - ${slot?.name ?? ref}: ${versionLabel(slot?.latest ?? null)}`);
    }
  } else {
    const rollup = item.rollup;
    const summary = rollup && rollup.total > 0 ? ` (${rollup.done}/${rollup.total} done)` : "";
    if (lines.length > 0 && lines[lines.length - 1] !== "") lines.push(""); // blank line before each composite heading
    lines.push(`${indent}${"#".repeat(Math.min(depth + 2, 6))} ${item.title} (${item.id})${summary}`);
    for (const ref of item.outputs) {
      const slot = view.slots.find((s) => s.ref === ref);
      lines.push(`${indent}- ${slot?.name ?? ref}: ${versionLabel(slot?.latest ?? null)}`);
    }
  }
  for (const child of orderedChildren(view.items, item.id)) renderItem(child, view, depth + 1, lines);
}

export function renderPlanMd(view: PlanView, meta: EngagementMeta): string {
  const lines: string[] = [];
  lines.push(`# Plan — ${meta.name}`);
  lines.push("");
  lines.push(`Plan version: ${view.planVersion}`);
  lines.push("");
  for (const root of orderedChildren(view.items, null)) renderItem(root, view, 0, lines);
  lines.push("");
  return lines.join("\n");
}

export function writePlanMd(paths: EngagementPaths, md: string): void {
  fs.writeFileSync(paths.planMd, md, "utf8");
}

// ---------------------------------------------------------------------------
// Preview PlanView, for `pnpm seed:try` (no engine/DB yet — the real rules
// live in packages/core/src/rules, built by W3). This is a preview only:
// waiting for every leaf item, ready if every *required* input was seeded.
// ---------------------------------------------------------------------------

function isSeeded(seededVersions: AssetVersion[], slot: string): boolean {
  return seededVersions.some((v) => v.slot === slot);
}

function computeRollup(leafStatuses: ItemStatus[]): Rollup {
  const byStatus: Partial<Record<ItemStatus, number>> = {};
  for (const s of leafStatuses) byStatus[s] = (byStatus[s] ?? 0) + 1;
  const worst = STATUS_SEVERITY.find((s) => (byStatus[s] ?? 0) > 0) ?? null;
  return {
    total: leafStatuses.length,
    done: byStatus.done ?? 0,
    byStatus,
    worst,
  };
}

export function buildPreviewPlanView(
  defs: ItemDef[],
  seededVersions: AssetVersion[],
  engagementId: EngagementId,
  planVersion: number,
): PlanView {
  const leafStatus = new Map<ItemId, ItemStatus>();
  const notReadyBecause = new Map<ItemId, ReadinessBlocker[]>();
  for (const def of defs) {
    if (itemKindOf(def) !== "task") continue;
    const required = def.inputs.filter((i) => i.required);
    const blockers: ReadinessBlocker[] = required
      .filter((i) => !isSeeded(seededVersions, i.slot))
      .map((i) => ({ kind: "missing_input" as const, slot: i.slot, producer: i.slot.split("/")[0] as ItemId }));
    leafStatus.set(def.id, blockers.length === 0 ? "ready" : "waiting");
    notReadyBecause.set(def.id, blockers);
  }

  // Every descendant leaf (direct or transitive) of a composite, for its roll-up.
  const descendantLeaves = (rootId: ItemId): ItemId[] => {
    const out: ItemId[] = [];
    const walk = (id: ItemId) => {
      for (const def of defs) {
        if (def.parent !== id) continue;
        if (itemKindOf(def) === "task") out.push(def.id);
        else walk(def.id);
      }
    };
    walk(rootId);
    return out;
  };

  const slots: SlotNode[] = [];
  for (const def of defs) {
    for (const out of def.outputs) {
      const ref = makeSlotRef(def.id, out.slot);
      const latest = seededVersions.find((v) => v.slot === ref) ?? null;
      const consumers = defs.filter((d) => d.inputs.some((i) => i.slot === ref)).map((d) => d.id);
      slots.push({
        ref,
        owner: def.id,
        name: out.slot,
        format: out.format,
        scope: out.scope,
        description: out.description,
        required: out.required,
        latest,
        versionCount: latest ? 1 : 0,
        consumers,
      });
    }
  }

  const items: ItemNode[] = defs.map((def) => {
    const kind = itemKindOf(def);
    const isTask = kind === "task";
    const rollup = isTask ? null : computeRollup(descendantLeaves(def.id).map((id) => leafStatus.get(id)!));
    return {
      id: def.id,
      title: def.title,
      kind,
      parent: def.parent,
      order: def.order,
      executor: def.executor,
      status: isTask ? (leafStatus.get(def.id) ?? null) : null,
      rollup,
      gate: def.gate,
      inputs: def.inputs,
      outputs: def.outputs.map((o) => makeSlotRef(def.id, o.slot)),
      notReadyBecause: isTask ? (notReadyBecause.get(def.id) ?? []) : [],
      activeRunId: null,
      resumable: false,
    };
  });

  return { engagementId, planVersion, items, slots };
}
