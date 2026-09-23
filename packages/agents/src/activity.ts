// Maps raw SDK messages to the readable ActivityItem stream (ARCHITECTURE.md
// §8.2, activity.ts contract, J1.3). ActivityBuilder is a stateful, ordered
// mapper: one instance per run (it owns the run-wide `idx` counter and the
// tool_use/tool_result pairing, both of which must survive across the
// several query() calls one run can make — the initial call plus the one
// nudge). It is a pure mapper with no I/O: the caller (runtime.ts) is the one
// that pushes each returned item to RunObserver.onActivity, which keeps this
// file testable from small hand-built message fixtures.
//
// Denials are told apart from genuine tool errors using the guard's own
// PreToolUse decision log (guards.ts), keyed by tool_use_id — not by
// pattern-matching the denial text — because that is what the hook input
// actually carries (M0 S3), including the agent_id that attributes a call to
// a subagent.

import type { ItemId } from "@workbench/core";
import { isInside, normalize } from "@workbench/core/node";
import type { ActivityItem, ActivityKind } from "@workbench/core";
import type { GuardDecisionLog } from "./guards.js";

export interface ActivityContext {
  itemId: ItemId;
  /** Absolute engagement root (EngagementPaths.root). */
  engagementRoot: string;
  /** Absolute path of this item's own work/ (EngagementPaths.itemWork(itemId)). */
  workDir: string;
}

function truncate(text: string, max: number): string {
  const t = text.trim();
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

function extractResultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((b) => (b && typeof b === "object" && typeof (b as { text?: unknown }).text === "string" ? (b as { text: string }).text : "")).join("");
  }
  return "";
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

type PendingToolUse = { name: string; input: unknown };

/** WORK_TOOL_PREFIX matches the MCP tool names sdk.ts registers under mcpServers.work (workToolset.ts). */
const WORK_TOOL_PREFIX = "mcp__work__";

export class ActivityBuilder {
  private idx = 0;
  private readonly pending = new Map<string, PendingToolUse>();
  private readonly workDirNorm: string;
  private readonly engRootNorm: string;
  private readonly versionFileRe: RegExp;

  constructor(private readonly ctx: ActivityContext) {
    this.workDirNorm = normalize(ctx.workDir);
    this.engRootNorm = normalize(ctx.engagementRoot);
    this.versionFileRe = new RegExp(
      `^${escapeRegExp(this.engRootNorm)}/items/([^/]+)/assets/([^/]+)/v(\\d+\\.\\d+)\\.[a-z0-9]+$`,
      "i",
    );
  }

  private push(partial: Omit<ActivityItem, "idx" | "at">): ActivityItem {
    return { idx: this.idx++, at: new Date().toISOString(), ...partial };
  }

  /** "<ID>/<slot> vX.Y" for a version file, "work/<rel>" inside this item's own work/, else relative to the engagement root. */
  private describePath(raw: string | undefined): string {
    if (!raw) return "(unknown path)";
    const norm = normalize(raw);
    if (isInside(norm, this.workDirNorm)) {
      const rel = norm.slice(this.workDirNorm.length).replace(/^\/+/, "");
      return rel ? `work/${rel}` : "work";
    }
    const m = this.versionFileRe.exec(norm);
    if (m) return `${m[1]}/${m[2]} v${m[3]}`;
    if (isInside(norm, this.engRootNorm)) {
      return norm.slice(this.engRootNorm.length).replace(/^\/+/, "");
    }
    return norm;
  }

  system(summary: string): ActivityItem {
    return this.push({ kind: "system", summary });
  }

  nudge(): ActivityItem {
    return this.push({
      kind: "nudge",
      summary: "Nudged: the turn ended without submitting or raising a blocking question.",
    });
  }

  result(outcome: string, turns: number, costUsd: number): ActivityItem {
    const turnWord = turns === 1 ? "turn" : "turns";
    return this.push({
      kind: "result",
      summary: `Run ended: ${outcome} — ${turns} ${turnWord}, $${costUsd.toFixed(4)}`,
      costUsd,
    });
  }

  error(message: string): ActivityItem {
    return this.push({ kind: "error", summary: truncate(message, 300), detail: message });
  }

  /** Feed one raw SDK message (already redacted upstream); returns the ActivityItems it produced, in order. */
  fromSdkMessage(msg: unknown, guardDecisions: GuardDecisionLog): ActivityItem[] {
    const m = msg as { type?: string; message?: { content?: unknown } };
    const out: ActivityItem[] = [];

    if (m.type === "assistant") {
      const content = m.message?.content;
      if (Array.isArray(content)) {
        for (const block of content as Array<Record<string, unknown>>) {
          if (block?.type === "text" && typeof block.text === "string" && block.text.trim()) {
            const text = block.text as string;
            out.push(this.push({ kind: "text", summary: truncate(text, 160), detail: text }));
          } else if (block?.type === "tool_use" && typeof block.id === "string" && typeof block.name === "string") {
            this.pending.set(block.id, { name: block.name, input: block.input });
          }
        }
      }
      return out;
    }

    if (m.type === "user") {
      const content = m.message?.content;
      if (Array.isArray(content)) {
        for (const block of content as Array<Record<string, unknown>>) {
          if (block?.type === "tool_result" && typeof block.tool_use_id === "string") {
            out.push(this.forToolResult(block.tool_use_id, block, guardDecisions));
          }
        }
      }
      return out;
    }

    // "system"/"result" messages carry no per-call activity of their own here:
    // session id comes through RunObserver.onSession, and the run-level
    // "result" activity is emitted once per RUN by runtime.ts (via .result()
    // above), not once per query() call (a nudge makes a second call).
    return out;
  }

