// Index of item.md definitions plus authoritative status (ARCHITECTURE.md
// §6.2). Definition columns (everything but `status` and `lastSessionId`)
// are rebuilt from the files at every reconciliation via upsertDefinitions;
// `status` is authoritative in the DB and is only ever changed by setStatus,
// which the caller drives from rules/lifecycle.ts's applyItemEvent result.

import { createHash } from "node:crypto";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import {
  itemKindOf,
  initialStatus,
  GateChain as GateChainSchema,
  type Executor,
  type GateChain,
  type InputRef,
  type ItemDef,
  type ItemId,
  type ItemKind,
  type ItemStatus,
  type OutputSlot,
  type SlotRef,
} from "@workbench/core";
import type { Db } from "../client.js";
import { itemInputs, itemOutputs, items, itemSequencing } from "../schema.js";
import { toJsonColumn, parseJsonColumn } from "../mappers.js";

export interface ItemRow {
  id: ItemId;
  parent: ItemId | null;
  ord: number;
  kind: ItemKind;
  executor: Executor | null;
  title: string;
  status: ItemStatus | null;
  autostart: boolean;
  gate: GateChain;
  skills: string[];
  defHash: string;
  lastSessionId: string | null;
  updatedAt: number;
}

const skillsSchema = { parse: (v: unknown) => v as string[] }; // plain string[], no domain schema needed

function mapRow(row: typeof items.$inferSelect): ItemRow {
  return {
    id: row.id,
    parent: row.parent,
    ord: row.ord,
    kind: row.kind as ItemKind,
    executor: row.executor as Executor | null,
    title: row.title,
    status: row.status as ItemStatus | null,
    autostart: row.autostart,
    gate: parseJsonColumn("gate", row.gate, GateChainSchema),
    skills: parseJsonColumn("skills", row.skills, skillsSchema),
    defHash: row.defHash,
    lastSessionId: row.lastSessionId,
    updatedAt: row.updatedAt,
  };
}

/** Stable across key order, so two defs that differ only in field order hash equal. */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function hashItemDef(def: ItemDef): string {
  return createHash("sha256").update(stableStringify(def)).digest("hex");
}

/**
 * Rewrites the definition columns for every def, preserving `status` and
 * `lastSessionId` on items that already exist (ON CONFLICT's SET list omits
 * them). A brand-new item gets `initialStatus(def)` (rules/readiness.ts).
 * item_inputs/outputs/sequencing are replaced wholesale per item, so a
 * removed input/output/sequencing edge in item.md disappears from the DB too.
 */
export function upsertDefinitions(ctx: Db, defs: readonly ItemDef[], updatedAt: number): void {
  ctx.sqlite.transaction(() => {
    for (const def of defs) {
      const defHash = hashItemDef(def);
      const kind = itemKindOf(def);
      const status = initialStatus(def);

      ctx.db
        .insert(items)
        .values({
          id: def.id,
          parent: def.parent,
          ord: def.order,
          kind,
          executor: def.executor,
          title: def.title,
          status,
          autostart: def.autostart,
          gate: toJsonColumn(def.gate, GateChainSchema),
          skills: toJsonColumn(def.skills, skillsSchema),
          defHash,
          lastSessionId: null,
          updatedAt,
        })
        .onConflictDoUpdate({
          target: items.id,
          set: {
            parent: def.parent,
            ord: def.order,
            kind,
            executor: def.executor,
            title: def.title,
            autostart: def.autostart,
            gate: toJsonColumn(def.gate, GateChainSchema),
            skills: toJsonColumn(def.skills, skillsSchema),
            defHash,
            updatedAt,
            // status and lastSessionId intentionally omitted: DB is authoritative for those.
          },
        })
        .run();

      ctx.db.delete(itemInputs).where(eq(itemInputs.itemId, def.id)).run();
      for (const input of def.inputs) {
        ctx.db.insert(itemInputs).values({ itemId: def.id, slotRef: input.slot, required: input.required, pin: input.pin ?? null }).run();
      }

      ctx.db.delete(itemOutputs).where(eq(itemOutputs.itemId, def.id)).run();
      for (const output of def.outputs) {
        ctx.db
          .insert(itemOutputs)
          .values({
            itemId: def.id,
            slot: output.slot,
            slotRef: `${def.id}/${output.slot}`,
            format: output.format,
            scope: output.scope,
            required: output.required,
            description: output.description,
          })
          .run();
      }

      ctx.db.delete(itemSequencing).where(eq(itemSequencing.itemId, def.id)).run();
      for (const after of def.sequencing) {
        ctx.db.insert(itemSequencing).values({ itemId: def.id, afterItemId: after }).run();
      }
    }
  })();
}

