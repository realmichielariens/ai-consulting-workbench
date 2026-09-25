// PreToolUse/PostToolUse guards (ARCHITECTURE.md §8.5 layer 3, M0-FINDINGS §1 S3).
// Ported from spike/experiments/s03-guards/guards.ts, adapted to the production
// layout (layout.ts) and normalization (@workbench/core/node), with two I1
// additions the spike didn't need:
//   - deny the `work` MCP toolset outright when a subagent makes the call
//     (ARCHITECTURE.md §8.3: only the parent session publishes/asks/submits);
//   - allow Read of the skills plugin directory (it lives outside the
//     engagement root, but skill bodies carry no secrets — A§8.7).
// Bash/PowerShell are denied outright: I1 never puts them in an agent's
// `tools` array (CLAUDE.md rule 4), so this is defense in depth only, not the
// primary control.
//
// decideForWorkAgent is a PURE function (no I/O) so it is unit-tested without
// any SDK types. forWorkAgent() wraps it into the real hook shape and adds the
// I/O side effects (the decisions log used by activity.ts, and onRead).

import path from "node:path";
import { normalize, isInside, hasTraversal } from "@workbench/core/node";
import type {
  HookCallbackMatcher,
  HookEvent,
  HookInput,
  PreToolUseHookInput,
  PostToolUseHookInput,
  SyncHookJSONOutput,
} from "@anthropic-ai/claude-agent-sdk";

export interface GuardScope {
  /** This run's item id, e.g. "WI-002". Case-insensitive comparisons throughout. */
  itemId: string;
  /** Absolute path to THIS item's own work/ folder (the run's cwd). */
  workDir: string;
  /** Absolute path to the engagement root (contains items/, .workbench/, .git/). */
  engagementRoot: string;
  /** Absolute path to the workbench-skills plugin dir. Read-only; SKILL.md bodies carry no secrets (A§8.7). */
  skillsPluginDir: string;
}

export interface GuardDecision {
  decision: "allow" | "deny";
  reason?: string;
  /** The normalized path that was checked, if any (for logging/evidence). */
  pathChecked?: string;
}

const WRITE_TOOLS = new Set(["Write", "Edit", "NotebookEdit"]);
const SEARCH_TOOLS = new Set(["Glob", "Grep"]);

/** Extracts the primary path-shaped field from a tool's input, by tool name. */
export function extractPrimaryPath(toolName: string, input: unknown): string | undefined {
  const i = input as Record<string, unknown> | null | undefined;
  if (!i || typeof i !== "object") return undefined;
  switch (toolName) {
    case "Read":
    case "Write":
    case "Edit":
      return typeof i.file_path === "string" ? i.file_path : undefined;
    case "NotebookEdit":
      return typeof i.notebook_path === "string" ? i.notebook_path : undefined;
    case "Glob":
    case "Grep":
      return typeof i.path === "string" ? i.path : undefined;
    default:
      return undefined;
  }
}

