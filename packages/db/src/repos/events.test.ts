import { afterEach, describe, expect, it } from "vitest";
import { openTestDb, type TestDb } from "../testDb.js";
import { appendEvent, latestSeq, listSince } from "./events.js";

const now = () => new Date().toISOString();

describe("events repository", () => {
  let t: TestDb;
  afterEach(() => t?.cleanup());

  it("appendEvent assigns a monotonic seq and returns the full envelope", () => {
    t = openTestDb();
    const e1 = appendEvent(t.ctx, "acme-discovery-1", { type: "EngagementCreated", actor: "human", payload: { name: "Acme", seedId: "acme-discovery" }, at: now() });
    const e2 = appendEvent(t.ctx, "acme-discovery-1", { type: "ItemStatusChanged", actor: "system", payload: { itemId: "WI-002", from: "waiting", to: "ready" }, at: now() });
    expect(e1.seq).toBe(1);
    expect(e2.seq).toBe(2);
    expect(e1.engagementId).toBe("acme-discovery-1");
    expect(latestSeq(t.ctx)).toBe(2);
  });

  it("rejects an event whose payload doesn't match its type", () => {
    t = openTestDb();
    expect(() =>
      appendEvent(t.ctx, "eng-1", { type: "ItemStatusChanged", actor: "system", payload: { itemId: "WI-002" /* missing from/to */ }, at: now() }),
    ).toThrow();
  });

  it("listSince returns events with seq > sinceSeq, ascending", () => {
    t = openTestDb();
    appendEvent(t.ctx, "eng-1", { type: "WorklogAppended", actor: "agent:WI-002", payload: { itemId: "WI-002", entry: "a" }, at: now() });
    appendEvent(t.ctx, "eng-1", { type: "WorklogAppended", actor: "agent:WI-002", payload: { itemId: "WI-002", entry: "b" }, at: now() });
    appendEvent(t.ctx, "eng-1", { type: "WorklogAppended", actor: "agent:WI-002", payload: { itemId: "WI-002", entry: "c" }, at: now() });

    expect(listSince(t.ctx, "eng-1", 1).map((e) => e.seq)).toEqual([2, 3]);
    expect(listSince(t.ctx, "eng-1", 0)).toHaveLength(3);
    expect(listSince(t.ctx, "eng-1", 3)).toEqual([]);
  });
});
