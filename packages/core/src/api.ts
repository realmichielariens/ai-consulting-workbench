// HTTP + WebSocket contract between the server (W5) and the web UI (W6).
// REST for commands and queries, one WebSocket per engagement for events and
// live activity (ARCHITECTURE.md §12.1). W6 builds typed mocks from this file
// until the real server is available.
//
// Rules the UI relies on:
// - The server is the source of truth. Views carry everything needed to render,
//   including which actions are allowed and why not (`Allowed`), so the UI never
//   re-implements engine rules.
// - After any WebSocket (re)connect the UI refetches its queries; events then patch them.

import { z } from "zod";
import { ActivityItem } from "./activity.js";
import {
  AnswerMode,
  AssetVersion,
  CompletionReport,
  EngagementId,
  GateStep,
  GateVerdict,
  InputRef,
  IsoTime,
  ItemDef,
  ItemId,
  ItemKind,
  ItemStatus,
  OutputScope,
  OutputSlot,
  ReadinessBlocker,
  Request,
  RequestId,
  Rollup,
  Run,
  RunId,
  Settings,
  SlotName,
  SlotRef,
  Version,
  Executor,
} from "./domain.js";
import { WorkbenchEvent } from "./events.js";

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

/** Whether an action is possible now and, if not, the reason to show (e.g. a disabled button's tooltip). */
export const Allowed = z.object({ allowed: z.boolean(), reason: z.string().nullable() });
export type Allowed = z.infer<typeof Allowed>;

export const SeedSummary = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  engagementName: z.string(),
  itemCount: z.number().int(),
});
export type SeedSummary = z.infer<typeof SeedSummary>;

export const EngagementSummary = z.object({
  id: EngagementId,
  name: z.string(),
  createdAt: IsoTime,
  seedId: z.string().nullable(),
  planVersion: z.number().int(),
  costUsd: z.number(),
});
export type EngagementSummary = z.infer<typeof EngagementSummary>;

export const EngagementView = EngagementSummary.extend({
  settings: Settings,
  /** Absolute path of the engagement folder (J1.8). */
  folderPath: z.string(),
  runtime: z.enum(["real", "fake"]),
  profile: z.string(),
  workModel: z.string(),
  inboxCount: z.number().int(),
});
export type EngagementView = z.infer<typeof EngagementView>;

export const ItemNode = z.object({
  id: ItemId,
  title: z.string(),
  kind: ItemKind,
  parent: ItemId.nullable(),
  order: z.number().int(),
  executor: Executor.nullable(),
  /** null for composites and the engagement root. */
  status: ItemStatus.nullable(),
  /** Composites only. */
  rollup: Rollup.nullable(),
  gate: z.array(GateStep),
  inputs: z.array(InputRef),
  /** Slot refs of this item's outputs. */
  outputs: z.array(SlotRef),
  /** Empty unless the item is waiting (J1.2). */
  notReadyBecause: z.array(ReadinessBlocker),
  activeRunId: RunId.nullable(),
  /** The last run was interrupted and its session can be resumed (R1, R5). */
  resumable: z.boolean(),
});
export type ItemNode = z.infer<typeof ItemNode>;

export const SlotNode = z.object({
  ref: SlotRef,
  owner: ItemId,
  name: SlotName,
  format: z.string(),
  scope: OutputScope,
  description: z.string(),
  required: z.boolean(),
  latest: AssetVersion.nullable(),
  versionCount: z.number().int(),
  /** Items that declare this slot as an input. */
  consumers: z.array(ItemId),
});
export type SlotNode = z.infer<typeof SlotNode>;

/** Everything the process view (v0) needs. Edges are derived: producer → slot → consumers. */
export const PlanView = z.object({
  engagementId: EngagementId,
  planVersion: z.number().int(),
  items: z.array(ItemNode),
  slots: z.array(SlotNode),
});
export type PlanView = z.infer<typeof PlanView>;

export const ItemActions = z.object({
  start: Allowed,
  stop: Allowed,
  resume: Allowed,
  /** Human items: every required output has a version (J1.6). */
  markDone: Allowed,
  /** Brief/acceptance edits: only while waiting or ready (J1.7). */
  edit: Allowed,
  upload: Allowed,
});
export type ItemActions = z.infer<typeof ItemActions>;

