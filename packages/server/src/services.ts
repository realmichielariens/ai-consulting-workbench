// Command services (ARCHITECTURE.md §3 "Command handlers"): the only code
// besides workPort.ts that writes engagement files and the DB. Each command
// follows write queue -> files -> DB transaction -> events -> checkpoint
// (CLAUDE.md rule 12). Routes.ts calls these and returns their result; they
// contain no HTTP concerns.

import path from "node:path";
import { spawn } from "node:child_process";
import fs from "node:fs";
import {
  applyItemEvent,
  computeItemActions,
  nextVersion,
  resolveGateVerdict,
  type AnswerMode,
  type AssetVersion,
  type EngagementId,
  type EngagementSummary,
  type EngagementView,
  type GateVerdict,
  type ItemDetailView,
  type ItemId,
  type NotificationId,
  type ProfileView,
  type Request,
  type RequestId,
  type Run,
  type Settings,
  type VersionKind,
} from "@workbench/core";
import { assetVersionsRepo, gateStepsRepo, itemsRepo, notificationsRepo, requestsRepo } from "@workbench/db";
import {
  appendWorklog,
  createEngagementFromSeed,
  initRepo,
  readItemMd,
  writeEngagementYaml,
  writeItemMd,
  writeVersionFile,
} from "@workbench/store";
import { wireApproachHooks } from "./approachRunner.js";
import { checkpointCommit } from "./checkpoint.js";
import { conflict, illegalTransition, invalid, notFound } from "./errors.js";
import { emitEvent, openEngagement, reloadMeta, type EngagementContext, type ServerContext } from "./engagementContext.js";
import { activeProfileName, listProfileNames, setActiveProfile } from "./profileService.js";
import { resolveQuestionAnswer } from "./questionAnswering.js";
import { launchRun, wireAutostart } from "./runService.js";
import { recomputeReadiness, scheduleAutostart, syncPlanState } from "./scheduler.js";
import { ensureThread } from "./threadService.js";
import { getEngagementView, getItemDetailView, toRun } from "./views.js";

// ---------------------------------------------------------------------------
// J1.1 — create engagement from seed
// ---------------------------------------------------------------------------

export async function createEngagement(
  server: ServerContext,
  seedId: string,
  name: string,
  settings?: Partial<Settings>,
): Promise<EngagementSummary> {
  const seedDir = path.join(server.repoRoot, "demo", "seeds", seedId);
  if (!fs.existsSync(seedDir)) throw notFound(`no such seed: ${seedId}`);

  const result = createEngagementFromSeed({ workspace: server.workspace, seedDir, name, settings });
  const ctx = openEngagement(server, result.engagementId);
  wireAutostart(ctx);
  wireApproachHooks(ctx);
  reloadMeta(ctx); // settings overrides are only reflected on disk by createEngagementFromSeed; pick them up before the first checkpoint

  const now = Date.now();
  itemsRepo.upsertDefinitions(ctx.dbCtx, result.defs, now);
  for (const v of result.seededVersions) assetVersionsRepo.insertAssetVersion(ctx.dbCtx, v);
  ensureThread(ctx); // I2 J2.1: every engagement gets T-0001 at creation

  emitEvent(ctx, { type: "EngagementCreated", actor: "human", payload: { name, seedId } });

  // Readiness only (no autostart yet): the repo must exist and the first
  // checkpoint must land before any run's own checkpoint can touch it.
  recomputeReadiness(ctx);

  await initRepo(ctx.paths.root);
  await checkpointCommit(ctx, { message: `Create engagement from seed ${seedId}`, actor: "human" });

  scheduleAutostart(ctx);

  return getEngagementSummary(ctx);
}

function getEngagementSummary(ctx: EngagementContext): EngagementSummary {
  return {
    id: ctx.id,
    name: ctx.meta.name,
    createdAt: ctx.meta.createdAt,
    seedId: ctx.meta.seed?.id ?? null,
    planVersion: ctx.meta.planVersion,
    costUsd: (ctx.dbCtx.sqlite.prepare("SELECT COALESCE(SUM(cost_usd), 0) AS total FROM runs").get() as { total: number }).total,
  };
}

// ---------------------------------------------------------------------------
// J1.3, R1, R5 — start / stop / resume
// ---------------------------------------------------------------------------

function requireItem(ctx: EngagementContext, itemId: ItemId) {
  const row = itemsRepo.getItem(ctx.dbCtx, itemId);
  if (!row) throw notFound(`no such item: ${itemId}`);
  return row;
}

