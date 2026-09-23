// DB row <-> contract type mapping (CLAUDE.md conventions: epoch ms <-> ISO
// strings, booleans stored as INTEGER 0/1, JSON columns validated by the
// core Zod schemas on both read and write).

import type { IsoTime } from "@workbench/core";

export const toEpochMs = (iso: IsoTime): number => new Date(iso).getTime();
export const toIsoTime = (epochMs: number): IsoTime => new Date(epochMs).toISOString() as IsoTime;

/** JSON.parse, then validate with a Zod schema. Throws with the column name on a corrupt row. */
export function parseJsonColumn<T>(column: string, raw: string, schema: { parse(v: unknown): T }): T {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`corrupt JSON in column "${column}": ${(err as Error).message}`);
  }
  return schema.parse(parsed);
}

/** Validate with a Zod schema, then JSON.stringify. Throws before anything touches the DB if the value is invalid. */
export function toJsonColumn<T>(value: T, schema: { parse(v: unknown): T }): string {
  return JSON.stringify(schema.parse(value));
}
