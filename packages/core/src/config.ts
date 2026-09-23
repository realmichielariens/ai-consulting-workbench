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

export const WorkbenchConfig = z
  .object({
    /** Workbench home, relative to the repo root or absolute. Git-ignored by default. */
    home: z.string().default("./workspace"),
    /** Active profile name. "test" (Haiku) is the default; "demo" is switched on explicitly. */
    profile: z.string().default("test"),
    profiles: z.record(z.string(), ModelProfile),
    /** The workbench-skills plugin folder (ARCHITECTURE.md §8.7). */
    skillsPlugin: z.string().default("./workbench-skills"),
    /** Versioned prompt files (ARCHITECTURE.md §8.8). */
    promptsDir: z.string().default("./packages/agents/prompts"),
    server: z
      .object({
        port: z.number().int().default(4317),
        webPort: z.number().int().default(5317),
      })
      .default({ port: 4317, webPort: 5317 }),
    dev: z
      .object({
        /** Total API spend the dev cost guard allows across the ledger (I1 plan §9). */
        totalCapUsd: z.number().positive().default(16),
      })
      .default({ totalCapUsd: 16 }),
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
promptsDir: ./packages/agents/prompts
server: { port: 4317, webPort: 5317 }
dev: { totalCapUsd: 16 }
`;

export const activeProfile = (c: WorkbenchConfig): ModelProfile => c.profiles[c.profile]!;
