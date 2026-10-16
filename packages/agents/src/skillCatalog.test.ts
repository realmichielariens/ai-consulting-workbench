// The skill catalog against the real workbench-skills plugin, plus a temp
// plugin for the parsing edge cases.
import { describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadSkillCatalog, renderSkillCatalog, unknownSkills } from "./skillCatalog.js";

const pluginDir = path.resolve(import.meta.dirname, "../../../workbench-skills");

describe("loadSkillCatalog (real plugin)", () => {
  const catalog = loadSkillCatalog(pluginDir);

  test("lists every skill, sorted, with a description", () => {
    const names = catalog.map((s) => s.name);
    expect(names).toEqual([...names].sort());
    expect(names).toEqual(expect.arrayContaining(["desk-research", "interview-guide-design", "thematic-synthesis", "workbench-protocol"]));
    for (const s of catalog) expect(s.description.length).toBeGreaterThan(0);
  });

  test("unknownSkills names what the plugin lacks", () => {
    expect(unknownSkills(catalog, ["desk-research", "web-scraping"])).toEqual(["web-scraping"]);
  });

  test("renderSkillCatalog leaves out the protocol skill", () => {
    const md = renderSkillCatalog(catalog);
    expect(md).not.toContain("workbench-protocol");
    expect(md).toContain("- `desk-research`: ");
  });
});

describe("loadSkillCatalog (edge cases)", () => {
  test("a malformed SKILL.md is skipped", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "skill-catalog-"));
    for (const [name, body] of Object.entries({ a: "---\nname: a\ndescription: A.\n---\nbody", b: "no front matter at all" })) {
      fs.mkdirSync(path.join(dir, "skills", name), { recursive: true });
      fs.writeFileSync(path.join(dir, "skills", name, "SKILL.md"), body, "utf8");
    }
    expect(loadSkillCatalog(dir)).toEqual([{ name: "a", description: "A." }]);
  });

  test("a missing plugin dir is an empty catalog", () => {
    expect(loadSkillCatalog(path.join(os.tmpdir(), "no-such-plugin-dir"))).toEqual([]);
  });
});
