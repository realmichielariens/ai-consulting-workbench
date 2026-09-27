// The ONLY place that calls the Claude Agent SDK's query() (CLAUDE.md rule 4).
// One call to runOnce() is one query() invocation; a run (runtime.ts) can
// make several (the initial call, then at most one nudge resume). Options
// follow M0-FINDINGS §2 / ARCHITECTURE.md §8.2 exactly. Retries only cover
// rate-limit/overloaded failures before the first assistant message, ported
// from spike/src/lib/run.ts.

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  query,
  type HookCallbackMatcher,
  type HookEvent,
  type McpServerConfig,
  type Options,
  type SDKAssistantMessage,
  type SDKMessage,
  type SDKResultMessage,
  type SDKSystemMessage,
  type SpawnedProcess,
} from "@anthropic-ai/claude-agent-sdk";
import type { ItemId, RunId } from "@workbench/core";
import { redact } from "@workbench/core/node";

/** The explicit built-in tool set (M0-FINDINGS §2): I1 never enables Bash or PowerShell (CLAUDE.md rule 4). */
export const WORK_AGENT_TOOLS = ["Read", "Write", "Edit", "Glob", "Grep", "Skill", "Task"] as const;
export const WORK_AGENT_ALLOWED_TOOLS = ["Read", "Glob", "Grep", "Skill", "Task", "Edit(./**)", "mcp__work__*"] as const;

/** The Approach Agent's tool set (I2-PLAN §4.1): no Skill, no Task — it never delegates or invokes skills. */
export const APPROACH_AGENT_TOOLS = ["Read", "Write", "Edit", "Glob", "Grep"] as const;
export const APPROACH_AGENT_ALLOWED_TOOLS = ["Read", "Glob", "Grep", "Edit(./**)", "mcp__plan__*"] as const;

export interface RunOnceArgs {
  runId: RunId;
  itemId: ItemId;
  /** The run prompt for this query() call (the render-run-prompt output, or NUDGE_MESSAGE). */
  prompt: string;
  /** Session id to resume, or undefined for a brand-new session. */
  resume: string | undefined;
  model: string;
  /** items/<id>/work — the agent's locus of control (M0-FINDINGS §2). */
  cwd: string;
  /** [paths.root] — the engagement root, readable but write-restricted by the guard. */
  additionalDirectories: string[];
  systemPrompt: string;
  /** The explicit built-in tool set for this run (Work Agent: WORK_AGENT_TOOLS; Approach Agent: APPROACH_AGENT_TOOLS). */
  tools: readonly string[];
  /** The matching allowedTools list for this run. */
  allowedTools: readonly string[];
  /** Absolute path to the workbench-skills plugin dir, or undefined when this run has no plugin (the Approach Agent). */
  skillsPluginPath: string | undefined;
  /** Already prefixed with "workbench-skills:" by the caller (runtime.ts). Empty/omitted when this run has no skills. */
  skills?: string[];
  mcpServers: Record<string, McpServerConfig>;
  hooks: Partial<Record<HookEvent, HookCallbackMatcher[]>>;
  maxTurns: number;
  env: NodeJS.ProcessEnv;
  abortController: AbortController;
  /** paths.runStream(runId) — every raw (redacted) SDK message, JSONL. */
  runStreamPath: string;
  /** Called for every SDK message, in order, before this function returns. */
  onMessage: (message: SDKMessage) => void;
  /** Called once with the Claude Code child's PID (R2 orphan cleanup), the first time it is known. */
  onPid: (pid: number) => void;
}

export interface RunOnceResult {
  sessionId: string | null;
  subtype: string | null;
  isError: boolean;
  costUsd: number;
  turns: number;
  /** The agent's last non-empty text message across this call (used on a run issue, R3). */
  lastMessageText: string;
  retries: number;
}

const RETRYABLE_ERRORS = new Set(["rate_limit", "overloaded"]);
const MAX_ATTEMPTS = 3;

function isRetryableFailure(messages: SDKMessage[], thrown: unknown): boolean {
  if (thrown) {
    const msg = String((thrown as Error)?.message ?? thrown);
    if (/\b429\b|\b529\b|rate.?limit|overloaded/i.test(msg)) return true;
  }
  for (const m of messages) {
    if (m.type === "assistant") {
      const err = (m as SDKAssistantMessage).error;
      if (err && RETRYABLE_ERRORS.has(err)) return true;
    }
  }
  return false;
}

