// The one interface the UI codes against (never the concrete HTTP or mock
// implementation). It mirrors every route in `@workbench/core`'s `routes`
// plus the WebSocket, so the UI has exactly one seam to swap at
// `VITE_API_MOCK=1` (see index.ts).

import type {
  AssetContentView,
  AssetVersion,
  AssetVersionsView,
  EngagementId,
  EngagementSummary,
  EngagementView,
  ItemDetailView,
  ItemId,
  InboxView,
  JournalView,
  Notification,
  NotificationId,
  PlanPreviewView,
  PlanView,
  PatchProfileBody,
  ProfileView,
  ProposalId,
  ProposalView,
  Request,
  RequestId,
  Run,
  RunActivityView,
  RunId,
  SeedSummary,
  Settings,
  SlotName,
  ThreadId,
  ThreadSummary,
  ThreadView,
  PostMessageResult,
  StageContext,
  Version,
  WorklogView,
  WsServerMessage,
} from "@workbench/core";

/** Thrown by every API method on a non-2xx response (ApiError body from api.ts). */
export class ApiRequestError extends Error {
  constructor(
    public readonly code: "not_found" | "invalid" | "conflict" | "illegal_transition" | "internal",
    message: string,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

export type WsStatus = "connecting" | "open" | "closed" | "reconnecting";

export interface WorkbenchApi {
  // J1.1
  listSeeds(): Promise<SeedSummary[]>;
  listEngagements(): Promise<EngagementSummary[]>;
  createEngagement(body: { seedId: string; name: string }): Promise<EngagementSummary>;
  deleteEngagement(eid: EngagementId): Promise<{ ok: true }>;
  getEngagement(eid: EngagementId): Promise<EngagementView>;

  // J1.2
  getPlan(eid: EngagementId): Promise<PlanView>;
  getItem(eid: EngagementId, itemId: ItemId): Promise<ItemDetailView>;

  // J1.7
  editItem(eid: EngagementId, itemId: ItemId, body: { brief?: string; acceptance?: string[] }): Promise<ItemDetailView>;

  // J1.3, R5, R1
  startItem(eid: EngagementId, itemId: ItemId): Promise<Run>;
  stopItem(eid: EngagementId, itemId: ItemId): Promise<{ ok: true }>;
  resumeItem(eid: EngagementId, itemId: ItemId): Promise<Run>;
  getWorklog(eid: EngagementId, itemId: ItemId): Promise<WorklogView>;
  getRunActivity(eid: EngagementId, runId: RunId): Promise<RunActivityView>;

  // J1.6
  uploadOutput(eid: EngagementId, itemId: ItemId, slot: SlotName, file: File): Promise<AssetVersion>;
  markDone(eid: EngagementId, itemId: ItemId): Promise<ItemDetailView>;

  // Asset viewer
  getAssetVersions(eid: EngagementId, itemId: ItemId, slot: SlotName): Promise<AssetVersionsView>;
  getAssetVersion(eid: EngagementId, itemId: ItemId, slot: SlotName, version: Version): Promise<AssetContentView>;
  /** Same-origin URL for the raw download route; the UI uses it as an <a href>. */
  getAssetRawUrl(eid: EngagementId, itemId: ItemId, slot: SlotName, version: Version): string;

  // J1.4, J1.5, R3
  getInbox(eid: EngagementId): Promise<InboxView>;
  answerQuestion(eid: EngagementId, rid: RequestId, body: { mode: "approve" | "amend" | "replace"; text: string }): Promise<Request>;
  recordVerdict(eid: EngagementId, rid: RequestId, body: { verdict: "approved" | "changes_requested"; comments: string }): Promise<Request>;
  resolveRunIssue(eid: EngagementId, rid: RequestId, body: { action: "retry" | "stop" }): Promise<Request>;

  // J1.8 and feedback
  openFolder(eid: EngagementId, itemId?: ItemId): Promise<{ path: string }>;
  addFeedback(eid: EngagementId, body: { note: string; view: string; itemId: ItemId | null }): Promise<{ ok: true }>;

  // I2 — J2.1, J2.6, J2.7: the conversation
  listThreads(eid: EngagementId): Promise<ThreadSummary[]>;
  getThread(eid: EngagementId, tid: ThreadId): Promise<ThreadView>;
  /** UX1 C2: `context` is what the stage shows (the rail's context chip); never persisted. */
  postMessage(eid: EngagementId, tid: ThreadId, body: { text: string; context?: StageContext }): Promise<PostMessageResult>;

  // I2 — J2.2, J2.5: proposals
  listProposals(eid: EngagementId): Promise<ProposalView[]>;
  getProposal(eid: EngagementId, pid: ProposalId): Promise<ProposalView>;
  previewProposal(eid: EngagementId, pid: ProposalId): Promise<PlanPreviewView>;
  approveProposal(eid: EngagementId, pid: ProposalId): Promise<ProposalView>;
  rejectProposal(eid: EngagementId, pid: ProposalId, body: { reason: string }): Promise<ProposalView>;

  // I2 — J2.3: override an Approach Agent answer
  overrideAnswer(eid: EngagementId, rid: RequestId, body: { mode: "approve" | "amend" | "replace"; text: string }): Promise<Request>;

  // I2 — FYIs
  listNotifications(eid: EngagementId): Promise<Notification[]>;
  dismissNotification(eid: EngagementId, nid: NotificationId): Promise<{ ok: true }>;

  // I2 — J2.8: settings and model profile
  patchSettings(eid: EngagementId, body: Partial<Settings>): Promise<EngagementView>;
  getProfile(): Promise<ProfileView>;
  patchProfile(body: PatchProfileBody): Promise<ProfileView>;

  // I2 — D4: the Approach Agent's journal
  getJournal(eid: EngagementId): Promise<JournalView>;

  /**
   * Open the per-engagement WebSocket. Calls `onMessage` for every parsed
   * `WsServerMessage`, and `onStatus` whenever the connection status
   * changes. Reconnects with backoff on drop. Returns a function that
   * closes the socket for good (component unmount).
   */
  connectWs(eid: EngagementId, onMessage: (msg: WsServerMessage) => void, onStatus: (status: WsStatus) => void): () => void;
}