export function setStatus(ctx: Db, id: ItemId, status: ItemStatus | null, updatedAt: number): void {
  ctx.db.update(items).set({ status, updatedAt }).where(eq(items.id, id)).run();
}

export function setLastSession(ctx: Db, id: ItemId, sessionId: string | null, updatedAt: number): void {
  ctx.db.update(items).set({ lastSessionId: sessionId, updatedAt }).where(eq(items.id, id)).run();
}

export function getItem(ctx: Db, id: ItemId): ItemRow | null {
  const row = ctx.db.select().from(items).where(eq(items.id, id)).get();
  return row ? mapRow(row) : null;
}

export function listItems(ctx: Db): ItemRow[] {
  return ctx.db.select().from(items).orderBy(asc(items.ord)).all().map(mapRow);
}

export function listChildren(ctx: Db, parent: ItemId | null): ItemRow[] {
  const where = parent === null ? isNull(items.parent) : eq(items.parent, parent);
  return ctx.db.select().from(items).where(where).orderBy(asc(items.ord)).all().map(mapRow);
}

/** Human items ready for input or already being worked (J1.6, the inbox.ts building block). */
export function listHumanReadyOrInProgress(ctx: Db): ItemRow[] {
  return ctx.db
    .select()
    .from(items)
    .where(and(eq(items.executor, "human"), inArray(items.status, ["ready", "in_progress"])))
    .orderBy(asc(items.ord))
    .all()
    .map(mapRow);
}

export interface InputRow {
  itemId: ItemId;
  slot: SlotRef;
  required: boolean;
  pin: string | null;
}

export function listInputs(ctx: Db, itemId: ItemId): InputRow[] {
  return ctx.db
    .select()
    .from(itemInputs)
    .where(eq(itemInputs.itemId, itemId))
    .all()
    .map((r) => ({ itemId: r.itemId, slot: r.slotRef as SlotRef, required: r.required, pin: r.pin }));
}

export function listAllInputs(ctx: Db): InputRow[] {
  return ctx.db
    .select()
    .from(itemInputs)
    .all()
    .map((r) => ({ itemId: r.itemId, slot: r.slotRef as SlotRef, required: r.required, pin: r.pin }));
}

export interface OutputRow {
  itemId: ItemId;
  slot: string;
  slotRef: SlotRef;
  format: string;
  scope: OutputSlot["scope"];
  required: boolean;
  description: string;
}

export function listOutputs(ctx: Db, itemId: ItemId): OutputRow[] {
  return ctx.db
    .select()
    .from(itemOutputs)
    .where(eq(itemOutputs.itemId, itemId))
    .all()
    .map((r) => ({ ...r, slotRef: r.slotRef as SlotRef, scope: r.scope as OutputSlot["scope"] }));
}

export function listAllOutputs(ctx: Db): OutputRow[] {
  return ctx.db
    .select()
    .from(itemOutputs)
    .all()
    .map((r) => ({ ...r, slotRef: r.slotRef as SlotRef, scope: r.scope as OutputSlot["scope"] }));
}

export function listSequencing(ctx: Db, itemId: ItemId): ItemId[] {
  return ctx.db
    .select()
    .from(itemSequencing)
    .where(eq(itemSequencing.itemId, itemId))
    .all()
    .map((r) => r.afterItemId);
}

export function listAllSequencing(ctx: Db): { itemId: ItemId; afterItemId: ItemId }[] {
  return ctx.db.select().from(itemSequencing).all();
}

/** InputRef[] shape as declared on an item.md front-matter, e.g. for rebuilding a BriefView. */
export function inputRowsToRefs(rows: readonly InputRow[]): InputRef[] {
  return rows.map((r) => ({ slot: r.slot, required: r.required, pin: r.pin ?? undefined }));
}
