import { afterEach, describe, expect, it } from "vitest";
import { openTestDb, type TestDb } from "../testDb.js";
import { acquireLease, getSession, listExpired, listWithPid, releaseLease, renewLease, setPid, setSessionId, setStatus } from "./leases.js";

describe("leases repository (ARCHITECTURE.md §8.4, M0 S8)", () => {
  let t: TestDb;
  afterEach(() => t?.cleanup());

  it("acquires a fresh scope_key", () => {
    t = openTestDb();
    const now = Date.now();
    const r = acquireLease(t.ctx, { scopeKey: "work:WI-002", role: "work", holder: "R-0001", leaseMs: 60_000, now });
    expect(r.acquired).toBe(true);
    expect(r.row).toMatchObject({ scopeKey: "work:WI-002", holder: "R-0001", status: "active" });
  });

  it("refuses a second acquire while the lease is live (R6: already running)", () => {
    t = openTestDb();
    const now = Date.now();
    acquireLease(t.ctx, { scopeKey: "work:WI-002", role: "work", holder: "R-0001", leaseMs: 60_000, now });
    const second = acquireLease(t.ctx, { scopeKey: "work:WI-002", role: "work", holder: "R-0002", leaseMs: 60_000, now });
    expect(second.acquired).toBe(false);
    expect(second.row.holder).toBe("R-0001"); // still the first holder
  });

  it("an expired lease can be acquired by a new holder", () => {
    t = openTestDb();
    const t0 = Date.now();
    acquireLease(t.ctx, { scopeKey: "work:WI-002", role: "work", holder: "R-0001", leaseMs: 10, now: t0 });
    const later = t0 + 1000; // well past the 10ms lease
    const r = acquireLease(t.ctx, { scopeKey: "work:WI-002", role: "work", holder: "R-0002", leaseMs: 60_000, now: later });
    expect(r.acquired).toBe(true);
    expect(r.row.holder).toBe("R-0002");
  });

  it("renewLease extends the lease only for the current holder", () => {
    t = openTestDb();
    const now = Date.now();
    acquireLease(t.ctx, { scopeKey: "work:WI-002", role: "work", holder: "R-0001", leaseMs: 100, now });
    expect(renewLease(t.ctx, "work:WI-002", "R-0001", 60_000, now + 50)).toBe(true);
    expect(renewLease(t.ctx, "work:WI-002", "R-9999", 60_000, now + 50)).toBe(false);

    const stillLive = acquireLease(t.ctx, { scopeKey: "work:WI-002", role: "work", holder: "R-0002", leaseMs: 60_000, now: now + 200 });
    expect(stillLive.acquired).toBe(false); // renewal pushed expiry well past now+200
  });

  it("releaseLease clears the holder only for the current holder", () => {
    t = openTestDb();
    const now = Date.now();
    acquireLease(t.ctx, { scopeKey: "work:WI-002", role: "work", holder: "R-0001", leaseMs: 60_000, now });
    expect(releaseLease(t.ctx, "work:WI-002", "R-9999", now)).toBe(false);
    expect(releaseLease(t.ctx, "work:WI-002", "R-0001", now)).toBe(true);

    const row = getSession(t.ctx, "work:WI-002");
    expect(row).toMatchObject({ holder: null, leaseUntil: null, status: "idle" });

    const r = acquireLease(t.ctx, { scopeKey: "work:WI-002", role: "work", holder: "R-0002", leaseMs: 60_000, now });
    expect(r.acquired).toBe(true);
  });

  it("listExpired finds active leases past their expiry", () => {
    t = openTestDb();
    const t0 = Date.now();
    acquireLease(t.ctx, { scopeKey: "work:WI-002", role: "work", holder: "R-0001", leaseMs: 10, now: t0 });
    acquireLease(t.ctx, { scopeKey: "work:WI-004", role: "work", holder: "R-0002", leaseMs: 60_000, now: t0 });

    expect(listExpired(t.ctx, t0 + 1000).map((r) => r.scopeKey)).toEqual(["work:WI-002"]);
  });

  it("setPid / listWithPid: the orphan-cleanup input (R2)", () => {
    t = openTestDb();
    const now = Date.now();
    acquireLease(t.ctx, { scopeKey: "work:WI-002", role: "work", holder: "R-0001", leaseMs: 60_000, now });
    setPid(t.ctx, "work:WI-002", 4242, now);
    expect(listWithPid(t.ctx).map((r) => ({ scopeKey: r.scopeKey, pid: r.pid }))).toEqual([{ scopeKey: "work:WI-002", pid: 4242 }]);
  });

  it("setSessionId / setStatus update in place", () => {
    t = openTestDb();
    const now = Date.now();
    acquireLease(t.ctx, { scopeKey: "work:WI-002", role: "work", holder: "R-0001", leaseMs: 60_000, now });
    setSessionId(t.ctx, "work:WI-002", "sess-abc", now);
    setStatus(t.ctx, "work:WI-002", "interrupted", now);
    expect(getSession(t.ctx, "work:WI-002")).toMatchObject({ sessionId: "sess-abc", status: "interrupted" });
  });
});
