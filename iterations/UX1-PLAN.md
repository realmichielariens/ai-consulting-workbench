# UX1 — Stage and rail: Implementation Plan

| | |
|---|---|
| **Status** | U0, A, B, C and integration done 2026-09-25: 452 tests, typecheck and both walks green at $0. Next: the user look (§6), then §8 items 5–7. |
| **Goal** | Rebuild the web UI's shell and journeys in the Exhibit language (`ux/EXHIBIT.md`), following the redesign (`ux/REDESIGN-PLAN.md`). **Every I1 and I2 journey keeps working.** |
| **Scope** | Web UI, plus three small server additions (C1, C2, C6). No engine rule, DB schema, Work Agent or Approach Agent change. |
| **Position** | After I2, **before the rest of I3.** The process view v0 (React Flow + ELK, proposal preview marks) already exists. UX1 moves it into the Plan tab and restyles it. I3's depth, focus, lanes, ghost overlay and restructuring are built afterwards, in that tab. |
| **Execution model** | Lean: the main session does U0 and integration. Three Sonnet agents (A, B, C) get compact briefs in `iterations/UX1/briefs/`, **at most two at a time**. There is one user look before the walks are finalised. |
| **Builds on** | `iteration/i2`. It currently has uncommitted I2 finishing work (gates, scheduler, services, walks). Ask the user to commit it before starting. |

---

## 0. Handover: start here (for a new session)

**Read first** (only these):
1. this plan;
2. `CLAUDE.md` (conventions; the stop rule applies to the agents);
3. `ux/EXHIBIT.md` (the visual language: tokens, signals, components, writing);
4. `ux/REDESIGN-PLAN.md` §4–§7 (shell, IA, pages, interactions). The rest of that file is rationale.
5. Open `ux/playground/index.html` in a browser. Section 07 is the target look for the shell, the Brief, the Plan and a document.

Do **not** read DESIGN/ARCHITECTURE/ITERATIONS in full. Where needed, the briefs carry the relevant facts.

**The web app today** (`apps/web`: React 19, TanStack Query, React Flow v12 + ELK, zustand, react-markdown, Vite, vitest):

| File | What it is | Fate in UX1 |
|---|---|---|
| `components/EngagementLayout.tsx` | 3 columns: Chat/Inbox/Approach tabs \| process view \| detail panel. The header carries dev badges. | Replaced by the shell (A) |
| `components/StartPage.tsx` | Seeds, engagements, "Start with the Approach Agent" | Replaced by the Engagements home (A) |
| `components/Inbox.tsx`, `ProposalCard.tsx` | Inbox cards for all six kinds | Become the decision cards on the Brief (C) |
| `components/chat/ChatPanel.tsx` | The conversation, with the D5 queue | Becomes the rail and kick-off conversation (C) |
| `components/ApproachTab.tsx` | Journal, read-only | Becomes the journal page (C) |
| `components/item/ItemDetail.tsx`, `ActivityStream.tsx` | Item detail, live activity | Become the Item page (B) |
| `components/AssetViewer.tsx` | Asset versions + Markdown | Becomes the Document page (B) |
| `components/process/ProcessView.tsx`, `layout.ts` | Canvas v0 + preview | Restyled into the Plan page (B) |
| `components/SettingsPanel.tsx`, `FeedbackModal.tsx` | Settings, feedback | Settings becomes a drawer (A); feedback is unchanged (A) |
| `state/url.ts`, `state/ui.ts` | Query-param routing; zustand UI state | New path-based routing and tabs (A) |
| `styles.css` | Plain CSS, system-ui | Replaced by tokens + base CSS (A) and per-area CSS (B, C) |

**Commands and gotchas:**
- `pnpm dev:fake` serves web on :5317 and the API on :4317.
- The walks are `node e2e/walks/i1.cjs` and `node e2e/walks/i2.cjs` (with `dev:fake` running; exit 0 = pass).
- Run `pnpm test` and `pnpm typecheck` as the checks.
- Port 5173 is taken on this machine.
- Find leftover servers by port, never by command line.
- React Flow custom nodes need `<Handle>`s.

