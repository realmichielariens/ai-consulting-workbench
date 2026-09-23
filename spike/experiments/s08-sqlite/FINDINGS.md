# S8 — SQLite on Node 26: driver, FTS5, leases, and a Git round trip

**Verdict:** PASS   **Cost:** $0.00 (no LLM/API calls)   **Runs:** 1 (`npx tsx experiments/s08-sqlite/run.ts`, 18/18 checks pass)   **SDK:** 0.3.280 (unused by this experiment)   **Model:** n/a

## Hypothesis

An embedded SQLite driver works on Node 26 / Windows with FTS5, WAL mode, atomic leases, and a commit-and-restore cycle through Git.

**Confirmed, with one correction to ARCHITECTURE.md §4/§15: pin `better-sqlite3` to `^13.0.3` (N-API), not an older NAN-based major. The older majors (11.x, the implicit default as of writing) do not install on Node 26 at all.**

## Setup (what was built; how to re-run)

```sh
cd spike/experiments/s08-sqlite
npm install                 # nested package.json; never touches spike/package.json
cd ../..                    # back to spike/
npx tsx experiments/s08-sqlite/run.ts
```

Nested `package.json` (isolated deps):

```json
{
  "dependencies": { "better-sqlite3": "^13.0.3", "drizzle-orm": "^0.44.6" },
  "devDependencies": { "drizzle-kit": "^0.31.6" }
}
```

Files:

| File | Purpose |
|---|---|
| `src/schema.ts` | Drizzle schema for `requests`, `agenda_items`, `sessions`, `asset_versions`, `consumptions` (+ `events` for the perf test), plus matching hand-written `DDL_SQL` |
| `src/fts.ts` | FTS5 virtual table + 3 Markdown docs + `bm25()`-ranked `MATCH` query with `snippet()`, against a driver-agnostic `SyncSql` interface |
| `src/leases.ts` + `src/lease-worker.ts` | Multi-process lease race (200 rounds x 5 OS processes, barrier-synchronized), expiry test, renewal test |
| `src/git-roundtrip.ts` | WAL write -> checkpoint -> commit -> tag -> write more -> checkpoint -> commit -> tag -> checkout old tag -> reopen -> verify; plus the no-checkpoint and open-handle-checkout demonstrations |
| `src/perf.ts` | 10k-row insert (single transaction vs. per-row autocommit) and query timings |
| `run.ts` | Orchestrates all of the above and writes `results/s08-sqlite/summary.json` via `report.ts`'s `check()` |
| `drizzle.config.ts`, `drizzle-migrations/0000_flat_mandarin.sql` | Real `drizzle-kit generate` output from `src/schema.ts`, checked in as evidence |
| `npm-install-output.txt` | Full verbose log of the failed `better-sqlite3@^11.10.0` install (431KB, kept as raw evidence) |
| `npm-install-output-v13.txt` | Full verbose log of the successful `better-sqlite3@^13.0.3` install |

Every DB in the run uses a fresh `os.tmpdir()`-based temp directory (`fs.mkdtempSync`); nothing is shared across checks.

## Results

