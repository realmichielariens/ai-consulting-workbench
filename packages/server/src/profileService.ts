// J2.8 — the workspace-wide model profile. Stored outside any one
// engagement (`<workspace home>/.workbench/settings.json`) since it applies
// to every engagement's new runs. A currently running session keeps the
// profile it started with (its model/maxTurns were already baked into the
// Run row and the runtime process); only a *new* run reads this.

import fs from "node:fs";
import path from "node:path";
import { activeProfile, type ModelProfile } from "@workbench/core";
import type { ServerContext } from "./engagementContext.js";

interface StoredProfileSettings {
  profile?: string;
}

function settingsFile(server: ServerContext): string {
  return path.join(server.workspace.home, ".workbench", "settings.json");
}

function readStoredProfileName(server: ServerContext): string | null {
  const file = settingsFile(server);
  if (!fs.existsSync(file)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8")) as StoredProfileSettings;
    return data.profile && data.profile in server.config.profiles ? data.profile : null;
  } catch {
    return null; // corrupt/partial write — fall back to the config default rather than fail every run
  }
}

export function activeProfileName(server: ServerContext): string {
  return readStoredProfileName(server) ?? server.config.profile;
}

/** Read by every *new* run at launch (runService.ts, approachRunner.ts) — never cached on EngagementContext. */
export function currentModelProfile(server: ServerContext): ModelProfile {
  return server.config.profiles[activeProfileName(server)] ?? activeProfile(server.config);
}

export function listProfileNames(server: ServerContext): string[] {
  return Object.keys(server.config.profiles);
}

export function setActiveProfile(server: ServerContext, name: string): void {
  if (!(name in server.config.profiles)) throw new Error(`no such profile: ${name}`);
  const file = settingsFile(server);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ profile: name }, null, 2), "utf8");
}
