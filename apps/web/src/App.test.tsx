// Smoke test: the app boots on the start page and lists seeds (J1.1). The
// api module is mocked here so this test needs neither a real server nor
// VITE_API_MOCK; deeper coverage of each screen lives next to its component.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("./api/index.js", () => ({
  api: {
    listSeeds: vi.fn().mockResolvedValue([{ id: "acme-discovery", title: "Acme — IT Strategy Discovery", description: "Discovery seed.", engagementName: "Acme Manufacturing — IT Strategy", itemCount: 3 }]),
    listEngagements: vi.fn().mockResolvedValue([]),
  },
  qk: {
    seeds: () => ["seeds"],
    engagements: () => ["engagements"],
  },
  useEngagementSocket: vi.fn(),
}));

import { App } from "./App.js";

beforeEach(() => {
  window.history.pushState(null, "", "/");
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("App", () => {
  test("boots on the start page and lists the seed", async () => {
    const qc = new QueryClient();
    render(
      <QueryClientProvider client={qc}>
        <App />
      </QueryClientProvider>,
    );
    expect(screen.getByText("Agentic Project Workbench")).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId("seed-card")).toBeTruthy());
    expect(screen.getByText("Acme — IT Strategy Discovery")).toBeTruthy();
  });
});
