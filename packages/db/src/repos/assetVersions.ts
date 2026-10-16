// Version registry (ARCHITECTURE.md §6.2). Content lives in the immutable
// file at `path`; this table is the queryable index (latest per slot, all
// published slots for readiness, …).

import { and, desc, eq } from "drizzle-orm";
import { AssetVersion, formatVersion, type SlotRef } from "@workbench/core";
import type { Db } from "../client.js";
import { assetVersions } from "../schema.js";
import { toEpochMs, toIsoTime } from "../mappers.js";

function mapRow(row: typeof assetVersions.$inferSelect): AssetVersion {
  return AssetVersion.parse({
    slot: row.slotRef,
    version: formatVersion(row.major, row.minor),
    major: row.major,
    minor: row.minor,
    kind: row.kind,
    author: row.author,
    at: toIsoTime(row.at),
    note: row.note,
    runId: row.runId,
    path: row.path,
    format: row.format,
  });
}

/**
 * Fails on a duplicate (slot, major, minor) — versioning.ts's nextVersion is
 * the only legitimate source of a new (major, minor) pair, so a conflict
 * means two publishes raced past the caller's own serialization.
 */
export function insertAssetVersion(ctx: Db, v: AssetVersion): void {
  ctx.db
    .insert(assetVersions)
    .values({
      slotRef: v.slot,
      major: v.major,
      minor: v.minor,
      kind: v.kind,
      author: v.author,
      at: toEpochMs(v.at),
      note: v.note,
      runId: v.runId,
      path: v.path,
      format: v.format,
    })
    .run();
}

/** Newest first (by major desc, minor desc). */
export function listVersions(ctx: Db, slot: SlotRef): AssetVersion[] {
  return ctx.db
    .select()
    .from(assetVersions)
    .where(eq(assetVersions.slotRef, slot))
    .orderBy(desc(assetVersions.major), desc(assetVersions.minor))
    .all()
    .map(mapRow);
}

export function latestVersion(ctx: Db, slot: SlotRef): AssetVersion | null {
  const row = ctx.db
    .select()
    .from(assetVersions)
    .where(eq(assetVersions.slotRef, slot))
    .orderBy(desc(assetVersions.major), desc(assetVersions.minor))
    .limit(1)
    .get();
  return row ? mapRow(row) : null;
}

export function getVersion(ctx: Db, slot: SlotRef, major: number, minor: number): AssetVersion | null {
  const row = ctx.db
    .select()
    .from(assetVersions)
    .where(and(eq(assetVersions.slotRef, slot), eq(assetVersions.major, major), eq(assetVersions.minor, minor)))
    .get();
  return row ? mapRow(row) : null;
}

/** One row per slot: its latest version. Feeds the plan view (api.ts SlotNode.latest) and readiness. */
export function listLatestPerSlot(ctx: Db): Map<SlotRef, AssetVersion> {
  const all = ctx.db.select().from(assetVersions).all();
  const latest = new Map<SlotRef, AssetVersion>();
  for (const row of all) {
    const slot = row.slotRef as SlotRef;
    const current = latest.get(slot);
    if (!current || row.major > current.major || (row.major === current.major && row.minor > current.minor)) {
      latest.set(slot, mapRow(row));
    }
  }
  return latest;
}

/** Slots with at least one published version — the input readiness.ts's computeReadiness needs. */
export function publishedSlots(ctx: Db): Set<SlotRef> {
  return new Set(listLatestPerSlot(ctx).keys());
}

/** All `{major, minor}` pairs for a slot, for versioning.ts's nextVersion. */
export function listVersionParts(ctx: Db, slot: SlotRef): { major: number; minor: number }[] {
  return ctx.db
    .select({ major: assetVersions.major, minor: assetVersions.minor })
    .from(assetVersions)
    .where(eq(assetVersions.slotRef, slot))
    .all();
}
