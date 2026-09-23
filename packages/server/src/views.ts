// Read views (api.ts): assembled from the DB + files, never containing rule
// logic of their own beyond what packages/core/src/rules exposes
// (computeItemActions, computeReadiness) — CLAUDE.md rule 12.

import fs from "node:fs";
import {
  ActivityItem,
  computeItemActions,
  type AssetContentView,
  type AssetVersion,
  type AssetVersionsView,
  type EngagementView,
  type InboxEntry,
  type InboxView,
  type ItemActionState,
  type ItemDetailView,
  type ItemId,
  type Request,
  type Run,
  type RunActivityView,
  type RunId,
  type SlotName,
  type Version,
  type WorklogView,
} from "@workbench/core";
import { assetVersionsRepo, gateStepsRepo, inboxRepo, itemsRepo, requestsRepo, runsRepo } from "@workbench/db";
import { readItemMd, readVersion, readVersionText } from "@workbench/store";
import { notFound } from "./errors.js";
import { buildPlanView } from "./checkpoint.js";
import type { EngagementContext } from "./engagementContext.js";

function isResumable(ctx: EngagementContext, row: { id: ItemId; executor: string | null; status: string | null; lastSessionId: string | null }): boolean {
  return row.executor === "agent" && row.status === "ready" && row.lastSessionId != null && !ctx.activeRuns.has(row.id);
}

function itemActionState(ctx: EngagementContext, itemId: ItemId): ItemActionState {
  const row = itemsRepo.getItem(ctx.dbCtx, itemId);
  if (!row) throw notFound(`no such item: ${itemId}`);
  const outputs = itemsRepo.listOutputs(ctx.dbCtx, itemId);
  const allRequiredOutputsPublished = outputs
    .filter((o) => o.required)
    .every((o) => assetVersionsRepo.latestVersion(ctx.dbCtx, o.slotRef) != null);
  return {
    executor: row.executor,
    status: row.status,
    hasActiveRun: ctx.activeRuns.has(itemId),
    resumable: isResumable(ctx, row),
    allRequiredOutputsPublished,
  };
}

export function getPlanView(ctx: EngagementContext) {
  return buildPlanView(ctx);
}

export function getItemDetailView(ctx: EngagementContext, itemId: ItemId): ItemDetailView {
  const plan = buildPlanView(ctx);
  const node = plan.items.find((i) => i.id === itemId);
  if (!node) throw notFound(`no such item: ${itemId}`);
  const def = readItemMd(ctx.paths.itemMd(itemId));
  const producerDescriptionOf = (slot: string): { producer: ItemId; description: string } => {
    const idx = slot.indexOf("/");
    const producer = slot.slice(0, idx) as ItemId;
    const name = slot.slice(idx + 1);
    const out = itemsRepo.listOutputs(ctx.dbCtx, producer).find((o) => o.slot === name);
    return { producer, description: out?.description ?? "" };
  };

  const inputs = itemsRepo.listInputs(ctx.dbCtx, itemId).map((i) => {
    const { producer, description } = producerDescriptionOf(i.slot);
    return { slot: i.slot, required: i.required, producer, description, available: assetVersionsRepo.latestVersion(ctx.dbCtx, i.slot) };
  });

  const outputs = def.outputs.map((o) => {
    const slotRef = `${itemId}/${o.slot}` as const;
    return { ...o, slotRef, versions: assetVersionsRepo.listVersions(ctx.dbCtx, slotRef) };
  });

  const runs = runsRepo.listByItem(ctx.dbCtx, itemId).map((r): Run => toRun(r));
  const active = ctx.activeRuns.get(itemId);
  const activeRun = active ? runsRepo.getRun(ctx.dbCtx, active.runId) : null;
  const openRequests = requestsRepo.listByItem(ctx.dbCtx, itemId).filter((r) => r.status === "open");
  const runsWithReport = runsRepo.listByItem(ctx.dbCtx, itemId).find((r) => r.report != null);

  return {
    node,
    def,
    inputs,
    outputs: outputs as ItemDetailView["outputs"],
    runs,
    activeRun: activeRun ? toRun(activeRun) : null,
    openRequests: openRequests as Request[],
    lastReport: runsWithReport?.report ?? null,
    actions: computeItemActions(itemActionState(ctx, itemId)),
  };
}

/** RunRow (db) -> Run (contract): drops the db-only `runtime`/`report` fields. */
export function toRun(r: runsRepo.RunRow): Run {
  const { runtime: _runtime, report: _report, ...run } = r;
  return run;
}

function itemRef(ctx: EngagementContext, id: ItemId): { id: ItemId; title: string } {
  const row = itemsRepo.getItem(ctx.dbCtx, id);
  return { id, title: row?.title ?? id };
}

