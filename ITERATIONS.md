# Agentic Project Workbench — Iteration Plan

| | |
|---|---|
| **Status** | Draft v1 |
| **Date** | 2026-09-23 |
| **Companions** | [DESIGN.md](DESIGN.md) (functional design, "D§"), [ARCHITECTURE.md](ARCHITECTURE.md) (technical architecture, "A§"), [spike/M0-FINDINGS.md](spike/M0-FINDINGS.md) |
| **Implementation plans** | [iterations/I1-PLAN.md](iterations/I1-PLAN.md) |
| **Replaces** | The delivery order of the milestones in A§18. The milestones remain as capability areas; this document decides in which order they are delivered. |

---

## 1. Why iterations instead of milestones

The milestones M1–M8 in A§18 are layers: core, then the Work Agent runtime, then the Approach Agent, then the UI. The first thing a person can click on arrives in M4. That is four milestones of building before we learn whether the central idea works for a consultant: approach separated from execution, and a visible process that the human steers.

This plan cuts the same work into **vertical slices**. Every iteration ends with an app that runs in the browser with real agents. Someone can use it for a realistic session, and each iteration has a small set of questions it must answer. Each layer is built only as deep as the slice needs, and it grows in later iterations.

### 1.1 Principles

1. **Journeys are the specification.** Each iteration defines its **core user journeys** (§4 onwards). An iteration is done when those journeys work end to end in the browser. They are also the test script for the human test session.
2. **The journey must be correct; the styling can be minimal.**
   - Every step of a journey can be done in the UI, without touching files or the terminal, unless the journey says otherwise.
   - What the UI shows is correct and live: it updates without a refresh and never shows stale state.
   - Every action gives visible feedback: pending, done, or failed with a reason.
   - Plain CSS is fine. Layout polish, theming and animation are out of scope until I7.
3. **The process is visible from the first iteration.** The process view is central to the idea, so I1 ships a minimal read-only process view (v0). I3 is dedicated to making it the full workflow canvas.
4. **Riskiest first within an iteration.** Each iteration starts with the part most likely to fail. In I1 that is the Work Agent runtime and the Haiku protocol benchmark, run without a UI.
5. **Real agents, cheap profile.** Test sessions run on the `test` profile (Haiku 4.5). Where output quality matters, one run is repeated on the `demo` profile (I1, I2, I6).
6. **Re-plan after every test session.** The findings from the session can reorder or reshape the next iterations. The order after I3 is deliberately flexible (§12).

### 1.2 Definition of done (every iteration)

| # | Criterion |
|---|---|
| 1 | Every core journey of the iteration works end to end in the browser with real agents on the `test` profile. |
| 2 | Every core journey has an automated Playwright test that runs on the **scripted fake agent**. The fake agent is a deterministic agent that calls the real toolsets, so the test costs nothing. |
| 3 | The engine rules added in the iteration have Vitest unit tests. |
| 4 | **Locus of control holds.** The post-run audit shows zero violations across the test session (DESIGN success criterion 8, checked from I1 onwards). |
| 5 | Journeys from earlier iterations still pass. Where a journey changed on purpose, it is listed under "Changed journeys". |
| 6 | A **test session** has been held (§1.3), and its notes are written to `iterations/I<n>-TEST-NOTES.md`. |
| 7 | ARCHITECTURE.md and DESIGN.md are updated wherever the iteration changed a decision. |

### 1.3 Test session protocol

- **Testers**: the product owner, optionally with one consultant colleague. The journeys must therefore make sense to someone who has not read the design.
- **Script**: the iteration's core journeys, in order, on the seed or scenario named in the iteration. Budget 20–40 minutes.
- **Capture**:
  - An in-app **Feedback** button (from I1) records a note together with the current view, the selected item and a timestamp in `workspace/feedback.jsonl`.
  - Per journey, record pass, fail or confusing.
  - Record the session's cost and duration.
  - Record the answers to the iteration's learning questions.
- **Output**: `iterations/I<n>-TEST-NOTES.md`, followed by a short re-plan of the next iteration.

---

## 2. Iterations at a glance

| # | Iteration | What a tester can do at the end | Demo steps (D§11) | Learning questions |
|---|---|---|---|---|
| **I1** | **Walking skeleton** | Start an engagement from a seeded plan and see it as a process. Watch Work Agents run. Answer questions that come with a hypothesis, review outputs, and perform a human item. | 3 (without documents), 4 (without the Approach Agent), 6 (single item) | Is question + hypothesis the right way to interact? Does Haiku follow the Work Agent protocol? Are the outputs worth reviewing? What does a run cost? |
| **I2** | **Talk to the Approach Agent** | Kick off an engagement in a chat. Approve the plan the Approach Agent proposes. Questions go to the Approach Agent first. Plan changes can come from a Work Agent or from the human. | 1, 2, 4, 7 (partly) | Can the Approach Agent plan sensibly on Haiku? Does it take load off the human, or add noise? |
| **I3** | **The process canvas** | Read and steer the plan on a BPMN-lite canvas: collapse and expand, depth, focus, lanes, proposals shown as a ghost overlay, restructuring. | 2 (visual), 6 (visual) | Is the canvas readable at three levels and about 20 items? Is it where people act from? |
| **I4** | **Change happens** | Work from intake documents. Split interviews per executive. See minor versus material versions, stale items and re-runs. Reclassify versions and inspect implicit reads. | 3, 6, 8 | Does staleness feel right, or noisy? Does "read broadly, instruct narrowly" work? |
| **I5** | **Many things at once** | Prioritise the Approach Agent's agenda, run several conversations, use "wrong question → discuss", let the agenda be worked in the background, pause everything. | 5, 7 | Does the agenda model hold up under concurrent input? |
| **I6** | **Close the engagement** | Run gate chains with AI review, record a formal endorsement in the decision log, and export the board deck as PPTX and PDF. | 9, 10 | Are the gates worth their friction? Are the exported deliverables usable? |
| **I7** | **Reuse and demo** | Capture a playbook, search the library, start from a playbook, look back on the timeline, and rehearse the full demo. | 11, 12, full run | Can the full demo run in 30 minutes? |

