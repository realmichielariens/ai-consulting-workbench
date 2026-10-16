// UX1 brief B §Checks: tracker grouping (grouped by phase, task rows kept
// in phase order) and peek → open (the peek card's Open button opens the item).

import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ItemDetailView, PlanView } from "@workbench/core";
import { PlanTracker } from "./PlanTracker.js";

const { getItem } = vi.hoisted(() => ({ getItem: vi.fn() }));

vi.mock("../../api/index.js", async () => {
  const actual = await vi.importActual<typeof import("../../api/index.js")>("../../api/index.js");
  return { ...actual, api: { ...actual.api, getItem } };
});

import { PeekCard } from "./PeekCard.js";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function plan(): PlanView {
  return {
    engagementId: "acme-discovery",
    planVersion: 3,
    items: [
      { id: "PH-1", title: "Discovery", kind: "composite", parent: null, order: 1, executor: null, status: null, rollup: { total: 2, done: 1, byStatus: {}, worst: "ready" }, gate: [], inputs: [], outputs: [], notReadyBecause: [], activeRunId: null, resumable: false },
      { id: "PH-2", title: "Synthesis", kind: "composite", parent: null, order: 2, executor: null, status: null, rollup: { total: 1, done: 0, byStatus: {}, worst: "waiting" }, gate: [], inputs: [], outputs: [], notReadyBecause: [], activeRunId: null, resumable: false },
      { id: "WI-002", title: "Prepare interview guide", kind: "task", parent: "PH-1", order: 1, executor: "agent", status: "done", rollup: null, gate: [{ type: "human-review" }], inputs: [], outputs: [], notReadyBecause: [], activeRunId: null, resumable: false },
      { id: "WI-003", title: "Conduct CxO interviews", kind: "task", parent: "PH-1", order: 2, executor: "human", status: "ready", rollup: null, gate: [], inputs: [], outputs: [], notReadyBecause: [], activeRunId: null, resumable: false },
      { id: "WI-004", title: "Consolidate themes", kind: "task", parent: "PH-2", order: 1, executor: "agent", status: "waiting", rollup: null, gate: [{ type: "human-review" }], inputs: [], outputs: [], notReadyBecause: [], activeRunId: null, resumable: false },
    ],
    slots: [],
  };
}

describe("PlanTracker grouping", () => {
  test("groups task rows by phase, in phase order, with each row under its own phase", () => {
    render(<PlanTracker plan={plan()} sel={null} onSelect={vi.fn()} onOpen={vi.fn()} />);
    const table = screen.getByTestId("tracker-table");
    const rowTexts = Array.from(table.querySelectorAll("tbody tr")).map((tr) => tr.textContent ?? "");
    // group headers and rows appear in document order: PH-1's group, then its two tasks, then PH-2's group, then its task.
    expect(rowTexts[0]).toContain("Discovery");
    expect(rowTexts[1]).toContain("WI-002");
    expect(rowTexts[2]).toContain("WI-003");
    expect(rowTexts[3]).toContain("Synthesis");
    expect(rowTexts[4]).toContain("WI-004");
  });

  test("the Mine filter keeps only human-executed tasks", () => {
    render(<PlanTracker plan={plan()} sel={null} onSelect={vi.fn()} onOpen={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Mine" }));
    expect(screen.queryByTestId("tracker-row-WI-002")).toBeNull();
    expect(screen.getByTestId("tracker-row-WI-003")).toBeTruthy();
  });
});

function itemDetail(overrides: Partial<ItemDetailView> = {}): ItemDetailView {
  return {
    node: { id: "WI-004", title: "Consolidate themes", kind: "task", parent: "PH-2", order: 1, executor: "agent", status: "at_gate", rollup: null, gate: [{ type: "human-review" }], inputs: [], outputs: [], notReadyBecause: [], activeRunId: null, resumable: false },
    def: { id: "WI-004", title: "Consolidate themes", parent: "PH-2", order: 1, executor: "agent", inputs: [], sequencing: [], outputs: [], skills: [], sources: [], gate: [{ type: "human-review" }], autostart: true, acceptance: [], brief: "Synthesize the four interviews into the major themes." },
    inputs: [],
    outputs: [],
    runs: [],
    activeRun: null,
    openRequests: [],
    lastReport: null,
    actions: { start: { allowed: false, reason: "Already at gate" }, stop: { allowed: false, reason: null }, resume: { allowed: false, reason: null }, markDone: { allowed: false, reason: null }, edit: { allowed: false, reason: null }, upload: { allowed: false, reason: null } },
    ...overrides,
  };
}

describe("PeekCard", () => {
  test("peek-open opens the item", async () => {
    getItem.mockResolvedValue(itemDetail());
    const onOpen = vi.fn();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <PeekCard eid="acme-discovery" itemId="WI-004" onClose={vi.fn()} onOpen={onOpen} />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("peek-card")).toBeTruthy());
    fireEvent.click(screen.getByTestId("peek-open"));
    expect(onOpen).toHaveBeenCalledWith("WI-004");
  });

  test("shows the Run action only when start is allowed", async () => {
    getItem.mockResolvedValue(itemDetail({ actions: { start: { allowed: true, reason: null }, stop: { allowed: false, reason: null }, resume: { allowed: false, reason: null }, markDone: { allowed: false, reason: null }, edit: { allowed: false, reason: null }, upload: { allowed: false, reason: null } } }));
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <PeekCard eid="acme-discovery" itemId="WI-004" onClose={vi.fn()} onOpen={vi.fn()} />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByText("Run")).toBeTruthy());
  });
});
