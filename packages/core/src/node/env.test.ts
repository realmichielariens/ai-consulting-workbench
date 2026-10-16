import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { WorkspacePaths } from "../layout.js";
import { describeAuth, redact, resolveAuth, sdkEnv } from "./env.js";

const TOKEN = "sk-ant-oat01-test-token-aaaaaaaaaaaa";
const KEY = "sk-ant-api03-test-key-bbbbbbbbbbbb";
const VARS = ["CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY", "WORKBENCH_AUTH", "CLAUDE_CODE_ENTRYPOINT"];

// resolveAuth caches per repo root, so every test gets a fresh one.
function freshRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "wb-env-"));
}

const workspace = { claudeConfigDir: path.join(os.tmpdir(), "wb-claude-config") } as WorkspacePaths;

describe("resolveAuth / sdkEnv", () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const v of VARS) saved[v] = process.env[v];
    process.env.CLAUDE_CODE_OAUTH_TOKEN = TOKEN;
    process.env.ANTHROPIC_API_KEY = KEY;
    delete process.env.WORKBENCH_AUTH;
  });
  afterEach(() => {
    for (const v of VARS) {
      if (saved[v] === undefined) delete process.env[v];
      else process.env[v] = saved[v];
    }
  });

  it("prefers the subscription token over the API key", () => {
    const root = freshRoot();
    expect(resolveAuth(root)).toMatchObject({ mode: "subscription", variable: "CLAUDE_CODE_OAUTH_TOKEN", source: "process" });
    expect(describeAuth(root)).toBe("subscription (CLAUDE_CODE_OAUTH_TOKEN from process)");
  });

  it("WORKBENCH_AUTH=api-key forces the API key", () => {
    process.env.WORKBENCH_AUTH = "api-key";
    expect(resolveAuth(freshRoot())).toMatchObject({ mode: "api-key", variable: "ANTHROPIC_API_KEY" });
  });

  it("gives the child exactly one credential and strips parent-session vars", () => {
    process.env.CLAUDE_CODE_ENTRYPOINT = "vscode";
    const env = sdkEnv(freshRoot(), workspace);
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe(TOKEN);
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.CLAUDE_CODE_ENTRYPOINT).toBeUndefined();
    expect(env.CLAUDE_CONFIG_DIR).toBe(workspace.claudeConfigDir);
  });

  it("in api-key mode the child gets no token", () => {
    process.env.WORKBENCH_AUTH = "api-key";
    const env = sdkEnv(freshRoot(), workspace);
    expect(env.ANTHROPIC_API_KEY).toBe(KEY);
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
  });

  it("redacts the subscription token", () => {
    resolveAuth(freshRoot());
    expect(redact(`token=${TOKEN}`)).toBe("token=[REDACTED]");
  });
});