**Traceability to the success criteria in D§12.3**

| Criterion | First shown in |
|---|---|
| 1 | Full demo in about 30 minutes: I7 |
| 2 | A plan change started by a Work Agent and one started by the human: I2 |
| 3 | Hypotheses and the amend path: I1. "Wrong question → discuss": I5 |
| 4 | Minor versus material, and a stale item that is re-run: I4 |
| 5 | Formal endorsement: I6 |
| 6 | PPTX/PDF from Markdown: I6 |
| 7 | Playbook capture: I7 |
| 8 | No Work Agent writes outside its own item: from I1, checked in every iteration |

### 2.1 How the layers grow

| Layer (milestone) | I1 | I2 | I3 | I4 | I5 | I6 | I7 |
|---|---|---|---|---|---|---|---|
| **Engine & DB** (M1) | Lifecycle, readiness, versions, requests, runs, events, leases, simple checkpoint commit, reconciliation | Plan operations, plan version, proposals (simple conflict check), agenda rows | `split`, `merge`, `move` | Staleness, consumptions, reclassification, `reopen` | Full optimistic concurrency, triggers, claims | Gate chains, decisions | Tags, restore |
| **Work Agents** (M2) | Full runtime, guards, core work tools, resume, nudge, S6 benchmark, orphan cleanup | `propose_plan_change`, questions answered by the Approach Agent first | — | `stale-rerun`, first Bash item, extraction, `request_asset_change`, implicit reads | S7 soak test | Export items | Fake replay of recorded runs |
| **Approach Agent** (M3) | — | One conversation, briefing, planning, question task sessions | Restructuring operations | Impact explanations | Agenda service, triage lane, several threads, deltas | AI review task | Playbook capture and use |
| **Process view** (M5) | v0: flat, read-only, ELK layout | Preview of a proposal | **Full canvas**: collapse, depth, focus, lanes, ghost overlay, tree view | Version labels, implicit-read edges | Agenda links | Endorsement gateways | — |
| **Other UI** (M4) | Item detail with live activity, asset viewer, Inbox, gate verdict, Feedback | Chat, proposal review, settings | — | Version diff, uploads, reclassification | Agenda board, discuss | Endorsement form, decision log | Library, timeline, checkpoints |
| **Skills & docs** (M7) | Workbench protocol, interview-guide design, thematic synthesis | — | — | Document extraction | — | PPTX/PDF export | Library catalog + FTS |

---

## 3. Built right from I1 (expensive to add later)

The following are **not** cut down in I1, even though I1 barely needs some of them:

| Item | Why now |
|---|---|
| The single SDK adapter (`packages/agents/sdk.ts`) with the configuration from M0-FINDINGS §2 | Every later agent feature goes through it. Stray `query()` calls are hard to find later. |
| **Guard hooks**: the full read-scope and write-scope rules from A§8.5 | M0 showed they are the *only* read-scope control. Locus of control has to hold from the first test. |
| The Plan Engine as the only code that changes status | Retrofitting "code decides what is allowed" is a rewrite. |
| Drizzle migrations | The schema grows in every iteration. |
| The `events` table with WebSocket push | Every live view and later the triggers depend on it. |
| Session leases | They are tiny, and "already running" bugs are nasty. |
| A pinned `CLAUDE_CONFIG_DIR` and a clean environment | Resume after a restart depends on them (M0 S5). |
| Per-run JSONL streams, plus cost and turns per run | The streams recorded in I1 test sessions become free fake-replay fixtures for UI work later (I3, I7). |
| The scripted fake agent | The Playwright journey tests need it from I1 onwards (§1.2). |
| A seed format that equals the playbook starter-plan format | I7 turns the seed into the first library playbook without inventing a new format. |

---

## 4. I1 — Walking skeleton

**Goal**: a human runs a small, realistic plan with real Work Agents, sees it as a process, and interacts with the agents through structured questions and reviews.

### 4.1 Scope

**In scope:**

- **Work Agent runtime** (most of M2):
  - The SDK adapter and the mandatory guards.
  - Work tools: `get_brief`, `publish_asset`, `append_worklog`, `raise_question`, `report_progress`, `submit_outputs`.
  - Run reasons: `start`, `resume-answer` and `changes-requested`.
  - Termination decided by the engine, with one nudge.
  - Subagents allowed (`Task`), with the guard denying the state-changing toolsets to them.
- **Engine** (about half of M1):
  - Item lifecycle.
  - Readiness based on declared inputs.
  - Autostart with a concurrency limit.
  - Asset versions: the kind is recorded but has **no effect** yet.
  - Requests of type question and gate request.
  - Human-review gates (a single gate, no chains).
  - Leases, events, checkpoint commits with a WAL checkpoint, and reconciliation at startup.
- **Seed**: `demo/seeds/acme-discovery/`, based on D§11 and reusing the text from `spike/fixtures/engagement-template/`. It contains:
  - `ENG/context` and `ENG/stakeholders`;
  - `PH-1 Discovery`:
    - `WI-002 Prepare interview guide` (agent, human review);
    - `WI-003 Conduct CxO interviews` (human, four output slots: `notes-ceo`, `notes-cfo`, `notes-coo`, `notes-cio`);
  - `PH-2 Synthesis`:
    - `WI-004 Consolidate themes` (agent, human review), with the four notes slots and the context as inputs.
  - Four pre-written interview notes in `demo/interview-notes/`.
  - WI-002's brief contains a real ambiguity (the CIO is new in the role), so the agent has a natural reason to ask a question.
- **UI**:
  - Engagement start page.
  - **Process view v0**: React Flow with an ELK layered layout. Tasks show an agent or human icon. Phases are always-expanded frames with a roll-up badge. Data-object nodes show their version, dashed while the slot is empty. A gate marker, status colours and live updates. Clicking a node opens the detail panel.
  - Item detail: definition, live activity, worklog, and runs with their cost.
  - Asset viewer: rendered Markdown and the list of versions.
  - Inbox.
  - Header with the engagement's cost total.
  - The Feedback button.
