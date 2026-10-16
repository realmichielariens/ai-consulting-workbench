// Domain contract (ARCHITECTURE.md §6.1, DESIGN.md §4–§5), I1 subset plus the
// forward-compatible shapes later iterations extend. Owned by the main session:
// read-only for work-package agents (see CLAUDE.md, "Contract change requests").
//
// Conventions:
// - Timestamps are ISO-8601 strings in the domain and API; the DB stores epoch ms.
// - Paths inside domain objects are engagement-relative and use forward slashes.

import { z } from "zod";

// ---------------------------------------------------------------------------
// Identifiers
// ---------------------------------------------------------------------------

/** "ENG" (the engagement root item), composites like "PH-1", work items like "WI-004" or "WI-003e". */
export const ITEM_ID_RE = /^(ENG|[A-Z]{2,4}-\d+[a-z]?)$/;
export const ItemId = z.string().regex(ITEM_ID_RE, "item id like ENG, PH-1 or WI-004");
export type ItemId = z.infer<typeof ItemId>;

/** Output slot name, unique within its owning item: "interview-guide", "notes-cfo". */
export const SLOT_NAME_RE = /^[a-z][a-z0-9-]{0,63}$/;
export const SlotName = z.string().regex(SLOT_NAME_RE, "kebab-case slot name");
export type SlotName = z.infer<typeof SlotName>;

/** "<owning item>/<slot>": "ENG/context", "WI-003/notes-cfo". Wildcards (WI-003/notes-*) arrive in I4. */
export const SLOT_REF_RE = /^(ENG|[A-Z]{2,4}-\d+[a-z]?)\/[a-z][a-z0-9-]{0,63}$/;
export const SlotRef = z.string().regex(SLOT_REF_RE, "slot ref like WI-002/interview-guide");
export type SlotRef = z.infer<typeof SlotRef>;

/** "major.minor", e.g. "1.0", "1.1", "2.0". */
export const VERSION_RE = /^\d+\.\d+$/;
export const Version = z.string().regex(VERSION_RE, "version like 1.0");
export type Version = z.infer<typeof Version>;

/** Engagement id = folder name under engagements/: "acme-discovery-2". */
export const EngagementId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);
export type EngagementId = z.infer<typeof EngagementId>;

/** Server-assigned, zero-padded: "R-0001". */
export const RunId = z.string().regex(/^R-\d{4,}$/);
export type RunId = z.infer<typeof RunId>;

/** Server-assigned, zero-padded: "RQ-0001". */
export const RequestId = z.string().regex(/^RQ-\d{4,}$/);
export type RequestId = z.infer<typeof RequestId>;

/** Server-assigned, zero-padded (I2): proposals, conversation threads, chat messages, notifications, agenda rows. */
export const ProposalId = z.string().regex(/^P-\d{4,}$/);
export type ProposalId = z.infer<typeof ProposalId>;
export const ThreadId = z.string().regex(/^T-\d{4,}$/);
export type ThreadId = z.infer<typeof ThreadId>;
export const MessageId = z.string().regex(/^M-\d{4,}$/);
export type MessageId = z.infer<typeof MessageId>;
export const NotificationId = z.string().regex(/^N-\d{4,}$/);
export type NotificationId = z.infer<typeof NotificationId>;
export const AgendaId = z.string().regex(/^A-\d{4,}$/);
export type AgendaId = z.infer<typeof AgendaId>;

export const IsoTime = z.iso.datetime({ offset: true });
export type IsoTime = z.infer<typeof IsoTime>;

/** Who did something. Used for authorship, commit attribution and request routing. */
export type Actor = "human" | "system" | `agent:${string}` | `approach:${string}`;
export const ACTOR_RE = /^(human|system|agent:(ENG|[A-Z]{2,4}-\d+[a-z]?)|approach:\S+)$/;
export const Actor = z.custom<Actor>((v) => typeof v === "string" && ACTOR_RE.test(v), "actor");
export const agentActor = (itemId: ItemId): Actor => `agent:${itemId}`;

// ---------------------------------------------------------------------------
// Items (definition = item.md front-matter + brief body)
// ---------------------------------------------------------------------------

export const ItemKind = z.enum(["engagement", "composite", "task"]);
export type ItemKind = z.infer<typeof ItemKind>;

export const Executor = z.enum(["agent", "human"]);
export type Executor = z.infer<typeof Executor>;

