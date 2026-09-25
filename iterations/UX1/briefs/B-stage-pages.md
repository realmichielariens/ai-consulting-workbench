# Brief B — Stage pages: Plan, Item, Document, Documents (UX1)

You build the pages that fill the **stage** of the new Exhibit shell. Package A has built:
- the shell;
- routing (`shell/nav.ts`: `openItem`, `openDoc`, `openPlan`, `useStageRoute`, …);
- tabs;
- primitives and glyphs (`ui/`);
- page stubs that currently render the old components.

You replace four of those stubs. Package C builds the Brief and the rail in parallel, so don't touch its paths.

## Your paths (write only here)
- `apps/web/src/pages/{plan,item,doc,documents}/**`
- `apps/web/src/components/{item,process}/**`
- `apps/web/src/components/AssetViewer.tsx` (delete it when the Document page replaces it)
- the tests for all of these

**Read-only:**
- `apps/web/src/{api,shell,ui}/**`
- `packages/core/src/api.ts`
- `components/Inbox.tsx` (reference for the upload and review code; don't edit it)

## Read first (only these)
1. `iterations/UX1-PLAN.md` §4.3, §4.6 (routes, the test ids you must keep), and A's final message (the exact `nav.ts`/`ui` exports; the main session pastes it below this brief).
2. `ux/REDESIGN-PLAN.md` §6.4–§6.7 and §7: the page specs and interactions. **These are your spec.**
3. `ux/EXHIBIT.md` §5 (signals) and §7.4 (tracker, stream, node, version rail, review bar, exhibit).
4. `ux/playground/index.html` section 07: the `.doc-*`, `.review-bar`, `.vlist`, `.lanes`/`.node` and `.tracker` CSS. Port it.
5. `apps/web/src/components/process/ProcessView.tsx`, `layout.ts`
6. `apps/web/src/components/item/ItemDetail.tsx`, `ActivityStream.tsx`
7. `apps/web/src/components/AssetViewer.tsx`, and in `components/Inbox.tsx` the human-item upload and review-verdict code

**Conventions:**
- `.js` in relative imports; never `pnpm add`; never commit;
- tokens only in CSS;
- no emoji (use `ExecGlyph`/`GateGlyph`);
- **keep every existing `data-testid`** listed for your area in plan §4.6;
- views carry `Allowed`, so show disabled actions with their reason, and never re-implement engine rules.

## Build
1. **Plan page** (`pages/plan/`): a toolbar with `Segmented` Canvas/Tracker (`plan-view-canvas`, `plan-view-tracker`; state in `?view=`).
   - **Canvas:** keep the ELK layout and React Flow logic from `ProcessView`, but restyle it to Exhibit:
     - task nodes 188px wide, with a status edge in `--status-*`, the id in mono, `ExecGlyph`, the title, `Status`, and a gate glyph;
     - composites as `--sunken` frames with a `HarveyBall` roll-up;
     - data objects with `DocGlyph` and `Version`.

     Keep the `<Handle>`s and the no-jump re-layout. **Click** selects (`?sel=`) and shows a **peek card** (`peek-card`) anchored near the node: status, the first line of the brief, open requests count, and the primary action (Run if `start.allowed`), plus `peek-open` → `openItem`. **Double-click** opens the item directly. Clicking a data object calls `openDoc(slotRef, latest)`.
   - **Tracker** (`tracker-table`, rows `tracker-row-<id>`): grouped by phase, with columns item (id + title), owner (`ExecGlyph` + Agent/You), `Status`, gate, outputs (`Version` of the latest), done (`HarveyBall`). The same selection and peek apply. Filters: All / Mine (human) / Running.
   - **Proposal bar:** when `?preview=<pid>` is set, fetch `previewProposal` and show a bar at the top (`preview-banner`) reading "Proposal #N · k changes", with `proposal-bar-approve`, **Discuss** (focuses the rail composer via `document.querySelector('[data-testid=chat-input]')`) and `preview-exit` (clears `?preview`). Mark added nodes as ghosts (dashed) and changed nodes with an accent tag, as the preview marks do today.
2. **Item page** (`pages/item/`, root `item-detail`):
   - header: breadcrumb (phase › id), title, `ExecGlyph`, `Status`, and Run/Stop/Resume as `Button`s with `disabledReason`;
   - two columns: left, the **brief and acceptance criteria in `--font-read`** with inline edit (the existing `edit-brief-*`); right, inputs, outputs and the gate, where each asset is a `SourceChip`/`Version` that calls `openDoc`;
   - tabs `item-tab-activity|worklog|runs|requests` (`?tab=`; the default is activity while running, else worklog), reusing `ActivityStream` restyled as the Exhibit stream (EXHIBIT §7.4), `runs-table`, and `worklog-content`;
   - **Your work** (`your-work`) for human items that are ready or in progress: the inputs to read (chips), one drop zone per output slot (`upload-input-<slot>`, and `upload-slot-<slot>` showing the version), and `mark-done` with its reason. Port the upload code from `Inbox.tsx`.
3. **Document page** (`pages/doc/`, root `asset-viewer`): follow the playground's themes.md mock.
   - header meta; a toolbar with Read/Source (Changes hidden until I4), `asset-download` and `doc-ask` (focuses the rail composer);
   - the body, rendered Markdown in `--font-read` at `--measure`, with GFM tables styled as exhibits;
   - a side column: the version rail (`asset-version-list`, `asset-version-<v>`; material versions square), *Used by* (consumers with `Status`; click → `openItem`), *Built from* (the owner's declared inputs);
   - **Review bar** (`review-bar`): shown when the Inbox has an open `review` entry whose `request.payload.submitted` includes this slot. It shows the gate glyph and label, the criteria from `payload.report` as glyphs (met, partial, not met) with labels, `review-request-changes-open` → `review-comments` → `review-request-changes-submit`, and `review-approve` (labelled "Approve <version>"). With several submitted outputs, show "1 of n" and `review-next-output`. The verdict applies to the whole request, as today.
4. **Documents register** (`pages/documents/`): a `Tracker` over `PlanView.slots`, grouped by the owner's phase, with columns name, owner, format, scope, latest `Version`, versions count, consumers count, and last published (`latest.at`). Clicking a row calls `openDoc`.

## Checks, then stop
- Web typecheck; the web tests (update `ItemDetail.test`/`ActivityStream.test`); and new tests for:
  - the review-bar visibility (entry covers slot → shown; no entry → hidden);
  - tracker grouping;
  - peek → open.
- **Boot check:**
  1. `pnpm dev:fake`; open the acme seed;
  2. Plan: Canvas ⇄ Tracker; peek WI-002 → open it; watch its activity; open a data object;
  3. when WI-002 reaches its gate, open the review from the Item page's output chip and check the review bar;
  4. stop the servers, found by port.
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
