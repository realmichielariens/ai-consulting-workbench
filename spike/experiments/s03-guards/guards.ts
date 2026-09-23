// S3 — Guard hooks (M0-SPIKE-PLAN.md §4 "S3", ARCHITECTURE.md §8.5 layer 3,
// §17.3). NOT part of src/lib — this is the experiment's own implementation,
// exactly as the plan requires ("implement guards.forWorkAgent(item) in
// experiments/s03-guards/guards.ts").
//
// guards.forWorkAgent(item) builds the PreToolUse/PostToolUse hook set for
// one Work Agent run:
//   - PreToolUse: normalizes the path in every path-carrying tool call and
//     denies (a) writes (Write/Edit/NotebookEdit) outside the item's own
//     work/, (b) reads of other items' work/, .workbench/, .git/, or
//     anything outside the engagement root, (c) Glob/Grep whose *effective*
//     search root (the `path` input, or its default of cwd) or whose
//     `pattern`/`glob` filter would reach outside the item's own folder.
//   - PostToolUse: logs every hook invocation (for the subagent-firing
//     check) and reports "implicit reads" of tracked asset paths.
//
// The decision logic (decideForWorkAgent) is a PURE function — no I/O, no
// SDK types beyond plain strings — so it can be unit-tested without any API
// calls (see guards.test.ts). forWorkAgent() wraps it into real SDK
// HookCallbackMatcher[] arrays and adds the I/O (logging) side effects.

import path from "node:path";
import { normalize, isInside, hasTraversal } from "../../src/lib/paths.js";
import type {
  HookCallbackMatcher,
  HookInput,
  PreToolUseHookInput,
  PostToolUseHookInput,
  SyncHookJSONOutput,
} from "@anthropic-ai/claude-agent-sdk";

export type GuardItem = {
  /** Item id, e.g. "WI-001". Case-insensitive comparisons throughout. */
  id: string;
  /** Absolute path to THIS item's own work/ folder. */
  workDir: string;
  /** Absolute path to the engagement root (contains items/, .workbench/, .git/). */
  engRoot: string;
};

export type GuardDecision = {
  decision: "allow" | "deny";
  reason?: string;
  /** The normalized path that was checked, if any (for logging/evidence). */
  pathChecked?: string;
};

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

