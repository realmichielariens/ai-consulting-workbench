import { describe, expect, test } from "vitest";
import path from "node:path";
import { activeProfile } from "../config.js";
import { loadConfig, repoRoot } from "./config-loader.js";

describe("repoRoot", () => {
  test("finds the directory containing pnpm-workspace.yaml", () => {
    const root = repoRoot(import.meta.dirname);
    expect(root).toBe(path.resolve(import.meta.dirname, "..", "..", "..", ".."));
  });
});

describe("loadConfig", () => {
  test("reads workbench.config.yaml and validates it", () => {
    const config = loadConfig(repoRoot(import.meta.dirname));
    expect(config.profile).toBe("test");
    expect(activeProfile(config).models.work).toBe("claude-haiku-4-5");
    expect(config.server.port).toBe(4317);
    expect(config.server.webPort).toBe(5317);
  });

  test("resolves home, skillsPlugin and promptsDir to absolute paths under the repo root", () => {
    const root = repoRoot(import.meta.dirname);
    const config = loadConfig(root);
    expect(config.resolved.home).toBe(path.resolve(root, "workspace"));
    expect(config.resolved.skillsPlugin).toBe(path.resolve(root, "workbench-skills"));
    expect(config.resolved.promptsDir).toBe(path.resolve(root, "packages/agents/prompts"));
    expect(path.isAbsolute(config.resolved.home)).toBe(true);
  });

  test("the active profile is one of the declared profiles", () => {
    const config = loadConfig(repoRoot(import.meta.dirname));
    expect(Object.keys(config.profiles)).toContain(config.profile);
  });
});