export const ItemDetailView = z.object({
  node: ItemNode,
  def: ItemDef,
  inputs: z.array(
    z.object({
      slot: SlotRef,
      required: z.boolean(),
      producer: ItemId,
      description: z.string(),
      /** The version a run would pin now (or did pin, for a running item); null if unavailable. */
      available: AssetVersion.nullable(),
    }),
  ),
  outputs: z.array(OutputSlot.extend({ slotRef: SlotRef, versions: z.array(AssetVersion) })),
  /** Newest first. */
  runs: z.array(Run),
  activeRun: Run.nullable(),
  openRequests: z.array(Request),
  /** The most recent completion report, if the item was ever submitted. */
  lastReport: CompletionReport.nullable(),
  actions: ItemActions,
});
export type ItemDetailView = z.infer<typeof ItemDetailView>;

const ItemRef = z.object({ id: ItemId, title: z.string() });

export const InboxEntry = z.discriminatedUnion("kind", [
  /** J1.4: approve / amend / replace. */
  z.object({ kind: z.literal("question"), request: Request, item: ItemRef }),
  /** J1.5: approve / request changes, for the exact versions in request.payload.submitted. */
  z.object({ kind: z.literal("review"), request: Request, item: ItemRef }),
  /** J1.6: a ready or in-progress human item with its inputs and output slots. */
  z.object({
    kind: z.literal("human_item"),
    item: ItemRef,
    status: ItemStatus,
    inputs: z.array(z.object({ slot: SlotRef, required: z.boolean(), available: AssetVersion.nullable() })),
    outputs: z.array(z.object({ slot: SlotName, slotRef: SlotRef, required: z.boolean(), format: z.string(), latest: AssetVersion.nullable() })),
    markDone: Allowed,
  }),
  /** R3: retry / stop. */
  z.object({ kind: z.literal("run_issue"), request: Request, item: ItemRef }),
]);
export type InboxEntry = z.infer<typeof InboxEntry>;

export const InboxView = z.object({ entries: z.array(InboxEntry) });
export type InboxView = z.infer<typeof InboxView>;

export const AssetVersionsView = z.object({
  slot: SlotRef,
  owner: ItemId,
  format: z.string(),
  scope: OutputScope,
  description: z.string(),
  /** Newest first. */
  versions: z.array(AssetVersion),
});
export type AssetVersionsView = z.infer<typeof AssetVersionsView>;

export const AssetContentView = z.object({
  version: AssetVersion,
  /** Text content for md/txt/csv/json; null for binaries (use the raw route). */
  text: z.string().nullable(),
});
export type AssetContentView = z.infer<typeof AssetContentView>;

export const RunActivityView = z.object({ run: Run, activity: z.array(ActivityItem) });
export type RunActivityView = z.infer<typeof RunActivityView>;

export const WorklogView = z.object({ itemId: ItemId, markdown: z.string() });
export type WorklogView = z.infer<typeof WorklogView>;

export const ApiErrorCode = z.enum(["not_found", "invalid", "conflict", "illegal_transition", "internal"]);
export type ApiErrorCode = z.infer<typeof ApiErrorCode>;

/** Error body for every non-2xx response. HTTP: not_found 404, invalid 400, conflict 409, illegal_transition 409, internal 500. */
export const ApiError = z.object({ error: z.object({ code: ApiErrorCode, message: z.string() }) });
export type ApiError = z.infer<typeof ApiError>;

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export interface RouteDef {
  method: "GET" | "POST" | "PATCH";
  path: string;
  params?: z.ZodObject;
  query?: z.ZodObject;
  /** "multipart": a single file field named "file". */
  body?: z.ZodType | "multipart";
  /** "binary": raw file bytes with the right Content-Type and Content-Disposition. */
  response: z.ZodType | "binary";
}

const E = z.object({ eid: EngagementId });
const EI = E.extend({ itemId: ItemId });
const ER = E.extend({ rid: RequestId });
const Ok = z.object({ ok: z.literal(true) });

