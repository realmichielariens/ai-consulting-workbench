// Ports between the agent runtime (W1, packages/agents) and the server (W5).
//
//   server ──startRun(StartRunRequest)──► AgentRuntime ──query()──► Claude Code
//     ▲                                        │
//     └──────── WorkPort (bound per run) ◄─────┘  work tools call these
//     └──────── RunObserver ◄──────────────────┘  activity, session id, pid, reads
//
// The real runtime and the scripted fake agent both implement AgentRuntime, and
// both go through the same WorkPort, so everything behind it (engine, DB, files,
// UI) behaves identically for fake and real runs.

import { z } from "zod";
import type { ActivityItem } from "./activity.js";
import {
  AnswerMode,
  CompletionReport,
  GateStep,
  ItemId,
  OutputSlot,
  RequestId,
  RunId,
  SlotName,
  SlotRef,
  SlotVersionRef,
  Version,
  VersionKind,
  ItemDef,
  ItemStatus,
  PlanOp,
  ProposalId,
  RequestType,
  type EngagementId,
  type Request,
  type ThreadId,
  type RunOutcome,
  type RunReason,
  type Settings,
} from "./domain.js";
import type { EngagementPaths, WorkspacePaths } from "./layout.js";

// ---------------------------------------------------------------------------
// Work tool inputs and results (ARCHITECTURE.md §8.6, `work` toolset, I1 subset).
// W1 turns the input schemas into MCP tools (`mcp__work__<name>`); W5 implements
// WorkPort. Tool descriptions and the protocol wording belong to W1/W2.
// ---------------------------------------------------------------------------

export const BriefView = z.object({
  itemId: ItemId,
  title: z.string(),
  brief: z.string(),
  acceptance: z.array(z.string()),
  /** Declared inputs, pinned at run start. `path` is the absolute path of the immutable version file. */
  inputs: z.array(
    z.object({
      slot: SlotRef,
      required: z.boolean(),
      description: z.string(),
      version: Version.nullable(),
      path: z.string().nullable(),
    }),
  ),
  outputs: z.array(OutputSlot.extend({ latestVersion: Version.nullable() })),
  gate: z.array(GateStep),
  /** Absolute path of the item's work/ folder, the only place the agent writes. */
  workDir: z.string(),
  /** Absolute path of the latest ENG/context version, if any. */
  engagementContextPath: z.string().nullable(),
});
export type BriefView = z.infer<typeof BriefView>;

export const PublishAssetInput = z.object({
  slot: SlotName,
  /** A file inside the item's work/ folder: relative to work/, or absolute. */
  sourcePath: z.string().min(1),
  /** Ignored for the first version of a slot, which is always 1.0. */
  kind: VersionKind,
  note: z.string().min(1),
});
export type PublishAssetInput = z.infer<typeof PublishAssetInput>;
export const PublishAssetResult = z.object({ slot: SlotRef, version: Version, path: z.string() });
export type PublishAssetResult = z.infer<typeof PublishAssetResult>;

export const AppendWorklogInput = z.object({ entry: z.string().min(1) });
export type AppendWorklogInput = z.infer<typeof AppendWorklogInput>;

export const RaiseQuestionInput = z.object({
  question: z.string().min(1),
  hypothesis: z.string().min(1),
  alternatives: z.array(z.string()).default([]),
  blocking: z.boolean(),
});
export type RaiseQuestionInput = z.infer<typeof RaiseQuestionInput>;
export const RaiseQuestionResult = z.object({
  requestId: RequestId,
  /** Shown to the agent, e.g. "Recorded RQ-0003. This question is blocking: end your turn now." */
  instruction: z.string(),
});
export type RaiseQuestionResult = z.infer<typeof RaiseQuestionResult>;

export const ReportProgressInput = z.object({ status: z.string().min(1) });
export type ReportProgressInput = z.infer<typeof ReportProgressInput>;

