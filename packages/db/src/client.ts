// Opens one engagement's SQLite file (ARCHITECTURE.md §6.2, §15). Ported
// settings from spike/experiments/s08-sqlite (M0 S8, FINDINGS.md): WAL mode,
// a busy_timeout so concurrent connections queue instead of failing with
// SQLITE_BUSY, and migrations run through drizzle's better-sqlite3 migrator
// on every open (idempotent: it only applies migrations not yet recorded in
// drizzle's own `__drizzle_migrations` table).
//
// `sqlite` (the raw better-sqlite3 handle) is exposed alongside `db` (the
// Drizzle wrapper) because leases need `BEGIN IMMEDIATE` and the id counters
// need `RETURNING` on a hand-written UPSERT — `db.transaction()` only issues
// a plain `BEGIN` (ARCHITECTURE.md §15), and Drizzle's query builder has no
// `INSERT ... ON CONFLICT ... RETURNING` in one call for a computed column.

import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as schema from "./schema.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** packages/db/migrations, regardless of whether this file runs from src/ (tsx/vitest) or is resolved as source. */
const MIGRATIONS_FOLDER = path.join(__dirname, "..", "migrations");

export type DrizzleDb = BetterSQLite3Database<typeof schema>;

export interface Db {
  readonly sqlite: Database.Database;
  readonly db: DrizzleDb;
  close(): void;
}

export interface OpenEngagementDbOptions {
  /** Milliseconds better-sqlite3 waits on a lock before throwing SQLITE_BUSY. Default 5000 (M0 S8). */
  busyTimeoutMs?: number;
}

export function openEngagementDb(file: string, options: OpenEngagementDbOptions = {}): Db {
  const sqlite = new Database(file);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma(`busy_timeout = ${options.busyTimeoutMs ?? 5000}`);

  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

  return {
    sqlite,
    db,
    close: () => sqlite.close(),
  };
}

/** PRAGMA wal_checkpoint(TRUNCATE): required before every Git commit (ARCHITECTURE.md §11, M0 S8) — otherwise the commit can be silently empty because WAL-only writes never reached the main DB file. */
export function walCheckpoint(ctx: Db): void {
  ctx.sqlite.pragma("wal_checkpoint(TRUNCATE)");
}
