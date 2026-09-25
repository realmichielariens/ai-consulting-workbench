// UX1-PLAN §4.6: unit tests for the Brief's three computed-title templates
// (plan §Build 2) plus the review's phase suffix.

import { describe, expect, test } from "vitest";
import type { InboxEntry, ItemNode, PlanView } from "@workbench/core";
import { briefHeadline } from "./briefHeadline.js";

function item(overrides: Partial<ItemNode> & { id: string }): ItemNode {
  return {
    title: overrides.id,
    kind: "task",
    parent: null,
    order: 0,
    executor: "agent",
    status: "waiting",
    rollup: null,
    gate: [],
    inputs: [],
    outputs: [],
    notReadyBecause: [],
    activeRunId: null,
    resumable: false,
    ...overrides,
  };
}

function plan(items: ItemNode[]): Pick<PlanView, "items"> {
  return { items };
}

const consequence = { score: 0, blocks: [], reason: "Blocks nothing yet" };

function questionEntry(itemId: string): InboxEntry {
  return {
    kind: "question",
    item: { id: itemId, title: itemId },
    consequence,
    request: {
      id: "RQ-1",
      from: `agent:${itemId}`,
      to: "human",
      routedTo: "human",
      escalation: null,
      itemId,
      runId: null,
      status: "open",
      blocking: true,
      response: null,
      createdAt: "2026-09-25T00:00:00.000Z",
      resolvedAt: null,
      type: "question",
      payload: { question: "?", hypothesis: "h", alternatives: [] },
    },
  };
}

function reviewEntry(itemId: string): InboxEntry {
  return {
    kind: "review",
    item: { id: itemId, title: itemId },
    consequence,
    request: {
      id: "RQ-2",
      from: `agent:${itemId}`,
      to: "human",
      routedTo: "human",
      escalation: null,
      itemId,
      runId: null,
      status: "open",
      blocking: false,
      response: null,
      createdAt: "2026-09-25T00:00:00.000Z",
      resolvedAt: null,
      type: "gate_request",
      payload: { step: 0, gateType: "human-review", submitted: [{ slot: `${itemId}/out`, version: "1.0" }], report: { summary: "s", selfCheck: [], openIssues: [] } },
    },
  };
}

function fyiEntry(): InboxEntry {
  return { kind: "fyi", notification: { id: "N-0001", from: "system", text: "x", itemId: null, requestId: null, createdAt: "2026-09-25T00:00:00.000Z", dismissedAt: null }, request: null, item: null, override: { allowed: false, reason: null }, consequence };
}

describe("briefHeadline", () => {
  test("no decisions, nothing running -> 'All work is done.'", () => {
    const h = briefHeadline([], plan([item({ id: "WI-001", status: "done" })]));
    expect(h.title).toBe("All work is done.");
  });

  test("no decisions, N items running -> 'Nothing needs you. Agents are working on N items.'", () => {
    const h = briefHeadline([], plan([item({ id: "WI-001", activeRunId: "R-1" }), item({ id: "WI-002", activeRunId: "R-2" })]));
    expect(h.title).toBe("Nothing needs you.");
    expect(h.standfirst).toBe("Agents are working on 2 items.");
  });

  test("no decisions, plan approved but nothing started yet -> 'Nothing needs you.'", () => {
    const h = briefHeadline([], plan([item({ id: "WI-001", status: "waiting" })]));
    expect(h.title).toBe("Nothing needs you.");
    expect(h.standfirst).toBe("Nothing is running right now.");
  });

  test("only FYIs still counts as no decisions", () => {
    const h = briefHeadline([fyiEntry()], plan([]));
    expect(h.title).toBe("All work is done.");
  });

  test("N decisions, top is a question -> 'N decisions need you.' with no phase suffix", () => {
    const h = briefHeadline([questionEntry("WI-001")], plan([item({ id: "WI-001" })]));
    expect(h.title).toBe("1 decision needs you.");
  });

  test("N decisions, top is a review -> appends '<Phase> is waiting on your review.'", () => {
    const items = [item({ id: "PH-2", kind: "composite", title: "Synthesis" }), item({ id: "WI-004", parent: "PH-2" }), item({ id: "WI-001" })];
    const h = briefHeadline([reviewEntry("WI-004"), questionEntry("WI-001")], plan(items));
    expect(h.title).toBe("2 decisions need you. Synthesis is waiting on your review.");
  });
});