function actionState(ctx: EngagementContext, itemId: ItemId) {
  const row = requireItem(ctx, itemId);
  const outputs = itemsRepo.listOutputs(ctx.dbCtx, itemId);
  const allRequiredOutputsPublished = outputs.filter((o) => o.required).every((o) => assetVersionsRepo.latestVersion(ctx.dbCtx, o.slotRef) != null);
  const resumable = row.executor === "agent" && row.status === "ready" && row.lastSessionId != null && !ctx.activeRuns.has(itemId);
  return { executor: row.executor, status: row.status, hasActiveRun: ctx.activeRuns.has(itemId), resumable, allRequiredOutputsPublished, row };
}

export async function startItem(ctx: EngagementContext, itemId: ItemId): Promise<Run> {
  const state = actionState(ctx, itemId);
  const actions = computeItemActions(state);
  if (!actions.start.allowed) throw illegalTransition(actions.start.reason ?? "cannot start");
  const row = await launchRun(ctx, itemId, "start", { reason: "start" }, null, "human");
  return toRun(row);
}

export async function stopItem(ctx: EngagementContext, itemId: ItemId): Promise<void> {
  const active = ctx.activeRuns.get(itemId);
  if (!active) throw conflict(`${itemId} is not running.`);
  await active.handle.interrupt();
}

export async function resumeItem(ctx: EngagementContext, itemId: ItemId): Promise<Run> {
  const state = actionState(ctx, itemId);
  const actions = computeItemActions(state);
  if (!actions.resume.allowed) throw illegalTransition(actions.resume.reason ?? "cannot resume");
  const resumeSessionId = state.row.lastSessionId;
  if (!resumeSessionId) throw conflict(`${itemId} has no session to resume.`);
  const row = await launchRun(ctx, itemId, "resume", { reason: "resume", note: "Resumed by the human." }, resumeSessionId, "human");
  return toRun(row);
}

// ---------------------------------------------------------------------------
// J1.4 — answer a question
// ---------------------------------------------------------------------------

export async function answerQuestion(ctx: EngagementContext, requestId: RequestId, mode: AnswerMode, text: string): Promise<Request> {
  return resolveQuestionAnswer(ctx, requestId, mode, text, "human");
}

// ---------------------------------------------------------------------------
// J1.5 — gate verdict
// ---------------------------------------------------------------------------

export async function recordVerdict(ctx: EngagementContext, requestId: RequestId, verdict: GateVerdict, comments: string): Promise<Request> {
  const request = requestsRepo.getRequest(ctx.dbCtx, requestId);
  if (!request) throw notFound(`no such request: ${requestId}`);
  if (request.type !== "gate_request") throw invalid(`${requestId} is not a gate request`);
  if (request.status !== "open") throw conflict(`${requestId} is already ${request.status}`);

  const itemId = request.itemId;
  const row = requireItem(ctx, itemId);
  const step = gateStepsRepo.getOpenStep(ctx.dbCtx, itemId);
  if (!step) throw conflict(`no open gate step for ${itemId}`);
  const currentRound = gateStepsRepo.getCurrentRound(ctx.dbCtx, itemId);
  const isLastStep = step.seq === row.gate.length - 1;
  const result = resolveGateVerdict(step, currentRound, verdict, isLastStep);
  if (!result.ok) throw conflict(result.reason);

  const now = new Date().toISOString();
  gateStepsRepo.resolveStep(ctx.dbCtx, itemId, step.round, step.seq, result.stepStatus, verdict, "human", now);
  const resolved = requestsRepo.resolveRequest(ctx.dbCtx, requestId, "answered", { kind: "verdict", verdict, comments, by: "human", at: now }, now);
  appendWorklog(ctx.paths, itemId, { actor: "human", at: now, entry: `Gate verdict: ${verdict}${comments ? `\n${comments}` : ""}` });
  emitEvent(ctx, { type: "RequestResolved", actor: "human", payload: { requestId, type: "gate_request", itemId, summary: `Verdict: ${verdict}` } });
  emitEvent(ctx, { type: "GateVerdictRecorded", actor: "human", payload: { itemId, requestId, verdict, versions: step.assetVersions } });

  if (verdict === "approved") {
    const t = applyItemEvent(row.status!, { type: "gate_approved" }, { executor: row.executor!, isLastGateStep: result.chainDone });
    if (t.ok) {
      itemsRepo.setStatus(ctx.dbCtx, itemId, t.to, Date.now());
      emitEvent(ctx, { type: "ItemStatusChanged", actor: "human", payload: { itemId, from: row.status, to: t.to } });
    }
    syncPlanState(ctx);
  } else {
    const t = applyItemEvent(row.status!, { type: "changes_requested" }, { executor: row.executor! });
    if (t.ok) {
      itemsRepo.setStatus(ctx.dbCtx, itemId, t.to, Date.now());
      emitEvent(ctx, { type: "ItemStatusChanged", actor: "human", payload: { itemId, from: row.status, to: t.to } });
    }
    if (row.lastSessionId) {
      await launchRun(
        ctx,
        itemId,
        "changes-requested",
        { reason: "changes-requested", requestId, comments, versions: step.assetVersions },
        row.lastSessionId,
        "human",
      );
    }
  }

  await checkpointCommit(ctx, { message: `Gate verdict for ${itemId}: ${verdict}`, actor: "human" });
  return resolved;
}

