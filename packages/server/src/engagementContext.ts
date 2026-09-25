// The engagement registry (I1-PLAN.md §6 W5, ARCHITECTURE.md §3): per
// engagement, a lazily-opened context bundling its DB handle, paths, meta,
// event bus (persist + fan out to WS subscribers), runtime and active runs.
// Only one context per engagement id exists per process (openEngagement is
// idempotent), which is what makes leases + activeRuns a reliable single
// source of truth for "is this item running right now".

import {
  type ActivityItem,
  type Actor,
  type AgentRuntime,
  type ApproachRuntime,
  type CompletionReport,
  type EngagementId,
  type EngagementMeta,
  type ItemId,
  type RequestId,
  type RunHandle,
  type RunId,
  type SlotVersionRef,
  type ThreadId,
  type WorkbenchEvent,
  type WsServerMessage,
} from "@workbench/core";
import { createFakeApproachRuntime, createFakeRuntime, createSdkApproachRuntime, createSdkRuntime } from "@workbench/agents";
import {
  engagementPaths,
  loadConfig,
  repoRoot,
  workspacePaths,
  type EngagementPaths,
  type ResolvedWorkbenchConfig,
  type WorkspacePaths,
} from "@workbench/core/node";
import { activeProfile, type ModelProfile } from "@workbench/core";
import fs from "node:fs";
import { eventsRepo, openEngagementDb, type Db } from "@workbench/db";
import { createWriteQueue, readEngagementYaml, type WriteQueue } from "@workbench/store";

export type RuntimeKind = "real" | "fake";

/**
 * Structural subset of `ws`'s WebSocket (and the DOM WebSocket it mirrors):
 * `readyState`/`OPEN` are instance-accessible constants in both. Avoids a
 * direct dependency on the `ws` package, which packages/server does not
 * declare (it is @fastify/websocket's transitive dependency).
 */
export interface WsClient {
  readonly readyState: number;
  readonly OPEN: number;
  send(data: string): void;
}

/** Process-wide server context: config, workspace, and the open engagement registry. */
export interface ServerContext {
  repoRoot: string;
  config: ResolvedWorkbenchConfig;
  workspace: WorkspacePaths;
  runtimeKind: RuntimeKind;
  engagements: Map<EngagementId, EngagementContext>;
}

/** One engagement's live state: DB, files, event bus, runtime and active runs. */
export interface EngagementContext {
  id: EngagementId;
  server: ServerContext;
  paths: EngagementPaths;
  workspace: WorkspacePaths;
  dbCtx: Db;
  /** Serializes checkpoint commits (git operations): several runs can publish concurrently, but only one git commit runs at a time. */
  writeQueue: WriteQueue;
  runtime: AgentRuntime;
  /** I2: the Approach Agent runtime (stubs until package B lands). Kept out of `activeRuns`/autostart concurrency. */
  approachRuntime: ApproachRuntime;
  profile: ModelProfile;
  /** Reloaded after every write (editItem bumps planVersion, settings changes, …). */
  meta: EngagementMeta;
  /** itemId -> the run currently holding that item's lease, for stop() and "already running". */
  activeRuns: Map<ItemId, { runId: RunId; handle: RunHandle }>;
  /** submit_outputs's report, held until the run ends and finishRun/gate-open can use it. */
  pendingReports: Map<RunId, { report: CompletionReport; submittedVersions: SlotVersionRef[] }>;
  /**
   * I2: Approach Agent runs (conversation turns and task sessions), recorded
   * with itemId "ENG" but tracked separately from `activeRuns` — they never
   * count toward the Work Agent autostart concurrency limit. Keyed by runId
   * because several kinds of Approach run can exist in the registry's
   * lifetime, even though only one of each kind is ever active at once
   * (enforced by the "aa-thread:*" / "aa-task:*" leases, not by this map).
   */
  approachRuns: Map<RunId, { runId: RunId; handle: RunHandle; kind: "conversation" | "question" | "suggestion"; threadId: ThreadId | null; requestId: RequestId | null }>;
  /** FIFO queue of routed questions/suggestions waiting for the one-at-a-time Approach task session (I2-PLAN §4.1). */
  approachTaskQueue: { kind: "question" | "suggestion"; requestId: RequestId }[];
  wsClients: Set<WsClient>;
  /**
   * Bound once by runService.ts right after the context is created (breaks
   * an import cycle: scheduler.ts/workPort.ts need to trigger an autostart
   * without importing runService.ts, which itself imports workPort.ts).
   */
  startAgentRun?: (itemId: ItemId) => void;
  /** I2: bound by approachRunner.ts — runService.ts/questionRouting.ts pump the one-at-a-time task queue without importing approachRunner.ts. */
  pumpApproachTasks?: () => void;
}

