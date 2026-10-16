// Package entry (I1-PLAN §6 W1). The SDK is accessed only through sdk.ts
// (CLAUDE.md rule 4); nothing else in the repo may import
// @anthropic-ai/claude-agent-sdk directly.

export const AGENTS_PACKAGE = "@workbench/agents";

export { createSdkRuntime, type RuntimeConfig, type RuntimeDeps } from "./runtime.js";
export {
  runOnce,
  probeMcpServer,
  type ProbeMcpServerArgs,
  type ProbeMcpServerResult,
  WORK_AGENT_TOOLS,
  WORK_AGENT_ALLOWED_TOOLS,
  APPROACH_AGENT_TOOLS,
  APPROACH_AGENT_ALLOWED_TOOLS,
  type RunOnceArgs,
  type RunOnceResult,
} from "./sdk.js";
export {
  decideForWorkAgent,
  forWorkAgent,
  type GuardScope,
  type GuardDecision,
  type GuardDecisionLog,
  type WorkAgentGuards,
  decideForApproachAgent,
  forApproachAgent,
  type ApproachGuardScope,
  type ApproachAgentGuards,
  type ForApproachAgentOptions,
} from "./guards.js";
export { createWorkToolset, type WorkToolset, type WorkToolsetTracker } from "./workToolset.js";
export { createPlanToolset, type PlanToolset, type PlanToolsetTracker } from "./planToolset.js";
export { ActivityBuilder, type ActivityContext } from "./activity.js";
export {
  loadSourceCatalog,
  loadSourceDataset,
  renderSourceCatalog,
  writeSourceListing,
  type CatalogSource,
  type LoadSourceCatalogOptions,
  type SourceCatalog,
} from "./sourceCatalog.js";
export {
  externalServerConfig,
  resolveSources,
  wrapStdioCommand,
  type ResolvedSources,
  type ResolveSourcesOptions,
  type SourceToolMap,
} from "./sourceResolver.js";
export { testSourceConnection, type ProbeFn, type TestSourceConnectionFn, type TestSourceConnectionOptions } from "./sourceTest.js";
export { loadSkillCatalog, type SkillInfo } from "./skillCatalog.js";
export {
  commonVars,
  promptHash,
  renderRunPrompt,
  renderSystemPrompt,
  resolvePlacement,
  renderApproachSystemPrompt,
  renderApproachTurnPrompt,
  renderApproachQuestionPrompt,
  renderApproachSuggestionPrompt,
  type PromptPlacement,
} from "./prompts.js";
export { createFakeRuntime, defaultFakeScriptsDir, type FakeRuntimeOptions } from "./fake/index.js";
export { FakeItemScript, FakeStep, loadFakeScript } from "./fake/scripts.js";
export { createSdkApproachRuntime } from "./approachRuntime.js";
export {
  createFakeApproachRuntime,
  defaultApproachFakeScriptsDir,
  type FakeApproachRuntimeOptions,
  ApproachStep,
  ConversationScript,
  QuestionScript,
  QuestionTurnStep,
  SuggestionScript,
  loadConversationScript,
  loadQuestionScript,
  loadSuggestionScript,
} from "./fake/index.js";