| Check | Result | Evidence (file:line / command output) |
|---|---|---|
| `better-sqlite3-v11-no-prebuild-for-node26-abi` | PASS (confirms the risk) | `npm-install-output.txt`: prebuild-install requests `better-sqlite3-v11.10.0-node-v147-win32-x64.tar.gz` -> **HTTP 404**. Falls back to `node-gyp rebuild`; VS2022 BuildTools *was* found (v143 toolset) so a missing compiler was **not** the blocker. Compile fails with V8 API breakage: `error C2039: GetPrototype is not a member of v8::Object`, `GetIsolate is not a member of v8::Context`, `This is not a member of v8::PropertyCallbackInfo<v8::Value>`. 7 errors, `npm install` exits 1, `node_modules/better-sqlite3` rolled back to empty. |
| `better-sqlite3-v13-works-via-bundled-napi-prebuild` | PASS | `npm-install-output-v13.txt`: exit 0, **no `node-gyp` invocation at all**. `node_modules/better-sqlite3/prebuilds/` ships `win32-x64.node` (and 7 other platform `.node` files) directly inside the npm package — v13 moved from NAN/raw-V8 bindings to `node-addon-api` (N-API), which is ABI-stable, so one prebuilt binary works across Node versions/ABIs instead of needing a per-ABI download. |
| `better-sqlite3-loads-and-queries-on-node26` | PASS | Live `require('better-sqlite3')@13.0.3`, `sqlite_version()` = `3.53.4`, round-tripped `{id:1,name:'hello'}`. |
| `node-sqlite-works-no-flag-no-warning-on-node26` | PASS | `import { DatabaseSync } from "node:sqlite"` with **no `--experimental-sqlite` flag** and **no `ExperimentalWarning`** on stderr. `process.versions.modules` = `147`. |
| `drizzle-orm-better-sqlite3-driver-exists` | PASS | `node_modules/drizzle-orm/better-sqlite3/` exists (drizzle-orm@0.44.7); `drizzle(sqlite, {schema})` used end-to-end in the schema check below. |
| `drizzle-orm-no-native-node-sqlite-driver` | PASS (documents a gap) | No `drizzle-orm/node-sqlite` (or equivalent) directory shipped in 0.44.7 — checked by directory listing, not the changelog. |
| `drizzle-sqlite-proxy-wraps-node-sqlite` | PASS | `drizzle-orm/sqlite-proxy`'s `drizzle(callback)` wrapping a hand-written ~15-line adapter (`run`/`get`/`all` -> `DatabaseSync.prepare(sql).run/get/all(...params)`) round-trips a typed insert + `select().where(eq(...))`. Works, but the proxy API is async-shaped (`await` on every call) over a synchronous driver, and there's no migrator wired to it. |
| `fts5-better-sqlite3-ranked-query-with-snippet` | PASS | `CREATE VIRTUAL TABLE asset_fts USING fts5(...)`, 3 docs indexed, `MATCH 'cloud migration' ORDER BY bm25(asset_fts)` returns 3 ranked rows; top hit's `snippet()` = `...vendor consolidation, (2) [cloud] [migration] for the data...`. |
| `fts5-node-sqlite-ranked-query-with-snippet` | PASS | Identical setup/query against `node:sqlite`'s `DatabaseSync` — same 3 docs, same ranking order, same snippet markers. FTS5 is compiled into both drivers' bundled SQLite. |
| `schema-subset-crud-via-drizzle` | PASS | One row inserted + selected in each of `sessions`, `requests`, `agenda_items`, `asset_versions`, `consumptions` via `drizzle-orm/better-sqlite3`, typed end to end. |
| `drizzle-kit-generate-produces-matching-ddl` | PASS | `npx drizzle-kit generate` (real CLI run, `drizzle.config.ts` -> `dialect: sqlite`) produced `drizzle-migrations/0000_flat_mandarin.sql` with all 6 expected `CREATE TABLE` statements (`sessions` includes `CREATE UNIQUE INDEX sessions_scope_key_unique`). |
| `lease-race-exactly-one-winner-per-round` | PASS | **200/200 rounds, exactly one winner each, 0 rounds with zero or multiple winners.** 5 separate OS processes (own `better-sqlite3` connection, own PID, WAL + `busy_timeout=5000`), barrier-synchronized per round so they genuinely contend. Winners spread across workers (`w0:48, w1:40, w2:30, w3:39, w4:43`), proving real contention rather than one process lapping the others. |
| `lease-expiry-allows-takeover` | PASS | holder-A acquires (`changes=1`); holder-B's immediate steal on the still-valid lease is rejected (`changes=0`); after the 80ms lease expires, holder-C's steal succeeds (`changes=1`), confirmed new `lease_holder=holder-C`. |
| `lease-renewal-extends-and-blocks-steal` | PASS | holder-A acquires a 100ms lease, renews via a plain `UPDATE ... WHERE scope_key=? AND session_id=?` (no `ON CONFLICT` needed for a self-renewal), `lease_until` extended from a near value to +60s; a steal attempt right after is rejected (`changes=0`). |
| `git-checkpoint-then-commit-then-tag-then-restore` | PASS | Checkpoint -> commit (`checkpoint/v1`, 1 row) -> write + checkpoint -> commit (`checkpoint/v2`, 2 rows) -> checkout `v1` (after closing the connection) -> reopen -> exactly 1 row (`batch1`) -> checkout back to `v2` -> 2 rows. |
| `git-commit-without-checkpoint-misses-wal-data` | PASS (demonstrates the risk) | After inserting a 2nd row with **no** checkpoint, `git status --porcelain` on `state.db` is **empty** — the new row lives only in `state.db-wal` (gitignored, per real practice), so `state.db` on disk is byte-identical to the last checkpoint. After `wal_checkpoint(TRUNCATE)`, the identical `git status` shows `M state.db`. Committing at the first point would silently produce a checkpoint tag missing the 2nd write. |
| `git-checkout-requires-closed-connection-on-windows` | PASS (documents a hard requirement) | `git checkout <tag> -- state.db` **while the better-sqlite3 connection is still open fails** on Windows: `error: unable to unlink old state.db: Invalid argument`. The failed attempt does not corrupt the file (the still-open connection reads both rows unchanged). After `db.close()`, the identical checkout succeeds. |
| `perf-10k-insert-and-query` | PASS | n=10,000. Single-transaction insert: **15.3ms**. Per-row autocommit insert: **199.4ms (13.0x slower)**. `COUNT(*)`: 0.09ms. Filtered `SELECT` (2,000 matching rows): 0.80ms. `ORDER BY ... LIMIT 50`: 2.19ms. |

