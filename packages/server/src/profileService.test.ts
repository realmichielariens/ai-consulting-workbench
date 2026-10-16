import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ModelProfile } from "@workbench/core";
import type { ServerContext } from "./engagementContext.js";
import {
  activeProfileName,
  currentEffort,
  currentModelProfile,
  modelOverrides,
  setActiveProfile,
  setEffort,
  setModelOverrides,
} from "./profileService.js";

const profile = (model: string): ModelProfile => ({
  models: { approach: model, work: model, assist: model },
  limits: { maxTurnsPerRun: 40, maxConcurrentRuns: 3 },
});

// Only the fields profileService reads.
let home: string;
let server: ServerContext;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "wb-profile-"));
  server = {
    workspace: { home },
    config: { profile: "test", profiles: { test: profile("claude-haiku-4-5"), demo: profile("claude-opus-5-5") } },
  } as unknown as ServerContext;
});
afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

describe("profileService model overrides", () => {
  it("uses the profile's models when nothing is overridden", () => {
    expect(currentModelProfile(server).models).toMatchObject({ approach: "claude-haiku-4-5", work: "claude-haiku-4-5" });
    expect(modelOverrides(server)).toEqual({ approach: null, work: null });
  });

  it("overrides one role and keeps the override across a profile switch", () => {
    setModelOverrides(server, { approach: "claude-sonnet-5" });
    setActiveProfile(server, "demo");
    expect(activeProfileName(server)).toBe("demo");
    expect(currentModelProfile(server).models).toMatchObject({ approach: "claude-sonnet-5", work: "claude-opus-5-5" });
    expect(currentModelProfile(server).limits.maxTurnsPerRun).toBe(40);
  });

  it("clears an override with null and leaves the other role alone", () => {
    setModelOverrides(server, { approach: "claude-opus-5-5", work: "claude-sonnet-5" });
    setModelOverrides(server, { approach: null });
    expect(modelOverrides(server)).toEqual({ approach: null, work: "claude-sonnet-5" });
  });

  it("rejects a model outside the choices and ignores a hand-edited one", () => {
    expect(() => setModelOverrides(server, { work: "gpt-5" })).toThrow();
    fs.mkdirSync(path.join(home, ".workbench"), { recursive: true });
    fs.writeFileSync(path.join(home, ".workbench", "settings.json"), JSON.stringify({ models: { work: "claude-2" } }));
    expect(currentModelProfile(server).models.work).toBe("claude-haiku-4-5");
  });
});

describe("profileService reasoning effort", () => {
  it("defaults to high", () => {
    expect(currentEffort(server)).toBe("high");
  });

  it("stores a level without touching the model overrides", () => {
    setModelOverrides(server, { work: "claude-sonnet-5" });
    setEffort(server, "max");
    expect(currentEffort(server)).toBe("max");
    expect(modelOverrides(server).work).toBe("claude-sonnet-5");
  });

  it("rejects an unknown level and falls back to high for a hand-edited one", () => {
    expect(() => setEffort(server, "extreme" as never)).toThrow();
    fs.mkdirSync(path.join(home, ".workbench"), { recursive: true });
    fs.writeFileSync(path.join(home, ".workbench", "settings.json"), JSON.stringify({ effort: "turbo" }));
    expect(currentEffort(server)).toBe("high");
  });
});
