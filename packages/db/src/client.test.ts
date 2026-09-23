import fs from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { openEngagementDb, walCheckpoint } from "./client.js";
import { openTestDb, type TestDb } from "./testDb.js";

describe("openEngagementDb", () => {
  let t: TestDb;
  afterEach(() => t?.cleanup());

  it("runs migrations: every I1 table exists", () => {
    t = openTestDb();
    const tableNames = t.ctx.sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((r) => (r as { name: string }).name);
    for (const table of ["items", "item_inputs", "item_outputs", "item_sequencing", "asset_versions", "consumptions", "runs", "requests", "gate_steps", "sessions", "events", "meta"]) {
      expect(tableNames).toContain(table);
    }
  });

  it("is idempotent: opening the same file twice does not error or duplicate migrations", () => {
    t = openTestDb();
    t.ctx.close();
    const reopened = openEngagementDb(t.file);
    const count = reopened.sqlite.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'items'").get() as { n: number };
    expect(count.n).toBe(1);
    reopened.close();
  });

  it("sets journal_mode WAL, foreign_keys ON, and a busy_timeout", () => {
    t = openTestDb();
    expect(t.ctx.sqlite.pragma("journal_mode", { simple: true })).toBe("wal");
    expect(t.ctx.sqlite.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(t.ctx.sqlite.pragma("busy_timeout", { simple: true })).toBeGreaterThan(0);
  });

  it("walCheckpoint truncates the WAL file", () => {
    t = openTestDb();
    t.ctx.sqlite.prepare("INSERT INTO meta (key, value) VALUES ('x', '1')").run();
    walCheckpoint(t.ctx);
    const walPath = `${t.file}-wal`;
    if (fs.existsSync(walPath)) {
      expect(fs.statSync(walPath).size).toBe(0);
    }
  });
});
