// Test-only helper: a fresh temp-file engagement DB per test (not :memory:,
// so WAL mode and busy_timeout are actually exercised — M0 S8's point).
// Not exported from index.ts; imported directly by *.test.ts files.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openEngagementDb, type Db } from "./client.js";

export interface TestDb {
  ctx: Db;
  dir: string;
  file: string;
  cleanup(): void;
}

export function openTestDb(): TestDb {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "workbench-db-test-"));
  const file = path.join(dir, "state.db");
  const ctx = openEngagementDb(file);
  return {
    ctx,
    dir,
    file,
    cleanup: () => {
      ctx.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}
