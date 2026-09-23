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
export const RunReason = z.enum(["start", "resume-answer", "changes-requested", "resume", "stale-rerun"]);
export type RunReason = z.infer<typeof RunReason>;

/**
 * submitted   → outputs submitted (gate or done)
 * blocked     → ended with an open blocking question
 * no_submit   → ended without submit or question, also after the one nudge (→ run issue)
 * max_turns   → hit maxTurns (→ run issue)
 * error       → SDK/process error (→ run issue)
 * interrupted → stopped by the human, a restart or a crash (→ resumable)
 */
export const RunOutcome = z.enum(["submitted", "blocked", "no_submit", "max_turns", "error", "interrupted"]);
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

export const AnswerMode = z.enum(["approve", "amend", "replace"]);
export type AnswerMode = z.infer<typeof AnswerMode>;

export const GateVerdict = z.enum(["approved", "changes_requested"]);
export type GateVerdict = z.infer<typeof GateVerdict>;

export const RequestResponse = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("answer"), mode: AnswerMode, text: z.string().min(1), by: Actor, at: IsoTime }),
  z.object({ kind: z.literal("verdict"), verdict: GateVerdict, comments: z.string().default(""), by: Actor, at: IsoTime }),
  z.object({ kind: z.literal("issue"), action: z.enum(["retry", "stop"]), by: Actor, at: IsoTime }),
]);
export type RequestResponse = z.infer<typeof RequestResponse>;

const requestBase = {
  id: RequestId,
  from: Actor,
  /** "approach" addresses the Approach Agent role (I2); I1 always routes to "human". */
  to: z.union([Actor, z.literal("approach")]),
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
]);
export type Request = z.infer<typeof Request>;

// ---------------------------------------------------------------------------
// Engagement and settings (DESIGN.md §8.1)
// ---------------------------------------------------------------------------

export const Settings = z.object({
  /** I1 supports "always-human" only; "aa-first" arrives with the Approach Agent (I2). */
  questionHandling: z.enum(["aa-first", "always-human"]).default("always-human"),
  itemStart: z.enum(["manual", "auto"]).default("auto"),
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
