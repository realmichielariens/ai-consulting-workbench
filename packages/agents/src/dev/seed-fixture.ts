// Builds a throwaway InMemoryEngagement from demo/seeds/<seedId> under
// os.tmpdir(), for the dev CLI (try.ts). Deliberately minimal and
// self-contained per I1-PLAN §6 W1 ("don't depend on W4"): it does not use
// the real store or Git service, just enough of the seed format (seed.ts) to
// run one item.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { parse as parseYaml } from "yaml";
import { PlanTemplate, SeedDefaults, SeedManifest, type ItemDef, type Settings } from "@workbench/core";
import { repoRoot, workspacePaths, type WorkspacePaths } from "@workbench/core/node";
import { InMemoryEngagement, seedPublish } from "./in-memory-engagement.js";

export interface SeedFixture {
  seedId: string;
  manifest: SeedManifest;
  settings: Settings;
  engagementId: string;
  eng: InMemoryEngagement;
  workspace: WorkspacePaths;
}

/** demo/interview-notes/notes-<x>.md -> WI-003/notes-<x> (ITERATIONS §4.1), so WI-004 can be tried standalone. */
function preloadInterviewNotes(eng: InMemoryEngagement, root: string): void {
  const notesDir = path.join(root, "demo", "interview-notes");
  if (!fs.existsSync(notesDir) || !eng.items.has("WI-003")) return;
  const wi003 = eng.items.get("WI-003")!;
  for (const file of fs.readdirSync(notesDir)) {
    const slot = path.parse(file).name; // "notes-ceo.md" -> "notes-ceo"
    if (!wi003.outputs.some((o) => o.slot === slot)) continue;
    seedPublish(eng, `WI-003/${slot}`, path.join(notesDir, file), "human", `From demo/interview-notes/${file} (pre-loaded for a standalone try)`);
  }
}

export function buildSeedFixture(seedId: string): SeedFixture {
  const root = repoRoot();
  const seedDir = path.join(root, "demo", "seeds", seedId);
  if (!fs.existsSync(seedDir)) {
    throw new Error(`No such seed: ${seedId} (looked in ${seedDir})`);
  }

  const manifest = SeedManifest.parse(parseYaml(fs.readFileSync(path.join(seedDir, "seed.yaml"), "utf8")));
  const defaults = SeedDefaults.parse(parseYaml(fs.readFileSync(path.join(seedDir, "defaults.yaml"), "utf8")));
  const plan = PlanTemplate.parse(parseYaml(fs.readFileSync(path.join(seedDir, "plan.template.yaml"), "utf8")));

  const home = fs.mkdtempSync(path.join(os.tmpdir(), `workbench-try-${seedId}-`));
  const workspace = workspacePaths(home);
  const engagementId = `${seedId}-try`;
  const eng = new InMemoryEngagement(workspace.engagement(engagementId), plan.items as ItemDef[]);

  for (const item of plan.items) {
    fs.mkdirSync(eng.paths.itemWork(item.id), { recursive: true });
    fs.mkdirSync(eng.paths.itemAssets(item.id), { recursive: true });
  }

  const assetsDir = path.join(seedDir, "assets");
  if (fs.existsSync(assetsDir)) {
    for (const itemDir of fs.readdirSync(assetsDir)) {
      for (const file of fs.readdirSync(path.join(assetsDir, itemDir))) {
        const slot = path.parse(file).name;
        seedPublish(eng, `${itemDir}/${slot}`, path.join(assetsDir, itemDir, file), "human", `From seed ${seedId}`);
      }
    }
  }

  preloadInterviewNotes(eng, root);

  return { seedId, manifest, settings: defaults.settings, engagementId, eng, workspace };
}