- **M0 carry-overs**:
  - **S6 benchmark**: run as the first step, as a go/no-go gate (§4.4).
  - Hard-kill **orphan test** and a process cleanup at startup (from S7).

**Out of scope** (and how the journeys avoid it):

- **The Approach Agent.** Questions go straight to the human through the existing `always-human` setting (D§8.1).
- **Plan operations in the UI.** The only plan change is editing a brief before an item runs (J1.7).
- **Staleness, reclassification, intake documents, Bash** (no Bash-enabled item exists in I1), **the agenda, gate chains, AI review, endorsements, exports, the library.**
- **Collapse, depth, lanes and ghost overlays** in the process view.

### 4.2 Core journeys

#### J1.1 Start an engagement from a seed
*Actor*: human. *Trigger*: the app opens with no engagement, or the human chooses "New engagement".

1. The start page lists the available seeds, with a title and one-line description, for example *Acme — Discovery (3 items)*.
2. The human picks the seed and confirms a name. The server creates `engagements/<id>/`, runs `git init`, writes the seed files, builds the DB and makes the first checkpoint commit.
3. The app opens the engagement on the process view. The engagement assets (context, stakeholders) are published at v1.0 with the author `human (seed)`.
4. WI-002 has all of its inputs, so it becomes **Ready** and, with autostart on, starts straight away (J1.3).

*Correct when*:
- The engagement folder matches the layout in A§5.2.
- `git log` shows one commit, attributed to the human.
- Opening the app again later shows the same engagement in the same state.

#### J1.2 Understand the plan
*Actor*: human.

1. The process view shows PH-1 and PH-2 as frames, each with a roll-up badge such as "0/2 done".
   - Inside them are the tasks: 🤖 WI-002, 👤 WI-003 and 🤖 WI-004.
   - Data objects sit between the tasks: `interview-guide` (dashed), four `notes-*` (dashed) and `themes` (dashed). The engagement assets are shown at v1.0.
   - The edges are derived from the declared inputs and outputs (D§2.1-1).
   - A review marker ◇ is shown on WI-002 and WI-004.
2. Clicking a task opens the detail panel. It shows:
   - the brief and acceptance criteria;
   - the inputs, with their versions or "not yet available";
   - the output slots, with scope and format;
   - the gate, the executor and the status;
   - the reason the item is not ready yet, for example "waiting for WI-003/notes-cfo".
3. Clicking a data object opens the asset viewer, or shows "not yet published" and the name of the item that will produce it.

*Correct when*:
- Every status in the view matches the DB.
- The reason an item isn't ready is always shown.

#### J1.3 Watch an agent work
*Actor*: human. *Trigger*: an item starts (autostart, or the human clicks **Start** on a ready agent item).

1. The item turns **In progress** in the process view without a refresh.
2. The item detail shows a live activity stream:
   - progress reports;
   - tool calls in readable form, for example "Read `ENG/context` v1.0", "Wrote `work/draft-guide.md`", "Published `interview-guide` v1.0 (material)";
   - guard denials, with their reason;
   - the model's short text messages.
   - Raw JSON can be expanded but is hidden by default.
3. When the agent publishes, the data object turns solid in the process view and shows its version.
4. When the agent calls `submit_outputs`, the item moves to **At gate**. The completion report is shown in the item detail:
   - a summary;
   - a self-check against each acceptance criterion;
   - open issues.
5. The run shows its outcome, number of turns, cost and duration. The engagement cost total in the header updates.

*Correct when*:
- The worklog contains the agent's entries.
- The published version file is immutable and sits in `assets/<slot>/`.
- A checkpoint commit exists for the publish and for the end of the run, attributed to `agent:WI-002`.

#### J1.4 Answer a question with a hypothesis
*Actor*: human. *Trigger*: a Work Agent calls `raise_question` with `blocking: true`.

1. The engine ends the run. The item turns **Blocked**, and the Inbox count increases.
2. The Inbox entry shows the item, the question, the agent's **hypothesis**, any alternatives, and the fact that it blocks work.
3. The human chooses one of:
   - **Approve**, which accepts the hypothesis as the answer;
   - **Amend**, which opens an editable box pre-filled with the hypothesis;
   - **Replace**, which opens an empty box.
4. The engine resumes the **same session** (`resume-answer`) with the answer and its mode. The item returns to **In progress**, and the Inbox entry disappears.
5. A *non-blocking* question also appears in the Inbox, but the agent carries on with its hypothesis. If the human later amends or replaces the answer, the item is re-opened with it.

*Correct when*:
- The question, the answer and the mode are in the worklog.
- The resumed agent uses the answer and does not ask again.
- The journey still completes if the server is restarted between steps 2 and 3.

#### J1.5 Review an agent's output
*Actor*: human. *Trigger*: an item reaches **At gate** with a human-review gate.

1. The Inbox shows "Review WI-002 — interview-guide v1.0". It links to the rendered asset and to the completion report.
2. **Request changes**, with a comment:
   - The engine resumes the Work Agent session (`changes-requested`) with the feedback.
   - The agent publishes a new version, for example v1.1, and submits again. The item is back **At gate** with a new Inbox entry.
3. **Approve**:
   - The item becomes **Done**.
   - Downstream readiness is recomputed: WI-003 becomes **Ready**.
   - The phase's roll-up badge updates.

*Correct when*:
- The verdict and comments are recorded against the exact version that was reviewed.
- Both versions stay viewable.
- Approving an old version is impossible once a newer one has been submitted.

#### J1.6 Perform a human item
*Actor*: human. *Trigger*: WI-003 becomes **Ready**.

1. The Inbox shows "Conduct CxO interviews — ready". It shows the item's inputs (`interview-guide` v1.1) with a view and download link, and the four empty output slots.
2. The human uploads a Markdown file into each slot. Each upload publishes v1.0 with the author `human`. The item moves to **In progress** on the first upload.
3. **Mark done** is only enabled once every required output slot has a version. When the human clicks it, the item becomes **Done**. WI-004 becomes **Ready** and starts.

*Correct when*:
- The uploads are immutable version files in WI-003's `assets/`.
- A wrong file type is refused with a clear message.

