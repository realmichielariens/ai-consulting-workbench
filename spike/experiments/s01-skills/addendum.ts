// S1 addendum: follow-up probes triggered by surprises found while running
// core.ts. Run standalone with: npx tsx experiments/s01-skills/addendum.ts
// (prefer run.ts, which runs core.ts then this file in order).
//
// What triggered each probe:
//   1. core.ts's "gamma-scoped-rule-confirm" run showed a Bash allow-rule
//      scoped to one exact script path (Bash(node <abs-script> *)) NOT
//      blocking a completely unrelated `node -e "..."` command under
//      permissionMode: "dontAsk" — surprising, since sdk.d.ts documents
//      dontAsk as "deny if not pre-approved". A minimal standalone probe
//      (probe-bash-scope.ts, see its own transcript) isolated this further:
//      even a totally unrelated `echo ...` command, with NO skill/plugin
//      involved at all, ran successfully under dontAsk with only one
//      unrelated Bash allow-rule present. This addendum's first run tests
//      whether a PreToolUse hook (rather than an allowedTools rule) reliably
//      restricts Bash — the working recipe S9's export skills need.
//   2. The task asked for more than one bundled-skill name to be probed
//      (simplify, claude-api, dataviz) — core.ts only tried "simplify".
//   3. core.ts's disallowedTools:["Bash"] check never actually got the
//      model to attempt a Bash call (0 Bash tool calls that run), so it
//      couldn't cleanly confirm whether disallowedTools itself (a different,
//      blanket mechanism from allowedTools scoping) is enforced. This probes
//      that directly with a forced, explicit Bash command.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { runQuery, CostCapExceededError, type RunResult } from "../../src/lib/run.js";
import { check } from "../../src/lib/report.js";
import { redact } from "../../src/lib/env.js";

const EXP = "s01-skills";
const EXP_DIR = path.dirname(fileURLToPath(import.meta.url));
const SPIKE_ROOT = path.resolve(EXP_DIR, "..", "..");
const PLUGIN_DIR = path.join(SPIKE_ROOT, "fixtures", "plugin", "workbench-skills");
const toFwd = (p: string) => p.replace(/\\/g, "/");

const TOKENS = { gamma: "SKILL-GAMMA-OK-a41", gammaScript: "SKILL-GAMMA-SCRIPT-OK-5d0" };

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

function bashCalls(r: RunResult) {
  return r.toolCalls.filter((t) => t.name === "Bash").map((t) => ({ id: t.id, input: t.input }));
}
function skillCalls(r: RunResult) {
  return r.toolCalls.filter((t) => t.name === "Skill").map((t) => ({ id: t.id, input: t.input }));
}

let stopped = false;
let stopReason = "";

