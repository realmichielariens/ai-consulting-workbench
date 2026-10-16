# Brief A — Shell, routing, primitives (UX1)

You rebuild the frame of the React UI (`apps/web`: React 19, TanStack Query, React Flow v12 + ELK, zustand, Vite, vitest) into the **Exhibit** shell. The shell has:
- a nav rail;
- a top bar;
- a stage with tabs;
- an Approach rail on the right;
- a dev strip at the bottom.

You also set up the primitives and glyphs that packages B and C will use. You do **not** redesign the pages themselves: you create working stubs that render today's components. The main session has already done U0: the tokens import, fonts, and the contract additions `consequence`, `progress` and the `postMessage` `context`.

## Your paths (write only here)
- `apps/web/src/{shell,ui,styles,state}/**`
- `apps/web/src/App.tsx`, `apps/web/src/main.tsx`
- `apps/web/src/pages/home/**`
- the page stubs listed below
- `apps/web/src/components/{EngagementLayout,StartPage,SettingsPanel,FeedbackModal}.tsx`, and their tests
- delete `apps/web/src/styles.css` once `styles/base.css` replaces it. `main.tsx` already imports `../../../ux/exhibit-tokens.css` first (U0); replace its `./styles.css` import with `./styles/base.css`, keeping the tokens import first

**Read-only:**
- `apps/web/src/api/**`
- `packages/core/src/api.ts`
- every other component

## Read first (only these)
1. `iterations/UX1-PLAN.md` §4.3–§4.6: routing, the shell API you must export, page stubs, primitives, test ids.
2. `ux/EXHIBIT.md` §5–§8: signals, shape, components, writing.
3. `ux/playground/index.html`: section 07's `.shell`, `.nav`, `.topbar`, `.stage-tabs` and `.aa-rail` CSS, and the glyph SVGs in the script (`GLYPH`, `EXEC`, `GATE`, `DOC`, `harvey`). **Port the CSS and SVGs from here.**
4. `ux/exhibit-tokens.css`
5. `apps/web/src/components/EngagementLayout.tsx`, `StartPage.tsx`, `SettingsPanel.tsx`
6. `apps/web/src/state/url.ts`, `state/ui.ts`

Do not read DESIGN/ARCHITECTURE/ITERATIONS.

**Conventions:**
- small components; comments explain *why*;
- `.js` in relative imports;
- never `pnpm add`; never commit;
- tokens only in CSS: no hex values or font names;
- **keep every existing `data-testid`** on its equivalent element (plan §4.6).

## Build
1. **Base CSS** (`styles/base.css`): the reset, the body in `--font-ui` with tabular numbers, the heading scale, `.label`, `.id`, the focus ring, and `prefers-reduced-motion`.
2. **Primitives** (`ui/`): `Button` (primary \| ink \| secondary \| ghost \| danger, size `sm`, an optional `kbd`, and `disabledReason`, which disables the button and shows a tooltip), `Segmented`, `Tag`, `SourceChip` (mono; `onClick` opens the doc), `Version` (minor outlined, material ink-filled), `Card` (kicker, title, evidence, actions), `Tracker` (a table with caps headers, group rows and hover). **Glyphs** (`ui/glyphs.tsx`): `StatusGlyph`, `Status` (glyph + label from the fixed vocabulary in EXHIBIT §5.1), `ExecGlyph`, `GateGlyph`, `DocGlyph`, `HarveyBall({ quarters })`, and `harveyFromRatio(done, total)`.
3. **Routing** (`shell/nav.ts`, replacing `state/url.ts`): the path table and legacy redirects in plan §4.3, and the exported functions with exactly the given signatures. `useStageContext()` returns, for C2:
   - `{kind:"item", ref}` for an item page;
   - `{kind:"asset", ref: slotRef, version}` for a document;
   - `{kind:"plan", ref: sel}` when the Plan has a selection;
   - `{kind:"journal", ref:"ENG"}` for the journal;
   - otherwise null.

   Type it as `StageContext & { label: string }`, where `StageContext` is the U0 contract type in `@workbench/core` (`packages/core/src/api.ts`: `{ kind: "item" | "asset" | "plan" | "journal", ref: string, version?: string }`). This is what C passes to `api.postMessage(eid, tid, { text, context })`, minus `label`.

   Also export a `label` string ("themes.md 2.0", "WI-004 Consolidate themes") for the chip. Unit-test the parse and build round trips, and the legacy redirects.