// ---------------------------------------------------------------------------
// R3 — run issue: retry / stop
// ---------------------------------------------------------------------------

export async function resolveRunIssue(ctx: EngagementContext, requestId: RequestId, action: "retry" | "stop"): Promise<Request> {
  const request = requestsRepo.getRequest(ctx.dbCtx, requestId);
  if (!request) throw notFound(`no such request: ${requestId}`);
  if (request.type !== "run_issue") throw invalid(`${requestId} is not a run issue`);
  if (request.status !== "open") throw conflict(`${requestId} is already ${request.status}`);

  const itemId = request.itemId;
  const row = requireItem(ctx, itemId);
  const now = new Date().toISOString();
  const resolved = requestsRepo.resolveRequest(ctx.dbCtx, requestId, "answered", { kind: "issue", action, by: "human", at: now }, now);
  emitEvent(ctx, { type: "RequestResolved", actor: "human", payload: { requestId, type: "run_issue", itemId, summary: `Issue ${action}` } });

  const eventType: "issue_retry" | "issue_stop" = action === "retry" ? "issue_retry" : "issue_stop";
  const t = applyItemEvent(row.status!, { type: eventType }, { executor: row.executor! });
  if (t.ok) {
    itemsRepo.setStatus(ctx.dbCtx, itemId, t.to, Date.now());
    emitEvent(ctx, { type: "ItemStatusChanged", actor: "human", payload: { itemId, from: row.status, to: t.to } });
  }

  if (action === "retry" && row.lastSessionId) {
    await launchRun(ctx, itemId, "resume", { reason: "resume", note: "Retried after a run issue." }, row.lastSessionId, "human");
  }

  await checkpointCommit(ctx, { message: `Run issue for ${itemId}: ${action}`, actor: "human" });
  return resolved;
}

// ---------------------------------------------------------------------------
// J1.6 — human upload / mark done
// ---------------------------------------------------------------------------

const TEXT_LIKE_FORMATS = new Set(["md", "txt", "csv", "json", "yaml", "yml"]);

export async function uploadOutput(ctx: EngagementContext, itemId: ItemId, slot: string, filename: string, bytes: Buffer): Promise<AssetVersion> {
  const row = requireItem(ctx, itemId);
  if (row.executor !== "human") throw invalid(`${itemId} is not a human item; uploads are not accepted.`);

  const outputDef = itemsRepo.listOutputs(ctx.dbCtx, itemId).find((o) => o.slot === slot);
  if (!outputDef) throw invalid(`"${slot}" is not one of ${itemId}'s declared output slots.`);

  const ext = path.extname(filename).slice(1).toLowerCase();
  if (ext !== outputDef.format) {
    throw invalid(`"${filename}" has extension ".${ext}", but slot "${slot}" expects ".${outputDef.format}".`);
  }
  if (!TEXT_LIKE_FORMATS.has(ext)) {
    // I1 seed only declares md slots; this guards against a non-text upload sneaking through a matching-but-unexpected format.
    throw invalid(`slot "${slot}" only accepts text formats (${[...TEXT_LIKE_FORMATS].join(", ")}).`);
  }

  const slotRef = outputDef.slotRef;
  const existing = assetVersionsRepo.listVersionParts(ctx.dbCtx, slotRef);
  const kind: VersionKind = "material"; // uploads: first version is 1.0 regardless (nextVersion), later ones bump major
  const version = nextVersion(existing, kind);
  const relPath = writeVersionFile(ctx.paths, slotRef, version, outputDef.format, { bytes });

  const [major, minor] = version.split(".").map(Number) as [number, number];
  const at = new Date().toISOString();
  assetVersionsRepo.insertAssetVersion(ctx.dbCtx, { slot: slotRef, version, major, minor, kind, author: "human", at, note: "Uploaded by the human.", runId: null, path: relPath, format: outputDef.format });
  emitEvent(ctx, { type: "AssetPublished", actor: "human", payload: { slot: slotRef, version, kind, author: "human", runId: null } });

  const t = applyItemEvent(row.status!, { type: "human_upload" }, { executor: "human" });
  if (t.ok && t.to !== row.status) {
    itemsRepo.setStatus(ctx.dbCtx, itemId, t.to, Date.now());
    emitEvent(ctx, { type: "ItemStatusChanged", actor: "human", payload: { itemId, from: row.status, to: t.to } });
  }

  syncPlanState(ctx);
  await checkpointCommit(ctx, { message: `Upload ${slotRef} v${version}`, actor: "human", trailers: { "Workbench-Event": "AssetPublished" } });

  return assetVersionsRepo.getVersion(ctx.dbCtx, slotRef, major, minor)!;
}

