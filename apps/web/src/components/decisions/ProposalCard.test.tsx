// Ported from the old components/ProposalCard.test.tsx (brief C §checks):
// the diff list renders one line per readableOp, Approve/Reject follow
// actions.*.allowed, and proposal-preview-toggle now navigates to the Plan
// with this proposal previewed instead of toggling local state.

import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ProposalView } from "@workbench/core";

const { approveProposal, rejectProposal } = vi.hoisted(() => ({
  approveProposal: vi.fn().mockResolvedValue(undefined),
  rejectProposal: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../api/index.js", async () => {
  const actual = await vi.importActual<typeof import("../../api/index.js")>("../../api/index.js");
  return { ...actual, api: { approveProposal, rejectProposal } };
});

const { openPlan } = vi.hoisted(() => ({ openPlan: vi.fn() }));
vi.mock("../../shell/nav.js", async () => {
  const actual = await vi.importActual<typeof import("../../shell/nav.js")>("../../shell/nav.js");
  return { ...actual, openPlan };
});

import { ProposalCard } from "./ProposalCard.js";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function view(overrides: Partial<ProposalView["actions"]> = {}): ProposalView {
  return {
    proposal: {
      id: "P-0001",
      origin: "conversation",
      suggestedBy: null,
      requestId: null,
      threadId: "T-0001",
      author: "approach:sess-1",
      status: "pending",
      basePlanVersion: 1,
      rationale: "Split Discovery into two work items so the CFO interview can start before the others are drafted.",
      ops: [
        { op: "add_item", def: { id: "WI-005", title: "CFO interview", parent: "PH-1", order: 5, executor: "human", inputs: [], sequencing: [], outputs: [], skills: [], sources: [], gate: [], autostart: true, acceptance: [], brief: "Conduct the CFO interview." } },
      ],
      createdAt: "2026-09-25T00:00:00.000Z",
      resolvedAt: null,
      appliedPlanVersion: null,
      rejectReason: null,
      supersededBy: null,
    },
    readableOps: ["Add WI-005 CFO interview under PH-1, executor: human"],
    suggestedByTitle: null,
    actions: { approve: { allowed: true, reason: null }, reject: { allowed: true, reason: null }, ...overrides },
  };
}

function renderCard(v: ProposalView) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ProposalCard eid="acme-discovery" view={v} />
    </QueryClientProvider>,
  );
}

describe("ProposalCard", () => {
  test("renders one diff line per readable op, with the '+' symbol for an add", () => {
    renderCard(view());
    expect(screen.getByTestId("proposal-status").textContent).toBe("pending");
    const ops = screen.getAllByTestId("proposal-op");
    expect(ops).toHaveLength(1);
    expect(ops[0]!.textContent).toContain("WI-005");
    expect(ops[0]!.textContent).toContain("+");
  });

  test("Approve calls approveProposal when allowed", async () => {
    renderCard(view());
    fireEvent.click(screen.getByTestId("proposal-approve"));
    await waitFor(() => expect(approveProposal).toHaveBeenCalledWith("acme-discovery", "P-0001"));
  });

  test("Approve is disabled with the reason as a tooltip when not allowed", () => {
    renderCard(view({ approve: { allowed: false, reason: "The plan has moved on since this proposal was made." } }));
    const button = screen.getByTestId("proposal-approve") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.title).toBe("The plan has moved on since this proposal was made.");
    fireEvent.click(button);
    expect(approveProposal).not.toHaveBeenCalled();
  });

  test("Reject requires a reason before it can be sent", async () => {
    renderCard(view());
    fireEvent.click(screen.getByTestId("proposal-reject-open"));
    expect((screen.getByTestId("proposal-reject-submit") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByTestId("proposal-reject-reason"), { target: { value: "Not the right sequencing." } });
    fireEvent.click(screen.getByTestId("proposal-reject-submit"));
    await waitFor(() => expect(rejectProposal).toHaveBeenCalledWith("acme-discovery", "P-0001", { reason: "Not the right sequencing." }));
  });

  test("a rejected proposal renders compact (no ops, no action buttons)", () => {
    const rejected = view();
    rejected.proposal.status = "rejected";
    rejected.proposal.rejectReason = "Wrong sequencing.";
    renderCard(rejected);
    expect(screen.queryByTestId("proposal-op")).toBeNull();
    expect(screen.queryByTestId("proposal-approve")).toBeNull();
    expect(screen.getByText(/Wrong sequencing\./)).toBeTruthy();
  });

  test("proposal-preview-toggle opens the Plan with this proposal previewed", () => {
    renderCard(view());
    fireEvent.click(screen.getByTestId("proposal-preview-toggle"));
    expect(openPlan).toHaveBeenCalledWith("acme-discovery", { preview: "P-0001" });
  });
});
