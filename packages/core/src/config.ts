// workbench.config.yaml (ARCHITECTURE.md §4). SCAFFOLD implements the loader;
// this file is the contract for its shape and defaults.

import { z } from "zod";

export const ModelProfile = z.object({
  models: z.object({
    approach: z.string(),
    work: z.string(),
    assist: z.string(),
  }),
  limits: z.object({
    maxTurnsPerRun: z.number().int().positive(),
    maxConcurrentRuns: z.number().int().positive(),
  }),
});
export type ModelProfile = z.infer<typeof ModelProfile>;

/**
 * The models Settings offers as a per-role override of the active profile.
 * A closed list, so the UI cannot send a model id the SDK would reject mid-run.
 */
export const MODEL_CHOICES = [
  { id: "claude-haiku-4-5", label: "Haiku 4.5" },
  { id: "claude-sonnet-5", label: "Sonnet 5" },
  { id: "claude-opus-5-5", label: "Opus 5.5" },
] as const;
export const ModelChoiceId = z.enum(MODEL_CHOICES.map((m) => m.id) as [string, ...string[]]);
export type ModelChoiceId = z.infer<typeof ModelChoiceId>;

/**
 * Reasoning effort for every agent run (the SDK's `effort` option). Workspace-wide,
 * set in Settings. The CLI silently downgrades a level the selected model does not support.
 */
export const EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const;
export const EffortLevel = z.enum(EFFORT_LEVELS);
export type EffortLevel = z.infer<typeof EffortLevel>;
export const DEFAULT_EFFORT: EffortLevel = "high";

export const WorkbenchConfig = z
  .object({
    /** Workbench home, relative to the repo root or absolute. Git-ignored by default. */
    home: z.string().default("./workspace"),
    /** Active profile name. "test" (Haiku) is the default; "demo" is switched on explicitly. */
    profile: z.string().default("test"),
    profiles: z.record(z.string(), ModelProfile),
    /** The workbench-skills plugin folder (ARCHITECTURE.md §8.7). */
    skillsPlugin: z.string().default("./workbench-skills"),
    /** The Source Catalog folder: one listing per *.yaml, mock datasets under data/ (sources.ts). */
    sourcesCatalog: z.string().default("./workbench-sources"),
    /** Versioned prompt files (ARCHITECTURE.md §8.8). */
    promptsDir: z.string().default("./packages/agents/prompts"),
    server: z
      .object({
        port: z.number().int().default(4317),
        webPort: z.number().int().default(5317),
      })
      .default({ port: 4317, webPort: 5317 }),
  })
  .refine((c) => c.profile in c.profiles, { message: "profile must name an entry in profiles" });
export type WorkbenchConfig = z.infer<typeof WorkbenchConfig>;

/** The content SCAFFOLD writes to workbench.config.yaml. */
export const DEFAULT_CONFIG_YAML = `# Workbench configuration (ARCHITECTURE.md §4)
home: ./workspace
profile: test                     # test | demo
profiles:
  test:
    models: { approach: claude-haiku-4-5, work: claude-haiku-4-5, assist: claude-haiku-4-5 }
    limits: { maxTurnsPerRun: 40, maxConcurrentRuns: 3 }
  demo:
    models: { approach: claude-opus-5-5, work: claude-opus-5-5, assist: claude-opus-5-5 }
    limits: { maxTurnsPerRun: 80, maxConcurrentRuns: 3 }
skillsPlugin: ./workbench-skills
sourcesCatalog: ./workbench-sources
promptsDir: ./packages/agents/prompts
server: { port: 4317, webPort: 5317 }
`;

export const activeProfile = (c: WorkbenchConfig): ModelProfile => c.profiles[c.profile]!;
