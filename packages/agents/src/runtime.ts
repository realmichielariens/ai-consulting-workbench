// createSdkRuntime(): the "real" AgentRuntime (ARCHITECTURE.md §8.2, ports.ts).
// One executeRun() per startRun() call orchestrates a run's query() call(s):
// the initial call for the run's reason, then — if the engine's termination
// rule (termination.ts) says so — exactly one nudge resume of the SAME
// session. Guards, the work toolset and the ActivityBuilder are created ONCE
// per run and reused across both calls, so tool-use/tool-result pairing and
// the activity idx counter stay correct across the nudge.

import {
  decideRunTermination,
  type AgentRuntime,
  type ItemDef,
  type RunHandle,
  type RunResult,
  type StartRunRequest,
} from "@workbench/core";
import { sdkEnv, type WorkspacePaths } from "@workbench/core/node";
import { ActivityBuilder } from "./activity.js";
import { forWorkAgent, type GuardScope } from "./guards.js";
import { promptHash, renderRunPrompt, renderSystemPrompt, resolvePlacement } from "./prompts.js";
import { CostCapExceededError, runOnce, WORK_AGENT_ALLOWED_TOOLS, WORK_AGENT_TOOLS, type RunOnceArgs, type RunOnceResult } from "./sdk.js";
import { createWorkToolset } from "./workToolset.js";

/** Injectable so runtime.test.ts can drive the nudge/termination loop with a scripted query(), with no SDK calls. */
export type RunOnceFn = (args: RunOnceArgs) => Promise<RunOnceResult>;

export interface RuntimeConfig {
  /** Absolute path to packages/agents/prompts (config.resolved.promptsDir). */
  promptsDir: string;
  /** Absolute path to the workbench-skills plugin dir (config.resolved.skillsPlugin). */
  skillsPluginPath: string;
  /** config.dev.totalCapUsd — the dev cost guard's cap. */
  devCapUsd: number;
  /** Repo root, for sdkEnv()'s API-key resolution (env.ts). */
  repoRoot: string;
}

function summaryOf(item: Pick<ItemDef, "id" | "title">): { id: string; title: string } {
  return { id: item.id, title: item.title };
}

/** Every run.skills entry is invoked as "workbench-skills:<name>" (M0-FINDINGS §2). */
function skillIds(item: ItemDef, placement: "A" | "B"): string[] {
  const names = placement === "B" ? [...item.skills, "workbench-protocol"] : item.skills;
  return names.map((s) => `workbench-skills:${s}`);
}

export interface RuntimeDeps {
  runOnce: RunOnceFn;
  /** Builds the child env for one query() call. Lazy so a mocked runOnceFn (tests) never needs a resolvable API key. */
  buildEnv: () => NodeJS.ProcessEnv;
}

