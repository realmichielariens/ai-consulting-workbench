// YAML script format for the scripted fake Approach Agent
// (fake-scripts/approach/{conversation,question,suggestion}.yaml), mirroring
// fake/scripts.ts's shape (one Zod-validated step union, real ports.ts input
// schemas) for the Approach Agent's own `plan` toolset instead of `work`.
//
// Fields the runtime already knows (requestId for question/suggestion
// sessions; the request's own hypothesis/suggestedOps) are NOT authored in
// the YAML — createFakeApproachRuntime fills them in from the request at
// call time, the same way fake/runtime.ts fills in pinned input versions.

import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { AnswerRequestInput, EscalateInput, ProposeOpsInput, PublishAssetInput } from "@workbench/core";

export const ApproachStep = z.union([
  z.object({ text: z.string() }).strict(),
  /** REALLY writes `content` to `path` inside ENG/work/. */
  z.object({ write: z.object({ path: z.string().min(1), content: z.string() }).strict() }).strict(),
  /** publish_engagement_asset has the same shape as publish_asset (ports.ts). */
  z.object({ publish: PublishAssetInput }).strict(),
  z.object({ propose: ProposeOpsInput }).strict(),
  z.object({ journal: z.string().min(1) }).strict(),
  z.object({ notify: z.string().min(1) }).strict(),
  /** Reads the live plan (get_plan) and emits a text activity built from it. */
  z.object({ status: z.literal(true) }).strict(),
]);
export type ApproachStep = z.infer<typeof ApproachStep>;

const namedMatch = z.object({ match: z.string().min(1), steps: z.array(ApproachStep).min(1) }).strict();

export const ConversationScript = z.object({
  /** Kick-off turns, used in sequence (one per call while none of `matches` fires) before `fallback` takes over. */
  turns: z.array(z.object({ steps: z.array(ApproachStep).min(1) }).strict()).min(1),
  /** Checked, in order, against the human's message (case-insensitive regex); the first match's steps run. */
  matches: z.array(namedMatch).default([]),
  fallback: z.array(ApproachStep).min(1),
});
export type ConversationScript = z.infer<typeof ConversationScript>;

/** answer_request / escalate without requestId: the run supplies it (ApproachPort.requestId). */
const answerStep = z.object({ answer: AnswerRequestInput.omit({ requestId: true }) }).strict();
const escalateStep = z.object({ escalate: EscalateInput.omit({ requestId: true }) }).strict();
export const QuestionTurnStep = z.union([ApproachStep, answerStep, escalateStep]);
export type QuestionTurnStep = z.infer<typeof QuestionTurnStep>;

export const QuestionScript = z.object({
  /** Keyed by the asking item's id; must end with exactly one answer or escalate step. */
  byItem: z.record(z.string(), z.array(QuestionTurnStep).min(1)),
  /** Used for any item id not in `byItem`. */
  default: z.array(QuestionTurnStep).min(1),
});
export type QuestionScript = z.infer<typeof QuestionScript>;

export const SuggestionScript = z.object({
  /** Lead-in steps before the runtime calls propose_ops with the request's own suggestedOps (used when non-empty). */
  propose: z.array(ApproachStep).default([]),
  /** Lead-in steps before the runtime calls decline_suggestion (used when suggestedOps is empty). */
  decline: z.array(ApproachStep).default([]),
});
export type SuggestionScript = z.infer<typeof SuggestionScript>;

function loadYaml<T>(scriptsDir: string, file: string, schema: z.ZodType<T>): T {
  const raw: unknown = parseYaml(fs.readFileSync(path.join(scriptsDir, file), "utf8"));
  return schema.parse(raw);
}

export const loadConversationScript = (scriptsDir: string): ConversationScript => loadYaml(scriptsDir, "conversation.yaml", ConversationScript);
export const loadQuestionScript = (scriptsDir: string): QuestionScript => loadYaml(scriptsDir, "question.yaml", QuestionScript);
export const loadSuggestionScript = (scriptsDir: string): SuggestionScript => loadYaml(scriptsDir, "suggestion.yaml", SuggestionScript);