/** DESIGN.md §4.2. Composites have no status of their own (null); they show a roll-up. */
export const ItemStatus = z.enum([
  "draft",
  "waiting",
  "ready",
  "in_progress",
  "blocked",
  "at_gate",
  "done",
  "stale",
  "cancelled",
]);
export type ItemStatus = z.infer<typeof ItemStatus>;

/** Worst first. A composite's roll-up shows the first status in this list that any child has. */
export const STATUS_SEVERITY: readonly ItemStatus[] = [
  "blocked",
  "stale",
  "at_gate",
  "in_progress",
  "ready",
  "waiting",
  "draft",
  "done",
  "cancelled",
];

export const OutputScope = z.enum(["local", "project"]);
export type OutputScope = z.infer<typeof OutputScope>;

export const VersionKind = z.enum(["minor", "material"]);
export type VersionKind = z.infer<typeof VersionKind>;

/** I1 implements "human-review" only; the others arrive in I6. */
export const GateType = z.enum(["ai-review", "human-review", "endorsement"]);
export type GateType = z.infer<typeof GateType>;

export const GateStep = z.object({
  type: GateType,
  /** Endorsement forum, e.g. "Steerco" (I6). */
  forum: z.string().optional(),
});
export type GateStep = z.infer<typeof GateStep>;

/**
 * The gate chain in item.md. Accepts the short forms people write by hand:
 * omitted / `none` / `{type: none}` → [], a single `{type: human-review}` → [that].
 */
export const GateChain = z.preprocess((v) => {
  if (v == null || v === "none") return [];
  if (Array.isArray(v)) return v.filter((s) => !(s && typeof s === "object" && (s as { type?: unknown }).type === "none"));
  if (typeof v === "object" && (v as { type?: unknown }).type === "none") return [];
  return [v];
}, z.array(GateStep));
export type GateChain = z.infer<typeof GateChain>;

export const InputRef = z.object({
  slot: SlotRef,
  required: z.boolean().default(true),
  /** Pin to a version; otherwise the latest version at run start is pinned. */
  pin: Version.optional(),
});
export type InputRef = z.infer<typeof InputRef>;

export const OutputSlot = z.object({
  slot: SlotName,
  /** File extension without dot: md (default), pdf, pptx, docx, xlsx, … */
  format: z.string().regex(/^[a-z0-9]{1,8}$/).default("md"),
  scope: OutputScope.default("project"),
  description: z.string().default(""),
  /** submit_outputs / Mark done require every required output to have a version. */
  required: z.boolean().default(true),
});
export type OutputSlot = z.infer<typeof OutputSlot>;

/** A Source Catalog listing id (sources.ts), e.g. "open-web". */
export const SourceId = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "lowercase letters, digits and hyphens");
export type SourceId = z.infer<typeof SourceId>;

/**
 * A Source attached to a task: live or external context next to its inputs.
 * `purpose` tells the Work Agent what this source is for on this task.
 */
export const SourceBinding = z.object({ id: SourceId, purpose: z.string().min(1) });
export type SourceBinding = z.infer<typeof SourceBinding>;

/**
 * item.md front-matter. Status is deliberately NOT here: state lives in the DB
 * (ARCHITECTURE.md §5.3); plan.md is the readable projection.
 */
export const ItemFrontMatter = z.object({
  id: ItemId,
  title: z.string().min(1),
  parent: ItemId.nullable().default(null),
  order: z.number().int().default(0),
  /** null = composite (or the engagement root). */
  executor: Executor.nullable().default(null),
  inputs: z.array(InputRef).default([]),
  sequencing: z.array(ItemId).default([]),
  outputs: z.array(OutputSlot).default([]),
  skills: z.array(z.string()).default([]),
  /** Sources from the Source Catalog, attached by the Approach Agent's plan (or by hand in item.md). */
  sources: z.array(SourceBinding).default([]),
  gate: GateChain.default([]),
  autostart: z.boolean().default(true),
  acceptance: z.array(z.string()).default([]),
});
export type ItemFrontMatter = z.infer<typeof ItemFrontMatter>;

/** The full definition: front-matter plus the Markdown brief (the item.md body). */
export const ItemDef = ItemFrontMatter.extend({
  brief: z.string(),
});
export type ItemDef = z.infer<typeof ItemDef>;

export const itemKindOf = (def: Pick<ItemDef, "id" | "executor">): ItemKind =>
  def.id === "ENG" ? "engagement" : def.executor == null ? "composite" : "task";

