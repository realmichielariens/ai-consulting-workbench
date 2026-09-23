// The seed loader (ARCHITECTURE.md §5.1, packages/core/src/seed.ts): from a
// seed folder to a validated in-memory shape, and from there to a freshly
// created engagement folder. Validation beyond the Zod schemas is ported
// from demo/scripts/validate-seed.ts (unique ids, parents exist, every
// input slot is some item's output, every seed asset matches an output slot
// and format, no sequencing/input cycles).

import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import {
  AssetVersion,
  EngagementMeta,
  ItemDef,
  PlanTemplate,
  SEED_FILES,
  SeedDefaults,
  SeedManifest,
  parseSlotRef,
  slotRef as makeSlotRef,
  type EngagementId,
  type ItemId,
  type PlanTemplateItem,
  type SlotRef,
} from "@workbench/core";
import { engagementPaths, type WorkspacePaths } from "@workbench/core/node";
import type { SeedSummary } from "@workbench/core";
import { ensureItemDirs, writeEngagementYaml, writeItemMd, writeVersionFile } from "./files.js";

export class SeedValidationError extends Error {
  constructor(
    public readonly seedDir: string,
    public readonly issues: string[],
  ) {
    super(`seed at ${seedDir} is invalid:\n${issues.map((i) => `  - ${i}`).join("\n")}`);
    this.name = "SeedValidationError";
  }
}

function readYaml(seedDir: string, file: string): unknown {
  return parseYaml(fs.readFileSync(path.join(seedDir, file), "utf8"));
}

export interface SeedAsset {
  slotRef: SlotRef;
  /** Absolute path of the source file under the seed's assets/ folder. */
  file: string;
  format: string;
}

export interface LoadedSeed {
  dir: string;
  manifest: SeedManifest;
  defaults: SeedDefaults;
  plan: PlanTemplate;
  assets: SeedAsset[];
}

