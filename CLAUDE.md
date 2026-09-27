# Agentic Project Workbench: conventions for every agent

A local, single-user POC in which a human runs an engagement (for example an IT strategy) with AI agents. It is built on the Claude Agent SDK, with TypeScript end to end and a pnpm workspace. The current iteration is **I1, the walking skeleton**.

## Documents

| Document | Read it for |
|---|---|
| [DESIGN.md](DESIGN.md) ("D§") | What the product does: concepts, lifecycle, demo script |
| [ARCHITECTURE.md](ARCHITECTURE.md) ("A§") | How it is built: storage, engine, agent runtime, guards, API |
| [ITERATIONS.md](ITERATIONS.md) | The iteration order, and **the user journeys that are the specification** (I1: §4) |
| [iterations/I1-PLAN.md](iterations/I1-PLAN.md) | Work packages, look points, validation, budget |
| [spike/M0-FINDINGS.md](spike/M0-FINDINGS.md) | What M0 validated about the SDK. The working SDK configuration is in §2. |
| [ux/EXHIBIT.md](ux/EXHIBIT.md) | The visual language (tokens in `ux/exhibit-tokens.css`, playground in `ux/playground/`). Any UI work follows it. |
| [ux/REDESIGN-PLAN.md](ux/REDESIGN-PLAN.md) | The journey redesign: shell, pages, flows, and why |
| [iterations/UX1-PLAN.md](iterations/UX1-PLAN.md) | The UX1 iteration (the redesign, before the rest of I3). Briefs are in `iterations/UX1/briefs/`. |

## Contracts (read-only for work-package agents)

| File | Content |
|---|---|
| `packages/core/src/domain.ts` | Ids, items, statuses, assets and versions, runs, requests, settings |
| `packages/core/src/config.ts` | `workbench.config.yaml` shape and defaults |
| `packages/core/src/layout.ts` | Workspace and engagement disk layout. Build every path through these helpers. Node-only: import it from `@workbench/core/node`, together with `paths.ts`, `env.ts` and `config-loader.ts`. The browser-safe entry `@workbench/core` exports everything else. |
| `packages/core/src/activity.ts` | The readable activity item (live run stream) |
| `packages/core/src/events.ts` | Domain events |
| `packages/core/src/ports.ts` | `WorkPort` (work tools → server) and `AgentRuntime` (server → real or fake agent) |
| `packages/core/src/termination.ts` | How a run ended, and the one nudge |
| `packages/core/src/seed.ts` | Seed format (equal to the playbook starter-plan format) |
| `packages/core/src/api.ts` | REST routes, views, WebSocket messages |
| `packages/db/src/schema.ts` | Drizzle tables for I1 |

If a contract is wrong or missing something, **do not edit it**. Work around it locally, and describe the change under *Contract change requests* in your look report. The main session decides and tells every affected agent.

## Rules

1. **Read before coding**:
   - this file;
   - ITERATIONS.md §1 and §4;
   - I1-PLAN.md §3 and your package's section in §6;
   - the A§ sections your package names;
   - the contracts above.
2. **Write only inside your package's paths** (I1-PLAN §6). Never write outside them, not even to "just fix" something small.
3. **Dependencies are pre-installed.** Never run `pnpm add` or change the lockfile. Request new dependencies in your report.
4. **The SDK is accessed only through `packages/agents/src/sdk.ts`.**
   - Use the model from the active profile (`test` = `claude-haiku-4-5`).
   - Always pass `settingSources: []`, the explicit `tools` list, `Skill` in `allowedTools`, the pinned `CLAUDE_CONFIG_DIR`, the clean env, and the mandatory guards (M0-FINDINGS §2).
   - Never enable `PowerShell` for an agent. In I1, never enable `Bash` for an agent either.
5. **The stop rule (I1-PLAN §3.1).**
   - Build your package, then run only the quick checks: typecheck, lint, unit tests under about 60 seconds, runs on the scripted fake agent, at most 2 real SDK runs totalling ≤ $0.10, and a brief boot check.
   - Then write your look report to `iterations/I1/looks/L<n>-<package>.md`, return it as your final message, and **end your turn**.
   - Never start a full validation (benchmarks, batteries, repeated real runs, real end-to-end runs, the full Playwright suite, restart or kill tests, stress tests, the `demo` profile) until the main session relays a "go".
   - Never wait or poll for a reply.
6. **After "go"**, run the validation plan from your look report. Write `iterations/I1/reports/W<n>-<package>.md` (verdict, results with evidence, cost, surprises, deviations, open issues) and return it.
7. **Evidence.** Mark something as passing only with evidence: command output, a transcript line, a hash comparison. Never report an expected result as observed.
8. **Secrets.** Never print, log or commit the API key. Everything written to a transcript or log goes through `redact()`.
9. **Cost.** Respect your package's cap. Nothing enforces it for you, so track the cost each run reports and stop before you go over.
10. **Leave nothing running.** Stop every dev server, browser and Claude Code child process you started. Tell the user how to start things; don't leave them running.
11. **Windows.** Use `path` and the helpers in `layout.ts` / `paths.ts`, never string concatenation. Scripts in `package.json` must work from both PowerShell and Git Bash. To spawn Node scripts, use `process.execPath` with `--import tsx`, not `.cmd` shims.
12. **Architecture invariants**:
    - Zod validates at every boundary: API, tool inputs, files, DB JSON columns.
    - API routes contain no business logic.
    - **Only the engine rules (`packages/core/src/rules/`) decide status transitions.**
    - Only the server's services write engagement files and the DB. The file is written first, then the DB transaction, then the event.
    - Agents write only inside their own item's `work/`.
    - Published version files are immutable.
13. **Never commit**, and never edit DESIGN.md, ARCHITECTURE.md, ITERATIONS.md or I1-PLAN.md. Put proposed changes under *Deviations* in your report.
14. **Exact APIs.**
    - For the SDK, read `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` (pinned `0.3.280`). Don't guess option names.
    - Zod is v4: use `z.iso.datetime()`, and `z.record(key, value)` always takes two arguments.
15. **The spike is reference only.** Port code from `spike/` into your package; never import from it.
16. **Style.**
    - TypeScript strict, ESM, `.js` extensions in relative imports.
    - Small modules with focused names.
    - Comments explain *why* something is done, not what.
    - Every engine rule gets a unit test.