Full machine-readable results: `results/s08-sqlite/summary.json` (18/18 `pass: true`).

## Exact working configuration (copy-pasteable snippets, rule syntax, option shapes)

**Driver pin** — `better-sqlite3` must be `^13.0.3` or later (N-API), not the implicit default major:

```json
{ "dependencies": { "better-sqlite3": "^13.0.3" } }
```

**node:sqlite** — no flag needed on Node 26.3.0:

```ts
import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(":memory:"); // or a file path
```

**Drizzle over better-sqlite3** (first-class driver):

```ts
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.js";

const sqlite = new Database(dbPath);
const db = drizzle(sqlite, { schema });
```

**Drizzle over node:sqlite** (only via the async proxy — see `run.ts` for the full adapter):

```ts
import { drizzle } from "drizzle-orm/sqlite-proxy";
const db = drizzle(async (sql, params, method) => {
  const stmt = sqlite.prepare(sql); // sqlite: DatabaseSync
  if (method === "run") { stmt.run(...params); return { rows: [] }; }
  if (method === "get") { const r = stmt.get(...params); return { rows: r ? [Object.values(r)] : [] }; }
  return { rows: stmt.all(...params).map(Object.values) };
}, { schema });
```

**FTS5**:

```sql
CREATE VIRTUAL TABLE asset_fts USING fts5(slot_ref, title, body);
SELECT slot_ref, title, snippet(asset_fts, 2, '[', ']', '...', 8) as snippet, bm25(asset_fts) as rank
FROM asset_fts WHERE asset_fts MATCH ? ORDER BY rank;  -- bm25 is more negative = better match
```

**Lease acquire/steal** (the exact SQL from `src/lease-worker.ts`), run inside a hand-managed `BEGIN IMMEDIATE` / `COMMIT` (not `db.transaction()`, which only issues a plain `BEGIN`):

```sql
BEGIN IMMEDIATE;
INSERT INTO sessions (session_id, role, scope_key, lease_holder, lease_until, status)
VALUES (@sessionId, 'work', @scopeKey, @holder, @leaseUntil, 'active')
ON CONFLICT(scope_key) DO UPDATE SET
  session_id = excluded.session_id, lease_holder = excluded.lease_holder,
  lease_until = excluded.lease_until, status = 'active'
WHERE sessions.lease_until < @now;   -- only steal an EXPIRED lease
COMMIT;
```