#### J1.7 Adjust an item before it runs
*Actor*: human. *Trigger*: the human wants to sharpen a brief, for example WI-004's, before it starts.

1. In the item detail of a **Waiting** or **Ready** item, the human edits the brief or the acceptance criteria and saves.
2. The server writes `item.md`, updates the DB index, emits an event and makes a checkpoint commit attributed to the human.
3. For an item that is **In progress** or later, editing is disabled, with an explanation that plan changes to running items arrive with the Approach Agent (I2).

*Correct when*: the next run of the item uses the edited brief.

#### J1.8 Inspect the engagement on disk
*Actor*: human. *Purpose*: transparency (D§2.1-9).

1. The engagement header has an "Open folder" link.
2. On disk, the human finds:
   - readable `item.md`, `worklog.md` and `assets/<slot>/vX.Y.md` files;
   - the projection `plan.md`;
   - a `git log` whose commits are attributed to the human, `agent:WI-00x` or the system, with workbench trailers.

*Correct when*: `plan.md` matches what the process view shows.

### 4.3 Robustness journeys (carried forward in every iteration)

| # | Situation | Expected behaviour |
|---|---|---|
| R1 | The server restarts during a run | At startup the expired lease is cleared and the run is marked **interrupted**. The item shows "Interrupted — Resume". **Resume** continues the same session, which needs the pinned config dir. |
| R2 | The server process is killed hard (Task Manager / `taskkill /F`) | After a restart, no orphaned Claude Code processes remain. The cleanup at startup kills children recorded in the DB. R1 then applies. |
| R3 | The agent ends its turn without `submit_outputs` and without a question | The engine sends one automatic nudge. If that also fails, the Inbox shows a **run issue** with the agent's last message and the options **Retry** and **Stop**. |
| R4 | The agent tries to read or write outside its locus | The guard denies it, and the agent sees the reason. The denial appears in the activity stream and in the run's denial count. The post-run audit reports zero violations. |
| R5 | The human clicks **Stop** on a running item | The run is interrupted (`interrupt()`) and the item returns to **Ready** with a **Resume** option that keeps the session. *(A lifecycle clarification to add to D§4.2.)* |
| R6 | The human clicks Start twice, or starts an item that is already running | The second request is refused with "already running" (lease). |

### 4.4 Order of work

1. **Runtime without UI**: build the SDK adapter, guards, work toolset and run records, and drive WI-002 from a script. Then run the **S6 benchmark**: 10 runs with the real `work-agent.md` prompt and `workbench-protocol` skill, with ambiguity injected, comparing the protocol in the system prompt with the protocol in a skill. **Go/no-go**: if Haiku's protocol adherence is poor, fix the prompt, tools and nudge first, or move the `test` profile to a stronger work model before building the UI.
2. **Engine, DB, store and seed** for the three-item chain, with Vitest tests.
3. **API, WebSocket and UI** for J1.1–J1.8, the scripted fake agent, and Playwright tests.
4. **Robustness**: R1–R6, including the orphan test.
5. **Test session.** Repeat J1.3 and J1.5 once on the `demo` profile to compare output quality.

### 4.5 Learning questions

1. Does the question + hypothesis interaction feel right? Do testers mostly approve, amend or replace?
2. Does Haiku follow the Work Agent protocol: publish, then submit, with no work after a blocking question? How often is the nudge needed?
3. Are the outputs of the `test` profile good enough to be worth reviewing, or do reviews only make sense on the `demo` profile?
4. Is the live activity stream understandable to a non-developer?
5. Cost and duration per item, and for the whole seed.

---

## 5. I2 — Talk to the Approach Agent

**Goal**: the human no longer starts from a seed plan. The Approach Agent shapes the engagement and the plan in a conversation, handles Work Agent questions first, and turns proposals into plan changes.

### 5.1 Scope

**In scope:**

- **One general conversation thread** with the Approach Agent. It streams and can be resumed across restarts.
  - A deterministic **situation briefing** is built at the start of the session.
  - **Decision to make here** (from M0 S5): messages the human sends while the agent is mid-turn are *queued* in the UI, not merged into the running turn.
- **`plan` tools (subset):**
  - `get_plan`, `get_item`;
  - `propose_ops`;
  - `answer_request`, `escalate`;
  - `publish_engagement_asset`;
  - `journal_append`;
  - `notify_human`.
- **Plan operations**: `add_item` (including composites and a parent), `update_brief`, `rewire`, `add_slot`/`remove_slot`, `set_gate` (none or human review) and `cancel_item`.
- **Proposals**, carrying `base_plan_version`. Because I2 has at most one proposing session at a time, a proposal is simply rejected if the plan version has moved. Full re-validation arrives in I5.
- **Question routing `aa-first`**:
  - Each routed question creates an **agenda row** (no board yet) and starts an Approach Agent **task session**.
  - That session either answers the question or escalates it with its own view.
  - Task sessions for questions run one at a time.
- **Work Agent tool** `propose_plan_change` → Approach Agent task session → a proposal to the human.
- **Settings panel**:
  - question handling (`aa-first` / `always-human`);
  - item start (`manual` / `auto`);
  - plan changes (`propose` only in I2);
  - model profile (`test` / `demo`).
- **The process view** can preview a pending proposal: a toggle between the current plan and the proposed plan.
- **Decision to make here**: the visibility of the approach journal (A§20.1-4). The proposal is that the human can see it but not edit it.

**Out of scope**: several threads, the agenda board, triage, triggers, claims, "discuss" (all I5); `split`, `merge` and `move` (I3); `reopen_item` (I4); AI review (I6).

### 5.2 Core journeys

#### J2.1 Kick off an engagement in a conversation
*Actor*: human. *Trigger*: "New engagement" → **Start with the Approach Agent** (the seed option from J1.1 remains).

1. The human describes the engagement, for example the kick-off text of D§11 step 1.
2. The Approach Agent asks clarifying questions, a few at a time, and the human answers.
3. The Approach Agent drafts `context.md` and `stakeholders.md` in `ENG/work/` and publishes them with `publish_engagement_asset`. The chat shows "Published ENG/context v1.0" with a link.
4. The human reads the assets. If the human asks for a correction in the chat, a new version is published.

