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
  type EngagementId,
  type ItemDef,
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

export type WorkPortErrorCode =
  | "invalid_input" //    fails a rule beyond the Zod schema
  | "unknown_slot" //     not one of the item's output slots
  | "outside_work" //     sourcePath is not inside the item's work/
  | "not_found" //        sourcePath does not exist
  | "illegal_state" //    e.g. submitting while not in_progress
  | "missing_outputs"; // submit_outputs with required slots unpublished (also reported via accepted=false)

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
}

// ---------------------------------------------------------------------------
// Agent runtime
// ---------------------------------------------------------------------------

/** What the run is continuing from; determines the prompt (ARCHITECTURE.md §8.2, run reasons). */
export type RunInput =
  | { reason: "start" }
  | { reason: "resume-answer"; requestId: RequestId; question: string; mode: AnswerMode; answer: string }
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
