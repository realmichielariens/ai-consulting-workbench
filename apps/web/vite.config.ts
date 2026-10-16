/// <reference types="vitest/config" />
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";

// Deliberately does NOT import "@workbench/core/node": Vite loads this file
// itself through plain Node ESM (not tsx), which cannot resolve the ".js"
// specifier in that package's relative imports to its sibling ".ts" files
// (confirmed empirically: `vite build` failed with ERR_MODULE_NOT_FOUND
// resolving packages/core/src/node/env.js). tsx-run code (packages/server,
// scripts) does not have this problem; only bare config-file loaders like
// Vite's do. See iterations/I1/reports/P0b-scaffold.md.
function findRepoRoot(from: string): string {
  let dir = path.resolve(from);
  for (;;) {
    if (fs.existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error(`no pnpm-workspace.yaml found walking up from ${from}`);
    dir = parent;
  }
}

const root = findRepoRoot(import.meta.dirname);
const configYaml = parseYaml(fs.readFileSync(path.join(root, "workbench.config.yaml"), "utf8")) as {
  server?: { port?: number; webPort?: number };
};
const serverPort = configYaml.server?.port ?? 4317;
const webPort = configYaml.server?.webPort ?? 5317;

export default defineConfig({
  plugins: [react()],
  server: {
    port: webPort,
    strictPort: true,
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${serverPort}`,
        ws: true,
      },
    },
  },
  test: {
    name: "web",
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
