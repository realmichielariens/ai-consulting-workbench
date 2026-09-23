import { afterEach, describe, expect, it } from "vitest";
import { openTestDb, type TestDb } from "../testDb.js";
import { listByRun, recordConsumption } from "./consumptions.js";

describe("consumptions repository", () => {
  let t: TestDb;
  afterEach(() => t?.cleanup());

  it("records declared and implicit reads", () => {
    t = openTestDb();
    const at = Date.now();
    recordConsumption(t.ctx, { runId: "R-0001", slot: "ENG/context", major: 1, minor: 0, mode: "declared", at });
    recordConsumption(t.ctx, { runId: "R-0001", slot: "ENG/stakeholders", major: 1, minor: 0, mode: "implicit", at });

    const rows = listByRun(t.ctx, "R-0001");
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.mode).sort()).toEqual(["declared", "implicit"]);
  });

  it("is idempotent: the same (run, slot, version, mode) recorded twice does not duplicate or error", () => {
    t = openTestDb();
    const at = Date.now();
    const row = { runId: "R-0001", slot: "ENG/context", major: 1, minor: 0, mode: "implicit" as const, at };
    recordConsumption(t.ctx, row);
    recordConsumption(t.ctx, row);
    expect(listByRun(t.ctx, "R-0001")).toHaveLength(1);
  });
});
