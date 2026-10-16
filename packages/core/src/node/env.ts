// Resolves the SDK child's credential (a Claude subscription token or an
// ANTHROPIC_API_KEY) and builds a clean env for spawned SDK children.
// Ported from spike/src/lib/env.ts (M0-SPIKE-PLAN.md §2). Node-only: imported
// through the "@workbench/core/node" entry so the browser bundle never pulls
// this in. Never logs a credential itself; see `redact()`.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import type { WorkspacePaths } from "../layout.js";
import { SECRET_REF_RE } from "../sources.js";

export type KeySource = "process" | "dotenv" | "registry";

/** `subscription` bills the user's Claude Pro/Max plan; `api-key` bills API credits. */
export type AuthMode = "subscription" | "api-key";

const OAUTH_TOKEN_VAR = "CLAUDE_CODE_OAUTH_TOKEN";
const API_KEY_VAR = "ANTHROPIC_API_KEY";

export interface ResolvedAuth {
  mode: AuthMode;
  /** The env variable the SDK child receives the credential in. */
  variable: typeof OAUTH_TOKEN_VAR | typeof API_KEY_VAR;
  secret: string;
  source: KeySource;
}

// Covers API keys (sk-ant-api…) and `claude setup-token` tokens (sk-ant-oat…).
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
 * Reads `name` from the Windows user-level registry (`HKCU\Environment`), so
 * a variable set with setx works without restarting the editor. Never logs
 * the raw reg query output. Returns undefined off-Windows or if not found.
 */
