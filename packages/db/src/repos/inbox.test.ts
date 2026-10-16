import { afterEach, describe, expect, it } from "vitest";
import type { ItemDef } from "@workbench/core";
import { openTestDb, type TestDb } from "../testDb.js";
import { createRequest } from "./requests.js";
import { listInboxHumanItems, listInboxRequests } from "./inbox.js";
import { setStatus, upsertDefinitions } from "./items.js";

const now = () => new Date().toISOString();

const wi003: ItemDef = {
  id: "WI-003",
  title: "Conduct CxO interviews",
  parent: "PH-1",
  order: 1,
  executor: "human",
  inputs: [],
  sequencing: [],
  outputs: [],
  skills: [],
  sources: [],
  gate: [],
  autostart: true,
  acceptance: [],
  brief: "",
};

const wi004: ItemDef = { ...wi003, id: "WI-004", title: "Consolidate themes", executor: "agent" };

describe("inbox repository building blocks", () => {
  let t: TestDb;
  afterEach(() => t?.cleanup());

  it("listInboxRequests includes question, gate_request and run_issue, addressed to human, open only", () => {
    t = openTestDb();
    createRequest(t.ctx, { id: "RQ-0001", type: "question", from: "agent:WI-002", to: "human", itemId: "WI-002", runId: "R-0001", blocking: true, payload: { question: "Q", hypothesis: "H", alternatives: [] }, createdAt: now() });
    createRequest(t.ctx, {
      id: "RQ-0002",
      type: "gate_request",
      from: "agent:WI-002",
      to: "human",
      itemId: "WI-002",
      runId: "R-0001",
      blocking: false,
      payload: { step: 0, gateType: "human-review", submitted: [{ slot: "WI-002/interview-guide", version: "1.0" }], report: { summary: "s", selfCheck: [], openIssues: [] } },
      createdAt: now(),
    });
    createRequest(t.ctx, { id: "RQ-0003", type: "run_issue", from: "system", to: "human", itemId: "WI-004", runId: "R-0002", blocking: true, payload: { runId: "R-0002", reason: "no_submit", lastMessage: "m" }, createdAt: now() });

    const inbox = listInboxRequests(t.ctx);
    expect(inbox.map((r) => r.id).sort()).toEqual(["RQ-0001", "RQ-0002", "RQ-0003"]);
  });

  it("listInboxHumanItems: ready or in_progress human items only", () => {
    t = openTestDb();
    upsertDefinitions(t.ctx, [wi003, wi004], Date.now());
    setStatus(t.ctx, "WI-003", "ready", Date.now());
    setStatus(t.ctx, "WI-004", "ready", Date.now()); // agent item: excluded

    expect(listInboxHumanItems(t.ctx).map((i) => i.id)).toEqual(["WI-003"]);

    setStatus(t.ctx, "WI-003", "in_progress", Date.now());
    expect(listInboxHumanItems(t.ctx).map((i) => i.id)).toEqual(["WI-003"]);

    setStatus(t.ctx, "WI-003", "done", Date.now());
    expect(listInboxHumanItems(t.ctx)).toEqual([]);
  });
});
