// D5: while a turn is running, sending queues the text locally and posts it
// automatically once the turn ends (brief C §4). The api module is mocked so
// this test controls exactly when the "turn" ends.

import { afterEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Run, ThreadSummary, ThreadView } from "@workbench/core";

// vi.mock factories are hoisted above every top-level const, so anything the
// factory closes over has to be created through vi.hoisted().
const { runningRun, threadSummary, state, postMessage, getThread } = vi.hoisted(() => {
  const runningRun: Run = {
    id: "R-0001",
    itemId: "ENG",
    sessionId: "sess-1",
    reason: "aa-turn",
    outcome: null,
    model: "claude-haiku-4-5",
    costUsd: 0,
    turns: 1,
    promptHash: null,
    startedAt: "2026-09-25T00:00:00.000Z",
    endedAt: null,
    nudged: false,
    denials: 0,
    error: null,
  };
  const threadSummary: ThreadSummary = { id: "T-0001", subject: "Conversation", createdAt: "2026-09-25T00:00:00.000Z", messageCount: 0, activeRunId: "R-0001" };
  const state: { threadView: ThreadView } = { threadView: { thread: threadSummary, messages: [], activeRun: runningRun } };
  return {
    runningRun,
    threadSummary,
    state,
    postMessage: vi.fn().mockResolvedValue({ messageId: "M-0001", runId: "R-0002" }),
    getThread: vi.fn(async () => state.threadView),
  };
});

vi.mock("../../api/index.js", async () => {
  const actual = await vi.importActual<typeof import("../../api/index.js")>("../../api/index.js");
  return {
    ...actual,
    api: {
      listThreads: vi.fn().mockResolvedValue([threadSummary]),
      getThread,
      postMessage,
      getRunActivity: vi.fn().mockResolvedValue({ run: runningRun, activity: [] }),
    },
  };
});

import { ChatPanel } from "./ChatPanel.js";
import { qk } from "../../api/queryKeys.js";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  state.threadView = { thread: threadSummary, messages: [], activeRun: runningRun };
});

describe("ChatPanel — D5 queueing", () => {
  test("queues a message while a turn is running, then sends it once the turn ends", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <ChatPanel eid="acme-discovery" />
      </QueryClientProvider>,
    );

    await screen.findByTestId("chat-panel");
    // The active turn's own activity is showing — sending now must queue, not POST.
    await screen.findByTestId("chat-activity");

    fireEvent.change(screen.getByTestId("chat-input"), { target: { value: "What about the fourth plant?" } });
    fireEvent.click(screen.getByTestId("chat-send"));

    expect(screen.getByTestId("chat-queued").textContent).toContain("What about the fourth plant?");
    expect(postMessage).not.toHaveBeenCalled();

    // The turn ends: the next getThread call (as if invalidated by RunEnded over WS) reports no active run.
    state.threadView = { thread: { ...threadSummary, activeRunId: null }, messages: [], activeRun: null };
    await act(async () => {
      await qc.invalidateQueries({ queryKey: qk.thread("acme-discovery", "T-0001") });
    });

    await waitFor(() => expect(postMessage).toHaveBeenCalledWith("acme-discovery", "T-0001", { text: "What about the fourth plant?" }));
    await waitFor(() => expect(screen.queryByTestId("chat-queued")).toBeNull());
  });
});