---

## 1. What UX1 delivers

The consultant:
- opens an engagement on a **Brief** that says what needs them, ranked by consequence;
- reads and judges documents **full-width in the stage**, with a version rail and a review bar;
- runs items and does human work on an **Item page**;
- scans the plan as a **canvas or a tracker**;
- talks to the Approach Agent in a **rail** that knows what they are looking at.

A new engagement starts in a **kick-off** layout, with the conversation filling the stage. Everything is in Exhibit style, in light and dark.

**Journeys that must keep passing:** J1.1–J1.8 and J2.1–J2.8 (the walks). They are adapted to the new navigation (§7), and every behaviour is kept.

**New UX behaviours:**
- **UX-a** Home is the Brief, or the Kick-off while there is no approved plan.
- **UX-b** Items, documents and the journal open as stage tabs; Brief and Plan are pinned.
- **UX-c** A review verdict is given in the document's review bar.
- **UX-d** Human work happens on the Item page.
- **UX-e** The Plan has Canvas and Tracker views, a peek card, and a proposal bar with preview.
- **UX-f** The rail sends the stage context with each message.
- **UX-g** Dev details sit in a bottom strip.
- **UX-h** Keyboard: `J`/`K`/`A`/`E`/`R` on the Brief, and `\` toggles the rail.

---

## 2. Decisions

**All confirmed by the user on 2026-09-25.** Don't re-ask.

| # | Decision |
|---|---|
| D1 | Home = the Brief. While `plan.items.length <= 1` (only ENG), home is the Kick-off. |
| D2 | Review verdicts are given only in the document's review bar. The Brief's review card opens the document. |
| D3 | The Tracker replaces I3's planned Tree view. |
| D4 | The Agenda (I5) will be a rail tab. It is not built in UX1. |
| D5 | There is no "My work" page. Human items appear in the Brief and as *Your work* on the Item page. |
| D6 | **UX1 comes before the rest of I3** (confirmed). |
| D7 | `ux/exhibit-tokens.css` is the only tokens file. The web app imports it by relative path. |
| D8 | The dev strip is visible by default, and can be hidden in Settings. |
| D9 | **Fonts come from Google Fonts for now:** `preconnect` links plus one stylesheet `<link>` in `apps/web/index.html`, for IBM Plex Sans (400/500/600/700), IBM Plex Mono (400/500) and Source Serif 4 (opsz 8–60, 400/600, italic 400), with `display=swap`. Copy the URL from `ux/playground/index.html`, dropping the families the playground uses only for its alternatives. The fallback stacks in the tokens keep the app readable offline. There are no new dependencies. Self-hosting via `@fontsource` is a later option. |

---

## 3. Scope boundaries

**In:**
- the shell;
- Engagements home, Kick-off, Brief, Plan (canvas restyle + tracker + peek + proposal bar), Item, Document, Documents register, Journal;
- the rail;
- settings drawer, dev strip, tokens, fonts (Google Fonts link), glyphs, primitives;
- C1, C2, C6;
- walk updates.

**Out (deferred):**

| Deferred | Where it goes |
|---|---|
| Document *Changes* mode (needs a diff endpoint) | I4 |
| Decisions page and log | I5/I6 |
| Timeline and Library | I7 |
| Agenda tab | I5 |
| Endorsement card | I6 |
| Canvas depth, focus, lanes, ghost overlay | I3 |
| Top-bar goal line and week (C7) | Later. The top bar shows the name and KPIs only. |
| `G`-chord navigation, command palette | Later |
| Responsive below 1024px | Unsupported, but must not break |

---

## 4. Technical design (decided here, so the agents don't have to)

### 4.1 Contract deltas (the main session writes these in U0)

**C1: consequence on Inbox entries** (`packages/core/src/api.ts`, plus a new pure rule `packages/core/src/rules/consequence.ts` with unit tests):

```ts
export const Consequence = z.object({
  score: z.number(),          // higher = more urgent; the server sorts entries by score desc, then age asc
  blocks: z.array(ItemId),    // non-done, non-cancelled items transitively downstream of the entry's item
  reason: z.string(),         // "Blocks 2 items" | "Blocks nothing yet" | "Plan change" | "For your information"
});
// every InboxEntry variant gains: consequence: Consequence
```

- The rule is `downstreamOf(plan: { items: {id,status,outputs}[], slots: {ref,consumers}[] }, itemId): ItemId[]`, following producer → slot → consumers transitively.
- The score is `kindWeight + 10 × blocks.length`, with kind weights `run_issue 50, question 40, review 35, proposal 30, human_item 25, fyi 0`. A proposal has `blocks = []`.
- `getInboxView` (`packages/server/src/views.ts`) computes the consequence from the plan view and returns the entries sorted. Update the web mock backend to return a consequence.

**C2: stage context on a message.**
- The `postMessage` body becomes `{ text, context?: { kind: "item" | "asset" | "plan" | "journal", ref: string, version?: string } }`, where `ref` is an ItemId or a SlotRef.
- `approachRunner.postMessage` resolves the context into one line, "The human is currently viewing: document ENG/context v1.0 (Engagement context).", and appends it to the `situation` text it passes to `startTurn`.
- It is **not** persisted, and the chat body stays exactly what the human typed. The fake Approach runtime ignores `situation`, so the fake scripts are unaffected. The real runtime already renders `situation` into its prompt, so no agents-package change is needed.
- Add `context` to the web `WorkbenchApi.postMessage` and `http.ts`.
- Add one server test: the situation contains the line when a context is given.

**C6: progress on engagements.**
- `EngagementSummary` gains `progress: { done: number, total: number }` and `inboxCount` (moved up from `EngagementView`). *As built (U0):* progress counts leaf tasks directly, excluding cancelled ones, because phases are top-level items (parent null) and ENG's roll-up is therefore empty.
- `listEngagements` already builds full views, so fill both there.

All three changes: typecheck, update the existing tests, and add the new rule tests. `pnpm test` must stay green.

### 4.2 Styling setup (U0)

- `apps/web/index.html` loads the fonts (D9). `apps/web/src/main.tsx` imports `../../../ux/exhibit-tokens.css`, then `./styles/base.css` (created by A). Vite's workspace-root `fs.allow` permits the relative import; verify it with `vite build`.
- Every component uses `var(--…)` tokens only. The status colour comes from `--status-<ItemStatus>`.
- CSS is plain and co-located: each page or component folder has its own `.css` file, imported by its component. There is no CSS-in-JS and no UI library.

### 4.3 Routing and tabs (A implements; B and C use it)

Routing is path-based and keeps the existing no-router approach (`useSyncExternalStore` on the History API).

| Path | Stage shows |
|---|---|
| `/` | Engagements home |
| `/e/:eid` | Home tab: Kick-off (while only ENG exists) or the Brief |
| `/e/:eid/plan?view=canvas\|tracker&sel=<ItemId>&preview=<ProposalId>` | Plan |
| `/e/:eid/documents` | Documents register |
| `/e/:eid/item/:itemId?tab=activity\|worklog\|runs\|requests&run=<RunId>` | Item page |
| `/e/:eid/doc/:itemId/:slot[/:version]` | Document page (latest if no version) |
| `/e/:eid/journal` | Approach journal |
| `/e/:eid/conversation` | The conversation expanded into the stage |

- **Legacy URLs** redirect with `replace`: `?item=X` → `/item/X`; `?asset=I/s&v=V` → `/doc/I/s/V`; `?run=R` → the item page for that run's item, when known.
- **Tabs:** Home and Plan are pinned. Object tabs (item, doc, journal, conversation) open on navigation. There are at most 8; the least recently used one closes first. The set is stored per engagement in zustand, persisted to `localStorage` (wrapped in try/catch). The URL is always the active tab.

**The shell API** that B and C import from `apps/web/src/shell/nav.ts`:

```ts
export function openHome(eid: string): void;
export function openPlan(eid: string, opts?: { sel?: string | null; view?: "canvas" | "tracker"; preview?: string | null }): void;
export function openDocuments(eid: string): void;
export function openItem(eid: string, itemId: string, opts?: { tab?: "activity" | "worklog" | "runs" | "requests"; run?: string }): void;
export function openDoc(eid: string, slotRef: string, version?: string | null): void;   // slotRef = "WI-004/themes"
export function openJournal(eid: string): void;
export function useStageRoute(): StageRoute;          // parsed current route (discriminated union by `page`)
export function useStageContext(): StageContext | null; // what the rail sends (C2): item / asset / plan selection / journal
```

- `apps/web/src/shell/shortcuts.ts` provides `useShortcut(key: string, handler, opts?: { when?: boolean })`. It ignores keystrokes while focus is in an input or textarea.
- `apps/web/src/shell/rail.ts` (zustand) holds `{ open, width, toggle(), setOpen() }`.

### 4.4 Page slots (A creates stubs; B and C own them afterwards)

A creates these files as **working stubs that render today's components**, so the app works end to end after A. B and C then replace the stubs they own.

| Stub file | Stub renders | Owner after A |
|---|---|---|
| `pages/plan/PlanPage.tsx` | `ProcessView` | B |
| `pages/item/ItemPage.tsx` | `ItemDetail` | B |
| `pages/doc/DocumentPage.tsx` | `AssetViewer` | B |
| `pages/documents/DocumentsPage.tsx` | "Coming in UX1" placeholder | B |
| `pages/brief/BriefPage.tsx` | `Inbox` | C |
| `pages/kickoff/KickoffPage.tsx` | `ChatPanel` | C |
| `pages/journal/JournalPage.tsx` | `ApproachTab` | C |
| `rail/RailContent.tsx` | `ChatPanel` | C |

Every page takes `{ eid: EngagementId }` plus the route params, typed by the `StageRoute` variant.

### 4.5 Primitives and glyphs (A)

- `apps/web/src/ui/glyphs.tsx` exports `StatusGlyph`, `Status` (glyph + label), `ExecGlyph`, `GateGlyph`, `DocGlyph` and `HarveyBall`. Port the SVGs from the playground's `GLYPH`/`EXEC`/`GATE`/`DOC`/`harvey` in `ux/playground/index.html`.
- `apps/web/src/ui/` also exports `Button` (variant: primary \| ink \| secondary \| ghost \| danger; size; `kbd`; `disabledReason`, shown as a tooltip), `Segmented`, `Tag`, `SourceChip`, `Version`, `Card` (slots: kicker, title, evidence, actions) and `Tracker`.
- There are no emoji anywhere.

### 4.6 Test ids

**Rule: keep every existing test id on its functionally equivalent element.** The walks depend on them.

| Area | Kept ids | New ids |
|---|---|---|
| Shell (A) | `back-to-start` (the W mark), `open-settings` (nav bottom), `settings-panel` + all `setting-*`, `settings-close`, `plan-version` (top bar), `inbox-count` (nav badge; text = number), `runtime-badge`, `ws-status`, `cost-total`, `open-folder`, `folder-path`, `open-feedback`, `feedback-*` (dev strip) | `app-shell`, `nav-home`, `nav-plan`, `nav-documents`, `rail-toggle`, `approach-rail`, `rail-expand`, `rail-journal`, `dev-strip`, `stage-tab-<key>` (`home`, `plan`, `item-<id>`, `doc-<slotRef>`, `journal`, `conversation`), `stage-tab-close-<key>`, `progress-kpi` |
| Home (A) | `seed-card`, `create-engagement-button`, `engagement-card`, `open-engagement-button`, `engagement-name-input`, `start-with-approach`, `approach-name-input` | — |
| Plan (B) | `process-view`, `process-node-*`, `process-slot-*`, `process-rollup-*`, `process-active-*`, `process-legend`, `preview-banner` (the proposal bar while previewing), `preview-exit` | `plan-view-canvas`, `plan-view-tracker`, `tracker-table`, `tracker-row-<id>`, `peek-card`, `peek-open`, `proposal-bar-approve` |
| Item (B) | `item-detail` (page root), `activity-stream`, `activity-item`, `activity-raw-toggle`, `runs-table`, `run-row-*`, `worklog-tab`, `worklog-content`, `edit-brief-*`, `not-ready-reason`, `mark-done`, `upload-input-<slot>`, `upload-slot-<slot>`, `question-routed-note` | `item-tab-<tab>`, `your-work` |
| Document (B) | `asset-viewer` (page root), `asset-version-list`, `asset-version-<v>`, `asset-download`, `review-approve`, `review-request-changes-open`, `review-comments`, `review-request-changes-submit` (now inside the review bar) | `review-bar`, `review-next-output`, `doc-ask` |
| Brief (C) | `inbox-list`, `inbox-empty`, `inbox-card-<kind>` (with `data-item-id`), `question-*`, `issue-retry`, `issue-stop`, `fyi-*`, `proposal-*` (the card and its ids, including `proposal-preview-toggle`, which now opens the Plan with the preview) | `brief-page`, `brief-title`, `review-open`, `human-item-open`, `inflight-list`, `published-list` |
| Rail / kick-off / journal (C) | `chat-panel` (**one instance at a time**), `chat-message` (`data-role`), `chat-activity`, `chat-asset-link`, `chat-input`, `chat-send`, `chat-queued`, `approach-journal` | `kickoff-page`, `kickoff-asset-<slotRef>`, `context-chip`, `context-chip-clear` |

---

## 5. Work packages

Each brief is in `iterations/UX1/briefs/`, and states its paths, what to read (≤ 8 files), what to build, its checks, and "finish with a ≤ 20-line message; no report files; stop".

| Package | Who | Builds | Checks before stopping | Depends on |
|---|---|---|---|---|
| **U0** | Main | <ul><li>ask the user to commit the I2 work;</li><li>the Google Fonts link (D9);</li><li>C1, C2, C6 (§4.1) with tests;</li><li>web api client additions (`postMessage` context);</li><li>the token import in `main.tsx`;</li><li>review the briefs against the final contracts</li></ul> | `pnpm test`, `pnpm typecheck`, both walks still green (no UI change yet) | — |
| **A: Shell** | Sonnet | Brief A: shell, routing and tabs, nav, top bar, dev strip, rail container, settings drawer, Engagements home, `ui/` primitives and glyphs, base CSS, page stubs | Typecheck; web tests; url/tabs unit tests; boot check: open an engagement and click through the stubs | U0 |
| **B: Stage pages** | Sonnet | Brief B: Plan (restyled canvas, tracker, peek, proposal bar), Item page with *Your work*, Document page with the review bar, Documents register | Typecheck; web tests; the review-bar and tracker unit tests; boot check | A |
| **C: Brief and rail** | Sonnet | Brief C: decision cards, Brief (computed title, keyboard), Kick-off, rail (memo stream, inline cards, context chip, expand), Journal page | Typecheck; web tests; brief-title and card unit tests; boot check | A (**in parallel with B**) |
| **Integration** | Main | Update both walks (§7); fix small issues directly; a dark-mode and 1280px pass; screenshots for the look | Both walks exit 0 at $0 | B, C |

**Order:** U0 → A → B ∥ C → integration → **user look** → finish.

**Path ownership (to avoid collisions):**
- A owns `apps/web/src/{shell,ui,styles,state}/**`, `App.tsx`, `main.tsx`, `pages/home/**`, `components/{EngagementLayout,StartPage,SettingsPanel,FeedbackModal}.tsx`, and deletes `styles.css`.
- B owns `pages/{plan,item,doc,documents}/**` and `components/{item,process}/**`, `components/AssetViewer.tsx`.
- C owns `pages/{brief,kickoff,journal}/**`, `rail/**`, `components/{chat}/**`, `components/{Inbox,ProposalCard,ApproachTab}.tsx`, and a new `components/decisions/**`.
- `apps/web/src/api/**` is frozen after U0. Request changes; don't make them.
- B and C may **read** each other's old components (for example B reads `Inbox.tsx` for the upload code), but never write them.

---

## 6. The user look (about 15 minutes, no cost)

After integration:
1. run `pnpm dev:fake`;
2. **Start with the Approach Agent** → the kick-off conversation → **Review on plan** (proposal bar) → approve → land on the Brief;
3. answer a question on a card with `E`;
4. open a review → read the document → **Approve** in the review bar;
5. do the human item on its Item page;
6. switch Canvas ⇄ Tracker, and peek a node;
7. ask the rail "what changed here?" with a document open, and check the context chip;
8. toggle dark mode (Settings) and the rail (`\`).

Add a "Try UX1" section to the README with these steps. Ask the user for a *go* before any real-agent run.

**After go** (optional; ask first): one real Approach turn with a document open, to confirm the C2 context line reaches the prompt. Cap: $0.05.

---

## 7. Walk changes (integration)

The walks keep their journeys and assertions. Only the navigation changes:

| Walk step | Change |
|---|---|
| i1 "create engagement" | After creation, click `nav-plan` before waiting for `process-view`. |
| i1 J1.3 | Click `process-node-WI-002`, then `peek-open` → `item-detail`. |
| i1/i2: any step that uses Inbox cards | Click `nav-home` first. In i2, the helper `tab("inbox")` becomes `nav-home`. |
| J1.5 review (i1 and i2) | In the card, click `review-open`. Then, inside `review-bar`, use the same `review-*` ids. Wait for `review-bar` to detach, then click `nav-home`. |
| J1.6 human item (i1 and i2) | In the card, click `human-item-open`. Then, inside `your-work`, use the same `upload-*` and `mark-done` ids. Wait for the item status Done, then click `nav-home`. |
| i2 `say()` | `tab("chat")` becomes: if `chat-panel` is not visible, click `rail-toggle`. Scope `proposal-card.last()` to `chat-panel`. |
| i2 J2.1 | `process-slot-ENG/context` and `…/stakeholders` become `kickoff-asset-ENG/context` and `…/stakeholders`. |
| i2 J2.2 | `proposal-preview-toggle` now navigates to the Plan with `preview-banner`. Then `preview-exit`, then `nav-home`, then approve on the card as before. |
| i2 D4 | `tab("approach")` becomes `rail-journal` → `approach-journal`. |
| i1 "all done" | `inbox-empty` on the Brief, then `nav-plan`, then click `process-node-WI-004`. |

---

## 8. Done when

1. **Both walks exit 0** on the fake runtime, with no page or HTTP errors.
2. `pnpm test` and `pnpm typecheck` are green, including the new rule tests (C1) and the url/tabs, tracker, review-bar, brief-title and card tests.
3. **No document or item opens in a side panel.** `EngagementLayout`, `StartPage`, `Inbox` and `AssetViewer` are removed, or no longer referenced.
4. **Tokens.** There are no hex values or font names in `apps/web/src/**/*.css` outside a comment, which is easy to check with grep. The playground defaults equal `ux/exhibit-tokens.css`.
5. **Accessibility.** A quick audit against EXHIBIT §9 passes on the Brief, the Document and the Plan in light and dark: contrast, focus ring, keyboard for decisions.
6. **The user look is done.** Notes go in `iterations/UX1-TEST-NOTES.md`.
7. **Docs.** After the user confirms, the main session applies the changes listed in `ux/REDESIGN-PLAN.md` §10 to ITERATIONS.md: insert UX1, update J3.1 and J3.8, update the M5 row.

**Claude usage target:** within one 5-hour window. Briefs are ≤ 1.5 pages, agents spend 150–250k tokens each, and there are never more than two agents at once.
