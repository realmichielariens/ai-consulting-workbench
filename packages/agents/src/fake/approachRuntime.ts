// createFakeApproachRuntime(): the scripted fake Approach Agent (ports.ts
// ApproachRuntime, kind "fake"). Drives the SAME ApproachPort as the real
// runtime (createSdkApproachRuntime) and emits the same kinds of
// ActivityItems, from YAML scripts in packages/agents/fake-scripts/approach/
// (approachScripts.ts). Same delay handling as the Work Agent fake
// (fake/runtime.ts): WORKBENCH_FAKE_DELAY_MS=0 makes it instant for tests.

import fs from "node:fs";
import path from "node:path";
import type {
  ActivityItem,
  ApproachPort,
  ApproachRuntime,
  ApproachTaskRequest,
  ApproachTurnRequest,
  RunHandle,
  RunOutcome,
  RunResult,
  ThreadId,
} from "@workbench/core";
import { loadConversationScript, loadQuestionScript, loadSuggestionScript, type ApproachStep } from "./approachScripts.js";

export interface FakeApproachRuntimeOptions {
  /** Absolute path to packages/agents/fake-scripts/approach. Defaults to the sibling of this package's src/. */
  scriptsDir?: string;
  /** ms between steps. Defaults to WORKBENCH_FAKE_DELAY_MS, else 600; pass 0 in tests. */
  delayMs?: number;
}

function sleep(ms: number): Promise<void> {
  return ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));
}

function truncate(text: string, max: number): string {
  const t = text.trim();
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

function resolveDelay(opts: FakeApproachRuntimeOptions): number {
  if (opts.delayMs !== undefined) return opts.delayMs;
  const env = process.env.WORKBENCH_FAKE_DELAY_MS;
  if (env !== undefined) {
    const n = Number(env);
    if (!Number.isNaN(n)) return n;
  }
  return 600;
}

export function defaultApproachFakeScriptsDir(): string {
  return path.resolve(import.meta.dirname, "../../fake-scripts/approach");
}

type Push = (partial: Omit<ActivityItem, "idx" | "at">) => ActivityItem;

function makePusher(onActivity: (item: ActivityItem) => void): Push {
  let idx = 0;
  return (partial) => {
    const item: ActivityItem = { idx: idx++, at: new Date().toISOString(), ...partial };
    onActivity(item);
    return item;
  };
}

/** Runs one ApproachStep against `port` and ENG's work dir; returns the last text it produced, if any. Throws on a failed propose_ops (the caller turns that into outcome "error"). */
async function runApproachStep(step: ApproachStep, push: Push, workDir: string, port: ApproachPort): Promise<string | undefined> {
  if ("text" in step) {
    push({ kind: "text", summary: truncate(step.text, 160), detail: step.text });
    return step.text;
  }
  if ("write" in step) {
    const abs = path.join(workDir, step.write.path);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, step.write.content, "utf8");
    push({ kind: "tool", summary: `Wrote work/${step.write.path}`, tool: { name: "Write", input: { file_path: abs } } });
    return undefined;
  }
  if ("publish" in step) {
    const result = await port.publishEngagementAsset(step.publish);
    push({
      kind: "publish",
      summary: `Published ${result.slot} v${result.version} (${step.publish.kind})`,
      tool: { name: "mcp__plan__publish_engagement_asset", input: step.publish },
    });
    return undefined;
  }
  if ("propose" in step) {
    const result = await port.proposeOps(step.propose);
    if (!result.ok) {
      push({ kind: "error", summary: `propose_ops failed: ${result.errors.join("; ")}`, detail: result.errors.join("\n") });
      throw new Error(`propose_ops failed: ${result.errors.join("; ")}`);
    }
    const opsCount = step.propose.ops.length;
    push({
      kind: "tool",
      summary: `Proposed ${result.proposalId ?? "a proposal"} (${opsCount} operation${opsCount === 1 ? "" : "s"})`,
      detail: result.instruction,
      tool: { name: "mcp__plan__propose_ops", input: step.propose },
    });
    return result.instruction;
  }
  if ("journal" in step) {
    await port.journalAppend({ entry: step.journal });
    push({ kind: "tool", summary: "Appended a journal entry", detail: step.journal, tool: { name: "mcp__plan__journal_append", input: { entry: step.journal } } });
    return undefined;
  }
  if ("notify" in step) {
    await port.notifyHuman({ text: step.notify });
    push({ kind: "tool", summary: `Notified the human: ${truncate(step.notify, 140)}`, tool: { name: "mcp__plan__notify_human", input: { text: step.notify } } });
    return undefined;
  }
  // "status": built live from get_plan, not scripted text — the point is that it reflects the actual plan.
  const digest = await port.getPlan();
  const text = `Here's where things stand:\n\n${digest.text}`;
  push({ kind: "text", summary: truncate(text, 160), detail: text, tool: { name: "mcp__plan__get_plan", input: {} } });
  return text;
}

