// The skill catalog: what the workbench-skills plugin offers, read from each
// skill's SKILL.md front-matter. Read fresh on every call (a handful of small
// files) so an edited skill is picked up without restarting the server.
// Skills say *how* to do a kind of work; they grant no tools. Tools come from
// the Sources attached to a task (sourceResolver.ts).

import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

export interface SkillInfo {
  name: string;
  description: string;
}

const FrontMatter = z.object({
  name: z.string().min(1),
  description: z.string().default(""),
});

const FRONT_MATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/;

/** Every skill under <pluginDir>/skills/*\/SKILL.md, sorted by name. A malformed SKILL.md is skipped, not fatal. */
export function loadSkillCatalog(pluginDir: string): SkillInfo[] {
  const skillsDir = path.join(pluginDir, "skills");
  if (!fs.existsSync(skillsDir)) return [];
  const out: SkillInfo[] = [];
  for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = path.join(skillsDir, entry.name, "SKILL.md");
    if (!fs.existsSync(file)) continue;
    const m = FRONT_MATTER_RE.exec(fs.readFileSync(file, "utf8"));
    if (!m) continue;
    const parsed = FrontMatter.safeParse(parseYaml(m[1]!));
    if (!parsed.success) continue;
    out.push({ name: parsed.data.name, description: parsed.data.description.trim() });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Skill names on an item that the plugin does not have; the SDK would silently never offer them. */
export function unknownSkills(catalog: readonly SkillInfo[], skills: readonly string[]): string[] {
  const names = new Set(catalog.map((s) => s.name));
  return skills.filter((s) => !names.has(s));
}

/**
 * The catalog as Markdown for the Approach Agent's system prompt. The
 * protocol skill is left out: the runtime adds it itself, it is never
 * assigned to an item.
 */
export function renderSkillCatalog(catalog: readonly SkillInfo[]): string {
  const assignable = catalog.filter((s) => s.name !== "workbench-protocol");
  if (assignable.length === 0) return "(no skills available)";
  return assignable.map((s) => `- \`${s.name}\`: ${s.description}`).join("\n");
}
