# P0b — SCAFFOLD: report

**Status:** built, all quick checks green. No look point for this package (I1-PLAN §6: "Look: None. Main reviews.").

## What was built

A working pnpm workspace (`packages/*`, `apps/*`, `e2e`) with every dependency from A§4 pre-installed per package, so W1/W3/W4/W5/W6/W7 never need to touch the lockfile.

- **Root**: `package.json` (private, `type: module`, `packageManager: pnpm@11.5.1`, `engines.node >=26`), `pnpm-workspace.yaml`, `tsconfig.base.json` (strict, `noUncheckedIndexedAccess`, target `ES2023`, `module`/`moduleResolution: NodeNext`, `skipLibCheck`, plus `isolatedModules`/`verbatimModuleSyntax`/`esModuleInterop`/`resolveJsonModule`/`forceConsistentCasingInFileNames`/`noEmit`), `workbench.config.yaml` (byte-for-byte `DEFAULT_CONFIG_YAML` from `packages/core/src/config.ts`), `.gitignore` extended with `test-results/`, `playwright-report/`, `apps/web/dist/`, `**/.vite/` (existing lines kept), `README.md` ("Getting started").
- **`packages/core`**: added `src/paths.ts` + `src/paths.test.ts` (ported from `spike/src/lib/paths.ts` / `paths.test.ts`, rewritten onto Vitest), `src/node/env.ts` (ported from `spike/src/lib/env.ts`: `resolveApiKey`/`assertApiKey` in the process → repo-root `.env` → Windows registry order, `redact()`, `sdkEnv(repoRoot, workspace)`), `src/node/config-loader.ts` (`loadConfig(root?)`, `repoRoot(from?)`) + its own test, `src/node/index.ts` (the `"./node"` entry), `src/rules/README.md` (ownership note only, no code), `package.json`, `tsconfig.json`. `src/index.ts` (a contract file) got exactly the one line the plan asked for: `export * from "./paths.js";`.
- **`packages/db`**: `package.json` (`drizzle-orm`, `better-sqlite3@^13`, `@workbench/core`; dev `drizzle-kit`, `@types/better-sqlite3`), `tsconfig.json`, `drizzle.config.ts` (schema `./src/schema.ts`, out `./migrations`), stub `src/index.ts` re-exporting `schema.ts`. `schema.ts` itself untouched.
- **`packages/store`**: `package.json` (`gray-matter`, `yaml`, `simple-git`, `@workbench/core`), `tsconfig.json`, stub `src/index.ts`.
- **`packages/agents`**: `package.json` with `@anthropic-ai/claude-agent-sdk` pinned exactly `"0.3.280"`, `zod@^4`, `yaml`, `@workbench/core`; `tsconfig.json`; stub `src/index.ts`. `prompts/` was empty when I started, so I added a `.gitkeep`; W2 has since populated it with real prompt files (I checked before finishing and removed my now-redundant `.gitkeep`, touching nothing else in that folder).
- **`packages/server`**: `package.json` (`fastify`, `@fastify/websocket`, `@fastify/multipart`, all four `@workbench/*` deps), `tsconfig.json`, `src/main.ts` — a placeholder that loads config via `@workbench/core/node`, starts Fastify on `config.server.port`, implements `GET /api/health` (runtime from `WORKBENCH_RUNTIME`) and the WebSocket at `WS_PATH` sending `{type:"hello", engagementId, lastSeq:0}` on connect, with clean SIGINT/SIGTERM shutdown.
- **`apps/web`**: React 19 + Vite 8 + `@vitejs/plugin-react`, `@xyflow/react`, `elkjs`, `@tanstack/react-query`, `zustand`, `react-markdown`, `remark-gfm`, `@workbench/core`; dev `vitest`, `jsdom`, `@testing-library/react`, `msw`. `vite.config.ts` serves on `config.server.webPort` with a `/api` proxy (`ws: true`) to `config.server.port`, and also carries the `test` field (jsdom) so it's picked up as a Vitest project. `src/App.tsx` is the boot page: calls `/api/health`, opens a WS to `WS_PATH` for engagement `"boot"`, and renders "server connected (WS) — runtime: real|fake" once both resolve. `src/App.test.tsx` is an example component test.
- **`e2e`**: `@playwright/test`, `playwright.config.ts` (`baseURL http://localhost:5173`, `webServer` runs `pnpm dev:fake` from the repo root and waits on the web port), one placeholder test (`tests/boot.spec.ts`) asserting the boot status text. Chromium installed via `pnpm exec playwright install chromium`.
- **Root scripts**: `dev` (concurrently: server + web), `dev:fake` (`cross-env WORKBENCH_RUNTIME=fake` + `dev`), `typecheck` (`pnpm -r run typecheck`), `test` (`vitest run`, root `vitest.config.ts` with per-package Vitest **projects**), `e2e` (`playwright test --config=e2e/playwright.config.ts`). All use cross-platform tools (`cross-env`, `concurrently`) so they run the same from PowerShell and Git Bash.

