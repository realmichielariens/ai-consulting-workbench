// UX1-PLAN §Build 2 / EXHIBIT §7.3: the Brief's J/K/A/E/R/Enter keyboard
// (brief C §checks "card keyboard actions").

import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { InboxEntry } from "@workbench/core";

const { answerQuestion, approveProposal } = vi.hoisted(() => ({
  answerQuestion: vi.fn().mockResolvedValue({}),
  approveProposal: vi.fn().mockResolvedValue({}),
}));

vi.mock("../../api/index.js", async () => {
  const actual = await vi.importActual<typeof import("../../api/index.js")>("../../api/index.js");
  return { ...actual, api: { ...actual.api, answerQuestion, approveProposal } };
});

const { openItem } = vi.hoisted(() => ({ openItem: vi.fn() }));
vi.mock("../../shell/nav.js", async () => {
  const actual = await vi.importActual<typeof import("../../shell/nav.js")>("../../shell/nav.js");
  return { ...actual, openItem };
});

import { DecisionList } from "./DecisionList.js";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const consequence = { score: 40, blocks: [], reason: "Blocks nothing yet" };

function question(id: string, hypothesis: string): InboxEntry {
  return {
    kind: "question",
    item: { id, title: `Item ${id}` },
    consequence,
    request: {
      id: `RQ-${id}`,
      from: `agent:${id}`,
      to: "human",
      routedTo: "human",
      escalation: null,
      itemId: id,
      runId: null,
      status: "open",
      blocking: true,
      response: null,
      createdAt: "2026-09-25T00:00:00.000Z",
      resolvedAt: null,
      type: "question",
      payload: { question: `Question for ${id}?`, hypothesis, alternatives: [] },
    },
  };
}

function renderList(entries: InboxEntry[]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <DecisionList eid="acme-discovery" entries={entries} />
    </QueryClientProvider>,
  );
}

describe("DecisionList keyboard", () => {
  test("J/K move focus between cards", () => {
    renderList([question("WI-001", "h1"), question("WI-002", "h2")]);
    const items = document.querySelectorAll("li.decision-item");
    expect(items[0]!.className).toContain("decision-item-focused");

    fireEvent.keyDown(window, { key: "j" });
    expect(items[1]!.className).toContain("decision-item-focused");
    expect(items[0]!.className).not.toContain("decision-item-focused");

    fireEvent.keyDown(window, { key: "k" });
    expect(items[0]!.className).toContain("decision-item-focused");
  });

  test("E opens amend on the focused card only", () => {
    renderList([question("WI-001", "h1"), question("WI-002", "h2")]);
    fireEvent.keyDown(window, { key: "e" });
    expect(screen.getAllByTestId("question-answer-text")).toHaveLength(1);
    expect((screen.getByTestId("question-answer-text") as HTMLTextAreaElement).value).toBe("h1");
  });

  test("A approves the focused question with its hypothesis", async () => {
    renderList([question("WI-001", "h1"), question("WI-002", "h2")]);
    fireEvent.keyDown(window, { key: "j" }); // focus WI-002
    fireEvent.keyDown(window, { key: "a" });
    await waitFor(() => expect(answerQuestion).toHaveBeenCalledWith("acme-discovery", "RQ-WI-002", { mode: "approve", text: "h2" }));
  });

  test("Enter opens the focused card's item", () => {
    renderList([question("WI-001", "h1"), question("WI-002", "h2")]);
    fireEvent.keyDown(window, { key: "Enter" });
    expect(openItem).toHaveBeenCalledWith("acme-discovery", "WI-001");
  });
});