export async function markDone(ctx: EngagementContext, itemId: ItemId): Promise<ItemDetailView> {
  const state = actionState(ctx, itemId);
  const t = applyItemEvent(state.row.status!, { type: "mark_done" }, { executor: "human", allRequiredOutputsPublished: state.allRequiredOutputsPublished });
  if (!t.ok) throw illegalTransition(t.reason);

  itemsRepo.setStatus(ctx.dbCtx, itemId, t.to, Date.now());
  emitEvent(ctx, { type: "ItemStatusChanged", actor: "human", payload: { itemId, from: state.row.status, to: t.to } });

  syncPlanState(ctx);
  await checkpointCommit(ctx, { message: `Mark done: ${itemId}`, actor: "human" });

  return getItemDetailView(ctx, itemId);
}

// ---------------------------------------------------------------------------
// J1.7 — edit item
// ---------------------------------------------------------------------------

export async function editItem(ctx: EngagementContext, itemId: ItemId, brief: string | undefined, acceptance: string[] | undefined): Promise<ItemDetailView> {
  const state = actionState(ctx, itemId);
  const actions = computeItemActions(state);
  if (!actions.edit.allowed) throw illegalTransition(actions.edit.reason ?? "cannot edit");

  const def = readItemMd(ctx.paths.itemMd(itemId));
  const fields: string[] = [];
  if (brief !== undefined && brief !== def.brief) fields.push("brief");
  if (acceptance !== undefined && JSON.stringify(acceptance) !== JSON.stringify(def.acceptance)) fields.push("acceptance");
  const newDef = { ...def, brief: brief ?? def.brief, acceptance: acceptance ?? def.acceptance };

  writeItemMd(ctx.paths.itemMd(itemId), newDef);
  itemsRepo.upsertDefinitions(ctx.dbCtx, [newDef], Date.now());

  ctx.meta = { ...ctx.meta, planVersion: ctx.meta.planVersion + 1 };
  writeEngagementYaml(ctx.paths, ctx.meta);

  emitEvent(ctx, { type: "ItemEdited", actor: "human", payload: { itemId, fields } });
  await checkpointCommit(ctx, { message: `Edit ${itemId}`, actor: "human" });
  reloadMeta(ctx);

  return getItemDetailView(ctx, itemId);
}

// ---------------------------------------------------------------------------
// J1.8, feedback
// ---------------------------------------------------------------------------

export function openFolder(ctx: EngagementContext, itemId?: ItemId): { path: string } {
  const target = itemId ? ctx.paths.itemDir(itemId) : ctx.paths.root;
  if (process.platform === "win32") {
    const child = spawn("explorer.exe", [target], { detached: true, stdio: "ignore", windowsHide: true });
    child.unref();
  }
  return { path: target };
}

export function addFeedback(ctx: EngagementContext, note: string, view: string, itemId: ItemId | null): void {
  const at = new Date().toISOString();
  const line = JSON.stringify({ at, engagementId: ctx.id, note, view, itemId });
  fs.mkdirSync(path.dirname(ctx.workspace.feedbackLog), { recursive: true });
  fs.appendFileSync(ctx.workspace.feedbackLog, `${line}\n`, "utf8");
  emitEvent(ctx, { type: "FeedbackNoted", actor: "human", payload: { note, view, itemId } });
}

// ---------------------------------------------------------------------------
// I2 — J2.3: override an answer the Approach Agent gave, while the item isn't running
// ---------------------------------------------------------------------------

