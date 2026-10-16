// Pure unit tests for guards.ts's decideForWorkAgent, ported from
// spike/experiments/s03-guards/guards.test.ts and extended for I1: subagent
// toolset denial, the skills dir staying readable, and Bash denied outright.
import { describe, expect, test } from "vitest";
import path from "node:path";
import os from "node:os";
import { decideForWorkAgent, type GuardScope } from "./guards.js";

const engagementRoot = path.join(os.tmpdir(), "guard-test-eng");
const skillsPluginDir = path.join(os.tmpdir(), "guard-test-skills-plugin");
const scope: GuardScope = {
  itemId: "WI-001",
  workDir: path.join(engagementRoot, "items", "WI-001", "work"),
  engagementRoot,
  skillsPluginDir,
};

function deny(t: ReturnType<typeof decideForWorkAgent>) {
  expect(t.decision, `expected deny, got ${JSON.stringify(t)}`).toBe("deny");
}
function allow(t: ReturnType<typeof decideForWorkAgent>) {
  expect(t.decision, `expected allow, got ${JSON.stringify(t)}`).toBe("allow");
}
const d = (tool: string, input: unknown, subagent = false) => decideForWorkAgent(scope, tool, input, subagent);

describe("Write / Edit / NotebookEdit", () => {
  test("Write inside own work/ is allowed", () => {
    allow(d("Write", { file_path: path.join(scope.workDir, "notes.md") }));
  });
  test("Write to own assets/ (sibling of work/) is denied", () => {
    deny(d("Write", { file_path: path.join(engagementRoot, "items", "WI-001", "assets", "x.md") }));
  });
  test("Write to another item's work/ is denied", () => {
    deny(d("Write", { file_path: path.join(engagementRoot, "items", "WI-002", "work", "hack.md") }));
  });
  test("Edit outside own work/ is denied", () => {
    deny(d("Edit", { file_path: path.join(engagementRoot, "items", "WI-002", "work", "secret.md") }));
  });
  test("NotebookEdit outside own work/ is denied", () => {
    deny(d("NotebookEdit", { notebook_path: path.join(engagementRoot, "items", "WI-002", "work", "nb.ipynb") }));
  });
  test("Write with a '..' escape from own work/ is denied", () => {
    deny(d("Write", { file_path: path.join(scope.workDir, "..", "..", "WI-002", "work", "escape.md") }));
  });
  test("Write with a '..' that resolves back inside own work/ is allowed", () => {
    allow(d("Write", { file_path: path.join(scope.workDir, "sub", "..", "back.md") }));
  });
  test("Write with mixed-case drive/dir to own work/ is allowed (case-insensitive)", () => {
    allow(d("Write", { file_path: `${scope.workDir.toUpperCase()}\\NOTES3.MD` }));
  });
});

describe("Read", () => {
  test("Read inside own work/ is allowed", () => {
    allow(d("Read", { file_path: path.join(scope.workDir, "notes.md") }));
  });
  test("Read of own item's assets/ is allowed", () => {
    allow(d("Read", { file_path: path.join(engagementRoot, "items", "WI-001", "assets", "brief.md") }));
  });
  test("Read of another item's assets/ is allowed (project-scope, A§8.5)", () => {
    allow(d("Read", { file_path: path.join(engagementRoot, "items", "WI-002", "assets", "notes", "v1.0.md") }));
  });
  test("Read of another item's work/ is denied", () => {
    deny(d("Read", { file_path: path.join(engagementRoot, "items", "WI-002", "work", "secret.md") }));
  });
  test("Read of .workbench/ is denied", () => {
    deny(d("Read", { file_path: path.join(engagementRoot, ".workbench", "state.txt") }));
  });
  test("Read of .git/ is denied", () => {
    deny(d("Read", { file_path: path.join(engagementRoot, ".git", "HEAD") }));
  });
  test("Read outside the engagement root entirely is denied", () => {
    deny(d("Read", { file_path: path.join(os.tmpdir(), "outside", "secret.txt") }));
  });
  test("Read of another item's work/ via mixed case is denied", () => {
    deny(d("Read", { file_path: `${engagementRoot.toUpperCase()}\\ITEMS\\wi-002\\WORK\\secret.md` }));
  });
  test("Read via a '..' escape from own work/ into another item's work/ is denied", () => {
    deny(d("Read", { file_path: path.join(scope.workDir, "..", "..", "WI-002", "work", "secret.md") }));
  });
  test("Read of the skills plugin dir is allowed, even though it is outside the engagement root", () => {
    allow(d("Read", { file_path: path.join(skillsPluginDir, "skills", "workbench-protocol", "SKILL.md") }));
  });
});

