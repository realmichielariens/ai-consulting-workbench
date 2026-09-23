# M0 Spike — conventions

This folder holds the M0 technical spike described in [../M0-SPIKE-PLAN.md](../M0-SPIKE-PLAN.md).
Each experiment validates an assumption from [../ARCHITECTURE.md §17](../ARCHITECTURE.md).

## Environment

| Item | Value |
|---|---|
| Node | v26.3.0 (run the spike on this; the LTS decision is made in Phase 3) |
| Package manager | **npm** in this folder; experiments that need extra deps get a nested `package.json` |
| Agent SDK | `@anthropic-ai/claude-agent-sdk@0.3.280`, **pinned exactly** |
| Model | `claude-haiku-4-5` (`SPIKE_MODEL`); never switch unless the experiment says so |
| Python | 3.14.0 (use a venv inside your experiment folder, e.g. `experiments/s09-documents/.venv`) |

### API key

`src/lib/env.ts` resolves `ANTHROPIC_API_KEY` in this order:

1. the process environment;
2. `spike/.env` (git-ignored);
3. on Windows, the **user-level** environment variable in the registry (`HKCU\Environment`). This covers the case where the key was set after VS Code started.

The key is **never** printed, logged or written to a transcript. `env.ts` exposes a `redact()` helper, and `run.ts` applies it to everything it writes.

## Running

```sh
cd spike
npm install          # once
npx tsx experiments/sNN-<name>/run.ts
npm test             # harness unit tests (paths.ts etc.)
```

## Conventions (every subagent must follow these)

1. Before writing code, read `ARCHITECTURE.md` §8 and §17, your experiment's section in `M0-SPIKE-PLAN.md`, and this README.
2. Use `claude-haiku-4-5` for every SDK run (`SPIKE_MODEL`). Never switch models unless the experiment says so.
3. Always pass `settingSources: []` unless the experiment tests otherwise. Always call the SDK through `runQuery()` from `src/lib/run.ts`, so transcripts and costs are recorded.
4. Write **only** inside `experiments/<your-exp>/` and `results/<your-exp>/` (plus `results/raw/<your-exp>/`, which `run.ts` writes for you). Never modify `src/lib/`, the shared `package.json`, the design documents or `~/.claude`.
5. **Run everything for real.** A check is `pass` only with evidence: a transcript line, a hash comparison or command output. Never report an expected result as observed.
6. Never print, log or commit the API key.
7. Respect the cost cap. When `runQuery` refuses a run (`CostCapExceededError`), stop and write up what you have.
8. Kill every process you spawn. Leave nothing running in the background.
9. Keep scripts re-runnable: `npx tsx experiments/sNN-*/run.ts` must reproduce the results.
10. Deliver `experiments/<your-exp>/FINDINGS.md` using the template below, and `results/<your-exp>/summary.json` written through `src/lib/report.ts`.

Extra rules:

- Every fixture is created in a **unique temp directory per run** (`createEngagementFixture()` does this). Never share mutable state between runs.
- Need a harness change? Copy the file into your experiment folder, change the copy, and list the change under *Harness change requests* in your FINDINGS.
- Need the SDK's exact API? Read the type definitions in `node_modules/@anthropic-ai/claude-agent-sdk/` (`*.d.ts`). Those are the source of truth for the pinned version; don't guess option names.

## Experiment IDs

| ID | Folder | Owner |
|---|---|---|
| S0 | `experiments/s00-smoke` | SCAFFOLD |
| S1 | `experiments/s01-skills` | A1 |
| S2 | `experiments/s02-permissions` | A2 |
| S3 | `experiments/s03-guards` | A2 |
| S4 | `experiments/s04-toolsets` | A3 |
| S5 | `experiments/s05-resume` | A4 |
| S6 | `experiments/s06-haiku-reliability` | B1 |
| S7 | `experiments/s07-parallelism` | B2 |
| S8 | `experiments/s08-sqlite` | A5 |
| S9 | `experiments/s09-documents` | A6 |

## FINDINGS.md template

```markdown
# SNN — <title>

**Verdict:** PASS | PARTIAL | FAIL   **Cost:** $x.xx   **Runs:** n   **SDK:** 0.3.280   **Model:** claude-haiku-4-5

## Hypothesis
## Setup (what was built; how to re-run)
## Results
| Check | Result | Evidence (file:line / command output) |
## Exact working configuration (copy-pasteable snippets, rule syntax, option shapes)
## Surprises and deviations from ARCHITECTURE.md
## Recommendation (what to change in ARCHITECTURE.md, if anything)
## Fallback status (tested? works?)
## Harness change requests
## Open questions
```

## Harness API

Everything below lives in `src/lib/`. It's read-only after Phase 0b — see
"Harness change requests" above if you need something different.

### `env.ts`

```ts
import { config, assertKey, redact, childEnv } from "../../src/lib/env.js";
```

- `config: { model, totalCapUsd, spikeRoot, resultsDir, rawDir, keySource }` — `keySource` is `"process" | "dotenv" | "registry" | undefined`. Never contains the key itself.
- `assertKey(): void` — throws if no key could be resolved. `runQuery()` already calls this for you.
- `redact(text: string): string` — replaces the resolved key and any `sk-ant-...`-shaped token with `[REDACTED]`. Apply it to anything you `console.log`.
- `childEnv(extra?: Record<string, string | undefined>): NodeJS.ProcessEnv` — a copy of `process.env` with the API key set, `CLAUDE_CONFIG_DIR` defaulted to `results/raw/claude-config` (confirmed working in S0 — keeps `~/.claude` untouched), and parent-session vars (`CLAUDECODE`, `CLAUDE_CODE_*`, `CLAUDE_AGENT_SDK_*`, `ANTHROPIC_AUTH_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN`) stripped. `runQuery()` uses this as its default `options.env`; pass your own `env` in `options` to override entirely, or call `childEnv({...})` yourself for partial overrides (e.g. `childEnv({ CLAUDE_CONFIG_DIR: undefined })` to opt out of the redirect).

