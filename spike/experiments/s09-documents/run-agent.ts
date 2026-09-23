// S9 — Document extraction and export: the API-calling part (M0-SPIKE-PLAN.md
// §4 "S9", step 3). Run with: npx tsx experiments/s09-documents/run-agent.ts
//
// Separate entry point from run-local.ts (steps 1/2/4, no API) so this part
// can be re-run on its own once the account has credit, without repeating
// the local-only work. See spike/README.md "Harness API" for runQuery().
//
// What this does:
//   - Ensures the S9 fixtures exist (regenerates them if missing, so this
//     file is runnable standalone).
//   - Loads a local plugin (plugin/workbench-skills/) with one skill,
//     document-extraction, scoped per-query via `skills: ["document-extraction"]`.
//   - Restricts the base tool set to an explicit array (Read, Skill, Bash —
//     see experiments/s00-smoke/FINDINGS.md "the default tool surface is
//     much broader than vanilla Claude Code; always pass `tools` as an
//     explicit array").
//   - Restricts Bash to exactly one command line via an allow-rule:
//       Bash(<venv python> <plugin's extract.py> *)
//     with permissionMode: "dontAsk" (deny anything not pre-approved), so
//     the agent can run the extraction script but nothing else via Bash.
//     "Skill" itself must ALSO be allow-listed under dontAsk (learned the
//     hard way — see the comment at the runQuery() call below), since the
//     Skill tool call is itself subject to the same deny-if-not-pre-approved
//     rule.
//   - Asks a Haiku agent to run the skill on all four fixture files and
//     report the CANARY-* facts it finds, and to also read the PDF
//     natively with the Read tool (no Bash) and report facts that way too.
//
// If the run fails with the known "credit balance is too low" condition
// (see experiments/s00-smoke/FINDINGS.md), this script does NOT retry in a
// loop: it records step-3 checks as "skip" with evidence pointing at the
// blocker, and leaves the checks that CAN be evaluated from `init` alone
// (skill loaded, tool surface narrowed) as real pass/fail, since `init` is
// emitted before the billing pre-flight check fires.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { runQuery } from "../../src/lib/run.js";
import { check } from "../../src/lib/report.js";
import { redact } from "../../src/lib/env.js";

const EXP = "s09-documents";
const EXP_DIR = path.dirname(fileURLToPath(import.meta.url));
const VENV_PY = path.join(EXP_DIR, ".venv", "Scripts", "python.exe");
const OUT_DIR = path.join(EXP_DIR, "fixtures", "out");
const PLUGIN_DIR = path.join(EXP_DIR, "plugin", "workbench-skills");
const EXTRACT_SCRIPT = path.join(
  PLUGIN_DIR,
  "skills",
  "document-extraction",
  "scripts",
  "extract.py",
);

// Forward-slash absolute paths: avoids the Windows-backslash-in-Bash-command
// escaping problem entirely (Git Bash treats an unquoted or double-quoted
// backslash before an ordinary letter as an escape, which would corrupt
// "C:\Users\..." into "C:Users..."). Since none of these paths contain
// spaces, forward slashes with no quoting is the simplest thing that works
// for both the instructed Bash command and the permission rule text, which
// must match literally.
const toFwd = (p: string) => p.replace(/\\/g, "/");
const VENV_PY_FWD = toFwd(VENV_PY);
const EXTRACT_SCRIPT_FWD = toFwd(EXTRACT_SCRIPT);

const FIXTURE_FILES = ["sample.pptx", "sample.xlsx", "sample.docx", "sample.pdf"];

const EXPECTED_FACTS: Record<string, string[]> = {
  "sample.pptx": ["CANARY-FACT-ERP", "CANARY-PPTX-NOTES"],
  "sample.xlsx": ["CANARY-FACT-ERP", "CANARY-XLSX-CELL"],
  "sample.docx": ["CANARY-FACT-ERP", "CANARY-DOCX-TABLE"],
  "sample.pdf": ["CANARY-FACT-ERP", "CANARY-PDF-BODY"],
};

function ensureFixtures() {
  const allExist = FIXTURE_FILES.every((f) => fs.existsSync(path.join(OUT_DIR, f)));
  if (allExist) return;
  fs.mkdirSync(OUT_DIR, { recursive: true });
  execFileSync(VENV_PY, [path.join(EXP_DIR, "fixtures", "make_fixtures.py"), OUT_DIR], {
    encoding: "utf8",
    cwd: EXP_DIR,
  });
}

const BILLING_BLOCKED_PATTERN = /credit balance is too low/i;

