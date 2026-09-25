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
  ChatMessage,
  Notification,
  NotificationId,
  Proposal,
  ProposalId,
  ThreadId,
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
  /** I2: the model new Approach Agent sessions use (J2.8). */
  approachModel: z.string(),
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

/** A pending proposal applied to a copy of the plan (J2.2 "Preview in process view"). Nothing is written. */
export const PlanPreviewView = PlanView.extend({
  proposalId: ProposalId,
  /** The plan version the preview would become. */
  basePlanVersion: z.number().int(),
  added: z.array(ItemId),
  changed: z.array(ItemId),
  cancelled: z.array(ItemId),
});
export type PlanPreviewView = z.infer<typeof PlanPreviewView>;

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

// ---------------------------------------------------------------------------
// I2 views: proposals, conversation, notifications, profile, journal
// ---------------------------------------------------------------------------

export const ProposalView = z.object({
  proposal: Proposal,
  /** One readable line per op, in order, e.g. "Add WI-004 Consolidate themes under PH-2, inputs: …, output: themes (md)". */
  readableOps: z.array(z.string()),
  /** Title of proposal.suggestedBy, for "suggested by WI-004 Consolidate themes". */
  suggestedByTitle: z.string().nullable(),
  actions: z.object({ approve: Allowed, reject: Allowed }),
});
export type ProposalView = z.infer<typeof ProposalView>;

export const ThreadSummary = z.object({
  id: ThreadId,
  subject: z.string(),
  createdAt: IsoTime,
  messageCount: z.number().int(),
  /** The running turn, if any. While set, posting a message returns 409 and the UI queues it (D5). */
  activeRunId: RunId.nullable(),
});
export type ThreadSummary = z.infer<typeof ThreadSummary>;

export const ThreadView = z.object({
  thread: ThreadSummary,
  /** Oldest first. */
  messages: z.array(ChatMessage),
  /** The running turn (stream its activity with getRunActivity + WS). */
  activeRun: Run.nullable(),
});
export type ThreadView = z.infer<typeof ThreadView>;

export const PostMessageResult = z.object({ messageId: z.string(), runId: RunId });
export type PostMessageResult = z.infer<typeof PostMessageResult>;

export const ProfileView = z.object({
  active: z.string(),
  available: z.array(z.string()),
  models: z.object({ approach: z.string(), work: z.string() }),
});
export type ProfileView = z.infer<typeof ProfileView>;

export const JournalView = z.object({ markdown: z.string() });
export type JournalView = z.infer<typeof JournalView>;

const ItemRef = z.object({ id: ItemId, title: z.string() });

export const InboxEntry = z.discriminatedUnion("kind", [
  /**
   * J1.4: approve / amend / replace. Under aa-first only escalated questions reach the Inbox;
   * request.escalation then holds the Approach Agent's view (J2.4).
   */
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
  /** J2.2 / J2.5: a pending proposal: approve / reject with a reason / preview. */
  z.object({ kind: z.literal("proposal"), proposal: ProposalView }),
  /**
   * J2.3: an FYI (dismissible). When it is about a question the Approach Agent answered,
   * `request` is that question (response.by = "approach:…") and `override` says whether the human can override now.
   */
  z.object({
    kind: z.literal("fyi"),
    notification: Notification,
    request: Request.nullable(),
    item: ItemRef.nullable(),
    override: Allowed,
  }),
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
const ET = E.extend({ tid: ThreadId });
const EP = E.extend({ pid: ProposalId });
const EN = E.extend({ nid: NotificationId });
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
    /** seedId "blank" = "Start with the Approach Agent" (J2.1): only the ENG item, no assets. */
    body: z.object({ seedId: z.string(), name: z.string().min(1), settings: Settings.partial().optional() }),
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

  // I2 — J2.1, J2.6, J2.7: the conversation (one thread, T-0001, created with the engagement)
  listThreads: { method: "GET", path: "/api/engagements/:eid/threads", params: E, response: z.array(ThreadSummary) },
  getThread: { method: "GET", path: "/api/engagements/:eid/threads/:tid", params: ET, response: ThreadView },
  /** 202: the turn started. 409 conflict while a turn is running (the UI queues, D5). */
  postMessage: {
    method: "POST",
    path: "/api/engagements/:eid/threads/:tid/messages",
    params: ET,
    body: z.object({ text: z.string().min(1) }),
    response: PostMessageResult,
  },

  // I2 — J2.2, J2.5: proposals
  listProposals: { method: "GET", path: "/api/engagements/:eid/proposals", params: E, response: z.array(ProposalView) },
  getProposal: { method: "GET", path: "/api/engagements/:eid/proposals/:pid", params: EP, response: ProposalView },
  previewProposal: { method: "GET", path: "/api/engagements/:eid/proposals/:pid/preview", params: EP, response: PlanPreviewView },
  approveProposal: { method: "POST", path: "/api/engagements/:eid/proposals/:pid/approve", params: EP, response: ProposalView },
  rejectProposal: {
    method: "POST",
    path: "/api/engagements/:eid/proposals/:pid/reject",
    params: EP,
    body: z.object({ reason: z.string().min(1) }),
    response: ProposalView,
  },

  // I2 — J2.3: override an answer given by the Approach Agent (only while the item is not running)
  overrideAnswer: {
    method: "POST",
    path: "/api/engagements/:eid/requests/:rid/override",
    params: ER,
    body: z.object({ mode: AnswerMode, text: z.string().min(1) }),
    response: Request,
  },

  // I2 — FYIs
  listNotifications: { method: "GET", path: "/api/engagements/:eid/notifications", params: E, response: z.array(Notification) },
  dismissNotification: { method: "POST", path: "/api/engagements/:eid/notifications/:nid/dismiss", params: EN, response: Ok },

  // I2 — J2.8: settings (per engagement) and model profile (workspace-wide, new sessions only)
  patchSettings: {
    method: "PATCH",
    path: "/api/engagements/:eid/settings",
    params: E,
    body: Settings.partial(),
    response: EngagementView,
  },
  getProfile: { method: "GET", path: "/api/profile", response: ProfileView },
  patchProfile: { method: "PATCH", path: "/api/profile", body: z.object({ profile: z.string().min(1) }), response: ProfileView },

  // I2 — D4: the approach journal (ENG/work/approach-journal.md), read-only
  getJournal: { method: "GET", path: "/api/engagements/:eid/journal", params: E, response: JournalView },
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
  /** Live run activity (not persisted as an event). Approach Agent runs: itemId "ENG"; conversation turns also carry threadId. */
  z.object({ type: z.literal("activity"), runId: RunId, itemId: ItemId, threadId: ThreadId.optional(), item: ActivityItem }),
]);
export type WsServerMessage = z.infer<typeof WsServerMessage>;
