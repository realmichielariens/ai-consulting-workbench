# L1 — RUNTIME (`packages/agents`): ready for a look

**Built:** The full Work Agent runtime: `src/sdk.ts` (the only place `query()` is called — options exactly per M0-FINDINGS §2, retries on pre-first-assistant-output rate-limit/overloaded, PID capture via `spawnClaudeCodeProcess`, redacted JSONL transcript, the dev cost guard), `src/guards.ts` (PreToolUse/PostToolUse, ported from `spike/experiments/s03-guards`, extended for I1: subagent `mcp__work__*` denial, the skills-plugin dir readable, Bash/PowerShell denied outright since I1 never enables them), `src/workToolset.ts` (the six `work` MCP tools bound to one `WorkPort`, tracking `submitted`/`openBlockingQuestion`), `src/prompts.ts` (renders all six templates per `prompts/README.md`, placement A/B, `promptHash`), `src/activity.ts` (`ActivityBuilder`: maps SDK messages to `ActivityItem`s, denial vs. genuine-error told apart via the guard's own decision log, not text-matching), `src/runtime.ts` (`createSdkRuntime`: one run = the initial `query()` call plus, if `decideRunTermination` says so, exactly one nudge resume of the same session), `src/fake/` (`createFakeRuntime`, YAML-scripted, drives the identical `WorkPort`/`ActivityItem` surface), `src/dev/` (an in-memory `WorkPort`+engagement fixture built straight from the seed format, and the `agents:try` CLI). Fake scripts exist for WI-002 (full interview guide, blocking CIO question with a hypothesis, resume-answer, changes-requested) and WI-004 (themes doc with real evidence quotes and an explicit contradiction), plus a generic fallback for any other agent item.

**Quick checks:** typecheck ✔ (`packages/agents`, and root `pnpm typecheck` — the one failure, `apps/web`, is a pre-existing W6-scope `zod` resolution issue, not touched by W1) · unit tests ✔ **61** in `packages/agents` (root `pnpm test`: **262** passed across the whole repo, 4.4s) · smoke: `agents:try acme-discovery WI-002 --fake`, `agents:try acme-discovery WI-004 --fake`, `agents:try acme-discovery WI-002 --fake --answer approve` (all three end to end, $0), and **one real Haiku run**: `agents:try acme-discovery WI-002 --answer approve --save`.

**API spent:** **$0.0950** (one real query; it submitted directly without a blocking question, so no resume/nudge call happened — well under the $0.25 smoke cap).

## Take a look (≤ 10 minutes)

1. `pnpm agents:try acme-discovery WI-002 --fake` (run from the repo root; instant, `WORKBENCH_FAKE_DELAY_MS=0` for speed, default 600 ms otherwise) — watch it read the context/stakeholders, draft and publish the interview guide v1.0, then raise a **blocking** question about the CIO section with a hypothesis and two alternatives, ending the run `blocked`.
2. Open `iterations/I1/looks/L1-run-output.txt` — the saved console output of the **real** run. It shows the full activity log, the real Haiku model's own text narration, and the published `interview-guide` v1.0. Notice: Haiku did **not** raise the CIO question — it made the same call autonomously and documented its reasoning in the worklog (quoted below, "Take a look" item 4).
3. Open the real run's engagement folder printed at the top of that file (a temp path under `%TEMP%\workbench-try-acme-discovery-*\`) — `items/WI-002/assets/interview-guide/v1.0.md` is the actual guide; `items/WI-002/worklog.md` has the agent's own account of its decisions.
4. In the worklog, read point 5: *"CIO (Priya Raman) — deliberate choice: Made an explicit decision to focus the CIO interview on forward-looking vision and priorities rather than inherited history. Rationale: (a) She's the strategy sponsor and wants fact-based, not vendor-led approach; (b) she explicitly wants to avoid over-customization... (c) understanding what she's learned in 3 months and what priorities are forming is more valuable for strategy scoping than deep-diving on why past decisions were made..."* — a sound, defensible call, but made silently rather than surfaced as a question. This is the single most important finding of this look (see "Questions for you").
5. `pnpm agents:try acme-discovery WI-002 --fake --answer approve` — the fake script *does* raise the question (to exercise J1.4/R3/R4 in later packages' fake-driven tests). Its hypothesis: *"Lean into her forming vision and priorities, with only enough history to anchor it... she is the sponsor of this scoping and the board is waiting on her recommendation, so what she wants to do next is more decision-relevant to the strategy than a full history."* Compare this to Haiku's own real reasoning above — they land on the same answer independently, which is a good sign for the interaction design even though Haiku skipped asking.
6. `pnpm agents:try acme-discovery WI-004 --fake` — reads all four interview notes plus context, and publishes a real themes document with 8 themes, each with an attributed quote, explicitly calling out the CEO-vs-COO/CIO urgency contradiction (`- questions or feedback go in the git-ignored temp folder, printed at the top of the console output`).
7. `pnpm test` and `pnpm --filter @workbench/agents typecheck` — green.

## Exact option set passed to `query()` (sdk.ts)

Matches M0-FINDINGS §2 exactly, per call:

```ts
{
  model,                                         // req.model (test profile: claude-haiku-4-5)
  cwd,                                            // paths.itemWork(item.id)
  additionalDirectories: [paths.root],            // the engagement root
  systemPrompt,                                   // work-agent.md (+ protocol.md inline, placement A default)
  settingSources: [],
  settings: { disableBundledSkills: true },
  env,                                             // sdkEnv(repoRoot, workspace): clean env + pinned CLAUDE_CONFIG_DIR
  plugins: [{ type: "local", path: skillsPluginPath }],
  skills,                                          // item.skills, each as "workbench-skills:<name>"
  tools: ["Read","Write","Edit","Glob","Grep","Skill","Task"],           // never Bash/PowerShell in I1
  allowedTools: ["Read","Glob","Grep","Skill","Task","Edit(./**)","mcp__work__*"],
  mcpServers: { work: workServer },                // createWorkToolset(workPort), one instance per run
  permissionMode: "dontAsk",
  hooks,                                           // forWorkAgent(scope, {onRead}) — mandatory
  maxTurns,                                        // req.maxTurns
  resume,                                          // sessionId, only on resume-answer/changes-requested/resume/nudge calls
  abortController,                                 // shared across the run's calls; interrupt() aborts it
  spawnClaudeCodeProcess,                          // wraps node:child_process.spawn to capture the PID -> observer.onPid
}
```

Verified live against the real run's raw transcript (`.workbench/runs/R-0001.jsonl` in the temp engagement): `system/init` reported `model: "claude-haiku-4-5"`, `cwd` = the item's `work/`, `tools` = the seven listed, `mcp_servers: [{name:"work", status:"connected"}]`. Zero guard denials; the agent correctly stayed inside `work/` and read only `ENG/context` and `ENG/stakeholders`.

## Questions for you

- **Haiku skipped the blocking question and decided autonomously instead** (see "Take a look" #2/#4). This is exactly what learning question I1 §4.5-2 is asking about. My read: this is *not* a protocol failure — the agent followed the letter of the protocol (it had a real hypothesis, judged the ambiguity resolvable, and documented its reasoning), and `protocol.md` explicitly tells it to ask only when "the ambiguity is real and material" and not to "manufacture a question to cover yourself." One real run is not S6 (that's W2's 10-run benchmark with ambiguity *strengthened*); I'm flagging it now because it's visible at n=1 and S6 should watch specifically for this failure mode (a defensible decision made silently vs. surfaced) alongside the fabrication/refusal risks M0 already flagged.
- **Protocol placement default (A, inline) is what this real run used** — `WORKBENCH_PROMPT_PLACEMENT=B` switches to the skill for W2's S6 comparison; I did not exercise placement B against the real API (no budget spent on it beyond the required smoke).
- I made a product/CLI-design call, not a contract change: the `resume-answer` request in `agents:try` reuses the **exact question text and hypothesis** the agent raised (from the in-memory `WorkPort`'s recorded question), so `--answer approve` always means "accept my own hypothesis verbatim" — matching J1.4 step 3's "Approve" semantics.

## Known gaps and shortcuts (not yet validated)

- **`Task` (subagent) activity summary is an unverified guess** (`Delegated to a subagent: <description>` reading `input.description`) — no Work Agent run in this look actually called `Task`, so the field name is inferred from convention, not observed. I found and fixed one real mismatch this way already: the `Skill` tool's input field is `skill` (e.g. `workbench-skills:interview-guide-design`), not `command`/`name` as I'd first guessed from the spike — confirmed against the real run's raw transcript and fixed in `activity.ts`. **The saved `L1-run-output.txt` predates that fix**, so its "Invoked skill: " lines show blank; a fresh run would show `Invoked skill: workbench-skills:interview-guide-design`. I did not spend a second real query re-running it just to refresh the transcript — the fix is verified by unit test and by re-reading the same raw JSONL by hand (see below).
- **Guard canary battery, hard-kill orphan test, resume-from-new-process** are V1, not run yet (stop rule).
- **The generic fallback fake script** (any agent item without a dedicated YAML) writes one placeholder per required output slot and self-checks every acceptance criterion as `partial` — deliberately unpolished since it exists for future items, not for I1's own three.
- **`report_progress`'s in-memory `WorkPort` implementation is a no-op** beyond the activity item (no UI to update yet in this harness) — matches scope, since J1.3's live progress display is W6's.
- I did not implement `reason: "stale-rerun"` (out of scope for I1 per `prompts/README.md`); `renderRunPrompt` throws clearly if it's ever requested.
- `runtime.ts`'s `RuntimeConfig`/`RuntimeDeps` (constructor args for `createSdkRuntime`) and `FakeRuntimeOptions` (for `createFakeRuntime`) are **not** contract types from `ports.ts` — they're W1-internal plumbing so `runtime.test.ts` can inject a scripted `runOnce`/`buildEnv` without any SDK call. **W5 only needs**: `createSdkRuntime(config: RuntimeConfig, workspace: WorkspacePaths): AgentRuntime` and `createFakeRuntime(opts?: FakeRuntimeOptions): AgentRuntime`, both exported from `@workbench/agents` (`src/index.ts`). `RuntimeConfig` is `{ promptsDir, skillsPluginPath, devCapUsd, repoRoot }` (all plain strings/number) — W5 builds it from `loadConfig()`'s `.resolved.promptsDir`/`.resolved.skillsPlugin`, `.dev.totalCapUsd`, and `repoRoot()`.

## Contract change requests

None. One thing worth a look from the main session, not a change request: `ports.ts`'s `BriefView.inputs[].description` has no natural source in `domain.ts`'s `InputRef` (which only has `slot`/`required`/`pin`) — the real description lives on the *producer* item's matching `OutputSlot.description`. My in-memory `WorkPort` (and presumably W5's real one) has to cross-reference the producer item to fill it in. This worked fine here; flagging only because it's an easy thing to get wrong if W5 builds `BriefView` from a single item's row without the plan.

## Validation plan (runs only after your go)

| Step | What it proves | Duration | API cost |
|---|---|---|---|
| Guard canary battery (ported from s03: every tool, every path form, `..`/mixed-case/backslash variants, a subagent delegation via a real `Task` call, a read-only-shell auto-approval check) against the production `guards.ts`, hash-verified zero leaks | The only read-scope control holds in production, not just in the spike | 10 min | $0.15 (one real run that spawns a subagent) |
| Resume from a **new process** with the pinned `CLAUDE_CONFIG_DIR` (mirroring `spike/experiments/s05-resume/resume-new-process.ts`, ported onto `packages/agents`) | Resume survives a server restart (R1), which depends on `sdkEnv()`'s pinned config dir | 10 min | $0.15 |
| `interrupt()` mid-run, then resume the same session | R5 (stop and resume) | 10 min | $0.10 |
| The nudge path: a prompt variant crafted to make the agent stop without submitting or asking | R3, and that the one nudge is enough / the run-issue path fires correctly after it | 10 min | $0.20 |
| Hard-kill orphan test: kill the parent Node process mid-run, then check the recorded PID via `spawnClaudeCodeProcess` identifies the surviving `claude` child | R2's input — W5 needs these PIDs to clean up at startup | 10 min | $0.10 |
| **Total** | | **~50 min** | **~$0.70** (cap $1.50) |