export const SubmitOutputsInput = CompletionReport;
export type SubmitOutputsInput = z.infer<typeof SubmitOutputsInput>;
export const SubmitOutputsResult = z.object({
  accepted: z.boolean(),
  /** Required output slots without a version, when not accepted. */
  missing: z.array(SlotName).default([]),
  /** Shown to the agent, e.g. "Submitted for human review. End your turn now." */
  instruction: z.string(),
});
export type SubmitOutputsResult = z.infer<typeof SubmitOutputsResult>;

/** propose_plan_change (J2.5): a suggestion for the Approach Agent. Non-blocking: the agent continues or submits. */
export const ProposePlanChangeInput = z.object({
  summary: z.string().min(1),
  /** Optional operations in the propose_ops format; the Approach Agent decides what to propose. */
  suggestedOps: z.array(PlanOp).default([]),
});
export type ProposePlanChangeInput = z.infer<typeof ProposePlanChangeInput>;
export const ProposePlanChangeResult = z.object({ requestId: RequestId, instruction: z.string() });
export type ProposePlanChangeResult = z.infer<typeof ProposePlanChangeResult>;

export type WorkPortErrorCode =
  | "invalid_input" //    fails a rule beyond the Zod schema
  | "unknown_slot" //     not one of the item's output slots
  | "outside_work" //     sourcePath is not inside the item's work/
  | "not_found" //        sourcePath does not exist
  | "illegal_state" //    e.g. submitting while not in_progress
  | "missing_outputs" // submit_outputs with required slots unpublished (also reported via accepted=false)
  | "not_allowed"; //    a plan tool used outside its session kind (e.g. answer_request in a conversation turn)

/** Thrown by WorkPort implementations. The runtime returns `message` to the agent as a tool error. */
export class WorkPortError extends Error {
  constructor(
    public readonly code: WorkPortErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "WorkPortError";
  }
}

/** Server-side implementation of the work tools, bound to one item and one run (ARCHITECTURE.md A8). */
export interface WorkPort {
  readonly itemId: ItemId;
  readonly runId: RunId;
  getBrief(): Promise<BriefView>;
  publishAsset(input: PublishAssetInput): Promise<PublishAssetResult>;
  appendWorklog(input: AppendWorklogInput): Promise<void>;
  raiseQuestion(input: RaiseQuestionInput): Promise<RaiseQuestionResult>;
  reportProgress(input: ReportProgressInput): Promise<void>;
  submitOutputs(input: SubmitOutputsInput): Promise<SubmitOutputsResult>;
  proposePlanChange(input: ProposePlanChangeInput): Promise<ProposePlanChangeResult>;
}

// ---------------------------------------------------------------------------
// Approach Agent: `plan` tool inputs and results (I2-PLAN §4.2), and ApproachPort.
// Package B turns these into MCP tools (`mcp__plan__<name>`); package A implements
// ApproachPort. Errors are thrown as WorkPortError, like the work tools.
// ---------------------------------------------------------------------------

/** get_plan(): a compact readable plan for the agent. */
export const PlanDigest = z.object({
  planVersion: z.number().int(),
  /** Readable Markdown: every item with status, executor, inputs, outputs (latest versions), gate; open requests; pending proposals. */
  text: z.string(),
  /** The next free id per prefix in use, e.g. ["PH-3", "WI-005"]; ["PH-1", "WI-001"] on a blank plan. */
  suggestedNextIds: z.array(z.string()),
});
export type PlanDigest = z.infer<typeof PlanDigest>;

export const GetItemInput = z.object({ itemId: ItemId });
export type GetItemInput = z.infer<typeof GetItemInput>;
export const ItemDigest = z.object({
  def: ItemDef,
  status: ItemStatus.nullable(),
  outputs: z.array(z.object({ slot: SlotRef, latestVersion: Version.nullable() })),
  openRequests: z.array(z.object({ id: RequestId, type: RequestType, summary: z.string() })),
});
export type ItemDigest = z.infer<typeof ItemDigest>;

