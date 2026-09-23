// Unit tests for ActivityBuilder, from hand-built SDK-message fixtures (no
// API calls, no real SDK types needed beyond the shape activity.ts reads).
import { describe, expect, test } from "vitest";
import path from "node:path";
import { ActivityBuilder } from "./activity.js";
import type { GuardDecisionLog } from "./guards.js";

const engagementRoot = "C:/ws/engagements/acme-1";
const workDir = "C:/ws/engagements/acme-1/items/WI-002/work";

function newBuilder() {
  return new ActivityBuilder({ itemId: "WI-002", engagementRoot, workDir });
}

function assistantText(text: string) {
  return { type: "assistant", message: { content: [{ type: "text", text }] } };
}
function assistantToolUse(id: string, name: string, input: unknown) {
  return { type: "assistant", message: { content: [{ type: "tool_use", id, name, input }] } };
}
function userToolResult(id: string, text: string, isError = false) {
  return { type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, content: text, is_error: isError }] } };
}

describe("ActivityBuilder", () => {
  test("assistant text becomes a 'text' activity", () => {
    const b = newBuilder();
    const items = b.fromSdkMessage(assistantText("Reading the context now."), new Map());
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ idx: 0, kind: "text", summary: "Reading the context now." });
  });

  test("idx is monotonic across several messages", () => {
    const b = newBuilder();
    b.fromSdkMessage(assistantText("one"), new Map());
    const [second] = b.fromSdkMessage(assistantText("two"), new Map());
    expect(second!.idx).toBe(1);
  });

  test("Read of an input version file is summarized as '<ID>/<slot> vX.Y'", () => {
    const b = newBuilder();
    const absPath = path.win32.join(engagementRoot.replace(/\//g, "\\"), "items", "ENG", "assets", "context", "v1.0.md");
    b.fromSdkMessage(assistantToolUse("t1", "Read", { file_path: absPath }), new Map());
    const [item] = b.fromSdkMessage(userToolResult("t1", "file contents"), new Map());
    expect(item!.summary).toBe("Read ENG/context v1.0");
  });

  test("Write inside the item's own work/ is summarized as 'work/<rel>'", () => {
    const b = newBuilder();
    const absPath = path.win32.join(workDir.replace(/\//g, "\\"), "draft-guide.md");
    b.fromSdkMessage(assistantToolUse("t2", "Write", { file_path: absPath }), new Map());
    const [item] = b.fromSdkMessage(userToolResult("t2", "ok"), new Map());
    expect(item!.summary).toBe("Wrote work/draft-guide.md");
  });

  test("publish_asset success becomes a 'publish' activity with slot, version and kind", () => {
    const b = newBuilder();
    b.fromSdkMessage(
      assistantToolUse("t3", "mcp__work__publish_asset", { slot: "interview-guide", sourcePath: "guide.md", kind: "material", note: "first draft" }),
      new Map(),
    );
    const [item] = b.fromSdkMessage(
      userToolResult("t3", "Published interview-guide v1.0 at C:/ws/.../v1.0.md"),
      new Map(),
    );
    expect(item).toMatchObject({ kind: "publish", summary: "Published interview-guide v1.0 (material)" });
  });

  test("a blocking raise_question becomes a 'question' activity", () => {
    const b = newBuilder();
    b.fromSdkMessage(
      assistantToolUse("t4", "mcp__work__raise_question", {
        question: "Should the CIO section focus on vision or history?",
        hypothesis: "Lean into vision, given she is new.",
        alternatives: [],
        blocking: true,
      }),
      new Map(),
    );
    const [item] = b.fromSdkMessage(userToolResult("t4", "Recorded RQ-0001. End your turn now."), new Map());
    expect(item!.kind).toBe("question");
    expect(item!.summary).toContain("a blocking question");
    expect(item!.summary).toContain("CIO section");
  });

  test("submit_outputs success becomes a 'submit' activity", () => {
    const b = newBuilder();
    b.fromSdkMessage(assistantToolUse("t5", "mcp__work__submit_outputs", { summary: "done", selfCheck: [], openIssues: [] }), new Map());
    const [item] = b.fromSdkMessage(userToolResult("t5", "Submitted for human review. End your turn now."), new Map());
    expect(item).toMatchObject({ kind: "submit", summary: "Submitted outputs" });
  });

  test("report_progress becomes a 'progress' activity", () => {
    const b = newBuilder();
    b.fromSdkMessage(assistantToolUse("t6", "mcp__work__report_progress", { status: "Drafting the CFO section" }), new Map());
    const [item] = b.fromSdkMessage(userToolResult("t6", "Progress recorded."), new Map());
    expect(item).toMatchObject({ kind: "progress", summary: "Progress: Drafting the CFO section" });
  });

  test("a guard denial (from the decisions log) becomes a 'denial' activity, not a generic 'tool' one", () => {
    const b = newBuilder();
    const decisions: GuardDecisionLog = new Map([
      ["t7", { decision: "deny", reason: "Read of another item's work/ is not allowed (WI-003/work/)." }],
    ]);
    b.fromSdkMessage(assistantToolUse("t7", "Read", { file_path: "C:/ws/engagements/acme-1/items/WI-003/work/secret.md" }), decisions);
    const [item] = b.fromSdkMessage(userToolResult("t7", "Denied.", true), decisions);
    expect(item!.kind).toBe("denial");
    expect(item!.detail).toContain("WI-003/work/");
  });

  test("a subagent tool call carries the agentId from the guard decision log", () => {
    const b = newBuilder();
    const decisions: GuardDecisionLog = new Map([["t8", { decision: "allow", agentId: "agent-42" }]]);
    b.fromSdkMessage(assistantToolUse("t8", "Read", { file_path: path.win32.join(workDir.replace(/\//g, "\\"), "x.md") }), decisions);
    const [item] = b.fromSdkMessage(userToolResult("t8", "contents"), decisions);
    expect(item!.agentId).toBe("agent-42");
  });

  test("system/result SDK messages produce no activity of their own (runtime.ts emits those once per run)", () => {
    const b = newBuilder();
    expect(b.fromSdkMessage({ type: "system", subtype: "init", session_id: "s1" }, new Map())).toHaveLength(0);
    expect(b.fromSdkMessage({ type: "result", subtype: "success" }, new Map())).toHaveLength(0);
  });

  test("system(), nudge() and result() emit their own kinds with increasing idx", () => {
    const b = newBuilder();
    const s = b.system("Started (start, claude-haiku-4-5)");
    const n = b.nudge();
    const r = b.result("submitted", 4, 0.0123);
    expect(s).toMatchObject({ idx: 0, kind: "system" });
    expect(n).toMatchObject({ idx: 1, kind: "nudge" });
    expect(r).toMatchObject({ idx: 2, kind: "result", costUsd: 0.0123 });
    expect(r.summary).toContain("submitted");
  });
});
