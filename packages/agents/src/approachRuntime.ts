// createSdkApproachRuntime(): the "real" ApproachRuntime (ports.ts, I2-PLAN
// §4.1). Every conversation turn and every task session is exactly ONE
// query() call — unlike runtime.ts's Work Agent loop, there is no nudge: a
// task session that ends without resolving its request still reports
// "completed" (ApproachRuntime docstring); the server notices the unresolved
// request and escalates it. Guards, the plan toolset and the ActivityBuilder
// are built fresh per call, same shape as runtime.ts's executeRun minus the
// termination loop.

import {
  type ApproachPort,
  type ApproachRuntime,
  type ApproachTaskRequest,
  type ApproachTurnRequest,
  type RunHandle,
  type RunId,
  type RunObserver,
  type RunOutcome,
  type RunResult,
} from "@workbench/core";
import { sdkEnv, type EngagementPaths, type WorkspacePaths } from "@workbench/core/node";
import { ActivityBuilder } from "./activity.js";
import { forApproachAgent, type ApproachGuardScope } from "./guards.js";
import {
  promptHash,
  renderApproachQuestionPrompt,
  renderApproachSuggestionPrompt,
  renderApproachSystemPrompt,
  renderApproachTurnPrompt,
} from "./prompts.js";
import { createPlanToolset } from "./planToolset.js";
import type { RuntimeConfig, RuntimeDeps } from "./runtime.js";
import { APPROACH_AGENT_ALLOWED_TOOLS, APPROACH_AGENT_TOOLS, runOnce, type RunOnceResult } from "./sdk.js";

interface ApproachSessionArgs {
  runId: RunId;
  paths: EngagementPaths;
  port: ApproachPort;
  observer: RunObserver;
  model: string;
  maxTurns: number;
  systemPrompt: string;
  userPrompt: string;
  resume: string | undefined;
  startedSummary: string;
}

/** interrupted takes priority; otherwise "max_turns" for that specific SDK subtype, "error" for any other failure, else "completed". */
function outcomeFromResult(interrupted: boolean, result: RunOnceResult | undefined, thrown: boolean): RunOutcome {
  if (interrupted) return "interrupted";
  if (thrown || !result || result.isError) {
    return result?.subtype === "error_max_turns" ? "max_turns" : "error";
  }
  return "completed";
}

async function executeApproachSession(
  args: ApproachSessionArgs,
  config: RuntimeConfig,
  workspace: WorkspacePaths,
  abortController: AbortController,
  interruptState: { interrupted: boolean },
  deps: RuntimeDeps,
): Promise<RunResult> {
  const { paths, port, observer, model, maxTurns, systemPrompt, userPrompt, resume } = args;
  const workDir = paths.itemWork("ENG");

  const activity = new ActivityBuilder({ itemId: "ENG", engagementRoot: paths.root, workDir });
  const scope: ApproachGuardScope = { workDir, engagementRoot: paths.root };
  const guards = forApproachAgent(scope, { onRead: (absPath, agentId) => observer.onRead(absPath, agentId) });
  const { server: planServer } = createPlanToolset(port);

  const hash = promptHash(systemPrompt, userPrompt);
  observer.onActivity(activity.system(args.startedSummary));

  let result: RunOnceResult | undefined;
  let thrown = false;
  let error: string | null = null;

  try {
    result = await deps.runOnce({
      runId: args.runId,
      itemId: "ENG",
      prompt: userPrompt,
      resume,
      model,
      cwd: workDir,
      additionalDirectories: [paths.root],
      systemPrompt,
      tools: APPROACH_AGENT_TOOLS,
      allowedTools: APPROACH_AGENT_ALLOWED_TOOLS,
      skillsPluginPath: undefined,
      mcpServers: { plan: planServer },
      hooks: guards.hooks,
      maxTurns,
      env: deps.buildEnv(),
      abortController,
      runStreamPath: paths.runStream(args.runId),
      onMessage: (message) => {
        if (message.type === "system" && message.subtype === "init") {
          observer.onSession(message.session_id);
        }
        for (const activityItem of activity.fromSdkMessage(message, guards.decisions)) observer.onActivity(activityItem);
      },
      onPid: (pid) => observer.onPid(pid),
    });
  } catch (err) {
    thrown = true;
    error = err instanceof Error ? err.message : String(err);
    observer.onActivity(activity.error(error));
  }

  const outcome = outcomeFromResult(interruptState.interrupted, result, thrown);
  observer.onActivity(activity.result(outcome, result?.turns ?? 0, result?.costUsd ?? 0));

  return {
    outcome,
    sessionId: result?.sessionId ?? null,
    costUsd: result?.costUsd ?? 0,
    turns: result?.turns ?? 0,
    model,
    promptHash: hash,
    nudged: false,
    denials: guards.denialCount(),
    lastMessage: result?.lastMessageText ?? "",
    error,
  };
}