export const ProposeOpsInput = z.object({
  ops: z.array(PlanOp).min(1),
  /** Why this change: shown to the human on the proposal card. */
  rationale: z.string().min(1),
});
export type ProposeOpsInput = z.infer<typeof ProposeOpsInput>;
/** ok=false: nothing was created; fix the errors and call propose_ops again (J2.2: the human never sees an invalid proposal). */
export const ProposeOpsResult = z.object({
  ok: z.boolean(),
  proposalId: ProposalId.nullable(),
  /** The pending proposal from the same thread this one replaced, if any. */
  superseded: ProposalId.nullable(),
  /** One line per problem, e.g. "op 2 (rewire WI-004): input slot WI-003/notes-cxo does not exist". */
  errors: z.array(z.string()),
  instruction: z.string(),
});
export type ProposeOpsResult = z.infer<typeof ProposeOpsResult>;

export const AnswerRequestInput = z.object({
  requestId: RequestId,
  /** "approve" = the Work Agent's hypothesis stands (text may add a note); "replace" = a different answer. */
  mode: z.enum(["approve", "replace"]),
  text: z.string().min(1),
});
export type AnswerRequestInput = z.infer<typeof AnswerRequestInput>;
export const EscalateInput = z.object({
  requestId: RequestId,
  /** The Approach Agent's own view, shown to the human next to the Work Agent's hypothesis (J2.4). */
  view: z.string().min(1),
});
export type EscalateInput = z.infer<typeof EscalateInput>;
export const DeclineSuggestionInput = z.object({ requestId: RequestId, reason: z.string().min(1) });
export type DeclineSuggestionInput = z.infer<typeof DeclineSuggestionInput>;
/** Like publish_asset, for the ENG slots (context, stakeholders, …). sourcePath is inside ENG/work/. */
export const PublishEngagementAssetInput = PublishAssetInput;
export type PublishEngagementAssetInput = z.infer<typeof PublishEngagementAssetInput>;
export const JournalAppendInput = z.object({ entry: z.string().min(1) });
export type JournalAppendInput = z.infer<typeof JournalAppendInput>;
export const NotifyHumanInput = z.object({ text: z.string().min(1), itemId: ItemId.optional() });
export type NotifyHumanInput = z.infer<typeof NotifyHumanInput>;
/** Returned by the tools that end a task session (answer_request, escalate, decline_suggestion). */
export const PlanToolAck = z.object({ instruction: z.string() });
export type PlanToolAck = z.infer<typeof PlanToolAck>;

/** conversation = a chat turn; question / suggestion = a task session for one request. */
export type ApproachSessionKind = "conversation" | "question" | "suggestion";

/**
 * Server-side implementation of the `plan` tools, bound to one Approach Agent run.
 * answerRequest / escalate only in "question" sessions and declineSuggestion only in
 * "suggestion" sessions, each only for the session's own request (else WorkPortError "not_allowed").
 */
export interface ApproachPort {
  readonly runId: RunId;
  readonly kind: ApproachSessionKind;
  /** Conversation turns: the thread. Task sessions: null. */
  readonly threadId: ThreadId | null;
  /** Task sessions: the request being handled. Conversation turns: null. */
  readonly requestId: RequestId | null;
  getPlan(): Promise<PlanDigest>;
  getItem(input: GetItemInput): Promise<ItemDigest>;
  proposeOps(input: ProposeOpsInput): Promise<ProposeOpsResult>;
  answerRequest(input: AnswerRequestInput): Promise<PlanToolAck>;
  escalate(input: EscalateInput): Promise<PlanToolAck>;
  declineSuggestion(input: DeclineSuggestionInput): Promise<PlanToolAck>;
  publishEngagementAsset(input: PublishEngagementAssetInput): Promise<PublishAssetResult>;
  journalAppend(input: JournalAppendInput): Promise<void>;
  notifyHuman(input: NotifyHumanInput): Promise<void>;
}

// ---------------------------------------------------------------------------
// Agent runtime
// ---------------------------------------------------------------------------

/** What the run is continuing from; determines the prompt (ARCHITECTURE.md §8.2, run reasons). */
export type RunInput =
  | { reason: "start" }
  | {
      reason: "resume-answer";
      requestId: RequestId;
      question: string;
      mode: AnswerMode;
      answer: string;
      /** Who answered; omitted = "human". The prompt says so (J2.3: always attributed). */
      answeredBy?: "human" | `approach:${string}`;
    }
  | { reason: "changes-requested"; requestId: RequestId; comments: string; versions: SlotVersionRef[] }
  | { reason: "resume"; note: string | null }
  | { reason: "stale-rerun"; diffSummary: string };

