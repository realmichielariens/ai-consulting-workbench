# Brief B — Approach Agent runtime (I2)

You build the Approach Agent's runtime in `packages/agents` of a TypeScript pnpm monorepo (Windows, Node 26, ESM, Zod v4, Claude Agent SDK `0.3.280`). The Approach Agent is the engagement's planner: it talks with the human, writes the engagement context, proposes plan changes as operations, and handles Work Agents' questions and suggestions. The main session wrote the contracts. Agent A builds the server side (it implements `ApproachPort`) in parallel.

## Your paths (write only here)
`packages/agents/**` (src, prompts, fake-scripts, package.json scripts) and `workbench-skills/skills/workbench-protocol/SKILL.md`.
**Read-only contracts**: `packages/core/src/{domain,ports,api,events}.ts`. If a contract is wrong, work around it and list it under "Contract change requests" in your final message.

## Read first (only these)
1. `packages/core/src/ports.ts`: `ApproachPort`, the plan tool input schemas, `ApproachRuntime`, `ApproachTurnRequest`, `ApproachTaskRequest`, `ProposePlanChangeInput`, and `RunInput` (`resume-answer.answeredBy`)
2. `packages/core/src/domain.ts`: `PlanOp`, `PlanItemDef`, `Proposal`, `SuggestionPayload`, `Request`
3. `packages/agents/src/sdk.ts`, `runtime.ts`, `workToolset.ts`, `guards.ts`, `fake/runtime.ts`, `fake/scripts.ts` (the Work Agent patterns you mirror)
4. `packages/agents/prompts/protocol.md` and `demo/seeds/acme-discovery/plan.template.yaml` (the plan the fake proposes)

Do not read DESIGN/ARCHITECTURE/ITERATIONS. Conventions: the SDK only through `sdk.ts`; always `settingSources: []`, an explicit `tools` list, the pinned `CLAUDE_CONFIG_DIR` via `sdkEnv`, the guard hooks; **never Bash or PowerShell**; small modules; comments explain why; `.js` in relative imports; never `pnpm add`; never commit.

## Build

**1. SDK options.** Generalise `runOnce` so the caller passes `tools`, `allowedTools` and the plugin/skills (the Work Agent keeps its current values exactly). Approach values: `tools: ["Read","Write","Edit","Glob","Grep"]`, `allowedTools: ["Read","Glob","Grep","Edit(./**)","mcp__plan__*"]`, no plugin, no skills, `cwd = paths.itemWork("ENG")`, `additionalDirectories: [paths.root]`, `model` from the request, `maxTurns` from the request.

**2. Guards** `forApproachAgent(scope)` in `guards.ts`, with tests. Reads are allowed anywhere under the engagement root **except** other items' `items/*/work/` (ENG/work is its own), `.workbench/` and `.git/`. Writes are allowed only inside `items/ENG/work/`. Bash/PowerShell/Task are denied. The `plan` MCP tools are denied when a subagent calls them. Reuse the pure-decision + hook-wrapper split of `forWorkAgent`.

