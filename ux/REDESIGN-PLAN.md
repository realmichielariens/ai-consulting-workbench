# Journey redesign plan: from three panels to a stage and a rail

**Status:** design rationale, 2026-09-25. It is being delivered as iteration **UX1**, before the rest of I3. The executable plan, with the adopted decisions, is [iterations/UX1-PLAN.md](../iterations/UX1-PLAN.md). Where the two differ, the plan wins.
**Visual language:** [EXHIBIT.md](EXHIBIT.md) · **Reference:** [playground/index.html](playground/index.html), section 07

This plan redesigns *how the Workbench is used*: pages, layouts, flows and interactions. It changes no engine behaviour. The domain, the engine rules and the Work Agent protocol stay as they are. The few API additions it needs are listed in §9.

---

## 1. What is wrong today

The I1/I2 layout (`EngagementLayout.tsx`) is three fixed columns: **Chat/Inbox/Approach tabs | process canvas | detail panel.** It was right for a walking skeleton, where the aim was to prove each journey works. It does not fit how a consultant actually spends their time.

| Observation | Consequence |
|---|---|
| Documents and item details open in the right-hand panel, about a third of the width. | The activity the consultant spends most time on, reading and judging a deliverable, gets the least room. Reviewing a 3-page `themes.md` means scrolling a narrow column. |
| Chat, Inbox and the Approach tab share one left panel. | Talking to the Approach Agent hides the queue of decisions, and the reverse. Kick-off, which is a long conversation, happens in a sidebar. |
| The canvas is always the centre, even when there is nothing to do on it. | Opening an engagement answers "what does the plan look like?", not "what needs me?". |
| The header mixes the engagement with developer detail (runtime, profile, models, WebSocket state, folder path). | The engagement's identity and progress are lost among tester information. |
| Inbox entries have no order of importance. | A question that blocks three items looks the same as an FYI. |
| Every surface has the same visual weight (system-ui, blue buttons, boxes). | There is no difference between operating the tool and reading the work. |

## 2. Who we design for, and in which modes

**The engagement lead**, a consultant, is the primary user. They use the Workbench in four modes, which differ in duration, attention and what the screen must show.

| Mode | Duration | Attention | What the screen must do |
|---|---|---|---|
| **Frame**: brief the Approach Agent, shape the plan | 20–60 min, a few times per engagement | Deep, conversational | Give the conversation the full width, and show the engagement taking shape next to it. |
| **Steer**: answer, approve, unblock | 1–5 min, several times a day | Shallow, fast | Show what needs me, most consequential first, each item actionable in one step. |
| **Review**: read a deliverable, judge it | 10–30 min | Deep, reading | Give a full-width reading room with what changed, the sources and a clear verdict. |
| **Present**: walk a partner or client through the plan and the work | Meetings | Performative | Keep screens clean enough to project: the plan, a document, the decision log. No developer noise. |

The **POC tester** is a secondary user. They need the developer details (runtime, models, cost to 3 decimals, WebSocket state, folder, feedback), but on a status strip and not in the engagement's header.

## 3. Design moves

These five moves come from the playground, section 01:

1. **Documents get the stage.** Assets, items and the plan open as tabs in a main *stage*, as documents do in an editor. A deliverable is never read in a side panel.
2. **The Approach Agent is a rail, not a tab.** The conversation is docked on the right and can be collapsed. It is aware of what is on the stage. It can be expanded into the stage for long conversations (kick-off).
3. **Home is a Brief, not a canvas.** An engagement opens on what needs you, ranked by consequence, then what is in flight and what was published recently.
4. **Every decision takes one action.** All human judgement uses one decision-card anatomy (EXHIBIT §7.3), with keyboard shortcuts.
5. **Canvas for structure, tracker for status.** The plan has two views of one model: the BPMN-lite canvas and a consultant tracker table. They share selection and depth.

## 4. The shell

