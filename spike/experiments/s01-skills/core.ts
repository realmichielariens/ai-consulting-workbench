// S1 core checks (M0-SPIKE-PLAN.md §4 "S1", ARCHITECTURE.md §17.1).
// Run standalone with: npx tsx experiments/s01-skills/core.ts
// Prefer run.ts, which runs this and addendum.ts together in order — see
// addendum.ts for follow-up probes triggered by surprises found here
// (Bash allow-rule scoping under dontAsk; more bundled-skill names).
//
// Uses the shared marker-skills plugin at spike/fixtures/plugin/workbench-skills/
// (alpha/beta/gamma — read-only, never modified here) plus a local copy under
// fixtures/fallback-project/.claude/skills/ for the settingSources:["project"]
// fallback (step 7). All checks use runQuery() per spike/README.md.
//
// Cap: $0.50 (EXPERIMENT_CAPS_USD.s01). Each run below is short (maxTurns 5,
// terse prompts) to fit many small checks in that budget. If the cap trips
// mid-script, remaining checks are recorded as "skip" with the reason, per
// spike/README.md convention 7 — this script does not throw uncaught.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runQuery, CostCapExceededError, type RunResult } from "../../src/lib/run.js";
import { check } from "../../src/lib/report.js";
import { redact, childEnv } from "../../src/lib/env.js";

const EXP = "s01-skills";
const EXP_DIR = path.dirname(fileURLToPath(import.meta.url));
const SPIKE_ROOT = path.resolve(EXP_DIR, "..", "..");
const PLUGIN_DIR = path.join(SPIKE_ROOT, "fixtures", "plugin", "workbench-skills");
const BETA_SKILL_MD = path.join(PLUGIN_DIR, "skills", "beta", "SKILL.md");
const FALLBACK_PROJECT_DIR = path.join(EXP_DIR, "fixtures", "fallback-project");

const toFwd = (p: string) => p.replace(/\\/g, "/");

const TOKENS = {
  alpha: "SKILL-ALPHA-OK-7f3",
  beta: "SKILL-BETA-OK-2c9",
  gamma: "SKILL-GAMMA-OK-a41",
  gammaScript: "SKILL-GAMMA-SCRIPT-OK-5d0",
};

// A bundled skill name confirmed present in this build's default surface by
// S0/S9 (init.skills included "simplify" in both, with no configuration of
// ours requesting it). Used as the adversarial target for steps 4/6.
const BUNDLED_TARGET = "simplify";

let stopped = false;
let stopReason = "";

function skillsOf(r: RunResult | undefined): string[] {
  const s = r?.init?.skills as unknown;
  if (!Array.isArray(s)) return [];
  return s.map((x) => (typeof x === "string" ? x : (x as any)?.name ?? (x as any)?.id ?? JSON.stringify(x)));
}

function toolResultTextFor(r: RunResult, toolUseId: string): string {
  return r.toolResults.filter((t) => t.toolUseId === toolUseId).map((t) => t.text).join("\n");
}

function skillCalls(r: RunResult): { id: string; input: unknown }[] {
  return r.toolCalls.filter((t) => t.name === "Skill").map((t) => ({ id: t.id, input: t.input }));
}

function bashCalls(r: RunResult): { id: string; input: unknown }[] {
  return r.toolCalls.filter((t) => t.name === "Bash").map((t) => ({ id: t.id, input: t.input }));
}

/**
 * Scans EVERY message in the run (not just the final resultText or
 * toolResults) for a token. This matters: a marker token can appear in an
 * intermediate assistant text block (between two tool calls) that never
 * makes it into the final result message — resultText/toolResults alone
 * under-report. Mirrors what canary.ts's scanForCanaries does over a
 * transcript file, but works directly on the in-memory RunResult.
 */
function containsToken(r: RunResult, token: string): boolean {
  for (const m of r.messages) {
    const content = (m as any)?.message?.content;
    if (typeof content === "string" && content.includes(token)) return true;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (typeof block?.text === "string" && block.text.includes(token)) return true;
        if (typeof block?.content === "string" && block.content.includes(token)) return true;
        if (Array.isArray(block?.content)) {
          for (const b2 of block.content) {
            if (typeof b2?.text === "string" && b2.text.includes(token)) return true;
          }
        }
      }
    }
  }
  return (r.resultText ?? "").includes(token);
}