/** Why a waiting item is not ready yet (shown in the UI, J1.2). */
export const ReadinessBlocker = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("missing_input"), slot: SlotRef, producer: ItemId }),
  z.object({ kind: z.literal("sequencing"), item: ItemId, status: ItemStatus.nullable() }),
  /** I2 decision D1: the input is published, but its producer has a gate and is not done yet. */
  z.object({ kind: z.literal("input_not_approved"), slot: SlotRef, producer: ItemId, status: ItemStatus.nullable() }),
  z.object({ kind: z.literal("no_executor") }),
]);
export type ReadinessBlocker = z.infer<typeof ReadinessBlocker>;

export const Rollup = z.object({
  total: z.number().int(),
  done: z.number().int(),
  /** Count per status over leaf descendants. */
  byStatus: z.partialRecord(ItemStatus, z.number().int()),
  /** Worst leaf status by STATUS_SEVERITY, null if the composite has no leaves. */
  worst: ItemStatus.nullable(),
});
export type Rollup = z.infer<typeof Rollup>;

// ---------------------------------------------------------------------------
// Plan operations (I2, I2-PLAN §4.3). Validated and applied by the pure rules in
// rules/planOps.ts. The shapes avoid z.preprocess (GateChain) so they convert
// cleanly to the JSON Schema of the `propose_ops` MCP tool.
// ---------------------------------------------------------------------------

/** A new item in an add_item op: the full definition, with an explicit gate array. */
export const PlanItemDef = ItemDef.extend({
  gate: z.array(GateStep).default([]),
});
export type PlanItemDef = z.infer<typeof PlanItemDef>;

export const PlanOp = z.discriminatedUnion("op", [
  /** The id is chosen by the proposer and must be unused; the parent must be a composite, ENG or null. A new leaf starts waiting. */
  z.object({ op: z.literal("add_item"), def: PlanItemDef }),
  /** Leaves: only while waiting or ready. Composites and ENG (no status): always. */
  z.object({
    op: z.literal("update_brief"),
    itemId: ItemId,
    title: z.string().min(1).optional(),
    brief: z.string().min(1).optional(),
    acceptance: z.array(z.string()).optional(),
  }),
  /** Replaces the item's inputs. Only while waiting or ready; every slot must exist (or be added in the same proposal). */
  z.object({ op: z.literal("rewire"), itemId: ItemId, inputs: z.array(InputRef) }),
  z.object({ op: z.literal("add_slot"), itemId: ItemId, output: OutputSlot }),
  /** Not allowed while the slot has versions or consumers. */
  z.object({ op: z.literal("remove_slot"), itemId: ItemId, slot: SlotName }),
  /** I2: [] or [{type: "human-review"}]. */
  z.object({ op: z.literal("set_gate"), itemId: ItemId, gate: z.array(GateStep) }),
  /** Replaces a leaf's attached sources. Only while waiting or ready; every id must be in the Source Catalog. */
  z.object({ op: z.literal("set_sources"), itemId: ItemId, sources: z.array(SourceBinding) }),
  /** Only while waiting or ready, and not while another (non-cancelled) item consumes its outputs. */
  z.object({ op: z.literal("cancel_item"), itemId: ItemId, reason: z.string().min(1) }),
]);
export type PlanOp = z.infer<typeof PlanOp>;
export type PlanOpKind = PlanOp["op"];

export const ProposalOrigin = z.enum(["conversation", "suggestion"]);
export type ProposalOrigin = z.infer<typeof ProposalOrigin>;

export const ProposalStatus = z.enum(["pending", "approved", "rejected", "superseded"]);
export type ProposalStatus = z.infer<typeof ProposalStatus>;

/** A set of plan operations the human approves or rejects as a whole (J2.2). Never shown unless it validated. */
export const Proposal = z.object({
  id: ProposalId,
  origin: ProposalOrigin,
  /** J2.5: the Work Agent item whose suggestion led to this proposal ("suggested by WI-004"). */
  suggestedBy: ItemId.nullable(),
  /** The suggestion request (type "proposal") this answers, for origin "suggestion". */
  requestId: RequestId.nullable(),
  /** The conversation thread it was proposed in, for origin "conversation". */
  threadId: ThreadId.nullable(),
  author: Actor,
  status: ProposalStatus,
  /** planVersion when proposed. Approval is rejected if the plan has moved since (I2; re-validation arrives in I5). */
  basePlanVersion: z.number().int().positive(),
  rationale: z.string().min(1),
  ops: z.array(PlanOp).min(1),
  createdAt: IsoTime,
  resolvedAt: IsoTime.nullable(),
  appliedPlanVersion: z.number().int().positive().nullable(),
  rejectReason: z.string().nullable(),
  /** For status "superseded": the proposal that replaced it. */
  supersededBy: ProposalId.nullable(),
});
export type Proposal = z.infer<typeof Proposal>;

