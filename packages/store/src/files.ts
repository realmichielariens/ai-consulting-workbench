// The file store: item.md read/write, the append-only worklog, immutable
// version files, engagement.yaml, and a per-engagement serialized write
// queue. Every path is built through the layout helpers (ARCHITECTURE.md
// §5), never by string concatenation.

import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import {
  EngagementMeta,
  ItemDef,
  type Actor,
  type IsoTime,
  type ItemId,
  type SlotRef,
  type Version,
} from "@workbench/core";
import type { EngagementPaths } from "@workbench/core/node";

// ---------------------------------------------------------------------------
// item.md (gray-matter front-matter + the brief as the body)
// ---------------------------------------------------------------------------

/**
 * The heading we write above the brief body, so a human opening item.md in
 * an editor sees a clearly labelled section rather than bare prose after the
 * front-matter fence. Stripped back off on read, so `readItemMd(writeItemMd(...))`
 * round-trips to the same `ItemDef`.
 */
const BRIEF_HEADING = "## Brief";

/** Deterministic front-matter key order, matching ItemFrontMatter's field order. */
function frontMatterOf(def: ItemDef) {
  return {
    id: def.id,
    title: def.title,
    parent: def.parent,
    order: def.order,
    executor: def.executor,
    inputs: def.inputs,
    sequencing: def.sequencing,
    outputs: def.outputs,
    skills: def.skills,
    sources: def.sources,
    gate: def.gate,
    autostart: def.autostart,
    acceptance: def.acceptance,
  };
}

export function writeItemMd(file: string, def: ItemDef): void {
  const body = `${BRIEF_HEADING}\n\n${def.brief.trim()}\n`;
  // lineWidth: -1 disables js-yaml's line folding, so long acceptance criteria
  // and briefs stay on one physical line (stable, diff-friendly, and avoids
  // any ambiguity in folded-scalar round-tripping).
  const out = matter.stringify(body, frontMatterOf(def), { lineWidth: -1 } as Record<string, unknown>);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, out, "utf8");
}

export function readItemMd(file: string): ItemDef {
  const raw = fs.readFileSync(file, "utf8");
  const parsed = matter(raw);
  let body = parsed.content.trim();
  if (body.startsWith(BRIEF_HEADING)) {
    body = body.slice(BRIEF_HEADING.length).replace(/^[ \t]*\r?\n/, "").trim();
  }
  return ItemDef.parse({ ...(parsed.data as Record<string, unknown>), brief: body });
}

// ---------------------------------------------------------------------------
// worklog.md (append-only)
// ---------------------------------------------------------------------------

export interface WorklogEntryInput {
  actor: Actor;
  at: IsoTime;
  entry: string;
}

/** "YYYY-MM-DD HH:mm:ss" in local time (not locale-dependent, unlike toLocaleString). */
function formatLocalTime(at: IsoTime): string {
  const d = new Date(at);
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

export function appendWorklog(paths: EngagementPaths, itemId: ItemId, input: WorklogEntryInput): void {
  const file = paths.worklog(itemId);
  fs.mkdirSync(path.dirname(file), { recursive: true });

  if (!fs.existsSync(file)) {
    const def = readItemMd(paths.itemMd(itemId));
    fs.writeFileSync(file, `# Worklog — ${def.id} ${def.title}\n\n`, "utf8");
  }

  const section = `### ${formatLocalTime(input.at)} — ${input.actor}\n\n${input.entry.trim()}\n\n`;
  fs.appendFileSync(file, section, "utf8");
}

// ---------------------------------------------------------------------------
// approach-journal.md (I2, D4): the Approach Agent's own append-only journal,
// separate from any one item's worklog since it is not scoped to an item.
// ---------------------------------------------------------------------------

export function appendJournal(paths: EngagementPaths, input: WorklogEntryInput): void {
  const file = path.join(paths.itemWork("ENG"), "approach-journal.md");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, "# Approach Agent journal\n\n", "utf8");
  }
  const section = `### ${formatLocalTime(input.at)} — ${input.actor}\n\n${input.entry.trim()}\n\n`;
  fs.appendFileSync(file, section, "utf8");
}

