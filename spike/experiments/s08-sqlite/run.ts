// S8 — SQLite on Node 26: driver, FTS5, leases, and a Git round trip.
// No LLM/API calls in this experiment (cap $0). Run from spike/:
//
//   npx tsx experiments/s08-sqlite/run.ts
//
// Requires `npm install` inside experiments/s08-sqlite/ first (nested
// package.json; never touches the shared spike/package.json).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { DatabaseSync } from "node:sqlite";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { drizzle as drizzleProxy } from "drizzle-orm/sqlite-proxy";
import { eq } from "drizzle-orm";

import { check } from "../../src/lib/report.js";
import { runFtsCheck, type SyncSql } from "./src/fts.js";
import * as schema from "./src/schema.js";
import { runLeaseRace, testExpiry, testRenewal } from "./src/leases.js";
import { runGitRoundTrip } from "./src/git-roundtrip.js";
import { runPerfSmoke } from "./src/perf.js";

const EXP = "s08-sqlite";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

function tmp(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
}

function short(text: string, n = 900): string {
  return text.length > n ? text.slice(0, n) + ` …[${text.length - n} more chars]` : text;
}

async function main() {
  console.log("=== S8 — SQLite on Node 26 ===");
  console.log("node", process.version, "NODE_MODULE_VERSION", process.versions.modules, "platform", process.platform);

  // ---------------------------------------------------------------------
  // 1. Driver: better-sqlite3 prebuilt/build availability, and node:sqlite.
  // ---------------------------------------------------------------------
  {
    const v11Log = path.join(__dirname, "npm-install-output.txt");
    const v13Log = path.join(__dirname, "npm-install-output-v13.txt");
    const v11Text = fs.existsSync(v11Log) ? fs.readFileSync(v11Log, "utf8") : "";
    const v13Text = fs.existsSync(v13Log) ? fs.readFileSync(v13Log, "utf8") : "";

    const v11Had404 = /No prebuilt binaries found/.test(v11Text) || /404/.test(v11Text);
    const v11BuildFailed = /error C2039|MSBuild\.exe. failed|not ok/.test(v11Text);
    check(
      EXP,
      "better-sqlite3-v11-no-prebuild-for-node26-abi",
      v11Had404 && v11BuildFailed,
      short(
        [
          "npm install better-sqlite3@^11.10.0 on Node 26.3.0 (NODE_MODULE_VERSION 147, win32-x64):",
          "prebuild-install requested .../better-sqlite3-v11.10.0-node-v147-win32-x64.tar.gz -> HTTP 404 (no prebuilt for this ABI).",
          "Fell back to `node-gyp rebuild`. VS2022 BuildTools WAS found (v143 toolset, Windows SDK 10.0.26100.0) — a compiler was NOT the blocker.",
          "Compile failed with V8 API breakage against the V8 shipped in Node 26.3.0: error C2039 'GetPrototype' is not a member of 'v8::Object', C2039 'GetIsolate' not a member of 'v8::Context', C2039 'This' not a member of 'v8::PropertyCallbackInfo<v8::Value>' (binder.lzz / better_sqlite3.lzz / database.lzz / statement.lzz). 7 errors, npm install exited 1, node_modules/better-sqlite3 rolled back (empty).",
          "See experiments/s08-sqlite/npm-install-output.txt for the full log.",
        ].join("\n"),
      ),
    );

    let v13Version = "unknown";
    try {
      v13Version = JSON.parse(fs.readFileSync(path.join(__dirname, "node_modules/better-sqlite3/package.json"), "utf8")).version;
    } catch {
      /* not installed */
    }
    const v13UsedPrebuild = /npm info ok/.test(v13Text) && !/node-gyp rebuild/.test(v13Text);
    check(
      EXP,
      "better-sqlite3-v13-works-via-bundled-napi-prebuild",
      v13Version.startsWith("13") && v13UsedPrebuild,
      short(
        [
          `npm install better-sqlite3@^13.0.3: exit 0, no node-gyp invocation in the log (v13Text has "npm info ok": ${v13UsedPrebuild}).`,
          `Installed version: ${v13Version}.`,
          "v13 switched from NAN/direct-V8 bindings to node-addon-api (N-API), which is ABI-stable across Node versions. The npm package ships prebuilt .node binaries directly under node_modules/better-sqlite3/prebuilds/ (darwin-arm64, darwin-x64, linux-*, win32-arm64, win32-x64.node) rather than fetching a per-ABI tarball from GitHub releases — so install is instant and offline-safe once the tarball itself is fetched.",
          "See experiments/s08-sqlite/npm-install-output-v13.txt for the full log.",
        ].join("\n"),
      ),
    );

    // Live load-and-query check (real, not just install exit code).
    const db1 = new Database(":memory:");
    const sqliteVersion = (db1.prepare("select sqlite_version() as v").get() as { v: string }).v;
    db1.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)");
    db1.prepare("INSERT INTO t (name) VALUES (?)").run("hello");
    const row = db1.prepare("SELECT * FROM t").get() as { id: number; name: string };
    db1.close();
    check(
      EXP,
      "better-sqlite3-loads-and-queries-on-node26",
      row.name === "hello",
      `require('better-sqlite3')@${v13Version}, sqlite_version()=${sqliteVersion}, round-tripped row=${JSON.stringify(row)}`,
    );

    // node:sqlite — no flag, no experimental warning captured on stderr.
    let warned = false;
    const origWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: any, ...args: any[]) => {
      if (String(chunk).includes("ExperimentalWarning") && String(chunk).toLowerCase().includes("sqlite")) warned = true;
      return origWrite(chunk, ...args);
    }) as any;
    const db2 = new DatabaseSync(":memory:");
    process.stderr.write = origWrite;
    db2.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)");
    db2.prepare("INSERT INTO t (name) VALUES (?)").run("hello");
    const row2 = db2.prepare("SELECT * FROM t").get() as { id: number; name: string };
    db2.close();
    check(
      EXP,
      "node-sqlite-works-no-flag-no-warning-on-node26",
      row2.name === "hello" && !warned,
      `import { DatabaseSync } from "node:sqlite" with no --experimental-sqlite flag; no ExperimentalWarning on stderr (warned=${warned}); round-tripped row=${JSON.stringify(row2)}. process.versions.modules=${process.versions.modules}.`,
    );

    // Drizzle: better-sqlite3 has a first-class driver; node:sqlite does not,
    // but drizzle-orm/sqlite-proxy can wrap it (actually tried, not assumed).
    const hasBetterSqlite3Driver = fs.existsSync(path.join(__dirname, "node_modules/drizzle-orm/better-sqlite3"));
    const hasNodeSqliteDriver = fs.existsSync(path.join(__dirname, "node_modules/drizzle-orm/node-sqlite")) ||
      fs.existsSync(path.join(__dirname, "node_modules/drizzle-orm/libsql-node-sqlite"));
    check(
      EXP,
      "drizzle-orm-better-sqlite3-driver-exists",
      hasBetterSqlite3Driver,
      `node_modules/drizzle-orm/better-sqlite3/ exists: ${hasBetterSqlite3Driver} (drizzle-orm@${JSON.parse(fs.readFileSync(path.join(__dirname, "node_modules/drizzle-orm/package.json"), "utf8")).version})`,
    );
    check(
      EXP,
      "drizzle-orm-no-native-node-sqlite-driver",
      hasNodeSqliteDriver === false,
      `No node_modules/drizzle-orm/node-sqlite (or similar) directory in this drizzle-orm version — confirmed by directory listing, not by the changelog.`,
    );

    const proxyDb = new DatabaseSync(":memory:");
    proxyDb.exec(schema.DDL_SQL);
    async function proxyCallback(sql: string, params: unknown[], method: "run" | "all" | "values" | "get") {
      const stmt = proxyDb.prepare(sql);
      if (method === "run") {
        stmt.run(...(params as any[]));
        return { rows: [] };
      }
      if (method === "get") {
        const r = stmt.get(...(params as any[]));
        return { rows: r ? [Object.values(r)] : [] };
      }
      const rows = stmt.all(...(params as any[])) as any[];
      return { rows: rows.map((r) => Object.values(r)) };
    }
    const proxyOrm = drizzleProxy(proxyCallback, { schema });
    await proxyOrm.insert(schema.sessions).values({
      sessionId: "px-1",
      role: "work",
      scopeKey: "work:PROXY-TEST",
      leaseHolder: "px-1",
      leaseUntil: Date.now() + 60_000,
      status: "active",
    });
    const proxyRows = await proxyOrm.select().from(schema.sessions).where(eq(schema.sessions.scopeKey, "work:PROXY-TEST"));
    proxyDb.close();
    check(
      EXP,
      "drizzle-sqlite-proxy-wraps-node-sqlite",
      proxyRows.length === 1 && proxyRows[0].leaseHolder === "px-1",
      `drizzle-orm/sqlite-proxy's drizzle(callback) wrapping a hand-written ~15-line adapter over node:sqlite's DatabaseSync: insert + typed select round-tripped: ${JSON.stringify(proxyRows)}. This works, but is NOT first-class (async-shaped API over a sync driver, no query batching for free, no migrator wired up) — see FINDINGS for the recommendation.`,
    );
  }

  // ---------------------------------------------------------------------
  // 2. FTS5 in each working driver.
  // ---------------------------------------------------------------------
  {
    function betterSqlite3Adapter(db: Database.Database): SyncSql {
      return { exec: (sql) => void db.exec(sql), all: (sql, ...params) => db.prepare(sql).all(...params) };
    }
    function nodeSqliteAdapter(db: DatabaseSync): SyncSql {
      return { exec: (sql) => void db.exec(sql), all: (sql, ...params) => db.prepare(sql).all(...params) };
    }

    const db1 = new Database(":memory:");
    const r1 = runFtsCheck(betterSqlite3Adapter(db1), "better-sqlite3");
    db1.close();
    check(
      EXP,
      "fts5-better-sqlite3-ranked-query-with-snippet",
      r1.indexedCount === 3 && r1.results.length === 3 && r1.results[0].snippet.includes("["),
      `Indexed ${r1.indexedCount} docs into a CREATE VIRTUAL TABLE ... USING fts5(...); MATCH '${r1.query}' ORDER BY bm25(asset_fts) returned ${r1.results.length} rows, top hit=${r1.results[0].slotRef}, snippet=${JSON.stringify(r1.results[0].snippet)}`,
    );

    const db2 = new DatabaseSync(":memory:");
    const r2 = runFtsCheck(nodeSqliteAdapter(db2), "node:sqlite");
    db2.close();
    check(
      EXP,
      "fts5-node-sqlite-ranked-query-with-snippet",
      r2.indexedCount === 3 && r2.results.length === 3 && r2.results[0].snippet.includes("["),
      `Same FTS5 setup/query against node:sqlite's DatabaseSync: indexed=${r2.indexedCount}, results=${r2.results.length}, top hit=${r2.results[0].slotRef}, snippet=${JSON.stringify(r2.results[0].snippet)}. Identical ranking order to better-sqlite3: ${JSON.stringify(r1.results.map((x) => x.slotRef)) === JSON.stringify(r2.results.map((x) => x.slotRef))}`,
    );
  }

  // ---------------------------------------------------------------------
  // 3. Schema subset (requests, agenda_items, sessions, asset_versions,
  //    consumptions) via Drizzle ORM + a matching drizzle-kit generate.
  // ---------------------------------------------------------------------
  {
    const dbPath = path.join(tmp("s08-schema"), "state.db");
    const sqlite = new Database(dbPath);
    sqlite.exec(schema.DDL_SQL);
    const db = drizzle(sqlite, { schema });

    const now = Date.now();
    db.insert(schema.sessions).values({
      sessionId: "S-1", role: "work", scopeKey: "work:WI-004",
      leaseHolder: "S-1", leaseUntil: now + 60_000, status: "active",
    }).run();
    db.insert(schema.requests).values({
      id: "REQ-1", type: "question", fromActor: "agent:WI-004", toActor: "approach",
      status: "open", payload: JSON.stringify({ question: "Which CIO focus?", hypothesis: "cost" }),
      agendaId: "AG-1", createdAt: now, updatedAt: now,
    }).run();
    db.insert(schema.agendaItems).values({
      id: "AG-1", kind: "question", status: "open", owner: "approach", priority: 1,
    }).run();
    db.insert(schema.assetVersions).values({
      slotRef: "WI-004/assets/themes", major: 1, minor: 0, kind: "material",
      author: "agent:WI-004", at: now, note: "initial", runId: "R-1",
      path: "items/WI-004/assets/themes/v1.0.md",
    }).run();
    db.insert(schema.consumptions).values({
      runId: "R-1", slotRef: "ENG/assets/context", major: 1, minor: 0, mode: "declared",
    }).run();

    const sessionRows = db.select().from(schema.sessions).where(eq(schema.sessions.scopeKey, "work:WI-004")).all();
    const requestRows = db.select().from(schema.requests).where(eq(schema.requests.id, "REQ-1")).all();
    const assetRows = db.select().from(schema.assetVersions).all();
    const consumptionRows = db.select().from(schema.consumptions).all();
    sqlite.close();

    check(
      EXP,
      "schema-subset-crud-via-drizzle",
      sessionRows.length === 1 && requestRows.length === 1 && assetRows.length === 1 && consumptionRows.length === 1,
      `Inserted + selected one row each in sessions/requests/agenda_items/asset_versions/consumptions via drizzle-orm/better-sqlite3. session=${JSON.stringify(sessionRows[0])}`,
    );

    const migrationDir = path.join(__dirname, "drizzle-migrations");
    const migrationFiles = fs.existsSync(migrationDir) ? fs.readdirSync(migrationDir).filter((f) => f.endsWith(".sql")) : [];
    const migrationText = migrationFiles.length > 0 ? fs.readFileSync(path.join(migrationDir, migrationFiles[0]), "utf8") : "";
    const allTablesPresent = ["agenda_items", "asset_versions", "consumptions", "events", "requests", "sessions"].every(
      (t) => migrationText.includes(`CREATE TABLE \`${t}\``),
    );
    check(
      EXP,
      "drizzle-kit-generate-produces-matching-ddl",
      migrationFiles.length > 0 && allTablesPresent,
      `npx drizzle-kit generate (drizzle.config.ts, dialect: 'sqlite') produced ${migrationFiles.join(", ")}; all 6 expected CREATE TABLE statements present: ${allTablesPresent}.`,
    );
  }

  // ---------------------------------------------------------------------
  // 4. Leases: concurrent race, expiry, renewal.
  // ---------------------------------------------------------------------
  {
    const raceDir = tmp("s08-race");
    const dbPath = path.join(raceDir, "state.db");
    const ROUNDS = 200;
    const WORKERS = 5;
    console.log(`Running lease race: ${WORKERS} worker processes x ${ROUNDS} rounds (barrier-synchronized)...`);
    const race = await runLeaseRace(dbPath, WORKERS, ROUNDS, raceDir);
    check(
      EXP,
      "lease-race-exactly-one-winner-per-round",
      race.roundsWithExactlyOneWinner === ROUNDS && race.roundsWithZeroWinners === 0 && race.roundsWithMultipleWinners === 0,
      `${WORKERS} separate OS processes (own better-sqlite3 connection each, WAL + busy_timeout=5000ms) raced ${ROUNDS} rounds for scope_key='race:<n>' via BEGIN IMMEDIATE + INSERT...ON CONFLICT(scope_key) DO UPDATE...WHERE lease_until < now. Result: exactlyOneWinner=${race.roundsWithExactlyOneWinner}/${ROUNDS}, zeroWinners=${race.roundsWithZeroWinners}, multipleWinners=${race.roundsWithMultipleWinners}. Winners spread across workers (real contention, not one worker lapping the rest): ${JSON.stringify(race.winnersByWorker)}. Sample: ${JSON.stringify(race.sampleWinnerLog.slice(0, 5))}`,
    );

    const expiryDbPath = path.join(tmp("s08-expiry"), "state.db");
    const expiry = testExpiry(expiryDbPath);
    check(
      EXP,
      "lease-expiry-allows-takeover",
      expiry.firstAcquireChanges === 1 && expiry.immediateStealAttemptChanges === 0 && expiry.afterExpiryStealChanges === 1 && expiry.newHolder === "holder-C",
      `holder-A acquires (changes=${expiry.firstAcquireChanges}); holder-B's immediate steal attempt on the still-valid lease is rejected (changes=${expiry.immediateStealAttemptChanges}); after the 80ms lease expires, holder-C's steal succeeds (changes=${expiry.afterExpiryStealChanges}), new holder=${expiry.newHolder}.`,
    );

    const renewalDbPath = path.join(tmp("s08-renewal"), "state.db");
    const renewal = testRenewal(renewalDbPath);
    check(
      EXP,
      "lease-renewal-extends-and-blocks-steal",
      renewal.acquireChanges === 1 && renewal.renewChanges === 1 && renewal.leaseUntilAfter > renewal.leaseUntilBefore && renewal.stealAttemptAfterRenewChanges === 0,
      `holder-A acquires a 100ms lease, then renews with a plain UPDATE (no ON CONFLICT needed — it already owns the row): lease_until ${renewal.leaseUntilBefore} -> ${renewal.leaseUntilAfter}. A steal attempt by holder-B right after renewal is rejected (changes=${renewal.stealAttemptAfterRenewChanges}).`,
    );
  }

  // ---------------------------------------------------------------------
  // 5. Git round trip.
  // ---------------------------------------------------------------------
  {
    const repoDir = tmp("s08-git");
    const g = runGitRoundTrip(repoDir);
    check(
      EXP,
      "git-checkpoint-then-commit-then-tag-then-restore",
      g.rowsAfterRealCheckoutV1.length === 1 &&
        (g.rowsAfterRealCheckoutV1[0] as any).data === "batch1" &&
        g.rowsAfterCheckoutBackToV2.length === 2,
      `Committed state.db after wal_checkpoint(TRUNCATE) as tag checkpoint/v1 (1 row), wrote a 2nd row + checkpointed + committed as checkpoint/v2 (2 rows). Checked out checkpoint/v1 (after closing the connection) and reopened: rows=${JSON.stringify(g.rowsAfterRealCheckoutV1)}. Checked back out to checkpoint/v2: rows=${JSON.stringify(g.rowsAfterCheckoutBackToV2)}. Tags: ${g.tags.join(", ")}.`,
    );
    check(
      EXP,
      "git-commit-without-checkpoint-misses-wal-data",
      g.statusBeforeSecondCheckpoint.trim() === "" && g.statusAfterSecondCheckpoint.includes("M state.db"),
      `After inserting a 2nd row with NO checkpoint, 'git status --porcelain' on state.db is empty (git sees no change — the row is only in state.db-wal, which is .gitignored): ${JSON.stringify(g.statusBeforeSecondCheckpoint)}. After wal_checkpoint(TRUNCATE), the same command shows state.db as modified: ${JSON.stringify(g.statusAfterSecondCheckpoint)}. Committing at the first point would have silently produced a checkpoint tag missing the 2nd row.`,
    );
    check(
      EXP,
      "git-checkout-requires-closed-connection-on-windows",
      g.checkoutWhileOpen.ok === false && g.checkoutAfterClose.ok === true,
      `'git checkout <tag> -- state.db' while the better-sqlite3 connection is still open FAILS on Windows: ${JSON.stringify(g.checkoutWhileOpen.output)}. The failed attempt does not corrupt the file (old connection still reads both rows: ${JSON.stringify(g.rowsAfterFailedCheckoutViaOldConnection)}). After db.close(), the identical checkout command succeeds: ${JSON.stringify(g.checkoutAfterClose)}.`,
    );
  }

  // ---------------------------------------------------------------------
  // 6. Performance smoke: 10k events.
  // ---------------------------------------------------------------------
  {
    const dbPath = path.join(tmp("s08-perf"), "state.db");
    const perf = runPerfSmoke(dbPath, 10_000);
    check(
      EXP,
      "perf-10k-insert-and-query",
      perf.insertSingleTxnMs < perf.insertPerRowAutocommitMs,
      `n=${perf.n}. Single-transaction insert: ${perf.insertSingleTxnMs.toFixed(1)}ms. Per-row autocommit insert: ${perf.insertPerRowAutocommitMs.toFixed(1)}ms (${(perf.insertPerRowAutocommitMs / perf.insertSingleTxnMs).toFixed(1)}x slower). COUNT(*): ${perf.queryCountMs.toFixed(2)}ms. Filtered SELECT (2000 rows): ${perf.queryFilterMs.toFixed(2)}ms. ORDER BY + LIMIT 50: ${perf.queryOrderLimitMs.toFixed(2)}ms.`,
    );
  }

  console.log("=== S8 done. See results/s08-sqlite/summary.json ===");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
