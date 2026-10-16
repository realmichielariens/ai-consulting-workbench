// Root Vitest config: one command (`pnpm test`) runs every package's and
// apps/web's tests as separate "projects". Packages without tests yet (db,
// store, agents, server) get `passWithNoTests` inline here so `pnpm test`
// stays green while they're empty; remove that once a package has its own
// *.test.ts files. apps/web is referenced by directory so Vitest picks up
// its own vite.config.ts (React plugin, jsdom environment).
//
// To add a test in a package: drop a `*.test.ts` file next to the source
// (see packages/core/src/paths.test.ts), then run `pnpm test`, or
// `pnpm --filter @workbench/<pkg> exec vitest run` for just that package.

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      { extends: true, test: { name: "core", root: "./packages/core" } },
      { extends: true, test: { name: "db", root: "./packages/db", passWithNoTests: true } },
      { extends: true, test: { name: "store", root: "./packages/store", passWithNoTests: true } },
      { extends: true, test: { name: "agents", root: "./packages/agents", passWithNoTests: true } },
      { extends: true, test: { name: "server", root: "./packages/server", passWithNoTests: true } },
      "apps/web",
    ],
  },
});