## Commands run and outcomes (evidence)

| Command | Outcome |
|---|---|
| `pnpm install` | `Packages: +475`, then a second pass after adding `@types/node`/`yaml` to `apps/web`; final `pnpm install` exits clean, lockfile up to date. |
| better-sqlite3 + FTS5 check (run from `packages/db` so module resolution finds it) | `FTS5 rows: [{"body":"hello workbench fts5 test"}]` / `better-sqlite3 + FTS5: OK` |
| `pnpm typecheck` | All 7 packages/apps report `Done` (0 errors). |
| `pnpm test` | `Test Files 3 passed (3)` / `Tests 31 passed (31)` — `core` (paths.ts, config-loader.ts tests) + `web` (App.test.tsx); `db`/`store`/`agents`/`server` pass with `passWithNoTests` (no code yet). |
| `pnpm dev:fake` (boot check) | `GET http://127.0.0.1:4317/api/health` → `{"ok":true,"runtime":"fake"}`. Web dev server failed to bind **5173** only because an unrelated, pre-existing process on this machine (`element-of-supplies`, PID 37008/38280, running since 2026-09-18, **not started by me**) already holds that port — confirmed via `netstat`/`Get-CimInstance`. I did not touch that process. |
| Boot pipeline re-verified on a free port | Started server + web manually (`WORKBENCH_RUNTIME=fake`, web on `--port 5180`): `curl http://localhost:5180/` → `HTTP 200` (index.html); `curl http://localhost:5180/api/health` (through the Vite proxy) → `HTTP 200 {"ok":true,"runtime":"fake"}`; a small WS client received `{"type":"hello","engagementId":"boot","lastSeq":0}` both directly from `ws://127.0.0.1:4317/...` and proxied via `ws://localhost:5180/...`. All processes then killed by PID (`taskkill /T /F`); `Get-CimInstance` re-check afterward showed only the unrelated pre-existing processes. |
| `pnpm e2e` | Ran once with `workbench.config.yaml`'s `webPort` and `e2e/playwright.config.ts`'s `baseURL`/`webServer.url` **temporarily** changed from `5173`→`5180` (same port-conflict reason as above) — `1 passed (3.5s)`. Playwright's own `webServer` started and fully tore down `pnpm dev:fake`'s process tree (verified via `Get-CimInstance` afterward: only the unrelated pre-existing processes remained). **Both files were reverted immediately afterward** to their exact required values (`webPort: 5173`, `baseURL: "http://localhost:5173"`) — `workbench.config.yaml` now matches `DEFAULT_CONFIG_YAML` byte-for-byte, re-verified by re-reading it. |
| Final re-check after the revert | `pnpm typecheck` → all `Done`; `pnpm test` → `31 passed`; `git status --porcelain` → only the expected new/modified files (see below), nothing stray (no `dist/`, `test-results/`, etc. — `.gitignore` is doing its job). |

## Versions installed

