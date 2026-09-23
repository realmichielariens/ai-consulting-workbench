import { afterEach, describe, expect, it } from "vitest";
import type { ItemDef } from "@workbench/core";
import { openTestDb, type TestDb } from "../testDb.js";
import {
  getItem,
  hashItemDef,
  listAllInputs,
  listAllOutputs,
  listAllSequencing,
  listHumanReadyOrInProgress,
  listInputs,
  listItems,
  listOutputs,
  listSequencing,
  setLastSession,
  setStatus,
  upsertDefinitions,
} from "./items.js";

const eng: ItemDef = {
  id: "ENG",
  title: "Acme — Discovery",
  parent: null,
  order: 0,
  executor: null,
  inputs: [],
  sequencing: [],
  outputs: [],
  skills: [],
  gate: [],
  autostart: true,
  acceptance: [],
  brief: "",
};

const wi002: ItemDef = {
  id: "WI-002",
  title: "Prepare interview guide",
  parent: "PH-1",
  order: 1,
  executor: "agent",
  inputs: [{ slot: "ENG/context", required: true }],
  sequencing: [],
  outputs: [{ slot: "interview-guide", format: "md", scope: "project", description: "the guide", required: true }],
  skills: ["interview-guide-design"],
  gate: [{ type: "human-review" }],
  autostart: true,
  acceptance: ["Covers every stakeholder"],
  brief: "Draft the interview guide.",
};

const wi003: ItemDef = {
  id: "WI-003",
  title: "Conduct CxO interviews",
  parent: "PH-1",
  order: 2,
  executor: "human",
  inputs: [{ slot: "WI-002/interview-guide", required: true }],
  sequencing: ["WI-002"],
  outputs: [{ slot: "notes-ceo", format: "md", scope: "project", description: "", required: true }],
  skills: [],
  gate: [],
  autostart: true,
  acceptance: [],
  brief: "Interview the CxOs.",
};

describe("items repository", () => {
  let t: TestDb;
  afterEach(() => t?.cleanup());

  it("upsertDefinitions inserts new items with initialStatus", () => {
    t = openTestDb();
    upsertDefinitions(t.ctx, [eng, wi002, wi003], Date.now());

    expect(getItem(t.ctx, "ENG")?.status).toBeNull(); // composite/ENG: no status
    expect(getItem(t.ctx, "WI-002")?.status).toBe("waiting");
    expect(getItem(t.ctx, "WI-003")?.status).toBe("waiting");
    expect(getItem(t.ctx, "WI-002")?.kind).toBe("task");
    expect(getItem(t.ctx, "ENG")?.kind).toBe("engagement");
  });

  it("writes inputs, outputs and sequencing rows", () => {
    t = openTestDb();
    upsertDefinitions(t.ctx, [eng, wi002, wi003], Date.now());

    expect(listInputs(t.ctx, "WI-002")).toEqual([{ itemId: "WI-002", slot: "ENG/context", required: true, pin: null }]);
    expect(listOutputs(t.ctx, "WI-002")).toEqual([
      { itemId: "WI-002", slot: "interview-guide", slotRef: "WI-002/interview-guide", format: "md", scope: "project", required: true, description: "the guide" },
    ]);
    expect(listSequencing(t.ctx, "WI-003")).toEqual(["WI-002"]);
    expect(listAllInputs(t.ctx)).toHaveLength(2);
    expect(listAllOutputs(t.ctx)).toHaveLength(2);
    expect(listAllSequencing(t.ctx)).toHaveLength(1);
  });

  it("re-upserting preserves status and lastSessionId (DB is authoritative, not the file)", () => {
    t = openTestDb();
    upsertDefinitions(t.ctx, [eng, wi002], Date.now());
    setStatus(t.ctx, "WI-002", "in_progress", Date.now());
    setLastSession(t.ctx, "WI-002", "sess-123", Date.now());

    const editedWi002: ItemDef = { ...wi002, title: "Prepare interview guide (edited)" };
    upsertDefinitions(t.ctx, [eng, editedWi002], Date.now());

    const row = getItem(t.ctx, "WI-002");
    expect(row?.title).toBe("Prepare interview guide (edited)");
    expect(row?.status).toBe("in_progress"); // untouched by the re-upsert
    expect(row?.lastSessionId).toBe("sess-123"); // untouched by the re-upsert
  });

  it("re-upserting replaces inputs/outputs/sequencing wholesale", () => {
    t = openTestDb();
    upsertDefinitions(t.ctx, [eng, wi003], Date.now());
    expect(listSequencing(t.ctx, "WI-003")).toEqual(["WI-002"]);

    const noLongerSequenced: ItemDef = { ...wi003, sequencing: [] };
    upsertDefinitions(t.ctx, [eng, noLongerSequenced], Date.now());
    expect(listSequencing(t.ctx, "WI-003")).toEqual([]);
  });

  it("listItems and listHumanReadyOrInProgress", () => {
    t = openTestDb();
    upsertDefinitions(t.ctx, [eng, wi002, wi003], Date.now());
    expect(listItems(t.ctx).map((i) => i.id).sort()).toEqual(["ENG", "WI-002", "WI-003"]);

    setStatus(t.ctx, "WI-003", "ready", Date.now());
    expect(listHumanReadyOrInProgress(t.ctx).map((i) => i.id)).toEqual(["WI-003"]);

    setStatus(t.ctx, "WI-002", "ready", Date.now()); // agent item, ready: not a human item
    expect(listHumanReadyOrInProgress(t.ctx).map((i) => i.id)).toEqual(["WI-003"]);
  });

  it("hashItemDef is stable regardless of key order", () => {
    const a = { b: 1, a: 2 };
    const b = { a: 2, b: 1 };
    expect(hashItemDef(a as unknown as ItemDef)).toBe(hashItemDef(b as unknown as ItemDef));
  });

  it("hashItemDef changes when content changes", () => {
    expect(hashItemDef(wi002)).not.toBe(hashItemDef({ ...wi002, brief: "different" }));
  });
});
