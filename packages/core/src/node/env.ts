// Resolves ANTHROPIC_API_KEY and builds a clean env for spawned SDK children.
// Ported from spike/src/lib/env.ts (M0-SPIKE-PLAN.md §2). Node-only: imported
// through the "@workbench/core/node" entry so the browser bundle never pulls
// this in. Never logs the key itself; see `redact()`.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import type { WorkspacePaths } from "../layout.js";

export type KeySource = "process" | "dotenv" | "registry";

const KEY_PATTERN = /sk-ant-[A-Za-z0-9_-]{10,}/g;

/** Parses a minimal `KEY=value` .env file. No interpolation, no export keyword. */
function parseDotEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function readDotEnvFile(repoRoot: string): Record<string, string> | undefined {
  const p = path.join(repoRoot, ".env");
  if (!fs.existsSync(p)) return undefined;
  try {
    return parseDotEnv(fs.readFileSync(p, "utf8"));
  } catch {
    return undefined;
  }
}

/**
 * Reads ANTHROPIC_API_KEY from the Windows user-level registry
 * (`HKCU\Environment`). Never logs the raw reg query output. Returns
 * undefined off-Windows or if not found.
 */
function readFromWindowsRegistry(): string | undefined {
  if (process.platform !== "win32") return undefined;
  let stdout: string;
  try {
    stdout = execFileSync("reg", ["query", "HKCU\\Environment", "/v", "ANTHROPIC_API_KEY"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return undefined;
  }
  // Example line: "    ANTHROPIC_API_KEY    REG_SZ    sk-ant-xxxx"
  // (also handles REG_EXPAND_SZ)
  const m = /ANTHROPIC_API_KEY\s+REG_(?:SZ|EXPAND_SZ)\s+(\S.*)$/m.exec(stdout);
  if (!m) return undefined;
  const value = m[1]!.trim();
  return value.length > 0 ? value : undefined;
}

export interface ResolvedKey {
  key: string;
  source: KeySource;
}

let _resolved: ResolvedKey | undefined;
let _resolvedFor: string | undefined;

/**
 * Resolves ANTHROPIC_API_KEY in order: process env, repo-root `.env`, the
 * Windows user environment variable (HKCU\Environment). Caches the result
 * per repo root. Sets `process.env.ANTHROPIC_API_KEY` as a side effect so it
 * is available to this process and to spawned children, mirroring the spike.
 */
export function resolveApiKey(repoRoot: string): ResolvedKey | undefined {
  if (_resolved && _resolvedFor === repoRoot) return _resolved;

  if (process.env.ANTHROPIC_API_KEY) {
    _resolved = { key: process.env.ANTHROPIC_API_KEY, source: "process" };
    _resolvedFor = repoRoot;
    return _resolved;
  }

  const dotenv = readDotEnvFile(repoRoot);
  if (dotenv?.ANTHROPIC_API_KEY) {
    _resolved = { key: dotenv.ANTHROPIC_API_KEY, source: "dotenv" };
    _resolvedFor = repoRoot;
    process.env.ANTHROPIC_API_KEY = _resolved.key;
    return _resolved;
  }

  const fromRegistry = readFromWindowsRegistry();
  if (fromRegistry) {
    _resolved = { key: fromRegistry, source: "registry" };
    _resolvedFor = repoRoot;
    process.env.ANTHROPIC_API_KEY = _resolved.key;
    return _resolved;
  }

  _resolved = undefined;
  _resolvedFor = repoRoot;
  return undefined;
}

/** Throws if no API key could be resolved. Call before any SDK run. */
export function assertApiKey(repoRoot: string): ResolvedKey {
  const resolved = resolveApiKey(repoRoot);
  if (!resolved) {
    throw new Error(
      "ANTHROPIC_API_KEY not found (checked process env, the repo-root .env, and " +
        "HKCU\\Environment on Windows). Create a .env at the repo root (git-ignored), " +
        "or set a user-level environment variable and restart the shell.",
    );
  }
  return resolved;
}

/**
 * Replaces the resolved API key (and any sk-ant-... looking token) with
 * [REDACTED]. Every transcript or log line goes through this (CLAUDE.md
 * rule 8).
 */
export function redact(text: string): string {
  let out = text;
  if (_resolved?.key) {
    out = out.split(_resolved.key).join("[REDACTED]");
  }
  out = out.replace(KEY_PATTERN, "[REDACTED]");
  return out;
}

const PARENT_SESSION_VAR_PREFIXES = ["CLAUDE_CODE_", "CLAUDE_AGENT_SDK_"];
const PARENT_SESSION_VARS = [
  "CLAUDECODE",
  "CLAUDE_CODE_ENTRYPOINT",
  "CLAUDE_CODE_SSE_PORT",
  "ANTHROPIC_AUTH_TOKEN",
  "CLAUDE_CODE_OAUTH_TOKEN",
];

/**
 * A clean env for a spawned SDK child (ARCHITECTURE.md §8.2): a copy of
 * process.env with the resolved API key set, every variable that would leak
 * *this* Claude Code session removed (so the child authenticates with the
 * API key, not the user's subscription), and `CLAUDE_CONFIG_DIR` pinned to
 * the workspace's own config dir (resume depends on it staying stable, M0
 * S5).
 */
export function sdkEnv(repoRoot: string, workspace: WorkspacePaths): NodeJS.ProcessEnv {
  const resolved = assertApiKey(repoRoot);
  const env: NodeJS.ProcessEnv = { ...process.env };
  env.ANTHROPIC_API_KEY = resolved.key;
  env.CLAUDE_CONFIG_DIR = workspace.claudeConfigDir;

  for (const name of Object.keys(env)) {
    if (name === "CLAUDE_CONFIG_DIR") continue;
    const matchesPrefix = PARENT_SESSION_VAR_PREFIXES.some((p) => name.startsWith(p));
    const matchesExact = PARENT_SESSION_VARS.includes(name);
    if (matchesPrefix || matchesExact) {
      delete env[name];
    }
  }

  return env;
}
