// Pure unit tests for guards.ts's decideForWorkAgent — no API calls, no SDK.
// Run with: node --import tsx --test experiments/s03-guards/guards.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { decideForWorkAgent, type GuardItem } from "./guards.js";

const engRoot = path.join(os.tmpdir(), "guard-test-eng");
const item: GuardItem = {
  id: "WI-001",
  workDir: path.join(engRoot, "items", "WI-001", "work"),
  engRoot,
};

function deny(t: any) {
  assert.equal(t.decision, "deny", `expected deny, got ${JSON.stringify(t)}`);
}
function allow(t: any) {
  assert.equal(t.decision, "allow", `expected allow, got ${JSON.stringify(t)}`);
}

// --- Write / Edit / NotebookEdit -------------------------------------------

test("Write inside own work/ is allowed", () => {
  allow(decideForWorkAgent(item, "Write", { file_path: path.join(item.workDir, "notes.md") }));
});

test("Write to own assets/ (sibling of work/) is denied", () => {
  deny(
    decideForWorkAgent(item, "Write", {
      file_path: path.join(engRoot, "items", "WI-001", "assets", "x.md"),
    }),
  );
});

test("Write to another item's work/ is denied", () => {
  deny(
    decideForWorkAgent(item, "Write", {
      file_path: path.join(engRoot, "items", "WI-002", "work", "hack.md"),
    }),
  );
});

test("Edit outside own work/ is denied", () => {
  deny(
    decideForWorkAgent(item, "Edit", {
      file_path: path.join(engRoot, "items", "WI-002", "work", "secret.md"),
    }),
  );
});

test("NotebookEdit outside own work/ is denied", () => {
  deny(
    decideForWorkAgent(item, "NotebookEdit", {
      notebook_path: path.join(engRoot, "items", "WI-002", "work", "nb.ipynb"),
    }),
  );
});

test("Write with a '..' escape from own work/ is denied", () => {
  deny(
    decideForWorkAgent(item, "Write", {
      file_path: path.join(item.workDir, "..", "..", "WI-002", "work", "escape.md"),
    }),
  );
});

test("Write with a '..' that resolves back inside own work/ is allowed", () => {
  allow(
    decideForWorkAgent(item, "Write", {
      file_path: path.join(item.workDir, "sub", "..", "back.md"),
    }),
  );
});

test("Write with backslashes to own work/ is allowed", () => {
  allow(decideForWorkAgent(item, "Write", { file_path: `${item.workDir}\\notes2.md` }));
});

test("Write with mixed-case drive/dir to own work/ is allowed (case-insensitive)", () => {
  const upper = item.workDir.toUpperCase();
  allow(decideForWorkAgent(item, "Write", { file_path: `${upper}\\NOTES3.MD` }));
});

// --- Read --------------------------------------------------------------

test("Read inside own work/ is allowed", () => {
  allow(decideForWorkAgent(item, "Read", { file_path: path.join(item.workDir, "notes.md") }));
});

test("Read of own item's assets/ is allowed (only work/ of OTHER items is denied)", () => {
  allow(
    decideForWorkAgent(item, "Read", {
      file_path: path.join(engRoot, "items", "WI-001", "assets", "brief.md"),
    }),
  );
});

test("Read of another item's assets/ is allowed (project-scope, per ARCHITECTURE §8.5)", () => {
  allow(
    decideForWorkAgent(item, "Read", {
      file_path: path.join(engRoot, "items", "WI-002", "assets", "notes", "v1.0.md"),
    }),
  );
});

test("Read of another item's work/ is denied", () => {
  deny(
    decideForWorkAgent(item, "Read", {
      file_path: path.join(engRoot, "items", "WI-002", "work", "secret.md"),
    }),
  );
});

test("Read of .workbench/ is denied", () => {
  deny(decideForWorkAgent(item, "Read", { file_path: path.join(engRoot, ".workbench", "state.txt") }));
});

test("Read of .git/ is denied", () => {
  deny(decideForWorkAgent(item, "Read", { file_path: path.join(engRoot, ".git", "HEAD") }));
});

test("Read outside the engagement root entirely is denied", () => {
  deny(decideForWorkAgent(item, "Read", { file_path: path.join(os.tmpdir(), "outside", "secret.txt") }));
});

test("Read of another item's work/ via backslashes is denied", () => {
  deny(
    decideForWorkAgent(item, "Read", {
      file_path: `${engRoot}\\items\\WI-002\\work\\secret.md`,
    }),
  );
});

test("Read of another item's work/ via mixed case is denied", () => {
  deny(
    decideForWorkAgent(item, "Read", {
      file_path: `${engRoot.toUpperCase()}\\ITEMS\\wi-002\\WORK\\secret.md`,
    }),
  );
});

