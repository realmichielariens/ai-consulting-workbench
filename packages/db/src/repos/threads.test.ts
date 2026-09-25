import { afterEach, describe, expect, it } from "vitest";
import { openTestDb, type TestDb } from "../testDb.js";
import { countMessages, createThread, getThread, insertChatMessage, listMessages, listThreads, setLastSeenSeq, setSessionId } from "./threads.js";

const now = () => new Date().toISOString();

describe("threads repository", () => {
  let t: TestDb;
  afterEach(() => t?.cleanup());

  it("creates T-0001 and reads it back", () => {
    t = openTestDb();
    const thread = createThread(t.ctx, { id: "T-0001", subject: "Engagement conversation", createdAt: now() });
    expect(thread.sessionId).toBeNull();
    expect(thread.lastSeenSeq).toBe(0);
    expect(getThread(t.ctx, "T-0001")).toEqual(thread);
    expect(listThreads(t.ctx)).toHaveLength(1);
  });

  it("setSessionId and setLastSeenSeq persist", () => {
    t = openTestDb();
    createThread(t.ctx, { id: "T-0001", subject: "Engagement conversation", createdAt: now() });
    setSessionId(t.ctx, "T-0001", "sess-abc");
    setLastSeenSeq(t.ctx, "T-0001", 7);
    const thread = getThread(t.ctx, "T-0001")!;
    expect(thread.sessionId).toBe("sess-abc");
    expect(thread.lastSeenSeq).toBe(7);
  });

  it("chat messages: insert, list oldest-first, count", () => {
    t = openTestDb();
    createThread(t.ctx, { id: "T-0001", subject: "Engagement conversation", createdAt: now() });
    insertChatMessage(t.ctx, { id: "M-0001", threadId: "T-0001", role: "human", body: "Hello", at: now() });
    insertChatMessage(t.ctx, {
      id: "M-0002",
      threadId: "T-0001",
      role: "system",
      body: "Proposed a plan change",
      at: now(),
      proposalId: "P-0001",
    });
    const messages = listMessages(t.ctx, "T-0001");
    expect(messages.map((m) => m.id)).toEqual(["M-0001", "M-0002"]);
    expect(messages[1]!.proposalId).toBe("P-0001");
    expect(countMessages(t.ctx, "T-0001")).toBe(2);
  });

  it("chat message asset round-trips", () => {
    t = openTestDb();
    createThread(t.ctx, { id: "T-0001", subject: "Engagement conversation", createdAt: now() });
    const msg = insertChatMessage(t.ctx, {
      id: "M-0001",
      threadId: "T-0001",
      role: "system",
      body: "Published ENG/context v1.0",
      at: now(),
      asset: { slot: "ENG/context", version: "1.0" },
    });
    expect(msg.asset).toEqual({ slot: "ENG/context", version: "1.0" });
  });
});
