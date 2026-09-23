// The readable activity item (J1.3). W1 maps SDK messages to these; W5 stores
// them in .workbench/runs/<runId>.activity.jsonl and pushes them over the
// WebSocket; W6 renders them. The fake agent emits the same items.

import { z } from "zod";
import { IsoTime } from "./domain.js";

export const ActivityKind = z.enum([
  "text", //      the model's own text message
  "tool", //      a built-in or MCP tool call, e.g. "Read ENG/context v1.0", "Wrote work/draft-guide.md"
  "denial", //    a guard or permission denial, with the reason the agent saw
  "progress", //  report_progress
  "publish", //   publish_asset succeeded: "Published interview-guide v1.0 (material)"
  "question", //  raise_question
  "submit", //    submit_outputs
  "nudge", //     the engine's one automatic nudge (R3)
  "result", //    run end: outcome, turns, cost
  "error", //     SDK or process error
  "system", //    run started / resumed / interrupted, with reason and model
]);
export type ActivityKind = z.infer<typeof ActivityKind>;

export const ActivityItem = z.object({
  /** 0-based position within the run; stable across restarts (append-only file). */
  idx: z.number().int().nonnegative(),
  at: IsoTime,
  kind: ActivityKind,
  /**
   * One readable line for a non-developer. Engagement paths are shown relative to the
   * engagement root, and published versions by slot and version rather than file path.
   */
  summary: z.string(),
  /** Longer Markdown or raw text, collapsed by default in the UI. */
  detail: z.string().optional(),
  tool: z
    .object({
      name: z.string(),
      useId: z.string().optional(),
      input: z.unknown().optional(),
      isError: z.boolean().optional(),
    })
    .optional(),
  /** Set when a subagent made the call (hook input agent_id, M0 S3). */
  agentId: z.string().optional(),
  /** On "result": total cost of the run so far. */
  costUsd: z.number().optional(),
});
export type ActivityItem = z.infer<typeof ActivityItem>;
