// The ONLY place that calls the Claude Agent SDK's query() (CLAUDE.md rule 4).
// One call to runOnce() is one query() invocation; a run (runtime.ts) can
// make several (the initial call, then at most one nudge resume). Options
// follow M0-FINDINGS §2 / ARCHITECTURE.md §8.2 exactly. Retries only cover
// rate-limit/overloaded failures before the first assistant message, ported
// from spike/src/lib/run.ts.

import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import {
  query,
  type HookCallbackMatcher,
  type HookEvent,
  type McpServerConfig,
  type McpServerStatus,
  type Options,
  type SDKAssistantMessage,
  type SDKMessage,
  type SDKResultMessage,
  type SDKSystemMessage,
  type SDKUserMessage,
  type SpawnedProcess,
} from "@anthropic-ai/claude-agent-sdk";
import type { EffortLevel, ItemId, RunId } from "@workbench/core";
import { redact } from "@workbench/core/node";

/** The explicit built-in tool set (M0-FINDINGS §2): I1 never enables Bash or PowerShell (CLAUDE.md rule 4). */
export const WORK_AGENT_TOOLS = ["Read", "Write", "Edit", "Glob", "Grep", "Skill", "Task"] as const;
export const WORK_AGENT_ALLOWED_TOOLS = ["Read", "Glob", "Grep", "Skill", "Task", "Edit(./**)", "mcp__work__*"] as const;

/**
 * Added for tasks with the Open Web source attached (sourceResolver.ts).
 * SECURITY (rollout): web access is also an egress channel — an agent that has
 * read confidential inputs can put them into a WebFetch URL or a search query.
 * The POC accepts that; a rollout needs a domain allowlist and the guard rule
 * sketched in guards.ts (WebFetch only for URLs a search returned).
 */
export const WEB_TOOLS = ["WebSearch", "WebFetch"] as const;

/** The Work Agent's built-in tools and allow rules for one run: the fixed base plus what its attached sources add. */
export function workAgentToolset(extra: { tools: readonly string[]; allowedTools: readonly string[] }): { tools: string[]; allowedTools: string[] } {
  return { tools: [...WORK_AGENT_TOOLS, ...extra.tools], allowedTools: [...WORK_AGENT_ALLOWED_TOOLS, ...extra.allowedTools] };
}

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
  /** Reasoning effort (Settings, default "high"); undefined leaves the SDK default. */
  effort?: EffortLevel;
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

/** "claude-opus-5-5, high effort" — the model as shown in the run's Started/Resumed activity line. */
export function describeModel(model: string, effort: EffortLevel | undefined): string {
  return effort ? `${model}, ${effort} effort` : model;
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
      effort: args.effort,
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

// ---------------------------------------------------------------------------
// Test connection for a source (sourceTest.ts, USER-MCP-SOURCES-PLAN Decision 5)
// ---------------------------------------------------------------------------

export interface ProbeMcpServerArgs {
  /** The mcpServers key; the status is looked up under it. */
  name: string;
  config: McpServerConfig;
  /** The clean child env (sdkEnv), with CLAUDE_CONFIG_DIR pinned. */
  env: NodeJS.ProcessEnv;
  cwd: string;
  /** Give up after this long and report "timeout". */
  timeoutMs: number;
  pollMs?: number;
}

export interface ProbeMcpServerResult {
  status: Exclude<McpServerStatus["status"], "pending"> | "timeout";
  error: string | null;
  serverInfo: { name: string; version: string } | null;
  tools: Array<{ name: string; description?: string }>;
}

const DENY_ALL_TOOLS: HookCallbackMatcher = {
  hooks: [
    async () => ({
      continue: true,
      hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "A connection test runs no tools." },
    }),
  ],
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hasExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

function waitForExit(child: ChildProcess, ms: number): Promise<boolean> {
  if (hasExited(child)) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(hasExited(child)), ms);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

/** Last resort if the CLI ignores stdin EOF: on Windows kill the whole tree, so the MCP server it started goes too. */
function killTree(child: ChildProcess): void {
  if (hasExited(child) || !child.pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
  } else {
    child.kill("SIGKILL");
  }
}

/**
 * Starts the Claude Code CLI with exactly one MCP server and reports how the
 * connection went, without ever sending a prompt: the streaming prompt never
 * yields, so no model call (and no cost) is made. Polls mcpServerStatus()
 * until the server leaves "pending", then ends the query and makes sure the
 * child (and with it the server) has exited.
 */
export async function probeMcpServer(args: ProbeMcpServerArgs): Promise<ProbeMcpServerResult> {
  let releasePrompt!: () => void;
  const promptReleased = new Promise<void>((resolve) => (releasePrompt = resolve));
  async function* silentPrompt(): AsyncGenerator<SDKUserMessage> {
    await promptReleased;
  }

  let child: ChildProcess | undefined;
  const stderrTail: string[] = [];
  const options: Options = {
    cwd: args.cwd,
    settingSources: [],
    settings: { disableBundledSkills: true },
    env: args.env,
    plugins: [],
    skills: [],
    tools: [],
    allowedTools: [],
    mcpServers: { [args.name]: args.config },
    strictMcpConfig: true,
    permissionMode: "dontAsk",
    // No turn ever runs; the hook is the guard in case one somehow did.
    hooks: { PreToolUse: [DENY_ALL_TOOLS] },
    maxTurns: 1,
    persistSession: false,
    stderr: (data) => {
      stderrTail.push(redact(data));
      if (stderrTail.length > 20) stderrTail.shift();
    },
    spawnClaudeCodeProcess: (spawnOptions) => {
      child = spawn(spawnOptions.command, spawnOptions.args, { cwd: spawnOptions.cwd, env: spawnOptions.env, windowsHide: true });
      return child as unknown as SpawnedProcess;
    },
  };

  const q = query({ prompt: silentPrompt(), options });
  // Keep the message stream flowing (the CLI's system messages), and swallow the error close() causes.
  const drained = (async () => {
    try {
      for await (const _message of q) {
        // nothing to do: only the MCP status matters here
      }
    } catch {
      // closed or the CLI failed to start; the status poll reports it
    }
  })();

  const deadline = Date.now() + args.timeoutMs;
  let result: ProbeMcpServerResult = { status: "timeout", error: `No answer from the server within ${Math.round(args.timeoutMs / 1000)} s.`, serverInfo: null, tools: [] };
  try {
    for (;;) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      const statuses = await Promise.race([q.mcpServerStatus(), sleep(remaining).then(() => null)]);
      const status = statuses?.find((s) => s.name === args.name);
      if (status && status.status !== "pending") {
        result = {
          status: status.status,
          error: status.error ? redact(status.error) : null,
          serverInfo: status.serverInfo ?? null,
          tools: (status.tools ?? []).map((t) => (t.description ? { name: t.name, description: t.description } : { name: t.name })),
        };
        break;
      }
      await sleep(Math.min(args.pollMs ?? 250, Math.max(0, deadline - Date.now())));
    }
  } catch (err) {
    const tail = stderrTail.join("").trim().split(/\r?\n/).slice(-3).join(" ");
    result = { status: "failed", error: redact(`${err instanceof Error ? err.message : String(err)}${tail ? ` (${tail})` : ""}`), serverInfo: null, tools: [] };
  } finally {
    releasePrompt();
    q.close();
    if (child && !(await waitForExit(child, 8000))) killTree(child);
    await Promise.race([drained, sleep(2000)]);
  }
  return result;
}