export function readJournal(paths: EngagementPaths): string {
  const file = path.join(paths.itemWork("ENG"), "approach-journal.md");
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
}

// ---------------------------------------------------------------------------
// Immutable version files
// ---------------------------------------------------------------------------

export type VersionFileSource = { fromFile: string } | { bytes: Buffer };

/**
 * Writes assets/<slot>/vX.Y.<ext>. Immutable by construction: opened with the
 * exclusive flag ("wx"), so a second write of the same version throws rather
 * than silently overwriting published content.
 */
export function writeVersionFile(
  paths: EngagementPaths,
  slotRef: SlotRef,
  version: Version,
  format: string,
  source: VersionFileSource,
): string {
  const dir = paths.slotDir(slotRef);
  fs.mkdirSync(dir, { recursive: true });
  const dest = paths.versionFile(slotRef, version, format);
  const data = "bytes" in source ? source.bytes : fs.readFileSync(source.fromFile);

  let fd: number;
  try {
    fd = fs.openSync(dest, "wx");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error(
        `version file already exists (published versions are immutable): ${paths.versionFileRel(slotRef, version, format)}`,
      );
    }
    throw e;
  }
  try {
    fs.writeSync(fd, data);
  } finally {
    fs.closeSync(fd);
  }
  return paths.versionFileRel(slotRef, version, format);
}

export function readVersion(paths: EngagementPaths, slotRef: SlotRef, version: Version, format: string): Buffer {
  return fs.readFileSync(paths.versionFile(slotRef, version, format));
}

export function readVersionText(paths: EngagementPaths, slotRef: SlotRef, version: Version, format: string): string {
  return readVersion(paths, slotRef, version, format).toString("utf8");
}

// ---------------------------------------------------------------------------
// Item directories
// ---------------------------------------------------------------------------

export function ensureItemDirs(paths: EngagementPaths, itemId: ItemId): void {
  fs.mkdirSync(paths.itemDir(itemId), { recursive: true });
  fs.mkdirSync(paths.itemWork(itemId), { recursive: true });
  fs.mkdirSync(paths.itemAssets(itemId), { recursive: true });
}

// ---------------------------------------------------------------------------
// engagement.yaml
// ---------------------------------------------------------------------------

function engagementMetaOf(meta: EngagementMeta) {
  return {
    id: meta.id,
    name: meta.name,
    createdAt: meta.createdAt,
    seed: meta.seed,
    settings: meta.settings,
    planVersion: meta.planVersion,
  };
}

export function writeEngagementYaml(paths: EngagementPaths, meta: EngagementMeta): void {
  const out = stringifyYaml(engagementMetaOf(meta), { lineWidth: 0 });
  fs.mkdirSync(path.dirname(paths.engagementYaml), { recursive: true });
  fs.writeFileSync(paths.engagementYaml, out, "utf8");
}

export function readEngagementYaml(paths: EngagementPaths): EngagementMeta {
  const raw = fs.readFileSync(paths.engagementYaml, "utf8");
  return EngagementMeta.parse(parseYaml(raw));
}

// ---------------------------------------------------------------------------
// Per-engagement serialized write queue
// ---------------------------------------------------------------------------

export interface WriteQueue {
  /** Runs `fn` after every previously queued job has settled, so writes never interleave. */
  run<T>(fn: () => Promise<T> | T): Promise<T>;
}

export function createWriteQueue(): WriteQueue {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    run<T>(fn: () => Promise<T> | T): Promise<T> {
      const result = tail.then(fn);
      // The queue chain must never reject, or every later job would be
      // skipped; each job's own rejection still reaches its caller via the
      // returned promise.
      tail = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
  };
}