function globLiteralPrefix(pattern: string): string {
  const idx = pattern.search(/[*?[{]/);
  return idx === -1 ? pattern : pattern.slice(0, idx);
}

/** Requires isInside(child, parent). See guards.test.ts for the case-mismatch bug this avoids. */
function segmentsRelativeCI(parent: string, child: string): string[] {
  const rest = child.slice(parent.length).replace(/^\/+/, "");
  return rest.toLowerCase().split("/");
}

/**
 * Best-effort extraction of path-shaped tokens from a shell command string.
 * NOT a real shell parser: deliberately simple and deliberately bypassable
 * (a path built from a variable is not caught). Bash/PowerShell are denied
 * outright below in I1, so this only matters if that changes later.
 */
function extractPathLikeTokens(command: string): string[] {
  const patterns = [
    /[A-Za-z]:[\\/][^\s"'|<>&;]+/g,
    /\/[A-Za-z]\/[^\s"'|<>&;]+/g,
    /(?:\.\.[\\/])+[^\s"'|<>&;]*/g,
  ];
  const out: string[] = [];
  for (const re of patterns) {
    const matches = command.match(re);
    if (matches) out.push(...matches);
  }
  return out;
}

function looksAbsolute(p: string): boolean {
  return path.isAbsolute(p) || /^[A-Za-z]:[\\/]/.test(p) || p.startsWith("/") || p.startsWith("\\");
}

/**
 * Pure decision function for one tool call. `subagent` is true when the SDK
 * hook input carried an `agent_id` (ARCHITECTURE.md §8.3).
 */
export function decideForWorkAgent(scope: GuardScope, toolName: string, input: unknown, subagent: boolean): GuardDecision {
  // Only the parent session may publish, log, ask or submit (§8.3).
  if (subagent && toolName.startsWith("mcp__work__")) {
    return {
      decision: "deny",
      reason: `Subagents cannot use the work tools (${toolName}). Only the main session may publish, log, ask or submit.`,
    };
  }

  const engRoot = normalize(scope.engagementRoot);
  const workDir = normalize(scope.workDir);
  const itemsRoot = normalize(path.join(scope.engagementRoot, "items"));
  const workbenchDir = normalize(path.join(scope.engagementRoot, ".workbench"));
  const gitDir = normalize(path.join(scope.engagementRoot, ".git"));
  const skillsDir = normalize(scope.skillsPluginDir);

  if (toolName === "Bash" || toolName === "PowerShell") {
    // I1 never puts these in `tools` (CLAUDE.md rule 4); deny outright as defense in depth.
    const i = input as Record<string, unknown> | null | undefined;
    const command = typeof i?.command === "string" ? i.command : undefined;
    for (const raw of command ? extractPathLikeTokens(command) : []) {
      const norm = normalize(raw.replace(/["']+$/, ""));
      if (!isInside(norm, workDir)) {
        return {
          decision: "deny",
          reason: `${toolName} is not enabled for Work Agents in I1. Denied command: ${command}`,
          pathChecked: norm,
        };
      }
    }
    return { decision: "deny", reason: `${toolName} is not enabled for Work Agents in I1.` };
  }

  if (WRITE_TOOLS.has(toolName)) {
    const raw = extractPrimaryPath(toolName, input);
    if (!raw) return { decision: "allow" };
    const norm = normalize(raw);
    if (hasTraversal(raw) && !isInside(norm, workDir)) {
      return {
        decision: "deny",
        reason: `${toolName}: '..' path segments are not allowed, and this path resolves outside your own work/ (${scope.workDir}). Denied: ${raw}`,
        pathChecked: norm,
      };
    }
    if (!isInside(norm, workDir)) {
      return {
        decision: "deny",
        reason: `${toolName} is only allowed inside your own work/ (${scope.workDir}). Denied: ${raw}`,
        pathChecked: norm,
      };
    }
    return { decision: "allow", pathChecked: norm };
  }

  if (toolName === "Read") {
    const raw = extractPrimaryPath(toolName, input);
    if (!raw) return { decision: "allow" };
    const norm = normalize(raw);

    if (isInside(norm, skillsDir)) {
      return { decision: "allow", pathChecked: norm };
    }
    if (hasTraversal(raw) && !isInside(norm, engRoot)) {
      return {
        decision: "deny",
        reason: `Read: '..' path segments are not allowed, and this path resolves outside the engagement root (${scope.engagementRoot}). Denied: ${raw}`,
        pathChecked: norm,
      };
    }
    if (!isInside(norm, engRoot)) {
      return {
        decision: "deny",
        reason: `Read is only allowed inside the engagement root (${scope.engagementRoot}). Denied: ${raw}`,
        pathChecked: norm,
      };
    }
    if (isInside(norm, workbenchDir)) {
      return { decision: "deny", reason: `Read of internal engine state (.workbench/) is never allowed. Denied: ${raw}`, pathChecked: norm };
    }
    if (isInside(norm, gitDir)) {
      return { decision: "deny", reason: `Read of .git/ is never allowed. Denied: ${raw}`, pathChecked: norm };
    }
    if (isInside(norm, itemsRoot)) {
      const segs = segmentsRelativeCI(itemsRoot, norm);
      const otherItemId = segs[0];
      const bucket = segs[1];
      if (otherItemId && otherItemId !== scope.itemId.toLowerCase() && bucket === "work") {
        return {
          decision: "deny",
          reason: `Read of another item's work/ is not allowed (${otherItemId}/work/). Denied: ${raw}`,
          pathChecked: norm,
        };
      }
    }
    return { decision: "allow", pathChecked: norm };
  }

  if (SEARCH_TOOLS.has(toolName)) {
    const i = input as Record<string, unknown>;
    const basePathRaw = typeof i?.path === "string" ? i.path : undefined;

    if (basePathRaw && hasTraversal(basePathRaw)) {
      return { decision: "deny", reason: `${toolName}: 'path' may not contain '..' segments. Denied: ${basePathRaw}` };
    }
    const baseAbs = basePathRaw ? normalize(basePathRaw) : workDir;
    if (!isInside(baseAbs, workDir)) {
      return {
        decision: "deny",
        reason: `${toolName} is restricted to your own work/ folder (${scope.workDir}). Denied path: ${basePathRaw ?? "(default cwd)"}`,
        pathChecked: baseAbs,
      };
    }

    if (toolName === "Glob") {
      const pattern = typeof i?.pattern === "string" ? i.pattern : "";
      if (hasTraversal(pattern)) {
        return { decision: "deny", reason: `Glob: 'pattern' may not contain '..' segments. Denied: ${pattern}` };
      }
      const literalPrefix = globLiteralPrefix(pattern);
      if (literalPrefix && looksAbsolute(literalPrefix)) {
        const abs = normalize(literalPrefix);
        if (!isInside(abs, workDir)) {
          return {
            decision: "deny",
            reason: `Glob: pattern's absolute prefix resolves outside your own work/. Denied: ${pattern}`,
            pathChecked: abs,
          };
        }
      }
    }

    if (toolName === "Grep") {
      const globFilter = typeof i?.glob === "string" ? i.glob : undefined;
      if (globFilter && hasTraversal(globFilter)) {
        return { decision: "deny", reason: `Grep: 'glob' filter may not contain '..' segments. Denied: ${globFilter}` };
      }
      // Grep's `pattern` is a content regex, not a path; '..' in it is not a traversal attempt.
    }

    return { decision: "allow" };
  }

  return { decision: "allow" };
}

// ---------------------------------------------------------------------------
// SDK wiring

/** Every PreToolUse decision, keyed by tool_use_id. activity.ts uses this to tell a denial
 * from a genuine tool error, and to attribute a call to a subagent (agentId). */
export type GuardDecisionLog = Map<string, GuardDecision & { agentId?: string; agentType?: string }>;

export interface WorkAgentGuards {
  hooks: Partial<Record<HookEvent, HookCallbackMatcher[]>>;
  /** Every PreToolUse decision made during the run so far. */
  decisions: GuardDecisionLog;
  /** Count of denied calls so far (Run.denials). */
  denialCount(): number;
}

export interface ForWorkAgentOptions {
  /** PostToolUse: called for every successful Read (implicit-read audit, ARCHITECTURE.md §8.5 layer 4). */
  onRead?: (absPath: string, agentId?: string) => void;
}

/** Builds the `hooks` option for a Work Agent run scoped to `scope` (ARCHITECTURE.md §8.5 layer 3). */
export function forWorkAgent(scope: GuardScope, opts: ForWorkAgentOptions = {}): WorkAgentGuards {
  const decisions: GuardDecisionLog = new Map();

  const preToolUse: HookCallbackMatcher = {
    hooks: [
      async (input: HookInput): Promise<SyncHookJSONOutput> => {
        const pre = input as PreToolUseHookInput;
        const subagent = pre.agent_id != null;
        const decision = decideForWorkAgent(scope, pre.tool_name, pre.tool_input, subagent);
        decisions.set(pre.tool_use_id, { ...decision, agentId: pre.agent_id, agentType: pre.agent_type });

        if (decision.decision === "deny") {
          return {
            continue: true,
            hookSpecificOutput: {
              hookEventName: "PreToolUse",
              permissionDecision: "deny",
              permissionDecisionReason: decision.reason,
            },
          };
        }
        return { continue: true };
      },
    ],
  };

  const postToolUse: HookCallbackMatcher = {
    hooks: [
      async (input: HookInput): Promise<SyncHookJSONOutput> => {
        const post = input as PostToolUseHookInput;
        if (post.tool_name === "Read") {
          const decision = decisions.get(post.tool_use_id);
          if (decision?.decision === "allow") {
            const raw = extractPrimaryPath("Read", post.tool_input);
            if (raw) opts.onRead?.(normalize(raw), post.agent_id);
          }
        }
        return { continue: true };
      },
    ],
  };

  return {
    hooks: { PreToolUse: [preToolUse], PostToolUse: [postToolUse] },
    decisions,
    denialCount: () => {
      let n = 0;
      for (const d of decisions.values()) if (d.decision === "deny") n++;
      return n;
    },
  };
}

// ---------------------------------------------------------------------------
// Approach Agent guards (I2-PLAN §4.1). Same pure-decision + hook-wrapper
// split as the Work Agent above, but with the Approach Agent's own scope
// rules: writes confined to items/ENG/work/ (its own locus of control, like
// a Work Agent's item work/), reads open to the whole engagement except
// other items' work/, .workbench/ and .git/. No skills plugin (the Approach
// Agent runs with no plugin/skills, sdk.ts), so there is no readable-skills-
// dir exception here.

export interface ApproachGuardScope {
  /** Absolute path to items/ENG/work (the run's cwd, and the Approach Agent's only writable locus). */
  workDir: string;
  /** Absolute path to the engagement root (contains items/, .workbench/, .git/). */
  engagementRoot: string;
}

/** Pure decision function for one Approach Agent tool call, mirroring decideForWorkAgent's shape. */
export function decideForApproachAgent(scope: ApproachGuardScope, toolName: string, input: unknown, subagent: boolean): GuardDecision {
  // Only the parent session may read/write the plan, publish, journal or notify (mirrors §8.3 for `work`).
  if (subagent && toolName.startsWith("mcp__plan__")) {
    return {
      decision: "deny",
      reason: `Subagents cannot use the plan tools (${toolName}). Only the main session may read, propose, answer or publish.`,
    };
  }

  const engRoot = normalize(scope.engagementRoot);
  const workDir = normalize(scope.workDir);
  const itemsRoot = normalize(path.join(scope.engagementRoot, "items"));
  const workbenchDir = normalize(path.join(scope.engagementRoot, ".workbench"));
  const gitDir = normalize(path.join(scope.engagementRoot, ".git"));

  if (toolName === "Bash" || toolName === "PowerShell" || toolName === "Task") {
    // None of these are ever in the Approach Agent's `tools` (sdk.ts APPROACH_AGENT_TOOLS); deny outright as defense in depth.
    return { decision: "deny", reason: `${toolName} is not enabled for the Approach Agent.` };
  }

  if (WRITE_TOOLS.has(toolName)) {
    const raw = extractPrimaryPath(toolName, input);
    if (!raw) return { decision: "allow" };
    const norm = normalize(raw);
    if (hasTraversal(raw) && !isInside(norm, workDir)) {
      return {
        decision: "deny",
        reason: `${toolName}: '..' path segments are not allowed, and this path resolves outside items/ENG/work/ (${scope.workDir}). Denied: ${raw}`,
        pathChecked: norm,
      };
    }
    if (!isInside(norm, workDir)) {
      return {
        decision: "deny",
        reason: `${toolName} is only allowed inside items/ENG/work/ (${scope.workDir}). Denied: ${raw}`,
        pathChecked: norm,
      };
    }
    return { decision: "allow", pathChecked: norm };
  }

  if (toolName === "Read") {
    const raw = extractPrimaryPath(toolName, input);
    if (!raw) return { decision: "allow" };
    const norm = normalize(raw);

    if (hasTraversal(raw) && !isInside(norm, engRoot)) {
      return {
        decision: "deny",
        reason: `Read: '..' path segments are not allowed, and this path resolves outside the engagement root (${scope.engagementRoot}). Denied: ${raw}`,
        pathChecked: norm,
      };
    }
    if (!isInside(norm, engRoot)) {
      return {
        decision: "deny",
        reason: `Read is only allowed inside the engagement root (${scope.engagementRoot}). Denied: ${raw}`,
        pathChecked: norm,
      };
    }
    if (isInside(norm, workbenchDir)) {
      return { decision: "deny", reason: `Read of internal engine state (.workbench/) is never allowed. Denied: ${raw}`, pathChecked: norm };
    }
    if (isInside(norm, gitDir)) {
      return { decision: "deny", reason: `Read of .git/ is never allowed. Denied: ${raw}`, pathChecked: norm };
    }
    if (isInside(norm, itemsRoot)) {
      const segs = segmentsRelativeCI(itemsRoot, norm);
      const otherItemId = segs[0];
      const bucket = segs[1];
      if (otherItemId && otherItemId !== "eng" && bucket === "work") {
        return {
          decision: "deny",
          reason: `Read of another item's work/ is not allowed (${otherItemId}/work/). Denied: ${raw}`,
          pathChecked: norm,
        };
      }
    }
    return { decision: "allow", pathChecked: norm };
  }

  if (SEARCH_TOOLS.has(toolName)) {
    const i = input as Record<string, unknown>;
    const basePathRaw = typeof i?.path === "string" ? i.path : undefined;

    if (basePathRaw && hasTraversal(basePathRaw)) {
      return { decision: "deny", reason: `${toolName}: 'path' may not contain '..' segments. Denied: ${basePathRaw}` };
    }
    // Default cwd for the Approach Agent's process is items/ENG/work/, but (unlike the Work
    // Agent) Glob/Grep may target anywhere readable, same scope as Read above.
    const baseAbs = basePathRaw ? normalize(basePathRaw) : workDir;
    if (!isInside(baseAbs, engRoot)) {
      return {
        decision: "deny",
        reason: `${toolName} is restricted to the engagement root (${scope.engagementRoot}). Denied path: ${basePathRaw ?? "(default cwd)"}`,
        pathChecked: baseAbs,
      };
    }
    if (isInside(baseAbs, workbenchDir) || isInside(baseAbs, gitDir)) {
      return {
        decision: "deny",
        reason: `${toolName} may not target internal engine state (.workbench/) or .git/. Denied path: ${basePathRaw ?? "(default cwd)"}`,
        pathChecked: baseAbs,
      };
    }
    if (isInside(baseAbs, itemsRoot)) {
      const segs = segmentsRelativeCI(itemsRoot, baseAbs);
      const otherItemId = segs[0];
      const bucket = segs[1];
      if (otherItemId && otherItemId !== "eng" && bucket === "work") {
        return {
          decision: "deny",
          reason: `${toolName} may not target another item's work/ (${otherItemId}/work/). Denied path: ${basePathRaw}`,
          pathChecked: baseAbs,
        };
      }
    }

    if (toolName === "Glob") {
      const pattern = typeof i?.pattern === "string" ? i.pattern : "";
      if (hasTraversal(pattern)) {
        return { decision: "deny", reason: `Glob: 'pattern' may not contain '..' segments. Denied: ${pattern}` };
      }
      const literalPrefix = globLiteralPrefix(pattern);
      if (literalPrefix && looksAbsolute(literalPrefix)) {
        const abs = normalize(literalPrefix);
        if (!isInside(abs, engRoot)) {
          return {
            decision: "deny",
            reason: `Glob: pattern's absolute prefix resolves outside the engagement root. Denied: ${pattern}`,
            pathChecked: abs,
          };
        }
      }
    }

    if (toolName === "Grep") {
      const globFilter = typeof i?.glob === "string" ? i.glob : undefined;
      if (globFilter && hasTraversal(globFilter)) {
        return { decision: "deny", reason: `Grep: 'glob' filter may not contain '..' segments. Denied: ${globFilter}` };
      }
      // Grep's `pattern` is a content regex, not a path; '..' in it is not a traversal attempt.
    }

    return { decision: "allow" };
  }

  return { decision: "allow" };
}

export interface ApproachAgentGuards {
  hooks: Partial<Record<HookEvent, HookCallbackMatcher[]>>;
  /** Every PreToolUse decision made during the run so far. */
  decisions: GuardDecisionLog;
  /** Count of denied calls so far (Run.denials). */
  denialCount(): number;
}

export interface ForApproachAgentOptions {
  /** PostToolUse: called for every successful Read (implicit-read audit, mirrors the Work Agent). */
  onRead?: (absPath: string, agentId?: string) => void;
}

/** Builds the `hooks` option for an Approach Agent run scoped to `scope`. */
export function forApproachAgent(scope: ApproachGuardScope, opts: ForApproachAgentOptions = {}): ApproachAgentGuards {
  const decisions: GuardDecisionLog = new Map();

  const preToolUse: HookCallbackMatcher = {
    hooks: [
      async (input: HookInput): Promise<SyncHookJSONOutput> => {
        const pre = input as PreToolUseHookInput;
        const subagent = pre.agent_id != null;
        const decision = decideForApproachAgent(scope, pre.tool_name, pre.tool_input, subagent);
        decisions.set(pre.tool_use_id, { ...decision, agentId: pre.agent_id, agentType: pre.agent_type });

        if (decision.decision === "deny") {
          return {
            continue: true,
            hookSpecificOutput: {
              hookEventName: "PreToolUse",
              permissionDecision: "deny",
              permissionDecisionReason: decision.reason,
            },
          };
        }
        return { continue: true };
      },
    ],
  };

  const postToolUse: HookCallbackMatcher = {
    hooks: [
      async (input: HookInput): Promise<SyncHookJSONOutput> => {
        const post = input as PostToolUseHookInput;
        if (post.tool_name === "Read") {
          const decision = decisions.get(post.tool_use_id);
          if (decision?.decision === "allow") {
            const raw = extractPrimaryPath("Read", post.tool_input);
            if (raw) opts.onRead?.(normalize(raw), post.agent_id);
          }
        }
        return { continue: true };
      },
    ],
  };

  return {
    hooks: { PreToolUse: [preToolUse], PostToolUse: [postToolUse] },
    decisions,
    denialCount: () => {
      let n = 0;
      for (const d of decisions.values()) if (d.decision === "deny") n++;
      return n;
    },
  };
}
