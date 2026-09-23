// Seed format. It equals the playbook starter-plan format (ARCHITECTURE.md §5.1:
// playbook.md, plan.template.yaml, defaults.yaml, examples/), so I7 can promote a
// seed to the first library playbook without a new format.
//
//   demo/seeds/<id>/
//   ├── seed.yaml             # SeedManifest (a playbook has playbook.md with the same fields as front-matter)
//   ├── defaults.yaml         # SeedDefaults: settings for the new engagement
//   ├── plan.template.yaml    # PlanTemplate: the items, briefs included
//   └── assets/<ItemId>/<slot>.<format>
//                             # published as v1.0 when the engagement is created
//                             # (author "human", note "From seed <id>"), e.g. assets/ENG/context.md
//
// Placeholders ({{client}}) are reserved for I7 playbooks; I1 seeds contain none.

import { z } from "zod";
import { ItemFrontMatter, Settings } from "./domain.js";

export const SeedManifest = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
  title: z.string().min(1),
  /** One line, shown on the start page (J1.1). */
  description: z.string().min(1),
  /** Default engagement name offered on the start page. */
  engagementName: z.string().min(1),
});
export type SeedManifest = z.infer<typeof SeedManifest>;

/** Unspecified settings take their Settings defaults, so `settings` is always complete after parsing. */
export const SeedDefaults = z.object({
  settings: Settings.default(Settings.parse({})),
});
export type SeedDefaults = z.infer<typeof SeedDefaults>;

/** One item in plan.template.yaml: the item.md front-matter plus the brief as a YAML block string. */
export const PlanTemplateItem = ItemFrontMatter.extend({
  brief: z.string().min(1),
});
export type PlanTemplateItem = z.infer<typeof PlanTemplateItem>;

/**
 * plan.template.yaml. Must contain the ENG item (executor null), whose outputs are the
 * engagement assets (context, stakeholders, …) provided under assets/ENG/.
 * Validation beyond the schema (W4 seed loader): unique ids, parents exist, every input
 * slot is some item's output, every seed asset matches an output slot, no cycles.
 */
export const PlanTemplate = z.object({
  items: z.array(PlanTemplateItem).min(1),
});
export type PlanTemplate = z.infer<typeof PlanTemplate>;

export const SEED_FILES = {
  manifest: "seed.yaml",
  defaults: "defaults.yaml",
  plan: "plan.template.yaml",
  assetsDir: "assets",
} as const;
