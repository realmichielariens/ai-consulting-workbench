import { afterEach, describe, expect, it } from "vitest";
import { openTestDb, type TestDb } from "../testDb.js";
import { createRequest, getRequest, listByItem, listOpenByRecipient, replaceResponse, resolveRequest, setAddressee, setEscalation } from "./requests.js";

const now = () => new Date().toISOString();

describe("requests repository", () => {
  let t: TestDb;
  afterEach(() => t?.cleanup());

  it("creates a question and reads it back", () => {
    t = openTestDb();
    const req = createRequest(t.ctx, {
      id: "RQ-0001",
      type: "question",
      from: "agent:WI-002",
      to: "human",
      itemId: "WI-002",
      runId: "R-0001",
      blocking: true,
      payload: { question: "Who is the CIO?", hypothesis: "New in role, prioritizes security.", alternatives: [] },
      createdAt: now(),
    });
    expect(req.type).toBe("question");
    expect(getRequest(t.ctx, "RQ-0001")).toEqual(req);
  });

  it("rejects a payload that doesn't match the request type", () => {
    t = openTestDb();
    expect(() =>
      createRequest(t.ctx, {
        id: "RQ-0002",
        type: "question",
        from: "agent:WI-002",
        to: "human",
        itemId: "WI-002",
        runId: "R-0001",
        blocking: true,
        payload: { notAQuestion: true },
        createdAt: now(),
      }),
    ).toThrow();
  });

  it("listOpenByRecipient filters by status and recipient", () => {
    t = openTestDb();
    createRequest(t.ctx, {
      id: "RQ-0001",
      type: "run_issue",
      from: "system",
      to: "human",
      itemId: "WI-002",
      runId: "R-0001",
      blocking: true,
      payload: { runId: "R-0001", reason: "no_submit", lastMessage: "I think I'm done." },
      createdAt: now(),
    });
    expect(listOpenByRecipient(t.ctx, "human")).toHaveLength(1);
    expect(listOpenByRecipient(t.ctx, "approach")).toHaveLength(0);
  });

  it("resolveRequest sets status, response and resolvedAt", () => {
    t = openTestDb();
    createRequest(t.ctx, {
      id: "RQ-0001",
      type: "question",
      from: "agent:WI-002",
      to: "human",
      itemId: "WI-002",
      runId: "R-0001",
      blocking: true,
      payload: { question: "Q", hypothesis: "H", alternatives: [] },
      createdAt: now(),
    });
    const resolved = resolveRequest(t.ctx, "RQ-0001", "answered", { kind: "answer", mode: "approve", text: "H", by: "human", at: now() }, now());
    expect(resolved.status).toBe("answered");
    expect(resolved.response).toMatchObject({ kind: "answer", mode: "approve" });
    expect(resolved.resolvedAt).not.toBeNull();
    expect(listOpenByRecipient(t.ctx, "human")).toHaveLength(0);
  });

  it("listByItem returns every request for an item regardless of status", () => {
    t = openTestDb();
    createRequest(t.ctx, { id: "RQ-0001", type: "question", from: "agent:WI-002", to: "human", itemId: "WI-002", runId: "R-0001", blocking: true, payload: { question: "Q1", hypothesis: "H1", alternatives: [] }, createdAt: now() });
    createRequest(t.ctx, { id: "RQ-0002", type: "question", from: "agent:WI-002", to: "human", itemId: "WI-002", runId: "R-0002", blocking: false, payload: { question: "Q2", hypothesis: "H2", alternatives: [] }, createdAt: now() });
    expect(listByItem(t.ctx, "WI-002")).toHaveLength(2);
  });

  it("routedTo defaults to human, and can be set to approach at creation (aa-first)", () => {
    t = openTestDb();
    const req = createRequest(t.ctx, {
      id: "RQ-0001",
      type: "question",
      from: "agent:WI-002",
      to: "approach",
      routedTo: "approach",
      itemId: "WI-002",
      runId: "R-0001",
      blocking: true,
      payload: { question: "Q", hypothesis: "H", alternatives: [] },
      createdAt: now(),
    });
    expect(req.to).toBe("approach");
    expect(req.routedTo).toBe("approach");
    expect(req.escalation).toBeNull();
    expect(listOpenByRecipient(t.ctx, "approach")).toHaveLength(1);
  });

  it("a proposal-type request round-trips its SuggestionPayload", () => {
    t = openTestDb();
    const req = createRequest(t.ctx, {
      id: "RQ-0001",
      type: "proposal",
      from: "agent:WI-004",
      to: "approach",
      routedTo: "approach",
      itemId: "WI-004",
      runId: "R-0001",
      blocking: false,
      payload: { summary: "Split WI-004 in two", suggestedOps: [] },
      createdAt: now(),
    });
    expect(req.type).toBe("proposal");
    expect(getRequest(t.ctx, "RQ-0001")).toEqual(req);
  });

  it("setAddressee moves the current addressee without touching routedTo", () => {
    t = openTestDb();
    createRequest(t.ctx, { id: "RQ-0001", type: "question", from: "agent:WI-002", to: "approach", routedTo: "approach", itemId: "WI-002", runId: "R-0001", blocking: true, payload: { question: "Q", hypothesis: "H", alternatives: [] }, createdAt: now() });
    setAddressee(t.ctx, "RQ-0001", "human");
    const req = getRequest(t.ctx, "RQ-0001")!;
    expect(req.to).toBe("human");
    expect(req.routedTo).toBe("approach");
  });

  it("setEscalation moves the addressee to human, records the view, and leaves the request open", () => {
    t = openTestDb();
    createRequest(t.ctx, { id: "RQ-0001", type: "question", from: "agent:WI-002", to: "approach", routedTo: "approach", itemId: "WI-002", runId: "R-0001", blocking: true, payload: { question: "Q", hypothesis: "H", alternatives: [] }, createdAt: now() });
    const escalated = setEscalation(t.ctx, "RQ-0001", { view: "I'm not confident here.", by: "approach:sess-1", at: now() });
    expect(escalated.to).toBe("human");
    expect(escalated.status).toBe("open");
    expect(escalated.escalation).toEqual({ view: "I'm not confident here.", by: "approach:sess-1", at: expect.any(String) });
  });

  it("replaceResponse overrides an already-answered response (J2.3 override)", () => {
    t = openTestDb();
    createRequest(t.ctx, { id: "RQ-0001", type: "question", from: "agent:WI-002", to: "human", itemId: "WI-002", runId: "R-0001", blocking: true, payload: { question: "Q", hypothesis: "H", alternatives: [] }, createdAt: now() });
    resolveRequest(t.ctx, "RQ-0001", "answered", { kind: "answer", mode: "approve", text: "H", by: "approach:sess-1", at: now() }, now());
    const overridden = replaceResponse(t.ctx, "RQ-0001", { kind: "answer", mode: "replace", text: "Actually, X", by: "human", at: now() }, now());
    expect(overridden.status).toBe("answered");
    expect(overridden.response).toMatchObject({ mode: "replace", by: "human" });
  });
});
