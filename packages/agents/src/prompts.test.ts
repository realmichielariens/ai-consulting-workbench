// Renders all six templates with representative inputs and checks that no
// {{...}} token is left in the output (prompts/README "Rendering contract").
import { describe, expect, test } from "vitest";
import path from "node:path";
import type { BriefView } from "@workbench/core";
import { promptHash, renderRunPrompt, renderSystemPrompt, resolvePlacement } from "./prompts.js";

const promptsDir = path.resolve(import.meta.dirname, "../prompts");
const item = { id: "WI-002", title: "Prepare interview guide" };
const engagementRoot = "C:/ws/engagements/acme-1";

const brief: BriefView = {
  itemId: "WI-002",
  title: "Prepare interview guide",
  brief: "Prepare the interview guide.",
  acceptance: ["A distinct set of questions per stakeholder"],
  inputs: [
    { slot: "ENG/context", required: true, description: "Context", version: "1.0", path: "C:/ws/.../context/v1.0.md" },
    { slot: "ENG/stakeholders", required: true, description: "Stakeholders", version: null, path: null },
  ],
  outputs: [{ slot: "interview-guide", format: "md", scope: "project", description: "The guide", required: true, latestVersion: null }],
  gate: [{ type: "human-review" }],
  workDir: "C:/ws/engagements/acme-1/items/WI-002/work",
  engagementContextPath: "C:/ws/.../context/v1.0.md",
};

function assertNoLeftoverTokens(text: string) {
  expect(text).not.toMatch(/\{\{[^}]*\}\}/);
}

describe("renderSystemPrompt", () => {
  test("placement A appends protocol.md inline", () => {
    const text = renderSystemPrompt(promptsDir, item, brief, engagementRoot, "A");
    assertNoLeftoverTokens(text);
    expect(text).toContain("WI-002");
    expect(text).toContain("The workbench protocol"); // from protocol.md
  });

  test("placement B omits protocol.md (caller adds the skill instead)", () => {
    const text = renderSystemPrompt(promptsDir, item, brief, engagementRoot, "B");
    assertNoLeftoverTokens(text);
    expect(text).not.toContain("The workbench protocol");
  });
});

describe("renderRunPrompt", () => {
  test("start", () => {
    const text = renderRunPrompt(promptsDir, item, brief, engagementRoot, { reason: "start" });
    assertNoLeftoverTokens(text);
    expect(text).toContain("interview-guide");
  });

  test("resume-answer", () => {
    const text = renderRunPrompt(promptsDir, item, null, engagementRoot, {
      reason: "resume-answer",
      requestId: "RQ-0001",
      question: "Is the CIO new in role material here?",
      mode: "approve",
      answer: "Yes, lean into the fresh-eyes framing.",
    });
    assertNoLeftoverTokens(text);
    expect(text).toContain("approve");
  });

  test("changes-requested", () => {
    const text = renderRunPrompt(promptsDir, item, null, engagementRoot, {
      reason: "changes-requested",
      requestId: "RQ-0002",
      comments: "Sharpen the CFO section.",
      versions: [{ slot: "WI-002/interview-guide", version: "1.0" }],
    });
    assertNoLeftoverTokens(text);
    expect(text).toContain("interview-guide v1.0");
  });

  test("resume", () => {
    const text = renderRunPrompt(promptsDir, item, null, engagementRoot, { reason: "resume", note: "Server restarted." });
    assertNoLeftoverTokens(text);
    expect(text).toContain("Server restarted.");
  });

  test("resume with no note falls back to (none)", () => {
    const text = renderRunPrompt(promptsDir, item, null, engagementRoot, { reason: "resume", note: null });
    assertNoLeftoverTokens(text);
    expect(text).toContain("(none)");
  });

  test("stale-rerun is out of scope for I1 and throws", () => {
    expect(() =>
      renderRunPrompt(promptsDir, item, null, engagementRoot, { reason: "stale-rerun", diffSummary: "x" }),
    ).toThrow(/out of scope/);
  });

  test("brief text is inserted verbatim into run-start.md and not re-scanned for {{...}} tokens (prompts/README)", () => {
    const briefWithBraces: BriefView = { ...brief, brief: "See {{notAVariable}} for details." };
    const text = renderRunPrompt(promptsDir, item, briefWithBraces, engagementRoot, { reason: "start" });
    expect(text).toContain("{{notAVariable}}");
  });
});

test("promptHash is stable and distinguishes system/run prompt pairs", () => {
  const a = promptHash("sys", "run");
  const b = promptHash("sys", "run");
  const c = promptHash("sys", "different run");
  expect(a).toBe(b);
  expect(a).not.toBe(c);
  expect(a).toMatch(/^[0-9a-f]{64}$/);
});

test("resolvePlacement defaults to A and reads WORKBENCH_PROMPT_PLACEMENT", () => {
  expect(resolvePlacement({})).toBe("A");
  expect(resolvePlacement({ WORKBENCH_PROMPT_PLACEMENT: "B" })).toBe("B");
  expect(resolvePlacement({ WORKBENCH_PROMPT_PLACEMENT: "nonsense" })).toBe("A");
});
