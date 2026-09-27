// Engagement cleanup on the home page: select, confirm, delete; a refused
// delete (agent still running) is reported and stays selected.

import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const summary = (id: string, name: string) => ({
  id,
  name,
  createdAt: "2026-09-25T00:00:00Z",
  seedId: "blank",
  planVersion: 1,
  costUsd: 0,
  progress: { done: 0, total: 0 },
  inboxCount: 0,
});

const { api } = vi.hoisted(() => ({
  api: {
    listSeeds: vi.fn(),
    listEngagements: vi.fn(),
    createEngagement: vi.fn(),
    deleteEngagement: vi.fn(),
  },
}));

vi.mock("../../api/index.js", () => ({
  api,
  qk: { seeds: () => ["seeds"], engagements: () => ["engagements"] },
}));

import { HomePage } from "./HomePage.js";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("HomePage engagement delete", () => {
  test("deletes the selected engagements after confirmation and reports a refusal", async () => {
    api.listSeeds.mockResolvedValue([]);
    api.listEngagements.mockResolvedValueOnce([summary("a", "Alpha"), summary("b", "Beta")]).mockResolvedValue([summary("b", "Beta")]);
    api.deleteEngagement.mockImplementation(async (eid: string) => {
      if (eid === "b") throw new Error("1 agent run(s) are active in b; stop them before deleting");
      return { ok: true };
    });

    render(
      <QueryClientProvider client={new QueryClient()}>
        <HomePage />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getAllByTestId("engagement-card")).toHaveLength(2));
    expect(screen.queryByTestId("delete-engagements-button")).toBeNull();

    fireEvent.click(screen.getByTestId("select-all-engagements"));
    fireEvent.click(screen.getByTestId("delete-engagements-button"));
    expect(api.deleteEngagement).not.toHaveBeenCalled(); // nothing goes before the confirm

    fireEvent.click(screen.getByTestId("delete-engagements-confirm-button"));
    await waitFor(() => expect(screen.getAllByTestId("engagement-card")).toHaveLength(1));

    expect(api.deleteEngagement.mock.calls.map((c) => c[0])).toEqual(["a", "b"]);
    expect(screen.getByRole("alert").textContent).toContain("Could not delete b");
    expect(screen.getByTestId("delete-engagements-button").textContent).toContain("(1)");
  });
});
