// Smoke test: the app boots on the Engagements home and lists the seed
// (J1.1), then switches to the Exhibit shell once the URL has an eid. The
// api module is mocked so this test needs neither a real server nor
// VITE_API_MOCK; deeper coverage of each screen lives next to its component.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("./api/index.js", () => ({
  api: {
    listSeeds: vi.fn().mockResolvedValue([{ id: "acme-discovery", title: "Acme — IT Strategy Discovery", description: "Discovery seed.", engagementName: "Acme Manufacturing — IT Strategy", itemCount: 3 }]),
    listEngagements: vi.fn().mockResolvedValue([]),
    getEngagement: vi.fn().mockResolvedValue({
      id: "acme",
      name: "Acme Manufacturing — IT Strategy",
      createdAt: "2026-09-25T00:00:00Z",
      seedId: "acme-discovery",
      planVersion: 1,
      costUsd: 0,
      progress: { done: 0, total: 3 },
      inboxCount: 0,
      settings: { questionHandling: "aa-first", itemStart: "manual", planChanges: "propose" },
      folderPath: "/tmp/acme",
      runtime: "fake",
      profile: "test",
      workModel: "claude-haiku-4-5",
      approachModel: "claude-haiku-4-5",
    }),
    getPlan: vi.fn().mockResolvedValue({ engagementId: "acme", planVersion: 1, items: [{ id: "ENG" }], slots: [] }),
    listThreads: vi.fn().mockResolvedValue([]),
    getProfile: vi.fn().mockResolvedValue({
      active: "test",
      available: ["test"],
      models: { approach: "claude-haiku-4-5", work: "claude-haiku-4-5" },
      profileModels: { approach: "claude-haiku-4-5", work: "claude-haiku-4-5" },
      overrides: { approach: null, work: null },
      choices: [{ id: "claude-haiku-4-5", label: "Haiku 4.5" }],
    }),
    connectWs: vi.fn().mockReturnValue(() => {}),
  },
  qk: {
    seeds: () => ["seeds"],
    engagements: () => ["engagements"],
    engagement: (eid: string) => ["engagement", eid],
    plan: (eid: string) => ["plan", eid],
    threads: (eid: string) => ["threads", eid],
    profile: () => ["profile"],
  },
  useEngagementSocket: vi.fn().mockReturnValue("open"),
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
  test("boots on the Engagements home and lists the seed", async () => {
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

  test("mounts the Exhibit shell for /e/:eid", async () => {
    window.history.pushState(null, "", "/e/acme");
    const qc = new QueryClient();
    render(
      <QueryClientProvider client={qc}>
        <App />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("app-shell")).toBeTruthy());
    expect(screen.getByTestId("nav-home")).toBeTruthy();
  });
});
