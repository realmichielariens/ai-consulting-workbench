# L3 — core-db: ready for a look

**Built:** The I1 engine rules in `packages/core/src/rules/` (`lifecycle.ts`,
`readiness.ts`, `versioning.ts`, `gates.ts`, `rollup.ts`, `actions.ts`, each
pure, browser-safe, with its own Vitest suite) plus `pnpm core:transitions`,
which prints and self-checks the lifecycle table. And the DB layer in
`packages/db/`: migrations generated from `schema.ts`, `openEngagementDb()` /
`walCheckpoint()`, atomic id counters, and one typed, synchronous repository
per I1 table (items, asset_versions, consumptions, runs, requests,
gate_steps, sessions/leases, events), an inbox query building block, and a
written-but-not-run multi-process lease-race stress script.
**Quick checks:** typecheck ✔ (core, db) · unit tests ✔ (156: 110 core + 46
db; 259 across the whole repo) · smoke: `pnpm core:transitions` (20
transitions printed and self-checked), `pnpm db:generate` (migration
generated and applied via `openEngagementDb` in every DB test, all against
real temp-file DBs, not `:memory:`) · no SDK/API calls.
**API spent:** $0.00 (cap $0, as planned — this package is pure rules and DB).

## Take a look (≤ 10 minutes)

1. `pnpm core:transitions` — read the printed Markdown table (from → event →
   to → condition) against DESIGN.md §4.2's lifecycle diagram and the R5
   clarification (ITERATIONS.md §4.3). Every row is produced by actually
   calling `applyItemEvent`, so the table can't drift from the code.
2. Open `packages/core/src/rules/lifecycle.ts` — the whole I1 state machine
   is one function, `applyItemEvent(status, event, ctx)`. Compare its denial
   reasons (e.g. `"Starting is only possible once the item is ready (it is
   waiting)."`) against how you'd want the UI to explain a disabled button.
3. Open `packages/db/migrations/0000_nice_texas_twister.sql` — generated
   directly from the untouched `schema.ts` contract; nothing hand-edited.
4. Open `packages/db/src/repos/leases.ts` — the `acquireLease` function is
   the production port of the M0 S8 `BEGIN IMMEDIATE` + conditional UPSERT
   pattern (see the file's header comment for why `db.transaction()` can't
   be used here).

## Questions for you

- **R5 clarification (as ITERATIONS.md flags it should be added to D§4.2):**
  both a human **Stop** and a server-side **interrupted** run outcome land
  the item on the *same* status, `ready` (not a separate "interrupted"
  status). `ItemNode.resumable` (api.ts, already true) is what tells the UI
  there's a session to continue. I read D§4.2's diagram and R1/R5 as
  intending exactly this; flag if you pictured a distinct visible state.
- **Run issues share a status with questions.** `no_submit` / `max_turns` /
  `error` (R3, "run issue") and a genuine blocking question (J1.4) both move
  the item to `blocked`. They're told apart by the *request type*
  (`run_issue` vs `question`) sitting in the Inbox, not by item status. Seemed
  the simplest reading of the contracts (`domain.ts`'s `RequestType` already
  has both); flag if you want a separate status.
- **`actions.ts`'s own decision (not asked for verbatim in the plan):** when
  an item has a resumable interrupted run, I disable **Start** in favour of
  **Resume** (reason: *"This item has an interrupted run. Use Resume to
  continue it."*) rather than offering both. Easy to change to "both
  allowed" if you'd rather.
- **`mark_done`** requires *every* required output slot to be published, not
  "at least one" — read literally from J1.6 step 3 ("only enabled once every
  required output slot has a version").
- **Gate chains beyond I1:** `gates.ts`/`gate_approved` on a non-last step
  keeps the item `at_gate` (the next step opens, arrives in I6). I1 never
  exercises this (its one chain has exactly one step), so it's untested by
  real data — only by the unit test's synthetic 2-step chain.

## Known gaps and shortcuts (not yet validated)

- `packages/core/scripts/print-transitions.ts` and `packages/db/scripts/*.ts`
  are **not** covered by `pnpm typecheck` — the packages' `tsconfig.json`
  `include` only lists `"src"`, and editing `tsconfig.json` was outside my
  allowed paths. They do run correctly (`pnpm core:transitions` exercises
  the core one; the db ones are syntactically reviewed but intentionally not
  executed, see below). Flag if you'd like `tsconfig.json` widened.
- The multi-process **lease-race stress script**
  (`packages/db/scripts/lease-race.ts` + `lease-race-worker.ts`, wired as
  `pnpm --filter @workbench/db run test:stress`) is **written but has not
  been run once**, per the stop rule (I1-PLAN.md §3.1 / CLAUDE.md rule 5
  explicitly list it as validation-only). It calls the real
  `acquireLease()` (not a copy), spawns `process.execPath --import tsx`
  (never a `.cmd` shim), and uses the same file-barrier technique M0 S8
  validated. I can't yet claim "200/200, one winner" as observed — only
  that S8 already validated this exact pattern.
- Repositories are typed and unit-tested in isolation; none of them are
  wired into any server code yet (W5's job). In particular `consumptions.ts`
  and the `meta`/plan-version mirror are minimal — I4 will need more
  (staleness queries, reclassification).
- `events` rows don't carry `engagementId` (one DB file per engagement, by
  design — ARCHITECTURE.md §5.2); every read function takes it as a
  parameter instead. Worth double-checking this matches W5's assumptions
  when it builds the WebSocket "hello" catch-up.
- `hashItemDef`'s stability is unit-tested for key-order independence and
  content-sensitivity, but not yet exercised against real seed content
  (W4/W2's job to produce `ItemDef`s from `item.md`).

## Contract change requests

None. `domain.ts`, `ports.ts`, `events.ts`, `api.ts`, `termination.ts` and
`schema.ts` were read-only and untouched; `packages/core/src/index.ts` got
exactly the one requested line (`export * from "./rules/index.js";`).

## Validation plan (runs only after your go)

| Step | What it proves | Duration | API cost |
|---|---|---|---|
| `pnpm --filter @workbench/db exec vitest run` (already green, re-run for the record) | Repository correctness on real temp-file DBs (WAL, not `:memory:`) | <5s | $0 |
| `pnpm --filter @workbench/db run test:stress` (`LEASE_RACE_WORKERS=5 LEASE_RACE_ROUNDS=200`) | The multi-process lease race: exactly one winner per round, 200/200, across 5 real OS processes | ~10–30s | $0 |
| `pnpm --filter @workbench/core exec vitest run` and `pnpm --filter @workbench/db exec vitest run` with `--coverage` (optional) | Confirms every rules module and repository function is exercised | <10s | $0 |
| Re-run `pnpm core:transitions` after any contract or rule change | Table stays in sync with DESIGN.md §4.2 | <5s | $0 |
