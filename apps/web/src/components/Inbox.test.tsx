// Question card modes (approve/amend/replace), the review card, and the
// human-item card's upload + mark-done disabled reason (J1.4-J1.6).

import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { InboxEntry, Request } from "@workbench/core";
import { QuestionCard, ReviewCard, HumanItemCard, type useInboxMutations } from "./Inbox.js";

afterEach(cleanup);

type M = ReturnType<typeof useInboxMutations>;

function fakeM(overrides: Partial<Record<keyof M, unknown>> = {}): M {
  const base = { mutate: vi.fn(), isPending: false, isError: false, error: null, variables: undefined };
  return {
    answer: { ...base, ...(overrides.answer as object) },
    verdict: { ...base, ...(overrides.verdict as object) },
    issue: { ...base, ...(overrides.issue as object) },
    markDone: { ...base, ...(overrides.markDone as object) },
    upload: { ...base, ...(overrides.upload as object) },
  } as unknown as M;
}

const questionRequest: Extract<Request, { type: "question" }> = {
  id: "RQ-0002",
  from: "agent:WI-002",
  to: "human",
  itemId: "WI-002",
  runId: "R-0002",
  status: "open",
  blocking: true,
  response: null,
  createdAt: "2026-09-23T00:00:00.000Z",
  resolvedAt: null,
  type: "question",
  payload: {
    question: "Vision or history for the CIO section?",
    hypothesis: "Lean on her forming vision.",
    alternatives: ["Lean on the ERP history instead."],
  },
};

describe("QuestionCard", () => {
  const entry: Extract<InboxEntry, { kind: "question" }> = { kind: "question", request: questionRequest, item: { id: "WI-002", title: "Prepare interview guide" } };

  test("Approve sends the hypothesis unchanged, mode 'approve'", () => {
    const m = fakeM();
    render(<QuestionCard entry={entry} m={m} />);
    fireEvent.click(screen.getByTestId("question-approve"));
    expect(m.answer.mutate).toHaveBeenCalledWith({ rid: "RQ-0002", mode: "approve", text: "Lean on her forming vision." });
  });

  test("Amend opens a textarea pre-filled with the hypothesis", () => {
    const m = fakeM();
    render(<QuestionCard entry={entry} m={m} />);
    fireEvent.click(screen.getByTestId("question-amend-open"));
    const textarea = screen.getByTestId("question-answer-text") as HTMLTextAreaElement;
    expect(textarea.value).toBe("Lean on her forming vision.");
    fireEvent.change(textarea, { target: { value: "Lean on her forming vision, but ask one ERP-history question." } });
    fireEvent.click(screen.getByTestId("question-answer-submit"));
    expect(m.answer.mutate).toHaveBeenCalledWith({ rid: "RQ-0002", mode: "amend", text: "Lean on her forming vision, but ask one ERP-history question." });
  });

  test("Replace opens an empty textarea", () => {
    const m = fakeM();
    render(<QuestionCard entry={entry} m={m} />);
    fireEvent.click(screen.getByTestId("question-replace-open"));
    const textarea = screen.getByTestId("question-answer-text") as HTMLTextAreaElement;
    expect(textarea.value).toBe("");
    // Empty replacement text keeps the submit button disabled.
    expect((screen.getByTestId("question-answer-submit") as HTMLButtonElement).disabled).toBe(true);
  });
});

const gateRequest: Extract<Request, { type: "gate_request" }> = {
  id: "RQ-0003",
  from: "agent:WI-002",
  to: "human",
  itemId: "WI-002",
  runId: "R-0003",
  status: "open",
  blocking: false,
  response: null,
  createdAt: "2026-09-23T00:00:00.000Z",
  resolvedAt: null,
  type: "gate_request",
  payload: {
    step: 0,
    gateType: "human-review",
    submitted: [{ slot: "WI-002/interview-guide", version: "1.0" }],
    report: { summary: "Drafted the guide.", selfCheck: [{ criterion: "Distinct questions per exec", met: "yes", note: "" }], openIssues: [] },
  },
};

describe("ReviewCard", () => {
  const entry: Extract<InboxEntry, { kind: "review" }> = { kind: "review", request: gateRequest, item: { id: "WI-002", title: "Prepare interview guide" } };

  test("shows the exact submitted version and the completion report", () => {
    render(<ReviewCard entry={entry} m={fakeM()} />);
    expect(screen.getByText(/interview-guide v1.0/)).toBeTruthy();
    expect(screen.getByText("Drafted the guide.")).toBeTruthy();
  });

  test("Approve requires no comment", () => {
    const m = fakeM();
    render(<ReviewCard entry={entry} m={m} />);
    fireEvent.click(screen.getByTestId("review-approve"));
    expect(m.verdict.mutate).toHaveBeenCalledWith({ rid: "RQ-0003", verdict: "approved", comments: "" });
  });

  test("Request changes requires a comment before it can be sent", () => {
    const m = fakeM();
    render(<ReviewCard entry={entry} m={m} />);
    fireEvent.click(screen.getByTestId("review-request-changes-open"));
    expect((screen.getByTestId("review-request-changes-submit") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByTestId("review-comments"), { target: { value: "Tighten the CFO section." } });
    expect((screen.getByTestId("review-request-changes-submit") as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByTestId("review-request-changes-submit"));
    expect(m.verdict.mutate).toHaveBeenCalledWith({ rid: "RQ-0003", verdict: "changes_requested", comments: "Tighten the CFO section." });
  });
});

describe("HumanItemCard", () => {
  const entry: Extract<InboxEntry, { kind: "human_item" }> = {
    kind: "human_item",
    item: { id: "WI-003", title: "Conduct CxO interviews" },
    status: "ready",
    inputs: [{ slot: "WI-002/interview-guide", required: true, available: { slot: "WI-002/interview-guide", version: "1.1", major: 1, minor: 1, kind: "minor", author: "agent:WI-002", at: "2026-09-23T00:00:00.000Z", note: "", runId: "R-0004", path: "x", format: "md" } }],
    outputs: [
      { slot: "notes-ceo", slotRef: "WI-003/notes-ceo", required: true, format: "md", latest: null },
      { slot: "notes-cfo", slotRef: "WI-003/notes-cfo", required: true, format: "md", latest: null },
    ],
    markDone: { allowed: false, reason: "Every required output slot needs a version before this item can be marked done." },
  };

  test("shows the Mark done disabled reason as visible text, not only a tooltip", () => {
    render(<HumanItemCard entry={entry} m={fakeM()} />);
    const button = screen.getByTestId("mark-done");
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(entry.markDone.reason!)).toBeTruthy();
  });

  test("uploading a file into a slot calls uploadOutput with that slot", () => {
    const m = fakeM();
    render(<HumanItemCard entry={entry} m={m} />);
    const file = new File(["# CEO notes"], "notes-ceo.md", { type: "text/markdown" });
    fireEvent.change(screen.getByTestId("upload-input-notes-ceo"), { target: { files: [file] } });
    expect(m.upload.mutate).toHaveBeenCalledWith({ itemId: "WI-003", slot: "notes-ceo", file });
  });

  test("Mark done is enabled once the card's markDone.allowed is true", () => {
    const enabledEntry: typeof entry = { ...entry, markDone: { allowed: true, reason: null } };
    render(<HumanItemCard entry={enabledEntry} m={fakeM()} />);
    expect((screen.getByTestId("mark-done") as HTMLButtonElement).disabled).toBe(false);
  });
});
