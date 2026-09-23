// meta: key/value metadata, and atomic id counters (ARCHITECTURE.md §6.2).
// The counter increment uses a single hand-written UPSERT with RETURNING
// (better-sqlite3 supports RETURNING on sqlite >= 3.35), which SQLite
// executes as its own implicit transaction — atomic even against another
// connection to the same WAL file, without needing BEGIN IMMEDIATE (unlike
// the lease race in leases.ts, there is nothing to "win"; every caller gets
// a distinct, ever-increasing number).

import type { RequestId, RunId } from "@workbench/core";
import type { Db } from "./client.js";

export function getMeta(ctx: Db, key: string): string | null {
  const row = ctx.sqlite.prepare("SELECT value FROM meta WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setMeta(ctx: Db, key: string, value: string): void {
  ctx.sqlite
    .prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(key, value);
}

/** Next integer for `counterKey`, starting at 1. */
function nextCounter(ctx: Db, counterKey: string): number {
  const row = ctx.sqlite
    .prepare(
      `INSERT INTO meta (key, value) VALUES (@key, '1')
       ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT)
       RETURNING value`,
    )
    .get({ key: counterKey }) as { value: string };
  return Number(row.value);
}

const pad = (n: number, width = 4): string => String(n).padStart(width, "0");

/** "R-0001", "R-0002", … (domain.ts RunId: /^R-\d{4,}$/). */
export function nextRunId(ctx: Db): RunId {
  return `R-${pad(nextCounter(ctx, "next_run_seq"))}` as RunId;
}

/** "RQ-0001", "RQ-0002", … (domain.ts RequestId: /^RQ-\d{4,}$/). */
export function nextRequestId(ctx: Db): RequestId {
  return `RQ-${pad(nextCounter(ctx, "next_request_seq"))}` as RequestId;
}

/** engagement.yaml's planVersion is authoritative for the file/UI; this mirror lets DB-only code (e.g. reconciliation) read it without touching the filesystem. */
export function getPlanVersion(ctx: Db): number {
  const v = getMeta(ctx, "plan_version");
  return v == null ? 1 : Number(v);
}

export function setPlanVersion(ctx: Db, version: number): void {
  setMeta(ctx, "plan_version", String(version));
}
