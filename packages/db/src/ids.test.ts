import { afterEach, describe, expect, it } from "vitest";
import { getMeta, getPlanVersion, nextRequestId, nextRunId, setMeta, setPlanVersion } from "./ids.js";
import { openTestDb, type TestDb } from "./testDb.js";

describe("meta and id counters", () => {
  let t: TestDb;
  afterEach(() => t?.cleanup());

  it("nextRunId starts at R-0001 and increments, zero-padded to 4 digits", () => {
    t = openTestDb();
    expect(nextRunId(t.ctx)).toBe("R-0001");
    expect(nextRunId(t.ctx)).toBe("R-0002");
    expect(nextRunId(t.ctx)).toBe("R-0003");
  });

  it("nextRequestId is a separate counter from nextRunId", () => {
    t = openTestDb();
    expect(nextRequestId(t.ctx)).toBe("RQ-0001");
    expect(nextRunId(t.ctx)).toBe("R-0001");
    expect(nextRequestId(t.ctx)).toBe("RQ-0002");
  });

  it("pads to more than 4 digits once the counter passes 9999", () => {
    t = openTestDb();
    setMeta(t.ctx, "next_run_seq", "9999");
    expect(nextRunId(t.ctx)).toBe("R-10000");
  });

  it("getMeta/setMeta round-trip, get returns null when absent", () => {
    t = openTestDb();
    expect(getMeta(t.ctx, "nope")).toBeNull();
    setMeta(t.ctx, "k", "v1");
    expect(getMeta(t.ctx, "k")).toBe("v1");
    setMeta(t.ctx, "k", "v2");
    expect(getMeta(t.ctx, "k")).toBe("v2");
  });

  it("plan version defaults to 1 and can be set", () => {
    t = openTestDb();
    expect(getPlanVersion(t.ctx)).toBe(1);
    setPlanVersion(t.ctx, 3);
    expect(getPlanVersion(t.ctx)).toBe(3);
  });
});
