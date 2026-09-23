// Session leases (ARCHITECTURE.md §8.4, §15; M0 S8, spike/experiments/s08-sqlite).
// Acquire with BEGIN IMMEDIATE + a conditional UPSERT (lease_until < now):
// BEGIN IMMEDIATE takes the write lock up front, so under WAL + busy_timeout
// a second connection racing for the same scope_key blocks and retries
// instead of racing a read-then-write. `db.transaction()` (Drizzle) only
// issues a plain BEGIN (ARCHITECTURE.md §15), so this manages the
// transaction on the raw better-sqlite3 handle by hand, exactly as S8
// validated (200/200 rounds, exactly one winner, across 5 processes).
//
// Keyed by scope_key (schema.ts), not session id: the lease is taken before
// a new session has an id. `holder` identifies who is holding it (a run id
// for `work:<itemId>` scopes in I1); it is unique when non-null, so a
// LocusViolation-style double-hold is impossible even by accident.

import { and, eq, isNotNull, lt } from "drizzle-orm";
import type { Db } from "../client.js";
import { sessions } from "../schema.js";

export type SessionStatus = "idle" | "active" | "interrupted";

export interface SessionRow {
  scopeKey: string;
  role: string;
  holder: string | null;
  sessionId: string | null;
  leaseUntil: number | null;
  pid: number | null;
  status: SessionStatus;
  updatedAt: number;
}

const mapRow = (row: typeof sessions.$inferSelect): SessionRow => ({ ...row, status: row.status as SessionStatus });

export interface AcquireLeaseInput {
  scopeKey: string;
  role: string;
  /** Identifies the new holder (a run id for work items in I1). */
  holder: string;
  leaseMs: number;
  now: number;
}

export interface AcquireLeaseResult {
  acquired: boolean;
  /** The current row, whoever holds it (useful for the "already running" message even when acquired=false). */
  row: SessionRow;
}

/**
 * Wins iff no row exists yet for scope_key, or the existing lease has
 * expired (lease_until < now). A live lease refuses the request — the
 * caller shows "already running" (R6) instead of interrupting anyone.
 */
export function acquireLease(ctx: Db, input: AcquireLeaseInput): AcquireLeaseResult {
  const leaseUntil = input.now + input.leaseMs;
  let changes = 0;

  ctx.sqlite.exec("BEGIN IMMEDIATE");
  try {
    const info = ctx.sqlite
      .prepare(
        `INSERT INTO sessions (scope_key, role, holder, session_id, lease_until, pid, status, updated_at)
         VALUES (@scopeKey, @role, @holder, NULL, @leaseUntil, NULL, 'active', @now)
         ON CONFLICT(scope_key) DO UPDATE SET
           role = excluded.role,
           holder = excluded.holder,
           session_id = NULL,
           lease_until = excluded.lease_until,
           pid = NULL,
           status = 'active',
           updated_at = excluded.updated_at
         WHERE sessions.lease_until IS NULL OR sessions.lease_until < @now`,
      )
      .run({ scopeKey: input.scopeKey, role: input.role, holder: input.holder, leaseUntil, now: input.now });
    changes = info.changes;
    ctx.sqlite.exec("COMMIT");
  } catch (err) {
    ctx.sqlite.exec("ROLLBACK");
    throw err;
  }

  const row = getSession(ctx, input.scopeKey);
  if (!row) throw new Error(`acquireLease: row for ${input.scopeKey} vanished after upsert`);
  return { acquired: changes === 1, row };
}

/** The holder renews its own lease before it expires. No-op (0 changes) if it is no longer the holder (e.g. it already expired and was stolen). */
export function renewLease(ctx: Db, scopeKey: string, holder: string, leaseMs: number, now: number): boolean {
  const info = ctx.db
    .update(sessions)
    .set({ leaseUntil: now + leaseMs, updatedAt: now })
    .where(and(eq(sessions.scopeKey, scopeKey), eq(sessions.holder, holder)))
    .run();
  return info.changes > 0;
}

export function setSessionId(ctx: Db, scopeKey: string, sessionId: string, now: number): void {
  ctx.db.update(sessions).set({ sessionId, updatedAt: now }).where(eq(sessions.scopeKey, scopeKey)).run();
}

export function setPid(ctx: Db, scopeKey: string, pid: number, now: number): void {
  ctx.db.update(sessions).set({ pid, updatedAt: now }).where(eq(sessions.scopeKey, scopeKey)).run();
}

export function setStatus(ctx: Db, scopeKey: string, status: SessionStatus, now: number): void {
  ctx.db.update(sessions).set({ status, updatedAt: now }).where(eq(sessions.scopeKey, scopeKey)).run();
}

/** Releases the lease (only if `holder` still matches — an already-stolen or already-released lease is left alone). */
export function releaseLease(ctx: Db, scopeKey: string, holder: string, now: number): boolean {
  const info = ctx.db
    .update(sessions)
    .set({ holder: null, leaseUntil: null, pid: null, status: "idle", updatedAt: now })
    .where(and(eq(sessions.scopeKey, scopeKey), eq(sessions.holder, holder)))
    .run();
  return info.changes > 0;
}

export function getSession(ctx: Db, scopeKey: string): SessionRow | null {
  const row = ctx.db.select().from(sessions).where(eq(sessions.scopeKey, scopeKey)).get();
  return row ? mapRow(row) : null;
}

/** Active leases past their expiry — startup reconciliation clears these and marks their runs interrupted (R1). */
export function listExpired(ctx: Db, now: number): SessionRow[] {
  return ctx.db
    .select()
    .from(sessions)
    .where(and(eq(sessions.status, "active"), lt(sessions.leaseUntil, now)))
    .all()
    .map(mapRow);
}

/** Every session with a recorded child PID — the startup orphan cleanup kills whichever are still alive (R2). */
export function listWithPid(ctx: Db): SessionRow[] {
  return ctx.db.select().from(sessions).where(isNotNull(sessions.pid)).all().map(mapRow);
}

export function listAll(ctx: Db): SessionRow[] {
  return ctx.db.select().from(sessions).all().map(mapRow);
}
