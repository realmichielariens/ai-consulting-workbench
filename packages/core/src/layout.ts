// Disk layout (ARCHITECTURE.md §5). Every package builds paths through these
// helpers; never by string concatenation. Returned paths are absolute and use
// the platform separator (node:path). For guard comparisons use the normalize()
// helpers in paths.ts (ported from the spike by SCAFFOLD).

import path from "node:path";
import { parseSlotRef, type EngagementId, type ItemId, type RunId, type SlotRef, type Version } from "./domain.js";

export interface WorkspacePaths {
  home: string;
  engagementsDir: string;
  engagement(id: EngagementId): string;
  libraryDir: string;
  /** Pinned CLAUDE_CONFIG_DIR for every SDK child. Resume depends on it staying stable (M0 S5). */
  claudeConfigDir: string;
  /** In-app feedback notes (ITERATIONS.md §1.3). */
  feedbackLog: string;
  /** Deleted engagement folders are moved here first, then removed (services.ts deleteEngagement). */
  trashDir: string;
}

export function workspacePaths(home: string): WorkspacePaths {
  const h = path.resolve(home);
  return {
    home: h,
    engagementsDir: path.join(h, "engagements"),
    engagement: (id) => path.join(h, "engagements", id),
    libraryDir: path.join(h, "library"),
    claudeConfigDir: path.join(h, ".workbench", "claude-config"),
    feedbackLog: path.join(h, "feedback.jsonl"),
    trashDir: path.join(h, ".workbench", "trash"),
  };
}

export interface EngagementPaths {
  root: string;
  engagementYaml: string;
  /** Projection (ARCHITECTURE.md §5.2). */
  planMd: string;
  itemsDir: string;
  itemDir(id: ItemId): string;
  itemMd(id: ItemId): string;
  worklog(id: ItemId): string;
  /** The item's locus of control: the only place its Work Agent writes. */
  itemWork(id: ItemId): string;
  itemAssets(id: ItemId): string;
  slotDir(ref: SlotRef): string;
  versionFile(ref: SlotRef, version: Version, format: string): string;
  /** Engagement-relative, forward slashes: what AssetVersion.path stores. */
  versionFileRel(ref: SlotRef, version: Version, format: string): string;
  workbenchDir: string;
  dbFile: string;
  runsDir: string;
  /** Raw SDK message stream (JSONL, git-ignored). */
  runStream(runId: RunId): string;
  /** Readable activity items (JSONL, git-ignored). */
  runActivity(runId: RunId): string;
  gitDir: string;
}

export function engagementPaths(root: string): EngagementPaths {
  const r = path.resolve(root);
  const itemDir = (id: ItemId) => path.join(r, "items", id);
  const versionFileRel = (ref: SlotRef, version: Version, format: string) => {
    const { itemId, slot } = parseSlotRef(ref);
    return `items/${itemId}/assets/${slot}/v${version}.${format}`;
  };
  return {
    root: r,
    engagementYaml: path.join(r, "engagement.yaml"),
    planMd: path.join(r, "plan.md"),
    itemsDir: path.join(r, "items"),
    itemDir,
    itemMd: (id) => path.join(itemDir(id), "item.md"),
    worklog: (id) => path.join(itemDir(id), "worklog.md"),
    itemWork: (id) => path.join(itemDir(id), "work"),
    itemAssets: (id) => path.join(itemDir(id), "assets"),
    slotDir: (ref) => {
      const { itemId, slot } = parseSlotRef(ref);
      return path.join(itemDir(itemId), "assets", slot);
    },
    versionFile: (ref, version, format) => path.join(r, ...versionFileRel(ref, version, format).split("/")),
    versionFileRel,
    workbenchDir: path.join(r, ".workbench"),
    dbFile: path.join(r, ".workbench", "state.db"),
    runsDir: path.join(r, ".workbench", "runs"),
    runStream: (runId) => path.join(r, ".workbench", "runs", `${runId}.jsonl`),
    runActivity: (runId) => path.join(r, ".workbench", "runs", `${runId}.activity.jsonl`),
    gitDir: path.join(r, ".git"),
  };
}

/** .gitignore written into every engagement repository (ARCHITECTURE.md §11). */
export const ENGAGEMENT_GITIGNORE = `.workbench/runs/
.workbench/state.db-wal
.workbench/state.db-shm
`;