function readFromWindowsRegistry(name: string): string | undefined {
  if (process.platform !== "win32") return undefined;
  let stdout: string;
  try {
    stdout = execFileSync("reg", ["query", "HKCU\\Environment", "/v", name], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return undefined;
  }
  // Example line: "    ANTHROPIC_API_KEY    REG_SZ    sk-ant-xxxx"
  // (also handles REG_EXPAND_SZ)
  const m = new RegExp(`${name}\\s+REG_(?:SZ|EXPAND_SZ)\\s+(\\S.*)$`, "m").exec(stdout);
  if (!m) return undefined;
  const value = m[1]!.trim();
  return value.length > 0 ? value : undefined;
}

/** Looks `name` up in order: process env, repo-root `.env`, HKCU\Environment. */
function resolveVar(repoRoot: string, name: string): { value: string; source: KeySource } | undefined {
  const fromProcess = process.env[name];
  if (fromProcess) return { value: fromProcess, source: "process" };
  const fromDotEnv = readDotEnvFile(repoRoot)?.[name];
  if (fromDotEnv) return { value: fromDotEnv, source: "dotenv" };
  const fromRegistry = readFromWindowsRegistry(name);
  if (fromRegistry) return { value: fromRegistry, source: "registry" };
  return undefined;
}

let _resolved: ResolvedAuth | undefined;
let _resolvedFor: string | undefined;
// Every secret ever resolved, so redact() still masks a credential after a
// re-resolution for another repo root.
const _secrets = new Set<string>();

/**
 * Picks the SDK child's credential. The subscription token
 * (CLAUDE_CODE_OAUTH_TOKEN, from `claude setup-token`) wins over
 * ANTHROPIC_API_KEY so runs draw on the Pro/Max plan, not API credits;
 * WORKBENCH_AUTH=api-key (or =subscription) forces one. Each variable is
 * looked up in process env, the repo-root `.env`, then HKCU\Environment.
 * Cached per repo root.
 */
export function resolveAuth(repoRoot: string): ResolvedAuth | undefined {
  if (_resolvedFor === repoRoot) return _resolved;

  const forced = process.env.WORKBENCH_AUTH;
  const order: AuthMode[] =
    forced === "api-key" ? ["api-key"] : forced === "subscription" ? ["subscription"] : ["subscription", "api-key"];

  _resolved = undefined;
  for (const mode of order) {
    const variable = mode === "subscription" ? OAUTH_TOKEN_VAR : API_KEY_VAR;
    const found = resolveVar(repoRoot, variable);
    if (found) {
      _resolved = { mode, variable, secret: found.value, source: found.source };
      _secrets.add(found.value);
      break;
    }
  }
  _resolvedFor = repoRoot;
  return _resolved;
}

// Shorter values (e.g. "1", "eu") are not masked: splitting every log line on
// them would garble transcripts, and a value that short is no credential.
const MIN_REDACTED_REF_LENGTH = 4;

/**
 * Resolves one `${env:NAME}` reference from a user source listing
 * (sources.ts), in the same order as the credential: process env, repo-root
 * `.env`, HKCU\Environment. The value is registered with redact(), since a
 * reference usually stands for a secret.
 */
export function resolveEnvRef(repoRoot: string, name: string): string | undefined {
  const found = resolveVar(repoRoot, name);
  if (!found) return undefined;
  if (found.value.length >= MIN_REDACTED_REF_LENGTH) _secrets.add(found.value);
  return found.value;
}

/**
 * Replaces every `${env:NAME}` inside the values of `record` (a stdio env or
 * http headers). Either every reference resolves, or nothing is returned but
 * the names that did not, so a half-resolved header never reaches a server.
 */
export function resolveSecretRefs(
  repoRoot: string,
  record: Record<string, string>,
  lookup: (name: string) => string | undefined = (name) => resolveEnvRef(repoRoot, name),
): { ok: true; value: Record<string, string> } | { ok: false; missing: string[] } {
  const missing = new Set<string>();
  const value: Record<string, string> = {};
  for (const [key, raw] of Object.entries(record)) {
    value[key] = raw.replace(new RegExp(SECRET_REF_RE.source, "g"), (_, name: string) => {
      const resolved = lookup(name);
      if (resolved === undefined) {
        missing.add(name);
        return "";
      }
      return resolved;
    });
  }
  return missing.size > 0 ? { ok: false, missing: [...missing] } : { ok: true, value };
}

/** Throws if no credential could be resolved. Call before any SDK run. */
export function assertAuth(repoRoot: string): ResolvedAuth {
  const resolved = resolveAuth(repoRoot);
  if (!resolved) {
    const forced = process.env.WORKBENCH_AUTH ? ` (WORKBENCH_AUTH=${process.env.WORKBENCH_AUTH})` : "";
    throw new Error(
      `No agent credential found${forced}: set ${OAUTH_TOKEN_VAR} (from \`claude setup-token\`, uses your ` +
        `Claude subscription) or ${API_KEY_VAR} (API credits) in the process env, the repo-root .env ` +
        "(git-ignored), or a user-level environment variable.",
    );
  }
  return resolved;
}

/** A one-line, secret-free description for startup logs, e.g. "subscription (CLAUDE_CODE_OAUTH_TOKEN from registry)". */
export function describeAuth(repoRoot: string): string {
  const resolved = resolveAuth(repoRoot);
  if (!resolved) return "none (no CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY found)";
  return `${resolved.mode} (${resolved.variable} from ${resolved.source})`;
}

/**
 * Replaces every resolved credential (and any sk-ant-... looking token) with
 * [REDACTED]. Every transcript or log line goes through this (CLAUDE.md
 * rule 8).
 */
export function redact(text: string): string {
  let out = text;
  for (const secret of _secrets) {
    out = out.split(secret).join("[REDACTED]");
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
  OAUTH_TOKEN_VAR,
  API_KEY_VAR,
];

/**
 * A clean env for a spawned SDK child (ARCHITECTURE.md §8.2): a copy of
 * process.env with every variable that would leak *this* Claude Code session
 * (or a second credential) removed, then exactly one credential set — so the
 * child's billing is the one resolveAuth() chose, since the CLI prefers an
 * API key over a token when both are present — and `CLAUDE_CONFIG_DIR`
 * pinned to the workspace's own config dir (resume depends on it staying
 * stable, M0 S5).
 */
export function sdkEnv(
  repoRoot: string,
  workspace: WorkspacePaths,
  opts: { requireAuth?: boolean } = {},
): NodeJS.ProcessEnv {
  // A source connection test (no model call) can start the CLI without a credential.
  const auth = opts.requireAuth === false ? resolveAuth(repoRoot) : assertAuth(repoRoot);
  const env: NodeJS.ProcessEnv = { ...process.env };

  for (const name of Object.keys(env)) {
    const matchesPrefix = PARENT_SESSION_VAR_PREFIXES.some((p) => name.startsWith(p));
    const matchesExact = PARENT_SESSION_VARS.includes(name);
    if (matchesPrefix || matchesExact) {
      delete env[name];
    }
  }

  if (auth) env[auth.variable] = auth.secret;
  env.CLAUDE_CONFIG_DIR = workspace.claudeConfigDir;
  return env;
}