// ---------------------------------------------------------------------------
// Conversation with the Approach Agent (I2: one general thread, T-0001)
// ---------------------------------------------------------------------------

export const Thread = z.object({
  id: ThreadId,
  subject: z.string(),
  createdAt: IsoTime,
  /** The Approach Agent session this thread resumes; null before the first turn. */
  sessionId: z.string().nullable(),
  /** Event seq at the end of the last turn: the next turn's "Since your last turn:" starts after it. */
  lastSeenSeq: z.number().int().nonnegative(),
});
export type Thread = z.infer<typeof Thread>;

export const ChatRole = z.enum(["human", "approach", "system"]);
export type ChatRole = z.infer<typeof ChatRole>;

export const ChatMessage = z.object({
  id: MessageId,
  threadId: ThreadId,
  role: ChatRole,
  /** Markdown. */
  body: z.string(),
  at: IsoTime,
  /** The Approach Agent run that produced it (role approach/system). */
  runId: RunId.nullable(),
  /** Set on the system message announcing a proposal: the UI renders the proposal card inline. */
  proposalId: ProposalId.nullable(),
  /** Set on "Published ENG/context v1.0": the UI renders a link to the asset viewer. */
  asset: z.object({ slot: SlotRef, version: Version }).nullable(),
});
export type ChatMessage = z.infer<typeof ChatMessage>;

/** An FYI entry in the Inbox (notify_human, an Approach Agent answer), dismissible. */
export const Notification = z.object({
  id: NotificationId,
  from: Actor,
  text: z.string().min(1),
  itemId: ItemId.nullable(),
  /** Set when the FYI is about a question the Approach Agent answered: the Inbox offers Override. */
  requestId: RequestId.nullable(),
  createdAt: IsoTime,
  dismissedAt: IsoTime.nullable(),
});
export type Notification = z.infer<typeof Notification>;

/** Minimal agenda row (I2): a routed question gets one; the board and its behaviour arrive in I5. */
export const AgendaItem = z.object({
  id: AgendaId,
  kind: z.enum(["question", "proposal", "decision", "review", "impact", "request", "follow_up", "risk", "run_issue"]),
  title: z.string(),
  status: z.enum(["open", "in_progress", "waiting", "closed", "dropped"]),
  links: z.object({
    items: z.array(ItemId).default([]),
    requests: z.array(RequestId).default([]),
    proposals: z.array(ProposalId).default([]),
  }),
  createdAt: IsoTime,
  resolution: z.string().nullable(),
});
export type AgendaItem = z.infer<typeof AgendaItem>;

// ---------------------------------------------------------------------------
// Assets and versions (DESIGN.md §5.2)
// ---------------------------------------------------------------------------

export const AssetVersion = z.object({
  slot: SlotRef,
  version: Version,
  major: z.number().int().positive(),
  minor: z.number().int().nonnegative(),
  /** Recorded from I1; it has an effect (staleness) from I4. The first version is always 1.0. */
  kind: VersionKind,
  author: Actor,
  at: IsoTime,
  note: z.string().default(""),
  runId: RunId.nullable(),
  /** Engagement-relative: "items/WI-002/assets/interview-guide/v1.0.md". */
  path: z.string(),
  format: z.string(),
});
export type AssetVersion = z.infer<typeof AssetVersion>;

export const SlotVersionRef = z.object({ slot: SlotRef, version: Version });
export type SlotVersionRef = z.infer<typeof SlotVersionRef>;

// ---------------------------------------------------------------------------
// Runs (ARCHITECTURE.md §8.2)
// ---------------------------------------------------------------------------

/**
 * start / resume-answer / changes-requested / stale-rerun follow A§8.2.
 * "resume" continues an interrupted session (R1, R5) or retries after a run issue (R3).
 */
export const RunReason = z.enum([
  "start",
  "resume-answer",
  "changes-requested",
  "resume",
  "stale-rerun",
  // Approach Agent runs (I2), recorded with itemId "ENG":
  "aa-turn", //       one conversation turn (a human message), resumes the thread's session
  "aa-question", //   a task session for one routed question
  "aa-suggestion", // a task session for one Work Agent plan-change suggestion
]);
export type RunReason = z.infer<typeof RunReason>;

