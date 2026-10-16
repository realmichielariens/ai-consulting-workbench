// Loads workbench.config.yaml (config.ts is the contract for its shape and
// defaults). Node-only: imported through the "@workbench/core/node" entry.

import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { WorkbenchConfig, type WorkbenchConfig as WorkbenchConfigType } from "../config.js";

/** Walks up from `from` (default: this module's location) to the directory containing pnpm-workspace.yaml. */
export function repoRoot(from: string = import.meta.dirname): string {
  let dir = path.resolve(from);
  for (;;) {
    if (fs.existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error(`repoRoot(): no pnpm-workspace.yaml found walking up from ${from}`);
    }
    dir = parent;
  }
}

export interface ResolvedWorkbenchConfig extends WorkbenchConfigType {
  /** Absolute paths, resolved relative to the repo root. */
  resolved: {
    home: string;
    skillsPlugin: string;
    sourcesCatalog: string;
    promptsDir: string;
  };
}

/**
 * Reads and validates workbench.config.yaml. `home`, `skillsPlugin` and
 * `promptsDir` are resolved to absolute paths relative to the repo root
 * (they are written relative in the file so it stays portable).
 */
export function loadConfig(root: string = repoRoot()): ResolvedWorkbenchConfig {
  const file = path.join(root, "workbench.config.yaml");
  const raw = fs.readFileSync(file, "utf8");
  const parsed: unknown = parseYaml(raw);
  const config = WorkbenchConfig.parse(parsed);
  return {
    ...config,
    resolved: {
      // WORKBENCH_HOME lets a hosted deploy put the workspace on a mounted volume (docs/DEPLOY-FLY.md).
      home: path.resolve(root, process.env.WORKBENCH_HOME || config.home),
      skillsPlugin: path.resolve(root, config.skillsPlugin),
      sourcesCatalog: path.resolve(root, config.sourcesCatalog),
      promptsDir: path.resolve(root, config.promptsDir),
    },
  };
}