export function createServerContext(runtimeKind: RuntimeKind): ServerContext {
  const root = repoRoot();
  const config = loadConfig(root);
  return {
    repoRoot: root,
    config,
    workspace: workspacePaths(config.resolved.home),
    runtimeKind,
    engagements: new Map(),
  };
}

function buildRuntime(server: ServerContext): AgentRuntime {
  if (server.runtimeKind === "fake") return createFakeRuntime({});
  return createSdkRuntime(
    {
      promptsDir: server.config.resolved.promptsDir,
      skillsPluginPath: server.config.resolved.skillsPlugin,
      devCapUsd: server.config.dev.totalCapUsd,
      repoRoot: server.repoRoot,
    },
    server.workspace,
  );
}

function buildApproachRuntime(server: ServerContext): ApproachRuntime {
  if (server.runtimeKind === "fake") return createFakeApproachRuntime({});
  return createSdkApproachRuntime(
    {
      promptsDir: server.config.resolved.promptsDir,
      skillsPluginPath: server.config.resolved.skillsPlugin,
      devCapUsd: server.config.dev.totalCapUsd,
      repoRoot: server.repoRoot,
    },
    server.workspace,
  );
}

/** Opens (or returns the already-open) context for an engagement folder that already exists on disk. */
export function openEngagement(server: ServerContext, id: EngagementId): EngagementContext {
  const existing = server.engagements.get(id);
  if (existing) return existing;

  const root = server.workspace.engagement(id);
  const paths = engagementPaths(root);
  fs.mkdirSync(paths.workbenchDir, { recursive: true });
  const dbCtx = openEngagementDb(paths.dbFile);
  const meta = readEngagementYaml(paths);

  const ctx: EngagementContext = {
    id,
    server,
    paths,
    workspace: server.workspace,
    dbCtx,
    writeQueue: createWriteQueue(),
    runtime: buildRuntime(server),
    approachRuntime: buildApproachRuntime(server),
    profile: activeProfile(server.config),
    meta,
    activeRuns: new Map(),
    pendingReports: new Map(),
    approachRuns: new Map(),
    approachTaskQueue: [],
    wsClients: new Set(),
  };
  server.engagements.set(id, ctx);
  return ctx;
}

export function reloadMeta(ctx: EngagementContext): void {
  ctx.meta = readEngagementYaml(ctx.paths);
}

// ---------------------------------------------------------------------------
// Event bus: persist (events table) + fan out to this engagement's WS clients.
// Run activity is NOT persisted as an event (api.ts, activity.ts) — it goes
// to the per-run JSONL file (runService.ts) and is pushed live only.
// ---------------------------------------------------------------------------

function broadcast(ctx: EngagementContext, message: WsServerMessage): void {
  const text = JSON.stringify(message);
  for (const client of ctx.wsClients) {
    if (client.readyState === client.OPEN) client.send(text);
  }
}

export function pushEvent(ctx: EngagementContext, event: WorkbenchEvent): void {
  broadcast(ctx, { type: "event", event });
}

export function pushActivity(ctx: EngagementContext, runId: RunId, itemId: ItemId, item: ActivityItem, threadId?: ThreadId): void {
  broadcast(ctx, threadId ? { type: "activity", runId, itemId, threadId, item } : { type: "activity", runId, itemId, item });
}

/** Persists an event (events table, `seq` assigned by the DB) and fans it out. Returns the full envelope. */
export function emitEvent(
  ctx: EngagementContext,
  input: { type: string; actor: Actor; payload: unknown; at?: string },
): WorkbenchEvent {
  const at = input.at ?? new Date().toISOString();
  const event = eventsRepo.appendEvent(ctx.dbCtx, ctx.id, { type: input.type, actor: input.actor, payload: input.payload, at });
  pushEvent(ctx, event);
  return event;
}
