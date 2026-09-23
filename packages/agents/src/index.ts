// Stub entry. W1 builds the SDK adapter (src/sdk.ts), guards, the work
// toolset, the run lifecycle and the scripted fake agent here. The SDK is
// accessed only through src/sdk.ts (CLAUDE.md rule 4) — nothing else in the
// repo may import @anthropic-ai/claude-agent-sdk directly.

export const AGENTS_PACKAGE = "@workbench/agents";
