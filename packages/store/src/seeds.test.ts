import { afterEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { engagementPaths } from "@workbench/core/node";
import { createEngagementFromSeed, listSeeds, loadSeed, SeedValidationError } from "./seeds.js";
import { readItemMd } from "./files.js";
import { makeTempDir, rmDir, tempWorkspace } from "./test-helpers.js";

const realSeedsDir = path.resolve(import.meta.dirname, "../../../demo/seeds");
const realSeedDir = path.join(realSeedsDir, "acme-discovery");

const cleanups: string[] = [];
afterEach(() => {
  while (cleanups.length) rmDir(cleanups.pop()!);
});

// ---------------------------------------------------------------------------
// The real seed loads and validates cleanly.
// ---------------------------------------------------------------------------

describe("loadSeed on the real acme-discovery seed", () => {
  test("loads without throwing and finds every seed asset", () => {
    const seed = loadSeed(realSeedDir);
    expect(seed.manifest.id).toBe("acme-discovery");
    expect(seed.plan.items.length).toBeGreaterThan(0);
    expect(seed.assets.map((a) => a.slotRef).sort()).toEqual(["ENG/context", "ENG/stakeholders"]);
  });
});

describe("listSeeds", () => {
  test("finds the real seed with a correct item count", () => {
    const summaries = listSeeds(realSeedsDir);
    const acme = summaries.find((s) => s.id === "acme-discovery");
    expect(acme).toBeDefined();
    expect(acme!.itemCount).toBe(loadSeed(realSeedDir).plan.items.length);
  });

  test("skips a broken seed folder rather than throwing", () => {
    const dir = makeTempDir("w4-listseeds");
    cleanups.push(dir);
    fs.mkdirSync(path.join(dir, "good"), { recursive: true });
    fs.cpSync(realSeedDir, path.join(dir, "good"), { recursive: true });
    fs.mkdirSync(path.join(dir, "broken"), { recursive: true });
    fs.writeFileSync(path.join(dir, "broken", "seed.yaml"), "not: [valid, seed");

    const summaries = listSeeds(dir);
    expect(summaries.map((s) => s.id)).toEqual(["acme-discovery"]);
  });
});

// ---------------------------------------------------------------------------
// A minimal seed builder, so each broken-case test only breaks one thing.
// ---------------------------------------------------------------------------

function writeSeed(dir: string, files: { manifest?: string; defaults?: string; plan?: string; assets?: Record<string, string> }) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "seed.yaml"),
    files.manifest ??
      "id: test-seed\ntitle: Test Seed\ndescription: A minimal test seed.\nengagementName: Test Engagement\n",
  );
  fs.writeFileSync(path.join(dir, "defaults.yaml"), files.defaults ?? "settings: {}\n");
  fs.writeFileSync(
    path.join(dir, "plan.template.yaml"),
    files.plan ??
      [
        "items:",
        "  - id: ENG",
        "    title: Engagement Root",
        "    parent: null",
        "    executor: null",
        "    outputs:",
        "      - slot: context",
        "        format: md",
        "    brief: Context.",
        "  - id: WI-001",
        "    title: Do the work",
        "    parent: null",
        "    executor: agent",
        "    inputs:",
        "      - slot: ENG/context",
        "    brief: Work.",
        "",
      ].join("\n"),
  );
  if (files.assets) {
    for (const [rel, content] of Object.entries(files.assets)) {
      const p = path.join(dir, "assets", rel);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, content);
    }
  }
}

function badSeedDir(name: string): string {
  const dir = path.join(makeTempDir("w4-badseed"), name);
  cleanups.push(dir);
  return dir;
}