export const APPROACH_RUN_REASONS: readonly RunReason[] = ["aa-turn", "aa-question", "aa-suggestion"];
export const isApproachRun = (reason: RunReason): boolean => APPROACH_RUN_REASONS.includes(reason);

/**
 * submitted   → outputs submitted (gate or done)
 * blocked     → ended with an open blocking question
 * no_submit   → ended without submit or question, also after the one nudge (→ run issue)
 * max_turns   → hit maxTurns (→ run issue)
 * error       → SDK/process error (→ run issue)
 * interrupted → stopped by the human, a restart or a crash (→ resumable)
 * completed   → Approach Agent runs only: the turn or task session ended normally
 */
export const RunOutcome = z.enum(["submitted", "blocked", "no_submit", "max_turns", "error", "interrupted", "completed"]);
export type RunOutcome = z.infer<typeof RunOutcome>;

export const Run = z.object({
  id: RunId,
  itemId: ItemId,
  sessionId: z.string().nullable(),
  reason: RunReason,
  /** null while the run is active. */
  outcome: RunOutcome.nullable(),
  model: z.string(),
  costUsd: z.number().nonnegative(),
  turns: z.number().int().nonnegative(),
  promptHash: z.string().nullable(),
  startedAt: IsoTime,
  endedAt: IsoTime.nullable(),
  nudged: z.boolean(),
  denials: z.number().int().nonnegative(),
  error: z.string().nullable(),
});
export type Run = z.infer<typeof Run>;

// ---------------------------------------------------------------------------
// Requests (ARCHITECTURE.md §9). I1: question, gate_request, run_issue.
// ---------------------------------------------------------------------------

/**
 * run_issue is an I1 addition: without the agenda (I5) a failed run surfaces to the
 * human as a request. In I5 run issues become agenda topics.
 */
export const RequestType = z.enum(["question", "blocker", "proposal", "change_request", "gate_request", "run_issue"]);
export type RequestType = z.infer<typeof RequestType>;

export const RequestStatus = z.enum(["open", "claimed", "answered", "escalated", "withdrawn", "closed"]);
export type RequestStatus = z.infer<typeof RequestStatus>;

export const QuestionPayload = z.object({
  question: z.string().min(1),
  /** The agent's own best answer (DESIGN.md §2.1-5). Required. */
  hypothesis: z.string().min(1),
  alternatives: z.array(z.string()).default([]),
});
export type QuestionPayload = z.infer<typeof QuestionPayload>;

export const SelfCheckEntry = z.object({
  criterion: z.string(),
  met: z.enum(["yes", "partial", "no"]),
  note: z.string().default(""),
});
export type SelfCheckEntry = z.infer<typeof SelfCheckEntry>;

/** The completion report from submit_outputs (DESIGN.md §7.1). */
export const CompletionReport = z.object({
  summary: z.string().min(1),
  selfCheck: z.array(SelfCheckEntry),
  openIssues: z.array(z.string()).default([]),
});
export type CompletionReport = z.infer<typeof CompletionReport>;

export const GateRequestPayload = z.object({
  /** Position in the gate chain (0-based). I1 chains have one step. */
  step: z.number().int().nonnegative(),
  gateType: GateType,
  /** The exact versions under review; the verdict applies to these only (J1.5). */
  submitted: z.array(SlotVersionRef),
  report: CompletionReport,
});
export type GateRequestPayload = z.infer<typeof GateRequestPayload>;

export const RunIssuePayload = z.object({
  runId: RunId,
  reason: z.enum(["no_submit", "max_turns", "error"]),
  /** The agent's last text message, or the error. */
  lastMessage: z.string(),
});
export type RunIssuePayload = z.infer<typeof RunIssuePayload>;

/** A Work Agent's plan-change suggestion (propose_plan_change, J2.5). Always routed to the Approach Agent. */
export const SuggestionPayload = z.object({
  summary: z.string().min(1),
  suggestedOps: z.array(PlanOp).default([]),
});
export type SuggestionPayload = z.infer<typeof SuggestionPayload>;

export const AnswerMode = z.enum(["approve", "amend", "replace"]);
export type AnswerMode = z.infer<typeof AnswerMode>;

export const GateVerdict = z.enum(["approved", "changes_requested"]);
export type GateVerdict = z.infer<typeof GateVerdict>;