export function getInboxView(ctx: EngagementContext): InboxView {
  const requests = inboxRepo.listInboxRequests(ctx.dbCtx, "human");
  const humanItems = inboxRepo.listInboxHumanItems(ctx.dbCtx);

  const entries: InboxEntry[] = [];
  for (const request of requests) {
    const item = itemRef(ctx, request.itemId);
    if (request.type === "question") entries.push({ kind: "question", request, item });
    else if (request.type === "gate_request") entries.push({ kind: "review", request, item });
    else if (request.type === "run_issue") entries.push({ kind: "run_issue", request, item });
  }
  for (const row of humanItems) {
    const inputs = itemsRepo.listInputs(ctx.dbCtx, row.id).map((i) => ({
      slot: i.slot,
      required: i.required,
      available: assetVersionsRepo.latestVersion(ctx.dbCtx, i.slot),
    }));
    const outputs = itemsRepo.listOutputs(ctx.dbCtx, row.id).map((o) => ({
      slot: o.slot as SlotName,
      slotRef: o.slotRef,
      required: o.required,
      format: o.format,
      latest: assetVersionsRepo.latestVersion(ctx.dbCtx, o.slotRef),
    }));
    entries.push({
      kind: "human_item",
      item: { id: row.id, title: row.title },
      status: row.status!,
      inputs,
      outputs,
      markDone: computeItemActions(itemActionState(ctx, row.id)).markDone,
    });
  }
  return { entries };
}

export function getEngagementView(ctx: EngagementContext): EngagementView {
  const totalRow = ctx.dbCtx.sqlite.prepare("SELECT COALESCE(SUM(cost_usd), 0) AS total FROM runs").get() as { total: number };
  const inbox = getInboxView(ctx);
  return {
    id: ctx.id,
    name: ctx.meta.name,
    createdAt: ctx.meta.createdAt,
    seedId: ctx.meta.seed?.id ?? null,
    planVersion: ctx.meta.planVersion,
    costUsd: totalRow.total,
    settings: ctx.meta.settings,
    folderPath: ctx.paths.root,
    runtime: ctx.runtime.kind,
    profile: ctx.server.config.profile,
    workModel: ctx.profile.models.work,
    inboxCount: inbox.entries.length,
  };
}

export function getAssetVersionsView(ctx: EngagementContext, itemId: ItemId, slot: SlotName): AssetVersionsView {
  const slotRef = `${itemId}/${slot}` as const;
  const out = itemsRepo.listOutputs(ctx.dbCtx, itemId).find((o) => o.slot === slot);
  if (!out) throw notFound(`no such output slot: ${slotRef}`);
  return {
    slot: slotRef,
    owner: itemId,
    format: out.format,
    scope: out.scope,
    description: out.description,
    versions: assetVersionsRepo.listVersions(ctx.dbCtx, slotRef),
  };
}

export function getAssetContentView(ctx: EngagementContext, itemId: ItemId, slot: SlotName, version: Version): AssetContentView {
  const slotRef = `${itemId}/${slot}` as const;
  const v = assetVersionsRepo.getVersion(ctx.dbCtx, slotRef, ...splitVersion(version));
  if (!v) throw notFound(`no such version: ${slotRef} v${version}`);
  const textFormats = new Set(["md", "txt", "csv", "json", "yaml", "yml"]);
  const text = textFormats.has(v.format) ? readVersionText(ctx.paths, slotRef, version, v.format) : null;
  return { version: v, text };
}

export function getAssetRaw(ctx: EngagementContext, itemId: ItemId, slot: SlotName, version: Version): { bytes: Buffer; version: AssetVersion } {
  const slotRef = `${itemId}/${slot}` as const;
  const v = assetVersionsRepo.getVersion(ctx.dbCtx, slotRef, ...splitVersion(version));
  if (!v) throw notFound(`no such version: ${slotRef} v${version}`);
  return { bytes: readVersion(ctx.paths, slotRef, version, v.format), version: v };
}

function splitVersion(version: Version): [number, number] {
  const [major, minor] = version.split(".").map(Number) as [number, number];
  return [major, minor];
}

export function getWorklogView(ctx: EngagementContext, itemId: ItemId): WorklogView {
  const file = ctx.paths.worklog(itemId);
  const markdown = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  return { itemId, markdown };
}

export function getRunActivityView(ctx: EngagementContext, runId: RunId): RunActivityView {
  const run = runsRepo.getRun(ctx.dbCtx, runId);
  if (!run) throw notFound(`no such run: ${runId}`);
  const file = ctx.paths.runActivity(run.id);
  const activity: ActivityItem[] = fs.existsSync(file)
    ? fs
        .readFileSync(file, "utf8")
        .split("\n")
        .filter((l) => l.trim().length > 0)
        .map((l) => ActivityItem.parse(JSON.parse(l)))
    : [];
  return { run: toRun(run), activity };
}

// Gate round helpers used by services.ts (kept here so both views.ts and
// services.ts share the same "current open step" reading).
export function getOpenGateStep(ctx: EngagementContext, itemId: ItemId) {
  return gateStepsRepo.getOpenStep(ctx.dbCtx, itemId);
}