**3. `plan` toolset** `createPlanToolset(port: ApproachPort)` (MCP server name `plan`, so tools are `mcp__plan__<name>`): `get_plan`, `get_item`, `propose_ops`, `publish_engagement_asset`, `journal_append`, `notify_human`, plus `answer_request` + `escalate` **only when `port.kind === "question"`** and `decline_suggestion` **only when `"suggestion"`**. Use the input schemas from ports.ts (`ProposeOpsInput.shape`, …). **Verify** that the SDK accepts the nested `PlanOp` discriminated union as a tool schema (a test that lists the tool's JSON schema, or a dry run); if it doesn't, accept `ops` as a JSON string and parse it with `PlanOp` in the handler. A `propose_ops` result with `ok:false` must return the errors to the agent as a tool **error** with "fix these and call propose_ops again". The tracker records `decided` (answer/escalate/decline/propose succeeded).

**4. Runtime** `createSdkApproachRuntime(config, workspace, deps?)` in `src/approachRuntime.ts` (replace the P0 stub; keep the signature, and add injectable `deps` like `createSdkRuntime`). `startTurn`: one `query()`, `resume: req.resumeSessionId ?? undefined`; system prompt = `approach-conversation.md` rendered with the engagement id; user prompt = `req.situation` (if non-empty) + `"\n\n---\nThe human says:\n"` + `req.message`. `startTask`: a fresh session; system prompt `approach-conversation.md`; user prompt from `approach-question.md` or `approach-suggestion.md`, rendered with the situation, the request (question, hypothesis, alternatives, or summary + suggested ops as YAML) and the item's id/title/brief. No nudge. Outcome: `interrupted` if interrupted, `max_turns`/`error` from the result, else `completed`. Activity via `ActivityBuilder` (itemId "ENG"); add readable summaries for `mcp__plan__*` calls to `activity.ts` (for example "Proposed P-0002 (4 operations)", "Published ENG/context v1.0", "Answered RQ-0003", "Escalated RQ-0004"). Record dev cost as the Work Agent does.

**5. Prompts** (`packages/agents/prompts/`):
- `approach-conversation.md`: the role; ask clarifying questions a few at a time; draft `context.md` and `stakeholders.md` in the current directory and publish them with `publish_engagement_asset` (kind material for the first version); plan with the operations (granularity medium: phases as composites, 3–8 leaf items, each with inputs, outputs, executor, and a human-review gate on key agent deliverables; call `get_plan` first for ids); propose with `propose_ops` and fix any errors it returns; answer "where are we?" from `get_plan` facts only; keep `journal_append` notes on hypotheses and rationale; **never do substantive work** (no interview guides, no analysis: that is the Work Agents' job).
- `approach-question.md`: decide from the context, the brief and the plan. Answer with `answer_request` (`mode "approve"` if the Work Agent's hypothesis stands, else `"replace"`) when the context is sufficient; otherwise `escalate` with your own view. You must end with one of the two.
- `approach-suggestion.md`: assess; `propose_ops` (a valid proposal) or `decline_suggestion(reason)`. You must end with one of the two.
- `run-resume-answer.md`: when `answeredBy` starts with `approach:`, say "The Approach Agent answered", not "the human".

**6. D2 protocol tweak** in `prompts/protocol.md` and the `workbench-protocol` SKILL.md: "When your brief flags something as open and you make a judgement call, raise it as a **non-blocking** question with your hypothesis, then carry on." Keep the existing blocking rule for real blockers.

**7. Work tool** `propose_plan_change(summary, suggestedOps?)` in `workToolset.ts` (non-blocking; its result tells the agent to continue or submit). Add a fake step `suggest: ProposePlanChangeInput`.

**8. Fake Approach runtime** `createFakeApproachRuntime(opts)` in `src/fake/approachRuntime.ts` (replace the stub; same delay handling as the work fake). It drives the same `ApproachPort` and emits the same activity kinds. Scripts live in `fake-scripts/approach/`:
- `conversation.yaml`: turns chosen by the first matching `match` regex (case-insensitive) on the human message, else the next unused kick-off turn in sequence. Kick-off turn 1: two or three clarifying questions (text). Turn 2: write + publish `context.md` and `stakeholders.md` (content as in `demo/seeds/acme-discovery/assets/ENG/`), then `propose_ops` with an `update_brief` for ENG plus exactly the acme seed's items (PH-1, WI-002, WI-003, PH-2, WI-004, same defs/gates), then a short text. `match: stakeholder|correct` → republish stakeholders as v1.1 (minor). `match: benchmark` → propose `add_item WI-005` "Short benchmarking scan" (agent, under PH-2, input ENG/context, output `benchmark` md, no gate). `match: where are we|status` → a text built from `get_plan` (done / running / blocked / needs the human). Fallback: a short acknowledgement.
- `question.yaml`, keyed by the asking item id: `WI-002` → `answer_request` mode approve with a short rationale; any other item → `escalate` with a view.
- `suggestion.yaml`: propose the suggestion's `suggestedOps` if non-empty (rationale from the summary), else decline.
- Add `fake-scripts/WI-005.yaml`: reads ENG/context, raises a **blocking** question (which peer set to benchmark against, with a hypothesis). Its `resume-answer`: write, publish `benchmark` v1.0, submit.
- Extend `fake-scripts/WI-004.yaml` `start`: after publishing themes, a `suggest` step "Budget appetite was never discussed with the CFO" with `suggestedOps: [add_item WI-003e "CFO follow-up interview" (human, parent PH-1, input ENG/stakeholders, output notes-cfo-followup md)]`, then submit as before.

**9. CLI** `agents:try-approach` (package.json script → `src/dev/try-approach.ts`): runs one turn over an in-memory `ApproachPort` (extend `dev/in-memory-engagement.ts`; `proposeOps` validates only with the Zod schema and prints the ops). Flags: `--fake` (default) or `--real`, `--message "<text>"`.

## Checks, then stop
- `pnpm typecheck` (whole repo) and `pnpm test` green; new tests for the approach guards, the plan toolset (tool list per kind, error path), the fake approach runtime (kick-off turn 2 publishes 2 assets and proposes 5+1 ops against a recording port) and the prompt rendering.
- `pnpm agents:try-approach --fake` works.
- **One real smoke**, ≤ $0.15 total: `agents:try-approach --real` with a kick-off message that states the Acme facts (so no clarifying round is needed) and asks for the plan. Report the cost, whether it published the context and whether `propose_ops` validated.
- No other real runs. Leave no process running.

Finish with a **≤ 20-line final message**: what you built, test counts, check evidence (including the smoke cost and outcome), contract change requests, open issues. No report files.
