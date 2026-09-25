import { afterEach, describe, expect, it } from "vitest";
import { openTestDb, type TestDb } from "../testDb.js";
import { createAgendaItem, getAgendaItem, listAgendaItems } from "./agenda.js";

const now = () => new Date().toISOString();

describe("agenda repository", () => {
  let t: TestDb;
  afterEach(() => t?.cleanup());

  it("creates and reads a question row", () => {
    t = openTestDb();
    const row = createAgendaItem(t.ctx, {
      id: "A-0001",
      kind: "question",
      title: "WI-002: Who is the CIO?",
      status: "open",
      links: { items: ["WI-002"], requests: ["RQ-0001"] },
      createdAt: now(),
    });
    expect(row.links.items).toEqual(["WI-002"]);
    expect(row.links.proposals).toEqual([]);
    expect(getAgendaItem(t.ctx, "A-0001")).toEqual(row);
    expect(listAgendaItems(t.ctx)).toHaveLength(1);
  });
});
