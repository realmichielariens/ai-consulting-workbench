// The Git service (ARCHITECTURE.md §11): one repository per engagement,
// checkpoint commits with actor attribution and Workbench-* trailers. Never
// depends on the caller's global git identity — every commit sets
// GIT_AUTHOR_*/GIT_COMMITTER_* env vars for that one spawned git process
// (verified empirically: simple-git's `.env(name, value)` sets one variable
// on the child process env without touching the parent's).

import fs from "node:fs";
import path from "node:path";
import { simpleGit, type DefaultLogFields, type LogResult } from "simple-git";
import { ENGAGEMENT_GITIGNORE } from "@workbench/core/node";
import type { Actor } from "@workbench/core";

/** `*.db binary` keeps state.db out of text diffing/CRLF handling (ARCHITECTURE.md §11, §15). */
const GITATTRIBUTES = "*.db binary\n";

const COMMITTER_NAME = "Workbench";
const COMMITTER_EMAIL = "workbench@workbench.local";

/** "agent:WI-002" -> "agent-WI-002@workbench.local" (the actor with ":" replaced). */
function actorEmail(actor: Actor): string {
  return `${actor.replace(/:/g, "-")}@workbench.local`;
}

export async function initRepo(root: string): Promise<void> {
  fs.mkdirSync(root, { recursive: true });
  const git = simpleGit(root);
  await git.init();
  // Local-scoped, so committed files are byte-identical regardless of the
  // user's global core.autocrlf (ARCHITECTURE.md §11 / CLAUDE.md rule 11).
  await git.addConfig("core.autocrlf", "false", false, "local");

  const gitignorePath = path.join(root, ".gitignore");
  if (!fs.existsSync(gitignorePath)) fs.writeFileSync(gitignorePath, ENGAGEMENT_GITIGNORE, "utf8");

  const gitattributesPath = path.join(root, ".gitattributes");
  if (!fs.existsSync(gitattributesPath)) fs.writeFileSync(gitattributesPath, GITATTRIBUTES, "utf8");
}

export interface CheckpointOptions {
  message: string;
  actor: Actor;
  /** Appended as `Key: value` trailer lines, e.g. { "Workbench-Event": "AssetPublished" }. */
  trailers?: Record<string, string>;
  /**
   * Run first, before `git add -A`. The server uses this to run the DB WAL
   * checkpoint (ARCHITECTURE.md §11): without it, recent rows sit only in
   * the git-ignored -wal file and the commit silently misses them.
   */
  beforeCommit?: () => void | Promise<void>;
}

function withTrailers(message: string, trailers?: Record<string, string>): string {
  if (!trailers || Object.keys(trailers).length === 0) return message;
  const lines = Object.entries(trailers).map(([k, v]) => `${k}: ${v}`);
  return `${message}\n\n${lines.join("\n")}`;
}

/**
 * `git add -A` then commit, but only if there is something to commit (a
 * checkpoint after a no-op is a no-op, not an empty commit). Returns the new
 * commit's sha, or null if nothing changed.
 */
export async function checkpoint(root: string, opts: CheckpointOptions): Promise<string | null> {
  if (opts.beforeCommit) await opts.beforeCommit();

  const git = simpleGit(root);
  await git.add(["-A"]);
  const status = await git.status();
  if (status.files.length === 0) return null;

  const message = withTrailers(opts.message, opts.trailers);
  await git
    .env("GIT_AUTHOR_NAME", opts.actor)
    .env("GIT_AUTHOR_EMAIL", actorEmail(opts.actor))
    .env("GIT_COMMITTER_NAME", COMMITTER_NAME)
    .env("GIT_COMMITTER_EMAIL", COMMITTER_EMAIL)
    .commit(message);

  const head = await simpleGit(root).log({ maxCount: 1 });
  return head.latest?.hash ?? null;
}

export async function log(root: string, n: number): Promise<LogResult<DefaultLogFields>> {
  return simpleGit(root).log({ maxCount: n });
}

/** `git log --stat -1` output, verbatim, for `pnpm seed:try`'s printout. */
export async function logStat(root: string, n = 1): Promise<string> {
  return simpleGit(root).raw(["log", "--stat", `-${n}`]);
}
