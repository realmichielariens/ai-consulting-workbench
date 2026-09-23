# Agentic Project Workbench

A local, single-user POC in which a human runs an engagement (for example an IT strategy) with AI agents, built on the Claude Agent SDK. See [DESIGN.md](DESIGN.md) and [ARCHITECTURE.md](ARCHITECTURE.md) for what it does and how it's built, and [CLAUDE.md](CLAUDE.md) for the conventions every package follows.

## Getting started

**Prerequisites**: Node.js ≥26, pnpm 11.5.1 (`packageManager` is pinned; use [Corepack](https://nodejs.org/api/corepack.html) or install that exact version).

```sh
pnpm install
```

The API key (`ANTHROPIC_API_KEY`) is resolved in this order: the process environment, a repo-root `.env` (git-ignored — create one from scratch, there is no `.env.example` at the root), then the Windows user environment variable (`HKCU\Environment`). It is never required just to boot the app with `pnpm dev:fake`.

```sh
pnpm dev        # server (real agent runtime) + web, on the ports in workbench.config.yaml (4317, 5317)
pnpm dev:fake   # same, but the server reports runtime "fake" (WORKBENCH_RUNTIME=fake) — no API key needed
pnpm typecheck  # tsc --noEmit for every package and app
pnpm test       # Vitest for every package and apps/web (jsdom), one command
pnpm e2e        # Playwright, against a `dev:fake` server it starts and stops itself
```

Stop `pnpm dev`/`pnpm dev:fake` with Ctrl-C; it shuts the server down cleanly. Nothing is left running by the quick checks in `iterations/I1/reports/`.