*Correct when*:
- The engagement assets are versioned, authored by `approach:<session>`, and visible as data objects in the process view.
- Closing the browser and coming back resumes the same conversation.

#### J2.2 Review and approve a plan proposal
*Actor*: human. *Trigger*: the Approach Agent calls `propose_ops`.

1. A proposal card appears in the chat and in the Inbox. It shows:
   - the rationale;
   - the list of operations in readable form, for example "Add WI-004 *Consolidate themes* under PH-2, inputs: …, output: themes (md)";
   - a **Preview in process view** toggle.
2. The human can **approve**, **reject** with a reason, or reply in the chat asking for changes. Asking for changes produces a new proposal that supersedes the old one.
3. On approval:
   - the engine validates and applies the operations, writes the `item.md` files and bumps the plan version;
   - it makes a checkpoint commit;
   - readiness is recomputed, and ready agent items start (autostart).

*Correct when*:
- A proposal that fails validation (for example a dependency cycle or an unknown slot) is never shown to the human. The Approach Agent receives the errors and fixes them.
- The plan version is visible, and every applied proposal is in the event log.

#### J2.3 A Work Agent's question is answered by the Approach Agent
*Actor*: system → Approach Agent. *Trigger*: a Work Agent raises a question while `aa-first` is set.

1. The item turns **Blocked**. The item detail shows "Question sent to the Approach Agent".
2. A task session of the Approach Agent reads the question, the hypothesis, the brief and the context.
3. If the context is sufficient, it answers (`answer_request`). The Work Agent session resumes with the answer.
4. The human sees the question and the Approach Agent's answer in the item's activity and worklog, and gets an FYI notification. The human can still **override** the answer. That re-opens the item with the new answer, as in J1.4 step 5.

*Correct when*: an answer from the Approach Agent is always attributed to the Approach Agent and can always be overridden.

#### J2.4 The Approach Agent escalates a question
*Actor*: Approach Agent → human.

1. The Approach Agent calls `escalate` with its own view.
2. The Inbox entry shows the Work Agent's question, its hypothesis, the alternatives, **and the Approach Agent's view**.
3. The human approves, amends or replaces the answer, as in J1.4. The Work Agent resumes.

*Correct when*: this is demo step 4 end to end, including the amend path.

#### J2.5 A Work Agent proposes a plan change
*Actor*: Work Agent → Approach Agent → human. *Trigger*: for example, WI-004 notices that budget appetite was never discussed with the CFO.

1. The Work Agent calls `propose_plan_change` with a summary and optional suggested operations, then continues or submits.
2. An Approach Agent task session assesses the suggestion. It creates a proposal of its own (J2.2), for example "Add WI-003e *CFO follow-up interview* (human)", or it declines with a reason that is recorded.
3. The human approves the proposal in the Inbox. The new item appears in the process view and becomes ready.

*Correct when*: the proposal shows its origin ("suggested by WI-004"). *Note*: re-running WI-004 after the follow-up arrives with `reopen_item` in I4.

#### J2.6 The human asks for a plan change
*Actor*: human. *Trigger*: for example, "Add a short benchmarking item before synthesis."

1. The human asks in the chat. The Approach Agent proposes the operations (J2.2), and the human approves.

*Correct when*: this is success criterion 2 (a change started by the human), next to J2.5 (a change started by a Work Agent).

#### J2.7 Ask "where are we?"
*Actor*: human.

1. The Approach Agent answers from the briefing and the plan tools: what is done, what is running, what is blocked and why, and what needs the human.

*Correct when*: every fact in the answer matches the plan state. This is checked by the tester against the process view.

#### J2.8 Change a setting
*Actor*: human.

1. The human switches question handling to `always-human`. New questions skip the Approach Agent (J1.4). Switching back restores `aa-first` (J2.3).
2. Switching the model profile applies to *new* sessions. Running sessions finish on their current model. The model used is shown on each run.

### 5.3 Changed journeys

- **J1.4** now starts with the Approach Agent when `aa-first` is set (J2.3/J2.4). The direct path remains under `always-human`.
- **J1.7**: editing a brief by hand is still allowed. It is now also recorded as a plan-version bump.

### 5.4 Learning questions

1. Can the Approach Agent produce a sensible plan on Haiku, or does planning need the `demo` profile?
2. What fraction of Work Agent questions does the Approach Agent answer on its own, and are those answers good?
3. Is a proposal readable as a list of operations plus a preview, or does it need the ghost overlay of I3?
4. Is one conversation thread enough at this size?

---

## 6. I3 — The process canvas

**Goal**: the process becomes the primary way to read and steer the plan (D§10.2). This iteration starts with a short UI spike on readability, using a synthetic plan of about 25 items at three levels.

### 6.1 Scope

**In scope:**

- The full **workflow canvas**:
  - tasks, composites (collapse/expand), multi-instance markers, data objects with version labels, gateways and status;
  - ELK hierarchical layout;
  - a global **depth** control, **focus** mode, and the two view modes **Hierarchy** and **Lanes**;
  - a **ghost overlay** for pending proposals, with approval possible from the canvas;
  - a stable layout: nodes don't jump when unrelated parts change.
- A **tree view** with the same depth control, for large plans.
- **Restructuring operations**: `split_item`, `merge_items` and `move_item`, through the Approach Agent.
- The view state (depth, collapsed nodes, mode) is remembered per engagement.
- Recorded runs from I1/I2 are replayed through the fake agent, so the canvas can be developed without API cost.

**Out of scope**: implicit-read edges (I4), endorsement gateways with a forum label (I6).

### 6.2 Core journeys

#### J3.1 Read the process
1. The Workflow view shows phases as sub-processes, tasks with 🤖 or 👤, data objects between the tasks, ◇ review gates and colour-coded status.
2. Hovering over a node shows a summary. Clicking it opens the detail panel, as in I1.
3. Edges always run producer → data object → consumer.

*Correct when*: every element in the notation table of D§10.2 that exists in the current plan is rendered, except implicit reads and endorsement gateways.