describe("loadSeed catches each broken case beyond the schema", () => {
  test("duplicate item ids", () => {
    const dir = badSeedDir("dup-id");
    writeSeed(dir, {
      plan: [
        "items:",
        "  - id: ENG",
        "    title: Root",
        "    parent: null",
        "    executor: null",
        "    brief: Root.",
        "  - id: ENG",
        "    title: Root again",
        "    parent: null",
        "    executor: null",
        "    brief: Root again.",
        "",
      ].join("\n"),
    });
    expect(() => loadSeed(dir)).toThrow(SeedValidationError);
    try {
      loadSeed(dir);
    } catch (e) {
      expect((e as SeedValidationError).issues.join("\n")).toMatch(/duplicate item id "ENG"/);
    }
  });

  test("missing ENG root", () => {
    const dir = badSeedDir("no-eng");
    writeSeed(dir, {
      plan: ["items:", "  - id: WI-001", "    title: Solo item", "    parent: null", "    executor: agent", "    brief: Work.", ""].join(
        "\n",
      ),
    });
    expect(() => loadSeed(dir)).toThrow(/no item with id "ENG"/);
  });

  test("parent does not exist", () => {
    const dir = badSeedDir("bad-parent");
    writeSeed(dir, {
      plan: [
        "items:",
        "  - id: ENG",
        "    title: Root",
        "    parent: null",
        "    executor: null",
        "    brief: Root.",
        "  - id: WI-001",
        "    title: Orphan",
        "    parent: PH-1",
        "    executor: agent",
        "    brief: Work.",
        "",
      ].join("\n"),
    });
    expect(() => loadSeed(dir)).toThrow(/has parent "PH-1", which does not exist/);
  });

  test("input slot is not any item's output", () => {
    const dir = badSeedDir("bad-input");
    writeSeed(dir, {
      plan: [
        "items:",
        "  - id: ENG",
        "    title: Root",
        "    parent: null",
        "    executor: null",
        "    brief: Root.",
        "  - id: WI-001",
        "    title: Consumer",
        "    parent: null",
        "    executor: agent",
        "    inputs:",
        "      - slot: WI-999/nope",
        "    brief: Work.",
        "",
      ].join("\n"),
    });
    expect(() => loadSeed(dir)).toThrow(/declares input "WI-999\/nope", which is not any item's declared output/);
  });

  test("a seed asset does not match any output slot", () => {
    const dir = badSeedDir("bad-asset-slot");
    writeSeed(dir, { assets: { "ENG/nonexistent-slot.md": "content" } });
    expect(() => loadSeed(dir)).toThrow(/does not match any output slot of "ENG"/);
  });

  test("a seed asset has the wrong format for its slot", () => {
    const dir = badSeedDir("bad-asset-format");
    writeSeed(dir, { assets: { "ENG/context.txt": "content" } });
    expect(() => loadSeed(dir)).toThrow(/has extension ".txt", but slot "context" declares format "md"/);
  });

  test("a sequencing/input dependency cycle", () => {
    const dir = badSeedDir("cycle");
    writeSeed(dir, {
      plan: [
        "items:",
        "  - id: ENG",
        "    title: Root",
        "    parent: null",
        "    executor: null",
        "    brief: Root.",
        "  - id: WI-001",
        "    title: A",
        "    parent: null",
        "    executor: agent",
        "    outputs:",
        "      - slot: out-a",
        "        format: md",
        "    inputs:",
        "      - slot: WI-002/out-b",
        "    brief: A.",
        "  - id: WI-002",
        "    title: B",
        "    parent: null",
        "    executor: agent",
        "    outputs:",
        "      - slot: out-b",
        "        format: md",
        "    inputs:",
        "      - slot: WI-001/out-a",
        "    brief: B.",
        "",
      ].join("\n"),
    });
    expect(() => loadSeed(dir)).toThrow(/dependency cycle/);
  });

  test("a valid minimal seed loads cleanly", () => {
    const dir = badSeedDir("valid-minimal");
    writeSeed(dir, {});
    const seed = loadSeed(dir);
    expect(seed.plan.items.map((i) => i.id)).toEqual(["ENG", "WI-001"]);
  });
});

// ---------------------------------------------------------------------------
// createEngagementFromSeed: disk layout (ARCHITECTURE.md §5.2).
// ---------------------------------------------------------------------------

describe("createEngagementFromSeed", () => {
  test("builds the ARCHITECTURE.md §5.2 layout from the real seed", () => {
    const { workspace, home } = tempWorkspace();
    cleanups.push(home);

    const result = createEngagementFromSeed({ workspace, seedDir: realSeedDir, name: "Test Engagement" });

    expect(result.engagementId).toBe("acme-discovery");
    expect(fs.existsSync(path.join(result.root, "engagement.yaml"))).toBe(true);
    expect(fs.existsSync(path.join(result.root, "items"))).toBe(true);

    const paths = engagementPaths(result.root);
    for (const def of result.defs) {
      expect(fs.existsSync(paths.itemMd(def.id))).toBe(true);
      expect(fs.existsSync(paths.itemWork(def.id))).toBe(true);
      expect(fs.existsSync(paths.itemAssets(def.id))).toBe(true);
      // result.defs is already normalized to match what's on disk (see createEngagementFromSeed).
      expect(readItemMd(paths.itemMd(def.id))).toEqual(def);
    }

    // Seed assets published as immutable v1.0 files, author human, note references the seed.
    expect(result.seededVersions.map((v) => v.slot).sort()).toEqual(["ENG/context", "ENG/stakeholders"]);
    for (const v of result.seededVersions) {
      expect(v.version).toBe("1.0");
      expect(v.author).toBe("human");
      expect(v.kind).toBe("material");
      expect(v.runId).toBeNull();
      expect(v.note).toBe("From seed acme-discovery");
      expect(fs.existsSync(path.join(result.root, v.path))).toBe(true);
    }
  });

  test("a second engagement from the same seed gets a disambiguated id", () => {
    const { workspace, home } = tempWorkspace();
    cleanups.push(home);

    const first = createEngagementFromSeed({ workspace, seedDir: realSeedDir, name: "First" });
    const second = createEngagementFromSeed({ workspace, seedDir: realSeedDir, name: "Second" });

    expect(first.engagementId).toBe("acme-discovery");
    expect(second.engagementId).toBe("acme-discovery-2");
  });

  test("works with a workspace home path containing a space and mixed case (Windows)", () => {
    const { workspace, home } = tempWorkspace("W4 Store Space Test");
    cleanups.push(home);
    const result = createEngagementFromSeed({ workspace, seedDir: realSeedDir, name: "Space Test" });
    expect(fs.existsSync(result.root)).toBe(true);
  });
});