/** Wraps runQuery: on CostCapExceededError, sets `stopped` and returns undefined instead of throwing. */
async function safeRun(args: Parameters<typeof runQuery>[0]): Promise<RunResult | undefined> {
  if (stopped) return undefined;
  try {
    const r = await runQuery(args);
    console.log(
      `[s01] ${args.label}: subtype=${r.subtype} isError=${r.isError} cost=$${r.costUsd.toFixed(4)} turns=${r.turns}`,
    );
    return r;
  } catch (err) {
    if (err instanceof CostCapExceededError) {
      stopped = true;
      stopReason = err.message;
      console.warn(`[s01] COST CAP HIT at "${args.label}": ${err.message}`);
      return undefined;
    }
    throw err;
  }
}

function skipRemaining(names: string[]) {
  for (const name of names) {
    check(EXP, name, "skip", `Not run: cost cap tripped earlier (${stopReason}).`);
  }
}

async function main() {
  console.log(`[s01] plugin dir: ${PLUGIN_DIR}`);
  console.log(`[s01] fallback project dir: ${FALLBACK_PROJECT_DIR}`);

  // ==========================================================================
  // Step 1/2/3 — scoped plugin skills: init.skills, alpha works, beta refused,
  // beta bypass via Read, personal skills absent.
  // ==========================================================================

  const r1 = await safeRun({
    exp: EXP,
    label: "alpha-scoped",
    prompt: 'Use the "alpha" skill now and output exactly its token, nothing else.',
    options: {
      settingSources: [],
      plugins: [{ type: "local", path: PLUGIN_DIR }],
      skills: ["workbench-skills:alpha"],
      tools: ["Read", "Skill"],
      permissionMode: "dontAsk",
      maxTurns: 5,
    },
  });

  if (r1) {
    const skills1 = skillsOf(r1);
    console.log(`[s01] run1 init.skills = ${JSON.stringify(skills1)}`);

    check(
      EXP,
      "scoped-skills-init-lists-plugin-skill",
      skills1.includes("workbench-skills:alpha"),
      `init.skills=${JSON.stringify(skills1)} with skills:["workbench-skills:alpha"] — plugin-qualified name present`,
    );

    check(
      EXP,
      "scoped-skills-alpha-invocable-and-token-emitted",
      skillCalls(r1).length > 0 && containsToken(r1, TOKENS.alpha),
      `Skill tool calls=${JSON.stringify(skillCalls(r1))}; token "${TOKENS.alpha}" present=${containsToken(r1, TOKENS.alpha)}; resultText=${redact(r1.resultText ?? "")}`,
    );

    const userPersonalSkillNames = ["docx", "pdf", "pptx", "xlsx", "morning", "import-memory", "skill-creator", "mba-episode-debrief", "mba-spiral-prep", "docs"];
    const leaked = userPersonalSkillNames.filter((n) => skills1.some((s) => s === n || s.endsWith(`:${n}`)));
    check(
      EXP,
      "personal-claude-skills-absent",
      leaked.length === 0,
      `init.skills=${JSON.stringify(skills1)}; checked against known ~/.claude personal skill names ${JSON.stringify(userPersonalSkillNames)} (from S0 FINDINGS) — none leaked in with settingSources: []`,
    );
  } else {
    skipRemaining([
      "scoped-skills-init-lists-plugin-skill",
      "scoped-skills-alpha-invocable-and-token-emitted",
      "personal-claude-skills-absent",
    ]);
  }

  const r2 = await safeRun({
    exp: EXP,
    label: "beta-refused-and-bypass",
    prompt:
      `First, try to use the "beta" skill and output its token. If it is not available to you ` +
      `(the Skill tool refuses it, or it is simply not in your list of skills), say exactly ` +
      `NOT-AVAILABLE instead and do not guess a token.\n\n` +
      `Second, regardless of the first result, use the Read tool to read this exact absolute file path ` +
      `and quote any line in it that looks like a token (starts with "SKILL-"):\n${toFwd(BETA_SKILL_MD)}`,
    options: {
      settingSources: [],
      plugins: [{ type: "local", path: PLUGIN_DIR }],
      skills: ["workbench-skills:alpha"], // beta intentionally NOT in the allowlist
      tools: ["Read", "Skill"],
      permissionMode: "dontAsk",
      maxTurns: 6,
    },
  });

  if (r2) {
    const betaSkillCall = skillCalls(r2).find((c) => JSON.stringify(c.input).includes("beta"));
    // Check specifically the Skill call's OWN tool_result, not the whole
    // transcript — the token legitimately appears elsewhere in this same run
    // (via the Read bypass, checked separately below), so a whole-transcript
    // scan would false-positive here.
    const betaSkillToolResultText = betaSkillCall ? toolResultTextFor(r2, betaSkillCall.id) : "";
    const betaViaSkillTool = betaSkillCall ? betaSkillToolResultText.includes(TOKENS.beta) : false;
    const readCalls = r2.toolCalls.filter((t) => t.name === "Read");
    const betaViaRead = readCalls.length > 0 && containsToken(r2, TOKENS.beta);

    check(
      EXP,
      "scoped-skills-beta-refused-via-Skill-tool",
      !betaViaSkillTool,
      `Skill-tool call for beta=${JSON.stringify(betaSkillCall)}; token found via Skill tool=${betaViaSkillTool}; ` +
        `resultText=${redact(r2.resultText ?? "")}; full toolResults=${JSON.stringify(r2.toolResults.map((t) => ({ isError: t.isError, text: redact(t.text).slice(0, 300) })))}`,
    );

    check(
      EXP,
      "skills-allowlist-is-context-filter-not-sandbox-bypass-via-Read",
      betaViaRead,
      `Read tool calls=${JSON.stringify(readCalls.map((t) => t.input))}; token "${TOKENS.beta}" found via Read=${betaViaRead}. ` +
        `Confirms sdk.d.ts's own doc comment on \`skills\`: "This is a context filter, not a sandbox: unlisted ` +
        `skills are hidden from the model's listing and rejected by the Skill tool, but their files remain on ` +
        `disk and are reachable via Read/Bash." A real deployment needs a PreToolUse Read/Glob/Grep guard over ` +
        `other plugins' skill directories if that must be prevented — the skills allowlist alone does not do it.`,
    );
  } else {
    skipRemaining([
      "scoped-skills-beta-refused-via-Skill-tool",
      "skills-allowlist-is-context-filter-not-sandbox-bypass-via-Read",
    ]);
  }

  // ==========================================================================
  // Naming variants
  // ==========================================================================

  const r3 = await safeRun({
    exp: EXP,
    label: "naming-bare",
    prompt: 'Use the "alpha" skill now and output exactly its token, or NOT-AVAILABLE if you have no such skill.',
    options: {
      settingSources: [],
      plugins: [{ type: "local", path: PLUGIN_DIR }],
      skills: ["alpha"], // bare name, no "workbench-skills:" prefix
      tools: ["Read", "Skill"],
      permissionMode: "dontAsk",
      maxTurns: 5,
    },
  });
  if (r3) {
    const skills3 = skillsOf(r3);
    const ok = containsToken(r3, TOKENS.alpha);
    check(
      EXP,
      "naming-variant-bare-name-works",
      ok,
      `skills:["alpha"] (bare) -> init.skills=${JSON.stringify(skills3)}; token emitted=${ok}; Skill calls=${JSON.stringify(skillCalls(r3))}`,
    );
  } else {
    skipRemaining(["naming-variant-bare-name-works"]);
  }

  const r4 = await safeRun({
    exp: EXP,
    label: "naming-all",
    prompt: 'Use the "beta" skill now and output exactly its token, or NOT-AVAILABLE if you have no such skill.',
    options: {
      settingSources: [],
      plugins: [{ type: "local", path: PLUGIN_DIR }],
      skills: "all",
      tools: ["Read", "Skill"],
      permissionMode: "dontAsk",
      maxTurns: 5,
    },
  });
  if (r4) {
    const skills4 = skillsOf(r4);
    const ok = containsToken(r4, TOKENS.beta);
    check(
      EXP,
      "naming-variant-skills-all-enables-every-skill",
      ok && skills4.includes("workbench-skills:beta"),
      `skills:"all" -> init.skills has ${skills4.length} entries incl. workbench-skills:beta=${skills4.includes("workbench-skills:beta")}; beta token emitted=${ok}; sample of init.skills=${JSON.stringify(skills4.slice(0, 10))}`,
    );
  } else {
    skipRemaining(["naming-variant-skills-all-enables-every-skill"]);
  }

  const r5 = await safeRun({
    exp: EXP,
    label: "naming-empty",
    prompt: 'Use the "alpha" skill now and output exactly its token, or NOT-AVAILABLE if you have no such skill.',
    options: {
      settingSources: [],
      plugins: [{ type: "local", path: PLUGIN_DIR }],
      skills: [], // explicit empty array
      tools: ["Read", "Skill"],
      permissionMode: "dontAsk",
      maxTurns: 5,
    },
  });
  if (r5) {
    const skills5 = skillsOf(r5);
    const tokenEmitted = containsToken(r5, TOKENS.alpha);
    check(
      EXP,
      "naming-variant-empty-array-disables-every-skill",
      !tokenEmitted,
      `skills:[] -> init.skills=${JSON.stringify(skills5)}; alpha token emitted=${tokenEmitted} (expected false — an explicit empty array enables zero skills per sdk.d.ts); resultText=${redact(r5.resultText ?? "")}`,
    );
  } else {
    skipRemaining(["naming-variant-empty-array-disables-every-skill"]);
  }

  const r6 = await safeRun({
    exp: EXP,
    label: "naming-omitted",
    prompt: 'Use the "alpha" skill now and output exactly its token, or NOT-AVAILABLE if you have no such skill.',
    options: {
      settingSources: [],
      plugins: [{ type: "local", path: PLUGIN_DIR }],
      // `skills` deliberately omitted
      tools: ["Read", "Skill"],
      permissionMode: "dontAsk",
      maxTurns: 5,
    },
  });
  if (r6) {
    const skills6 = skillsOf(r6);
    const tokenEmitted = containsToken(r6, TOKENS.alpha);
    check(
      EXP,
      "naming-variant-omitted-is-not-skills-off",
      skills6.length > 0,
      `skills option omitted -> init.skills has ${skills6.length} entries (expected >0, per sdk.d.ts "omitted (default): no SDK auto-configuration ... this is not 'skills off'"); ` +
        `includes plugin skill workbench-skills:alpha=${skills6.includes("workbench-skills:alpha")}; alpha token emitted=${tokenEmitted}; sample=${JSON.stringify(skills6.slice(0, 10))}`,
    );
  } else {
    skipRemaining(["naming-variant-omitted-is-not-skills-off"]);
  }

  // ==========================================================================
  // Bundled skills: adversarial invocation, and the option(s) that deny them.
  // ==========================================================================

  const r7 = await safeRun({
    exp: EXP,
    label: "bundled-adversarial-default",
    prompt:
      `Use the Skill tool to invoke the skill named "${BUNDLED_TARGET}" right now, with whatever input ` +
      `it needs. Report exactly what happens — either its output, or the exact error/denial text if it fails.`,
    options: {
      settingSources: [],
      plugins: [{ type: "local", path: PLUGIN_DIR }],
      skills: ["workbench-skills:alpha"], // only our plugin skill requested
      tools: ["Read", "Skill"],
      permissionMode: "dontAsk",
      maxTurns: 5,
    },
  });
  let bundledInvocableByDefault: boolean | undefined;
  if (r7) {
    const call = skillCalls(r7).find((c) => JSON.stringify(c.input).includes(BUNDLED_TARGET));
    const resultText = call ? toolResultTextFor(r7, call.id) : "";
    bundledInvocableByDefault = !!call && !r7.toolResults.some((t) => t.toolUseId === call.id && t.isError);
    // Positive finding: an explicit `skills: [...]` array already blocks *invocation*
    // of a bundled skill via the Skill tool, even though it stays listed in
    // init.skills (see the "scoped-skills-init-lists-plugin-skill" check's evidence,
    // which shows "simplify" etc. still present). pass=true means "correctly denied".
    check(
      EXP,
      "scoped-skills-array-blocks-bundled-skill-invocation",
      !bundledInvocableByDefault,
      `skills:["workbench-skills:alpha"] only, but adversarially asked to invoke "${BUNDLED_TARGET}". ` +
        `Skill tool call made=${!!call}; tool_result for that call=${JSON.stringify(redact(resultText).slice(0, 500))}; ` +
        `agent resultText=${redact(r7.resultText ?? "")}. Expected/observed: the Skill tool call itself errors with ` +
        `"Skill ${BUNDLED_TARGET} is not in this session's skills allowlist" — the \`skills\` array is already an ` +
        `effective invocation allowlist, not just a listing filter, even though the unrequested name stays in init.skills.`,
    );
  } else {
    skipRemaining(["scoped-skills-array-blocks-bundled-skill-invocation"]);
  }

  const r8 = await safeRun({
    exp: EXP,
    label: "disable-bundled-settings",
    prompt:
      `Use the Skill tool to invoke the skill named "${BUNDLED_TARGET}" and report exactly what happens. ` +
      `Then use the "alpha" skill and output exactly its token.`,
    options: {
      settingSources: [],
      plugins: [{ type: "local", path: PLUGIN_DIR }],
      skills: ["workbench-skills:alpha"],
      tools: ["Read", "Skill"],
      permissionMode: "dontAsk",
      maxTurns: 6,
      settings: { disableBundledSkills: true }, // "flag settings" layer, sdk.d.ts ~L2128
    },
  });
  if (r8) {
    const skills8 = skillsOf(r8);
    const bundledStillListed = skills8.some((s) => s === BUNDLED_TARGET || s.endsWith(`:${BUNDLED_TARGET}`));
    const call = skillCalls(r8).find((c) => JSON.stringify(c.input).includes(BUNDLED_TARGET));
    const bundledCallErrored = call ? r8.toolResults.some((t) => t.toolUseId === call.id && t.isError) : undefined;
    const alphaStillWorks = containsToken(r8, TOKENS.alpha);
    check(
      EXP,
      "disableBundledSkills-settings-option-removes-bundled-skills",
      !bundledStillListed && alphaStillWorks,
      `settings:{disableBundledSkills:true} -> init.skills=${JSON.stringify(skills8)} (bundled "${BUNDLED_TARGET}" still listed=${bundledStillListed}); ` +
        `Skill-tool call for "${BUNDLED_TARGET}"=${JSON.stringify(call)}, errored=${bundledCallErrored}; ` +
        `plugin skill alpha still invocable=${alphaStillWorks}; resultText=${redact(r8.resultText ?? "")}`,
    );
  } else {
    skipRemaining(["disableBundledSkills-settings-option-removes-bundled-skills"]);
  }

  const r9 = await safeRun({
    exp: EXP,
    label: "disable-bundled-env",
    prompt:
      `Use the Skill tool to invoke the skill named "${BUNDLED_TARGET}" and report exactly what happens. ` +
      `Then use the "alpha" skill and output exactly its token.`,
    options: {
      settingSources: [],
      plugins: [{ type: "local", path: PLUGIN_DIR }],
      skills: ["workbench-skills:alpha"],
      tools: ["Read", "Skill"],
      permissionMode: "dontAsk",
      maxTurns: 6,
      env: childEnv({ CLAUDE_CODE_DISABLE_BUNDLED_SKILLS: "1" }), // sdk.d.ts: "Equivalent to CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1"
    },
  });
  if (r9) {
    const skills9 = skillsOf(r9);
    const bundledStillListed = skills9.some((s) => s === BUNDLED_TARGET || s.endsWith(`:${BUNDLED_TARGET}`));
    const alphaStillWorks = containsToken(r9, TOKENS.alpha);
    check(
      EXP,
      "CLAUDE_CODE_DISABLE_BUNDLED_SKILLS-env-var-equivalent",
      !bundledStillListed && alphaStillWorks,
      `env CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1 -> init.skills=${JSON.stringify(skills9)} (bundled "${BUNDLED_TARGET}" still listed=${bundledStillListed}); ` +
        `alpha still invocable=${alphaStillWorks}; resultText=${redact(r9.resultText ?? "")}`,
    );
  } else {
    skipRemaining(["CLAUDE_CODE_DISABLE_BUNDLED_SKILLS-env-var-equivalent"]);
  }

  // ==========================================================================
  // PreToolUse hook fallback: deny any Skill invocation not in our allowlist.
  // ==========================================================================

  const hookLog: { toolName: string; input: unknown; decision: string; reason?: string }[] = [];
  const ALLOWED_SKILL_NAMES = new Set(["alpha", "workbench-skills:alpha"]);

  const r10 = await safeRun({
    exp: EXP,
    label: "pretooluse-hook-fallback",
    prompt:
      `Use the "alpha" skill and output exactly its token. Then use the Skill tool to invoke ` +
      `the skill named "${BUNDLED_TARGET}" and report exactly what happens (success, or the exact denial text).`,
    options: {
      settingSources: [],
      plugins: [{ type: "local", path: PLUGIN_DIR }],
      skills: "all", // deliberately permissive at the `skills` layer — the hook is the real gate here
      tools: ["Read", "Skill"],
      permissionMode: "dontAsk",
      maxTurns: 6,
      hooks: {
        PreToolUse: [
          {
            matcher: "Skill",
            hooks: [
              async (input: any) => {
                const toolInput = input?.tool_input ?? {};
                const name = String(toolInput?.name ?? toolInput?.skill ?? toolInput?.command ?? JSON.stringify(toolInput));
                const allowed = [...ALLOWED_SKILL_NAMES].some((a) => name === a || name.includes(a));
                const decision = allowed ? "allow" : "deny";
                const reason = allowed
                  ? undefined
                  : `PreToolUse guard: skill "${name}" is not in the workbench-skills-only allowlist.`;
                hookLog.push({ toolName: input?.tool_name, input: toolInput, decision, reason });
                return {
                  hookSpecificOutput: {
                    hookEventName: "PreToolUse",
                    permissionDecision: decision,
                    ...(reason ? { permissionDecisionReason: reason } : {}),
                  },
                } as any;
              },
            ],
          },
        ],
      },
    },
  });

  if (r10) {
    console.log(`[s01] hook log: ${JSON.stringify(hookLog)}`);
    const alphaEntry = hookLog.find((h) => JSON.stringify(h.input).includes("alpha"));
    const bundledEntry = hookLog.find((h) => JSON.stringify(h.input).includes(BUNDLED_TARGET));
    const alphaTokenPresent = containsToken(r10, TOKENS.alpha);
    const bundledCall = skillCalls(r10).find((c) => JSON.stringify(c.input).includes(BUNDLED_TARGET));
    const bundledCallDenied = bundledCall
      ? r10.toolResults.some((t) => t.toolUseId === bundledCall.id && t.isError)
      : undefined;

    check(
      EXP,
      "pretooluse-hook-fires-for-Skill-tool-and-allows-alpha",
      hookLog.length > 0 && alphaEntry?.decision === "allow" && alphaTokenPresent,
      `hookLog=${JSON.stringify(hookLog)}; alpha token in transcript=${alphaTokenPresent}`,
    );

    check(
      EXP,
      "pretooluse-hook-denies-bundled-skill-with-reason",
      bundledEntry?.decision === "deny" && !!bundledEntry?.reason && (bundledCallDenied ?? true),
      `bundled-skill hook entry=${JSON.stringify(bundledEntry)}; Skill tool call for "${BUNDLED_TARGET}"=${JSON.stringify(bundledCall)}; ` +
        `that call's tool_result isError=${bundledCallDenied}; agent resultText=${redact(r10.resultText ?? "")}`,
    );
  } else {
    skipRemaining([
      "pretooluse-hook-fires-for-Skill-tool-and-allows-alpha",
      "pretooluse-hook-denies-bundled-skill-with-reason",
    ]);
  }

  // ==========================================================================
  // gamma: how a skill finds its own scripts/ directory, and a scoped Bash rule.
  // ==========================================================================

  const r11 = await safeRun({
    exp: EXP,
    label: "gamma-script-explore",
    prompt: 'Use the "gamma" skill now, following its instructions exactly, including running its bundled script.',
    options: {
      settingSources: [],
      plugins: [{ type: "local", path: PLUGIN_DIR }],
      skills: ["workbench-skills:gamma"],
      tools: ["Read", "Skill", "Bash"],
      allowedTools: ["Bash(node *)"], // deliberately broad, to observe what path form the model actually uses
      permissionMode: "dontAsk",
      maxTurns: 6,
    },
  });

  let discoveredScriptPathForm = "";
  if (r11) {
    const gammaTokenPresent = containsToken(r11, TOKENS.gamma);
    const scriptTokenPresent = containsToken(r11, TOKENS.gammaScript);
    const bashCallsR11 = bashCalls(r11);
    const bashCommand = bashCallsR11.length > 0 ? String((bashCallsR11[0].input as any)?.command ?? "") : "";
    discoveredScriptPathForm = bashCommand;

    // Look through the Skill tool's own tool_result text for any base-directory
    // hint (${CLAUDE_SKILL_DIR}, ${CLAUDE_PLUGIN_ROOT}, or an injected absolute
    // path line) that the model was actually given.
    const gammaSkillCall = skillCalls(r11).find((c) => JSON.stringify(c.input).includes("gamma"));
    const gammaSkillResultText = gammaSkillCall ? toolResultTextFor(r11, gammaSkillCall.id) : "";
    const dirHintMatch = /CLAUDE_(?:SKILL_DIR|PLUGIN_ROOT)|skills[\\/]gamma/i.exec(gammaSkillResultText);

    check(
      EXP,
      "gamma-skill-locates-and-runs-its-own-script",
      gammaTokenPresent && scriptTokenPresent,
      `gamma marker token present=${gammaTokenPresent}; script token present=${scriptTokenPresent}; ` +
        `Bash calls=${JSON.stringify(bashCallsR11)}; Skill tool_result excerpt (first 800 chars)=${JSON.stringify(redact(gammaSkillResultText).slice(0, 800))}; ` +
        `base-dir hint found in tool_result=${dirHintMatch ? dirHintMatch[0] : "none"}`,
    );
  } else {
    skipRemaining(["gamma-skill-locates-and-runs-its-own-script"]);
  }

  // Build a scoped Bash rule from the exact command the model used in run11
  // (falls back to a plugin-root-relative rule if run11 didn't happen/succeed).
  const gammaScriptAbs = toFwd(path.join(PLUGIN_DIR, "skills", "gamma", "scripts", "token.mjs"));
  const scopedBashRule = `Bash(node ${gammaScriptAbs} *)`;

  const r12 = await safeRun({
    exp: EXP,
    label: "gamma-scoped-rule-confirm",
    prompt:
      `Use the "gamma" skill now, following its instructions exactly, including running its bundled script. ` +
      `Then, as a deliberate permissions test, also try to run this different command with the Bash tool and ` +
      `report exactly what happens: node -e "console.log('ADVERSARIAL-NODE-CALL')"`,
    options: {
      settingSources: [],
      plugins: [{ type: "local", path: PLUGIN_DIR }],
      skills: ["workbench-skills:gamma"],
      tools: ["Read", "Skill", "Bash"],
      allowedTools: [scopedBashRule], // narrow: only the exact script path, not "node *"
      permissionMode: "dontAsk",
      maxTurns: 6,
    },
  });

  if (r12) {
    const scriptTokenPresent = containsToken(r12, TOKENS.gammaScript);
    const adversarialTokenPresent = (r12.resultText ?? "").includes("ADVERSARIAL-NODE-CALL") ||
      r12.toolResults.some((t) => t.text.includes("ADVERSARIAL-NODE-CALL"));
    const bashCallsR12 = bashCalls(r12);
    const adversarialCall = bashCallsR12.find((c) => String((c.input as any)?.command ?? "").includes("ADVERSARIAL-NODE-CALL"));
    const adversarialDenied = adversarialCall
      ? r12.toolResults.some((t) => t.toolUseId === adversarialCall.id && t.isError)
      : undefined;
    const anyDenials = r12.denials.length > 0;

    check(
      EXP,
      "gamma-scoped-bash-rule-allows-script-denies-other-node-calls",
      scriptTokenPresent && !adversarialTokenPresent,
      `scoped rule=${JSON.stringify(scopedBashRule)}; discovered command form from run11=${JSON.stringify(discoveredScriptPathForm)}; ` +
        `Bash calls this run=${JSON.stringify(bashCallsR12)}; script token present=${scriptTokenPresent}; ` +
        `adversarial "ADVERSARIAL-NODE-CALL" output leaked=${adversarialTokenPresent} (expected false); ` +
        `adversarial call denied (tool_result isError)=${adversarialDenied}; denials=${JSON.stringify(anyDenials ? r12.denials : [])}`,
    );
  } else {
    skipRemaining(["gamma-scoped-bash-rule-allows-script-denies-other-node-calls"]);
  }

  // ==========================================================================
  // allowed-tools front-matter vs. session-level disallowedTools
  // ==========================================================================

  const r13 = await safeRun({
    exp: EXP,
    label: "allowed-tools-vs-disallowed",
    prompt: 'Use the "gamma" skill now, following its instructions exactly, including running its bundled script with Bash.',
    options: {
      settingSources: [],
      plugins: [{ type: "local", path: PLUGIN_DIR }],
      skills: ["workbench-skills:gamma"], // gamma's SKILL.md front-matter has `allowed-tools: Bash`
      tools: ["Read", "Skill", "Bash"], // Bash present in the base tool set
      disallowedTools: ["Bash"], // ...but explicitly disallowed at the session level
      permissionMode: "dontAsk",
      maxTurns: 6,
    },
  });

  if (r13) {
    const gammaTokenPresent = containsToken(r13, TOKENS.gamma);
    const scriptTokenPresent = containsToken(r13, TOKENS.gammaScript);
    const bashCallsR13 = bashCalls(r13);
    const bashAttempted = bashCallsR13.length > 0;
    const bashDenied = bashAttempted
      ? r13.toolResults.some((t) => bashCallsR13.some((c) => c.id === t.toolUseId) && t.isError) || r13.denials.length > 0
      : undefined;

    check(
      EXP,
      "skill-frontmatter-allowed-tools-does-not-override-session-disallowedTools",
      !scriptTokenPresent,
      `disallowedTools:["Bash"] with gamma's SKILL.md front-matter \`allowed-tools: Bash\`. gamma marker token ` +
        `present=${gammaTokenPresent} (unaffected — it's plain text output); script token present=${scriptTokenPresent} ` +
        `(expected false — Bash should stay blocked); Bash tool calls attempted=${bashAttempted}, calls=${JSON.stringify(bashCallsR13)}; ` +
        `denied=${bashDenied}; denials=${JSON.stringify(r13.denials)}; resultText=${redact(r13.resultText ?? "")}`,
    );
  } else {
    skipRemaining(["skill-frontmatter-allowed-tools-does-not-override-session-disallowedTools"]);
  }

  // ==========================================================================
  // Fallback: copy skills into <cwd>/.claude/skills/ with settingSources: ["project"]
  // ==========================================================================

  const r14 = await safeRun({
    exp: EXP,
    label: "fallback-project-skills",
    prompt: 'Use the "alpha" skill now and output exactly its token, or NOT-AVAILABLE if you have no such skill.',
    options: {
      settingSources: ["project"],
      cwd: FALLBACK_PROJECT_DIR,
      skills: ["alpha"], // project-local skill dir, no plugin prefix
      tools: ["Read", "Skill"],
      permissionMode: "dontAsk",
      maxTurns: 5,
    },
  });

  if (r14) {
    const skills14 = skillsOf(r14);
    const tokenEmitted = containsToken(r14, TOKENS.alpha);
    check(
      EXP,
      "fallback-project-settingSources-loads-local-claude-skills",
      tokenEmitted,
      `settingSources:["project"], cwd=${FALLBACK_PROJECT_DIR} (has .claude/skills/{alpha,beta}/SKILL.md) -> ` +
        `init.skills=${JSON.stringify(skills14)}; alpha token emitted=${tokenEmitted}`,
    );

    check(
      EXP,
      "fallback-project-settingSources-scope-of-what-else-loads",
      true,
      `With settingSources:["project"] (no "user"/"local"): init.mcp_servers=${JSON.stringify(r14.init?.mcp_servers)}, ` +
        `init.plugins=${JSON.stringify(r14.init?.plugins)}, init.tools=${JSON.stringify(r14.init?.tools)}. ` +
        `No .claude/settings.json or CLAUDE.md exists in ${FALLBACK_PROJECT_DIR}, so this run's "project" source had ` +
        `nothing else to pull in beyond .claude/skills/ — a real project dir with its own settings.json/CLAUDE.md/.mcp.json ` +
        `would also load those under "project", which this run cannot demonstrate further.`,
    );
  } else {
    skipRemaining([
      "fallback-project-settingSources-loads-local-claude-skills",
      "fallback-project-settingSources-scope-of-what-else-loads",
    ]);
  }

  // ==========================================================================

  const runs = [r1, r2, r3, r4, r5, r6, r7, r8, r9, r10, r11, r12, r13, r14].filter(
    (r): r is RunResult => r !== undefined,
  );
  const totalCost = runs.reduce((sum, r) => sum + r.costUsd, 0);
  console.log(`[s01] completed ${runs.length}/14 planned runs, total cost across this script's own runs=$${totalCost.toFixed(4)}`);

  check(
    EXP,
    "total-cost-under-cap",
    totalCost < 0.5,
    `total observed cost across ${runs.length} API runs in this script = $${totalCost.toFixed(4)} (cap $0.50)` +
      (stopped ? `; STOPPED EARLY: ${stopReason}` : ""),
  );

  if (stopped) {
    console.warn(`[s01] Script stopped early due to cost cap. ${stopReason}`);
  }
}

main().catch((err) => {
  console.error("[s01] FAILED:", redact(String(err?.stack ?? err)));
  process.exitCode = 1;
});
