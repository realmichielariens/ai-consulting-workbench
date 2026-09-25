# I2 — Talk to the Approach Agent: Implementation Plan

| | |
|---|---|
| **Status** | **Approved 2026-09-25.** The decisions in §3 are confirmed as recommended. Ready to execute; start with §0. |
| **Date** | 2026-09-25 |
| **Goal** | Deliver I2 as specified in [ITERATIONS.md §5](../ITERATIONS.md): journeys **J2.1–J2.8**, with I1's journeys still working |
| **Execution model** | Lean (§5): the main session writes contracts and does integration; **three** Sonnet agents with compact, self-contained briefs, **at most two at a time**; one user look before any real-agent validation |
| **Builds on** | I1 at `4d8fae8` on `iteration/i1` |

---

## 0. Handover: start here (for a new session)

**State.**
- Branch `iteration/i1` holds I1, complete as a demo, plus this plan. Create `iteration/i2` from it.
- I1's formal validations were deliberately deferred (§8).
- The I1 plan and its reports are in `iterations/I1-PLAN.md` and `iterations/I1/`. Read them only if you need detail.

**Read first** (keep it to these; I1 overspent on reading):
- this plan;
- `CLAUDE.md` (conventions; its "stop rule" still applies to subagents);
- `ITERATIONS.md` §5 (the I2 journeys);
- the contracts in `packages/core/src/{domain,ports,api,events}.ts` and `packages/db/src/schema.ts`.

**Packages as built in I1.**

| Package | Contents |
|---|---|
| `packages/core` | Contracts, plus the pure rules in `src/rules/`: lifecycle, readiness, versioning, gates, rollup, actions. Node-only helpers are in `@workbench/core/node`. |
| `packages/db` | Drizzle schema, migrations, repositories, leases |
| `packages/store` | Item files, seeds, Git checkpoints, `plan.md` projection |
| `packages/agents` | SDK adapter `sdk.ts`, guards, work toolset, prompts, activity mapping, runtime with one nudge, scripted fake runtime and `fake-scripts/`, the `agents:try` CLI |
| `packages/server` | Fastify routes, services, `runService`, scheduler, `WorkPort`, checkpoints, startup reconciliation and orphan cleanup, views, `demo:headless` |
| `apps/web` | React UI: start page, process view v0 (React Flow + ELK), item detail, asset viewer, Inbox |

**Commands.**

| Command | What it does |
|---|---|
| `pnpm dev:fake` | Fake agents, no cost. Web on :5317, API on :4317. |
| `pnpm dev` | Real Haiku agents |
| `pnpm test`, `pnpm typecheck` | 290 tests, all green at handover |
| `node e2e/walks/i1.cjs` | Acceptance walk for J1.1–J1.8. Needs `dev:fake` running; exit 0 = pass. |
| `pnpm demo:headless --fake` | The same flow through the API, without a browser |