/** The literal (non-glob) prefix of a glob pattern, i.e. everything before the first *, ?, [ or {. */
function globLiteralPrefix(pattern: string): string {
  const idx = pattern.search(/[*?[{]/);
  return idx === -1 ? pattern : pattern.slice(0, idx);
}

/**
 * The path of `child` relative to `parent`, split on "/", lowercased.
 * REQUIRES isInside(child, parent) to already be true. Windows paths are
 * case-insensitive but `normalize()` only lowercases the drive letter, not
 * the rest — so a naive `path.posix.relative(parent, child)` on two
 * differently-cased strings (e.g. an all-uppercase adversarial input vs.
 * our own lowercase-constructed itemsRoot) computes pure lexical (garbage)
 * output instead of the real path segments (confirmed by a failing unit
 * test in guards.test.ts before this fix: an all-uppercase "other item's
 * work/" path slipped through as `allow`). Slicing by length (both sides
 * are already `normalize()`d, so lengths line up 1:1 with case differences
 * only) and lowercasing the remainder is the fix.
 */
function segmentsRelativeCI(parent: string, child: string): string[] {
  const rest = child.slice(parent.length).replace(/^\/+/, "");
  return rest.toLowerCase().split("/");
}

/**
 * Best-effort extraction of path-shaped tokens from a raw shell command
 * string, for the Bash/PowerShell heuristic below. NOT a real shell
 * parser — deliberately simple, deliberately documented as bypassable
 * (see FINDINGS.md "Bash/PowerShell heuristic limits"): a command that
 * builds its target path via a variable, command substitution, multiple
 * `cd` calls across separate tool invocations, or non-ASCII/encoded
 * obfuscation will NOT be caught. This exists to catch the common/naive
 * case (a literal absolute or `..`-relative path token in the command),
 * which is exactly what a Haiku agent following a straightforward
 * instruction (or an unsophisticated prompt injection) produces.
 */
function extractPathLikeTokens(command: string): string[] {
  const patterns = [
    /[A-Za-z]:[\\/][^\s"'|<>&;]+/g, // Windows absolute: C:\... or C:/...
    /\/[A-Za-z]\/[^\s"'|<>&;]+/g, // git-bash posix-style: /c/Users/...
    /(?:\.\.[\\/])+[^\s"'|<>&;]*/g, // relative traversal: ../../foo or ..\..\foo
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
 * Pure decision function for one tool call, given the guarded item's
 * identity. No I/O; unit-tested directly in guards.test.ts. Mirrors
 * ARCHITECTURE.md §8.5 layer 3:
 *   - deny writes outside own work/
 *   - deny Read of other items' work/, .workbench/, .git/, or anything
 *     outside the engagement root
 *   - restrict Glob/Grep to the item's own folder, checking both the
 *     `path` input AND the `pattern`/`glob` filter for an escape
 */
export function decideForWorkAgent(item: GuardItem, toolName: string, input: unknown): GuardDecision {
  const engRoot = normalize(item.engRoot);
  const workDir = normalize(item.workDir);
  const itemsRoot = normalize(path.join(item.engRoot, "items"));
  const workbenchDir = normalize(path.join(item.engRoot, ".workbench"));
  const gitDir = normalize(path.join(item.engRoot, ".git"));

  if (WRITE_TOOLS.has(toolName)) {
    const raw = extractPrimaryPath(toolName, input);
    if (!raw) return { decision: "allow" };
    const norm = normalize(raw);
    if (hasTraversal(raw) && !isInside(norm, workDir)) {
      return {
        decision: "deny",
        reason: `${toolName}: '..' path segments are not allowed, and this path resolves outside your own work/ (${item.workDir}). Denied: ${raw}`,
        pathChecked: norm,
      };
    }
    if (!isInside(norm, workDir)) {
      return {
        decision: "deny",
        reason: `${toolName} is only allowed inside your own work/ (${item.workDir}). Denied: ${raw}`,
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
        reason: `Read: '..' path segments are not allowed, and this path resolves outside the engagement root (${item.engRoot}). Denied: ${raw}`,
        pathChecked: norm,
      };
    }
    if (!isInside(norm, engRoot)) {
      return {
        decision: "deny",
        reason: `Read is only allowed inside the engagement root (${item.engRoot}). Denied: ${raw}`,
        pathChecked: norm,
      };
    }
    if (isInside(norm, workbenchDir)) {
      return {
        decision: "deny",
        reason: `Read of internal engine state (.workbench/) is never allowed. Denied: ${raw}`,
        pathChecked: norm,
      };
    }
    if (isInside(norm, gitDir)) {
      return {
        decision: "deny",
        reason: `Read of .git/ is never allowed. Denied: ${raw}`,
        pathChecked: norm,
      };
    }
    if (isInside(norm, itemsRoot)) {
      const segs = segmentsRelativeCI(itemsRoot, norm); // already lowercased
      const otherItemId = segs[0];
      const bucket = segs[1];
      if (otherItemId && otherItemId !== item.id.toLowerCase() && bucket === "work") {
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
      return {
        decision: "deny",
        reason: `${toolName}: 'path' may not contain '..' segments. Denied: ${basePathRaw}`,
      };
    }
    const baseAbs = basePathRaw ? normalize(basePathRaw) : workDir; // default search root is cwd == workDir
    if (!isInside(baseAbs, workDir)) {
      return {
        decision: "deny",
        reason: `${toolName} is restricted to your own work/ folder (${item.workDir}). Denied path: ${basePathRaw ?? "(default cwd)"}`,
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
        // An absolute (or drive-rooted) literal prefix bypasses `path` entirely.
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
      // NOTE: Grep's `pattern` is a CONTENT regex, not a path — a `..` inside
      // it only searches file text for the literal characters "..", it does
      // not change which files get searched. We deliberately do NOT deny on
      // it (would just produce false positives on legitimate searches for
      // "../" in source code); see FINDINGS.md "Grep pattern is not a path".
    }

    return { decision: "allow" };
  }

  if (toolName === "Bash" || toolName === "PowerShell") {
    const i = input as Record<string, unknown>;
    const command = typeof i?.command === "string" ? i.command : undefined;
    if (!command) return { decision: "allow" };

    for (const raw of extractPathLikeTokens(command)) {
      const norm = normalize(raw.replace(/["']+$/, "")); // trailing quote from the regex match, if any
      if (!isInside(norm, workDir)) {
        return {
          decision: "deny",
          reason:
            `${toolName}: this command references a path outside your own work/ (${item.workDir}), ` +
            `detected by a simple heuristic scan (matched token: "${raw}"). Denied command: ${command}`,
          pathChecked: norm,
        };
      }
    }
    // NOTE: this heuristic only catches a LITERAL path token in the command
    // string. It does not parse shell syntax, resolve variables/command
    // substitution, or track `cd` across separate tool calls. See
    // FINDINGS.md for a real, demonstrated bypass. Bash/PowerShell should
    // still be excluded from `tools` entirely for items that don't need
    // them (ARCHITECTURE.md §8.2 `needsBash(item)`), and this heuristic is
    // a second, best-effort line of defense, not a guarantee.
    return { decision: "allow" };
  }

  return { decision: "allow" };
}

// ---------------------------------------------------------------------------
// SDK wiring

export type GuardLogEntry = {
  ts: string;
  hookEvent: "PreToolUse" | "PostToolUse";
  toolName: string;
  toolUseId: string;
  agentId?: string;
  agentType?: string;
  decision?: "allow" | "deny";
  reason?: string;
  pathChecked?: string;
  durationMs?: number;
};

export type ImplicitReadEvent = {
  path: string;
  agentId?: string;
  agentType?: string;
  toolUseId: string;
};

export type ForWorkAgentOptions = {
  /** Called for every PreToolUse AND PostToolUse hook invocation (subagent-firing + overhead evidence). */
  onHookEvent?: (entry: GuardLogEntry) => void;
  /** Called on PostToolUse whenever a Read's path matches one of `trackedAssetPaths`. */
  onImplicitRead?: (event: ImplicitReadEvent) => void;
  /** Absolute paths considered "assets" worth recording as implicit reads on successful Read. */
  trackedAssetPaths?: string[];
};

/**
 * Builds the `hooks` option value for a Work Agent run scoped to `item`.
 * ARCHITECTURE.md §8.5 layer 3. Pass the return value directly as
 * `options.hooks` in runQuery()/query().
 */
export function forWorkAgent(item: GuardItem, opts: ForWorkAgentOptions = {}): Partial<Record<string, HookCallbackMatcher[]>> {
  const trackedAssets = new Set((opts.trackedAssetPaths ?? []).map((p) => normalize(p).toLowerCase()));

  const preToolUse: HookCallbackMatcher = {
    hooks: [
      async (input: HookInput, toolUseID: string | undefined): Promise<SyncHookJSONOutput> => {
        const start = Date.now();
        const pre = input as PreToolUseHookInput;
        const decision = decideForWorkAgent(item, pre.tool_name, pre.tool_input);

        opts.onHookEvent?.({
          ts: new Date().toISOString(),
          hookEvent: "PreToolUse",
          toolName: pre.tool_name,
          toolUseId: pre.tool_use_id ?? toolUseID ?? "",
          agentId: pre.agent_id,
          agentType: pre.agent_type,
          decision: decision.decision,
          reason: decision.reason,
          pathChecked: decision.pathChecked,
          durationMs: Date.now() - start,
        });

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
      async (input: HookInput, toolUseID: string | undefined): Promise<SyncHookJSONOutput> => {
        const start = Date.now();
        const post = input as PostToolUseHookInput;

        opts.onHookEvent?.({
          ts: new Date().toISOString(),
          hookEvent: "PostToolUse",
          toolName: post.tool_name,
          toolUseId: post.tool_use_id ?? toolUseID ?? "",
          agentId: post.agent_id,
          agentType: post.agent_type,
          durationMs: Date.now() - start,
        });

        if (post.tool_name === "Read") {
          const raw = extractPrimaryPath("Read", post.tool_input);
          if (raw) {
            const norm = normalize(raw).toLowerCase();
            if (trackedAssets.has(norm)) {
              opts.onImplicitRead?.({
                path: raw,
                agentId: post.agent_id,
                agentType: post.agent_type,
                toolUseId: post.tool_use_id ?? toolUseID ?? "",
              });
            }
          }
        }

        return { continue: true };
      },
    ],
  };

  return {
    PreToolUse: [preToolUse],
    PostToolUse: [postToolUse],
  };
}
