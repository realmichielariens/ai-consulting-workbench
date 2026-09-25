// Pure unit tests for guards.ts's decideForApproachAgent, mirroring
// guards.test.ts's decideForWorkAgent coverage but for the Approach Agent's
// own scope: writes confined to items/ENG/work/, reads open to the whole
// engagement except other items' work/, .workbench/ and .git/.
import { describe, expect, test } from "vitest";
import path from "node:path";
import os from "node:os";
import { decideForApproachAgent, type ApproachGuardScope } from "./guards.js";

const engagementRoot = path.join(os.tmpdir(), "guard-approach-test-eng");
const scope: ApproachGuardScope = {
  workDir: path.join(engagementRoot, "items", "ENG", "work"),
  engagementRoot,
};

function deny(t: ReturnType<typeof decideForApproachAgent>) {
  expect(t.decision, `expected deny, got ${JSON.stringify(t)}`).toBe("deny");
}
function allow(t: ReturnType<typeof decideForApproachAgent>) {
  expect(t.decision, `expected allow, got ${JSON.stringify(t)}`).toBe("allow");
}
const d = (tool: string, input: unknown, subagent = false) => decideForApproachAgent(scope, tool, input, subagent);

describe("Write / Edit / NotebookEdit", () => {
  test("Write inside items/ENG/work/ is allowed", () => {
    allow(d("Write", { file_path: path.join(scope.workDir, "context.md") }));
  });
  test("Write to ENG/assets/ (sibling of work/) is denied", () => {
    deny(d("Write", { file_path: path.join(engagementRoot, "items", "ENG", "assets", "x.md") }));
  });
  test("Write to another item's work/ is denied", () => {
    deny(d("Write", { file_path: path.join(engagementRoot, "items", "WI-002", "work", "hack.md") }));
  });
  test("Write with a '..' escape from items/ENG/work/ is denied", () => {
    deny(d("Write", { file_path: path.join(scope.workDir, "..", "..", "WI-002", "work", "escape.md") }));
  });
  test("Write with a '..' that resolves back inside items/ENG/work/ is allowed", () => {
    allow(d("Write", { file_path: path.join(scope.workDir, "sub", "..", "back.md") }));
  });
});

describe("Read (open to the whole engagement, unlike the Work Agent)", () => {
  test("Read inside items/ENG/work/ is allowed", () => {
    allow(d("Read", { file_path: path.join(scope.workDir, "context.md") }));
  });
  test("Read of another item's assets/ is allowed (project-scope)", () => {
    allow(d("Read", { file_path: path.join(engagementRoot, "items", "WI-002", "assets", "interview-guide", "v1.0.md") }));
  });
  test("Read of another item's own work/ is denied", () => {
    deny(d("Read", { file_path: path.join(engagementRoot, "items", "WI-002", "work", "draft.md") }));
  });
  test("Read of ENG's own item.md/worklog is allowed", () => {
    allow(d("Read", { file_path: path.join(engagementRoot, "items", "ENG", "item.md") }));
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
});

describe("Glob / Grep (same broad read scope as Read, not confined to work/)", () => {
  test("Grep with an explicit path under another item's assets/ is allowed", () => {
    allow(d("Grep", { pattern: "CANARY", path: path.join(engagementRoot, "items", "WI-002", "assets") }));
  });
  test("Grep with an explicit path under another item's work/ is denied", () => {
    deny(d("Grep", { pattern: "CANARY", path: path.join(engagementRoot, "items", "WI-002", "work") }));
  });
  test("Glob with default path (cwd == ENG/work) is allowed", () => {
    allow(d("Glob", { pattern: "**/*.md" }));
  });
  test("Glob targeting .workbench/ is denied", () => {
    deny(d("Glob", { pattern: "**/*", path: path.join(engagementRoot, ".workbench") }));
  });
  test("Glob with a '..' in pattern (no path given) is denied", () => {
    deny(d("Glob", { pattern: "../../**" }));
  });
});

describe("Bash / PowerShell / Task (never enabled for the Approach Agent, denied outright)", () => {
  test("Bash is denied outright", () => {
    deny(d("Bash", { command: "echo hi" }));
  });
  test("PowerShell is denied outright", () => {
    deny(d("PowerShell", { command: "Get-Content x" }));
  });
  test("Task is denied outright (the Approach Agent never delegates)", () => {
    deny(d("Task", { description: "spawn a subagent" }));
  });
});

describe("Subagent plan-toolset denial", () => {
  test("mcp__plan__propose_ops from the main thread is allowed", () => {
    allow(d("mcp__plan__propose_ops", { ops: [], rationale: "n" }, false));
  });
  test("mcp__plan__propose_ops from a subagent is denied", () => {
    deny(d("mcp__plan__propose_ops", { ops: [], rationale: "n" }, true));
  });
});

describe("Unknown / passthrough", () => {
  test("A tool with no path-like input at all is allowed", () => {
    allow(d("SomeOtherTool", {}));
  });
});
