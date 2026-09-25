// Ported from the old components/Inbox.test.tsx (brief C §checks): question
// card modes (approve/amend/replace), the review card (D2: no verdict, only
// review-open), and the human-item card (upload UI moved to B's Item page).

import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { InboxEntry, Request } from "@workbench/core";
import { QuestionCard } from "./QuestionCard.js";
import { ReviewCard } from "./ReviewCard.js";
import { HumanItemCard } from "./HumanItemCard.js";
import type { useInboxMutations } from "./useInboxMutations.js";

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
    override: { ...base, ...(overrides.override as object) },
    dismiss: { ...base, ...(overrides.dismiss as object) },
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
  routedTo: "human",
  escalation: null,
  type: "question",
  payload: {
    question: "Vision or history for the CIO section?",
    hypothesis: "Lean on her forming vision.",
    alternatives: ["Lean on the ERP history instead."],
  },
};

describe("QuestionCard", () => {
  const entry: Extract<InboxEntry, { kind: "question" }> = {
    kind: "question",
    request: questionRequest,
    item: { id: "WI-002", title: "Prepare interview guide" },
    consequence: { score: 40, blocks: [], reason: "Blocks nothing yet" },
  };

  test("Approve sends the hypothesis unchanged, mode 'approve'", () => {
    const m = fakeM();
    render(<QuestionCard eid="acme-discovery" entry={entry} m={m} />);
    fireEvent.click(screen.getByTestId("question-approve"));
    expect(m.answer.mutate).toHaveBeenCalledWith({ rid: "RQ-0002", mode: "approve", text: "Lean on her forming vision." });
  });

  test("Amend opens a textarea pre-filled with the hypothesis", () => {
    const m = fakeM();
    render(<QuestionCard eid="acme-discovery" entry={entry} m={m} />);
    fireEvent.click(screen.getByTestId("question-amend-open"));
    const textarea = screen.getByTestId("question-answer-text") as HTMLTextAreaElement;
    expect(textarea.value).toBe("Lean on her forming vision.");
    fireEvent.change(textarea, { target: { value: "Lean on her forming vision, but ask one ERP-history question." } });
    fireEvent.click(screen.getByTestId("question-answer-submit"));
    expect(m.answer.mutate).toHaveBeenCalledWith({ rid: "RQ-0002", mode: "amend", text: "Lean on her forming vision, but ask one ERP-history question." });
  });

  test("Replace opens an empty textarea", () => {
    const m = fakeM();
    render(<QuestionCard eid="acme-discovery" entry={entry} m={m} />);
    fireEvent.click(screen.getByTestId("question-replace-open"));
    const textarea = screen.getByTestId("question-answer-text") as HTMLTextAreaElement;
    expect(textarea.value).toBe("");
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
  routedTo: "human",
  escalation: null,
  type: "gate_request",
  payload: {
    step: 0,
    gateType: "human-review",
    submitted: [{ slot: "WI-002/interview-guide", version: "1.0" }],
    report: { summary: "Drafted the guide.", selfCheck: [{ criterion: "Distinct questions per exec", met: "yes", note: "" }], openIssues: [] },
  },
};

describe("ReviewCard", () => {
  const entry: Extract<InboxEntry, { kind: "review" }> = { kind: "review", request: gateRequest, item: { id: "WI-002", title: "Prepare interview guide" }, consequence: { score: 35, blocks: [], reason: "Blocks nothing yet" } };

  test("shows the exact submitted version and its summary", () => {
    render(<ReviewCard eid="acme-discovery" entry={entry} />);
    expect(screen.getByText(/interview-guide v1.0/)).toBeTruthy();
    expect(screen.getByText("Drafted the guide.")).toBeTruthy();
  });

  test("D2: there is no verdict on the card, only review-open", () => {
    render(<ReviewCard eid="acme-discovery" entry={entry} />);
    expect(screen.getByTestId("review-open")).toBeTruthy();
    expect(screen.queryByTestId("review-approve")).toBeNull();
    expect(screen.queryByTestId("review-request-changes-open")).toBeNull();
  });
});

describe("HumanItemCard", () => {
  const entry: Extract<InboxEntry, { kind: "human_item" }> = {
    kind: "human_item",
    consequence: { score: 25, blocks: [], reason: "Blocks nothing yet" },
    item: { id: "WI-003", title: "Conduct CxO interviews" },
    status: "ready",
    inputs: [{ slot: "WI-002/interview-guide", required: true, available: { slot: "WI-002/interview-guide", version: "1.1", major: 1, minor: 1, kind: "minor", author: "agent:WI-002", at: "2026-09-23T00:00:00.000Z", note: "", runId: "R-0004", path: "x", format: "md" } }],
    outputs: [
      { slot: "notes-ceo", slotRef: "WI-003/notes-ceo", required: true, format: "md", latest: null },
      { slot: "notes-cfo", slotRef: "WI-003/notes-cfo", required: true, format: "md", latest: null },
    ],
    markDone: { allowed: false, reason: "Every required output slot needs a version before this item can be marked done." },
  };

  test("shows inputs available and outputs expected, and has data-item-id", () => {
    const { container } = render(<HumanItemCard eid="acme-discovery" entry={entry} />);
    expect(screen.getByText(/interview-guide v1.1/)).toBeTruthy();
    expect(container.querySelector('[data-testid="inbox-card-human-item"]')?.getAttribute("data-item-id")).toBe("WI-003");
  });

  test("human-item-open is the only action (upload moved to the Item page)", () => {
    render(<HumanItemCard eid="acme-discovery" entry={entry} />);
    expect(screen.getByTestId("human-item-open")).toBeTruthy();
    expect(screen.queryByTestId("upload-input-notes-ceo")).toBeNull();
    expect(screen.queryByTestId("mark-done")).toBeNull();
  });
});
