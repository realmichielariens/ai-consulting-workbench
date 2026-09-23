# M0 Spike — Consolidated Findings

| | |
|---|---|
| **Date** | 2026-09-23 |
| **Decision** | **GO for M1**, with the architecture changes listed in §3 (already applied to ARCHITECTURE.md) |
| **API spend** | **$2.10** of the $10 cap (154 SDK runs, all `claude-haiku-4-5`) |
| **Environment** | Windows 11, Node 26.3.0, Python 3.14.0, `@anthropic-ai/claude-agent-sdk@0.3.280` (bundled Claude Code 2.1.280) |

Per-experiment details and evidence are in `experiments/sNN-*/FINDINGS.md`, with machine-readable results in `results/sNN-*/summary.json`.

## 1. Verdict per assumption (ARCHITECTURE §17)

| # | Assumption | Verdict | Key evidence | Independently re-checked by main |
|---|---|---|---|---|
| S0 | SDK runs on Windows/Node 26 with an isolated config | **PASS** | Auth via `ANTHROPIC_API_KEY` (not the subscription). Bundled binary, Git Bash detected. No personal skills, MCP servers or hooks leak in. `CLAUDE_CONFIG_DIR` redirects transcripts. | Gate review ✔ |
| S1 | Plugin skills, scoped per query | **PASS** | `skills: [...]` is a real invocation allowlist (bundled skills are refused too); `disableBundledSkills` removes them from the listing. A skill's `allowed-tools` cannot grant a session-disallowed tool. | — |
| S2 | Scoped `Edit(...)` write rule on Windows | **PASS** | `Edit(./**)` with cwd = own `work/` gives exactly "own work writable, everything else denied" (hash-verified). `//C:/…` and `/C:/…` silently match nothing. | — |
| S3 | Guard hooks, including in subagents | **PASS**, but the guard is **mandatory** | 0 canary leaks. Hooks fire inside subagents with `agent_id`/`agent_type`; the deny holds; PostToolUse attributes implicit reads. **Without the guard, read-only shell commands and `Read` inside `additionalDirectories` leak other items' work.** | Canary battery re-run ✔ clean; shell-bypass test added by main |
| S4 | Bound in-process MCP toolsets under concurrency | **PASS** | 3 parallel queries × 4 repeats: correct item binding, v1.0→v2.0, zero cross-talk. Zod errors reach the agent, which self-corrects. Unapproved tools are denied before the handler runs. | Parallel binding re-run ✔ |
| S5 | Resume and streaming | **PASS** | Resume from a new process keeps the memory word and continues the draft via `Edit`. Needs the **same `CLAUDE_CONFIG_DIR`**. Streaming multi-message works, `interrupt()` works, fork works. | New-process resume re-run ✔ |
| S6 | Haiku protocol reliability | **DEFERRED to M2** | Not run: the Claude Code session limit was hit, and the user asked to wrap up. Early signals: S4 end-turn obedience 5/5, S4 self-correction on validation errors, S9 skill protocol followed. Haiku refuses tasks it reads as adversarial or social engineering (S3). | — |
| S7 | Parallelism and process hygiene | **DEFERRED to M2** | Not run, same reason. Partial evidence: S4 ran 3 concurrent sessions stably (≈ $0.06 per trio); S5 shows no orphans after a child exits or after `interrupt()`. | — |
| S8 | SQLite driver, FTS5, leases, Git round trip | **PASS** | `better-sqlite3@^13` (N-API prebuilds; v11 fails on Node 26) with Drizzle. Lease race: 200/200 rounds, exactly one winner across 5 processes. The Git round trip works if you checkpoint first and close the DB before checkout. | Full re-run ✔ 18/18 |
| S9 | Document extraction and export | **PASS** | `markitdown` covers PPTX/XLSX/DOCX/PDF on Python 3.14. `python-pptx` export; Markdown→HTML→Edge headless PDF. Agent extraction through a skill works; Bash is limited to the script. | — |

Exit criteria (plan §9):
- **All must-pass items pass** (S0, S2+S3, S4, S5, S8).
- Should-pass: S1 and S9 pass. S6 and S7 are deferred with partial evidence; they move into M2, where the real Work Agent protocol and runtime are built anyway.

## 2. Working configuration (copy into `packages/agents/sdk.ts`)

