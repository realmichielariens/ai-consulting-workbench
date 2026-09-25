// The real HTTP + WebSocket implementation of WorkbenchApi. Every call goes
// through `routes[x]` (buildPath for the URL, the route's Zod schema for the
// response) so drift between this client and `@workbench/core/api.ts` is
// caught immediately in dev, never silently trusted.

import { ApiError, buildPath, routes, WS_PATH, WsServerMessage, type RouteDef } from "@workbench/core";
import type {
  AssetContentView,
  AssetVersion,
  AssetVersionsView,
  EngagementId,
  EngagementSummary,
  EngagementView,
  InboxView,
  ItemDetailView,
  ItemId,
  JournalView,
  Notification,
  NotificationId,
  PlanPreviewView,
  PlanView,
  ProfileView,
  ProposalId,
  ProposalView,
  Request,
  Run,
  RunActivityView,
  SeedSummary,
  SlotName,
  ThreadId,
  ThreadSummary,
  ThreadView,
  PostMessageResult,
  Version,
  WorklogView,
} from "@workbench/core";
import { ApiRequestError, type WorkbenchApi, type WsStatus } from "./types.js";

async function toApiError(res: Response): Promise<ApiRequestError> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // non-JSON error body; fall through to a generic message
  }
  const parsed = ApiError.safeParse(body);
  if (parsed.success) return new ApiRequestError(parsed.data.error.code, parsed.data.error.message);
  return new ApiRequestError("internal", `HTTP ${res.status} ${res.statusText}`);
}

/**
 * Parses a route's response body, surfacing contract drift loudly in dev
 * (never silently trusting the server). Typed structurally rather than by
 * naming `z.ZodType` — apps/web deliberately has no direct "zod" dependency
 * (CLAUDE.md rule 3: dependencies are pre-installed per package); every Zod
 * schema it touches is used only through `@workbench/core`'s own exports.
 */
interface ParseableSchema {
  safeParse: (body: unknown) => { success: true; data: unknown } | { success: false; error: { issues: { message: string }[] } };
}

function parseOrThrow(routeName: string, schema: ParseableSchema, body: unknown): unknown {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const message = `API contract drift on "${routeName}": response did not match the Zod schema in api.ts.`;
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console -- deliberate: this must be loud in dev
      console.error(message, parsed.error.issues);
    }
    throw new Error(`${message} ${parsed.error.issues.map((i) => i.message).join("; ")}`);
  }
  return parsed.data;
}

interface CallOpts {
  params?: Record<string, string>;
  query?: Record<string, string>;
  body?: unknown;
  file?: File;
}

