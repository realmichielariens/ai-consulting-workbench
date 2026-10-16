// J2.8 — the workspace-wide model profile. Stored outside any one
// engagement (`<workspace home>/.workbench/settings.json`) since it applies
// to every engagement's new runs. A currently running session keeps the
// profile it started with (its model/maxTurns were already baked into the
// Run row and the runtime process); only a *new* run reads this.
//
// Reasoning effort is stored here too: one level for every agent, default "high".
//
// Settings can also override the profile's model per role (approach, work).
// The override is kept apart from the profile name so switching profiles
// keeps the chosen model, and clearing it falls back to the profile's.

import fs from "node:fs";
import path from "node:path";
import { activeProfile, DEFAULT_EFFORT, EffortLevel, ModelChoiceId, type ModelProfile } from "@workbench/core";
import type { ServerContext } from "./engagementContext.js";

export type ModelRole = "approach" | "work";
export type ModelOverrides = Record<ModelRole, string | null>;

interface StoredProfileSettings {
  profile?: string;
  models?: Partial<Record<ModelRole, string>>;
  effort?: string;
}

function settingsFile(server: ServerContext): string {
  return path.join(server.workspace.home, ".workbench", "settings.json");
}

function readStored(server: ServerContext): StoredProfileSettings {
  const file = settingsFile(server);
  if (!fs.existsSync(file)) return {};
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as StoredProfileSettings;
  } catch {
    return {}; // corrupt/partial write — fall back to the config default rather than fail every run
  }
}

function writeStored(server: ServerContext, data: StoredProfileSettings): void {
  const file = settingsFile(server);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

export function activeProfileName(server: ServerContext): string {
  const stored = readStored(server).profile;
  return stored && stored in server.config.profiles ? stored : server.config.profile;
}

/** Hand-edited or stale ids (a model dropped from MODEL_CHOICES) are ignored, not passed to the SDK. */
export function modelOverrides(server: ServerContext): ModelOverrides {
  const models = readStored(server).models ?? {};
  const valid = (id: string | undefined) => (ModelChoiceId.safeParse(id).success ? id! : null);
  return { approach: valid(models.approach), work: valid(models.work) };
}

/** The active profile before overrides. */
export function baseModelProfile(server: ServerContext): ModelProfile {
  return server.config.profiles[activeProfileName(server)] ?? activeProfile(server.config);
}

/** Read by every *new* run at launch (runService.ts, approachRunner.ts) — never cached on EngagementContext. */
export function currentModelProfile(server: ServerContext): ModelProfile {
  const base = baseModelProfile(server);
  const o = modelOverrides(server);
  return { ...base, models: { ...base.models, approach: o.approach ?? base.models.approach, work: o.work ?? base.models.work } };
}

export function listProfileNames(server: ServerContext): string[] {
  return Object.keys(server.config.profiles);
}

export function setActiveProfile(server: ServerContext, name: string): void {
  if (!(name in server.config.profiles)) throw new Error(`no such profile: ${name}`);
  writeStored(server, { ...readStored(server), profile: name });
}

/** null clears a role's override; an omitted role keeps its current value. */
export function setModelOverrides(server: ServerContext, changes: Partial<ModelOverrides>): void {
  const stored = readStored(server);
  const models = { ...stored.models };
  for (const role of ["approach", "work"] as const) {
    const value = changes[role];
    if (value === undefined) continue;
    if (value === null) delete models[role];
    else models[role] = ModelChoiceId.parse(value);
  }
  writeStored(server, { ...stored, models });
}

/** Read by every *new* run at launch. A hand-edited, unknown level falls back to the default. */
export function currentEffort(server: ServerContext): EffortLevel {
  const parsed = EffortLevel.safeParse(readStored(server).effort);
  return parsed.success ? parsed.data : DEFAULT_EFFORT;
}

export function setEffort(server: ServerContext, effort: EffortLevel): void {
  writeStored(server, { ...readStored(server), effort: EffortLevel.parse(effort) });
}
