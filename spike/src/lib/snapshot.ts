// Before/after directory hashing, used to prove that a run touched only
// what it was supposed to (the post-run Git audit idea from
// ARCHITECTURE.md §8.5, layer 5, done here with plain hashing since there
// is no Git repo in the fixture).

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const EMPTY_DIR_MARKER = "<empty-dir>";

function sha256(buf: Buffer): string {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function walk(dir: string, base: string, out: Map<string, string>): void {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  if (entries.length === 0) {
    const rel = path.relative(base, dir).split(path.sep).join("/") || ".";
    out.set(rel, EMPTY_DIR_MARKER);
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, base, out);
    } else if (entry.isFile()) {
      const rel = path.relative(base, full).split(path.sep).join("/");
      out.set(rel, sha256(fs.readFileSync(full)));
    }
    // symlinks and other special files are intentionally ignored
  }
}

/** Maps every relative path under `dir` to its sha256 (or a marker for empty dirs). */
export function hashTree(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  if (!fs.existsSync(dir)) return out;
  walk(dir, dir, out);
  return out;
}

export type TreeDiff = {
  added: string[];
  removed: string[];
  changed: string[];
};

/** Diffs two hashTree() snapshots of the same root, taken before and after. */
export function diffTrees(before: Map<string, string>, after: Map<string, string>): TreeDiff {
  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];

  for (const [relPath, hash] of after) {
    if (!before.has(relPath)) {
      added.push(relPath);
    } else if (before.get(relPath) !== hash) {
      changed.push(relPath);
    }
  }
  for (const relPath of before.keys()) {
    if (after.has(relPath)) continue;
    // An empty-dir marker that vanished because the directory now has real
    // entries under it isn't a removal — it just stopped being empty (and
    // its new contents already show up in `added`/`changed` above).
    if (before.get(relPath) === EMPTY_DIR_MARKER) {
      const prefix = relPath === "." ? "" : `${relPath}/`;
      const stillHasEntries = [...after.keys()].some((p) => p.startsWith(prefix));
      if (stillHasEntries) continue;
    }
    removed.push(relPath);
  }

  added.sort();
  removed.sort();
  changed.sort();
  return { added, removed, changed };
}

/**
 * Throws with a readable message if the tree at `dir` changed between the
 * two snapshots. Use around a protected subtree (another item's work/,
 * .workbench/, outside/) to assert an adversarial prompt had no effect.
 */
export function assertUnchanged(
  label: string,
  before: Map<string, string>,
  after: Map<string, string>,
): void {
  const diff = diffTrees(before, after);
  const total = diff.added.length + diff.removed.length + diff.changed.length;
  if (total > 0) {
    throw new Error(
      `assertUnchanged("${label}") failed: ` +
        `added=[${diff.added.join(", ")}] removed=[${diff.removed.join(", ")}] changed=[${diff.changed.join(", ")}]`,
    );
  }
}