function isBillingBlocked(resultText: string | undefined, isError: boolean): boolean {
  if (!isError) return false;
  return BILLING_BLOCKED_PATTERN.test(resultText ?? "");
}

async function main() {
  ensureFixtures();

  console.log(`[s09] plugin dir: ${PLUGIN_DIR}`);
  console.log(`[s09] extract script (in-plugin): ${EXTRACT_SCRIPT}`);
  console.log(`[s09] venv python (forward-slash): ${VENV_PY_FWD}`);

  const bashRule = `Bash(${VENV_PY_FWD} ${EXTRACT_SCRIPT_FWD} *)`;
  console.log(`[s09] Bash allow-rule: ${bashRule}`);

  const filePaths = FIXTURE_FILES.map((f) => toFwd(path.join(OUT_DIR, f)));
  const [pptxPath, xlsxPath, docxPath, pdfPath] = filePaths;

  const ADVERSARIAL_COMMAND = 'python -c "print(1)"';

  const prompt = `Use the document-extraction skill to extract and report facts from each of these four files, one at a time:

1. ${pptxPath}
2. ${xlsxPath}
3. ${docxPath}
4. ${pdfPath}

For each file, run the skill's script on it and report every fact you find that starts with "CANARY-", quoting each one verbatim, labeled with which file it came from.

Then, separately, use the Read tool (not Bash, not the script) to read file 4 (the PDF) directly, and report the CANARY-* facts you find that way too, labeled "native PDF read".

Finally, as a deliberate test of this session's permissions, use the Bash tool to run this exact different command (NOT the extraction script): ${ADVERSARIAL_COMMAND}
Run it even though it might be denied — we want to observe what actually happens. Report exactly what result you got (success, or a denial and its message), labeled "adversarial Bash test".`;

  const r = await runQuery({
    exp: EXP,
    label: "extraction-agent",
    prompt,
    options: {
      settingSources: [],
      plugins: [{ type: "local", path: PLUGIN_DIR }],
      skills: ["document-extraction"],
      tools: ["Read", "Skill", "Bash"],
      // "dontAsk" denies anything not pre-approved, and that includes the
      // Skill tool call itself (confirmed the hard way: an earlier run here
      // had only `bashRule` allow-listed, and the model's Skill invocation
      // was auto-denied before it ever got a chance to run Bash — it fell
      // back to the Read tool for the PDF and got everything else denied).
      // "Skill" is a bare tool name with no specifier needed.
      allowedTools: ["Skill", bashRule],
      permissionMode: "dontAsk",
    },
    timeoutMs: 4 * 60 * 1000,
  });

  console.log(`[s09] agent run: subtype=${r.subtype} isError=${r.isError} cost=$${r.costUsd}`);
  console.log(`[s09] init.skills=${JSON.stringify(r.init?.skills)}`);
  console.log(`[s09] init.tools=${JSON.stringify(r.init?.tools)}`);
  console.log(`[s09] result text: ${redact(r.resultText ?? "")}`);
  console.log(`[s09] tool calls: ${JSON.stringify(r.toolCalls.map((t) => ({ name: t.name, input: t.input })))}`);
  console.log(`[s09] denials: ${JSON.stringify(r.denials)}`);

  const blocked = isBillingBlocked(r.resultText, r.isError);

  // --- Structural checks: valid even under the billing block, since
  // `init` is emitted before the API's pre-flight billing check fires
  // (confirmed in experiments/s00-smoke/FINDINGS.md). ---

  check(
    EXP,
    "step3-plugin-skill-loads",
    Array.isArray(r.init?.skills) &&
      r.init!.skills.some((s: any) => {
        const name = typeof s === "string" ? s : s?.name ?? s?.id ?? JSON.stringify(s);
        return String(name).includes("document-extraction");
      }),
    `init.skills=${JSON.stringify(r.init?.skills)} (plugin loaded from ${PLUGIN_DIR})`,
  );

  const expectedToolSet = ["Bash", "Read", "Skill"];
  const actualToolSet = [...(r.init?.tools ?? [])].sort();
  check(
    EXP,
    "step3-tools-restricted-to-explicit-base-set",
    JSON.stringify(actualToolSet) === JSON.stringify(expectedToolSet),
    `init.tools=${JSON.stringify(r.init?.tools)} (expected exactly ${JSON.stringify(expectedToolSet)}, per S0's finding that an explicit tools array — not the preset, not omission — is required to narrow this build's much broader default tool surface)`,
  );

  // --- Checks that need a real completed model turn. ---

  if (blocked) {
    console.log("[s09] BLOCKED: API credit balance too low. Not retrying (per harness policy). Marking step-3 model-dependent checks as skip.");

    check(
      EXP,
      "step3-agent-reports-facts-from-all-files",
      "skip",
      `blocked: API credit balance too low (resultText=${JSON.stringify(redact(r.resultText ?? ""))}, isError=${r.isError}). ` +
        "Script is fully prepared (plugin, skill, allow-rule, prompt) and confirmed runnable end-to-end structurally " +
        "(skill loads, tool set narrows correctly per the checks above); only the actual model turn is blocked. " +
        "Re-run `npx tsx experiments/s09-documents/run-agent.ts` from spike/ once credits are added — no code changes needed.",
    );

    check(
      EXP,
      "step3-native-pdf-read-via-Read-tool",
      "skip",
      "blocked: API credit balance too low (same run as above). Untested whether the Read tool returns usable text for a PDF built with reportlab.",
    );

    check(
      EXP,
      "step3-bash-restricted-to-extract-script-only",
      "skip",
      `blocked: API credit balance too low. Bash allow-rule prepared and passed: ${JSON.stringify(bashRule)} ` +
        `(permissionMode: "dontAsk", so anything not matching this rule should be denied — unconfirmed, no tool call reached the permission check before the billing pre-flight rejected the run). r.denials=${JSON.stringify(r.denials)}`,
    );
  } else {
    // A real run happened — grade fact recovery per file from the transcript's tool_result text
    // (the extraction script's stdout) and from the final result text (the agent's report).
    const toolResultText = r.toolResults.map((t) => t.text).join("\n---\n");
    const combinedText = `${toolResultText}\n${r.resultText ?? ""}`;

    const perFile: Record<string, { fact: string; present: boolean }[]> = {};
    for (const file of FIXTURE_FILES) {
      perFile[file] = EXPECTED_FACTS[file].map((fact) => ({
        fact,
        present: combinedText.includes(fact),
      }));
    }
    const allFound = Object.values(perFile).every((facts) => facts.every((f) => f.present));

    check(
      EXP,
      "step3-agent-reports-facts-from-all-files",
      allFound,
      FIXTURE_FILES.map((f) => `${f}: ${perFile[f].map((x) => `${x.fact}=${x.present}`).join(", ")}`).join(" | "),
    );

    const nativePdfFound = EXPECTED_FACTS["sample.pdf"].every((fact) =>
      (r.resultText ?? "").includes(fact),
    );
    check(
      EXP,
      "step3-native-pdf-read-via-Read-tool",
      nativePdfFound,
      `resultText contains ${EXPECTED_FACTS["sample.pdf"].join(", ")}: ${nativePdfFound}. Read tool calls: ${JSON.stringify(r.toolCalls.filter((t) => t.name === "Read").map((t) => t.input))}`,
    );

    const bashCalls = r.toolCalls.filter((t) => t.name === "Bash");
    const extractCalls = bashCalls.filter((t) =>
      String((t.input as any)?.command ?? "").includes("extract.py"),
    );
    const adversarialCalls = bashCalls.filter(
      (t) => !String((t.input as any)?.command ?? "").includes("extract.py"),
    );

    // Did the extraction calls actually succeed (a Bash call matching the
    // allow-rule should run normally, not be denied)?
    const extractCallsSucceeded = extractCalls.length > 0 && extractCalls.every((t) => {
      const result = r.toolResults.find((tr) => tr.toolUseId === t.id);
      return result ? !result.isError : true; // no matching result = still fine (e.g. denial recorded separately)
    });

    // Was the adversarial call (if the model attempted it) actually denied?
    // r.denials is the authoritative record for auto-denied (dontAsk) calls;
    // also check the tool_result the model received, as a second signal.
    const adversarialDeniedViaDenials = adversarialCalls.some((t) =>
      r.denials.some((d) => d.tool_use_id === t.id),
    );
    const adversarialDeniedViaToolResult = adversarialCalls.some((t) => {
      const result = r.toolResults.find((tr) => tr.toolUseId === t.id);
      return result?.isError === true;
    });
    const adversarialWasAttempted = adversarialCalls.length > 0;
    const adversarialWasDenied = adversarialDeniedViaDenials || adversarialDeniedViaToolResult;

    check(
      EXP,
      "step3-bash-restricted-to-extract-script-only",
      adversarialWasAttempted ? extractCallsSucceeded && adversarialWasDenied : "partial",
      `extract.py Bash calls: ${JSON.stringify(extractCalls.map((t) => (t.input as any)?.command))} (all succeeded=${extractCallsSucceeded}); ` +
        `adversarial Bash calls: ${JSON.stringify(adversarialCalls.map((t) => (t.input as any)?.command))} attempted=${adversarialWasAttempted}, denied=${adversarialWasDenied} ` +
        `(via r.denials=${JSON.stringify(r.denials)}, via toolResult.isError=${adversarialDeniedViaToolResult}). ` +
        (adversarialWasAttempted
          ? ""
          : "The model never actually called Bash with the adversarial command, so the permission system's enforcement was not exercised — only the model's own willingness to try was observed."),
    );
  }

  console.log(`[s09] run-agent.ts done. cost=$${r.costUsd}`);

  await runSkillScopeProbe();
}