async function safeRun(args: Parameters<typeof runQuery>[0]): Promise<RunResult | undefined> {
  if (stopped) return undefined;
  try {
    const r = await runQuery(args);
    console.log(
      `[s01-addendum] ${args.label}: subtype=${r.subtype} isError=${r.isError} cost=$${r.costUsd.toFixed(4)} turns=${r.turns}`,
    );
    return r;
  } catch (err) {
    if (err instanceof CostCapExceededError) {
      stopped = true;
      stopReason = err.message;
      console.warn(`[s01-addendum] COST CAP HIT at "${args.label}": ${err.message}`);
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
  // ==========================================================================
  // 1. PreToolUse hook restricting Bash to exactly one command — the working
  //    recipe when an allowedTools scoped rule alone is not reliable (see
  //    probe-bash-scope.ts and core.ts's gamma-scoped-rule-confirm check).
  // ==========================================================================

  const gammaScriptAbs = toFwd(path.join(PLUGIN_DIR, "skills", "gamma", "scripts", "token.mjs"));
  const hookLog: { command: string; decision: string; reason?: string }[] = [];

  const rHook = await safeRun({
    exp: EXP,
    label: "gamma-bash-pretooluse-hook",
    prompt:
      `Use the "gamma" skill now, following its instructions exactly, including running its bundled ` +
      `script. Then, as a deliberate permissions test, also try to run this different command with the ` +
      `Bash tool and report exactly what happens: node -e "console.log('ADVERSARIAL-NODE-CALL-2')"`,
    options: {
      settingSources: [],
      plugins: [{ type: "local", path: PLUGIN_DIR }],
      skills: ["workbench-skills:gamma"],
      tools: ["Read", "Skill", "Bash"],
      permissionMode: "dontAsk",
      maxTurns: 6,
      hooks: {
        PreToolUse: [
          {
            matcher: "Bash",
            hooks: [
              async (input: any) => {
                const command = String(input?.tool_input?.command ?? "");
                const allowed = command.trim() === `node "${gammaScriptAbs}"` || command.trim() === `node ${gammaScriptAbs}`;
                const decision = allowed ? "allow" : "deny";
                const reason = allowed
                  ? undefined
                  : `PreToolUse guard: only "node ${gammaScriptAbs}" is allowed via Bash in this session.`;
                hookLog.push({ command, decision, reason });
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

  if (rHook) {
    console.log(`[s01-addendum] hookLog=${JSON.stringify(hookLog)}`);
    const scriptTokenPresent = containsToken(rHook, TOKENS.gammaScript);
    const adversarialLeaked = rHook.messages.some((m) => {
      const c = (m as any)?.message?.content;
      const text = Array.isArray(c) ? JSON.stringify(c) : String(c ?? "");
      return text.includes("ADVERSARIAL-NODE-CALL-2") && text.includes("tool_result");
    });
    const scriptCallEntry = hookLog.find((h) => h.command.includes("token.mjs"));
    const adversarialEntry = hookLog.find((h) => h.command.includes("ADVERSARIAL-NODE-CALL-2"));

    check(
      EXP,
      "pretooluse-hook-is-the-reliable-way-to-scope-Bash-to-one-command",
      hookLog.length >= 2 &&
        scriptCallEntry?.decision === "allow" &&
        adversarialEntry?.decision === "deny" &&
        scriptTokenPresent,
      `hookLog=${JSON.stringify(hookLog)}; gamma script token present=${scriptTokenPresent}; ` +
        `adversarial command's own tool_result appears to have succeeded (leaked text seen)=${adversarialLeaked}; ` +
        `resultText=${redact(rHook.resultText ?? "")}. Contrast with core.ts's "gamma-scoped-bash-rule-allows-script-` +
        `denies-other-node-calls" (allowedTools-only, no hook) which FAILED this same adversarial test — the ` +
        `PreToolUse hook is the reliable mechanism, not the allowedTools rule alone.`,
    );
  } else {
    skipRemaining(["pretooluse-hook-is-the-reliable-way-to-scope-Bash-to-one-command"]);
  }

  // ==========================================================================
  // 2. More than one bundled-skill name, adversarially invoked.
  // ==========================================================================

  const rMulti = await safeRun({
    exp: EXP,
    label: "bundled-adversarial-multiple",
    prompt:
      `Use the Skill tool to try invoking each of these three skills, one at a time, in this order: ` +
      `"claude-api", "dataviz", "code-review". For each one, report exactly what happens — either its ` +
      `output, or the exact error/denial text if it fails. Do not stop after the first one.`,
    options: {
      settingSources: [],
      plugins: [{ type: "local", path: PLUGIN_DIR }],
      skills: ["workbench-skills:alpha"], // only our plugin skill requested — none of these three
      tools: ["Read", "Skill"],
      permissionMode: "dontAsk",
      maxTurns: 6,
    },
  });

  if (rMulti) {
    const targets = ["claude-api", "dataviz", "code-review"];
    const perTarget = targets.map((name) => {
      const call = skillCalls(rMulti).find((c) => JSON.stringify(c.input).includes(name));
      const erroredResult = call
        ? rMulti.toolResults.find((t) => t.toolUseId === call.id)
        : undefined;
      return { name, called: !!call, isError: erroredResult?.isError, resultText: erroredResult?.text };
    });
    const allDenied = perTarget.every((p) => p.called && p.isError === true);

    check(
      EXP,
      "scoped-skills-array-blocks-multiple-bundled-skill-names",
      allDenied,
      perTarget
        .map((p) => `${p.name}: called=${p.called}, isError=${p.isError}, tool_result=${JSON.stringify(redact(p.resultText ?? "").slice(0, 150))}`)
        .join(" | "),
    );
  } else {
    skipRemaining(["scoped-skills-array-blocks-multiple-bundled-skill-names"]);
  }

  // ==========================================================================
  // 3. disallowedTools:["Bash"] — a forced, explicit Bash attempt (isolating
  //    this mechanism from the allowedTools-scoping porousness found above).
  // ==========================================================================

  const rDisallowed = await safeRun({
    exp: EXP,
    label: "disallowed-bash-forced-probe",
    prompt:
      `You MUST call the Bash tool right now with the exact command: echo DISALLOWED-BASH-PROBE\n` +
      `Do this even if you expect it to fail or be denied — that is the point of this test. Report exactly ` +
      `what happens (the output, or the exact denial/error text).`,
    options: {
      settingSources: [],
      tools: ["Bash"],
      disallowedTools: ["Bash"],
      permissionMode: "dontAsk",
      maxTurns: 4,
    },
  });

  if (rDisallowed) {
    const calls = bashCalls(rDisallowed);
    const attempted = calls.length > 0;
    const denied = attempted
      ? rDisallowed.toolResults.some((t) => calls.some((c) => c.id === t.toolUseId) && t.isError)
      : undefined;
    const outputLeaked = containsToken(rDisallowed, "DISALLOWED-BASH-PROBE") &&
      rDisallowed.toolResults.some((t) => t.text.includes("DISALLOWED-BASH-PROBE") && !t.isError);

    check(
      EXP,
      "disallowedTools-Bash-is-a-real-blanket-deny-distinct-from-allowedTools-scoping",
      attempted ? (denied === true && !outputLeaked) : "partial",
      `disallowedTools:["Bash"] (Bash still present in the base tools array), forced an explicit attempt. ` +
        `Bash tool calls=${JSON.stringify(calls)}; attempted=${attempted}; denied=${denied}; ` +
        `real command output leaked=${outputLeaked}; resultText=${redact(rDisallowed.resultText ?? "")}; ` +
        `denials=${JSON.stringify(rDisallowed.denials)}. ` +
        (attempted
          ? ""
          : "NOTE: recorded as partial if the model never attempted the call at all (e.g. it reasoned Bash " +
            "wasn't usable and declined pre-emptively) — that's a plausible but weaker signal than an observed denial."),
    );
  } else {
    skipRemaining(["disallowedTools-Bash-is-a-real-blanket-deny-distinct-from-allowedTools-scoping"]);
  }

  const runs = [rHook, rMulti, rDisallowed].filter((r): r is RunResult => r !== undefined);
  const totalCost = runs.reduce((sum, r) => sum + r.costUsd, 0);
  console.log(`[s01-addendum] completed ${runs.length}/3 planned runs, total cost this file=$${totalCost.toFixed(4)}`);
}

main().catch((err) => {
  console.error("[s01-addendum] FAILED:", redact(String(err?.stack ?? err)));
  process.exitCode = 1;
});