async function executeRun(
  req: StartRunRequest,
  config: RuntimeConfig,
  workspace: WorkspacePaths,
  abortController: AbortController,
  interruptState: { interrupted: boolean },
  deps: RuntimeDeps,
): Promise<RunResult> {
  const { item, paths, workPort, observer, model, maxTurns } = req;
  const workDir = paths.itemWork(item.id);

  const activity = new ActivityBuilder({ itemId: item.id, engagementRoot: paths.root, workDir });
  const scope: GuardScope = {
    itemId: item.id,
    workDir,
    engagementRoot: paths.root,
    skillsPluginDir: config.skillsPluginPath,
  };
  const guards = forWorkAgent(scope, { onRead: (absPath, agentId) => observer.onRead(absPath, agentId) });
  const { server: workServer, tracker } = createWorkToolset(workPort);

  const placement = resolvePlacement();
  const brief = await workPort.getBrief();
  const systemPrompt = renderSystemPrompt(config.promptsDir, summaryOf(item), brief, paths.root, placement);

  const briefForStart = req.input.reason === "start" ? brief : null;
  const runPrompt = renderRunPrompt(config.promptsDir, summaryOf(item), briefForStart, paths.root, req.input);
  const hash = promptHash(systemPrompt, runPrompt);

  const skills = skillIds(item, placement);

  let sessionId: string | null = req.resumeSessionId;
  let currentPrompt = runPrompt;
  // Only the very first call of a resumed run needs `resume`; the same is true again after a nudge.
  let resumeThisCall = req.reason !== "start";

  let totalCost = 0;
  let totalTurns = 0;
  let nudged = false;
  let nudgesUsed = 0;
  let lastMessageText = "";
  let outcome: RunResult["outcome"] = "error";
  let error: string | null = null;

  const resumeNote = req.reason === "resume" && req.input.reason === "resume" ? req.input.note : null;
  observer.onActivity(
    activity.system(resumeNote ? `Resumed (${resumeNote}, ${model})` : `Started (${req.reason}, ${model})`),
  );

  try {
    for (;;) {
      let result;
      try {
        result = await deps.runOnce({
          runId: req.runId,
          itemId: item.id,
          prompt: currentPrompt,
          resume: resumeThisCall ? (sessionId ?? undefined) : undefined,
          model,
          cwd: workDir,
          additionalDirectories: [paths.root],
          systemPrompt,
          tools: WORK_AGENT_TOOLS,
          allowedTools: WORK_AGENT_ALLOWED_TOOLS,
          skillsPluginPath: config.skillsPluginPath,
          skills,
          mcpServers: { work: workServer },
          hooks: guards.hooks,
          maxTurns,
          env: deps.buildEnv(),
          abortController,
          runStreamPath: paths.runStream(req.runId),
          onMessage: (message) => {
            if (message.type === "system" && message.subtype === "init") {
              observer.onSession(message.session_id);
            }
            for (const activityItem of activity.fromSdkMessage(message, guards.decisions)) observer.onActivity(activityItem);
          },
          onPid: (pid) => observer.onPid(pid),
          workspace,
          devCapUsd: config.devCapUsd,
        });
      } catch (err) {
        if (err instanceof CostCapExceededError) {
          outcome = "error";
          error = err.message;
          observer.onActivity(activity.error(err.message));
          break;
        }
        throw err;
      }

      totalCost += result.costUsd;
      totalTurns += result.turns;
      if (result.lastMessageText) lastMessageText = result.lastMessageText;
      sessionId = result.sessionId ?? sessionId;

      const decision = decideRunTermination({
        interrupted: interruptState.interrupted,
        resultSubtype: result.subtype,
        isError: result.isError,
        submitted: tracker.submitted,
        openBlockingQuestion: tracker.openBlockingQuestion,
        nudgesUsed,
      });

      if (decision.action === "nudge") {
        nudged = true;
        nudgesUsed += 1;
        observer.onActivity(activity.nudge());
        currentPrompt = decision.message;
        resumeThisCall = true;
        continue;
      }

      outcome = decision.outcome;
      break;
    }
  } catch (err) {
    outcome = "error";
    error = err instanceof Error ? err.message : String(err);
    observer.onActivity(activity.error(error));
  }

  observer.onActivity(activity.result(outcome, totalTurns, totalCost));

  return {
    outcome,
    sessionId,
    costUsd: totalCost,
    turns: totalTurns,
    model,
    promptHash: hash,
    nudged,
    denials: guards.denialCount(),
    lastMessage: lastMessageText,
    error,
  };
}

/** `deps` defaults to the real sdk.ts#runOnce and sdkEnv(); runtime.test.ts injects a scripted stand-in for both. */
export function createSdkRuntime(
  config: RuntimeConfig,
  workspace: WorkspacePaths,
  deps: Partial<RuntimeDeps> = {},
): AgentRuntime {
  const resolvedDeps: RuntimeDeps = {
    runOnce: deps.runOnce ?? runOnce,
    buildEnv: deps.buildEnv ?? (() => sdkEnv(config.repoRoot, workspace)),
  };
  return {
    kind: "real",
    startRun(req: StartRunRequest): RunHandle {
      const abortController = new AbortController();
      const interruptState = { interrupted: false };

      const done = executeRun(req, config, workspace, abortController, interruptState, resolvedDeps).catch(
        (err): RunResult => ({
          outcome: "error",
          sessionId: null,
          costUsd: 0,
          turns: 0,
          model: req.model,
          promptHash: null,
          nudged: false,
          denials: 0,
          lastMessage: "",
          error: err instanceof Error ? err.message : String(err),
        }),
      );

      return {
        runId: req.runId,
        interrupt: async () => {
          interruptState.interrupted = true;
          abortController.abort();
        },
        done,
      };
    },
  };
}
