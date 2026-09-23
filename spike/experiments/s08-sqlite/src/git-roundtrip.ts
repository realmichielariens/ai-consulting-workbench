// S8 §4 step 5: Git round trip. WAL writes -> wal_checkpoint(TRUNCATE) ->
// commit state.db in a temp repo -> tag -> more writes -> commit again ->
// checkout the first tag -> reopen -> verify the earlier state. Also
// demonstrates: committing WITHOUT a checkpoint first (data sits in the
// -wal file and git sees no diff in state.db), and whether the connection
// must be closed before `git checkout` on Windows (it must).

import Database from "better-sqlite3";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, stdio: "pipe", encoding: "utf8" });
}

function tryGit(cwd: string, args: string[]): { ok: boolean; output: string } {
  try {
    return { ok: true, output: git(cwd, args) };
  } catch (e: any) {
    return { ok: false, output: `${e.message}\n${e.stderr?.toString() ?? ""}` };
  }
}

export type GitRoundTripResult = {
  repoDir: string;
  filesAfterFirstCheckpoint: string[];
  statusBeforeSecondCheckpoint: string; // expect no "M state.db" line
  statusAfterSecondCheckpoint: string; // expect " M state.db"
  checkoutWhileOpen: { ok: boolean; output: string };
  rowsAfterFailedCheckoutViaOldConnection: unknown[];
  checkoutAfterClose: { ok: boolean; output: string };
  rowsAfterRealCheckoutV1: unknown[]; // expect only batch1
  rowsAfterCheckoutBackToV2: unknown[]; // expect batch1 + batch2
  tags: string[];
  log: string;
};

export function runGitRoundTrip(repoDir: string): GitRoundTripResult {
  fs.mkdirSync(repoDir, { recursive: true });
  git(repoDir, ["init", "-q"]);
  git(repoDir, ["config", "user.email", "spike@example.com"]);
  git(repoDir, ["config", "user.name", "M0 Spike S8"]);
  fs.writeFileSync(path.join(repoDir, ".gitignore"), "state.db-wal\nstate.db-shm\n");
  git(repoDir, ["add", ".gitignore"]);
  git(repoDir, ["commit", "-q", "-m", "initial: gitignore wal/shm"]);

  const dbPath = path.join(repoDir, "state.db");
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.exec("CREATE TABLE events (seq INTEGER PRIMARY KEY, data TEXT)");
  db.prepare("INSERT INTO events (seq, data) VALUES (1, ?)").run("batch1");
  db.pragma("wal_checkpoint(TRUNCATE)");

  const filesAfterFirstCheckpoint = fs.readdirSync(repoDir).filter((f) => f.startsWith("state.db"));

  git(repoDir, ["add", "state.db"]);
  git(repoDir, ["commit", "-q", "-m", "checkpoint 1"]);
  git(repoDir, ["tag", "checkpoint/v1"]);

  // Write more data, deliberately WITHOUT a checkpoint.
  db.prepare("INSERT INTO events (seq, data) VALUES (2, ?)").run("batch2-no-checkpoint");
  const statusBeforeSecondCheckpoint = git(repoDir, ["status", "--porcelain"]);

  // Now checkpoint for real, and commit.
  db.pragma("wal_checkpoint(TRUNCATE)");
  const statusAfterSecondCheckpoint = git(repoDir, ["status", "--porcelain"]);
  git(repoDir, ["add", "state.db"]);
  git(repoDir, ["commit", "-q", "-m", "checkpoint 2"]);
  git(repoDir, ["tag", "checkpoint/v2"]);

  // Windows file-lock question: checkout while the connection is still open.
  const checkoutWhileOpen = tryGit(repoDir, ["checkout", "checkpoint/v1", "--", "state.db"]);
  const rowsAfterFailedCheckoutViaOldConnection = db.prepare("SELECT * FROM events").all();

  db.close();
  const checkoutAfterClose = tryGit(repoDir, ["checkout", "checkpoint/v1", "--", "state.db"]);
  const db2 = new Database(dbPath);
  const rowsAfterRealCheckoutV1 = db2.prepare("SELECT * FROM events").all();
  db2.close();

  git(repoDir, ["checkout", "checkpoint/v2", "--", "state.db"]);
  const db3 = new Database(dbPath);
  const rowsAfterCheckoutBackToV2 = db3.prepare("SELECT * FROM events").all();
  db3.close();

  const tags = git(repoDir, ["tag", "--list"]).trim().split(/\r?\n/);
  const log = git(repoDir, ["log", "--oneline", "--all"]).trim();

  return {
    repoDir,
    filesAfterFirstCheckpoint,
    statusBeforeSecondCheckpoint,
    statusAfterSecondCheckpoint,
    checkoutWhileOpen,
    rowsAfterFailedCheckoutViaOldConnection,
    checkoutAfterClose,
    rowsAfterRealCheckoutV1,
    rowsAfterCheckoutBackToV2,
    tags,
    log,
  };
}