Check `info.changes === 1` after `.run()`: `1` means this attempt won (fresh row or a stolen expired lease); `0` means an active unexpired lease already held it. Needs `db.pragma("journal_mode = WAL")` and `db.pragma("busy_timeout = 5000")` on every connection so contenders block-and-retry under `BEGIN IMMEDIATE` instead of failing with `SQLITE_BUSY`.

**Renewal** (the holder extends its own lease — no `ON CONFLICT` race needed):

```sql
UPDATE sessions SET lease_until = @leaseUntil WHERE scope_key = @scopeKey AND session_id = @sessionId;
```

**Git checkpoint commit** (`ARCHITECTURE.md §11`):

```ts
db.pragma("wal_checkpoint(TRUNCATE)");
execFileSync("git", ["add", "state.db"], { cwd: repoDir });
execFileSync("git", ["commit", "-m", "checkpoint N"], { cwd: repoDir });
execFileSync("git", ["tag", `checkpoint/v${n}`], { cwd: repoDir });
```

`.gitignore` in the engagement repo: `state.db-wal` and `state.db-shm` (matches `ARCHITECTURE.md §11`'s "commits the files and `state.db`" — WAL/SHM are transient and never committed).

## Surprises and deviations from ARCHITECTURE.md

1. **`ARCHITECTURE.md §4`/`§15` say `better-sqlite3` "ships prebuilt Windows binaries" without a version pin — this is only true from v13 onward.** The natural "just `npm install better-sqlite3`" (which resolves to a `^11.x`-family default as of writing) has **no prebuilt binary for Node 26's ABI** (`NODE_MODULE_VERSION 147`) and its source build **fails to compile** against Node 26's V8 headers (real API removals: `Object::GetPrototype`, `Context::GetIsolate`, `PropertyCallbackInfo::This`), independent of whether a working MSVC toolchain is present. **This must be corrected to `better-sqlite3: ^13.0.3`.**
2. **Drizzle ORM has no first-class `node:sqlite` driver** as of `drizzle-orm@0.44.7`. `drizzle-orm/sqlite-proxy` can wrap it (confirmed working), but it's a hand-written adapter with an async-shaped API layered over a synchronous driver — a real but second-class path.
3. **Committing `state.db` without a checkpoint is a silent no-op for recent writes**, not an error — `git status` simply shows nothing changed. This is easy to get wrong operationally: a checkpoint commit that forgets the `wal_checkpoint(TRUNCATE)` step looks like it succeeded (no error, clean git status) while quietly excluding the latest writes from the tag.
4. **`git checkout` of a tracked `state.db` requires the SQLite connection to be closed first, on Windows** — fails with an unlink error while open. `ARCHITECTURE.md §11`'s "Restoring one means checking out the files and the DB, restarting the index and releasing leases" needs to explicitly sequence "close the DB connection" before "checkout the tag" for the Windows target.
5. `better-sqlite3`'s `db.transaction()` wrapper only issues a plain `BEGIN`, not `BEGIN IMMEDIATE` — for the lease acquire/steal statement, which needs the write lock taken immediately (not deferred until the first write inside the transaction) so concurrent processes serialize correctly, the transaction had to be managed by hand (`db.exec("BEGIN IMMEDIATE")` / `db.exec("COMMIT")`).
6. `node:sqlite`'s `DatabaseSync` is genuinely drop-in for everything tested here (pragmas, prepared statements, FTS5) with **zero experimental warnings and no flag** on Node 26.3.0 — it was expected to still need `--experimental-sqlite` based on earlier Node versions' behavior; that requirement is gone by 26.

## Recommendation (what to change in ARCHITECTURE.md, if anything)

- **Driver: `better-sqlite3@^13.0.3`+ (N-API), with Drizzle ORM.** This is the recommended pairing — synchronous API (matches the rest of the server's synchronous-write-path design in `§5.3`), first-class Drizzle support, ships working prebuilt binaries for Node 26 today. Update `ARCHITECTURE.md §4`'s stack row from `better-sqlite3 (synchronous, prebuilt for Windows)` to `better-sqlite3 ^13.x (N-API, prebuilt for Windows/Node 26+)`, and `§15`'s "`better-sqlite3` ships prebuilt Windows binaries (verify in the spike)" to record the version constraint and the v11-vs-v13 finding above.
- **Node version: stay on Node 26 — no need to move to Node 24 LTS for SQLite's sake.** The original concern (`M0-SPIKE-PLAN.md §10`: "Node 26 has no native module prebuilds") is resolved once the driver is pinned to `^13.0.3`; `node:sqlite` also works natively with zero flags. Node 24 LTS would not materially change this recommendation — `better-sqlite3@^13.x`'s N-API binaries are ABI-stable and would work identically there, and `node:sqlite` would too (it shipped stabilized earlier). The Node-version decision in Phase 3 should be driven by other spike results (S0, S7), not by S8.
- Update the `state.db` restore procedure in `§11` to note the close-before-checkout requirement, and add the `.gitignore` entries for wal/shm files explicitly (currently only `.workbench/runs/` is mentioned).
- Keep `node:sqlite` documented as a viable fallback (per the spike plan's own fallback: "`node:sqlite` without Drizzle, a thin query layer") — it is fully functional for everything except typed ORM access, and would be the path if Drizzle's `better-sqlite3` support ever regressed on a future Node ABI.

## Fallback status (tested? works?)

**Tested and works.** `node:sqlite`'s `DatabaseSync` was exercised for driver load, FTS5 (identical ranked results to `better-sqlite3`), and would work identically for the schema/leases/git-roundtrip/perf SQL (same driver-agnostic SQL, just a different prepared-statement wrapper — the lease and schema modules in this experiment use plain SQL strings that are driver-neutral). The one gap is Drizzle: no first-class `node:sqlite` driver exists, only the `sqlite-proxy` adapter (tested, works, second-class). **The fallback is not needed** given `better-sqlite3@^13.0.3` works cleanly, but it is a credible fallback if that ever changes.

## Harness change requests

None. This experiment only used `report.ts`'s `check()` (no `runQuery`, no fixture, no canary scan — no LLM calls at all, as specified).

## Open questions

1. Should `ARCHITECTURE.md`'s example `workbench.config.yaml` or a top-level `package.json` note pin `better-sqlite3` to an exact patch version (not just `^13.0.3`), given how version-sensitive the ABI/prebuild story turned out to be? A minor-version bump that reintroduces a NAN-style rewrite (unlikely but not impossible) would silently break Windows installs again.
2. The lease race here uses a file-based barrier across OS processes to force genuine concurrency (200/200 exactly-one-winner is easy to get "for free" if contenders don't actually overlap in time — an earlier un-barriered version of this test showed only 1 of 5 workers ever winning, because process-start jitter alone was enough for one worker to consistently lead). The real server won't need this barrier (leases will be requested at genuinely unpredictable times), but it's worth flagging that a naive lease race test can pass trivially without proving anything — Phase 3's independent re-check of this claim should look at the winners-by-worker distribution, not just the pass/fail count.
3. `wal_checkpoint(TRUNCATE)`'s returned `{busy, log, checkpointed}` pragma row read `{busy:0, log:0, checkpointed:0}` even immediately after a write in this environment, while `git status` still correctly detected the resulting file change — the pragma's return values didn't behave as documented (nonzero `log`/`checkpointed` expected) but the checkpoint's actual effect (data flushed to the main file) was still correct and verified independently via git and reopening the DB. Not investigated further since it didn't affect any pass/fail outcome, but worth a closer look if the real server ever needs to alert on checkpoint failures using those return columns specifically (rather than just checking `busy === 0`).
