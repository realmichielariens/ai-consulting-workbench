// Renders packages/agents/prompts/*.md per prompts/README.md (the contract
// this file implements). Simple {{variable}} substitution only: every
// list-shaped value is pre-formatted into a single block-of-text string
// before substitution (README "Common"/"Reason-specific" tables), so the
// template files themselves never need loops or conditionals.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { AnswerMode, BriefView, RunInput, RunReason } from "@workbench/core";

export type PromptPlacement = "A" | "B";

/** W1's run-time choice of protocol placement (prompts/README "Protocol placement"), for the S6 benchmark. */
export function resolvePlacement(env: NodeJS.ProcessEnv = process.env): PromptPlacement {
  return env.WORKBENCH_PROMPT_PLACEMENT === "B" ? "B" : "A";
}

const TEMPLATE_VAR_RE = /\{\{(\w+)\}\}/g;

/**
 * Throws on any {{token}} in the TEMPLATE that isn't a known variable
 * (prompts/README "Rendering contract"). Only the template's own structure is
 * scanned: a substituted value (e.g. a brief written by a human) may itself
 * contain literal "{{...}}" text without tripping this check, exactly as
 * prompts/README says W1 does not need to guard against.
 */
function render(templateName: string, template: string, vars: Record<string, string>): string {
  return template.replace(TEMPLATE_VAR_RE, (_whole, name: string) => {
    if (!(name in vars)) {
      throw new Error(`prompts: ${templateName} uses unknown template variable {{${name}}}`);
    }
    return vars[name]!;
  });
}

const fileCache = new Map<string, string>();
function readTemplate(promptsDir: string, file: string): string {
  const key = path.join(promptsDir, file);
  let text = fileCache.get(key);
  if (text === undefined) {
    text = fs.readFileSync(key, "utf8");
    fileCache.set(key, text);
  }
  return text;
}

const bulletBlock = (lines: string[]): string => (lines.length === 0 ? "(none)" : lines.map((l) => `- ${l}`).join("\n"));

/** BriefView -> the "Common" template variables (prompts/README). `engagementRoot` isn't on BriefView; the caller (runtime.ts) has it from EngagementPaths. */
export function commonVars(
  item: { id: string; title: string },
  brief: BriefView,
  engagementRoot: string,
): Record<string, string> {
  const acceptance = bulletBlock(brief.acceptance);
  const inputs = bulletBlock(
    brief.inputs.map((i) => {
      const versionPart =
        i.version && i.path
          ? `v${i.version} — ${i.path}`
          : i.required
            ? "(not yet published)"
            : "(optional, not yet published)";
      return `${i.slot} ${versionPart}`;
    }),
  );
  const outputs = bulletBlock(
    brief.outputs.map((o) => `${o.slot} (${o.format}, ${o.required ? "required" : "optional"}): ${o.description}`),
  );
  const gate =
    brief.gate.length === 0
      ? "none"
      : brief.gate.length === 1
        ? gateStepLabel(brief.gate[0]!.type)
        : brief.gate.map((g) => gateStepLabel(g.type)).join(", ");

  return {
    itemId: item.id,
    itemTitle: item.title,
    brief: brief.brief,
    acceptance,
    inputs,
    outputs,
    gate,
    workDir: brief.workDir,
    engagementRoot,
    engagementContextPath: brief.engagementContextPath ?? "(not yet published)",
  };
}

function gateStepLabel(type: string): string {
  return type === "human-review" ? "human review" : type === "ai-review" ? "AI review" : type;
}

/**
 * work-agent.md rendered with the item + settings, then the protocol placed
 * per `placement` (prompts/README "Protocol placement"): A appends
 * protocol.md verbatim; B leaves it out (the caller adds
 * `workbench-skills:workbench-protocol` to the run's `skills`).
 */
export function renderSystemPrompt(
  promptsDir: string,
  item: { id: string; title: string },
  brief: BriefView,
  engagementRoot: string,
  placement: PromptPlacement,
): string {
  const vars = commonVars(item, brief, engagementRoot);
  const workAgent = render("work-agent.md", readTemplate(promptsDir, "work-agent.md"), vars);
  if (placement === "B") return workAgent;
  const protocol = readTemplate(promptsDir, "protocol.md");
  return `${workAgent}\n\n${protocol}`;
}

/** run-start.md / run-resume-answer.md / run-changes-requested.md / run-resume.md, per RunInput.reason. */
export function renderRunPrompt(
  promptsDir: string,
  item: { id: string; title: string },
  brief: BriefView | null,
  engagementRoot: string,
  input: RunInput,
): string {
  switch (input.reason) {
    case "start": {
      if (!brief) throw new Error("prompts: run-start.md needs the item's brief (reason 'start')");
      return render("run-start.md", readTemplate(promptsDir, "run-start.md"), commonVars(item, brief, engagementRoot));
    }
    case "resume-answer": {
      const vars: Record<string, string> = {
        itemId: item.id,
        itemTitle: item.title,
        question: input.question,
        answer: input.answer,
        answerMode: input.mode satisfies AnswerMode,
      };
      return render("run-resume-answer.md", readTemplate(promptsDir, "run-resume-answer.md"), vars);
    }
    case "changes-requested": {
      const vars: Record<string, string> = {
        itemId: item.id,
        itemTitle: item.title,
        reviewComments: input.comments,
        reviewedVersions: bulletBlock(input.versions.map((v) => `${v.slot} v${v.version}`)),
      };
      return render("run-changes-requested.md", readTemplate(promptsDir, "run-changes-requested.md"), vars);
    }
    case "resume": {
      const vars: Record<string, string> = {
        itemId: item.id,
        itemTitle: item.title,
        resumeNote: input.note ?? "(none)",
      };
      return render("run-resume.md", readTemplate(promptsDir, "run-resume.md"), vars);
    }
    case "stale-rerun":
      throw new Error("prompts: reason 'stale-rerun' is out of scope for I1 (prompts/README.md)");
    default: {
      const _exhaustive: never = input;
      throw new Error(`prompts: unknown run reason ${JSON.stringify(_exhaustive)}`);
    }
  }
}

/** Hash of the rendered system prompt + run prompt (ARCHITECTURE.md §8.8, Run.promptHash). */
export function promptHash(systemPrompt: string, runPrompt: string): string {
  return crypto.createHash("sha256").update(systemPrompt).update("\u0000").update(runPrompt).digest("hex");
}

export const RUN_REASON_TEMPLATE: Record<Exclude<RunReason, "stale-rerun">, string> = {
  start: "run-start.md",
  "resume-answer": "run-resume-answer.md",
  "changes-requested": "run-changes-requested.md",
  resume: "run-resume.md",
};
