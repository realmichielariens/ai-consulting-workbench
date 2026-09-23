// Ad-hoc probe (not part of the main S1 checklist): isolate whether
// permissionMode "dontAsk" + a narrow Bash allow-rule actually denies a
// command that clearly doesn't match the rule, with NO skill/plugin
// involvement at all. Triggered by a surprising result in
// gamma-scoped-rule-confirm (an unrelated `node -e ...` command ran
// successfully under a rule scoped to a completely different script path).
// Run with: npx tsx experiments/s01-skills/probe-bash-scope.ts

import { runQuery } from "../../src/lib/run.js";
import { redact } from "../../src/lib/env.js";

const EXP = "s01-skills";

async function main() {
  const r = await runQuery({
    exp: EXP,
    label: "probe-bash-scope-mismatch",
    prompt:
      'Run this exact command with the Bash tool: echo ADVERSARIAL-PROBE-OUTPUT\n' +
      "Report exactly what happens (the output, or the exact denial/error text if it is blocked).",
    options: {
      settingSources: [],
      tools: ["Bash"],
      allowedTools: ["Bash(node C:/some/totally/unrelated/script.mjs *)"], // does not match "echo ..." at all
      permissionMode: "dontAsk",
      maxTurns: 4,
    },
  });

  console.log(`[probe] subtype=${r.subtype} isError=${r.isError} cost=$${r.costUsd.toFixed(4)}`);
  console.log(`[probe] resultText=${redact(r.resultText ?? "")}`);
  console.log(`[probe] toolCalls=${JSON.stringify(r.toolCalls.map((t) => ({ name: t.name, input: t.input })))}`);
  console.log(`[probe] toolResults=${JSON.stringify(r.toolResults.map((t) => ({ isError: t.isError, text: redact(t.text).slice(0, 200) })))}`);
  console.log(`[probe] denials=${JSON.stringify(r.denials)}`);
}

main().catch((err) => {
  console.error("[probe] FAILED:", redact(String(err?.stack ?? err)));
  process.exitCode = 1;
});
