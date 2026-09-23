# Engine rules (I1)

Owned by W3. Pure functions, no I/O, browser-safe. This is the *only* code
allowed to decide an item's status transition (CLAUDE.md rule 12); every
other package calls into here rather than re-implementing a rule.

| Module | Decides |
|---|---|
| `lifecycle.ts` | The item status state machine: `applyItemEvent(status, event, ctx)`. One `ItemEvent` per tool call or human action; never set status directly. |
| `readiness.ts` | `computeReadiness(plan)`: which waiting items are ready, and why not (`ReadinessBlocker[]`, shown in the UI, J1.2). `initialStatus(def)` for new items. |
| `versioning.ts` | `nextVersion(existing, kind)`: the next `major.minor` for a slot. First version is always 1.0. |
| `gates.ts` | Gate chain rounds: what opens on submit, how a verdict resolves, and the J1.5 rule that a verdict binds to the exact round (and versions) it was raised for. |
| `rollup.ts` | A composite's roll-up (counts per status, worst status) over its leaf descendants, using `STATUS_SEVERITY`. |
| `actions.ts` | `computeItemActions(state) → ItemActions`: which UI actions are allowed right now, and the reason when they are not. |

`pnpm core:transitions` prints the lifecycle table from `lifecycle.ts` as
Markdown, and doubles as a consistency check (it fails if a listed scenario
is unexpectedly denied).

Every module here has a Vitest suite next to it (`*.test.ts`).
