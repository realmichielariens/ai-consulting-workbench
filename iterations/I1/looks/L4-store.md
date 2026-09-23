# L4 — STORE + SEED: ready for a look

**Built:** `packages/store` — the file store (`files.ts`: item.md read/write
via gray-matter with deterministic front-matter key order, append-only
`worklog.md`, immutable version files opened with the exclusive `"wx"`
flag, `engagement.yaml`, `ensureItemDirs`, and a per-engagement serialized
write queue), the seed loader (`seeds.ts`: `loadSeed`/`listSeeds` with every
beyond-schema check from `demo/scripts/validate-seed.ts` plus a
sequencing/input dependency-cycle check, and `createEngagementFromSeed`),
the Git service (`git.ts`: `initRepo`, `checkpoint` with actor attribution
and `Workbench-*` trailers, `log`/`logStat`), and the `plan.md` projection
(`projections.ts`: `renderPlanMd` — pure over `PlanView` — and
`buildPreviewPlanView`, which assembles a preview `PlanView` straight from
seed defs since there is no engine/DB yet). `pnpm seed:try <seedId>
[--name <name>]` wires all four together.
**Quick checks:** typecheck ✔ (`pnpm --filter @workbench/store run
typecheck`, and `pnpm typecheck` shows the rest of the workspace unaffected
— the one pre-existing failure in `packages/agents` is W1's, not mine) ·
unit tests ✔ **44/44** (`pnpm --filter @workbench/store exec vitest run`;
item.md round trip on every seed item, worklog appends, immutability,
7 broken-seed cases, `createEngagementFromSeed` layout, git attribution/
trailers/no-op, `renderPlanMd` snapshot + readiness logic) · smoke:
`pnpm seed:try acme-discovery` — created the engagement below, plus a
`--name` + auto-disambiguation check (`acme-discovery-2`, deleted after
confirming it worked, so only the primary engagement is left for you).
**API spent:** $0.00 (no SDK/API calls; this package makes none).

## Take a look (≤ 10 minutes)

1. From the repo root: `pnpm seed:try acme-discovery` (safe to re-run; it
   creates a fresh `acme-discovery-2` etc. each time — I've left just
   `workspace/engagements/acme-discovery` from my own run for you).
2. Open `workspace/engagements/acme-discovery/` directly and look around:
   `engagement.yaml`, `items/WI-002/item.md` (front-matter order, the
   `## Brief` heading), `items/ENG/assets/context/v1.0.md` (byte-identical
   to `demo/seeds/acme-discovery/assets/ENG/context.md` — diffed, confirmed
   identical), and `plan.md` (the readable outline: composites with
   roll-up, 🤖/👤 icons, ◇ gate markers, output versions).
3. `cd workspace/engagements/acme-discovery && git log --format=full` — one
   commit, `Author: human <human@workbench.local>`, `Commit: Workbench
   <workbench@workbench.local>`, with the `Workbench-Event: EngagementCreated`
   trailer. `git log --stat -1` (also printed at the end of the
   `seed:try` run) shows exactly the 12 files ARCHITECTURE.md §5.2
   describes (no `.workbench/` yet — that's the DB, which this package
   deliberately never touches).
4. Skim `packages/store/src/*.test.ts` for the shape of what's already
   proven: `files.test.ts`, `seeds.test.ts`, `git.test.ts`,
   `projections.test.ts`.

## Questions for you

- **item.md body format.** I write the brief under a `## Brief` heading
  (stripped back off on read) rather than bare prose, for readability when
  someone opens the file directly. Front-matter key order is fixed to
  match `ItemFrontMatter`'s field order (`id, title, parent, order,
  executor, inputs, sequencing, outputs, skills, gate, autostart,
  acceptance`), via `js-yaml`'s default insertion-order preservation
  (`sortKeys: false`) — not alphabetical.
- **Brief whitespace is normalized (trimmed) on write.** Seed briefs come
  out of YAML `|` block scalars with exactly one trailing newline;
  `writeItemMd`/`readItemMd` trim it, so `ItemDef.brief` is always
  whitespace-clean rather than byte-preserving arbitrary surrounding
  whitespace. `createEngagementFromSeed`'s returned `defs` are trimmed the
  same way, so what the server would insert into the DB always matches
  what's on disk. Overrule if you'd rather preserve briefs byte-exactly.
- **Worklog format**: `### <YYYY-MM-DD HH:mm:ss local> — <actor>` sections,
  local time computed from date parts (not `toLocaleString`, so the format
  doesn't depend on the machine's locale). First write creates a `#
  Worklog — <id> <title>` header by reading the title from `item.md`.
- **Commit identity**: author name = the actor string verbatim
  (`human`, `agent:WI-002`, `system`); author email = the actor with every
  `:` replaced by `-`, `@workbench.local` (`agent-WI-002@workbench.local`);
  committer is always `Workbench <workbench@workbench.local>`. Set via
  `GIT_AUTHOR_*`/`GIT_COMMITTER_*` env vars on the one spawned `git`
  process (verified empirically — never touches `user.name`/`user.email`,
  local or global).
- **`readVersion` returns `Buffer`, plus a separate `readVersionText`**
  rather than one function that returns "text or bytes" depending on
  something — I judged an overload or a runtime flag less clear than two
  names. Easy to rename if you'd rather have one.
- **`listSeeds` silently skips a seed folder that fails validation**
  (rather than throwing), reasoning that the start page (J1.1) should show
  every *good* seed rather than fail outright over one bad one.
  `loadSeed`/`demo/scripts/validate-seed.ts` are the place a broken seed's
  exact problem shows up.
- **`renderPlanMd`'s preview statuses are provisional.** Since there's no
  engine/DB yet, `pnpm seed:try` computes readiness itself
  (`buildPreviewPlanView`: `ready` iff every *required* input is seeded,
  else `waiting`) purely to make the projection non-trivial. W3's rules
  are the real source of truth once W5 wires the server up; this preview
  builder isn't meant to survive into production code paths.

## Known gaps and shortcuts (not yet validated)

- The Git round trip with a **real** WAL-mode SQLite file (spike S8's
  scenario: write, `wal_checkpoint(TRUNCATE)`, commit, tag, write more,
  checkpoint again, close, `git checkout` back to the first tag, reopen)
  is not yet exercised through *my* `initRepo`/`checkpoint` — I've proven
  the generic mechanics (attribution, trailers, no-op-returns-null,
  `beforeCommit` runs before `add -A` and its files land in the commit,
  using a fake `state.db` file) but not with an actual `better-sqlite3`
  connection. That needs `better-sqlite3` as a devDependency of
  `packages/store` (currently not declared here — it's `@workbench/db`'s
  dependency). **Requesting it as a devDependency** for the validation
  step below; happy to do this differently if you'd rather the main
  session own that specific cross-package proof.
- `renderPlanMd`'s composite roll-up counts only *leaf* (`task`) items
  under a composite; the `ENG` root itself never gets a roll-up line if it
  has no task descendants (true for this seed), which is why its heading
  in `plan.md` has no "(x/y done)" suffix — a deliberate choice (see the
  edit I made to `projections.ts` partway through: show the count only
  when `total > 0`), not a bug, but worth a look.
- No document-format handling (pptx/xlsx/docx extraction) — out of scope
  for I1 (`.md` only in this seed); `writeVersionFile`/`readVersion`
  already work on raw bytes for any format, so this is a non-issue for
  I1's seed but untested beyond `.md`.
- I did not add a `.workbench/` folder or touch `state.db` anywhere —
  correct per spec ("does NOT touch the DB"), flagging only so it's clear
  the folder's absence in `workspace/engagements/acme-discovery/` right
  now is expected, not a bug.

## Contract change requests

None. Everything needed (`domain.ts`, `seed.ts`, `layout.ts`, `api.ts`
for `SeedSummary`/`PlanView`/`ItemNode`/`SlotNode`, and the node helpers)
was sufficient as written.

## Validation plan (runs only after your go)

| Step | What it proves | Duration | API cost |
|---|---|---|---|
| Full `packages/store` Vitest suite (already green; re-run for the record) | Everything in *Quick checks*, plus any fixes from this look | <10s | $0 |
| Real WAL-mode SQLite round trip through `initRepo`/`checkpoint` (port of `spike/experiments/s08-sqlite/src/git-roundtrip.ts`, using `better-sqlite3` as a new devDependency) — write, checkpoint, commit, tag, write more without checkpointing (git sees no diff), checkpoint again, commit, close the connection, `git checkout` back to the first tag, reopen, verify rows | ARCHITECTURE.md §11's checkpoint-before-commit rule and the Windows "close before checkout" rule, against *my* service, not just the spike's throwaway script | ~1 min | $0 |
| Immutability battery: every asset format the seed uses (`.md`), plus a binary-ish buffer, each written then re-written | `writeVersionFile` never silently overwrites, on every path shape | <10s | $0 |
| Windows path edge cases: workspace home and engagement id both containing spaces and mixed case (already covered for `createEngagementFromSeed`/`initRepo`/`checkpoint` in the quick-check suite) — extend to `pnpm seed:try` itself run from a Windows path with a space, via `PowerShell`, not just Git Bash | CLAUDE.md rule 11 ("Windows... Git Bash and PowerShell both available") | ~1 min | $0 |
| `pnpm seed:try` run twice in a row from a clean `workspace/`, diffing the two engagements' `plan.md`/`item.md` files byte-for-byte except `engagement.yaml`'s `createdAt` | Determinism: nothing but the timestamp differs between two runs of the same seed | ~1 min | $0 |
