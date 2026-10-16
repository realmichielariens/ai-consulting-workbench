# Brief C — Brief, decisions, kick-off, rail (UX1)

You build the human's **steering surfaces** in the new Exhibit shell:
- the **Brief** (home), made of decision cards;
- the **Kick-off** layout for a new engagement;
- the **Approach rail**;
- the **Journal** page.

Package A has built:
- the shell;
- routing (`shell/nav.ts`: `openDoc`, `openItem`, `openPlan`, `useStageContext`, …);
- tabs and `shell/shortcuts.ts`;
- primitives and glyphs (`ui/`);
- page stubs that currently render the old components.

Package B builds the Plan, Item and Document pages in parallel, so don't touch its paths.

## Your paths (write only here)
- `apps/web/src/pages/{brief,kickoff,journal}/**`
- `apps/web/src/rail/**`
- `apps/web/src/components/decisions/**` (new)
- `apps/web/src/components/chat/**`
- `apps/web/src/components/{Inbox,ProposalCard,ApproachTab}.tsx` (move, then delete when replaced)
- the tests for all of these

**Read-only:**
- `apps/web/src/{api,shell,ui}/**`
- `packages/core/src/api.ts`: every `InboxEntry` variant now carries `consequence: Consequence` (`{ score, blocks: ItemId[], reason }`; `reason` is one of "Blocks N items", "Blocks 1 item", "Blocks nothing yet", "Plan change", "For your information"). The server (and the mock backend) already return entries sorted, so never re-sort. `postMessage` accepts `context?: StageContext`, and `api.postMessage(eid, tid, { text, context })` is typed in `apps/web/src/api/types.ts`. U0 added `consequence` to the fixtures in `components/Inbox.test.tsx`; reuse them when you port it.

## Read first (only these)
1. `iterations/UX1-PLAN.md` §4.1 (C1, C2), §4.6 (the test ids you must keep), and A's final message (the exact `nav.ts`/`ui` exports; the main session pastes it below this brief).
2. `ux/REDESIGN-PLAN.md` §6.2, §6.3, §6.9 and §7: the page specs. **These are your spec.**
3. `ux/EXHIBIT.md` §7.3 (decision card anatomy and variants), §7.4 (memo, context chip) and §8 (writing).
4. `ux/playground/index.html`: sections 06 (the cards) and 07 (the Brief pane and the rail). Port their CSS.
5. `apps/web/src/components/Inbox.tsx`, `ProposalCard.tsx`
6. `apps/web/src/components/chat/ChatPanel.tsx` (keep the D5 queue logic exactly)

**Conventions:**
- `.js` in relative imports; never `pnpm add`; never commit;
- tokens only in CSS; no emoji;
- **keep every existing `data-testid`** listed for your area in plan §4.6;
- **exactly one `chat-panel` in the DOM at a time** (A hides the rail during kick-off and `/conversation`);
- views carry `Allowed`: show disabled actions with their reason.

## Build
1. **Decision cards** (`components/decisions/`). One `DecisionCard` anatomy: kicker (kind label, `id`, item title, age, and `consequence.reason`), action title, evidence, actions. Variants, keeping the existing ids and behaviour:
   - **question**: hypothesis block in `--font-read` with an accent rule; the escalation view (`question-escalation-view`); `question-approve`, `question-amend-open`, `question-replace-open`, `question-answer-text`, `question-answer-submit`;
   - **review**: the criteria glyphs, the version(s) under review, and **only** `review-open` (→ `openDoc` of the first submitted slot and version). No verdict on the card (decision D2);
   - **proposal**: wraps `ProposalCard`, restyled as a diff list (`+`/`↻`/`~`/`−` inferred from `readableOps` verbs) with the existing `proposal-*` ids. `proposal-preview-toggle` now calls `openPlan(eid, { preview: id })`;
   - **human_item**: inputs available and outputs expected, then `human-item-open` → `openItem`. The upload UI moves to B's Item page. Keep `data-item-id` on the card root;
   - **run_issue**: `issue-retry`, `issue-stop`;
   - **fyi**: a one-line row with `fyi-dismiss` and the override flow (`fyi-override-*`).

   Card roots keep `inbox-card-<kind>`.
2. **Brief** (`pages/brief/`, root `brief-page`):
   - a kicker with the date (`Thu 25 Sep`);
   - an **action title** (`brief-title`) and a standfirst, computed by a pure function `briefHeadline(entries, plan)`. Unit-test it. Templates:
     - "N decisions need you." plus " <Phase> is waiting on your review." when the top entry is a review;
     - "Nothing needs you. Agents are working on N items.";
     - "All work is done.";
   - "Needs you · by consequence" (`inbox-list`, server order; FYIs collapsed into one expandable "N updates" row at the bottom; `inbox-empty` when there are none);
   - right column: **In flight** (`inflight-list`: items with `activeRunId`, with the last activity line via the run-activity query cache, plus human items in progress); **Published recently** (`published-list`: the 5 latest `slots[].latest`, with `Version` and time; click → `openDoc`); and **Plan health** (a `HarveyBall` per phase);
   - **keyboard** via `useShortcut`: `J`/`K` move focus between cards; `A`/`E`/`R` trigger approve/amend/replace on the focused question card, and `A` approves a focused proposal; `Enter` opens the card's object.
