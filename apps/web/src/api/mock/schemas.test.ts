// The views the mock produces on creation must pass the same Zod schemas the
// real server's responses will be checked against (api.ts). Kept short per
// the scope cut to real-server integration speed: this checks the shape of
// what createEngagement produces, not the full scripted scenario timing.

import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { EngagementView, InboxView, ItemDetailView, PlanView } from "@workbench/core";
import { mockBackend, __resetMockBackend } from "./backend.js";

describe("mock backend: schema conformance", () => {
  beforeEach(() => {
    __resetMockBackend();
  });
  afterEach(() => {
    __resetMockBackend();
  });

  test("views right after createEngagement conform to their api.ts schemas", async () => {
    const summary = await mockBackend.createEngagement({ seedId: "acme-discovery", name: "Acme Test Run" });
    const eid = summary.id;

    const engView = await mockBackend.getEngagement(eid);
    const planView = await mockBackend.getPlan(eid);
    const itemView = await mockBackend.getItem(eid, "WI-002");
    const inboxView = await mockBackend.getInbox(eid);

    expect(() => EngagementView.parse(engView)).not.toThrow();
    expect(() => PlanView.parse(planView)).not.toThrow();
    expect(() => ItemDetailView.parse(itemView)).not.toThrow();
    expect(() => InboxView.parse(inboxView)).not.toThrow();

    // ENG/context and ENG/stakeholders are published at v1.0 on creation (J1.1).
    const contextSlot = planView.slots.find((s) => s.ref === "ENG/context");
    expect(contextSlot?.latest?.version).toBe("1.0");
  });

  test("an unknown seed id is rejected, not silently accepted", async () => {
    await expect(mockBackend.createEngagement({ seedId: "does-not-exist", name: "X" })).rejects.toMatchObject({ code: "not_found" });
  });
});
