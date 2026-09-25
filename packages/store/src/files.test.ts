import { afterEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { ItemDef, PlanTemplate } from "@workbench/core";
import { parse as parseYaml } from "yaml";
import {
  appendWorklog,
  createWriteQueue,
  ensureItemDirs,
  readEngagementYaml,
  readItemMd,
  readVersion,
  readVersionText,
  writeEngagementYaml,
  writeItemMd,
  writeVersionFile,
} from "./files.js";
import { rmDir, tempEngagement } from "./test-helpers.js";

const seedPlanPath = path.resolve(import.meta.dirname, "../../../demo/seeds/acme-discovery/plan.template.yaml");
const seedItems = PlanTemplate.parse(parseYaml(fs.readFileSync(seedPlanPath, "utf8"))).items;

const cleanups: string[] = [];
afterEach(() => {
  while (cleanups.length) rmDir(cleanups.pop()!);
});

function withTempEngagement() {
  const t = tempEngagement();
  cleanups.push(t.root);
  return t;
}

describe("item.md round trip", () => {
  // Format decision (see the look report): writeItemMd/readItemMd normalize
  // the brief's surrounding whitespace (trim), so the round-trip contract is
  // read(write(def)) === def with def.brief already trimmed — seed briefs
  // come out of YAML `|` block scalars with a trailing newline, which is
  // exactly the whitespace this normalizes away.
  for (const item of seedItems) {
    test(`round-trips ${item.id}`, () => {
      const { paths } = withTempEngagement();
      const def = ItemDef.parse(item);
      ensureItemDirs(paths, def.id);
      const file = paths.itemMd(def.id);
      writeItemMd(file, def);
      const readBack = readItemMd(file);
      expect(readBack).toEqual({ ...def, brief: def.brief.trim() });
    });
  }

  test("front-matter key order is deterministic", () => {
    const { paths } = withTempEngagement();
    const def = ItemDef.parse(seedItems.find((i) => i.id === "WI-002"));
    const file = paths.itemMd(def.id);
    writeItemMd(file, def);
    // js-yaml preserves object insertion order (sortKeys defaults to false),
    // so the parsed front-matter's own key order reflects exactly what was
    // written, unlike scanning the raw file (which could also match a
    // "word:" line inside the brief's prose).
    const raw = fs.readFileSync(file, "utf8");
    const keys = Object.keys(matter(raw).data as Record<string, unknown>);
    expect(keys).toEqual([
      "id",
      "title",
      "parent",
      "order",
      "executor",
      "inputs",
      "sequencing",
      "outputs",
      "skills",
      "gate",
      "autostart",
      "acceptance",
    ]);
  });

  test("the brief heading is written and stripped back off", () => {
    const { paths } = withTempEngagement();
    const def = ItemDef.parse(seedItems.find((i) => i.id === "WI-002"));
    const file = paths.itemMd(def.id);
    writeItemMd(file, def);
    const raw = fs.readFileSync(file, "utf8");
    expect(raw).toContain("## Brief");
    expect(readItemMd(file).brief).toBe(def.brief.trim());
  });
});

describe("appendWorklog", () => {
  test("creates the file with a header on the first entry", () => {
    const { paths } = withTempEngagement();
    const def = ItemDef.parse(seedItems.find((i) => i.id === "WI-002"));
    ensureItemDirs(paths, def.id);
    writeItemMd(paths.itemMd(def.id), def);

    appendWorklog(paths, def.id, { actor: "agent:WI-002", at: "2026-09-23T10:00:00.000Z" as const, entry: "First entry." });

    const raw = fs.readFileSync(paths.worklog(def.id), "utf8");
    expect(raw).toContain(`# Worklog — ${def.id} ${def.title}`);
    expect(raw).toContain("— agent:WI-002");
    expect(raw).toContain("First entry.");
  });

  test("appends one section per entry, in order, without disturbing earlier ones", () => {
    const { paths } = withTempEngagement();
    const def = ItemDef.parse(seedItems.find((i) => i.id === "WI-002"));
    ensureItemDirs(paths, def.id);
    writeItemMd(paths.itemMd(def.id), def);

    appendWorklog(paths, def.id, { actor: "agent:WI-002", at: "2026-09-23T10:00:00.000Z" as const, entry: "Entry one." });
    appendWorklog(paths, def.id, { actor: "human", at: "2026-09-23T10:05:00.000Z" as const, entry: "Entry two." });

    const raw = fs.readFileSync(paths.worklog(def.id), "utf8");
    expect(raw.indexOf("Entry one.")).toBeLessThan(raw.indexOf("Entry two."));
    expect(raw.match(/^### /gm)).toHaveLength(2);
    // Header appears exactly once, not re-written on the second append.
    expect(raw.match(/^# Worklog/gm)).toHaveLength(1);
  });
});

describe("writeVersionFile immutability", () => {
  test("first write succeeds and returns an engagement-relative path", () => {
    const { paths } = withTempEngagement();
    const rel = writeVersionFile(paths, "ENG/context", "1.0", "md", { bytes: Buffer.from("hello") });
    expect(rel).toBe("items/ENG/assets/context/v1.0.md");
    expect(readVersionText(paths, "ENG/context", "1.0", "md")).toBe("hello");
  });

  test("a second write of the same version throws, and the original content is untouched", () => {
    const { paths } = withTempEngagement();
    writeVersionFile(paths, "ENG/context", "1.0", "md", { bytes: Buffer.from("original") });
    expect(() => writeVersionFile(paths, "ENG/context", "1.0", "md", { bytes: Buffer.from("overwrite") })).toThrow(
      /immutable/,
    );
    expect(readVersionText(paths, "ENG/context", "1.0", "md")).toBe("original");
  });

  test("a later minor version writes fine", () => {
    const { paths } = withTempEngagement();
    writeVersionFile(paths, "ENG/context", "1.0", "md", { bytes: Buffer.from("v1") });
    writeVersionFile(paths, "ENG/context", "1.1", "md", { bytes: Buffer.from("v1.1") });
    expect(readVersion(paths, "ENG/context", "1.0", "md").toString("utf8")).toBe("v1");
    expect(readVersion(paths, "ENG/context", "1.1", "md").toString("utf8")).toBe("v1.1");
  });
});

describe("engagement.yaml", () => {
  test("round-trips through writeEngagementYaml/readEngagementYaml", () => {
    const { paths } = withTempEngagement();
    const meta = {
      id: "acme-discovery",
      name: "Acme Manufacturing — IT Strategy",
      createdAt: "2026-09-23T10:00:00.000Z",
      seed: { id: "acme-discovery", title: "Acme — IT Strategy Discovery" },
      settings: { questionHandling: "always-human" as const, itemStart: "auto" as const, planChanges: "propose" as const, readPolicy: "project-with-tracking" as const },
      planVersion: 1,
    };
    writeEngagementYaml(paths, meta);
    expect(readEngagementYaml(paths)).toEqual(meta);
  });
});

describe("createWriteQueue", () => {
  test("runs jobs strictly one at a time, in submission order", async () => {
    const queue = createWriteQueue();
    const order: number[] = [];
    const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

    const jobs = [1, 2, 3].map((n) =>
      queue.run(async () => {
        order.push(n * 10); // start marker
        await delay(n === 1 ? 30 : 5); // job 1 is slowest but submitted first
        order.push(n * 10 + 1); // end marker
        return n;
      }),
    );

    const results = await Promise.all(jobs);
    expect(results).toEqual([1, 2, 3]);
    // If writes interleaved, job 2's start (21) would appear before job 1's end (11).
    expect(order).toEqual([10, 11, 20, 21, 30, 31]);
  });

  test("a job that throws does not break the queue for later jobs", async () => {
    const queue = createWriteQueue();
    const first = queue.run(() => {
      throw new Error("boom");
    });
    const second = queue.run(() => 42);
    await expect(first).rejects.toThrow("boom");
    await expect(second).resolves.toBe(42);
  });
});
