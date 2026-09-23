// Package entry (I1-PLAN §6 W1). The SDK is accessed only through sdk.ts
// (CLAUDE.md rule 4); nothing else in the repo may import
// @anthropic-ai/claude-agent-sdk directly.

export const AGENTS_PACKAGE = "@workbench/agents";

export { createSdkRuntime, type RuntimeConfig, type RuntimeDeps } from "./runtime.js";
export { runOnce, CostCapExceededError, WORK_AGENT_TOOLS, WORK_AGENT_ALLOWED_TOOLS, type RunOnceArgs, type RunOnceResult } from "./sdk.js";
export { decideForWorkAgent, forWorkAgent, type GuardScope, type GuardDecision, type GuardDecisionLog, type WorkAgentGuards } from "./guards.js";
export { createWorkToolset, type WorkToolset, type WorkToolsetTracker } from "./workToolset.js";
export { ActivityBuilder, type ActivityContext } from "./activity.js";
export {
  commonVars,
  promptHash,
  renderRunPrompt,
  renderSystemPrompt,
  resolvePlacement,
  type PromptPlacement,
} from "./prompts.js";
export { readDevCostTotal, checkDevCostGuard, recordDevCost, type DevCostLedgerEntry } from "./cost-ledger.js";
export { createFakeRuntime, defaultFakeScriptsDir, type FakeRuntimeOptions } from "./fake/index.js";
export { FakeItemScript, FakeStep, loadFakeScript } from "./fake/scripts.js";
