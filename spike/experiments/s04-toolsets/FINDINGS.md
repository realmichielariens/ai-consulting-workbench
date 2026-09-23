# S4 — Bound in-process MCP toolsets under concurrency

**Verdict:** PASS   **Cost:** $0.5476   **Runs:** 33 `runQuery()` calls (1 billing smoke + 6 parallel-binding repeats [1+2+3, i.e. 18 item-runs] + 4 naming/allow-rule + 1 invalid-input + 5 end-turn + 1 latency + 1 for `run.ts`'s own reproduction pass)   **SDK:** 0.3.280   **Model:** claude-haiku-4-5

## Hypothesis

`createSdkMcpServer` + `tool()` toolsets created per session keep their bound identity — publishes land under the right item, with the right versions, and tool logs never cross-contaminate — even with several parallel `query()` calls in one Node process.

## Setup (what was built; how to re-run)

- `experiments/s04-toolsets/workToolset.ts` — `workToolset(itemId, runId, paths)` builds a fresh `createSdkMcpServer({name:"work", tools:[...]})` instance per call. Four tools, each defined with `tool(name, description, zodShape, handler)`:
  - `get_brief` — returns a static per-item brief (no args).
  - `publish_asset({slot, source_path, kind, note})` — copies `work/<source_path>` to `assets/<slot>/vX.Y.md`. Rejects `source_path` that is absolute or contains a `..` segment (checked with `hasTraversal`/`isInside` from the shared `src/lib/paths.ts`) *before* touching the filesystem. Version is computed by scanning the slot directory for existing `vX.Y.md` files: none yet → `v1.0` regardless of `kind`; otherwise `kind="minor"` → `vX.(Y+1)`; `kind="material"` → `v(X+1).0`.
  - `raise_question({question, hypothesis, alternatives, blocking})`.
  - `submit_outputs({summary, self_check})` — its tool-result text is the literal instruction under test in step 5: `"Submitted. End your turn now; do not call any more tools."`
  - Every handler appends one line to `<fixture>/.workbench/tool-log-<itemId>.jsonl` (`{ts, itemId, runId, tool, input, ok, error?, result?, handlerMs}`), closing over `itemId`/`runId` from the `workToolset()` call, not from anything the model sends.
- `experiments/s04-toolsets/parallel-binding.ts` — the required standalone, re-runnable deliverable for step 4. `npx tsx experiments/s04-toolsets/parallel-binding.ts [repeats]` (default 2) runs `repeats` independent trials; each trial creates one fresh `createEngagementFixture({items:["WI-001","WI-002","WI-003"]})` and fires 3 `runQuery()` calls **concurrently via `Promise.all`**, each bound to its own item with its own `workToolset` instance and its own random per-item "marker" token embedded in the drafted content. After all 3 finish it checks, from disk and from the tool logs (not from what the model *said* it did): correct versions in the correct item's `assets/draft/`, the item's own marker present, every *other* item's marker absent (cross-talk detector), and every log line's `itemId`/`runId` matching that item's own run. Prints `PASS`/`FAIL` with evidence per repeat and an overall verdict; exits non-zero on any failure.
- `experiments/s04-toolsets/util.ts` — `readToolLog()` and `measureE2ELatency()` (correlates `tool_use`/`tool_result` blocks across `onMessage`-timestamped messages by `tool_use_id`), shared by `run.ts` and `parallel-binding.ts`.
- `experiments/s04-toolsets/run.ts` — the main entry point. Runs, in order: naming/allowedTools interplay (4 sub-tests), the invalid-input round trip, 5 end-turn-obedience runs, one latency probe, and a 1-repeat smoke re-run of the parallel-binding logic (see "Two scripts, one budget" below for why it's 1 repeat here and not 3).

Re-run:
```sh
cd spike
npx tsx experiments/s04-toolsets/run.ts                    # full suite, ~$0.35-0.40
npx tsx experiments/s04-toolsets/parallel-binding.ts 3      # the 3-repeat parallel-binding deliverable on its own, ~$0.18
```

**Two scripts, one budget.** `parallel-binding.ts` (3 repeats × 3 items = 9 concurrent `query()` calls) is the authoritative, explicitly-requested deliverable for step 4 and was run directly, 3/3 repeats PASS, recorded under check `parallel-binding-3-items-no-crosstalk`. The M0 plan notes the main session will *independently re-run* this script, and the cost cap (`EXPERIMENT_CAPS_USD["s04"] = $1.00`) is a **cumulative ledger total keyed by experiment prefix**, shared across every future call — including that re-run. To leave headroom, `run.ts`'s own reproduction pass invokes the same underlying `runOneRepeat()` function only **once** (check `run-ts-reproduces-parallel-binding`) rather than repeating the full 3-repeat budget every time `run.ts` is run. Total spend after everything in this file: **$0.5476 of the $1.00 cap**, leaving roughly $0.45 for the main session's own re-run.

## Results

| Check | Result | Evidence |
|---|---|---|
| MCP tool names come out `mcp__work__<tool>` | PASS | `init.tools` mcp entries: `["mcp__work__get_brief","mcp__work__publish_asset","mcp__work__raise_question","mcp__work__submit_outputs"]` (`results/raw/s04-toolsets/naming-wildcard-allow-*.jsonl`) |
| `allowedTools: ["mcp__work__*"]` (wildcard) works under `dontAsk` | PASS | `get_brief` called and succeeded, `toolResults[0].isError===false` (`naming-wildcard-allow-*.jsonl`) |
| Non-wildcard form (4 explicit `mcp__work__<tool>` names) works | PASS | Same call succeeds with `allowedTools` listing all 4 names individually (`naming-explicit-allow-*.jsonl`) |
| MCP tools **not** in `allowedTools` → denied under `dontAsk` | PASS | Model called `mcp__work__get_brief`; tool_result `is_error:true`, text: "Permission to use mcp__work__get_brief has been denied because Claude Code is running in don't ask mode..."; `result.permission_denials` also lists it; **the handler never ran** — 0 lines in `tool-log-WI-001.jsonl` — so the deny happens before the MCP call reaches our code (`not-allowed-denied-*.jsonl`) |
| `tools` base-set array interplay | PASS | `options.tools: []` (**all** built-ins disabled) + `allowedTools:["mcp__work__*"]` → `init.tools` still lists all 4 `mcp__work__*` names and `get_brief` still succeeds (`tools-array-need-not-list-mcp-names-*.jsonl`). **`tools` governs only the built-in tool base set; MCP-server tools are independent of it and are gated solely by `allowedTools`/`disallowedTools`.** |
| Invalid `kind:"huge"` → Zod error reaches agent, agent self-corrects | PASS | `tool_result is_error:true`, text `MCP error -32602: Input validation error: Invalid arguments for tool publish_asset: [...path:["kind"], message:"Invalid option: expected one of \"minor\"\|\"material\""...]`; next call used `kind:"minor"` and succeeded (`invalid-input-recovery-*.jsonl`) |
| Missing required field (`hypothesis` omitted) → Zod error reaches agent, agent self-corrects | PASS | Same shape: `...path:["hypothesis"], message:"Invalid input: expected string, received undefined"...`; next call included `hypothesis` and succeeded |
| Path traversal (`../../WI-002/work/secret.md`) → denied by handler logic, not executed | PASS | Handler-level (not Zod) error: `publish_asset: source_path "../../WI-002/work/secret.md" must be a relative path inside work/ (no ".." segments, not absolute).`; no file copy occurred (the traversal check runs before any `fs` call) |
| Agent completes the run after 3 validation errors | PASS | `submit_outputs` called, `run.isError===false` |
| **Parallel binding: 3 repeats × 3 concurrent items, zero cross-talk** | **PASS 3/3** | `parallel-binding.ts 3`: every item's `assets/draft/` got exactly `v1.0.md` + `v2.0.md`; each contained only its own marker token, never another item's; each `tool-log-<item>.jsonl` (3 entries each) had every line's `itemId`/`runId` matching that item's own run, and no other item's log ever mentioned a foreign `runId` or marker. 9/9 item-runs clean across 3 independent fixtures. Cost ≈ $0.06/repeat. |
| End-turn obedience ("Submitted. End your turn now...") | **PASS 5/5** | 5 independent runs, each ending in exactly 2 tool calls (`publish_asset`, `submit_outputs`), 0 extra calls after `submit_outputs` in every run |
| Tool-call latency: handler vs. end-to-end | PASS (measured) | `publish_asset`: handler 1ms / e2e 8–9ms. `submit_outputs`: handler 0ms / e2e 3ms. Handler logic itself is negligible; almost all latency is MCP transport/message round-trip, and even that is single-digit ms in-process. |

Full machine-readable results: `results/s04-toolsets/summary.json` (13 checks, all `pass: true`).

## Exact working configuration (copy-pasteable snippets, rule syntax, option shapes)

**Building the toolset** (`createSdkMcpServer` + `tool()`, per session):
```ts
import { z } from "zod";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";

function workToolset(itemId: string, runId: string, paths: { workDir: string; assetsDir: string; logDir: string }) {
  const publishAsset = tool(
    "publish_asset",
    "Publishes a file from your work/ folder as a new immutable version under the given asset slot.",
    {
      slot: z.string().min(1),
      source_path: z.string().min(1),
      kind: z.enum(["minor", "material"]),
      note: z.string().min(1),
    },
    async (args) => {
      // handler closes over itemId/runId/paths — never trusts anything the model
      // sends for "which item am I" — that's the whole point of this experiment.
      // ... path-safety check, version computation, fs.copyFileSync, appendLog ...
      return { content: [{ type: "text", text: `Published ... as v${major}.${minor}` }], isError: false };
    },
  );
  // ...same pattern for get_brief / raise_question / submit_outputs...
  return createSdkMcpServer({ name: "work", version: "0.1.0", tools: [getBrief, publishAsset, raiseQuestion, submitOutputs] });
}
```

**Wiring it into a run** (confirmed working shape — this is what ARCHITECTURE §8.2 sketches, spike-confirmed):
```ts
mcpServers: { work: workToolset(item.id, runId, paths) },
tools: ["Read", "Write"],                 // base set of BUILT-IN tools only — need not list mcp__work__* here
allowedTools: ["Read", "mcp__work__*"],   // wildcard form confirmed to work; explicit per-name list also works
permissionMode: "dontAsk",
```

**Naming:** an MCP server registered as `{ name: "work", ... }` with tools `get_brief`/`publish_asset`/`raise_question`/`submit_outputs` produces exactly `mcp__work__get_brief`, `mcp__work__publish_asset`, `mcp__work__raise_question`, `mcp__work__submit_outputs` in `init.tools` and in `allowedTools` rules. Both `"mcp__work__*"` and the four explicit names work identically as an `allowedTools` entry.

**Denial shape when NOT in `allowedTools`, under `dontAsk`:** the tool call still appears in `toolCalls` (the model attempted it) but the `tool_result` has `is_error: true` with text `"Permission to use mcp__work__<name> has been denied because Claude Code is running in don't ask mode. ..."`, and it also shows up in `result.permission_denials`. Critically, **the handler never executes** (confirmed via the tool log being empty for that call) — the deny happens at the SDK/CLI layer, before the in-process MCP server is even invoked. This is a real enforcement boundary, not just a hint to the model.

**`tools` vs. MCP tools — the interplay:** `options.tools` (`string[]` or the `{type:'preset', preset:'claude_code'}` form) is documented in `sdk.d.ts` as "the base set of available **built-in** tools" — confirmed empirically: setting `tools: []` (disabling every built-in) does **not** remove or hide `mcp__work__*` tools; they remain in `init.tools` and remain callable, gated purely by `allowedTools`/`disallowedTools`. **MCP server tools are additive on top of whatever `tools` specifies**, never subtracted by it. Conversely `tools` cannot be used to narrow *out* an MCP tool — only `allowedTools`/`disallowedTools` (or not registering the server at all) can do that.

**Version computation** (`workToolset.ts`, `computeNextVersion`): scans the slot directory for existing `vX.Y.md` files; if none exist, the first publish is always `v1.0` **regardless of the requested `kind`**; otherwise `kind:"minor"` → `vX.(Y+1)`, `kind:"material"` → `v(X+1).0`. Confirmed: a minor-then-material sequence from empty produces `v1.0` → `v2.0` (not `v1.0` → `v1.1` → `v2.0`, since only 2 publishes were made — the version scheme is correct, "or as computed" per the plan's own hedge).

**Path-escape defense in the handler** (belt-and-braces on top of any future PreToolUse guard from S3):
```ts
if (hasTraversal(sourcePath) || path.isAbsolute(sourcePath)) { /* deny, no fs touched */ }
const resolvedSource = path.resolve(paths.workDir, sourcePath);
if (!isInside(resolvedSource, paths.workDir)) { /* deny, no fs touched */ }
```
using the shared `src/lib/paths.ts` (`hasTraversal`, `isInside`) — the same Windows-safe normalization S2/S3 rely on.

## Surprises and deviations from ARCHITECTURE.md

1. **`tools` truly is orthogonal to MCP tools**, confirmed more strongly than S0 suggested: even the *most* restrictive built-in setting (`tools: []`, disabling literally everything built-in, including `Read`/`Write`) leaves MCP tools fully functional. ARCHITECTURE §8.2's example config passes both `tools` (implicitly, via the earlier S0 recommendation) and `allowedTools` including `mcp__work__*` — this spike confirms that's the right mental model: `tools` is a built-in allowlist/base-set, `allowedTools`/`disallowedTools` is the only lever that reaches MCP tools.
2. **Zod validation errors are full JSON-RPC error payloads** (`MCP error -32602: Input validation error: ...`), not a friendly one-line message — the raw Zod issue array (code, path, message) is embedded in the tool_result text. Haiku had no trouble parsing this and extracting the right correction (`kind` must be one of `"minor"`/`"material"`; `hypothesis` must be a string) on the very next call, in both cases tested. This argues the real `work` toolset's Zod schemas don't need hand-written error-message wrapping for Haiku's benefit — the default Zod error surfaces enough signal.
3. **Denial-not-execution is provable, not just assumed.** Because the tool log is written from *inside* the handler, an empty log file for a denied call is direct evidence the handler never ran — this is a stronger check than "the model didn't do the bad thing" (which could be a model choosing not to try) and is worth carrying into S3's guard-hook FINDINGS as a pattern (empty-log-means-handler-never-ran).
4. **End-to-end tool latency is small enough that it's a rounding error next to model round-trip time.** 3–9ms per call (in-process MCP + our trivial fs operations) versus turns that otherwise take 1–3 seconds of model latency. For the real `work` toolset (which does more — FTS search, more file I/O), this headroom is comfortable; it would take a ~100–1000x slower handler before tool latency became the bottleneck versus the model call itself.
5. **The cost-cap ledger is genuinely shared and cumulative per experiment prefix**, across every `runQuery()` call ever made against `s04*`, from any process. This is a real constraint worth flagging for whoever authored the note "the main session will independently re-run your parallel-binding test": that re-run draws from the *same* $1.00 pool this FINDINGS' own testing already used $0.55 of. It worked out fine here (≈$0.45 headroom left), but a tighter cap or a heavier spike could make an agent's own thorough testing starve a later independent check. Might be worth the main session bumping `EXPERIMENT_CAPS_USD.s04` before its own re-run, or accepting a `CostCapExceededError` there as a legitimate "already validated, see FINDINGS" outcome rather than a failure.
6. Not a surprise but confirmed for completeness: `submit_outputs`'s tool-result text (a plain literal instruction string: *"Submitted. End your turn now; do not call any more tools."*) was obeyed 5/5 times by Haiku in this deliberately simple 2-tool-call task. This is a weak test of the instruction's robustness — the model had no remaining incentive to call more tools anyway (the brief was fully satisfied). S6 (protocol reliability on a realistic, more open-ended work item) is a better test of whether this instruction actually *changes* behavior versus the model just naturally stopping.

## Recommendation (what to change in ARCHITECTURE.md, if anything)

1. §8.2/§8.6: confirm the sketched `mcpServers: { work: workToolset(item.id, runId) }` + `allowedTools: [..., "mcp__work__*"]` pattern as-is — it works exactly as written, on Windows, under `permissionMode: "dontAsk"`, with parallel sessions.
2. §8.2: add a one-line note that `tools` (the built-in base-set option) and MCP tool gating are independent axes — `tools` never needs to (and cannot usefully) list `mcp__work__*`/`mcp__plan__*`/`mcp__agenda__*`/`mcp__library__*` names; only `allowedTools`/`disallowedTools` do.
3. §8.5 (enforcement layers): the "handler never executes when denied" property (found here) is worth stating explicitly as part of layer 2 ("Permission rules") — it means a denied MCP tool call cannot have any side effect, which strengthens the locus-of-control argument for layer 1 ("Construction: agents write only through bound tools").
4. No changes needed to the version-numbering rule in §10.1 — the spec ("first publish v1.0; minor → vX.(Y+1); material → v(X+1).0") is implemented and confirmed exactly as written.

## Fallback status (tested? works?)

Not needed. The plan's fallback ("a stand-alone MCP server with an item token per run, only if binding fails") was not triggered — in-process binding via closures worked correctly in every one of 9 concurrent item-runs across 3 independent repeats, with zero cross-talk detected by either the disk state or the tool logs.

## Harness change requests

None. `src/lib/{run,fixture,paths,report}.ts` were used as-is, read-only.

## Open questions

1. **Sample size on end-turn obedience is small and low-stakes** (5 runs, a trivial 2-call task with nothing left to do). S6/S7 or a dedicated follow-up should test the instruction under more tempting conditions — e.g., a run where the brief could plausibly warrant "one more" tool call (an extra `raise_question` about something unresolved) after `submit_outputs`, to see if the literal instruction actually overrides a lingering impulse rather than just matching what the model would have done anyway.
2. **Latency at realistic toolset complexity is unmeasured.** This experiment's handlers do a few `fs` calls; the real `work` toolset also does FTS search (`search_assets`) and DB writes (`asset_versions`, `consumptions`, worklog). Worth a follow-up latency measurement once those exist, to confirm the "tool latency is a rounding error" conclusion still holds.
3. **The shared cost-cap ledger interplay** (surprise 5) should be resolved by the main session before it does its own independent re-run of `parallel-binding.ts`, since ~$0.45 remains here but a 3-repeat re-run costs ≈$0.18–0.20, which fits — but only with no further `s04*`-prefixed spend in between.
