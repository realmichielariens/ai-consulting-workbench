// UX1 brief B §Checks: "the review-bar visibility (entry covers slot →
// shown; no entry → hidden)".

import { describe, expect, test } from "vitest";
import type { InboxEntry, InboxView, Request } from "@workbench/core";
import { findReviewEntry } from "./reviewEntry.js";

function reviewRequest(submitted: { slot: string; version: string }[]): Request {
  return {
    id: "REQ-1",
    from: "agent:sess-1",
    itemId: "WI-004",
    runId: null,
    type: "gate_request",
    status: "open",
    createdAt: "2026-09-25T09:47:00.000Z",
    resolvedAt: null,
    blocking: true,
    to: "human",
    routedTo: "human",
    escalation: null,
    response: null,
    payload: {
      step: 0,
      gateType: "human-review",
      submitted,
      report: { summary: "Five themes.", selfCheck: [{ criterion: "Covers all execs", met: "yes", note: "" }], openIssues: [] },
    },
  } as unknown as Request;
}

function reviewEntry(submitted: { slot: string; version: string }[]): InboxEntry {
  return { kind: "review", request: reviewRequest(submitted), item: { id: "WI-004", title: "Consolidate themes" }, consequence: { score: 35, blocks: [], reason: "Blocks nothing yet" } };
}

describe("findReviewEntry", () => {
  test("a review entry whose submitted outputs cover this slot is found", () => {
    const inbox: InboxView = { entries: [reviewEntry([{ slot: "WI-004/themes", version: "2.0" }])] };
    expect(findReviewEntry(inbox, "WI-004/themes")).not.toBeNull();
  });

  test("no entry covering this slot returns null", () => {
    const inbox: InboxView = { entries: [reviewEntry([{ slot: "WI-004/roadmap", version: "1.0" }])] };
    expect(findReviewEntry(inbox, "WI-004/themes")).toBeNull();
  });

  test("an empty inbox returns null", () => {
    expect(findReviewEntry({ entries: [] }, "WI-004/themes")).toBeNull();
  });

  test("other entry kinds are ignored", () => {
    const inbox: InboxView = {
      entries: [{ kind: "fyi", notification: { id: "N-1", from: "agent:sess-1", itemId: "WI-004", text: "hi", createdAt: "2026-09-25T09:00:00.000Z", dismissedAt: null, requestId: null }, request: null, item: null, override: { allowed: false, reason: null }, consequence: { score: 0, blocks: [], reason: "For your information" } } as unknown as InboxEntry],
    };
    expect(findReviewEntry(inbox, "WI-004/themes")).toBeNull();
  });
});