```ts
const q = query({
  prompt,
  options: {
    model: "claude-haiku-4-5",
    cwd: paths.itemWork(item.id),                       // items/WI-004/work
    additionalDirectories: [paths.engagementRoot],
    settingSources: [],                                  // no ~/.claude
    settings: { disableBundledSkills: true },            // hide CLI-bundled skills
    env: { ...cleanEnv, CLAUDE_CONFIG_DIR: paths.claudeConfigDir },  // pinned per workspace; resume depends on it
    plugins: [{ type: "local", path: paths.skillsPlugin }],
    skills: item.skills.map((s) => `workbench-skills:${s}`),
    tools: ["Read", "Write", "Edit", "Glob", "Grep", "Skill", "Task",   // explicit base set: default is 31 tools
            ...(needsBash(item) ? ["Bash"] : [])],                     // never PowerShell
    allowedTools: ["Read", "Glob", "Grep", "Skill", "Task", "Edit(./**)",
                   "mcp__work__*", "mcp__library__*",
                   ...(needsBash(item) ? item.scripts.map((s) => `Bash(${python} ${s} *)`) : [])],
    mcpServers: { work: workToolset(item.id, runId), library: libraryToolset() },
    permissionMode: "dontAsk",
    hooks: guards.forWorkAgent(item, runId, settings),   // MANDATORY read-scope control
    maxTurns: cfg.profile.limits.maxTurnsPerRun,
    resume: item.lastSessionId,                          // for resume-answer / changes-requested
  },
});
```

Notes:
- **`cleanEnv`** strips `CLAUDECODE`, `CLAUDE_CODE_*`, `CLAUDE_AGENT_SDK_*`, `ANTHROPIC_AUTH_TOKEN` and `CLAUDE_CODE_OAUTH_TOKEN`, so a workbench started from inside Claude Code doesn't inherit the parent session. The SDK's `env` option *replaces* the child environment rather than merging with it.
- **`tools` covers only the built-in tools.** MCP tools are gated by `allowedTools`/`disallowedTools` alone.
- **`Skill` must be in `allowedTools`** under `dontAsk`, or every skill call is denied.

## 3. Changes applied to ARCHITECTURE.md

| Section | Change | Source |
|---|---|---|
| §4 | Node 26 is fine (drop "22 LTS"). `better-sqlite3@^13` (N-API); `node:sqlite` is the fallback. Python 3.14 is OK for the document tooling. | S8, S9 |
| §8.2 | Code sample updated to §2 above: explicit `tools`, `Edit(./**)`, `Skill` in `allowedTools`, `disableBundledSkills`, `CLAUDE_CONFIG_DIR`, clean env, subagent tool `Task` | S0–S5 |
| §8.3 | Hooks fire in subagents (confirmed). The default subagent inherits all parent tools. The tool is named `Task`. | S3 |
| §8.5 | Layer 2 governs writes only. Layer 3 is mandatory for read scope. Read-only shell auto-approval documented. Bash only by exception, PowerShell never. | S2, S3 |
| §8.7 | Skill scoping semantics, `disableBundledSkills`, and absolute script paths (there's no `${SKILL_DIR}` substitution) | S1, S9 |
| §11 | Checkpoint before commit, because otherwise the commit is silently empty. Close DB connections before checkout/restore on Windows. | S8 |
| §15 | Pinned `CLAUDE_CONFIG_DIR`, the Edge headless PDF timing issue, `better-sqlite3` v13 | S5, S8, S9 |
| §17 | Results table with links; S6/S7 moved into M2 | all |
| §18 | M2 includes the S6/S7 follow-ups | S6, S7 |

## 4. Measured costs and latencies (Haiku 4.5)

| Measure | Value |
|---|---|
| Small single-purpose run (1–3 turns) | $0.003–0.02 |
| Draft + 2 publishes + submit (S4) | ≈ $0.02 per item |
| Resume turn with the prompt cache (S5) | $0.02–0.025; 10–17k cache-read tokens |
| First-turn input with an explicit `tools` array | ≈ 3.7–4.1k tokens |
| In-process MCP tool round trip | 3–9 ms (handler < 1 ms) |
| Guard hook decision | 0.1 ms average, 1 ms p95 |
| SQLite: 10k inserts in one transaction | 15 ms (per-row autocommit: 199 ms) |

**Concurrency limit:** keep `maxConcurrentRuns: 3` as configured. Three parallel sessions ran stably (S4). The 5-session soak (S7) is deferred to M2.

## 5. Deferred and open items (carried into M2)
1. **S6**: a Haiku protocol adherence benchmark (10 runs, ambiguity injection, protocol placed in the system prompt vs. in a skill). Run it once the real `work-agent.md` prompt and `workbench-protocol` skill exist. Watch for Haiku fabricating tool output as prose when a tool is unavailable (S1), and for refusals of tasks it reads as adversarial (S3).
2. **S7**: a 5-session soak with RSS/CPU sampling and a hard-kill orphan test, followed by an orphan reaper at startup if needed.
3. Mid-turn streaming pushes are **merged** into the running turn. Decide in M3 whether the conversation UI queues them.
4. Items that need Bash (exports): the guard's shell rule should allow only the skill scripts, plus the snapshot audit. Shell reads have no backstop, so this is an accepted risk for those items only.
