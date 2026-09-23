// @workbench/db: the schema contract, plus openEngagementDb/walCheckpoint,
// id/meta helpers and one typed, synchronous repository per table
// (ARCHITECTURE.md §6.2, I1-PLAN.md §6 W3). Node-only (better-sqlite3);
// there is no separate browser-safe entry, unlike @workbench/core.

export * from "./schema.js";
export * from "./client.js";
export * from "./ids.js";
export * from "./mappers.js";
export * from "./repos/index.js";