export interface RunObserver {
  /** Every activity item, in order. The server persists and pushes it. */
  onActivity(item: ActivityItem): void;
  /** As soon as the SDK reports the session id (system/init). */
  onSession(sessionId: string): void;
  /** The Claude Code child PID, for the orphan cleanup at startup (R2). */
  onPid(pid: number): void;
  /** PostToolUse audit: a file the agent (or a subagent) read. The server records implicit reads. */
  onRead(absPath: string, agentId?: string): void;
}

export interface StartRunRequest {
  runId: RunId;
  engagementId: EngagementId;
  item: ItemDef;
  reason: RunReason;
  input: RunInput;
  /** Required for resume-answer, changes-requested and resume. */
  resumeSessionId: string | null;
  paths: EngagementPaths;
  workspace: WorkspacePaths;
  workPort: WorkPort;
  observer: RunObserver;
  model: string;
  maxTurns: number;
  settings: Settings;
}

export interface RunResult {
  outcome: RunOutcome;
  sessionId: string | null;
  costUsd: number;
  turns: number;
  model: string;
  /** Hash of the rendered system prompt + run prompt (ARCHITECTURE.md §8.8). */
  promptHash: string | null;
  nudged: boolean;
  denials: number;
  /** The agent's last text message (shown on a run issue, R3). */
  lastMessage: string;
  error: string | null;
}

export interface RunHandle {
  readonly runId: RunId;
  /** Interrupt the run (R5, shutdown). `done` then resolves with outcome "interrupted". */
  interrupt(): Promise<void>;
  /** Resolves when the run has ended, including the nudge round. Never rejects. */
  readonly done: Promise<RunResult>;
}

export interface AgentRuntime {
  /** "real" (Claude Agent SDK) or "fake" (scripted). Shown in the UI and recorded on the run. */
  readonly kind: "real" | "fake";
  startRun(req: StartRunRequest): RunHandle;
}

// ---------------------------------------------------------------------------
// Approach Agent runtime (I2-PLAN §4.1). Every conversation turn and every task
// session is one query(); turns resume the thread's session. The server builds
// the deterministic situation text; the runtime owns the prompt files
// (approach-conversation.md, approach-question.md, approach-suggestion.md).
// Activity, session id and pid are reported through the same RunObserver.
// ---------------------------------------------------------------------------

interface ApproachRunBase {
  runId: RunId;
  engagementId: EngagementId;
  paths: EngagementPaths;
  workspace: WorkspacePaths;
  port: ApproachPort;
  observer: RunObserver;
  model: string;
  maxTurns: number;
  settings: Settings;
}

export interface ApproachTurnRequest extends ApproachRunBase {
  threadId: ThreadId;
  /** null: the first turn of a new session. */
  resumeSessionId: string | null;
  /**
   * Built by the server, no LLM. New session: the full situation briefing (engagement,
   * settings, plan at depth 2 with statuses, open requests, pending proposals).
   * Resumed session: "Since your last turn:" plus at most 20 event lines, or "" if nothing happened.
   */
  situation: string;
  /** The human's message, verbatim. */
  message: string;
}

export interface ApproachTaskRequest extends ApproachRunBase {
  kind: "question" | "suggestion";
  /** The question (type "question") or the suggestion (type "proposal"). */
  request: Request;
  /** The item that asked or suggested, with its brief. */
  item: ItemDef;
  /** The full situation briefing, as for a new conversation session. */
  situation: string;
}

/**
 * RunResult.outcome for Approach runs: "completed", "max_turns", "error" or "interrupted".
 * A task session that ends without resolving its request (answer_request, escalate,
 * decline_suggestion or propose_ops) still reports "completed"; the server notices the
 * unresolved request and escalates it ("The Approach Agent did not decide").
 */
export interface ApproachRuntime {
  readonly kind: "real" | "fake";
  startTurn(req: ApproachTurnRequest): RunHandle;
  startTask(req: ApproachTaskRequest): RunHandle;
}