```
┌────┬──────────────────────────────────────────────────────────────┬───────────────────────┐
│ W  │ IT Strategy — Acme            Progress ◑ 4/11  Plan v6  $1.84 │ ● 2 running  Approach⟩│  top bar 52
│    ├──────────────────────────────────────────────────────────────┼───────────────────────┤
│ ▤3 │ Brief │ Plan │ themes.md 2.0 ✕ │ WI-004 ✕ │ +                  │ A Approach  Chat|Agenda│  tab strip 38
│ ⌗  ├──────────────────────────────────────────────────────────────┤───────────────────────│
│ ▯  │                                                              │ memo stream           │
│ ◇  │                     STAGE                                    │  (sources, inline     │
│    │   (the active tab: Brief, Plan, a document, an item…)         │   decision cards)     │
│    │                                                              │                       │
│    │                                                              │ ◉ Viewing themes.md   │
│ ⚙  │                                                              │ [composer        Send]│
├────┴──────────────────────────────────────────────────────────────┴───────────────────────┤
│ fake · test · work haiku-4-5 · approach haiku-4-5 · ws ● open · $1.843 · Open folder · Feedback │  dev strip 22
└──────────────────────────────────────────────────────────────────────────────────────────────┘
  nav 56                               stage (fills)                             rail 360 (320–480)
```

