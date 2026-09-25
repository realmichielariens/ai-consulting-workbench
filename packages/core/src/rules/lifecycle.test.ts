import { describe, expect, it } from "vitest";
import { applyItemEvent, humanStatus, type ItemEventContext } from "./lifecycle.js";

const agent: ItemEventContext = { executor: "agent" };
const human: ItemEventContext = { executor: "human" };

describe("applyItemEvent: readiness", () => {
  it("waiting -> ready on inputs_ready", () => {
    expect(applyItemEvent("waiting", { type: "inputs_ready" }, agent)).toEqual({ ok: true, to: "ready" });
  });

  it("ready -> waiting on inputs_missing", () => {
    expect(applyItemEvent("ready", { type: "inputs_missing" }, agent)).toEqual({ ok: true, to: "waiting" });
  });

  it("rejects inputs_ready from a non-waiting status", () => {
    const r = applyItemEvent("ready", { type: "inputs_ready" }, agent);
    expect(r).toEqual({ ok: false, reason: expect.stringContaining("not waiting") });
  });
});

describe("applyItemEvent: start (agent items)", () => {
  it("ready -> in_progress", () => {
    expect(applyItemEvent("ready", { type: "start" }, agent)).toEqual({ ok: true, to: "in_progress" });
  });

  it("refuses a human item", () => {
    const r = applyItemEvent("ready", { type: "start" }, human);
    expect(r).toEqual({ ok: false, reason: expect.stringContaining("Only agent items") });
  });

  it("refuses when not ready", () => {
    const r = applyItemEvent("waiting", { type: "start" }, agent);
    expect(r.ok).toBe(false);
  });
});

describe("applyItemEvent: human uploads and mark_done", () => {
  it("ready -> in_progress on the first upload", () => {
    expect(applyItemEvent("ready", { type: "human_upload" }, human)).toEqual({ ok: true, to: "in_progress" });
  });

  it("stays in_progress on further uploads", () => {
    expect(applyItemEvent("in_progress", { type: "human_upload" }, human)).toEqual({ ok: true, to: "in_progress" });
  });

  it("refuses an upload on an agent item", () => {
    expect(applyItemEvent("ready", { type: "human_upload" }, agent).ok).toBe(false);
  });

  it("mark_done requires every required output published", () => {
    const r = applyItemEvent("in_progress", { type: "mark_done" }, { executor: "human", allRequiredOutputsPublished: false });
    expect(r).toEqual({ ok: false, reason: expect.stringContaining("Every required output slot") });
  });

  it("mark_done succeeds once outputs are published", () => {
    const r = applyItemEvent("in_progress", { type: "mark_done" }, { executor: "human", allRequiredOutputsPublished: true });
    expect(r).toEqual({ ok: true, to: "done" });
  });

  it("refuses mark_done on an agent item", () => {
    const r = applyItemEvent("in_progress", { type: "mark_done" }, { executor: "agent", allRequiredOutputsPublished: true });
    expect(r.ok).toBe(false);
  });
});

describe("applyItemEvent: run_ended", () => {
  it("submitted -> at_gate when the item has a gate chain", () => {
    const r = applyItemEvent("in_progress", { type: "run_ended", outcome: "submitted" }, { executor: "agent", hasGateChain: true });
    expect(r).toEqual({ ok: true, to: "at_gate" });
  });

  it("submitted -> done when there is no gate", () => {
    const r = applyItemEvent("in_progress", { type: "run_ended", outcome: "submitted" }, { executor: "agent", hasGateChain: false });
    expect(r).toEqual({ ok: true, to: "done" });
  });

  it("blocked -> blocked (opens a question)", () => {
    const r = applyItemEvent("in_progress", { type: "run_ended", outcome: "blocked" }, agent);
    expect(r).toEqual({ ok: true, to: "blocked" });
  });

  it.each(["no_submit", "max_turns", "error"] as const)("%s -> blocked (opens a run issue)", (outcome) => {
    const r = applyItemEvent("in_progress", { type: "run_ended", outcome }, agent);
    expect(r).toEqual({ ok: true, to: "blocked" });
  });

  it("interrupted -> ready (resumable, R1/R5)", () => {
    const r = applyItemEvent("in_progress", { type: "run_ended", outcome: "interrupted" }, agent);
    expect(r).toEqual({ ok: true, to: "ready" });
  });

  it("refuses a run_ended when the item is not in_progress", () => {
    const r = applyItemEvent("ready", { type: "run_ended", outcome: "submitted" }, agent);
    expect(r.ok).toBe(false);
  });
});

