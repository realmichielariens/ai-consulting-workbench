// Resolves ANTHROPIC_API_KEY and the rest of the spike's config, without
// ever printing, logging or committing the key. See spike/README.md and
// M0-SPIKE-PLAN.md §2 for the resolution order this implements.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

export type KeySource = "process" | "dotenv" | "registry";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// spike/src/lib -> spike
export const spikeRoot = path.resolve(__dirname, "..", "..");
export const resultsDir = path.join(spikeRoot, "results");
export const rawDir = path.join(resultsDir, "raw");

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
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function readDotEnvFile(): Record<string, string> | undefined {
  const p = path.join(spikeRoot, ".env");
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
    stdout = execFileSync(
      "reg",
      ["query", "HKCU\\Environment", "/v", "ANTHROPIC_API_KEY"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
  } catch {
    return undefined;
  }
  // Example line: "    ANTHROPIC_API_KEY    REG_SZ    sk-ant-xxxx"
  // (also handles REG_EXPAND_SZ)
  const m = /ANTHROPIC_API_KEY\s+REG_(?:SZ|EXPAND_SZ)\s+(\S.*)$/m.exec(stdout);
  if (!m) return undefined;
  const value = m[1].trim();
  return value.length > 0 ? value : undefined;
}

let _resolved: { key: string; source: KeySource } | undefined;
let _loggedRemovedVars = false;

function resolveKey(): { key: string; source: KeySource } | undefined {
  if (_resolved) return _resolved;

  if (process.env.ANTHROPIC_API_KEY) {
    _resolved = { key: process.env.ANTHROPIC_API_KEY, source: "process" };
    return _resolved;
  }

  const dotenv = readDotEnvFile();
  if (dotenv?.ANTHROPIC_API_KEY) {
    _resolved = { key: dotenv.ANTHROPIC_API_KEY, source: "dotenv" };
    return _resolved;
  }

  const fromRegistry = readFromWindowsRegistry();
  if (fromRegistry) {
    _resolved = { key: fromRegistry, source: "registry" };
    return _resolved;
  }

  return undefined;
}

const resolved = resolveKey();
if (resolved) {
  // Make it available to this process and to spawned children.
  process.env.ANTHROPIC_API_KEY = resolved.key;
}

const dotenvValues = readDotEnvFile();

export const config = {
  model: process.env.SPIKE_MODEL || dotenvValues?.SPIKE_MODEL || "claude-haiku-4-5",
  totalCapUsd: Number(
    process.env.SPIKE_TOTAL_CAP_USD || dotenvValues?.SPIKE_TOTAL_CAP_USD || "10",
  ),
  spikeRoot,
  resultsDir,
  rawDir,
  keySource: resolved?.source as KeySource | undefined,
};

/** Throws if no API key could be resolved. Call before any SDK run. */
export function assertKey(): void {
  if (!resolved || !process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      "ANTHROPIC_API_KEY not found (checked process env, spike/.env, and " +
        "HKCU\\Environment on Windows). Create spike/.env from .env.example, " +
        "or set a user-level environment variable and restart the shell.",
    );
  }
}

/** Replaces the API key (and any sk-ant-... looking token) with [REDACTED]. */
export function redact(text: string): string {
  let out = text;
  if (resolved?.key) {
    out = out.split(resolved.key).join("[REDACTED]");
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

// Variables we deliberately set ourselves and that therefore must NOT be
// stripped by the CLAUDE_CODE_*/CLAUDE_AGENT_SDK_* prefix rule below.
const DELIBERATE_VARS = new Set(["CLAUDE_AGENT_SDK_CLIENT_APP", "CLAUDE_CONFIG_DIR"]);

/**
 * A copy of process.env suitable for a spawned SDK child: the API key is
 * set, and variables that would leak the *parent* Claude Code session
 * (this very session, since SCAFFOLD itself runs under Claude Code) are
 * removed so the child authenticates with the API key, not the user's
 * subscription. Prints the names (never values) of removed vars once, to
 * stderr.
 */
export function childEnv(extra?: Record<string, string | undefined>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (resolved?.key) {
    env.ANTHROPIC_API_KEY = resolved.key;
  }

  // Default every spawned SDK child's session transcripts under
  // results/raw/claude-config/ instead of the user's ~/.claude/projects/.
  // Confirmed working in S0 (experiments/s00-smoke/FINDINGS.md): the
  // transcript moves there, init stays clean, and ~/.claude is untouched.
  // `extra` (below) can still override this per call.
  env.CLAUDE_CONFIG_DIR = path.join(rawDir, "claude-config");

  const removed: string[] = [];
  for (const name of Object.keys(env)) {
    if (DELIBERATE_VARS.has(name)) continue;
    const matchesPrefix = PARENT_SESSION_VAR_PREFIXES.some((p) => name.startsWith(p));
    const matchesExact = PARENT_SESSION_VARS.includes(name);
    if (matchesPrefix || matchesExact) {
      delete env[name];
      removed.push(name);
    }
  }

  if (removed.length > 0 && !_loggedRemovedVars) {
    process.stderr.write(
      `[env] removed parent-session env vars before spawning SDK child: ${removed.join(", ")}\n`,
    );
    _loggedRemovedVars = true;
  }

  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      if (v === undefined) delete env[k];
      else env[k] = v;
    }
  }

  return env;
}
