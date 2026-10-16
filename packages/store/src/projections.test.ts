import { describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { EngagementMeta, ItemDef, PlanTemplate } from "@workbench/core";
import { buildPreviewPlanView, renderPlanMd } from "./projections.js";

const seedPlanPath = path.resolve(import.meta.dirname, "../../../demo/seeds/acme-discovery/plan.template.yaml");
const seedItems = PlanTemplate.parse(parseYaml(fs.readFileSync(seedPlanPath, "utf8"))).items;
const defs = seedItems.map((i) => ItemDef.parse({ ...i, brief: i.brief.trim() }));

const meta = EngagementMeta.parse({
  id: "acme-discovery",
  name: "Acme Manufacturing — IT Strategy",
  createdAt: "2026-09-23T10:00:00.000Z",
  seed: { id: "acme-discovery", title: "Acme — IT Strategy Discovery" },
  planVersion: 1,
});

describe("renderPlanMd", () => {
  test("renders the acme-discovery preview plan (snapshot)", () => {
    // Only ENG/context and ENG/stakeholders are seeded — exactly what
    // createEngagementFromSeed publishes at v1.0 for this seed.
    const seededVersions = [
      {
        slot: "ENG/context" as const,
        version: "1.0" as const,
        major: 1,
        minor: 0,
        kind: "material" as const,
        author: "human" as const,
        at: "2026-09-23T10:00:00.000Z",
        note: "From seed acme-discovery",
        runId: null,
        path: "items/ENG/assets/context/v1.0.md",
        format: "md",
      },
      {
        slot: "ENG/stakeholders" as const,
        version: "1.0" as const,
        major: 1,
        minor: 0,
        kind: "material" as const,
        author: "human" as const,
        at: "2026-09-23T10:00:00.000Z",
        note: "From seed acme-discovery",
        runId: null,
        path: "items/ENG/assets/stakeholders/v1.0.md",
        format: "md",
      },
    ];

    const view = buildPreviewPlanView(defs, seededVersions, "acme-discovery", 1);
    const md = renderPlanMd(view, meta);
    expect(md).toMatchSnapshot();
  });

  test("WI-002 is ready (its inputs are seeded); WI-003 and WI-004 are waiting", () => {
    const seededVersions = [
      {
        slot: "ENG/context" as const,
        version: "1.0" as const,
        major: 1,
        minor: 0,
        kind: "material" as const,
        author: "human" as const,
        at: "2026-09-23T10:00:00.000Z",
        note: "",
        runId: null,
        path: "items/ENG/assets/context/v1.0.md",
        format: "md",
      },
      {
        slot: "ENG/stakeholders" as const,
        version: "1.0" as const,
        major: 1,
        minor: 0,
        kind: "material" as const,
        author: "human" as const,
        at: "2026-09-23T10:00:00.000Z",
        note: "",
        runId: null,
        path: "items/ENG/assets/stakeholders/v1.0.md",
        format: "md",
      },
    ];
    const view = buildPreviewPlanView(defs, seededVersions, "acme-discovery", 1);
    const byId = new Map(view.items.map((i) => [i.id, i]));
    expect(byId.get("WI-002")!.status).toBe("ready");
    expect(byId.get("WI-003")!.status).toBe("waiting");
    expect(byId.get("WI-004")!.status).toBe("waiting");

    const ph1 = byId.get("PH-1")!;
    expect(ph1.rollup).toEqual({ total: 2, done: 0, byStatus: { ready: 1, waiting: 1 }, worst: "ready" });
    const ph2 = byId.get("PH-2")!;
    expect(ph2.rollup).toEqual({ total: 1, done: 0, byStatus: { waiting: 1 }, worst: "waiting" });
  });

  test("with nothing seeded, every leaf item is waiting with a missing_input reason", () => {
    const view = buildPreviewPlanView(defs, [], "acme-discovery", 1);
    const byId = new Map(view.items.map((i) => [i.id, i]));
    for (const id of ["WI-002", "WI-003", "WI-004"]) {
      const node = byId.get(id)!;
      expect(node.status).toBe("waiting");
      expect(node.notReadyBecause.length).toBeGreaterThan(0);
      expect(node.notReadyBecause[0]!.kind).toBe("missing_input");
    }
  });
});
