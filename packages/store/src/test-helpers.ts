// Shared test scaffolding: a fresh temp engagement folder per test, with
// paths on Windows deliberately containing a space and mixed case (the
// scenario I1-PLAN.md §6 W4 names as a validation target).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { engagementPaths, workspacePaths, type EngagementPaths, type WorkspacePaths } from "@workbench/core/node";

export function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
}

/** A temp dir with a space and mixed case in its name, e.g. "...\\Some Dir W4-abcd\\". */
export function makeTempDirWithSpace(prefix: string): string {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
  const withSpace = path.join(base, "Some Engagement Dir");
  fs.mkdirSync(withSpace, { recursive: true });
  return withSpace;
}

export function tempEngagement(prefix = "w4-store-test"): { root: string; paths: EngagementPaths } {
  const root = makeTempDirWithSpace(prefix);
  return { root, paths: engagementPaths(root) };
}

export function tempWorkspace(prefix = "w4-store-workspace"): { home: string; workspace: WorkspacePaths } {
  const home = makeTempDirWithSpace(prefix);
  return { home, workspace: workspacePaths(home) };
}

export function rmDir(p: string): void {
  fs.rmSync(p, { recursive: true, force: true });
}