export const RequestResponse = z.discriminatedUnion("kind", [
  /** `by` is "human" or "approach:<session>" (J2.3: always attributed). An override replaces the response with the human's. */
  z.object({ kind: z.literal("answer"), mode: AnswerMode, text: z.string().min(1), by: Actor, at: IsoTime }),
  z.object({ kind: z.literal("verdict"), verdict: GateVerdict, comments: z.string().default(""), by: Actor, at: IsoTime }),
  z.object({ kind: z.literal("issue"), action: z.enum(["retry", "stop"]), by: Actor, at: IsoTime }),
  /** A suggestion (type "proposal") was turned into a proposal, or declined with a recorded reason. */
  z.object({
    kind: z.literal("suggestion"),
    outcome: z.enum(["proposed", "declined"]),
    proposalId: ProposalId.nullable(),
    reason: z.string().default(""),
    by: Actor,
    at: IsoTime,
  }),
]);
export type RequestResponse = z.infer<typeof RequestResponse>;

/** J2.4: the Approach Agent's own view, attached when it hands a question to the human. */
export const Escalation = z.object({ view: z.string().min(1), by: Actor, at: IsoTime });
export type Escalation = z.infer<typeof Escalation>;

const requestBase = {
  id: RequestId,
  from: Actor,
  /**
   * Current addressee. "approach" = the Approach Agent role. A question routed aa-first
   * starts at "approach" and moves to "human" when escalated.
   */
  to: z.union([Actor, z.literal("approach")]),
  /** Where the request was first routed; unchanged by escalation (the Inbox shows "escalated by the Approach Agent"). */
  routedTo: z.enum(["approach", "human"]).default("human"),
  /** Set when the Approach Agent escalated this question. */
  escalation: Escalation.nullable().default(null),
  itemId: ItemId,
  runId: RunId.nullable(),
  status: RequestStatus,
  blocking: z.boolean(),
  response: RequestResponse.nullable(),
  createdAt: IsoTime,
  resolvedAt: IsoTime.nullable(),
};

export const Request = z.discriminatedUnion("type", [
  z.object({ ...requestBase, type: z.literal("question"), payload: QuestionPayload }),
  z.object({ ...requestBase, type: z.literal("gate_request"), payload: GateRequestPayload }),
  z.object({ ...requestBase, type: z.literal("run_issue"), payload: RunIssuePayload }),
  /** A Work Agent suggestion (propose_plan_change), to "approach". Resolved by propose_ops or decline_suggestion. */
  z.object({ ...requestBase, type: z.literal("proposal"), payload: SuggestionPayload }),
]);
export type Request = z.infer<typeof Request>;

// ---------------------------------------------------------------------------
// Engagement and settings (DESIGN.md §8.1)
// ---------------------------------------------------------------------------

export const Settings = z.object({
  /** D§8.1 default (I2 decision D3): questions go to the Approach Agent first. */
  questionHandling: z.enum(["aa-first", "always-human"]).default("aa-first"),
  itemStart: z.enum(["manual", "auto"]).default("auto"),
  /** I2 supports "propose" only: every plan change is a proposal the human approves. */
  planChanges: z.enum(["propose"]).default("propose"),
  readPolicy: z.enum(["declared-only", "project", "project-with-tracking"]).default("project-with-tracking"),
});
export type Settings = z.infer<typeof Settings>;

/** engagement.yaml */
export const EngagementMeta = z.object({
  id: EngagementId,
  name: z.string().min(1),
  createdAt: IsoTime,
  seed: z.object({ id: z.string(), title: z.string() }).nullable().default(null),
  settings: Settings.default(Settings.parse({})),
  planVersion: z.number().int().positive().default(1),
});
export type EngagementMeta = z.infer<typeof EngagementMeta>;

// ---------------------------------------------------------------------------
// Version helpers (pure; used by every package)
// ---------------------------------------------------------------------------

export const formatVersion = (major: number, minor: number): Version => `${major}.${minor}`;

export function parseVersion(v: Version): { major: number; minor: number } {
  const [major, minor] = v.split(".").map(Number) as [number, number];
  return { major, minor };
}

export function parseSlotRef(ref: SlotRef): { itemId: ItemId; slot: SlotName } {
  const i = ref.indexOf("/");
  return { itemId: ref.slice(0, i), slot: ref.slice(i + 1) };
}

export const slotRef = (itemId: ItemId, slot: SlotName): SlotRef => `${itemId}/${slot}`;