**Gotchas found in I1.**
- **Port 5173 is taken on this machine** by another project, so the web app uses 5317.
- **`tsx watch` hangs under `concurrently`**, so the server's dev script runs without watch mode. Restart it after server changes.
- **Leftover servers.** If `dev:fake` fails with `EADDRINUSE`, a previous server (possibly the user's own `pnpm dev`) is still on 4317. Ask the user or check the process before killing it.
- **Process filtering.** Node processes started by `pnpm` don't always show the repo path on their command line. Find leftovers by port, not by command line.
- **React Flow v12 custom nodes need `<Handle>`s** or edges silently disappear. The process view remounts per layout to stay correct during live updates.
- **The real Work Agent tends to decide instead of asking.** Hence D2 in §3.
- **Usage.** The previous session nearly used two 5-hour Claude windows. Follow §2 and §5 strictly: compact briefs, at most two subagents at a time, and the main session integrates.

---

## 1. What I2 delivers

The human can start an engagement **from an empty page by talking to the Approach Agent**. The agent:
- asks clarifying questions;
- writes and publishes `context` and `stakeholders`;
- proposes a plan, which the human reviews as a list of operations with a preview in the process view and then approves;
- answers Work Agent questions first, and escalates the ones it can't answer, adding its own view;
- turns a Work Agent's suggestion, or a request from the human, into a plan change.

Starting from a seed (J1.1) still works, and every I1 journey keeps working.

**Journeys** (ITERATIONS §5.2):

| Journey | What it covers |
|---|---|
| J2.1 | Kick-off in a conversation |
| J2.2 | Approve a plan proposal |
| J2.3 | The Approach Agent answers a question |
| J2.4 | The Approach Agent escalates a question |
| J2.5 | A Work Agent proposes a plan change |
| J2.6 | The human asks for a plan change |
| J2.7 | "Where are we?" |
| J2.8 | Change settings |

---

## 2. Lessons from I1 that shape this plan

| I1 observation | I2 response |
|---|---|
| I1 used almost two full 5-hour usage windows. Each Sonnet agent spent 200–400k tokens, mostly reading DESIGN, ARCHITECTURE and ITERATIONS before writing code. Three agents in parallel hit the session limit mid-work. | **Compact briefs**: each agent gets a self-contained brief (≤ 1.5 pages) naming at most about 8 files to read. It gets no instruction to read the design documents; the brief carries what it needs. **At most two agents at a time.** |
| Look reports, screenshots and per-journey test suites were expensive and were mostly cut anyway. | Agents finish with a ≤ 20-line final message, and there are no look-report files. Tests cover the **pure rules** plus **one API-level flow test** per package. |
| The integration bugs (no edges, a hanging dev script, a blank canvas) were found by the main session's headless click-through, not by the agents' unit tests. | The **walk script becomes the acceptance test.** It is committed as `e2e/walks/i1.cjs` and gets an `i2.cjs`, run on the fake runtime at no cost. The main session keeps integration and fixes small issues itself. |
| The fake agent made the UI testable at no cost and caught real bugs. | A **fake Approach Agent** with scripts for every I2 journey. |
| Real Haiku made a defensible choice silently instead of asking a question (both real runs). | Decision D2 (§3), plus a small benchmark after the look (S6-lite, §6). |
| WI-003 became ready while WI-002's output was still under review. | Decision D1 (§3). |

---

## 3. Decisions (confirmed by the user on 2026-09-25)

| # | Question | Decision |
|---|---|---|
| **D1** | Should a consumer wait until its input has **passed its producer's gate**, or only until it is **published**? | **Passed the gate.** An item becomes ready only on inputs whose producer is `done`. Items without a gate are unaffected. This is a small change to the readiness rule, noted in D§4.2. |
| **D2** | When a Work Agent makes a judgement call on something its brief flags as open, should it say so? | **Yes, as a non-blocking question.** It raises the question with its hypothesis and carries on. The Approach Agent or the human can still override the answer (J2.3), and the choice becomes visible without stopping the work. Implemented as a change to the protocol prompt. |
| **D3** | Default question handling for new engagements? | **`aa-first`** (the D§8.1 default). The seed's `defaults.yaml` changes to match. |
| **D4** | Visibility of the approach journal (A§20.1-4)? | **Visible, read-only**, in an "Approach" tab. |
| **D5** | What happens to a chat message sent while the agent is mid-turn (M0 S5)? | **It is queued in the UI** and sent when the turn ends. The UI shows "queued". |
| **D6** | Compare planning on the `demo` profile (Opus 5.5) against Haiku? | **Optional, after the look**: one J2.1 + J2.2 run, ≤ $3. **Ask the user first**; this is not pre-approved. |

---

## 4. Technical design (the decisions the agents must not have to make)

### 4.1 Approach Agent sessions

- **Conversation turn = one `query()` with `resume`.** Each human message starts a query that resumes the thread's session. There is no long-lived streaming session. This gives:
  - natural turn boundaries (which is what makes D5's queueing possible);
  - restart safety (validated in M0 S5);
  - the same lease mechanism as Work Agents, with lease key `aa-thread:T-0001`.
- **Briefing.** The first turn of a session starts with a deterministic situation briefing built by the server, with no LLM involved:
  - the engagement name and settings;
  - the plan at depth 2 with statuses;
  - open requests;
  - pending proposals.

  Every later turn is prefixed with "Since your last turn:", followed by the events since then, up to 20 lines.
- **Task sessions** (lease key `aa-task:<requestId>`, one at a time, queued by the server). They start in two cases:
  1. a routed question, using the prompt `approach-question.md`. The session must end with `answer_request` or `escalate`. If it does neither, the server escalates with "The Approach Agent did not decide";
  2. a Work Agent suggestion, using `approach-suggestion.md`. The session ends with `propose_ops` or `decline_suggestion(reason)`.
- **SDK options** follow the Work Agent's (M0-FINDINGS §2), with these differences:

  | Option | Approach Agent value |
  |---|---|
  | `cwd` | `items/ENG/work` (so `Edit(./**)` scopes writes to it) |
  | `additionalDirectories` | `[engagement root]` |
  | MCP toolset | `plan` instead of `work` |
  | Skills | none in I2 |
  | Guards | reads are allowed anywhere in the engagement **except** other items' `work/`, `.workbench/` and `.git/`; writes only to `ENG/work`; no Bash |

### 4.2 `plan` toolset (bound per session, over a new `ApproachPort`)

| Tool | Behaviour |
|---|---|
| `get_plan()` | A compact readable plan: items, status, inputs, outputs with latest versions, gates, plus `planVersion` and a suggested next free id |
| `get_item(id)` | Definition, status, versions, open requests |
| `propose_ops(ops[], rationale)` | Validates against the current plan. **On errors it returns them to the agent and creates nothing** (J2.2: the human never sees an invalid proposal). On success it creates proposal `P-0001` (base version = current). A new proposal from the same thread supersedes that thread's pending one. |
| `answer_request(id, text)` / `escalate(id, view)` | Task sessions only |
| `decline_suggestion(id, reason)` | Suggestion sessions only |
| `publish_engagement_asset(slot, sourcePath, kind, note)` | Like `publish_asset`, for ENG slots |
| `journal_append(entry)` | Appends to `ENG/work/approach-journal.md`, written by the server |
| `notify_human(text)` | An FYI entry in the Inbox, dismissible |

### 4.3 Plan operations (pure rules in `packages/core/src/rules/planOps.ts`)

| Op | Rules |
|---|---|
| `add_item {def}` | The id is supplied by the agent and must be unique; the parent must be a composite or null; a new leaf starts `waiting` |
| `update_brief {itemId, brief?, acceptance?}` | Only for `waiting` or `ready` items |
| `rewire {itemId, inputs}` | Only for `waiting` or `ready` items; every input slot must exist (in the plan or added in the same proposal) |
| `add_slot {itemId, output}` / `remove_slot {itemId, slot}` | A slot with versions or consumers can't be removed |
| `set_gate {itemId, gate}` | `[]` or `[{type: human-review}]` in I2 |
| `cancel_item {itemId, reason}` | Only for `waiting` or `ready` items; not while other items consume its outputs |

Apply order:
1. validate the whole proposal against the current plan and `basePlanVersion` (**a moved version means reject**; full re-validation arrives in I5);
2. write the `item.md` files;
3. upsert the DB index;
4. bump `planVersion` (in `engagement.yaml` and the DB meta);
5. emit `ProposalApplied` and `PlanChanged`;
6. make a checkpoint commit and tag it `plan/vN`;
7. recompute readiness and autostart.

`previewPlan(plan, ops)` returns the proposed `PlanView` for the preview toggle.

### 4.4 Contract deltas (written by the main session in P0)

| File | Change |
|---|---|
| `domain.ts` | `PlanOp` union; `Proposal` (`P-0001`; origin; `suggestedBy?`; status `pending \| approved \| rejected \| superseded`; `basePlanVersion`; rationale; ops; `appliedPlanVersion`; `rejectReason`); `Thread` (`T-0001`); `ChatMessage` (role `human \| approach \| system`; body; `runId?`; `proposalId?`); `Notification` (`N-0001`); `SuggestionPayload`; an `escalation {view, by, at}` on question requests; a `routedTo` field; `RunReason` gains `aa-turn` / `aa-question` / `aa-suggestion`. **Default `questionHandling` becomes `aa-first`.** |
| `events.ts` | `ProposalCreated/Applied/Rejected/Superseded`, `PlanChanged`, `ChatMessagePosted`, `QuestionRouted`, `QuestionEscalated`, `SuggestionDeclined`, `HumanNotified`, `NotificationDismissed`, `SettingsChanged`, `JournalAppended` |
| `ports.ts` | `ApproachPort` (the tools in §4.2), `ApproachRuntime` (`startTurn`, `startTask`, returning the existing `RunHandle`). The work tools gain `propose_plan_change(summary, suggestedOps?)`. |
| `api.ts` | Routes for threads (list; get with messages; post message → 202), proposals (get, preview → `PlanView`, approve, reject), `PATCH` settings, `GET`/`PATCH` profile, notifications (list, dismiss), the journal, and question override. `createEngagement` accepts the `blank` seed. Inbox entry kinds gain `proposal` and `fyi`; the `question` entry carries `routedTo` and `escalation`. `ItemNode` gains `planVersion`. The WebSocket `activity` message gains an optional `threadId`, and `itemId` becomes `"ENG"` for Approach runs. |
| `schema.ts` | New tables `proposals`, `threads`, `chat_messages`, `notifications`, and a minimal `agenda_items` (id, kind, status, links; a question gets a row, with no behaviour yet); the column `requests.escalation`; one migration |
| `demo/seeds/blank/` | Only the ENG item, with output slots `context` and `stakeholders` and no assets |

---

## 5. Work packages

Each agent gets a brief that includes: its paths, the files to read (≤ 8), the contract deltas above, exact function signatures where packages meet, the checks to run, and "finish with a ≤ 20-line message; no look-report file; stop before any real-agent validation".

| Package | Who | Builds | Checks before stopping | Depends on |
|---|---|---|---|---|
| **P0** | Main | The contract deltas (§4.4) and the migration; the `blank` seed; the three briefs. (`e2e/walks/i1.cjs` already exists; it was committed during planning.) | Typecheck; `i1.cjs` passes | — |
| **A: ENGINE + SERVER** | Sonnet | <ul><li>`planOps.ts` (validate, apply to defs, preview) with tests</li><li>D1 in `readiness.ts`</li><li>repositories for the new tables</li><li>services: threads and turns (lease, briefing and delta text, message persistence, queue); proposals (create from the port, supersede, approve → apply per §4.3, reject); question routing (aa-first → agenda row + task queue + fallback escalation; always-human → as in I1); suggestions; override (only when the item isn't running); notifications; settings and profile (profile override in `workspace/.workbench/settings.json`); journal</li><li>`ApproachPort` implementation, views, routes</li><li>`demo:headless` extended with a J2 script</li></ul> | Typecheck; the rule tests; one API-level flow test (blank → kick-off turn → proposal → approve → WI-002 runs → question answered by the Approach Agent); `demo:headless --fake` | P0 |
| **B: APPROACH RUNTIME** | Sonnet | <ul><li>In `packages/agents`: `createSdkApproachRuntime` / `createFakeApproachRuntime`, the `plan` MCP toolset, Approach Agent guards (with tests), and the `propose_plan_change` work tool</li><li>Prompts: `approach-conversation.md` (role, clarifying-question style, how to plan with the operations, granularity `medium`, the "never do substantive work" rule), `approach-question.md`, `approach-suggestion.md`</li><li>The D2 protocol tweak in `protocol.md` and the skill</li><li>Fake Approach scripts: the kick-off dialogue that publishes context and stakeholders, then proposes the acme plan (the same items as the seed); question handling (answer the first question, escalate the second); a suggestion that becomes a proposal (CFO follow-up)</li><li>An `agents:try-approach` CLI over an in-memory `ApproachPort`</li></ul> | Typecheck; guard and toolset tests; the fake CLI; **one real smoke**: a kick-off turn plus a plan proposal on Haiku, ≤ $0.15 | P0 (in parallel with A) |
| **C: WEB UI** | Sonnet, after A or B stops | <ul><li>Left panel with **Chat** and **Inbox** tabs</li><li>Chat: messages; streaming activity of the running turn; proposal cards inline; asset links; a send box with the queued state (D5)</li><li>Proposal card (rationale, readable operations, **Preview** toggle that swaps the process view to the preview `PlanView` with a banner, Approve / Reject with a reason)</li><li>Inbox: `proposal`, `fyi` (dismiss), and the question card showing "Answered by the Approach Agent" + **Override**, or the escalation view</li><li>Settings panel (question handling, item start, profile)</li><li>Approach tab (the journal, read-only)</li><li>"Start with the Approach Agent" on the start page</li><li>Plan version in the header</li></ul> | Typecheck; existing tests | P0; API from A |
| **Integration** | Main | Wire it together; `e2e/walks/i2.cjs` covering J2.1–J2.8 on the fake runtime; `i1.cjs` still green; fix small issues directly | Both walks pass at $0 | A, B, C |

**Order:** P0 → A and B in parallel → C (it starts when the first of A or B stops) → integration → **your look**.

---

## 6. Your look, then validation

**The look** is one session of about 15 minutes, at no cost:
- run `pnpm dev:fake`;
- click *Start with the Approach Agent* and follow the scripted kick-off;
- approve the proposal, and watch a question being answered by the Approach Agent and another one escalated;
- approve a CFO follow-up suggested by a Work Agent.

A short "Try I2" section in the README lists the steps.

**After your go**, these run on the `test` profile:

| Step | What it tells us | Cost |
|---|---|---|
| **Real pass**: a blank engagement → kick-off on Haiku → plan proposal → approve → WI-002 runs, and any question goes through the Approach Agent | Learning questions 1 and 2 | ~$0.60–1.00 |
| **S6-lite**: 5 WI-002 runs after the D2 protocol change, counting how often the agent flags the CIO choice as a question | Whether D2 works | ~$0.40 |
| **Guard canary battery** (ported from s03) for **both** roles, once. The Approach Agent's wider read scope is new attack surface. | Locus of control holds for both roles | ~$0.50–0.80 |
| *Optional (D6)*: J2.1 + J2.2 on the `demo` profile | Haiku versus Opus planning quality | ≤ $3 |

**API budget:** about $2–3, capped at **$5** on the `test` profile; D6 comes on top.

**Claude usage target:** one 5-hour window for P0 through integration. That means about 150–250k tokens per agent and a lean main session. If an agent hits the limit, it is resumed with its context; no work is lost, as happened in I1.

---

## 7. Done when

1. **J2.1–J2.8 pass** in `e2e/walks/i2.cjs` on the fake runtime, and **J1.1–J1.8 still pass** in `i1.cjs`.
2. The real pass completes: a plan proposed by Haiku is approved, and at least one question has been handled by the Approach Agent.
3. The guard battery finds zero leaks for both roles, and there are no `LocusViolation` events.
4. `pnpm test` and `pnpm typecheck` are green.
5. **Docs updated:**
   - D§4.2 (the R5 clarification and D1);
   - A§6.2 (the new tables);
   - A§8.1 (conversation turns as resume-per-message);
   - ITERATIONS §5 (any journey changes).
6. **Your notes** are in `iterations/I2-TEST-NOTES.md`, via Feedback or directly.

---

## 8. Carried over from I1, still deferred

| Item | Where it goes |
|---|---|
| The full S6 benchmark (10 runs, placement A versus B) | Replaced by S6-lite (§6); rerun only if S6-lite is poor |
| Restart and kill robustness tests (R1, R2) and the Playwright journey suite | I3, or earlier if you hit one of these problems while testing. The walk scripts cover the happy paths. |
| Lease-race stress test and Git round-trip validation | Before the first multi-session work in I5 |
| Reverting stray writes in the locus audit (detection exists) | I4, when Bash items arrive |
