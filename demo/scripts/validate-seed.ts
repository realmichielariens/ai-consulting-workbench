// Validates a seed folder against the seed contract (packages/core/src/seed.ts):
// schema validity plus the checks the contract documents as "beyond the schema"
// (unique ids, parents exist, every input slot is some item's output, every
// seed asset matches an output slot of its item).
//
// Run from the repo root, once the workspace install exists (needs zod + yaml):
//   node --import tsx demo/scripts/validate-seed.ts [seedId]
// Defaults to "acme-discovery".

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { PlanTemplate, SEED_FILES, SeedDefaults, SeedManifest, type PlanTemplateItem } from "@workbench/core";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const seedId = process.argv[2] ?? "acme-discovery";
const seedDir = path.resolve(scriptDir, "..", "seeds", seedId);

const errors: string[] = [];
const note = (msg: string) => console.log(`  ${msg}`);
const fail = (msg: string) => errors.push(msg);

function readYaml(file: string): unknown {
  const p = path.join(seedDir, file);
  return parseYaml(readFileSync(p, "utf8"));
}

console.log(`Validating seed "${seedId}" at ${seedDir}\n`);

// 1. Schema validation -------------------------------------------------------

const manifestResult = SeedManifest.safeParse(readYaml(SEED_FILES.manifest));
if (!manifestResult.success) {
  fail(`${SEED_FILES.manifest} fails SeedManifest:\n${manifestResult.error.message}`);
} else {
  note(`${SEED_FILES.manifest}: OK (id=${manifestResult.data.id})`);
}

const defaultsResult = SeedDefaults.safeParse(readYaml(SEED_FILES.defaults));
if (!defaultsResult.success) {
  fail(`${SEED_FILES.defaults} fails SeedDefaults:\n${defaultsResult.error.message}`);
} else {
  note(
    `${SEED_FILES.defaults}: OK (questionHandling=${defaultsResult.data.settings.questionHandling}, itemStart=${defaultsResult.data.settings.itemStart})`,
  );
}

const planResult = PlanTemplate.safeParse(readYaml(SEED_FILES.plan));
if (!planResult.success) {
  fail(`${SEED_FILES.plan} fails PlanTemplate:\n${planResult.error.message}`);
  // Nothing further can be checked without a valid plan.
  report();
}

const items = (planResult as { success: true; data: PlanTemplate }).data.items;
note(`${SEED_FILES.plan}: OK (${items.length} items)`);

// 2. Beyond-schema checks -----------------------------------------------------

// Unique ids.
const idCounts = new Map<string, number>();
for (const it of items) idCounts.set(it.id, (idCounts.get(it.id) ?? 0) + 1);
for (const [id, count] of idCounts) if (count > 1) fail(`duplicate item id "${id}" (${count} times)`);

const byId = new Map<string, PlanTemplateItem>(items.map((it) => [it.id, it]));

// ENG root exists.
if (!byId.has("ENG")) fail(`no item with id "ENG" (the seed must contain the engagement root)`);

// Parents exist, and the parent chain has no cycle.
for (const it of items) {
  if (it.parent !== null && !byId.has(it.parent)) {
    fail(`item "${it.id}" has parent "${it.parent}", which does not exist`);
  }
}
for (const it of items) {
  const seen = new Set<string>([it.id]);
  let cur: PlanTemplateItem | undefined = it;
  while (cur?.parent) {
    if (seen.has(cur.parent)) {
      fail(`cycle in parent chain starting at "${it.id}" (revisits "${cur.parent}")`);
      break;
    }
    seen.add(cur.parent);
    cur = byId.get(cur.parent);
  }
}

// Every declared input slot is some item's declared output slot.
const outputSlotRefs = new Set<string>();
const outputSlotByRef = new Map<string, { itemId: string; format: string }>();
for (const it of items) {
  for (const out of it.outputs) {
    const ref = `${it.id}/${out.slot}`;
    outputSlotRefs.add(ref);
    outputSlotByRef.set(ref, { itemId: it.id, format: out.format });
  }
}
for (const it of items) {
  for (const inp of it.inputs) {
    if (inp.slot.includes("*")) continue; // wildcard slots arrive in I4
    if (!outputSlotRefs.has(inp.slot)) {
      fail(`item "${it.id}" declares input "${inp.slot}", which is not any item's declared output`);
    }
  }
}
note(`${outputSlotRefs.size} declared output slots across ${items.length} items`);

// Every file under assets/ matches an output slot of its item, with a matching format.
const assetsDir = path.join(seedDir, SEED_FILES.assetsDir);
let assetFileCount = 0;
try {
  for (const itemDirName of readdirSync(assetsDir)) {
    const itemAssetsPath = path.join(assetsDir, itemDirName);
    if (!statSync(itemAssetsPath).isDirectory()) {
      fail(`unexpected file directly under assets/: "${itemDirName}" (expected a per-item folder)`);
      continue;
    }
    if (!byId.has(itemDirName)) {
      fail(`assets/${itemDirName}/ does not match any item id`);
      continue;
    }
    for (const fileName of readdirSync(itemAssetsPath)) {
      assetFileCount++;
      const ext = path.extname(fileName).slice(1);
      const slot = path.basename(fileName, path.extname(fileName));
      const ref = `${itemDirName}/${slot}`;
      const outSlot = outputSlotByRef.get(ref);
      if (!outSlot) {
        fail(`assets/${itemDirName}/${fileName} does not match any output slot of "${itemDirName}"`);
      } else if (outSlot.format !== ext) {
        fail(`assets/${itemDirName}/${fileName} has extension ".${ext}", but slot "${slot}" declares format "${outSlot.format}"`);
      }
    }
  }
} catch (e) {
  fail(`could not read ${assetsDir}: ${(e as Error).message}`);
}
note(`${assetFileCount} seed asset files under assets/`);

report();

function report(): never {
  console.log("");
  if (errors.length === 0) {
    console.log(`PASS: seed "${seedId}" is valid.`);
    process.exit(0);
  } else {
    console.log(`FAIL: ${errors.length} problem(s):`);
    for (const e of errors) console.log(`  - ${e}`);
    process.exit(1);
  }
}