| Package | Version |
|---|---|
| `@anthropic-ai/claude-agent-sdk` | **0.3.280** (pinned exactly, per plan) |
| `zod` | 4.6.5 |
| `drizzle-orm` | 0.45.3 / `drizzle-kit` 0.31.11 |
| `better-sqlite3` | 13.0.3 (N-API prebuilds; `win32-x64.node` present, loads and FTS5 works) |
| `react` / `react-dom` | 19.3.0 |
| `vite` | 8.3.0 (`@vitejs/plugin-react` 6.1.1) |
| `fastify` | 5.12.5 (`@fastify/websocket` 11.3.1, `@fastify/multipart` 10.1.2) |
| `@playwright/test` | 1.63.0 |
| `typescript` | **5.9.3** (see Deviations — latest is 7.0.2, deliberately not used) |
| `vitest` | 5.0.1 |
| `@xyflow/react` 12.11.6, `elkjs` 0.12.0, `@tanstack/react-query` 5.103.2, `zustand` 5.0.15, `react-markdown` 10.1.0, `remark-gfm` 4.0.1, `gray-matter` 4.0.3, `simple-git` 3.36.0, `yaml` 2.8.1 | as listed |

## Deviations from the plan

1. **pnpm's install-script gate uses `allowBuilds`, not `onlyBuiltDependencies`.** Empirically (pnpm 11.5.1): a `pnpm-workspace.yaml` with `onlyBuiltDependencies` still left `better-sqlite3`/`esbuild`/`msw` build scripts blocked; `pnpm install`'s own output pointed at `pnpm approve-builds`, and stubbed an `allowBuilds: { pkg: "set this to true or false" }` block into `pnpm-workspace.yaml` for the packages it found blocked. I set `allowBuilds` explicitly (`better-sqlite3: true`, `esbuild: true`, `msw: false`, plus proactive `true` entries for `@anthropic-ai/claude-agent-sdk`, `playwright`, `@playwright/test` since W1/W7 will need those installed with scripts allowed later), documented the reasoning in a comment, and verified `better-sqlite3` actually loads (FTS5 check above). `msw` is left disabled — its script only offers to write a browser service-worker file (`msw init`) that I1's jsdom-based component tests don't need.
2. **`typescript` pinned to `^5.9.3`, not `latest` (7.0.2).** `npm view typescript dist-tags` shows TypeScript 7 (the native/Go-ported compiler) is now `latest`; that's a major generational rewrite and I judged it a real compatibility risk for `tsx`/`vitest`/`drizzle-kit`, none of which I could confirm are validated against it. 5.9.3 is the last classic-compiler release. Worth revisiting deliberately later, not as a scaffold side-effect.
3. **`apps/web/tsconfig.json` overrides the base `module`/`moduleResolution`** to `ESNext`/`Bundler` (idiomatic for Vite) instead of `NodeNext`, and adds `"node"` to its `types` array. The `"node"` addition is needed purely for *type-checking*, not runtime: the browser-safe `@workbench/core` entry (`src/index.ts`, a contract file) re-exports `layout.ts` and `paths.ts`, both of which `import path from "node:path"` — TypeScript resolves and checks that whole module graph even though the browser code never calls the node:path-dependent functions. I only added the one requested line (`export * from "./paths.js"`) to `index.ts`; the pre-existing `export * from "./layout.js"` already carried this. **Runtime is fine** — confirmed via `pnpm --filter @workbench/web run build`: Vite/Rolldown externalizes `node:path` for the browser with a warning, not an error, and the app never invokes those functions. Flagging this as a contract-shape note for W6/W1: `"@workbench/core"` isn't fully node-free at the *module-graph* level, only at the *invoked* level.
4. **`apps/web/vite.config.ts` cannot import `@workbench/core/node`.** Confirmed empirically: `vite build` failed with `ERR_MODULE_NOT_FOUND` resolving `.../src/node/env.js`, because Vite loads config files through plain Node ESM, which — unlike `tsx`, `vitest`, and `tsc` — does **not** do the NodeNext `.js`→sibling-`.ts` resolution our source-linked packages rely on. `vite.config.ts` instead reads `workbench.config.yaml` directly with `node:fs` + `yaml` (a small, duplicated `findRepoRoot`/parse, documented inline). **Any other plain-Node config loader that tries to import our workspace TS packages directly will hit the same wall** — worth knowing before W5/W6 add more tooling config files (e.g. don't import `@workbench/*` from things not run through `tsx`/`vitest`/`tsc`).
5. **Local port squatting on this dev machine.** Port `5173` (and `5199`) were already held by an unrelated project (`element-of-supplies`) started 2026-09-18, well before this session — not something I started, so I didn't kill it. I verified the full boot pipeline on an alternate free port (`5180`) instead (see evidence table), and separately ran the real `pnpm e2e` suite by *temporarily* pointing `workbench.config.yaml`/`playwright.config.ts` at `5180` and reverting both immediately after (byte-for-byte back to spec, re-verified). **Next agents/you**: if `pnpm dev`/`pnpm dev:fake` refuses to bind 5173 on this machine, it's that pre-existing process, not the scaffold.
6. **Root Vitest wiring**: `vitest.config.ts` uses `test.projects` with inline `{ extends: true, test: { name, root, passWithNoTests } }` entries for `core`/`db`/`store`/`agents`/`server` (so they don't need their own `vitest.config.ts` files and don't fail while empty), and a plain `"apps/web"` directory entry so Vitest picks up `apps/web/vite.config.ts` itself (React plugin, jsdom). **To add a test in a package**: drop a `*.test.ts`(`x`) file next to the source (see `packages/core/src/paths.test.ts` or `apps/web/src/App.test.tsx`), then `pnpm test` picks it up automatically — remove that package's `passWithNoTests: true` in the root config once it has real tests, or just leave it (harmless once there are matching files).
7. Ran one extra `vite build` as a diagnostic while chasing the `node:path` issue (deviation 3/4 above); the resulting `apps/web/dist/` was deleted afterward (it's also `.gitignore`d).

## Known gaps and shortcuts (not yet built — by design, other work packages own these)

- `packages/core/src/rules/` has only a README (W3).
- `packages/db`, `packages/store`, `packages/agents` are stub `index.ts` files with no logic yet (W3/W4/W1).
- `packages/server/src/main.ts` is a placeholder W5 replaces entirely (no event bus, services, scheduler, reconciliation).
- `apps/web` has only the boot page; no process view, item detail, Inbox, etc. (W6).
- `e2e` has one placeholder journey test; W7 builds J1.1–J1.8 and R1–R6.

## How packages import each other (for the next agents)

- Each package's `package.json` has `"exports": { ".": "./src/index.ts" }` (plus `"./node": "./src/node/index.ts"` for `@workbench/core`'s node-only entry) and declares siblings as `"@workbench/<pkg>": "workspace:*"`.
- There is **no build step**: everything runs as TypeScript source via `tsx` (see `packages/server`'s `dev` script: `tsx watch src/main.ts`) or is transpiled per-file by Vite/Vitest/esbuild.
- Relative imports inside a package use the `./foo.js` convention (NodeNext-style, resolves to the sibling `.ts` file) — already the convention in the contract files; keep using it.
- **Browser code** (`apps/web`) must only `import ... from "@workbench/core"`, never `"@workbench/core/node"`. Note deviation 3 above: the plain `"@workbench/core"` entry currently still pulls in `layout.ts`'s `node:path` import at the module-graph level (harmless at runtime, but don't add more node-only code to files reachable from that entry without checking `vite build` still just warns rather than errors).
- Any tool config file that is **not** run through `tsx`/`vitest`/`tsc` (e.g. `vite.config.ts` itself) cannot `import` our workspace `@workbench/*` packages — see deviation 4.

## API spend

**$0.00.** No SDK/API calls were made (per the plan's cap for this package).

## Cost cap

$0 cap, $0 spent.