describe("applyItemEvent: questions and run issues", () => {
  it("question_answered: blocked -> in_progress", () => {
    expect(applyItemEvent("blocked", { type: "question_answered" }, agent)).toEqual({ ok: true, to: "in_progress" });
  });

  it("issue_retry: blocked -> in_progress", () => {
    expect(applyItemEvent("blocked", { type: "issue_retry" }, agent)).toEqual({ ok: true, to: "in_progress" });
  });

  it("issue_stop: blocked -> ready", () => {
    expect(applyItemEvent("blocked", { type: "issue_stop" }, agent)).toEqual({ ok: true, to: "ready" });
  });

  it("refuses these outside blocked", () => {
    expect(applyItemEvent("ready", { type: "question_answered" }, agent).ok).toBe(false);
    expect(applyItemEvent("ready", { type: "issue_retry" }, agent).ok).toBe(false);
    expect(applyItemEvent("ready", { type: "issue_stop" }, agent).ok).toBe(false);
  });
});

describe("applyItemEvent: gates", () => {
  it("gate_approved on the last step: at_gate -> done", () => {
    const r = applyItemEvent("at_gate", { type: "gate_approved" }, { executor: "agent", isLastGateStep: true });
    expect(r).toEqual({ ok: true, to: "done" });
  });

  it("gate_approved on a non-last step: stays at_gate (chains, I6)", () => {
    const r = applyItemEvent("at_gate", { type: "gate_approved" }, { executor: "agent", isLastGateStep: false });
    expect(r).toEqual({ ok: true, to: "at_gate" });
  });

  it("changes_requested: at_gate -> in_progress", () => {
    expect(applyItemEvent("at_gate", { type: "changes_requested" }, agent)).toEqual({ ok: true, to: "in_progress" });
  });

  it("refuses gate events outside at_gate", () => {
    expect(applyItemEvent("in_progress", { type: "gate_approved" }, { executor: "agent", isLastGateStep: true }).ok).toBe(false);
    expect(applyItemEvent("in_progress", { type: "changes_requested" }, agent).ok).toBe(false);
  });
});

describe("applyItemEvent: stop (R5)", () => {
  it("in_progress -> ready", () => {
    expect(applyItemEvent("in_progress", { type: "stop" }, agent)).toEqual({ ok: true, to: "ready" });
  });

  it("refuses stop outside in_progress", () => {
    expect(applyItemEvent("ready", { type: "stop" }, agent).ok).toBe(false);
  });
});

describe("applyItemEvent: I2 cancel", () => {
  it("waiting -> cancelled", () => {
    expect(applyItemEvent("waiting", { type: "cancel" }, agent)).toEqual({ ok: true, to: "cancelled" });
  });

  it("ready -> cancelled", () => {
    expect(applyItemEvent("ready", { type: "cancel" }, human)).toEqual({ ok: true, to: "cancelled" });
  });

  it("refuses cancel while in_progress", () => {
    expect(applyItemEvent("in_progress", { type: "cancel" }, agent).ok).toBe(false);
  });
});

describe("applyItemEvent: I2 answer_overridden", () => {
  it("ready -> in_progress", () => {
    expect(applyItemEvent("ready", { type: "answer_overridden" }, agent)).toEqual({ ok: true, to: "in_progress" });
  });

  it("at_gate -> in_progress", () => {
    expect(applyItemEvent("at_gate", { type: "answer_overridden" }, agent)).toEqual({ ok: true, to: "in_progress" });
  });

  it("refuses override outside ready/at_gate", () => {
    expect(applyItemEvent("in_progress", { type: "answer_overridden" }, agent).ok).toBe(false);
    expect(applyItemEvent("waiting", { type: "answer_overridden" }, agent).ok).toBe(false);
  });
});

describe("applyItemEvent: I2 run_ended(completed) is Approach-only", () => {
  it("is denied, even while in_progress", () => {
    const r = applyItemEvent("in_progress", { type: "run_ended", outcome: "completed" }, agent);
    expect(r).toEqual({ ok: false, reason: expect.stringContaining("Approach Agent") });
  });
});

describe("humanStatus", () => {
  it("replaces underscores with spaces", () => {
    expect(humanStatus("in_progress")).toBe("in progress");
    expect(humanStatus("at_gate")).toBe("at gate");
  });

  it("handles null", () => {
    expect(humanStatus(null)).toBe("not applicable");
  });
});