#### J3.2 Control the level of detail
1. The human sets the depth to 1: only phases are shown, each with a roll-up badge such as "4/6 ✓, 1 ⚠".
2. The human expands one phase inline, and collapses it again.
3. Collapsed composites still show their data flows at the boundary: the inputs they consume from outside, and the outputs other items consume.

*Correct when*: a roll-up always reflects the *worst* child status (D§4.2) and the correct counts.

#### J3.3 Focus on one composite
1. **Focus** on PH-2 shows its children expanded, plus a compact view of the items outside PH-2 that feed it and that consume it. Everything else is hidden.
2. **Exit focus** returns to the previous view state.

#### J3.4 Switch to lanes
1. **Lanes** mode shows *Human* and *Agents* swimlanes. Tasks sit in their executor's lane, and composites are shown as bands across the lanes.
2. Switching back to **Hierarchy** keeps the selection and the depth.

#### J3.5 Review a proposal on the canvas
*Trigger*: a pending proposal exists.

1. The canvas shows a ghost overlay:
   - added items and slots are dashed and highlighted;
   - removed items are struck through;
   - rewired edges show old and new.
2. Clicking a ghost element shows the operation it comes from.
3. **Approve** and **Reject** are available on the overlay. They have the same effect as in J2.2.

#### J3.6 Restructure a plan
1. The human asks the Approach Agent to split "Conduct interviews" into one item per executive, or to move an item to another phase.
2. The proposal is reviewed as a ghost (J3.5) and approved. The canvas re-lays itself out without moving unrelated nodes.

*Correct when*: split and merge keep the slot references consistent. Downstream inputs are rewired as part of the same proposal.

#### J3.7 Follow live work on the canvas
1. Status changes, publishes and questions update the canvas live. Running items are visibly active.
2. Clicking an active item opens its live activity (J1.3).

#### J3.8 Use the tree view
1. The Tree tab shows the plan as an outline with status and the same depth control. Selecting an item selects it on the canvas too.

### 6.3 Learning questions

1. Is the canvas readable at three levels and about 20 items? Which of depth, focus and collapse is used most?
2. Do both Hierarchy and Lanes earn their place?
3. Do testers act from the canvas (approve, open items), or mostly from the Inbox and chat?

---

## 7. I4 — Change happens

**Goal**: the plan survives real change. That means new inputs, human work fanned out per executive, versions that matter or don't, and items that go stale and are re-run.

### 7.1 Scope

**In scope:**

- **Intake documents**:
  - PPTX and XLSX uploads are stored as-is as engagement assets.
  - `WI-001 Analyse intake documents` uses the `document-extraction` skill. This is the **first Bash-enabled item**: Bash is scoped to the skill script and the guard has a shell rule. It is an accepted risk (M0-FINDINGS §5.4).
- **Minor versus material in full**:
  - Staleness propagation (A§7.3).
  - An **impact explanation**: an Approach Agent task session summarises what changed and which consumers are affected.
  - `reopen_item` and the `stale-rerun` run reason, where the prompt includes a diff summary.
  - **Reclassification.**
  - The human can **edit and publish** a new version of any asset, as the human author with a kind.
- **Consumptions**: declared pins and **implicit reads**, which appear as dotted edges on the canvas. An implicit read can be promoted to a declared input.
- **Asset viewer**: a version picker with minor/material markers, a **diff between versions**, and the consumers with their pinned versions.
- **Human item per executive**: split into four human sub-items (using `split_item` from I3). Automatic multi-instance from a list asset stays deferred (D§12.2).
- **`request_asset_change`** from one item to the owning item, via the Approach Agent.
- **Decisions to make here**:
  - Can the Approach Agent reclassify a version without asking (D§13.1-1)?
  - Should many implicit reads trigger a reaction (D§13.1-2)?

### 7.2 Core journeys

#### J4.1 Drop in intake documents
1. The human uploads last year's strategy deck (PPTX) and the application inventory (XLSX) into **Engagement → Intake**.
2. They are published as-is as `ENG/intake/*` v1.0, can be downloaded, and are visible as data objects.

*Correct when*: nothing is converted automatically (D§2.1-10).

#### J4.2 An agent works from intake documents
1. WI-001 starts. Its activity shows the extraction script running on each document, and the extractions saved in its own `work/`.
2. It publishes `current-state-summary` v1.0 and submits.

*Correct when*:
- Its shell commands appear in the activity.
- The guard denies any shell command that names a path outside its own `work/` or the skill directory.
- The post-run audit is clean.

#### J4.3 Perform human work per executive
1. After the split (J3.6), four human sub-items appear in the Inbox, each with the interview guide attached.
2. The human uploads the notes for each executive. The composite's roll-up counts up. When all four are done, WI-004 becomes ready.

#### J4.4 A minor change notifies but changes nothing
1. The human opens `themes` v1.0, fixes a typo with **Edit and publish**, chooses **minor** and adds a note. This creates v1.1.
2. WI-005, which consumed v1.0, gets a notification ("newer minor version available") and stays **Done**.

*Correct when*: nothing becomes stale, and the canvas shows v1.1 on the data object.

#### J4.5 A material change makes consumers stale, and a re-run follows
1. After the CFO follow-up (J2.5), WI-004 is re-opened (`reopen_item`) and publishes `themes` v2.0 as **material**, with the agent's reasoning shown.
2. WI-005 turns **Stale** on the canvas. The Inbox shows the stale item with the Approach Agent's impact explanation and a diff summary from v1.x to v2.0.
3. The human chooses **Re-run** or **Accept as-is**.
   - **Re-run** starts a *new* session with the reason, the diff, the previous outputs and the worklog, then continues through the gate (J1.5).
   - **Accept as-is** returns the item to Done and records the decision.

*Correct when*: this is demo step 8 and success criterion 4.

#### J4.6 Reclassify a version
1. The human reclassifies `themes` v1.1 from minor to **material**. Consumers that pinned v1.0 become stale.
2. Downgrading it back clears that staleness.

*Correct when*: the reclassification is an event with an actor and a reason.

#### J4.7 See what an item actually read
1. The item detail lists its declared inputs with their pinned versions, and its **implicit reads** with versions. On the canvas, implicit reads are dotted edges.
2. The human clicks **Promote to declared input**. The next material change to that asset now makes the item stale.