/** Reads and fully validates a seed folder (schema, then the beyond-schema checks). Throws SeedValidationError. */
export function loadSeed(seedDir: string): LoadedSeed {
  const issues: string[] = [];

  const manifestResult = SeedManifest.safeParse(readYaml(seedDir, SEED_FILES.manifest));
  if (!manifestResult.success) issues.push(`${SEED_FILES.manifest}: ${manifestResult.error.message}`);

  const defaultsResult = SeedDefaults.safeParse(readYaml(seedDir, SEED_FILES.defaults));
  if (!defaultsResult.success) issues.push(`${SEED_FILES.defaults}: ${defaultsResult.error.message}`);

  const planResult = PlanTemplate.safeParse(readYaml(seedDir, SEED_FILES.plan));
  if (!planResult.success) issues.push(`${SEED_FILES.plan}: ${planResult.error.message}`);

  // Nothing further can be checked without a valid plan.
  if (!planResult.success || !manifestResult.success || !defaultsResult.success) {
    throw new SeedValidationError(seedDir, issues);
  }

  const items = planResult.data.items;
  const byId = new Map<string, PlanTemplateItem>();
  for (const it of items) {
    if (byId.has(it.id)) issues.push(`duplicate item id "${it.id}"`);
    byId.set(it.id, it);
  }

  if (!byId.has("ENG")) issues.push(`no item with id "ENG" (the seed must contain the engagement root)`);

  for (const it of items) {
    if (it.parent !== null && !byId.has(it.parent)) {
      issues.push(`item "${it.id}" has parent "${it.parent}", which does not exist`);
    }
  }
  // Parent-chain cycles.
  for (const it of items) {
    const seen = new Set<string>([it.id]);
    let cur: PlanTemplateItem | undefined = it;
    while (cur?.parent) {
      if (seen.has(cur.parent)) {
        issues.push(`cycle in parent chain starting at "${it.id}" (revisits "${cur.parent}")`);
        break;
      }
      seen.add(cur.parent);
      cur = byId.get(cur.parent);
    }
  }

  // Every declared input slot is some item's declared output slot.
  const outputSlotByRef = new Map<string, { itemId: string; format: string }>();
  for (const it of items) {
    for (const out of it.outputs) {
      outputSlotByRef.set(`${it.id}/${out.slot}`, { itemId: it.id, format: out.format });
    }
  }
  for (const it of items) {
    for (const inp of it.inputs) {
      if (inp.slot.includes("*")) continue; // wildcard slots arrive in I4
      if (!outputSlotByRef.has(inp.slot)) {
        issues.push(`item "${it.id}" declares input "${inp.slot}", which is not any item's declared output`);
      }
    }
  }

  // No cycles in the item dependency graph: sequencing edges (prereq -> item)
  // and input edges (producer -> consumer) combined.
  const deps = new Map<string, Set<string>>(); // item -> items it depends on
  const ensure = (id: string) => {
    let s = deps.get(id);
    if (!s) {
      s = new Set();
      deps.set(id, s);
    }
    return s;
  };
  for (const it of items) {
    ensure(it.id);
    for (const prereq of it.sequencing) ensure(it.id).add(prereq);
    for (const inp of it.inputs) {
      if (inp.slot.includes("*")) continue;
      const producer = outputSlotByRef.get(inp.slot);
      if (producer) ensure(it.id).add(producer.itemId);
    }
  }
  const WHITE = 0,
    GRAY = 1,
    BLACK = 2;
  const color = new Map<string, number>();
  const cyclePath: string[] = [];
  const visit = (id: string): boolean => {
    color.set(id, GRAY);
    cyclePath.push(id);
    for (const dep of deps.get(id) ?? []) {
      const c = color.get(dep) ?? WHITE;
      if (c === GRAY) {
        cyclePath.push(dep);
        return true;
      }
      if (c === WHITE && visit(dep)) return true;
    }
    cyclePath.pop();
    color.set(id, BLACK);
    return false;
  };
  for (const it of items) {
    if ((color.get(it.id) ?? WHITE) === WHITE) {
      cyclePath.length = 0;
      if (visit(it.id)) {
        issues.push(`sequencing/input dependency cycle: ${cyclePath.join(" -> ")}`);
        break;
      }
    }
  }

  // Every file under assets/ matches an output slot of its item, with a matching format.
  const assets: SeedAsset[] = [];
  const assetsDir = path.join(seedDir, SEED_FILES.assetsDir);
  if (fs.existsSync(assetsDir)) {
    for (const itemDirName of fs.readdirSync(assetsDir)) {
      const itemAssetsPath = path.join(assetsDir, itemDirName);
      if (!fs.statSync(itemAssetsPath).isDirectory()) {
        issues.push(`unexpected file directly under assets/: "${itemDirName}" (expected a per-item folder)`);
        continue;
      }
      if (!byId.has(itemDirName)) {
        issues.push(`assets/${itemDirName}/ does not match any item id`);
        continue;
      }
      for (const fileName of fs.readdirSync(itemAssetsPath)) {
        const ext = path.extname(fileName).slice(1);
        const slot = path.basename(fileName, path.extname(fileName));
        const ref = `${itemDirName}/${slot}`;
        const outSlot = outputSlotByRef.get(ref);
        if (!outSlot) {
          issues.push(`assets/${itemDirName}/${fileName} does not match any output slot of "${itemDirName}"`);
          continue;
        }
        if (outSlot.format !== ext) {
          issues.push(
            `assets/${itemDirName}/${fileName} has extension ".${ext}", but slot "${slot}" declares format "${outSlot.format}"`,
          );
          continue;
        }
        assets.push({ slotRef: ref as SlotRef, file: path.join(itemAssetsPath, fileName), format: ext });
      }
    }
  }

  if (issues.length > 0) throw new SeedValidationError(seedDir, issues);

  return { dir: seedDir, manifest: manifestResult.data, defaults: defaultsResult.data, plan: planResult.data, assets };
}

