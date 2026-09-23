import { afterEach, describe, expect, it } from "vitest";
import { nextVersionParts } from "@workbench/core";
import { openTestDb, type TestDb } from "../testDb.js";
import { getVersion, insertAssetVersion, latestVersion, listLatestPerSlot, listVersionParts, listVersions, publishedSlots } from "./assetVersions.js";

const now = new Date().toISOString();

describe("assetVersions repository", () => {
  let t: TestDb;
  afterEach(() => t?.cleanup());

  it("insert + get round-trips every field", () => {
    t = openTestDb();
    insertAssetVersion(t.ctx, {
      slot: "WI-002/interview-guide",
      version: "1.0",
      major: 1,
      minor: 0,
      kind: "material",
      author: "agent:WI-002",
      at: now,
      note: "first draft",
      runId: "R-0001",
      path: "items/WI-002/assets/interview-guide/v1.0.md",
      format: "md",
    });
    const v = getVersion(t.ctx, "WI-002/interview-guide", 1, 0);
    expect(v).toMatchObject({ slot: "WI-002/interview-guide", version: "1.0", kind: "material", author: "agent:WI-002", note: "first draft" });
  });

  it("listVersions is newest first", () => {
    t = openTestDb();
    for (const [major, minor] of [
      [1, 0],
      [1, 1],
      [2, 0],
    ] as const) {
      insertAssetVersion(t.ctx, {
        slot: "WI-002/x",
        version: `${major}.${minor}`,
        major,
        minor,
        kind: "minor",
        author: "human",
        at: now,
        note: "",
        runId: null,
        path: `items/WI-002/assets/x/v${major}.${minor}.md`,
        format: "md",
      });
    }
    expect(listVersions(t.ctx, "WI-002/x").map((v) => v.version)).toEqual(["2.0", "1.1", "1.0"]);
    expect(latestVersion(t.ctx, "WI-002/x")?.version).toBe("2.0");
  });

  it("publishedSlots / listLatestPerSlot cover every slot with at least one version", () => {
    t = openTestDb();
    insertAssetVersion(t.ctx, { slot: "WI-002/x", version: "1.0", major: 1, minor: 0, kind: "material", author: "human", at: now, note: "", runId: null, path: "p1", format: "md" });
    insertAssetVersion(t.ctx, { slot: "WI-003/y", version: "1.0", major: 1, minor: 0, kind: "material", author: "human", at: now, note: "", runId: null, path: "p2", format: "md" });
    insertAssetVersion(t.ctx, { slot: "WI-003/y", version: "1.1", major: 1, minor: 1, kind: "minor", author: "human", at: now, note: "", runId: null, path: "p3", format: "md" });

    expect(publishedSlots(t.ctx)).toEqual(new Set(["WI-002/x", "WI-003/y"]));
    expect(listLatestPerSlot(t.ctx).get("WI-003/y")?.version).toBe("1.1");
  });

  it("feeds versioning.ts's nextVersionParts directly", () => {
    t = openTestDb();
    expect(nextVersionParts(listVersionParts(t.ctx, "WI-002/x"), "material")).toEqual({ major: 1, minor: 0 });
    insertAssetVersion(t.ctx, { slot: "WI-002/x", version: "1.0", major: 1, minor: 0, kind: "material", author: "human", at: now, note: "", runId: null, path: "p", format: "md" });
    expect(nextVersionParts(listVersionParts(t.ctx, "WI-002/x"), "minor")).toEqual({ major: 1, minor: 1 });
    expect(nextVersionParts(listVersionParts(t.ctx, "WI-002/x"), "material")).toEqual({ major: 2, minor: 0 });
  });

  it("rejects a duplicate (slot, major, minor)", () => {
    t = openTestDb();
    const v = { slot: "WI-002/x", version: "1.0", major: 1, minor: 0, kind: "material" as const, author: "human" as const, at: now, note: "", runId: null, path: "p", format: "md" };
    insertAssetVersion(t.ctx, v);
    expect(() => insertAssetVersion(t.ctx, v)).toThrow();
  });
});