#### J4.8 Compare versions
1. The asset viewer shows every version, marked minor or material, with its author, note and run.
2. **Diff** shows the differences between any two versions.
3. **Consumers** lists which items read which version.

#### J4.9 One item asks another to change an asset
1. WI-005's agent calls `request_asset_change` on `themes`, for example "add an effort estimate per theme".
2. The Approach Agent routes it and proposes re-opening WI-004 with the request. The human approves.
3. WI-004 re-runs with the request in its prompt.

### 7.3 Changed journeys

- **J1.6**: WI-003 is now a composite of human sub-items, but the per-item upload flow is unchanged.
- **J1.5**: the review Inbox entry now links to the diff with the previous version.

### 7.4 Learning questions

1. Does the minor/material split match how testers think about changes? How often do they reclassify?
2. Does staleness feel useful, or noisy?
3. How many implicit reads do agents make, and are they meaningful?
4. How reliable is extraction from real PPTX and XLSX files?

---

## 8. I5 — Many things at once

**Goal**: the Approach Agent works from an **agenda** (D§6.5, A§8.1), so concurrent and out-of-order inputs are handled in the human's priority order.

### 8.1 Scope

**In scope:**

- The **Agenda Service**:
  - topics created by events, by the Approach Agent (`agenda_add`) and by the human;
  - priorities and the human's ranking;
  - owner (the Approach Agent or the human);
  - **triggers** and `agenda_wait`;
  - **claims** with leases;
  - automatic closing when a linked object resolves.
- The `agenda` toolset.
- The **triage lane**: one session at a time, using the `auto` / `on-demand` setting.
- **Several conversation threads**, and "discuss" from any topic or Inbox entry. Resumed sessions get a "since we last spoke" delta in their briefing.
- **Full optimistic concurrency** for proposals (A§7.4), with conflicts reported back to the proposing session.
- A global **Pause** and **Resume**.
- **The S7 soak test**: 3 Work Agent runs, 1 triage session and 1 conversation at the same time, with RSS and CPU sampling.
- **Experimental**: drop-in chat with a Work Agent (D§7.4), behind a setting.
- **Decisions to make here**:
  - triage batching (A§20.1-1);
  - rules for closing topics automatically (A§20.1-2).

### 8.2 Core journeys

#### J5.1 See the agenda
1. The left panel shows the **Agenda board**: topics grouped by status, each with its kind, title, priority, owner and links (items, requests, proposals, assets).
2. Clicking a topic shows its summary, history and links.

#### J5.2 Prioritise the agenda
1. The human drags topics to re-rank them, **pins** one to the top, marks one **I'll handle** (it moves to the human's Inbox), and **drops** one with a reason.
2. The triage lane picks the highest-ranked open topic that the Approach Agent owns, and the board shows which topic it is working on.

*Correct when*: the Approach Agent can never raise a topic above the human's rank.

#### J5.3 Hold several conversations
1. The human starts a new thread, or **discuss** on a topic opens a thread linked to it.
2. The human switches between threads. Each thread resumes where it was, with a short "since we last spoke" delta.
3. A topic that is being discussed is claimed, and triage skips it.

#### J5.4 Wrong question → discuss (demo step 5)
1. In the Inbox, the human marks a question **Wrong question → discuss**.
2. A thread opens with the question, the hypothesis and the item's context attached. The item stays **Blocked**.
3. The discussion ends in, for example, an `update_brief` proposal. When the human approves it, the blocked item resumes with the clarified brief and a note that the question was withdrawn.

*Correct when*: this is success criterion 3 (the discuss path).

#### J5.5 Background triage
1. With `agenda: auto`, the Approach Agent works its topics in rank order: it answers questions, assesses proposals and explains impacts.
2. With `agenda: on-demand`, nothing happens until the human clicks **Work the agenda**.

#### J5.6 A commitment comes back by itself
1. The Approach Agent adds a follow-up, "Re-check initiatives when the CFO notes arrive", which waits on `asset_published`.
2. When the CFO notes are published, the topic re-opens automatically and triage picks it up.

#### J5.7 Two sessions propose against the same plan
1. A conversation and a triage session both propose changes to WI-005 on plan v5. The first proposal is approved and applied as v6.
2. The second is rejected as a conflict. The proposing session re-plans on v6. The human only ever sees valid proposals.

#### J5.8 Pause everything
1. **Pause** stops dequeuing and interrupts the active runs, keeping their sessions. **Resume** restarts the scheduler, and the interrupted runs are resumed.

### 8.3 Changed journeys

- **J2.3–J2.5**: questions, proposals and impacts now become **agenda topics** that the triage lane handles, instead of engine-triggered task sessions.
- **J2.7**: "where are we?" now also covers the open agenda topics.

### 8.4 Learning questions

1. Does the agenda keep the human in control, or does it become noise? Measure the rate at which topics are opened and closed.
2. Do testers use several threads, or stay in the general one?
3. Is the drop-in chat used, compared with structured questions?

---

## 9. I6 — Close the engagement

**Goal**: finish an engagement properly, with quality gates, a formal endorsement and real deliverables.

### 9.1 Scope

**In scope:**

- **Gate chains**: AI review → human review → formal endorsement (A§7.5).
- **AI review**: an Approach Agent review task session, using `review_item`, checks the output against each acceptance criterion.
- **Endorsement**:
  - decision records (`decisions/D-xxx.md` plus a DB row);
  - the decision log;
  - the "endorsement outdated" flag.
- **Export items**: `WI-007 Board deck` with the `pptx-export` and `pdf-export` skills (Bash scoped to their scripts).
- The canvas shows ◆ endorsement gateways with the forum label.
- **Decision to make here**: should endorsement conditions become new items automatically (D§13.1-3)?

### 9.2 Core journeys

#### J6.1 Configure a gate chain
1. The human edits an item's gate chain in the item detail, or the Approach Agent proposes `set_gate`, for example "AI review → human review → steerco endorsement" on WI-006.
2. The canvas shows the chain as gateways after the task.

