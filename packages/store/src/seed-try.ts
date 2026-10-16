#!/usr/bin/env -S node --import tsx
// `pnpm seed:try <seedId> [--name <name>]`: creates an engagement from a
// seed in `<workspace home>/engagements/`, without a server (I1-PLAN.md §6
// W4). Prints the engagement path and `git log --stat -1`.

import path from "node:path";
import { engagementPaths, loadConfig, repoRoot, workspacePaths } from "@workbench/core/node";
import { checkpoint, initRepo, logStat } from "./git.js";
import { buildPreviewPlanView, renderPlanMd, writePlanMd } from "./projections.js";
import { readEngagementYaml } from "./files.js";
import { createEngagementFromSeed, loadSeed } from "./seeds.js";

function parseArgs(argv: string[]): { seedId: string; name?: string } {
  const [seedId, ...rest] = argv;
  if (!seedId) {
    console.error("Usage: pnpm seed:try <seedId> [--name <name>]");
    process.exit(1);
  }
  let name: string | undefined;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--name") {
      name = rest[i + 1];
      i += 1;
    }
  }
  return { seedId, name };
}

async function main(): Promise<void> {
  const { seedId, name } = parseArgs(process.argv.slice(2));

  const root = repoRoot();
  const config = loadConfig(root);
  const workspace = workspacePaths(config.resolved.home);
  const seedDir = path.join(root, "demo", "seeds", seedId);

  const seed = loadSeed(seedDir); // fails fast, with all validation issues, before anything is written
  const engagementName = name ?? seed.manifest.engagementName;

  const result = createEngagementFromSeed({ workspace, seedDir, name: engagementName });
  const paths = engagementPaths(result.root);

  await initRepo(result.root);

  const planView = buildPreviewPlanView(result.defs, result.seededVersions, result.engagementId, 1);
  const meta = readEngagementYaml(paths);
  writePlanMd(paths, renderPlanMd(planView, meta));

  const sha = await checkpoint(result.root, {
    message: `Create engagement from seed ${seed.manifest.id}`,
    actor: "human",
    trailers: { "Workbench-Event": "EngagementCreated" },
  });

  console.log(`Engagement "${result.engagementId}" created from seed "${seed.manifest.id}"`);
  console.log(`  path: ${result.root}`);
  console.log(`  items: ${result.defs.length}, seeded asset versions: ${result.seededVersions.length}`);
  console.log(`  checkpoint commit: ${sha ?? "(none — nothing to commit)"}`);
  console.log("");
  console.log(await logStat(result.root, 1));
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