| Region | Content | Behaviour |
|---|---|---|
| **Nav rail** | Destinations of the engagement (§5). The Brief icon carries the "needs you" count. Settings sits at the bottom. The W mark returns to the engagements home. | Icons with tooltips. Only destinations that exist in the current iteration are shown. |
| **Top bar** | Engagement name and goal line; KPIs: progress (Harvey ball + done/total leaf items), plan version, spend (2 decimals); the live indicator; the rail toggle. | The KPIs are clickable: progress → Plan (Tracker), plan version → plan history (I7), spend → cost breakdown (later). |
| **Stage tab strip** | Pinned tabs **Brief** and **Plan**, then object tabs (a document, an item, a proposal). | See §7.2 for opening and closing rules. |
| **Stage** | The active tab's page. | Scrolls on its own. Sticky action bars (review bar, proposal bar) sit at its bottom or top. |
| **Approach rail** | Header (Chat \| Agenda, expand ⤢, collapse ✕); memo stream; context chip; composer. | Collapsible (`\`), resizable from 320 to 480px, and expandable into a stage tab ("Conversation"). Under 1280px it overlays the stage with a float shadow. |
| **Dev strip** | Runtime, profile, models, WebSocket state, cost to 3 decimals, Open folder (+ path copy), Feedback. | Shown by default in the POC. It can be hidden from Settings. It keeps the existing test ids (`runtime-badge`, `ws-status`, `cost-total`, `open-folder`, `folder-path`, `open-feedback`). |

**Viewport support:** designed at 1440×900, fully usable from 1280 wide. From 1024 to 1279 the rail overlays the stage. Below 1024 the app is unsupported, but must not break.

## 5. Information architecture

```
Workspace
├── Engagements (home)                   portfolio table + "New engagement"
├── Library                              (I7)
└── Profile / model settings             (existing J2.8, moved to a workspace menu)

Engagement (/e/:eid/…)
├── Brief            pinned tab · nav    what needs you, in flight, recently published
├── Plan             pinned tab · nav    Canvas | Tracker; ghost overlay for proposals
├── Documents        nav                 the asset register (all slots, versions, consumers)
├── Decisions        nav (I5/I6)         the open queue in full + the decision log + endorsements
├── Timeline         nav (I7)
├── [object tabs]                        Document · Item · Proposal · Conversation
├── Approach rail                        Chat | Agenda (I5)
└── Settings         drawer              autonomy, question handling, item start…
```

Two rules keep this stable as iterations add features:

1. **Objects open as tabs; destinations are nav entries.** Any document, item or proposal can be opened from anywhere (a source chip, a canvas node, a card, a tracker row, a memo), and it always opens the same way.
2. **The Inbox disappears as a place.** Its entries become **decision cards**. They appear ranked in the Brief ("Needs you"), inline in the rail when the Approach Agent raises them, on the object they concern (the review bar of a document, the proposal bar on the Plan), and, from I5/I6, in full in Decisions. There is one component in four places, not four components.

## 6. Pages

For each page: purpose, layout, contents, actions, data source, and what is new.

### 6.1 Engagements home (replaces `StartPage`)

**Purpose:** choose or start an engagement.

```
ENGAGEMENTS                                                     [ New engagement ]
─────────────────────────────────────────────────────────────────────────────────
Name                    Progress   Needs you   Last activity   Spend
IT Strategy — Acme      ◑ 4/11     3           09:47           $1.84
App rationalisation     ○ 0/0      —           Mon             $0.12
```

- **New engagement** opens the *kick-off* (§6.2). Starting from a seed or playbook is a secondary choice ("Start from a playbook ▾"), per J2.1.
- **Data:** `listEngagements`, extended with progress and the needs-you count (C6 in §9).

### 6.2 Kick-off (the Frame mode)

**Purpose:** brief the Approach Agent and get to an approved first plan.

```
┌ Conversation (the rail expanded into the stage) ─────────┬ Taking shape ──────────────┐
│ You: I need to develop an IT strategy for Acme…          │ CONTEXT   context.md  1.0   │
│ A: Three questions before I plan… (sources)              │   Goal · Deliverable · Due  │
│ …                                                        │ STAKEHOLDERS  stakeh… 1.0   │
│ ┌ PROPOSAL #1 · first plan ─────────────────────────┐    │   CEO · CFO · COO · CIO     │
│ │ 7 items in 3 phases · 2 gates                     │    │ INTAKE  (I4: dropped files) │
│ │ [Review on plan]  [Discuss]                       │    │                             │
│ └───────────────────────────────────────────────────┘    │                             │
│ [composer — drop files here]                              │                             │
└──────────────────────────────────────────────────────────┴─────────────────────────────┘
```

- The conversation takes the full stage while the engagement has no approved plan. The right column shows the engagement assets as the Approach Agent writes them (`context.md`, `stakeholders.md`), so the user sees the frame being built.
- A plan proposal arrives as a decision card in the stream. **Review on plan** opens the Plan tab with the ghost overlay and a proposal bar (§6.4).
- After the first plan is approved, the conversation collapses back into the rail and the engagement's home becomes the Brief. The transition is announced once: "Plan v1 approved. Your Brief is now home."
- **Data:** the existing thread, proposals and assets. Nothing new.

### 6.3 Brief (the new home; the Steer mode)

**Purpose:** in 30 seconds, see what needs you and act on it.

```
Thu 25 Sep · Week 3 of 6
3 decisions need you. Synthesis is waiting on your review.          ← action title, computed
Discovery is 4/5 done. The CFO follow-up changed the themes…        ← standfirst, computed

NEEDS YOU · BY CONSEQUENCE                    3   │ IN FLIGHT                          2
═══════════════════════════════════════════════   │ ═════════════════════════════════════
[decision card: Review WI-004, blocks 2 items ]   │ WI-005 Identify initiatives  ◐
[decision card: Proposal #7                   ]   │   reading themes.md@2.0 …  ▬▬▬───
[decision card: Question WI-001 + hypothesis  ]   │ WI-003d Interview COO        You
                                                  │ PUBLISHED RECENTLY
                                                  │ themes.md 2.0 ■ · 09:47   …
                                                  │ PLAN HEALTH  PH-1 ◕ PH-2 ◔ PH-3 ○
```

- **Action title and standfirst are computed from data by templates, not written by an LLM.** Examples: "N decisions need you" plus the worst blocker; "Nothing needs you. Agents are working on N items."; "All work is done. The deliverable is ready to export." They are deterministic, cost nothing, and can be tested.
- **Ranking by consequence.** Order the entries by: blocks a gate-bound or deliverable path → number of items blocked downstream → kind (run issue > question > review > proposal > human item > FYI) → age. The server supplies the score (C1). FYIs collapse into one "3 updates" row at the bottom.
- **In flight** shows the items with an `activeRunId` and the latest activity line (from the WebSocket), and the human items in progress assigned to you.
- **Published recently** shows the latest asset versions (from `PlanView.slots[].latest`), with material and minor markers.
- **Keyboard:** `J`/`K` move through the cards; `A`/`E`/`R` act on the focused card; `Enter` opens its object.

### 6.4 Plan (Canvas | Tracker)

**Purpose:** see and shape the structure (canvas), or scan status (tracker).

- **Canvas:** the existing React Flow + ELK view, restyled to Exhibit nodes (EXHIBIT §7.4). I3 then adds depth, focus, lanes and restructuring on top of this. Phase headers show Harvey balls.
- **Tracker:** replaces the Tree view planned in I3. It is an outline table grouped by phase: id, title, owner (glyph), status, gate, outputs (latest version), Harvey roll-up, last change. It uses the same depth control as the canvas. It is sortable within a phase, and filterable to *Mine*, *Needs you* or *Running*.
- **Selection vs opening.** A single click selects the item and shows a **peek card**: a popover anchored to the node or row, with status, a one-line brief, open requests and the primary action. Double-click, `Enter` or the peek's *Open* opens the item as a tab. The selection also sets the rail's context.
- **Proposal bar.** When a pending proposal exists, a bar sits at the top of the stage: "Proposal #7 · 3 changes · +3 days on Synthesis [Approve] [Discuss] [Reject] [Hide ghost]". The canvas shows the ghost overlay, and the tracker shows the changed rows marked `+`, `↻` or `~`. This replaces the separate preview in `ProposalCard`.

### 6.5 Document (the reading room; the Review mode)

**Purpose:** read an asset version, understand what changed, and judge it.

The layout is as prototyped in the playground (§07 → themes.md):

- **Header:** breadcrumb (`PH-2 › WI-004`), owner item and executor, scope tag, status of the owning item.
- **Toolbar:** `Read | Changes since <prev> | Source`, Download, **Ask about this** (focuses the rail composer with the document as context).
- **Body:** rendered Markdown in the reading face at a 68ch measure, with numbered headings, exhibits and change markers. Other formats (PDF, PPTX, XLSX) show a preview where the browser can render one, and otherwise a download card.
- **Side column (240px):** a version rail (material versions square, minor round, current filled); *Used by* (consumers and their status); *Built from* (declared inputs, with implicit reads dotted, from I4).
- **Review bar,** sticky, only when a review request covers this version: gate glyph, criteria from the completion report as glyphs (met, partial, not met), **Request changes** (opens a short comment field) and **Approve 2.0**. If the request covers several outputs, the bar says "1 of 2 outputs" and links to the next one, and the verdict is given once for all of them.
- **Changes mode:** a word-level diff against the previous version, or any chosen version (the diff endpoint arrives in I4; until then the mode is hidden).
- **Data:** `getAssetVersions`, `getAssetVersion`, `getItem` (for the completion report), and the open review request from the inbox.

### 6.6 Item (the work item page)

**Purpose:** understand one unit of work, run it, follow it, and do it yourself if it is a human item.

```
PH-2 › WI-004 · Agent · At gate ◇                        [Run] [Stop] [Resume]   (disabled + reason)
Consolidate themes
┌ BRIEF (serif) ──────────────────────────────┐ ┌ INPUTS ────────────────────┐
│ …                                           │ │ ■ notes-ceo.md 1.0          │
│ ACCEPTANCE CRITERIA (serif)                 │ │ ■ notes-cfo.md 1.0          │
│ ☑ covers all execs ☑ cites sources ◐ ranked │ │ OUTPUTS                     │
└─────────────────────────────────────────────┘ │ ■ themes.md 2.0 · review    │
 Activity | Worklog | Runs | Requests            │ GATE  ◇ human review        │
 09:41 ● Read current-state-summary.md@1.0       └─────────────────────────────┘
 …
```

- The brief and the acceptance criteria are content, so they are set in serif. Editing them (J1.7, only while waiting or ready) happens inline.
- Tabs: **Activity** (the live run stream, the default while running), **Worklog**, **Runs** (history, cost per run), **Requests** (open and closed questions for this item).
- **Human items** switch to a *Your work* layout: the inputs to read (each opens as a tab), a drop zone per output slot, and **Mark done** with its reason when disabled. This replaces the `human_item` inbox card as the place where the work happens. The card remains in the Brief as the entry point.
- **Data:** `getItem`, `getRunActivity`, `getWorklog`. Nothing new.

### 6.7 Documents (the asset register)

**Purpose:** "what have we produced, and what state is it in?" This is the deliverables register consultants keep anyway.

- A table grouped by phase: slot, owner item, format, scope, latest version (minor or material), number of versions, review state, consumers, last published. Filters: *Deliverables only* (final outputs), *Changed this week*, *Awaiting review*.
- **Data:** `PlanView.slots`. Nothing new.

### 6.8 Decisions (I5/I6)

- The **queue:** every open decision card with filters by kind.
- The **log:** answered questions (with the mode: approved, amended or replaced), verdicts, approved and rejected proposals, and endorsements (I6) with their forum, date, outcome, conditions and minutes. It is the on-screen form of `decisions.md`.
- It needs a closed-decisions listing (C3). The nav entry appears when the log exists.

### 6.9 Approach rail

- **Chat:** memo-style messages (EXHIBIT §7.4) with source chips and inline decision cards (a proposal raised in conversation is actionable right there). A running turn shows its live activity lines ("Reading themes.md@2.0…"), not typing dots. The queued-message behaviour (D5) is kept.
- **Context chip:** "Viewing **themes.md 2.0**", the active stage tab or the canvas selection. It is sent with the message (C2) so that "what changed here?" works without explanation. The user can remove it for one message with ✕.
- **Agenda (I5):** the Approach Agent's open topics, ranked, pinnable. It is a rail tab, and gets its own board page only if testing shows the need.
- **Expand ⤢** turns the rail into a stage tab ("Conversation") for long exchanges. **Collapse** leaves a thin edge with an unread dot.
- **Journal:** the approach journal (D4) opens as a document tab from the rail's ⋯ menu.

### 6.10 Settings and feedback

- **Settings** becomes a right-hand drawer over the stage (the existing `SettingsPanel` contents). **Profile** (workspace-wide) moves to the workspace menu behind the W mark.
- **Feedback** stays a modal, opened from the dev strip. It records the active tab and selection as its context (today it records the view and the item).

## 7. Interaction conventions

### 7.1 Opening things

| Gesture | On | Result |
|---|---|---|
| Click | Canvas node, tracker row | Select it and show the peek card; the rail context follows |
| Double-click, `Enter`, peek → Open | Canvas node, tracker row | Open the item as a tab |
| Click | Source chip, data object, version marker, "Open & review" | Open the document tab at that version (and section, if cited) |
| Click | A decision card's title | Open its object (the item, document or proposal) |
| Middle-click / `Ctrl`-click | Anything that opens a tab | Open it in the background |

### 7.2 Tabs

- Brief and Plan are pinned and cannot be closed. At most 8 object tabs; opening a ninth closes the least recently used one that has no unsent input.
- Opening an object that is already open focuses its tab. A document tab shows its version (`themes.md 2.0`). Opening another version of the same document replaces the version in that tab.
- **URL model:** the path encodes the active tab, so every state stays deep-linkable for Playwright: `/e/:eid` (Brief), `/e/:eid/plan?sel=WI-004&view=tracker`, `/e/:eid/item/WI-004?tab=activity`, `/e/:eid/doc/WI-004/themes/2.0?mode=changes`, `/e/:eid/proposal/P-0007`. The *set* of open tabs is a per-user convenience, kept in `localStorage` per engagement.

### 7.3 Keyboard

| Keys | Action |
|---|---|
| `G` then `B` / `P` / `D` | Go to Brief / Plan / Documents |
| `J` / `K` | Next / previous decision card (Brief, Decisions) |
| `A` / `E` / `R` | Approve / Amend / Replace the focused decision |
| `\` | Toggle the Approach rail |
| `/` | Focus the rail composer |
| `Alt+W` | Close the active object tab |
| `Esc` | Close the peek, the drawer or the dialog |

### 7.4 Live updates

- Live changes never move what the user is looking at. The canvas does not re-fit, lists insert without jumping (new cards animate in below the fold, or show a "2 new ↑" pill), and an open document whose asset gets a new version shows a bar ("2.1 published · View") instead of swapping its content.
- There are no toasts, except for something that needs you and is not visible: "WI-002 asked a question · View".
- The top bar's live indicator counts running runs. It stays calm (a dot and a number): no spinners in the chrome.

## 8. The journey, end to end

The demo script (D§11) in the new layout. **Bold** marks where the user acts.

| # | Demo step | Where it happens | What the user does | Lands on |
|---|---|---|---|---|
| 1 | Kick-off | Home → **New engagement** → Kick-off (rail expanded) | **Describes the engagement** and answers the clarifying questions; drops files (I4) | Kick-off, with context.md and stakeholders.md taking shape |
| 2 | Plan proposal | A proposal card in the conversation → **Review on plan** | Collapses phases, reads the ghost, **Approve** in the proposal bar | Brief (now home); the conversation docks into the rail |
| 3 | Parallel agent work | Brief → In flight; Plan canvas shows running nodes | Watches, or opens an item's Activity tab | — |
| 4 | Question with hypothesis | Brief card (escalated), or inline in the rail | **Amend** on the card (`E`, type, `Enter`) | Stays on Brief; the card leaves |
| 5 | Wrong question (I5) | Same card → **Wrong question → discuss** | Discusses in the rail; the Approach Agent updates the brief | The rail, with an agenda topic |
| 6 | Human work | Brief card "Interview COO" → Item tab, *Your work* | Reads inputs (tabs), **uploads notes**, **Mark done** | Item tab, status Done |
| 7 | Plan adaptation | A Work Agent suggestion → proposal card (Brief + rail) | **Approve** on the card, or review on the Plan | Brief |
| 8 | Minor vs material | Brief → Published recently; the stale item on the Plan | Opens themes.md 2.0 → **Changes since 1.1** | Document tab |
| 8b | Review | Brief card "Review WI-004" → **Open & review** | Reads, checks the criteria, **Approve 2.0** in the review bar | Document tab; the card is gone from the Brief |
| 9 | Endorsement (I6) | Brief card (endorsement) → the roadmap document | Fills in the forum, outcome and conditions, attaches minutes, **Record decision** (ink) | Decisions → log |
| 10 | Export (I6) | Documents → the deliverable → Download PPTX/PDF | — | — |
| 11 | Capture (I7) | Rail: "save this as a playbook" → a proposal-like review | **Approves** the playbook | Library |
| 12 | Look back (I7) | Timeline | Filters to decisions and material versions | — |

## 9. Contract and API changes needed

For the main session to decide. Items marked UX1 are needed for the first redesign iteration (§10); the others arrive with the iteration that owns the feature.

| # | Change | Why | When |
|---|---|---|---|
| C1 | `InboxEntry` gains `consequence: { score: number, blocks: ItemId[], reason: string }` | The Brief's ranking and the "blocks 2 items" kicker. Ranking belongs on the server, so there is one order everywhere. | UX1 |
| C2 | `postMessage` body gains an optional `context: { kind: "item" \| "asset" \| "plan" \| "proposal", ref: string, version?: string }`; the Approach Agent's turn prompt gets one line: "The human is viewing …" | The context chip. The agents package changes one prompt line; no new tool. | UX1 |
| C6 | `EngagementSummary` gains `progress: { done, total }`, `inboxCount` and `lastActivityAt` | The engagements home table. | UX1 |
| C7 | `EngagementView` gains `goal: string \| null` and `due: date \| null`, read from `context.md` front-matter | The top bar's goal line and the Brief's "Week 3 of 6". Until then the top bar shows the name only. | Deferred (not in UX1) |
| C3 | `GET /decisions`: closed requests, proposals and verdicts, newest first | The Decisions log. | I5/I6 |
| C4 | `GET /assets/:itemId/:slot/diff?from=&to=` | The Changes mode in the document tab. | I4 (already planned) |
| C5 | Asset version sections (heading anchors) in source citations | Source chips that open at a section. | I4 or later |

Nothing in UX1 changes the engine rules, the DB schema or the Work Agent protocol.

## 10. Delivery: iteration UX1, before I3 (confirmed)

> The executable version of this section, with work packages, briefs, test ids and walk changes, is [iterations/UX1-PLAN.md](../iterations/UX1-PLAN.md).

**Why before I3:** I3 builds the full canvas. If it is built in the current three-column shell, the canvas's panels, selection and detail behaviour are designed twice. UX1 gives I3 its home: the Plan tab, the peek card and the tracker (which replaces I3's tree view).

**UX1 goal:** the I1 and I2 journeys run in the new shell and Exhibit style, with the Brief as home, documents on the stage and the Approach Agent in the rail. There is no new engine feature.

| Package | Content | Depends on |
|---|---|---|
| **U0** (main session) | Approve the font dependencies; contract deltas C1, C2, C6 (C7 optional); import the tokens into `apps/web`; set up `apps/web/src/ui/` with `glyphs.tsx` and the primitives list from EXHIBIT §10 | — |
| **U1: Shell & navigation** | AppShell (nav rail, top bar, tab strip, stage, rail container with collapse, resize, overlay and expand), dev strip, the URL model (§7.2), the settings drawer, the engagements home | U0 |
| **U2: Stage pages** | Document tab (reading room, version rail, review bar with verdict), Item tab (including *Your work*), Documents register | U1 |
| **U3: Brief & decisions** | Decision-card anatomy for all six entry kinds, the Brief (computed titles, ranking via C1, in flight, published, keyboard), the kick-off layout | U1 |
| **U4: Rail** | Memo stream, inline cards, context chip (web + C2 in server/agents), running-turn activity lines | U1 |
| **U5: Plan tab** | Restyle the existing canvas nodes to Exhibit, add the Tracker view, the peek card and the proposal bar with ghost overlay (reusing `previewProposal`) | U1 |
| **U6: Walks** | Update `e2e/walks/i1.cjs` and `i2.cjs` to the new navigation; keep the test ids | U2–U5 |

**Order:** U0 → U1 → U2 ∥ U3 → U4 ∥ U5 → U6. At most two agents at a time, with compact briefs; the main session integrates.

**Look points:**
- **L-a** after U1: the shell with the fake runtime; tabs, rail and dev strip.
- **L-b** after U2 and U3: the full I1 walk on the fake agent in the new UI.
- **L-c** after U6: the I2 walk; then one real run for the context chip, under $0.10.

**Cost:** essentially zero SDK spend. Everything runs on the fake runtime and the recorded runs, except the one context-chip check in L-c.

**Done when:**
- the I1 and I2 walks pass in the new shell;
- the playground and the app agree on tokens (one file);
- every surface meets EXHIBIT §9 (a quick accessibility audit at L-c);
- no document opens in a side panel.

**Changes this implies to ITERATIONS.md (for you to apply, since agents don't edit it):**
- insert UX1 between I2 and I3;
- in I3, J3.1 step 2 changes from "opens the detail panel" to "shows the peek; Open opens the item tab";
- J3.8 "tree view" becomes the Tracker;
- the M5 row in §2.1 gains "UX1: shell, Brief, stage tabs, tracker".

## 11. Decisions

D6 was confirmed by the user on 2026-09-25. The others are adopted as recommended in [UX1-PLAN §2](../iterations/UX1-PLAN.md), to be reconfirmed at the start of U0.

| # | Question | My recommendation |
|---|---|---|
| D1 | Is the Brief the landing page (after the first plan is approved)? | **Yes.** Before approval, the kick-off is the landing page. |
| D2 | Can a review verdict be given from the Brief card, or only from the document? | **Only from the document.** A review means reading, and the card's primary action is "Open & review". Questions and proposals stay one-click on the card. |
| D3 | Does the Tracker replace I3's Tree view? | **Yes.** It is a tree with columns, and it is what consultants scan. |
| D4 | Does the Agenda (I5) go in the rail or get its own page? | **In the rail**, as a tab, with a board page only if testing asks for it. |
| D5 | Does human work get its own "My work" page? | **No.** Human items appear in Needs you, under the Tracker's *Mine* filter, and as the *Your work* layout on the item tab. |
| D6 | Is UX1 its own iteration before I3, or folded into I3? | **Its own iteration, before I3.** It is smaller and cheaper, and it de-risks I3. |
| D7 | Where do the tokens live? | **`ux/exhibit-tokens.css` stays canonical.** The web app imports it by relative path (Vite allows files in the workspace), so there is never a second copy. |
| D8 | Does the dev strip stay visible by default? | **Yes during the POC**, with a setting to hide it for demos. |

## 12. What to learn from UX1

1. Do testers act from the Brief, or still go to the canvas first?
2. Is the rail used while reading documents ("Ask about this"), or only in conversation mode?
3. Do people give review verdicts after actually reading (the time on the document before the verdict)? Does D2 feel like friction?
4. Is the consequence ranking right? Would testers reorder it?
5. Does the serif/sans split help people tell "reading the work" from "operating the tool", or does nobody notice? (Nobody noticing is fine.)
