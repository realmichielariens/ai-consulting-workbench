// YAML script format for the scripted fake agent (fake-scripts/*.yaml, one
// file per item id, keyed by run reason). Each step is validated with Zod so
// a malformed script fails loudly at load time rather than silently no-op'ing.

import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { ProposePlanChangeInput, PublishAssetInput, RaiseQuestionInput, RunOutcome, SubmitOutputsInput } from "@workbench/core";

export const FakeStep = z.union([
  z.object({ text: z.string() }).strict(),
  /** Emits a "Read <slot> vX.Y" activity; the slot is looked up against the run's pinned inputs. No real I/O. */
  z.object({ read: z.string() }).strict(),
  /** REALLY writes `content` to `path` inside the item's own work/. */
  z.object({ write: z.object({ path: z.string().min(1), content: z.string() }).strict() }).strict(),
  z.object({ publish: PublishAssetInput }).strict(),
  z.object({ worklog: z.string().min(1) }).strict(),
  z.object({ question: RaiseQuestionInput }).strict(),
  z.object({ progress: z.string().min(1) }).strict(),
  z.object({ submit: SubmitOutputsInput }).strict(),
  /** propose_plan_change (J2.5): non-blocking, the script keeps going after it. */
  z.object({ suggest: ProposePlanChangeInput }).strict(),
  /** Emits a denial activity for a demo (R4); does not call any real guard. */
  z.object({ deny: z.object({ tool: z.string(), reason: z.string() }).strict() }).strict(),
  /** Forces the run's outcome and stops the script there (R3 demos). */
  z.object({ end: RunOutcome }).strict(),
]);
export type FakeStep = z.infer<typeof FakeStep>;

/** Keyed by RunReason ("start", "resume-answer", "changes-requested", "resume"). */
export const FakeItemScript = z.record(z.string(), z.array(FakeStep));
export type FakeItemScript = z.infer<typeof FakeItemScript>;

const cache = new Map<string, FakeItemScript | null>();

/** Loads fake-scripts/<itemId>.yaml, or null if that item has no dedicated script (the caller falls back). */
export function loadFakeScript(scriptsDir: string, itemId: string): FakeItemScript | null {
  const key = path.join(scriptsDir, `${itemId}.yaml`);
  if (cache.has(key)) return cache.get(key)!;
  if (!fs.existsSync(key)) {
    cache.set(key, null);
    return null;
  }
  const raw: unknown = parseYaml(fs.readFileSync(key, "utf8"));
  const parsed = FakeItemScript.parse(raw);
  cache.set(key, parsed);
  return parsed;
}