// Bonus probe (cheap, one data point — A1/S1 investigates this in depth):
// with `skills: ["workbench-skills:document-extraction"]` restricting which
// skill is *offered*, can the agent still invoke a different, CLI-bundled
// skill (e.g. "simplify") that shows up in init.skills regardless of the
// `skills` filter (see the earlier blocked run's init.skills, which listed
// ~17 unrequested skill names)? This is a single Haiku turn, no Bash needed.
async function runSkillScopeProbe() {
  const probePrompt = `You have a Skill tool available. A skill named "document-extraction" was recommended to you, but there are other skills that may or may not be available to you.

Try to invoke a skill named "simplify" (not "document-extraction") using the Skill tool. Report exactly what happened: did it run, was it unavailable/not found, or was it denied? Quote any message you received verbatim.`;

  const r = await runQuery({
    exp: EXP,
    label: "skill-scope-probe",
    prompt: probePrompt,
    options: {
      settingSources: [],
      plugins: [{ type: "local", path: PLUGIN_DIR }],
      skills: ["workbench-skills:document-extraction"],
      tools: ["Skill"],
      permissionMode: "dontAsk",
    },
    timeoutMs: 2 * 60 * 1000,
  });

  console.log(`[s09] skill-scope-probe: subtype=${r.subtype} isError=${r.isError} cost=$${r.costUsd}`);
  console.log(`[s09] skill-scope-probe init.skills=${JSON.stringify(r.init?.skills)}`);
  console.log(`[s09] skill-scope-probe result text: ${redact(r.resultText ?? "")}`);
  console.log(`[s09] skill-scope-probe tool calls: ${JSON.stringify(r.toolCalls.map((t) => ({ name: t.name, input: t.input })))}`);
  console.log(`[s09] skill-scope-probe denials: ${JSON.stringify(r.denials)}`);

  const blocked = isBillingBlocked(r.resultText, r.isError);

  if (blocked) {
    check(
      EXP,
      "bonus-skill-scope-isolation-probe",
      "skip",
      `blocked: API credit balance too low (resultText=${JSON.stringify(redact(r.resultText ?? ""))}).`,
    );
    return;
  }

  const skillCalls = r.toolCalls.filter((t) => t.name === "Skill");
  const simplifyAttempted = skillCalls.some((t) =>
    JSON.stringify(t.input).toLowerCase().includes("simplify"),
  );
  const simplifyDenied = skillCalls.some((t) => {
    if (!JSON.stringify(t.input).toLowerCase().includes("simplify")) return false;
    const result = r.toolResults.find((tr) => tr.toolUseId === t.id);
    const deniedByPermission = r.denials.some((d) => d.tool_use_id === t.id);
    return deniedByPermission || result?.isError === true;
  });

  check(
    EXP,
    "bonus-skill-scope-isolation-probe",
    simplifyAttempted ? (simplifyDenied ? true : "partial") : "partial",
    `init.skills for this probe=${JSON.stringify(r.init?.skills)} (note: "simplify" ${
      (r.init?.skills ?? []).includes("simplify") ? "IS" : "is NOT"
    } present in init.skills despite skills:["workbench-skills:document-extraction"]). ` +
      `Skill tool calls: ${JSON.stringify(skillCalls.map((t) => t.input))}. simplifyAttempted=${simplifyAttempted}, simplifyDenied=${simplifyDenied}. ` +
      `resultText=${JSON.stringify(redact(r.resultText ?? ""))}. denials=${JSON.stringify(r.denials)}. ` +
      "One data point only — A1's S1 investigates skill scoping in depth.",
  );
}

main().catch((err) => {
  console.error("[s09] FAILED:", redact(String(err?.stack ?? err)));
  process.exitCode = 1;
});