export const routes = {
  health: { method: "GET", path: "/api/health", response: z.object({ ok: z.literal(true), runtime: z.enum(["real", "fake"]) }) },

  // J1.1
  listSeeds: { method: "GET", path: "/api/seeds", response: z.array(SeedSummary) },
  listEngagements: { method: "GET", path: "/api/engagements", response: z.array(EngagementSummary) },
  createEngagement: {
    method: "POST",
    path: "/api/engagements",
    body: z.object({ seedId: z.string(), name: z.string().min(1) }),
    response: EngagementSummary,
  },
  getEngagement: { method: "GET", path: "/api/engagements/:eid", params: E, response: EngagementView },

  // J1.2
  getPlan: { method: "GET", path: "/api/engagements/:eid/plan", params: E, response: PlanView },
  getItem: { method: "GET", path: "/api/engagements/:eid/items/:itemId", params: EI, response: ItemDetailView },

  // J1.7
  editItem: {
    method: "PATCH",
    path: "/api/engagements/:eid/items/:itemId",
    params: EI,
    body: z.object({ brief: z.string().min(1).optional(), acceptance: z.array(z.string()).optional() }),
    response: ItemDetailView,
  },

  // J1.3, R5, R1
  startItem: { method: "POST", path: "/api/engagements/:eid/items/:itemId/start", params: EI, response: Run },
  stopItem: { method: "POST", path: "/api/engagements/:eid/items/:itemId/stop", params: EI, response: Ok },
  resumeItem: { method: "POST", path: "/api/engagements/:eid/items/:itemId/resume", params: EI, response: Run },
  getWorklog: { method: "GET", path: "/api/engagements/:eid/items/:itemId/worklog", params: EI, response: WorklogView },
  getRunActivity: {
    method: "GET",
    path: "/api/engagements/:eid/runs/:runId/activity",
    params: E.extend({ runId: RunId }),
    response: RunActivityView,
  },

  // J1.6
  uploadOutput: {
    method: "POST",
    path: "/api/engagements/:eid/items/:itemId/outputs/:slot",
    params: EI.extend({ slot: SlotName }),
    body: "multipart",
    response: AssetVersion,
  },
  markDone: { method: "POST", path: "/api/engagements/:eid/items/:itemId/done", params: EI, response: ItemDetailView },

  // Asset viewer
  getAssetVersions: {
    method: "GET",
    path: "/api/engagements/:eid/assets/:itemId/:slot",
    params: EI.extend({ slot: SlotName }),
    response: AssetVersionsView,
  },
  getAssetVersion: {
    method: "GET",
    path: "/api/engagements/:eid/assets/:itemId/:slot/:version",
    params: EI.extend({ slot: SlotName, version: Version }),
    response: AssetContentView,
  },
  getAssetRaw: {
    method: "GET",
    path: "/api/engagements/:eid/assets/:itemId/:slot/:version/raw",
    params: EI.extend({ slot: SlotName, version: Version }),
    response: "binary",
  },

  // J1.4, J1.5, R3
  getInbox: { method: "GET", path: "/api/engagements/:eid/inbox", params: E, response: InboxView },
  answerQuestion: {
    method: "POST",
    path: "/api/engagements/:eid/requests/:rid/answer",
    params: ER,
    body: z.object({ mode: AnswerMode, text: z.string().min(1) }),
    response: Request,
  },
  recordVerdict: {
    method: "POST",
    path: "/api/engagements/:eid/requests/:rid/verdict",
    params: ER,
    body: z.object({ verdict: GateVerdict, comments: z.string().default("") }),
    response: Request,
  },
  resolveRunIssue: {
    method: "POST",
    path: "/api/engagements/:eid/requests/:rid/issue",
    params: ER,
    body: z.object({ action: z.enum(["retry", "stop"]) }),
    response: Request,
  },

  // J1.8 and feedback
  openFolder: {
    method: "POST",
    path: "/api/engagements/:eid/open-folder",
    params: E,
    body: z.object({ itemId: ItemId.optional() }),
    response: z.object({ path: z.string() }),
  },
  addFeedback: {
    method: "POST",
    path: "/api/engagements/:eid/feedback",
    params: E,
    body: z.object({ note: z.string().min(1), view: z.string(), itemId: ItemId.nullable() }),
    response: Ok,
  },
} as const satisfies Record<string, RouteDef>;

export type RouteName = keyof typeof routes;

/** Fill a route path: buildPath(routes.getItem.path, { eid, itemId }). */
export function buildPath(path: string, params: Record<string, string>): string {
  return path.replace(/:([a-zA-Z]+)/g, (_, k: string) => {
    const v = params[k];
    if (v === undefined) throw new Error(`missing path param ${k}`);
    return encodeURIComponent(v);
  });
}

// ---------------------------------------------------------------------------
// WebSocket: GET /api/engagements/:eid/ws
// ---------------------------------------------------------------------------

export const WS_PATH = "/api/engagements/:eid/ws";

export const WsServerMessage = z.discriminatedUnion("type", [
  /** First message after connect. The UI refetches its queries, then applies events with seq > lastSeq. */
  z.object({ type: z.literal("hello"), engagementId: EngagementId, lastSeq: z.number().int() }),
  z.object({ type: z.literal("event"), event: WorkbenchEvent }),
  /** Live run activity (not persisted as an event). */
  z.object({ type: z.literal("activity"), runId: RunId, itemId: ItemId, item: ActivityItem }),
]);
export type WsServerMessage = z.infer<typeof WsServerMessage>;
