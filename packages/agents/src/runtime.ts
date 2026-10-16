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
import { describeModel, runOnce, workAgentToolset, type RunOnceArgs, type RunOnceResult } from "./sdk.js";
import { loadSkillCatalog, unknownSkills } from "./skillCatalog.js";
import { loadSourceCatalog } from "./sourceCatalog.js";
import { resolveSources } from "./sourceResolver.js";
import { createWorkToolset } from "./workToolset.js";

/** Injectable so runtime.test.ts can drive the nudge/termination loop with a scripted query(), with no SDK calls. */
export type RunOnceFn = (args: RunOnceArgs) => Promise<RunOnceResult>;

export interface RuntimeConfig {
  /** Absolute path to packages/agents/prompts (config.resolved.promptsDir). */
  promptsDir: string;
  /** Absolute path to the workbench-skills plugin dir (config.resolved.skillsPlugin). */
  skillsPluginPath: string;
  /** Absolute path to the Source Catalog folder (config.resolved.sourcesCatalog). */
  sourcesCatalogDir: string;
  /** Repo root, for sdkEnv()'s API-key resolution (env.ts). */
  repoRoot: string;
  /** false on a hosted server (docs/DEPLOY-FLY.md): stdio sources are left out of every run. Default true. */
  allowStdioSources?: boolean;
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
  const { item, paths, workPort, observer, model, effort, maxTurns } = req;
  const workDir = paths.itemWork(item.id);

  const skillCatalog = loadSkillCatalog(config.skillsPluginPath);
  const catalog = loadSourceCatalog({ catalogDir: config.sourcesCatalogDir, userDir: workspace.userSourcesDir });
  const sources = resolveSources(catalog, item.sources, { repoRoot: config.repoRoot, allowStdio: config.allowStdioSources ?? true });
  const toolset = workAgentToolset(sources);
  const activity = new ActivityBuilder({ itemId: item.id, engagementRoot: paths.root, workDir, sources: sources.toolMap });
  const scope: GuardScope = {
    itemId: item.id,
    workDir,
    engagementRoot: paths.root,
    skillsPluginDir: config.skillsPluginPath,
    sources: sources.toolMap,
  };
  const guards = forWorkAgent(scope, { onRead: (absPath, agentId) => observer.onRead(absPath, agentId) });
  const { server: workServer, tracker } = createWorkToolset(workPort);

  const placement = resolvePlacement();
  const brief = await workPort.getBrief();
  const basePrompt = renderSystemPrompt(config.promptsDir, summaryOf(item), brief, paths.root, placement);
  // In the system prompt, not the run prompt: the attached sources are part of what this session can do, on resume too.
  const systemPrompt = sources.promptSection ? `${basePrompt}\n\n${sources.promptSection}` : basePrompt;

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
    activity.system(
      resumeNote
        ? `Resumed (${resumeNote}, ${describeModel(model, effort)})`
        : `Started (${req.reason}, ${describeModel(model, effort)})`,
    ),
  );
  if (item.skills.length > 0) observer.onActivity(activity.system(`Skills: ${item.skills.join(", ")}`));
  if (sources.attached.length > 0) {
    observer.onActivity(activity.system(`Sources: ${sources.attached.map((a) => a.source.title).join(", ")}`));
  }
  const missingSkills = unknownSkills(skillCatalog, item.skills);
  if (missingSkills.length > 0) {
    observer.onActivity(activity.system(`Unknown skill${missingSkills.length === 1 ? "" : "s"} ignored: ${missingSkills.join(", ")}`));
  }
  if (sources.unknown.length > 0) {
    observer.onActivity(activity.system(`Source${sources.unknown.length === 1 ? "" : "s"} not in the catalog, ignored: ${sources.unknown.join(", ")}`));
  }
  for (const u of sources.unavailable) {
    observer.onActivity(activity.system(`Source ${u.id} unavailable, left out of this run: ${u.reason}`));
  }

  try {
    for (;;) {
      const result = await deps.runOnce({
        runId: req.runId,
        itemId: item.id,
        prompt: currentPrompt,
        resume: resumeThisCall ? (sessionId ?? undefined) : undefined,
        model,
        effort,
        cwd: workDir,
        additionalDirectories: [paths.root],
        systemPrompt,
        tools: toolset.tools,
        allowedTools: toolset.allowedTools,
        skillsPluginPath: config.skillsPluginPath,
        skills,
        mcpServers: { ...sources.mcpServers, work: workServer },
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
      });

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
