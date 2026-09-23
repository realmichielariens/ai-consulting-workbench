# L0 — Contracts: ready for a look (Look A)

**Built:** the P0a contracts that every I1 work package builds against:
- the domain model, config, disk layout, activity items and events;
- the runtime and server ports, and the run termination rule;
- the seed format, the REST and WebSocket API, and the Drizzle schema;
- `CLAUDE.md`, the conventions for every agent.

**Quick checks:**
- `tsc --strict --noUncheckedIndexedAccess` is clean, run against Zod 4.6 and Drizzle 0.44 from the spike.
- A runtime check of the tricky schemas passes: the gate short forms, request union defaults, version and path helpers, the termination rule, route building and event parsing.

**API spent:** $0.

## Take a look (~15 minutes, in this order)

1. **[packages/core/src/domain.ts](../../../packages/core/src/domain.ts)**: the vocabulary. Check the item front-matter (`ItemFrontMatter`), the statuses, `RunReason` and `RunOutcome`, and the three I1 request types.
2. **[packages/core/src/api.ts](../../../packages/core/src/api.ts)**, `routes` and the views:
   - Is every step of J1.1–J1.8 reachable?
   - `ItemActions` (a set of `Allowed` values) is how the UI knows whether a button is enabled, and why not.
3. **[packages/core/src/ports.ts](../../../packages/core/src/ports.ts)**: the six work tools the agent gets, and the `AgentRuntime` that both the real and the fake agent implement.
4. **[packages/core/src/seed.ts](../../../packages/core/src/seed.ts)**: the seed folder layout (the header comment).
5. **[CLAUDE.md](../../../CLAUDE.md)**: the rules the Sonnet agents follow, including the stop rule (rule 5).
6. *Optional*: [layout.ts](../../../packages/core/src/layout.ts), [events.ts](../../../packages/core/src/events.ts), [termination.ts](../../../packages/core/src/termination.ts), [config.ts](../../../packages/core/src/config.ts), [schema.ts](../../../packages/db/src/schema.ts).

## Decisions made in the contracts (you may want to overrule these)

| # | Decision | Why | Deviates from |
|---|---|---|---|
| 1 | **`item.md` has no `status` field.** State lives in the DB; `plan.md` shows it. | A§5.3: state is never kept in files except as a projection | The D§4.1 example, which shows `status: ready` |
| 2 | **`run_issue` is a request type** (R3: retry / stop in the Inbox) | There is no agenda until I5; it becomes an agenda topic then | A§6.1 request types |
| 3 | **An extra run reason, `resume`**, continues an interrupted session (R1, R5) or retries after a run issue | Stop and resume need a reason that isn't an answer or a review | A§8.2 run reasons |
| 4 | **A non-blocking question with no submit also gets the one nudge** | The agent may have forgotten to submit | — |
| 5 | **The first version of a slot is always 1.0**, whatever kind the agent passes | Minor and material only mean something relative to an earlier version | — |
| 6 | **Gate rounds**: "request changes" closes round *n*, and the next submit opens round *n+1*. A verdict applies only to the exact versions submitted. | J1.5 says approving an old version must be impossible | — |
| 7 | **Leases are keyed by `scope_key`** (`work:WI-002`) and store the child PID | The lease is taken before a new session has an id; the PID enables the orphan cleanup (R2) | A§6.2 `sessions` keyed by session id |
| 8 | **Run activity is not an event.** It lives in `.workbench/runs/R-xxxx.activity.jsonl` and is pushed live over the WebSocket. | High volume; the events table stays a readable timeline | — |
| 9 | **Views carry `Allowed {allowed, reason}`** for every action | The UI never re-implements engine rules, and disabled buttons can explain why | — |
| 10 | **In I1, question handling defaults to `always-human`** | There is no Approach Agent yet (ITERATIONS §4.1) | D§8.1 default `aa-first` |
| 11 | **Seed assets are published as v1.0 by `human`** with the note "From seed <id>" | Keeps `Actor` simple; the note records where the asset came from | J1.1 text "human (seed)" |
| 12 | **Ids are server-assigned and zero-padded**: `R-0001`, `RQ-0001`. Engagement id = folder name (`acme-discovery`, `acme-discovery-2`, …). | Readable in `git log` and file names | — |
| 13 | **The `demo` profile uses `claude-opus-5-5`**; the `test` profile uses Haiku for every role | Your approval of the plan defaults | A§4 (`claude-opus-5`) |
| 14 | **On WebSocket reconnect the UI refetches its queries** instead of replaying missed events | Simpler and always correct for I1 | — |

A§ and D§ items marked as deviations are updated in the documentation at the end of I1 (I1-PLAN §10). If you accept them, I'll note them then.

## Questions for you

1. Are you OK with **#1** (no status in `item.md`)? It means a hand-edited `item.md` can never change an item's status.
2. The UI offers **"Open folder"** by having the server open Explorer on your machine, since everything is local (J1.8). Is that fine, or would you rather have the path shown for copying?

## Outcome

Accepted by the user ("run until there is something for me to demo"), with the defaults for both questions: no status in `item.md`; Open folder opens Explorer and the UI also shows the path.

## Contract change requests

None. This is the first version.

## What happens after your go

1. I commit the contracts to `iteration/i1`.
2. I launch **SCAFFOLD** in the foreground: workspace, dependencies, config and env loaders, and a boot page.
3. I launch **W2 CONTENT** in the background: seed, interview notes, prompts and skills.
4. After I've reviewed SCAFFOLD, I launch **W1 RUNTIME**, **W3 CORE + DB** and **W4 STORE** in parallel, in the background.
5. Look B comes when their look points are in.