#### J6.2 AI review
1. On submit, the Approach Agent reviews the output against each acceptance criterion and gives a verdict with comments per criterion.
2. If it requests changes, the Work Agent resumes with the comments. If it passes, the next gate in the chain opens. If it is unsure, it escalates to the human.

#### J6.3 Record a formal endorsement (demo step 9)
1. When the item reaches the ◆ gate, the Inbox entry opens an endorsement form. The form has:
   - the forum;
   - the date and participants;
   - the endorsed version (pre-selected and locked);
   - the outcome: *endorsed*, *endorsed with conditions* or *rejected*;
   - the conditions and rationale;
   - optional evidence (upload the minutes).
2. Saving it creates `D-xxx`, adds an entry to the decision log and publishes a minor version of `ENG/decisions`. The item becomes **Done**.

*Correct when*: this is success criterion 5, and the record names the exact version.

#### J6.4 An endorsement becomes outdated
1. A later **material** version of the endorsed asset flags the decision as "endorsement outdated", in the decision log and on the canvas.

#### J6.5 Produce the deliverable (demo step 10)
1. WI-007 consumes the Markdown assets and produces `it-strategy.pptx` and `it-strategy.pdf` as binary assets.
2. The human previews the PDF and downloads both files.

*Correct when*: this is success criterion 6.

#### J6.6 A deliverable goes stale
1. A material change to an input makes WI-007 stale (J4.5). A re-run regenerates both files as new versions.

### 9.3 Learning questions

1. Are gate chains worth their friction, and is AI review trusted?
2. Are the exported PPTX and PDF presentable enough for the demo?

---

## 10. I7 — Reuse and demo

**Goal**: approaches become reusable, history can be seen, and the full demo is rehearsed.

### 10.1 Scope

**In scope:**

- The **library**:
  - `workspace.db` catalog with FTS5;
  - `search_library` and `get_library_entry`;
  - the Library view;
  - promotion with provenance and a sanitisation checklist.
- **Playbooks**:
  - capture through an Approach Agent task session;
  - authoring by hand;
  - use during planning.
  - The I1 seed becomes the first playbook without any format change.
- The **timeline** view.
- **Demo support**:
  - `demo/<label>` checkpoints and restore (tags, with the DB closed before checkout);
  - fake-agent replay of recorded runs;
  - a rehearsal on the `demo` profile.
- **Polish**: the first styling pass on all core journeys.
- **Stretch**: workspace-scope assets.
- **Decisions to make here**:
  - playbook versioning (D§13.1-4);
  - library confidentiality (A§20.1-5).

### 10.2 Core journeys

#### J7.1 Capture a playbook (demo step 11)
1. The human asks the Approach Agent to "save this as an IT Strategy playbook", for the whole engagement or a subtree.
2. The Approach Agent generalises the plan, briefs, gates and example assets into a draft playbook: client specifics are removed and replaced with placeholders.
3. The human reviews the draft, confirms the sanitisation checklist and saves it to the library.

#### J7.2 Find something in the library
1. The Library view searches playbooks by text and filters them by kind and tag. The human can preview an entry and see its provenance.

#### J7.3 Start a new engagement from a playbook
1. In a new engagement (J2.1), the Approach Agent searches the library, says which playbook it is drawing on, adapts it, and proposes a plan (J2.2).
2. The engagement records the version of the playbook it used.

#### J7.4 Promote an asset to the library
1. From the asset viewer, the human (or the Approach Agent, with the human's confirmation) clicks **Promote to library**.
2. The content is copied with its provenance (engagement, slot, version) after the sanitisation checklist is confirmed.

#### J7.5 Look back (demo step 12)
1. The timeline shows plan versions v1 → vN, every asset version marked minor or material, the questions and how they were resolved, the gate verdicts and the endorsement. Every entry links to what it refers to.

#### J7.6 Save and restore a demo checkpoint
1. The human saves a checkpoint named, for example, `before-synthesis`.
2. Later, restoring it brings back the files and the DB exactly. Leases are released, and the app reloads in that state.

#### J7.7 Rehearse the demo
1. The whole D§11 script runs end to end: once on fake replay at no cost, and once on the `demo` profile, within about 30 minutes.

*Correct when*: this is success criterion 1, and the full POC is done.

---

## 11. Mapping to the milestones in A§18

| Milestone | Delivered in |
|---|---|
| M1 Core | I1 (lifecycle, readiness, versions, leases, events, checkpoints), I2 (plan operations, proposals), I4 (staleness), I5 (optimistic concurrency), I7 (tags and restore) |
| M2 Work Agent runtime | I1 (runtime, guards, tools, resume, S6), I4 (Bash items, re-runs, implicit reads), I5 (S7 soak) |
| M3 Approach Agent | I2 (conversation, planning, questions), I5 (agenda, triage, threads), I6 (AI review) |
| M4 UI v1 | I1–I7, one slice at a time |
| M5 Workflow canvas | I1 (v0), I3 (full) |
| M6 Gates and versions | I1 (single human review), I4 (minor/material), I6 (chains, endorsement) |
| M7 Skills, exports, library | I1 (method skills), I4 (extraction), I6 (export), I7 (library, playbooks) |
| M8 Demo hardening | I7 |

## 12. Flexibility and open decisions

- **The order after I3 is flexible.** I4 (change) and I5 (concurrency) are independent of each other. Choose the next one based on what the I2 and I3 test sessions show hurts most. If the canvas turns out to be less central than expected, I3 can move after I4.
- **Open questions and where they get answered:**

  | Question | Iteration |
  |---|---|
  | Queue or merge mid-turn chat messages (M0 S5) | I2 |
  | Visibility of the approach journal (A§20.1-4) | I2 |
  | Can the Approach Agent reclassify versions on its own (D§13.1-1)? | I4 |
  | Many implicit reads as a signal (D§13.1-2) | I4 |
  | Triage batching, and rules for closing topics automatically (A§20.1-1, -2) | I5 |
  | Endorsement conditions as new items (D§13.1-3) | I6 |
  | Playbook versioning, library confidentiality (D§13.1-4, A§20.1-5) | I7 |
  | Moving to a multi-user DB (A§20.1-3) | After the POC |
