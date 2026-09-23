// Drizzle ORM schema for the S8 subset of ARCHITECTURE.md §6.2:
// requests, agenda_items, sessions (leases), asset_versions, consumptions.
// Plus a plain `events` table used only for the S8 performance smoke test
// (§4 step 6), and matching hand-written DDL (`DDL_SQL`) applied directly
// via db.exec() — this is the "for real" check that a hand-authored
// Drizzle schema and a hand-authored CREATE TABLE agree, without pulling
// in drizzle-kit's push/migrate machinery for a 5-table spike schema.

import { sqliteTable, text, integer, primaryKey } from "drizzle-orm/sqlite-core";

export const sessions = sqliteTable("sessions", {
  sessionId: text("session_id").primaryKey(),
  role: text("role").notNull(), // 'aa-conversation' | 'aa-triage' | 'aa-task' | 'work'
  scopeKey: text("scope_key").notNull().unique(),
  leaseHolder: text("lease_holder"),
  leaseUntil: integer("lease_until"), // epoch ms
  status: text("status").notNull().default("active"),
});

export const requests = sqliteTable("requests", {
  id: text("id").primaryKey(),
  type: text("type").notNull(), // question | blocker | proposal | change_request | gate_request
  fromActor: text("from_actor").notNull(),
  toActor: text("to_actor").notNull(),
  itemId: text("item_id"),
  status: text("status").notNull(), // open | claimed | answered | escalated | withdrawn | closed
  payload: text("payload"), // JSON
  response: text("response"), // JSON
  agendaId: text("agenda_id"),
  threadId: text("thread_id"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const agendaItems = sqliteTable("agenda_items", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  status: text("status").notNull(),
  owner: text("owner").notNull(), // 'approach' | 'human'
  priority: integer("priority").notNull(),
  humanRank: integer("human_rank"),
  trigger: text("trigger"), // JSON
  claimSession: text("claim_session"),
  claimUntil: integer("claim_until"),
  resolution: text("resolution"),
});

export const assetVersions = sqliteTable(
  "asset_versions",
  {
    slotRef: text("slot_ref").notNull(),
    major: integer("major").notNull(),
    minor: integer("minor").notNull(),
    kind: text("kind").notNull(),
    author: text("author").notNull(),
    at: integer("at").notNull(),
    note: text("note"),
    runId: text("run_id"),
    path: text("path").notNull(),
  },
  (t) => [primaryKey({ columns: [t.slotRef, t.major, t.minor] })],
);

export const consumptions = sqliteTable(
  "consumptions",
  {
    runId: text("run_id").notNull(),
    slotRef: text("slot_ref").notNull(),
    major: integer("major").notNull(),
    minor: integer("minor").notNull(),
    mode: text("mode").notNull(), // declared | implicit | library
  },
  (t) => [primaryKey({ columns: [t.runId, t.slotRef, t.major, t.minor] })],
);

// Not part of §6.2's named subset; used only for the perf smoke test (§4.6).
export const events = sqliteTable("events", {
  seq: integer("seq").primaryKey({ autoIncrement: true }),
  type: text("type").notNull(),
  actor: text("actor").notNull(),
  payload: text("payload"),
  at: integer("at").notNull(),
});

export const DDL_SQL = `
CREATE TABLE IF NOT EXISTS sessions (
  session_id   TEXT PRIMARY KEY,
  role         TEXT NOT NULL,
  scope_key    TEXT NOT NULL UNIQUE,
  lease_holder TEXT,
  lease_until  INTEGER,
  status       TEXT NOT NULL DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS requests (
  id          TEXT PRIMARY KEY,
  type        TEXT NOT NULL,
  from_actor  TEXT NOT NULL,
  to_actor    TEXT NOT NULL,
  item_id     TEXT,
  status      TEXT NOT NULL,
  payload     TEXT,
  response    TEXT,
  agenda_id   TEXT,
  thread_id   TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS agenda_items (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL,
  status        TEXT NOT NULL,
  owner         TEXT NOT NULL,
  priority      INTEGER NOT NULL,
  human_rank    INTEGER,
  trigger       TEXT,
  claim_session TEXT,
  claim_until   INTEGER,
  resolution    TEXT
);

CREATE TABLE IF NOT EXISTS asset_versions (
  slot_ref TEXT NOT NULL,
  major    INTEGER NOT NULL,
  minor    INTEGER NOT NULL,
  kind     TEXT NOT NULL,
  author   TEXT NOT NULL,
  at       INTEGER NOT NULL,
  note     TEXT,
  run_id   TEXT,
  path     TEXT NOT NULL,
  PRIMARY KEY (slot_ref, major, minor)
);

CREATE TABLE IF NOT EXISTS consumptions (
  run_id   TEXT NOT NULL,
  slot_ref TEXT NOT NULL,
  major    INTEGER NOT NULL,
  minor    INTEGER NOT NULL,
  mode     TEXT NOT NULL,
  PRIMARY KEY (run_id, slot_ref, major, minor)
);

CREATE TABLE IF NOT EXISTS events (
  seq     INTEGER PRIMARY KEY AUTOINCREMENT,
  type    TEXT NOT NULL,
  actor   TEXT NOT NULL,
  payload TEXT,
  at      INTEGER NOT NULL
);
`;