/** Lists every seed folder under `seedsDir` that loads cleanly. Broken seeds are skipped, not thrown. */
export function listSeeds(seedsDir: string): SeedSummary[] {
  if (!fs.existsSync(seedsDir)) return [];
  const out: SeedSummary[] = [];
  for (const entry of fs.readdirSync(seedsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(seedsDir, entry.name);
    try {
      const seed = loadSeed(dir);
      out.push({
        id: seed.manifest.id,
        title: seed.manifest.title,
        description: seed.manifest.description,
        engagementName: seed.manifest.engagementName,
        itemCount: seed.plan.items.length,
      });
    } catch {
      // Skip folders that don't validate; listSeeds is for the start page,
      // not a validator (that's loadSeed / demo/scripts/validate-seed.ts).
      continue;
    }
  }
  return out;
}

function pickEngagementId(workspace: WorkspacePaths, seedId: string): EngagementId {
  let candidate = seedId;
  let n = 2;
  while (fs.existsSync(workspace.engagement(candidate))) {
    candidate = `${seedId}-${n}`;
    n += 1;
  }
  return candidate as EngagementId;
}

export interface CreateEngagementFromSeedInput {
  workspace: WorkspacePaths;
  seedDir: string;
  name: string;
}

export interface CreateEngagementFromSeedResult {
  engagementId: EngagementId;
  root: string;
  defs: ItemDef[];
  seededVersions: AssetVersion[];
}

/**
 * Seed -> engagement folder: engagement.yaml, every items/<id>/item.md, the
 * work/ and assets/ dirs, and the seed's assets published as immutable v1.0
 * version files. Does NOT touch the DB or git — the caller (the server, or
 * `pnpm seed:try`) does that, since only it knows whether a DB transaction
 * or a git checkpoint should follow.
 */
export function createEngagementFromSeed(input: CreateEngagementFromSeedInput): CreateEngagementFromSeedResult {
  const seed = loadSeed(input.seedDir);
  const engagementId = pickEngagementId(input.workspace, seed.manifest.id);
  const root = input.workspace.engagement(engagementId);
  const paths = engagementPaths(root);
  fs.mkdirSync(paths.itemsDir, { recursive: true });

  const nowIso = new Date().toISOString() as unknown as string;
  const meta = EngagementMeta.parse({
    id: engagementId,
    name: input.name,
    createdAt: nowIso,
    seed: { id: seed.manifest.id, title: seed.manifest.title },
    settings: seed.defaults.settings,
    planVersion: 1,
  });
  writeEngagementYaml(paths, meta);

  const defs: ItemDef[] = [];
  for (const item of seed.plan.items) {
    // Trimmed once here so the returned ItemDef exactly matches what
    // writeItemMd puts on disk (it also trims/normalizes the brief) — the
    // server should never see a def whose brief disagrees with its file.
    const def = ItemDef.parse({ ...item, brief: item.brief.trim() });
    ensureItemDirs(paths, def.id as ItemId);
    writeItemMd(paths.itemMd(def.id as ItemId), def);
    defs.push(def);
  }

  const seededVersions: AssetVersion[] = [];
  for (const asset of seed.assets) {
    const relPath = writeVersionFile(paths, asset.slotRef, "1.0", asset.format, { fromFile: asset.file });
    const { itemId, slot } = parseSlotRef(asset.slotRef);
    seededVersions.push(
      AssetVersion.parse({
        slot: makeSlotRef(itemId, slot),
        version: "1.0",
        major: 1,
        minor: 0,
        kind: "material",
        author: "human",
        at: nowIso,
        note: `From seed ${seed.manifest.id}`,
        runId: null,
        path: relPath,
        format: asset.format,
      }),
    );
  }

  return { engagementId, root, defs, seededVersions };
}