function resultActivity(push: Push, outcome: RunOutcome, stepCount: number): void {
  push({ kind: "result", summary: `Run ended: ${outcome} — ${stepCount} step${stepCount === 1 ? "" : "s"}, $0.0000`, costUsd: 0 });
}

function finalResult(outcome: RunOutcome, sessionId: string, stepCount: number, lastText: string): RunResult {
  return {
    outcome,
    sessionId,
    costUsd: 0,
    turns: stepCount,
    model: "fake",
    promptHash: null,
    nudged: false,
    denials: 0,
    lastMessage: lastText,
    error: outcome === "error" ? "fake script error" : null,
  };
}

async function runConversationTurn(
  req: ApproachTurnRequest,
  scriptsDir: string,
  delayMs: number,
  kickoffUsed: Map<ThreadId, number>,
  state: { interrupted: boolean },
): Promise<RunResult> {
  const workDir = req.paths.itemWork("ENG");
  const push = makePusher((item) => req.observer.onActivity(item));

  push({ kind: "system", summary: req.resumeSessionId ? "Resumed (aa-turn, fake)" : "Started (aa-turn, fake)" });
  const sessionId = req.resumeSessionId ?? `fake-${req.runId}`;
  req.observer.onSession(sessionId);

  let lastText = "";
  let outcome: RunOutcome = "completed";
  let stepCount = 0;

  try {
    const script = loadConversationScript(scriptsDir);
    const matched = script.matches.find((m) => new RegExp(m.match, "i").test(req.message));
    let steps: ApproachStep[];
    if (matched) {
      steps = matched.steps;
    } else {
      const used = kickoffUsed.get(req.threadId) ?? 0;
      if (used < script.turns.length) {
        steps = script.turns[used]!.steps;
        kickoffUsed.set(req.threadId, used + 1);
      } else {
        steps = script.fallback;
      }
    }

    for (const step of steps) {
      if (state.interrupted) {
        outcome = "interrupted";
        break;
      }
      await sleep(delayMs);
      stepCount++;
      const text = await runApproachStep(step, push, workDir, req.port);
      if (text !== undefined) lastText = text;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    push({ kind: "error", summary: truncate(message, 300), detail: message });
    outcome = "error";
  }

  resultActivity(push, outcome, stepCount);
  return finalResult(outcome, sessionId, stepCount, lastText);
}

async function runTaskSession(req: ApproachTaskRequest, scriptsDir: string, delayMs: number, state: { interrupted: boolean }): Promise<RunResult> {
  const workDir = req.paths.itemWork("ENG");
  const push = makePusher((item) => req.observer.onActivity(item));
  const reason = req.kind === "question" ? "aa-question" : "aa-suggestion";
  push({ kind: "system", summary: `Started (${reason}, fake)` });
  const sessionId = `fake-${req.runId}`;
  req.observer.onSession(sessionId);

  let lastText = "";
  let outcome: RunOutcome = "completed";
  let stepCount = 0;

  try {
    if (req.kind === "question") {
      if (req.request.type !== "question") {
        throw new Error(`fake approach runtime: task kind "question" but request.type is "${req.request.type}"`);
      }
      const requestId = req.request.id;
      const script = loadQuestionScript(scriptsDir);
      const steps = script.byItem[req.item.id] ?? script.default;

      for (const step of steps) {
        if (state.interrupted) {
          outcome = "interrupted";
          break;
        }
        await sleep(delayMs);
        stepCount++;
        if ("answer" in step) {
          const result = await req.port.answerRequest({ requestId, ...step.answer });
          push({ kind: "tool", summary: `Answered ${requestId}`, detail: result.instruction, tool: { name: "mcp__plan__answer_request", input: { requestId, ...step.answer } } });
          lastText = result.instruction;
        } else if ("escalate" in step) {
          const result = await req.port.escalate({ requestId, ...step.escalate });
          push({ kind: "tool", summary: `Escalated ${requestId}`, detail: result.instruction, tool: { name: "mcp__plan__escalate", input: { requestId, ...step.escalate } } });
          lastText = result.instruction;
        } else {
          const text = await runApproachStep(step, push, workDir, req.port);
          if (text !== undefined) lastText = text;
        }
      }
    } else {
      if (req.request.type !== "proposal") {
        throw new Error(`fake approach runtime: task kind "suggestion" but request.type is "${req.request.type}"`);
      }
      const requestId = req.request.id;
      const suggestedOps = req.request.payload.suggestedOps;
      const script = loadSuggestionScript(scriptsDir);
      const leadIn = suggestedOps.length > 0 ? script.propose : script.decline;

      for (const step of leadIn) {
        if (state.interrupted) {
          outcome = "interrupted";
          break;
        }
        await sleep(delayMs);
        stepCount++;
        const text = await runApproachStep(step, push, workDir, req.port);
        if (text !== undefined) lastText = text;
      }

      if (outcome !== "interrupted") {
        await sleep(delayMs);
        stepCount++;
        if (suggestedOps.length > 0) {
          const rationale = `Suggested by ${req.item.id}: ${req.request.payload.summary}`;
          const result = await req.port.proposeOps({ ops: suggestedOps, rationale });
          if (!result.ok) {
            push({ kind: "error", summary: `propose_ops failed: ${result.errors.join("; ")}`, detail: result.errors.join("\n") });
            outcome = "error";
          } else {
            push({
              kind: "tool",
              summary: `Proposed ${result.proposalId ?? "a proposal"} (${suggestedOps.length} operation${suggestedOps.length === 1 ? "" : "s"})`,
              detail: result.instruction,
              tool: { name: "mcp__plan__propose_ops", input: { ops: suggestedOps, rationale } },
            });
            lastText = result.instruction;
          }
        } else {
          const reasonText = `No concrete operations were suggested (${req.request.payload.summary}); nothing to propose right now.`;
          const result = await req.port.declineSuggestion({ requestId, reason: reasonText });
          push({ kind: "tool", summary: `Declined ${requestId}`, detail: result.instruction, tool: { name: "mcp__plan__decline_suggestion", input: { requestId, reason: reasonText } } });
          lastText = result.instruction;
        }
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    push({ kind: "error", summary: truncate(message, 300), detail: message });
    outcome = "error";
  }

  resultActivity(push, outcome, stepCount);
  return finalResult(outcome, sessionId, stepCount, lastText);
}

export function createFakeApproachRuntime(opts: FakeApproachRuntimeOptions = {}): ApproachRuntime {
  const scriptsDir = opts.scriptsDir ?? defaultApproachFakeScriptsDir();
  const delayMs = resolveDelay(opts);
  const kickoffUsed = new Map<ThreadId, number>();

  return {
    kind: "fake",
    startTurn(req: ApproachTurnRequest): RunHandle {
      const state = { interrupted: false };
      const done = runConversationTurn(req, scriptsDir, delayMs, kickoffUsed, state);
      return {
        runId: req.runId,
        interrupt: async () => {
          state.interrupted = true;
        },
        done,
      };
    },
    startTask(req: ApproachTaskRequest): RunHandle {
      const state = { interrupted: false };
      const done = runTaskSession(req, scriptsDir, delayMs, state);
      return {
        runId: req.runId,
        interrupt: async () => {
          state.interrupted = true;
        },
        done,
      };
    },
  };
}
