# S0 — Smoke test and environment

**Verdict:** PARTIAL (blocked on account credit balance for the "real successful run" criterion; every other check that doesn't need a completed model turn passes with evidence, and one significant, actionable surprise was found) **Cost:** $0.00 (billing pre-flight rejected every call before any tokens were billed) **Runs:** 9 total across iteration (the final `run.ts` does 6 per invocation) **SDK:** 0.3.280 **Model:** claude-haiku-4-5

## Hypothesis

The SDK runs on Windows with Node 26 and Haiku, with an isolated configuration (`settingSources: []` keeps personal `~/.claude` config out of the session).

## Setup (what was built; how to re-run)

- `spike/package.json` (SDK pinned `0.3.280`, `zod ^4.0.0` per the SDK's peer dependency, `tsx`/`typescript`/`@types/node`), `spike/tsconfig.json` (ES2022/NodeNext, strict, noEmit), `spike/.env.example`.
- `spike/src/lib/{env,run,paths,fixture,canary,snapshot,report}.ts` — the shared harness. `paths.ts` has 26 unit tests (`npm test`, all passing).
- `spike/fixtures/plugin/workbench-skills/` — the marker-skills plugin for S1 (`.claude-plugin/plugin.json`, `skills/{alpha,beta,gamma}/SKILL.md`, `skills/gamma/scripts/token.mjs`).
- `spike/fixtures/engagement-template/` — source content for `createEngagementFixture()` (S2–S7).
- `spike/experiments/s00-smoke/run.ts` — this experiment.

Re-run with:
```sh
cd spike
npm install
npm test          # harness unit tests
npm run typecheck
npx tsx experiments/s00-smoke/run.ts
```

The API key is resolved by `src/lib/env.ts` from (1) `process.env`, (2) `spike/.env`, (3) on Windows, `HKCU\Environment` via `reg query`. In this environment it resolved from **(3) the registry** (`config.keySource === "registry"`) — no `spike/.env` exists yet, confirming the plan's prediction that the key is only in the user registry.

## Results

| Check | Result | Evidence (file:line / command output) |
|---|---|---|
| A one-turn `query()` call completes and returns a result message | PASS (structurally) | `results/raw/s00-smoke/baseline-*.jsonl`: a `system/init` and a `result` message are always emitted, in every run |
| The run reports a nonzero cost | **FAIL — blocked** | `total_cost_usd: 0` on every run; `result.result` = `"Credit balance is too low"`. See "Blocker" below. |
| `init.apiKeySource` shows the API key, not the user's subscription | **PASS** | `results/s00-smoke/summary.json` → `apiKeySource-is-ANTHROPIC_API_KEY`: `init.apiKeySource="ANTHROPIC_API_KEY"`. Also: stderr on every run prints `"claude.ai connectors are disabled because ANTHROPIC_API_KEY or another auth source is set and takes precedence over your claude.ai login"` — independent confirmation the CLI is not using this machine's claude.ai/OAuth session. |
| No *user-personal* (`~/.claude`) MCP servers leak in | **PASS** | `init.mcp_servers=[]`; the user's own `~/.claude.json` has `mcpServers: {}` (checked read-only). |
| No *user-personal* skills leak in | **PASS** (see Surprises for a different, non-personal leak) | `init.skills` contains none of the user's own skill names (`docs, docx, import-memory, mba-episode-debrief, mba-spiral-prep, morning, pdf, pptx, skill-creator, xlsx`, read from `~/.claude/skills/synced/...`). It is **not empty**, though — see Surprises. |
| No *user-personal* plugins/hooks leak in | **PASS** (personal) / see Surprises | User `~/.claude/settings.json` has `hooks: {}` and no `enabledPlugins`/`plugins` key. `init.plugins` is not empty, but neither entry traces to the user's personal config (both are `"path":"builtin"`) — see Surprises. |
| `init` carries `claude_code_version`, `cwd`, `session_id`, `model`, `permissionMode` | PASS | `claude_code_version=2.1.280`, `cwd=C:\Users\michi\dev\ai-project\spike`, `model=claude-haiku-4-5`, `permissionMode=default` |
| Which binary the SDK spawns (bundled vs. global) | PASS (by code inspection) | Both the global `claude` (`claude --version` → `2.1.280`) and the bundled binary report the same version, so `claude_code_version` alone can't distinguish them. `node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs` shows: when `pathToClaudeCodeExecutable` is omitted, the SDK resolves the executable path relative to `import.meta.url` (i.e. inside its own package directory) — it never touches `PATH`. We never set `pathToClaudeCodeExecutable`, so **the bundled binary is what ran**. |
| Git Bash / a shell for the `Bash` tool is present | PARTIAL | `init.tools` includes `"Bash"` in every run (structural pass). Actually invoking it (`echo $SHELL`) is blocked by the billing error before the model can call it — unconfirmed, not failed. Re-run once credits exist. |
| Default transcript location | PASS | `results/s00-smoke/summary.json` → `default-transcript-under-user-claude-projects`: found at `C:\Users\michi\.claude\projects\C--Users-michi-dev-ai-project-spike\<session_id>.jsonl` |
| `CLAUDE_CONFIG_DIR` redirect (via `options.env`) | **PASS** | Passing `env: childEnv({ CLAUDE_CONFIG_DIR: '<spike>/results/raw/claude-config' })` puts the transcript at `.../results/raw/claude-config/projects/C--Users-michi-dev-ai-project-spike/<session_id>.jsonl` and **nothing** lands under `~/.claude/projects` for that session (`inDefaultDir=[]`). `init` stays equally clean under the redirect. |
| No API key in any transcript | PASS | `grep -rl "sk-ant-" spike/results` → no matches (exit 1) |
| Total spend stayed under the $0.20 cap | PASS | `$0.00` (billing blocked before any token spend) |

## Blocker: the API key has no credit balance

Every one of the 9 runs across this script's iterations returned:

```json
{"type":"result","subtype":"success","is_error":true,"total_cost_usd":0,"result":"Credit balance is too low", ...}
```

with `message.model: "<synthetic>"` and `usage` all-zero — the CLI's own pre-flight billing check rejects the request **before calling the model**, so this happens deterministically and costs nothing. This is **not a bug in the harness, the SDK, or the key-resolution logic**: the key resolves correctly (`apiKeySource=ANTHROPIC_API_KEY`, confirmed by the stderr warning that claude.ai OAuth is being overridden), and the CLI/SDK plumbing works end-to-end up to the model call. It is an account-level fact: **the Anthropic Console account behind the key currently in `HKCU\Environment` has no credit balance.**

**This needs you:** add credits at console.anthropic.com for that key (or point `spike/.env`'s `ANTHROPIC_API_KEY` at a funded key), then re-run `npx tsx experiments/s00-smoke/run.ts`. Until then, S1–S9 cannot produce real evidence either — they all depend on the same key. Everything in this FINDINGS file that does *not* require a successful model turn (auth source, config isolation, transcript location, tool-surface shape) was still validated for real, since `init` is emitted before the billing check fires.

## Exact working configuration (copy-pasteable snippets, rule syntax, option shapes)

**Key resolution order** (`src/lib/env.ts`): `process.env.ANTHROPIC_API_KEY` → `spike/.env` (`KEY=value`, no interpolation) → Windows `HKCU\Environment` via `execFileSync("reg", ["query", "HKCU\\Environment", "/v", "ANTHROPIC_API_KEY"])`, parsed with `/ANTHROPIC_API_KEY\s+REG_(?:SZ|EXPAND_SZ)\s+(\S.*)$/m`. Observed source here: `"registry"`.

**CLAUDE_CONFIG_DIR redirect** (now the harness default — see `src/lib/env.ts` `childEnv()`):
```ts
options: {
  settingSources: [],
  env: childEnv({ CLAUDE_CONFIG_DIR: path.join(rawDir, "claude-config") }),
}
```
`childEnv()` now sets `CLAUDE_CONFIG_DIR` to `spike/results/raw/claude-config` by default for every experiment; pass `childEnv({ CLAUDE_CONFIG_DIR: undefined })` to opt out and test the true default location.

**Narrowing the default tool surface** (see Surprises — important for every later experiment and for the real Work Agent runtime):
```ts
options: {
  tools: ["Read", "Write", "Edit", "Glob", "Grep", "Skill"], // an explicit array — NOT the 'claude_code' preset
}
```
confirmed to produce exactly `init.tools = ["Edit","Glob","Grep","Read","Skill","Write"]`, with none of the extra tools below.

**Parent-session env vars stripped before spawning the child** (`childEnv()` in `src/lib/env.ts`, confirmed by its own stderr log on every run):
```
CLAUDECODE, CLAUDE_AGENT_SDK_VERSION, CLAUDE_CODE_CHILD_SESSION,
CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING, CLAUDE_CODE_ENABLE_TASKS,
CLAUDE_CODE_ENTRYPOINT, CLAUDE_CODE_EXECPATH, CLAUDE_CODE_MESSAGING_SOCKET,
CLAUDE_CODE_MESSAGING_TOKEN, CLAUDE_CODE_SESSION_ATTENDED, CLAUDE_CODE_SESSION_ID
```
(everything starting with `CLAUDE_CODE_` or `CLAUDE_AGENT_SDK_`, plus `CLAUDECODE`, `ANTHROPIC_AUTH_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN` — the last two were simply not present in this session's env, so they didn't show up in the removed list.) This matters because the SCAFFOLD agent that produced this file is *itself* a Claude Code session, so without stripping these, a spawned child could in principle pick up this session's own messaging/session identity instead of starting clean.

## Surprises and deviations from ARCHITECTURE.md

**The single biggest finding of S0: the SDK's default tool/skill/plugin/agent surface, on this machine and this account, is far broader than "vanilla Claude Code" — and `settingSources: []` does *not* suppress it.**

With `settingSources: []` and no `plugins`/`skills`/`tools`/`agents` options passed at all, `init` showed:

- `tools` (31 entries) — alongside the expected `Read/Write/Edit/Glob/Grep/Bash/NotebookEdit/Skill/WebFetch/WebSearch/Task`, it also included `CronCreate`, `CronDelete`, `CronList`, `DesignSync`, `EnterWorktree`, `ExitWorktree`, `ListAgents`, `Monitor`, `PowerShell`, `PushNotification`, `ReportFindings`, `ScheduleWakeup`, `SendMessage`, `TaskCreate`, `TaskGet`, `TaskList`, `TaskStop`, `TaskUpdate`, `ToolSearch`, `Workflow`.
- `agents`: `["claude", "Explore", "general-purpose", "Plan", "statusline-setup"]` — predefined subagent types, none of which we configured.
- `plugins`: two **builtin** plugins (`agents-md`, `telemetry`) — not from `~/.claude`, not from anything we passed.
- `slash_commands` / `skills`: ~50 entries (`dataviz`, `security-review`, `claude-api`, `code-review`, `simplify`, `run`, `init`, `skill-doctor`, …) — again, none configured by us and none of the *user's own* skills.

None of this traces to the user's personal `~/.claude/settings.json` (empty `hooks`, no `plugins`/`enabledPlugins` key) or `~/.claude/skills` (only Anthropic's bundled `docs/docx/pdf/pptx/xlsx/...`, none of which appear). It is baked into **this particular bundled Claude Code 2.1.280 build** as its intrinsic default tool/agent/skill/plugin registry, independent of `settingSources`, of the `plugins`/`skills`/`agents` options, and — critically — independent of the documented `tools: {type:'preset', preset:'claude_code'}` "use all default Claude Code tools" preset, which we tested explicitly and it **did not** narrow the list (`tools-preset-claude_code-narrows-default-surface` → FAIL in `summary.json`, same 31 tools came back).

**The fix, confirmed working:** pass `tools` as an **explicit array**, not the preset and not by omission:
```ts
tools: ["Read", "Write", "Edit", "Glob", "Grep", "Skill"]
```
This produced exactly `init.tools = ["Edit","Glob","Grep","Read","Skill","Write"]` — nothing extra (`tools-explicit-array-narrows-default-surface` → PASS). `node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs` confirms why: when `tools` is omitted, no `--tools` flag is passed to the CLI at all (it falls through to the binary's own default registry); when it's an array, `--tools <comma-list>` is passed and the CLI restricts to exactly that set — the `'preset'` object form maps to `--tools default`, which is evidently that same broad built-in registry on this build, not a "vanilla" one.

**Why this matters for ARCHITECTURE.md §8.2**: the planned Work Agent `allowedTools`/`disallowedTools` config (auto-approval and removal by name) is a different, weaker lever than the `tools` base-set option. Relying on `settingSources: []` plus `allowedTools` alone, as currently sketched, would still surface `Task`, `SendMessage`, `Workflow`, `ToolSearch`, and similar tools in the model's own tool listing (even if `disallowedTools` later blocks calling them) — and worse, several of these look explicitly designed for multi-agent/scheduling side effects (`CronCreate`, `ScheduleWakeup`, `SendMessage`, `TaskCreate`) that have no place in a scoped, single-purpose Work Agent run. **Recommendation:** the real runtime should always pass an explicit `tools` array as the base set (not the `'preset'` form, not omission), in addition to the existing `allowedTools`/`disallowedTools` scoping.

Other, smaller deviations:
- The CLI emits a `permission_mode: "default"` when no `permissionMode` is passed (not an error, just worth noting since ARCHITECTURE.md's Work Agent config always sets `"dontAsk"` explicitly — confirmed that omission does *not* implicitly mean `dontAsk`).
- `init` carries several fields ARCHITECTURE.md doesn't mention that are worth knowing about for later experiments: `capabilities` (feature flags like `interrupt_receipt_v1`), `memory_paths.auto`, `messaging_socket_path` (a Windows named pipe — presumably for the same Task/SendMessage/Monitor tool family above), `fast_mode_state`/`fast_mode_disabled_reason`, `powershell_path`.
- `SDKResultMessage` can have `subtype: "success"` **and** `is_error: true` at the same time (the billing-block case): `result.result` then carries the error text, not real assistant output, and `message.model` on the one synthetic assistant message is the literal string `"<synthetic>"` with all-zero usage. `run.ts`'s `isError` computation (`Boolean(lastResult?.is_error)`) already accounts for this; a consumer that only checks `subtype === "success"` would be fooled.

## Recommendation (what to change in ARCHITECTURE.md, if anything)

1. §8.2's Work Agent `query()` options block should add an explicit `tools: [...]` base-set array (not just `allowedTools`/`disallowedTools`), to guarantee the model never even sees the extra FleetView-style tools this build ships with by default. Until S1–S9 confirm the full list a Work Agent actually needs, a safe starting allowlist based on what's used elsewhere in §8.2/§8.6 is: `["Read", "Edit", "Write", "Glob", "Grep", "Skill", "Agent", "NotebookEdit"]` plus `"Bash"` when `needsBash(item)`.
2. §15 ("Local and Windows Considerations") should note that `settingSources: []` isolates *filesystem* settings (`user`/`project`/`local`) but not the CLI binary's own built-in tool/agent/plugin registry — that needs the `tools` option.
3. Once S0 is re-run with a funded key, update this section with real cost/turn/latency numbers for a trivial Haiku call (currently unmeasured — see Open questions).

## Fallback status (tested? works?)

Not applicable — S0 has no fallback in the plan; its job is to surface blockers, and it found two (credit balance; default tool surface breadth), both actionable.

## Harness change requests

None from other agents (this is Phase 0b). One change made to the shared harness while running S0, documented for the other subagents:

- `src/lib/env.ts` `childEnv()` now sets `CLAUDE_CONFIG_DIR` to `spike/results/raw/claude-config` **by default** for every experiment (confirmed safe and working here). Call `childEnv({ CLAUDE_CONFIG_DIR: <other-or-undefined> })` to override or opt out.

## Open questions

1. **Real cost/turn/latency numbers are still unmeasured.** Once credits are added, re-run S0 and record: `total_cost_usd`, `usage` (input/output/cache tokens), `duration_ms`, `num_turns` for a trivial one-line Haiku reply. All downstream experiments' cost caps assume Haiku is cheap (~$0.01–0.05 for S0); that assumption is unverified.
2. **Git Bash detection is unconfirmed** (`git-bash-detected` → `partial`). Needs a real `Bash` tool call once credits exist; `Bash` is present in `init.tools`, which is necessary but not sufficient.
3. **Is the extra tool/agent/plugin surface specific to this machine/account, or does every install of `@anthropic-ai/claude-agent-sdk@0.3.280` ship it?** If it's universal, it belongs in ARCHITECTURE.md as a hard requirement (always pass explicit `tools`). If it's specific to this account/environment (e.g. an org-level entitlement or a preview build), the real deployment target may not need the extra `tools` restriction — but restricting anyway costs nothing and is strictly safer, so the recommendation stands either way.
4. Should the harness retry a `"Credit balance is too low"` result the way it retries 429/529? Currently it does not (by design — it's not a transient condition), but if the M0 spike spans a credit top-up mid-run, later experiments should double check they're not silently eating the same $0 failure repeatedly instead of surfacing it.
