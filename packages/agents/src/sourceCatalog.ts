// Loads the Source Catalog (core sources.ts): one listing per *.yaml in the
// catalog folder, mock datasets under data/, plus the user's own listings
// (WorkspacePaths.userSourcesDir, docs/USER-MCP-SOURCES-PLAN.md). Read fresh on every run (a few
// small files) so an edited listing is picked up without a server restart. A
// malformed listing is skipped and reported, never fatal: one bad file in a
// marketplace must not stop every run.

import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { SourceDataset, SourceDef, type SourceOrigin, type SourceRecord } from "@workbench/core";

/** A loaded listing: its definition, which folder it came from, and its file (the server edits user listings in place). */
export type CatalogSource = SourceDef & { origin: SourceOrigin; file: string };

export interface SourceCatalog {
  /** The curated catalog folder; mock datasets come only from its data/ folder. */
  dir: string;
  /** The user's own listings (WorkspacePaths.userSourcesDir), when loaded. */
  userDir?: string;
  sources: CatalogSource[];
  /** "<file>: <reason>" for each listing that failed validation (user files are prefixed "sources/"). */
  invalid: string[];
}

export interface LoadSourceCatalogOptions {
  catalogDir: string;
  userDir?: string;
}

interface RawListing {
  file: string;
  label: string;
  def: SourceDef;
}

function readListings(dir: string, labelPrefix: string, invalid: string[]): RawListing[] {
  if (!fs.existsSync(dir)) return [];
  const out: RawListing[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !/\.ya?ml$/i.test(entry.name)) continue;
    const file = path.join(dir, entry.name);
    const label = `${labelPrefix}${entry.name}`;
    try {
      const parsed = SourceDef.safeParse(parseYaml(fs.readFileSync(file, "utf8")));
      if (parsed.success) out.push({ file, label, def: parsed.data });
      else invalid.push(`${label}: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
    } catch (err) {
      invalid.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  // Directory order differs per OS; sorting makes "the first one wins" for duplicate user ids deterministic.
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

export function loadSourceCatalog(opts: LoadSourceCatalogOptions): SourceCatalog {
  const invalid: string[] = [];
  const sources: CatalogSource[] = readListings(opts.catalogDir, "", invalid).map(({ file, def }) => ({ ...def, origin: "catalog", file }));
  const ids = new Set(sources.map((s) => s.id));

  if (opts.userDir) {
    for (const { file, label, def } of readListings(opts.userDir, "sources/", invalid)) {
      // A user listing may never shadow a curated one (or another user listing): bindings name sources by id.
      if (ids.has(def.id)) {
        invalid.push(`${label}: id "${def.id}" is already used by another listing`);
        continue;
      }
      // mock datasets and the built-in web tools are curated features, not something a user listing can claim.
      if (def.connection.type === "mock" || def.connection.type === "builtin-web") {
        invalid.push(`${label}: connection type "${def.connection.type}" is reserved for the curated catalog; use stdio or http`);
        continue;
      }
      ids.add(def.id);
      sources.push({ ...def, origin: "user", file });
    }
  }

  sources.sort((a, b) => a.title.localeCompare(b.title));
  return { dir: opts.catalogDir, userDir: opts.userDir, sources, invalid };
}

/**
 * Writes one listing as YAML (the server's sourceService, for the user's own
 * folder). Here rather than in the server because this module owns the format.
 */
export function writeSourceListing(file: string, def: SourceDef): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, stringifyYaml(SourceDef.parse(def), { lineWidth: 0 }), "utf8");
}

/** The records behind a `mock` listing. The dataset name may not leave the catalog's data/ folder. */
export function loadSourceDataset(catalogDir: string, dataset: string): SourceRecord[] {
  const dataDir = path.join(catalogDir, "data");
  const file = path.resolve(dataDir, dataset);
  if (path.relative(dataDir, file).startsWith("..")) throw new Error(`dataset ${dataset} is outside the catalog's data/ folder`);
  return SourceDataset.parse(parseYaml(fs.readFileSync(file, "utf8"))).records;
}

/**
 * The catalog as Markdown for the Approach Agent's system prompt: enough to
 * choose (what it is, live or fixed, free or licensed), not how to connect.
 */
export function renderSourceCatalog(sources: ReadonlyArray<SourceDef & { origin?: SourceOrigin }>): string {
  if (sources.length === 0) return "(the Source Catalog is empty)";
  return sources
    .map((s) => {
      const freshness = s.freshness === "live" ? "live — changes over time" : `fixed edition ${s.edition ?? ""}`.trim();
      const added = s.origin === "user" ? " (added by you)" : "";
      return `- \`${s.id}\` **${s.title}**${added} (${s.publisher}; ${freshness}; ${s.offer.label}): ${s.summary}`;
    })
    .join("\n");
}