4. **Tabs** (`shell/tabs.ts`, zustand, persisted per engagement in `localStorage` with every read and write in try/catch): Home and Plan are pinned. An object tab opens on navigation, and focuses if it is already open. A doc tab's key is the slotRef, and opening another version of the same slot replaces it. There are at most 8 object tabs, closed least recently used first. Closing the active tab activates its left neighbour. Unit-test the LRU and replace rules.
5. **The shell** (`shell/AppShell.tsx`, used by `App.tsx` for `/e/:eid/**`):
   - the **nav rail**: W mark (`back-to-start`), `nav-home` (with the badge `inbox-count` = `engagement.inboxCount`), `nav-plan`, `nav-documents`, and `open-settings` at the bottom. Tooltips on all of them;
   - the **top bar**: engagement name, KPIs (`progress-kpi` with a Harvey ball and done/total from `engagement.progress` (U0 C6: leaf tasks, cancelled excluded), `plan-version` showing "v3", spend to 2 decimals), a live indicator (count of `activeRunId` in the plan), `rail-toggle`;
   - the **tab strip** (`stage-tab-<key>`, `stage-tab-close-<key>`). The home tab is labelled "Kick-off" while `plan.items.length <= 1`, else "Brief";
   - the **stage**, which renders the page for the route;
   - the **rail** (`approach-rail`): a header with "Approach Agent", `rail-journal` (→ `openJournal`), `rail-expand` (→ `/conversation`) and collapse; its body renders `rail/RailContent.tsx`. Resizable from 320 to 480px, width persisted, toggled with `\` (`shell/shortcuts.ts` with `useShortcut`, ignored in inputs). Under 1280px it overlays with `--shadow-float`. **While the home tab is the Kick-off, or the route is `/conversation`, hide the rail**, so only one `chat-panel` exists;
   - the **dev strip** (`dev-strip`): `runtime-badge` (runtime · profile · work model · approach model), `ws-status`, `cost-total` (3 decimals), `open-folder` + `folder-path` with Copy, and `open-feedback`. Hideable through a setting.
6. **Settings drawer:** move the `SettingsPanel` contents into a right-hand drawer with the same ids. Add `setting-theme` (system / light / dark → `data-theme` on `<html>`), `setting-density` (comfortable / compact → `data-density`) and `setting-dev-strip`. These three are stored in `localStorage` only.
7. **Engagements home** (`pages/home/HomePage.tsx`, replacing `StartPage`):
   - a caps title and **New engagement**: this is the existing *Start with the Approach Agent* (`start-with-approach`, `approach-name-input`), opening the engagement;
   - a portfolio table of engagements (`engagement-card` rows, `open-engagement-button`): name, progress Harvey ball + done/total, needs-you count, spend;
   - below it, a "Start from a seed" section with the seed cards (`seed-card`, `engagement-name-input`, `create-engagement-button`), visible without a click.
8. **Page stubs** (plan §4.4): `pages/{plan/PlanPage, item/ItemPage, doc/DocumentPage, documents/DocumentsPage, brief/BriefPage, kickoff/KickoffPage, journal/JournalPage}.tsx` and `rail/RailContent.tsx`, each rendering today's component, so every I1 and I2 flow still works in the new shell. Remove `EngagementLayout`.

## Checks, then stop
- `pnpm --filter @workbench/web run typecheck`, the web tests (update `App.test.tsx` for the new shell), and your url and tabs tests.
- **Boot check:**
  1. `pnpm dev:fake` (web :5317, API :4317; if 4317 is busy, don't kill it: report it);
  2. open the acme seed; click Home → Plan → a node (the stub still opens the item via the old selection, which is fine) → a data object → Settings → the theme toggle;
  3. stop the servers, found by port.
- No real SDK runs. Don't run the e2e walks; the main session adapts them.

Finish with a **≤ 20-line final message**:
- what you built;
- the exact exports of `shell/nav.ts` and `ui/` (B and C code against them);
- any ids you added beyond the plan;
- check evidence;
- contract change requests;
- open issues.

No report files.