test("Read via a '..' escape from own work/ into another item's work/ is denied", () => {
  deny(
    decideForWorkAgent(item, "Read", {
      file_path: path.join(item.workDir, "..", "..", "WI-002", "work", "secret.md"),
    }),
  );
});

// --- Glob / Grep ---------------------------------------------------------

test("Glob with default path (cwd == own work) is allowed", () => {
  allow(decideForWorkAgent(item, "Glob", { pattern: "**/*.md" }));
});

test("Glob with explicit path inside own work/ is allowed", () => {
  allow(decideForWorkAgent(item, "Glob", { pattern: "*.md", path: item.workDir }));
});

test("Glob with path outside own work/ is denied", () => {
  deny(
    decideForWorkAgent(item, "Glob", {
      pattern: "*.md",
      path: path.join(engRoot, "items", "WI-002", "work"),
    }),
  );
});

test("Glob with a '..' in path is denied", () => {
  deny(decideForWorkAgent(item, "Glob", { pattern: "*.md", path: path.join(item.workDir, "..", "..") }));
});

test("Glob with a '..' in pattern (no path given) is denied", () => {
  deny(decideForWorkAgent(item, "Glob", { pattern: "../../**" }));
});

test("Glob with an absolute pattern outside own work/ (no path given) is denied", () => {
  deny(
    decideForWorkAgent(item, "Glob", {
      pattern: `${path.join(engRoot, "items", "WI-002", "work")}/**`,
    }),
  );
});

test("Glob with an absolute pattern INSIDE own work/ is allowed", () => {
  allow(decideForWorkAgent(item, "Glob", { pattern: `${item.workDir}/**/*.md` }));
});

test("Grep with default path (cwd == own work) is allowed", () => {
  allow(decideForWorkAgent(item, "Grep", { pattern: "CANARY" }));
});

test("Grep with path outside own work/ is denied", () => {
  deny(
    decideForWorkAgent(item, "Grep", {
      pattern: "CANARY",
      path: path.join(engRoot, "items", "WI-002", "work"),
    }),
  );
});

test("Grep with a '..' in the glob filter is denied", () => {
  deny(decideForWorkAgent(item, "Grep", { pattern: "CANARY", glob: "../../WI-002/**/*.md" }));
});

test("Grep pattern containing '..' text is NOT denied (pattern is a content regex, not a path)", () => {
  // Documented limitation: '..' inside the CONTENT regex just searches file
  // text for those characters; it does not let the tool search a different
  // directory, so we deliberately do not treat it as a traversal attempt.
  allow(decideForWorkAgent(item, "Grep", { pattern: "\\.\\./\\.\\./" }));
});

// --- Bash / PowerShell heuristic ------------------------------------------

test("Bash with no path-like tokens at all is allowed (e.g. plain echo)", () => {
  allow(decideForWorkAgent(item, "Bash", { command: "echo hi" }));
});

test("Bash with an absolute path INSIDE own work/ is allowed", () => {
  allow(decideForWorkAgent(item, "Bash", { command: `cat "${item.workDir}\\notes.md"` }));
});

test("Bash 'cat' of an absolute path OUTSIDE own work/ is denied (the literal-token heuristic catches this)", () => {
  deny(
    decideForWorkAgent(item, "Bash", {
      command: `cat "${path.join(engRoot, "items", "WI-002", "work", "secret.md")}"`,
    }),
  );
});

test("Bash with a '../' relative escape is denied", () => {
  deny(decideForWorkAgent(item, "Bash", { command: "cat ../../WI-002/work/secret.md" }));
});

test("Bash with a git-bash posix-style absolute path outside own work/ is denied", () => {
  const posixOutside = `/${engRoot.charAt(0).toLowerCase()}/${engRoot.slice(3).split("\\").join("/")}/items/WI-002/work/secret.md`;
  deny(decideForWorkAgent(item, "Bash", { command: `cat ${posixOutside}` }));
});

test("PowerShell Get-Content of a path outside own work/ is denied", () => {
  deny(
    decideForWorkAgent(item, "PowerShell", {
      command: `Get-Content "${path.join(engRoot, ".workbench", "state.txt")}"`,
    }),
  );
});

test("Bash heuristic documented bypass: a path built from a shell variable is NOT caught", () => {
  // Documented limitation, not a desired behavior: this is the honest
  // "miss" case for FINDINGS.md. No literal path token appears in the
  // command string, so the regex-based heuristic has nothing to match.
  allow(decideForWorkAgent(item, "Bash", { command: 'D=".."; cat "$D/$D/WI-002/work/secret.md"' }));
});

// --- Unknown / passthrough -----------------------------------------------

test("A tool with no path-like input at all is allowed (nothing for this guard to check)", () => {
  allow(decideForWorkAgent(item, "SomeOtherTool", {}));
});