async function call<Name extends keyof typeof routes>(name: Name, opts: CallOpts = {}): Promise<unknown> {
  const route = routes[name] as RouteDef;
  let path = opts.params ? buildPath(route.path, opts.params) : route.path;
  if (opts.query) {
    const qs = new URLSearchParams(opts.query).toString();
    if (qs) path += `?${qs}`;
  }

  let res: Response;
  if (route.body === "multipart") {
    const form = new FormData();
    if (opts.file) form.append("file", opts.file);
    res = await fetch(path, { method: route.method, body: form });
  } else {
    res = await fetch(path, {
      method: route.method,
      headers: opts.body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  }

  if (route.response === "binary") {
    if (!res.ok) throw await toApiError(res);
    return res;
  }

  if (!res.ok) throw await toApiError(res);
  const json: unknown = await res.json();
  return parseOrThrow(String(name), route.response, json);
}

function rawUrl(eid: EngagementId, itemId: ItemId, slot: SlotName, version: Version): string {
  return buildPath(routes.getAssetRaw.path, { eid, itemId, slot, version });
}

const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 8000;

function connectWs(eid: EngagementId, onMessage: (msg: WsServerMessage) => void, onStatus: (status: WsStatus) => void): () => void {
  let closedForGood = false;
  let socket: WebSocket | null = null;
  let attempt = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  const open = () => {
    if (closedForGood) return;
    onStatus(attempt === 0 ? "connecting" : "reconnecting");
    const path = buildPath(WS_PATH, { eid });
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    socket = new WebSocket(`${proto}//${window.location.host}${path}`);

    socket.onopen = () => {
      attempt = 0;
      onStatus("open");
    };
    socket.onmessage = (ev: MessageEvent<string>) => {
      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(ev.data);
      } catch {
        return;
      }
      const parsed = WsServerMessage.safeParse(parsedJson);
      if (!parsed.success) {
        if (import.meta.env.DEV) {
          // eslint-disable-next-line no-console
          console.error("WS message did not match WsServerMessage contract", parsed.error.issues, parsedJson);
        }
        return;
      }
      onMessage(parsed.data);
    };
    socket.onerror = () => {
      // onclose follows; reconnect scheduled there
    };
    socket.onclose = () => {
      if (closedForGood) return;
      onStatus("closed");
      const delay = Math.min(RECONNECT_BASE_MS * 2 ** attempt, RECONNECT_MAX_MS);
      attempt += 1;
      retryTimer = setTimeout(open, delay);
    };
  };

  open();

  return () => {
    closedForGood = true;
    if (retryTimer) clearTimeout(retryTimer);
    socket?.close();
  };
}

export const httpApi: WorkbenchApi = {
  listSeeds: () => call("listSeeds") as Promise<SeedSummary[]>,
  listEngagements: () => call("listEngagements") as Promise<EngagementSummary[]>,
  createEngagement: (body) => call("createEngagement", { body }) as Promise<EngagementSummary>,
  getEngagement: (eid) => call("getEngagement", { params: { eid } }) as Promise<EngagementView>,

  getPlan: (eid) => call("getPlan", { params: { eid } }) as Promise<PlanView>,
  getItem: (eid, itemId) => call("getItem", { params: { eid, itemId } }) as Promise<ItemDetailView>,

  editItem: (eid, itemId, body) => call("editItem", { params: { eid, itemId }, body }) as Promise<ItemDetailView>,

  startItem: (eid, itemId) => call("startItem", { params: { eid, itemId } }) as Promise<Run>,
  stopItem: (eid, itemId) => call("stopItem", { params: { eid, itemId } }) as Promise<{ ok: true }>,
  resumeItem: (eid, itemId) => call("resumeItem", { params: { eid, itemId } }) as Promise<Run>,
  getWorklog: (eid, itemId) => call("getWorklog", { params: { eid, itemId } }) as Promise<WorklogView>,
  getRunActivity: (eid, runId) => call("getRunActivity", { params: { eid, runId } }) as Promise<RunActivityView>,

  uploadOutput: (eid, itemId, slot, file) => call("uploadOutput", { params: { eid, itemId, slot }, file }) as Promise<AssetVersion>,
  markDone: (eid, itemId) => call("markDone", { params: { eid, itemId } }) as Promise<ItemDetailView>,

  getAssetVersions: (eid, itemId, slot) => call("getAssetVersions", { params: { eid, itemId, slot } }) as Promise<AssetVersionsView>,
  getAssetVersion: (eid, itemId, slot, version) =>
    call("getAssetVersion", { params: { eid, itemId, slot, version } }) as Promise<AssetContentView>,
  getAssetRawUrl: rawUrl,

  getInbox: (eid) => call("getInbox", { params: { eid } }) as Promise<InboxView>,
  answerQuestion: (eid, rid, body) => call("answerQuestion", { params: { eid, rid }, body }) as Promise<Request>,
  recordVerdict: (eid, rid, body) => call("recordVerdict", { params: { eid, rid }, body }) as Promise<Request>,
  resolveRunIssue: (eid, rid, body) => call("resolveRunIssue", { params: { eid, rid }, body }) as Promise<Request>,

  openFolder: (eid, itemId) => call("openFolder", { params: { eid }, body: { itemId } }) as Promise<{ path: string }>,
  addFeedback: (eid, body) => call("addFeedback", { params: { eid }, body }) as Promise<{ ok: true }>,

  listThreads: (eid) => call("listThreads", { params: { eid } }) as Promise<ThreadSummary[]>,
  getThread: (eid, tid) => call("getThread", { params: { eid, tid } }) as Promise<ThreadView>,
  postMessage: (eid, tid, body) => call("postMessage", { params: { eid, tid }, body }) as Promise<PostMessageResult>,

  listProposals: (eid) => call("listProposals", { params: { eid } }) as Promise<ProposalView[]>,
  getProposal: (eid, pid) => call("getProposal", { params: { eid, pid } }) as Promise<ProposalView>,
  previewProposal: (eid, pid) => call("previewProposal", { params: { eid, pid } }) as Promise<PlanPreviewView>,
  approveProposal: (eid, pid) => call("approveProposal", { params: { eid, pid } }) as Promise<ProposalView>,
  rejectProposal: (eid, pid, body) => call("rejectProposal", { params: { eid, pid }, body }) as Promise<ProposalView>,

  overrideAnswer: (eid, rid, body) => call("overrideAnswer", { params: { eid, rid }, body }) as Promise<Request>,

  listNotifications: (eid) => call("listNotifications", { params: { eid } }) as Promise<Notification[]>,
  dismissNotification: (eid, nid) => call("dismissNotification", { params: { eid, nid } }) as Promise<{ ok: true }>,

  patchSettings: (eid, body) => call("patchSettings", { params: { eid }, body }) as Promise<EngagementView>,
  getProfile: () => call("getProfile") as Promise<ProfileView>,
  patchProfile: (body) => call("patchProfile", { body }) as Promise<ProfileView>,

  getJournal: (eid) => call("getJournal", { params: { eid } }) as Promise<JournalView>,

  connectWs,
};