export async function overrideAnswer(ctx: EngagementContext, requestId: RequestId, mode: AnswerMode, text: string): Promise<Request> {
  const request = requestsRepo.getRequest(ctx.dbCtx, requestId);
  if (!request) throw notFound(`no such request: ${requestId}`);
  if (request.type !== "question") throw invalid(`${requestId} is not a question`);
  if (request.response?.kind !== "answer" || !request.response.by.startsWith("approach:")) {
    throw conflict(`${requestId} was not answered by the Approach Agent; there is nothing to override.`);
  }
  if (ctx.activeRuns.has(request.itemId)) throw conflict(`${request.itemId} is currently running; stop it before overriding its answer.`);

  const row = requireItem(ctx, request.itemId);
  if (row.status !== "ready" && row.status !== "at_gate") {
    throw illegalTransition(`Override is only possible while ${request.itemId} is ready or at gate (it is ${row.status ?? "unknown"}).`);
  }

  const now = new Date().toISOString();
  if (row.status === "at_gate") {
    const openStep = gateStepsRepo.getOpenStep(ctx.dbCtx, request.itemId);
    if (openStep?.requestId) requestsRepo.withdrawRequest(ctx.dbCtx, openStep.requestId, now);
  }

  const resolved = requestsRepo.replaceResponse(ctx.dbCtx, requestId, { kind: "answer", mode, text, by: "human", at: now }, now);
  appendWorklog(ctx.paths, request.itemId, { actor: "human", at: now, entry: `Overrode the Approach Agent's answer: ${text}` });
  emitEvent(ctx, { type: "RequestResolved", actor: "human", payload: { requestId, type: "question", itemId: request.itemId, summary: `Overridden by the human (${mode})` } });

  const t = applyItemEvent(row.status, { type: "answer_overridden" }, { executor: row.executor! });
  if (t.ok) {
    itemsRepo.setStatus(ctx.dbCtx, request.itemId, t.to, Date.now());
    emitEvent(ctx, { type: "ItemStatusChanged", actor: "human", payload: { itemId: request.itemId, from: row.status, to: t.to } });
  }
  if (row.lastSessionId) {
    await launchRun(
      ctx,
      request.itemId,
      "resume-answer",
      { reason: "resume-answer", requestId, question: request.payload.question, mode, answer: text, answeredBy: "human" },
      row.lastSessionId,
      "human",
    );
  }

  await checkpointCommit(ctx, { message: `Override answer ${requestId}`, actor: "human" });
  return resolved;
}

// ---------------------------------------------------------------------------
// I2 — J2.8: settings (per engagement) and model profile (workspace-wide)
// ---------------------------------------------------------------------------

export async function patchSettings(ctx: EngagementContext, patch: Partial<Settings>): Promise<EngagementView> {
  const changes: Record<string, string> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    const current = (ctx.meta.settings as unknown as Record<string, unknown>)[key];
    if (current !== value) changes[key] = String(value);
  }

  if (Object.keys(changes).length > 0) {
    ctx.meta = { ...ctx.meta, settings: { ...ctx.meta.settings, ...patch } };
    writeEngagementYaml(ctx.paths, ctx.meta);
    emitEvent(ctx, { type: "SettingsChanged", actor: "human", payload: { changes } });
    await checkpointCommit(ctx, { message: "Update settings", actor: "human" });
    reloadMeta(ctx);
  }

  return getEngagementView(ctx);
}

export function getProfile(server: ServerContext): ProfileView {
  const active = activeProfileName(server);
  const models = server.config.profiles[active]!.models;
  return { active, available: listProfileNames(server), models: { approach: models.approach, work: models.work } };
}

export function patchProfile(server: ServerContext, profile: string): ProfileView {
  setActiveProfile(server, profile);
  return getProfile(server);
}

// ---------------------------------------------------------------------------
// I2 — FYIs
// ---------------------------------------------------------------------------

export function dismissNotification(ctx: EngagementContext, id: NotificationId): void {
  const notification = notificationsRepo.getNotification(ctx.dbCtx, id);
  if (!notification) throw notFound(`no such notification: ${id}`);
  notificationsRepo.dismiss(ctx.dbCtx, id, new Date().toISOString());
  emitEvent(ctx, { type: "NotificationDismissed", actor: "human", payload: { notificationId: id } });
}

// ---------------------------------------------------------------------------
// Engagement listing
// ---------------------------------------------------------------------------

export function listEngagementIds(server: ServerContext): EngagementId[] {
  if (!fs.existsSync(server.workspace.engagementsDir)) return [];
  return fs
    .readdirSync(server.workspace.engagementsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name as EngagementId);
}