  private forToolResult(toolUseId: string, block: Record<string, unknown>, guardDecisions: GuardDecisionLog): ActivityItem {
    const pending = this.pending.get(toolUseId);
    this.pending.delete(toolUseId);
    const name = pending?.name ?? "unknown_tool";
    const input = pending?.input;
    const isError = Boolean(block.is_error);
    const resultText = extractResultText(block.content);
    const decision = guardDecisions.get(toolUseId);
    const agentId = decision?.agentId;
    const tool = { name, useId: toolUseId, input, isError };

    if (decision?.decision === "deny") {
      return this.push({
        kind: "denial",
        summary: truncate(decision.reason ?? `${name} was denied.`, 200),
        detail: decision.reason,
        tool,
        agentId,
      });
    }

    return this.forAllowedTool(name, input, isError, resultText, tool, agentId);
  }

  private forAllowedTool(
    name: string,
    input: unknown,
    isError: boolean,
    resultText: string,
    tool: ActivityItem["tool"],
    agentId: string | undefined,
  ): ActivityItem {
    const i = (input ?? {}) as Record<string, unknown>;

    if (name.startsWith(WORK_TOOL_PREFIX)) {
      const workTool = name.slice(WORK_TOOL_PREFIX.length);
      switch (workTool) {
        case "publish_asset": {
          if (isError) return this.push({ kind: "tool", summary: `Publish failed: ${truncate(resultText, 160)}`, detail: resultText, tool, agentId });
          const m = /^Published (\S+) v(\S+) at /.exec(resultText);
          const slot = m?.[1] ?? String(i.slot ?? "?");
          const version = m?.[2] ?? "?";
          const kind = typeof i.kind === "string" ? i.kind : "?";
          return this.push({ kind: "publish", summary: `Published ${slot} v${version} (${kind})`, detail: resultText, tool, agentId });
        }
        case "raise_question": {
          const blocking = i.blocking === true;
          const question = typeof i.question === "string" ? i.question : "";
          const label = blocking ? "a blocking question" : "a question";
          return this.push({ kind: "question", summary: `Asked ${label}: ${truncate(question, 140)}`, detail: resultText, tool, agentId });
        }
        case "submit_outputs":
          return this.push({ kind: "submit", summary: isError ? `Submit rejected: ${truncate(resultText, 160)}` : "Submitted outputs", detail: resultText, tool, agentId });
        case "report_progress": {
          const status = typeof i.status === "string" ? i.status : "";
          return this.push({ kind: "progress", summary: `Progress: ${truncate(status, 160)}`, detail: resultText, tool, agentId });
        }
        case "append_worklog":
          return this.push({ kind: "tool", summary: "Appended a worklog entry", detail: resultText, tool, agentId });
        case "get_brief":
          return this.push({ kind: "tool", summary: "Re-read the brief", tool, agentId });
        default:
          return this.push({ kind: "tool", summary: `Called ${name}`, detail: resultText, tool, agentId });
      }
    }

    switch (name) {
      case "Read":
        return this.push({ kind: "tool", summary: `Read ${this.describePath(i.file_path as string | undefined)}`, tool, agentId });
      case "Write":
        return this.push({ kind: "tool", summary: `Wrote ${this.describePath(i.file_path as string | undefined)}`, tool, agentId });
      case "Edit":
        return this.push({ kind: "tool", summary: `Edited ${this.describePath(i.file_path as string | undefined)}`, tool, agentId });
      case "Glob":
        return this.push({ kind: "tool", summary: `Searched files: ${String(i.pattern ?? "")}`, tool, agentId });
      case "Grep":
        return this.push({ kind: "tool", summary: `Searched file contents: ${String(i.pattern ?? "")}`, tool, agentId });
      case "Skill":
        return this.push({ kind: "tool", summary: `Invoked skill: ${String(i.skill ?? "")}`, tool, agentId });
      case "Task":
        return this.push({ kind: "tool", summary: `Delegated to a subagent${i.description ? `: ${truncate(String(i.description), 100)}` : ""}`, tool, agentId });
      default:
        return this.push({
          kind: "tool",
          summary: isError ? `${name} failed` : `Called ${name}`,
          detail: resultText || undefined,
          tool,
          agentId,
        });
    }
  }
}

export type { ActivityKind };