function lastAssistantText(message: SDKAssistantMessage): string | undefined {
  const content = message.message?.content as Array<{ type?: string; text?: string }> | undefined;
  if (!Array.isArray(content)) return undefined;
  const text = content
    .filter((b) => b?.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("\n");
  return text.trim() ? text : undefined;
}

/**
 * Runs one query() call: streams every message to `onMessage`, appends the
 * redacted transcript to `runStreamPath`, retries pre-first-assistant-output
 * rate-limit/overloaded failures, and records the child PID, and returns a
 * normalized summary.
 */
export async function runOnce(args: RunOnceArgs): Promise<RunOnceResult> {
  fs.mkdirSync(path.dirname(args.runStreamPath), { recursive: true });
  const appendStream = (obj: unknown) => {
    fs.appendFileSync(args.runStreamPath, `${redact(JSON.stringify(obj))}\n`, "utf8");
  };

  let sessionId: string | null = null;
  let lastResult: SDKResultMessage | undefined;
  let lastText = "";
  let retries = 0;
  let pidReported = false;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const attemptMessages: SDKMessage[] = [];
    let hadAssistantOutput = false;
    let thrown: unknown;

    const options: Options = {
      model: args.model,
      cwd: args.cwd,
      additionalDirectories: args.additionalDirectories,
      systemPrompt: args.systemPrompt,
      settingSources: [],
      settings: { disableBundledSkills: true },
      env: args.env,
      plugins: args.skillsPluginPath ? [{ type: "local", path: args.skillsPluginPath }] : [],
      skills: args.skills ?? [],
      tools: [...args.tools],
      allowedTools: [...args.allowedTools],
      mcpServers: args.mcpServers,
      permissionMode: "dontAsk",
      hooks: args.hooks,
      maxTurns: args.maxTurns,
      resume: args.resume,
      abortController: args.abortController,
      // Needed to learn the Claude Code child's PID (R2 orphan cleanup) — the
      // SDK does not otherwise expose it. ChildProcess satisfies SpawnedProcess.
      spawnClaudeCodeProcess: (spawnOptions) => {
        const child = spawn(spawnOptions.command, spawnOptions.args, {
          cwd: spawnOptions.cwd,
          env: spawnOptions.env,
          windowsHide: true,
        });
        if (child.pid && !pidReported) {
          pidReported = true;
          args.onPid(child.pid);
        }
        return child as unknown as SpawnedProcess;
      },
    };

    try {
      const q = query({ prompt: args.prompt, options });
      for await (const message of q) {
        attemptMessages.push(message);
        appendStream(message);
        args.onMessage(message);

        if (message.type === "system" && message.subtype === "init") {
          sessionId = (message as SDKSystemMessage).session_id;
        }
        if (message.type === "assistant") {
          hadAssistantOutput = true;
          const text = lastAssistantText(message as SDKAssistantMessage);
          if (text) lastText = text;
        }
        if (message.type === "result") {
          lastResult = message as SDKResultMessage;
          sessionId = sessionId ?? lastResult.session_id;
        }
      }
    } catch (err) {
      thrown = err;
      appendStream({ type: "harness_error", attempt, message: redact(String((err as Error)?.message ?? err)) });
    }

    if (!thrown && !lastResult?.is_error) break; // success
    if (hadAssistantOutput) break; // only retry PRE-first-assistant-output failures
    if (!isRetryableFailure(attemptMessages, thrown)) break;

    if (attempt < MAX_ATTEMPTS) {
      retries++;
      const backoffMs = 1000 * 2 ** (attempt - 1);
      appendStream({ type: "harness_retry", attempt, backoffMs });
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
  }

  const costUsd = lastResult?.total_cost_usd ?? 0;

  return {
    sessionId,
    subtype: lastResult?.subtype ?? null,
    isError: Boolean(lastResult?.is_error) || !lastResult,
    costUsd,
    turns: lastResult?.num_turns ?? 0,
    lastMessageText: (lastResult?.subtype === "success" ? lastResult.result : undefined) ?? lastText,
    retries,
  };
}