### `run.ts`

```ts
import { runQuery, CostCapExceededError, EXPERIMENT_CAPS_USD } from "../../src/lib/run.js";

const result = await runQuery({
  exp: "s02-permissions",       // your experiment id — used for cost-cap lookup and results/raw/<exp>/
  label: "own-work-write",      // short label — one transcript file per (exp,label,runId)
  prompt: "…",                  // string, or an AsyncIterable<SDKUserMessage> for streaming input
  options: {                    // Partial<Options> from the SDK — merged OVER these harness defaults:
                                 //   model: config.model, settingSources: [], env: childEnv(), stderr: <captured>
    settingSources: [],         // repeat explicitly if you want to be sure (this is already the default)
    permissionMode: "dontAsk",
    allowedTools: ["Read", `Edit(${absRule}/**)`],
    hooks: { PreToolUse: [...] },
  },
  capUsd: 0.5,                  // optional override; otherwise looked up from EXPERIMENT_CAPS_USD[exp.slice(0,3)]
  onMessage: (m) => {...},      // optional: called for every streamed SDKMessage
  onQuery: (q) => {...},        // optional: called once with the live Query, e.g. to call q.interrupt() later
  timeoutMs: 5 * 60_000,        // default 5 min; aborts via AbortController and kills the child
});
```

Returns:

```ts
{
  runId, transcriptPath,        // results/raw/<exp>/<label>-<runId>.jsonl (redacted JSONL, one message per line)
  sessionId,                    // from system/init, or the result message
  init,                         // the SDKSystemMessage (subtype 'init'), or undefined if the run errored before it
  subtype, isError,             // from the SDKResultMessage — NOTE subtype can be 'success' with isError true
                                 // (e.g. a billing error produces a synthetic assistant message and a
                                 // is_error:true "success" result — always check isError, not just subtype)
  resultText,                   // result.result when subtype === 'success', else undefined
  costUsd, turns, usage, modelUsage,
  toolCalls: { id, name, input, parentToolUseId }[],   // from every assistant message's tool_use blocks,
                                                        // including subagent messages (parentToolUseId set)
  toolResults: { toolUseId, isError, text }[],         // from every user message's tool_result blocks
  denials,                      // result.permission_denials
  durationMs, messages,         // messages = every SDKMessage seen, in order
  retries, timedOut,
}
```

Cost caps: enforced BEFORE a run starts, by summing `results/cost-ledger.jsonl` (one JSON line appended per
completed `runQuery()` call, keyed by `exp.slice(0,3)`) against `EXPERIMENT_CAPS_USD[exp.slice(0,3)]` (or
your `capUsd` override) and against `config.totalCapUsd` globally. Throws `CostCapExceededError` — catch it,
stop, and write up what you have (convention 7).

Retries: only when a run fails **before any assistant message** with a rate-limit/overloaded-shaped error
(429/529 in the message, or `assistant.error` of `rate_limit`/`overloaded`). Up to 3 attempts, exponential
backoff, recorded in the returned `retries` count and as `harness_retry` lines in the transcript. A
"Credit balance is too low" result is NOT retried (it's not transient).

### `fixture.ts`

```ts
import { createEngagementFixture } from "../../src/lib/fixture.js";

const fx = createEngagementFixture({ items: ["WI-001", "WI-002", "WI-003"] }); // WI-002 is required
// fx.root, fx.engRoot, fx.outsideDir
// fx.paths.{engContext, engStakeholders, wi002Secret, wi002Notes, workbenchState, outsideSecret}
// fx.paths.itemWork(id) / fx.paths.itemAssets(id)
// fx.canaries.{work, state, outside}   — random per fixture, e.g. "CANARY-WORK-a1b2c3d4"
fx.cleanup();                    // always call this (e.g. in a finally) — deletes the whole temp root
```

Every call creates a brand-new `os.tmpdir()/m0-spike-<rand>` tree per M0-SPIKE-PLAN.md §3.1. Never share one
fixture across runs or agents.

### `canary.ts`

```ts
import { scanForCanaries } from "../../src/lib/canary.js";
const hits = scanForCanaries([{ file: result.transcriptPath }], [fx.canaries.work, fx.canaries.state]);
// hits: { canary, source, line }[] — a read-enforcement check passes only when hits.length === 0
```

### `snapshot.ts`

```ts
import { hashTree, diffTrees, assertUnchanged } from "../../src/lib/snapshot.js";
const before = hashTree(fx.paths.itemWork("WI-002"));
// ... run the agent ...
const after = hashTree(fx.paths.itemWork("WI-002"));
assertUnchanged("WI-002/work", before, after);   // throws with added/removed/changed paths if it changed
```

### `report.ts`

```ts
import { check, summarize } from "../../src/lib/report.js";
check("s02-permissions", "own-work-write-succeeds", true, "toolResults[0].isError === false; file exists on disk");
check("s02-permissions", "outside-write-denied", "partial", "denied, but via PostToolUse revert rather than PreToolUse");
// upserts by name into results/<exp>/summary.json — safe to call repeatedly as you refine a check
```

`pass` is `boolean | "partial" | "skip"`. Always pass real `evidence` (a transcript excerpt, a hash diff, a
command's output) — never mark something `true` from an expected-but-unobserved result (convention 5).