function errored(model: string, err: unknown): RunResult {
  return {
    outcome: "error",
    sessionId: null,
    costUsd: 0,
    turns: 0,
    model,
    promptHash: null,
    nudged: false,
    denials: 0,
    lastMessage: "",
    error: err instanceof Error ? err.message : String(err),
  };
}

/** approach-question.md / approach-suggestion.md's run prompt, built from the task's request and item. */
function buildTaskPrompt(config: RuntimeConfig, req: ApproachTaskRequest): string {
  const itemVars = { situation: req.situation, itemId: req.item.id, itemTitle: req.item.title, itemBrief: req.item.brief };
  if (req.kind === "question") {
    if (req.request.type !== "question") {
      throw new Error(`approachRuntime: task kind "question" but request.type is "${req.request.type}"`);
    }
    return renderApproachQuestionPrompt(config.promptsDir, {
      ...itemVars,
      question: req.request.payload.question,
      hypothesis: req.request.payload.hypothesis,
      alternatives: req.request.payload.alternatives,
    });
  }
  if (req.request.type !== "proposal") {
    throw new Error(`approachRuntime: task kind "suggestion" but request.type is "${req.request.type}"`);
  }
  return renderApproachSuggestionPrompt(config.promptsDir, {
    ...itemVars,
    summary: req.request.payload.summary,
    suggestedOps: req.request.payload.suggestedOps,
  });
}

/** `deps` defaults to the real sdk.ts#runOnce and sdkEnv(), same shape as createSdkRuntime. */
export function createSdkApproachRuntime(
  config: RuntimeConfig,
  workspace: WorkspacePaths,
  deps: Partial<RuntimeDeps> = {},
): ApproachRuntime {
  const resolvedDeps: RuntimeDeps = {
    runOnce: deps.runOnce ?? runOnce,
    buildEnv: deps.buildEnv ?? (() => sdkEnv(config.repoRoot, workspace)),
  };

  function run(args: ApproachSessionArgs): RunHandle {
    const abortController = new AbortController();
    const interruptState = { interrupted: false };
    const done = executeApproachSession(args, config, workspace, abortController, interruptState, resolvedDeps).catch(
      (err) => errored(args.model, err),
    );
    return {
      runId: args.runId,
      interrupt: async () => {
        interruptState.interrupted = true;
        abortController.abort();
      },
      done,
    };
  }

  return {
    kind: "real",
    startTurn(req: ApproachTurnRequest): RunHandle {
      const systemPrompt = renderApproachSystemPrompt(config.promptsDir, req.engagementId);
      const userPrompt = renderApproachTurnPrompt(req.situation, req.message);
      return run({
        runId: req.runId,
        paths: req.paths,
        port: req.port,
        observer: req.observer,
        model: req.model,
        maxTurns: req.maxTurns,
        systemPrompt,
        userPrompt,
        resume: req.resumeSessionId ?? undefined,
        startedSummary: req.resumeSessionId ? `Resumed (aa-turn, ${req.model})` : `Started (aa-turn, ${req.model})`,
      });
    },
    startTask(req: ApproachTaskRequest): RunHandle {
      const systemPrompt = renderApproachSystemPrompt(config.promptsDir, req.engagementId);
      const userPrompt = buildTaskPrompt(config, req);
      const reason = req.kind === "question" ? "aa-question" : "aa-suggestion";
      return run({
        runId: req.runId,
        paths: req.paths,
        port: req.port,
        observer: req.observer,
        model: req.model,
        maxTurns: req.maxTurns,
        systemPrompt,
        userPrompt,
        resume: undefined, // startTask: always a fresh session
        startedSummary: `Started (${reason}, ${req.model})`,
      });
    },
  };
}