describe("Glob / Grep", () => {
  test("Glob with default path (cwd == own work) is allowed", () => {
    allow(d("Glob", { pattern: "**/*.md" }));
  });
  test("Glob with path outside own work/ is denied", () => {
    deny(d("Glob", { pattern: "*.md", path: path.join(engagementRoot, "items", "WI-002", "work") }));
  });
  test("Glob with a '..' in pattern (no path given) is denied", () => {
    deny(d("Glob", { pattern: "../../**" }));
  });
  test("Grep with default path (cwd == own work) is allowed", () => {
    allow(d("Grep", { pattern: "CANARY" }));
  });
  test("Grep with path outside own work/ is denied", () => {
    deny(d("Grep", { pattern: "CANARY", path: path.join(engagementRoot, "items", "WI-002", "work") }));
  });
  test("Grep with a '..' in the glob filter is denied", () => {
    deny(d("Grep", { pattern: "CANARY", glob: "../../WI-002/**/*.md" }));
  });
  test("Grep pattern containing '..' text is NOT denied (content regex, not a path)", () => {
    allow(d("Grep", { pattern: "\\.\\./\\.\\./" }));
  });
});

describe("Bash / PowerShell (never enabled in I1, denied outright as defense in depth)", () => {
  test("Bash with no path-like tokens is denied outright", () => {
    deny(d("Bash", { command: "echo hi" }));
  });
  test("Bash with a path inside own work/ is still denied (I1 does not enable Bash at all)", () => {
    deny(d("Bash", { command: `cat "${scope.workDir}\\notes.md"` }));
  });
  test("PowerShell is denied outright", () => {
    deny(d("PowerShell", { command: `Get-Content "${path.join(engagementRoot, ".workbench", "state.txt")}"` }));
  });
});

describe("Subagent toolset denial (A§8.3)", () => {
  test("mcp__work__publish_asset from the main thread is allowed", () => {
    allow(d("mcp__work__publish_asset", { slot: "draft", sourcePath: "x.md", kind: "minor", note: "n" }, false));
  });
  test("mcp__work__publish_asset from a subagent is denied", () => {
    deny(d("mcp__work__publish_asset", { slot: "draft", sourcePath: "x.md", kind: "minor", note: "n" }, true));
  });
  test("mcp__work__raise_question from a subagent is denied", () => {
    deny(d("mcp__work__raise_question", { question: "q", hypothesis: "h", alternatives: [], blocking: false }, true));
  });
  test("a subagent's Read still follows the normal read-scope rules (only the toolset is denied)", () => {
    allow(d("Read", { file_path: path.join(scope.workDir, "notes.md") }, true));
    deny(d("Read", { file_path: path.join(engagementRoot, "items", "WI-002", "work", "secret.md") }, true));
  });
});

describe("Unknown / passthrough", () => {
  test("A tool with no path-like input at all is allowed", () => {
    allow(d("SomeOtherTool", {}));
  });
});

describe("Source tools (WebSearch / WebFetch / mcp__source_*)", () => {
  const withSources = {
    ...scope,
    sources: {
      web: { id: "open-web", title: "Open Web" },
      servers: { source_mfg_it_benchmarks: { id: "mfg-it-benchmarks", title: "Manufacturing IT Benchmarks" } },
    },
  };
  test("denied on a task with no sources attached", () => {
    deny(d("WebSearch", { query: "erp case study" }));
    deny(d("WebFetch", { url: "https://example.com", prompt: "p" }));
    deny(d("mcp__source_mfg_it_benchmarks__search", { query: "erp" }));
  });
  test("allowed for attached sources, from the main thread and from a subagent", () => {
    allow(decideForWorkAgent(withSources, "WebSearch", { query: "erp case study" }, false));
    allow(decideForWorkAgent(withSources, "WebFetch", { url: "https://example.com", prompt: "p" }, true));
    allow(decideForWorkAgent(withSources, "mcp__source_mfg_it_benchmarks__get", { id: "MB-104" }, true));
  });
  test("a source that is not attached stays denied even when others are", () => {
    deny(decideForWorkAgent(withSources, "mcp__source_analyst_briefs__search", { query: "erp" }, false));
  });
});