3. **Kick-off** (`pages/kickoff/`, root `kickoff-page`): the conversation (below) takes the stage. Right column "Taking shape": each ENG asset as it is published (`kickoff-asset-<slotRef>`), with its title, `Version` and the first lines rendered in `--font-read`; click → `openDoc`. A proposal arriving in the chat renders as its card, whose preview toggle leads to the Plan.
4. **Conversation** (`rail/Conversation.tsx`, used by `RailContent`, `KickoffPage` and the `/conversation` route): port `ChatPanel`, keeping its ids, the D5 queue and the activity streaming, as **memos, not bubbles** (EXHIBIT §7.4):
   - the agent's avatar square and the human's round avatar;
   - Markdown for the agent's messages;
   - `chat-asset-link` rendered as a `SourceChip`;
   - inline proposal cards;
   - the running turn as live activity lines (`chat-activity`), not "thinking…".

   The **context chip** (`context-chip`) sits above the composer and shows `useStageContext().label`, with ✕ (`context-chip-clear`) to drop it for the next message. Send `context` with `postMessage` when present. The composer (`chat-input`, `chat-send`) supports multi-line input, `Ctrl/⌘+Enter` sends, and `/` focuses it from anywhere.
5. **Journal page** (`pages/journal/`, root `approach-journal`): the journal Markdown in the reading layout (`--font-read`, `--measure`), refetched on `JournalAppended`.

## Checks, then stop
- Web typecheck; the web tests (port `Inbox.test`, `ProposalCard.test`, `ChatPanel.test` to the new components, keeping their assertions); and new tests for `briefHeadline`, card keyboard actions, and the context chip being sent and cleared.
- **Boot check:**
  1. `pnpm dev:fake`; start with the Approach Agent and send the scripted kick-off messages (see `e2e/walks/i2.cjs` for the texts);
  2. check the Kick-off shows the context and stakeholders, then the proposal card;
  3. approve the proposal → the Brief appears with the rail;
  4. answer a question with `E`;
  5. stop the servers, found by port.
- No real SDK runs. Don't run the e2e walks.

Finish with a **≤ 20-line final message**: what you built, any ids added beyond the plan, check evidence, contract change requests, and open issues. No report files.

---

## Package A's hand-off (pasted by the main session)

A is done: typecheck clean, 434/434 tests green. Code against these exports (all read-only for you):

- **`shell/nav.ts`**: `openHome(eid)`, `openPlan(eid, { sel?, view?: "canvas"|"tracker", preview? })`, `openDocuments(eid)`, `openItem(eid, itemId, { tab?: ItemTab, run? })`, `openDoc(eid, slotRef, version?)`, `openJournal(eid)`, `openConversation(eid)`, `backToStart()`, `useStageRoute(): StageRoute`, `useEid()`, `useStageContext(): (StageContext & { label: string }) | null`. Types: `StageRoute` (a union on `page`: `home | plan{view,sel,preview} | documents | item{itemId,tab,run} | doc{itemId,slot,version} | journal | conversation | none`), `PlanViewMode`, `ItemTab`.
- **`ui/index.ts`**: `Button` (`ButtonProps`, `ButtonVariant`), `Segmented` (`SegmentedOption`), `Tag`, `SourceChip`, `Version`, `Card`, `Tracker` (`TrackerColumn`, `TrackerRow`, `TrackerGroupRow`, `TrackerDataRow`), `StatusGlyph`, `Status`, `ExecGlyph`, `GateGlyph`, `DocGlyph`, `HarveyBall`, `harveyFromRatio`. Read each file's props before use. The primitives declare `data-testid` explicitly.
- **`shell/shortcuts.ts`**: `useShortcut(key, handler, { when? })`. **`shell/rail.ts`**: `useRailStore` (`open`, `width`, `toggle()`, `setOpen()`). **`shell/tabs.ts`**: `useTabsStore`.
- **Stub signatures** (keep them: `shell/AppShell.tsx` renders them, and you can't edit it): `PlanPage({ eid, sel?, view?, preview? })`, `ItemPage({ eid, itemId, tab?, run? })`, `DocumentPage({ eid, itemId, slot, version })`, `DocumentsPage({ eid })`, `BriefPage({ eid })`, `KickoffPage({ eid })`, `JournalPage({ eid })`, `RailContent({ eid })`. The shell passes the route params as these props; the stubs ignore the optional ones today.
- **Legacy router:** `state/url.ts` still exists only because the old components use it. **Your new code must navigate only through `shell/nav.ts`.** Remove every `state/url.ts` import from the files you own, so the main session can delete it at integration.
- `styles.css` is gone, so the old components you replace render unstyled for now. That is expected.
