// Unit tests for ActivityBuilder, from hand-built SDK-message fixtures (no
// API calls, no real SDK types needed beyond the shape activity.ts reads).
import { describe, expect, test } from "vitest";
import path from "node:path";
import { ActivityBuilder } from "./activity.js";
import type { GuardDecisionLog } from "./guards.js";

const engagementRoot = "C:/ws/engagements/acme-1";
const workDir = "C:/ws/engagements/acme-1/items/WI-002/work";

function newBuilder() {
  return new ActivityBuilder({
    itemId: "WI-002",
    engagementRoot,
    workDir,
    sources: { web: { id: "open-web", title: "Open Web" }, servers: { source_mfg_it_benchmarks: { id: "mfg-it-benchmarks", title: "Manufacturing IT Benchmarks" } } },
  });
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

describe("ActivityBuilder: web tools", () => {
  test("WebSearch lists the result links as sources", () => {
    const b = newBuilder();
    b.fromSdkMessage(assistantToolUse("w1", "WebSearch", { query: "phased ERP replacement" }), new Map());
    const result =
      'Web search results for query: "phased ERP replacement"\n\nLinks: [{"title":"Case A","url":"https://a.example/x"},{"title":"Case B","url":"https://b.example/y"}]\n\nSome summary.';
    const [item] = b.fromSdkMessage(userToolResult("w1", result), new Map());
    expect(item).toMatchObject({
      kind: "tool",
      sourceId: "open-web",
      summary: 'Searched the web: "phased ERP replacement" — 2 results',
      links: [
        { url: "https://a.example/x", title: "Case A" },
        { url: "https://b.example/y", title: "Case B" },
      ],
    });
  });

  test("WebSearch falls back to bare URLs when the Links JSON is absent", () => {
    const b = newBuilder();
    b.fromSdkMessage(assistantToolUse("w2", "WebSearch", { query: "q" }), new Map());
    const [item] = b.fromSdkMessage(userToolResult("w2", "See https://c.example/z and https://c.example/z again."), new Map());
    expect(item!.links).toEqual([{ url: "https://c.example/z" }]);
  });

  test("WebFetch names the page and links it", () => {
    const b = newBuilder();
    b.fromSdkMessage(assistantToolUse("w3", "WebFetch", { url: "https://www.example.org/insights/oem", prompt: "p" }), new Map());
    const [item] = b.fromSdkMessage(userToolResult("w3", "The page says…"), new Map());
    expect(item).toMatchObject({
      summary: "Read web page: example.org/insights/oem",
      detail: "The page says…",
      links: [{ url: "https://www.example.org/insights/oem" }],
    });
  });
});

describe("ActivityBuilder: attached source tools", () => {
  test("a source MCP call is named after the source and tagged with its id", () => {
    const b = newBuilder();
    b.fromSdkMessage(assistantToolUse("s1", "mcp__source_mfg_it_benchmarks__search", { query: "erp" }), new Map());
    const [item] = b.fromSdkMessage(userToolResult("s1", "1 record in Manufacturing IT Benchmarks:\n- MB-104: ERP replacement duration by approach (2026-03) https://example.com/x"), new Map());
    expect(item).toMatchObject({
      sourceId: "mfg-it-benchmarks",
      summary: 'Searched Manufacturing IT Benchmarks: "erp" — 1 record',
      links: [{ url: "https://example.com/x", title: "MB-104: ERP replacement duration by approach" }],
    });
  });
});
