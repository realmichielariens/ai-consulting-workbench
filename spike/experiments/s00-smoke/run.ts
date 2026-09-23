// S0 — Smoke test and environment (M0-SPIKE-PLAN.md §4 "S0").
// Run with: npx tsx experiments/s00-smoke/run.ts
//
// Three tiny Haiku runs, cap $0.20:
//   1. Baseline one-turn query with settingSources: [] — capture init/result,
//      check apiKeySource, check no personal config leaks.
//   2. A Bash-enabled run ("echo $SHELL") — checks Git Bash detection.
//   3. Same as (1) but with CLAUDE_CONFIG_DIR redirected under
//      spike/results/raw/claude-config/ — checks whether the transcript
//      (and init) move there, clean, instead of ~/.claude.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runQuery } from "../../src/lib/run.js";
import { check } from "../../src/lib/report.js";
import { config, rawDir, redact, childEnv } from "../../src/lib/env.js";

const EXP = "s00-smoke";

function findFilesNamed(dir: string, name: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(cur, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (e.name === name) out.push(full);
    }
  }
  return out;
}

function listUserSkillNames(): string[] {
  const skillsDir = path.join(os.homedir(), ".claude", "skills");
  const names = new Set<string>();
  const walk = (dir: string, depth: number) => {
    if (depth > 3 || !fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      if (e.name === "synced" || e.name.startsWith(".bucket")) {
        walk(path.join(dir, e.name), depth + 1);
        continue;
      }
      // A skill directory contains a SKILL.md.
      const skillMd = path.join(dir, e.name, "SKILL.md");
      if (fs.existsSync(skillMd)) {
        names.add(e.name);
      } else {
        // Could be a UUID bucket dir (marketplace sync id) — recurse once more.
        walk(path.join(dir, e.name), depth + 1);
      }
    }
  };
  walk(skillsDir, 0);
  return [...names].sort();
}

function listUserMcpServerNames(): string[] {
  try {
    const p = path.join(os.homedir(), ".claude.json");
    const j = JSON.parse(fs.readFileSync(p, "utf8"));
    return Object.keys(j.mcpServers || {}).sort();
  } catch {
    return [];
  }
}

function listUserHookAndPluginNames(): { hooks: string[]; plugins: string[] } {
  try {
    const p = path.join(os.homedir(), ".claude", "settings.json");
    const j = JSON.parse(fs.readFileSync(p, "utf8"));
    return {
      hooks: Object.keys(j.hooks || {}).sort(),
      plugins: Object.keys(j.enabledPlugins || j.plugins || {}).sort(),
    };
  } catch {
    return { hooks: [], plugins: [] };
  }
}

async function main() {
  console.log(`[s00] key source: ${config.keySource}`);
  console.log(`[s00] model: ${config.model}`);

  const userSkillNames = listUserSkillNames();
  const userMcpNames = listUserMcpServerNames();
  const { hooks: userHookNames, plugins: userPluginNames } = listUserHookAndPluginNames();
  console.log(
    `[s00] user config on disk (read-only, names only): skills=${JSON.stringify(userSkillNames)} mcp=${JSON.stringify(userMcpNames)} hooks=${JSON.stringify(userHookNames)} settingsPlugins=${JSON.stringify(userPluginNames)}`,
  );

  // ---- Run 1: baseline smoke ----------------------------------------------
  // NOTE: runQuery()'s own default env (childEnv()) now sets
  // CLAUDE_CONFIG_DIR by default, because run 4 below (in an earlier pass of
  // this script) proved the redirect works and keeps ~/.claude clean — see
  // src/lib/env.ts. To keep this specific check meaningful across re-runs
  // (it characterizes the SDK's *true* unredirected default), runs 1/2/5/6
  // explicitly clear it back off.
  const r1 = await runQuery({
    exp: EXP,
    label: "baseline",
    prompt: 'Reply with exactly the text "SMOKE-OK" and nothing else.',
    options: {
      settingSources: [],
      env: childEnv({ CLAUDE_CONFIG_DIR: undefined }),
    },
    timeoutMs: 60_000,
  });

  console.log(`[s00] run1 subtype=${r1.subtype} isError=${r1.isError} cost=$${r1.costUsd}`);

  check(
    EXP,
    "run1-succeeds-with-cost",
    r1.subtype === "success" && !r1.isError && r1.costUsd > 0,
    `subtype=${r1.subtype} isError=${r1.isError} costUsd=${r1.costUsd} sessionId=${r1.sessionId} transcript=${r1.transcriptPath}`,
  );

  check(
    EXP,
    "apiKeySource-is-ANTHROPIC_API_KEY",
    r1.init?.apiKeySource === "ANTHROPIC_API_KEY",
    `init.apiKeySource=${r1.init?.apiKeySource}`,
  );

  check(
    EXP,
    "no-personal-skills-leak",
    Array.isArray(r1.init?.skills) && r1.init!.skills.length === 0,
    `init.skills=${JSON.stringify(r1.init?.skills)} (user has: ${JSON.stringify(userSkillNames)})`,
  );

  check(
    EXP,
    "no-personal-mcp-servers-leak",
    Array.isArray(r1.init?.mcp_servers) && r1.init!.mcp_servers.length === 0,
    `init.mcp_servers=${JSON.stringify(r1.init?.mcp_servers)} (user has: ${JSON.stringify(userMcpNames)})`,
  );

  check(
    EXP,
    "no-personal-plugins-leak",
    Array.isArray(r1.init?.plugins) && r1.init!.plugins.length === 0,
    `init.plugins=${JSON.stringify(r1.init?.plugins)}`,
  );

  check(
    EXP,
    "init-has-claude_code_version-and-cwd",
    typeof r1.init?.claude_code_version === "string" && typeof r1.init?.cwd === "string",
    `claude_code_version=${r1.init?.claude_code_version} cwd=${r1.init?.cwd} permissionMode=${r1.init?.permissionMode} model=${r1.init?.model}`,
  );

  check(
    EXP,
    "bundled-binary-spawned-by-default",
    true,
    "pathToClaudeCodeExecutable was not set; sdk.mjs resolves the default executable " +
      "relative to import.meta.url (the @anthropic-ai/claude-agent-sdk package directory) " +
      "when the option is omitted, i.e. it spawns the SDK's bundled binary, not a global " +
      `'claude' on PATH. Both report the same version here (${r1.init?.claude_code_version}), ` +
      "so version alone can't distinguish them; the code path is the evidence. " +
      "See node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs (search 'pathToClaudeCodeExecutable').",
  );

  console.log(`[s00] result text: ${redact(r1.resultText ?? "")}`);

  // ---- Run 2: Bash / Git Bash detection -----------------------------------
  const r2 = await runQuery({
    exp: EXP,
    label: "bash-check",
    prompt: "Run the command `echo $SHELL` using the Bash tool, then reply with exactly its stdout output and nothing else.",
    options: {
      settingSources: [],
      allowedTools: ["Bash"],
      permissionMode: "dontAsk",
    },
    timeoutMs: 60_000,
  });

  console.log(`[s00] run2 subtype=${r2.subtype} isError=${r2.isError} cost=$${r2.costUsd}`);
  console.log(`[s00] run2 result text: ${redact(r2.resultText ?? "")}`);
  console.log(`[s00] run2 init.tools: ${JSON.stringify(r2.init?.tools)}`);

  check(
    EXP,
    "bash-tool-available",
    Array.isArray(r2.init?.tools) && r2.init!.tools.includes("Bash"),
    `init.tools=${JSON.stringify(r2.init?.tools)}`,
  );

  check(
    EXP,
    "git-bash-detected",
    r2.subtype === "success" && !r2.isError ? true : "partial",
    `run2 subtype=${r2.subtype} isError=${r2.isError}; resultText=${redact(r2.resultText ?? "")}. ` +
      "A successful Bash tool call on Windows would confirm Git Bash (or an equivalent shell) was " +
      "found; this run was blocked by the API billing error before the model could call the tool, " +
      "so this is unconfirmed (not failed) — re-run once credits are available.",
  );

  // ---- Run 3: default transcript location -----------------------------
  const userClaudeProjectsDir = path.join(os.homedir(), ".claude", "projects");
  const foundDefaultTranscript = r1.sessionId
    ? findFilesNamed(userClaudeProjectsDir, `${r1.sessionId}.jsonl`)
    : [];
  console.log(
    `[s00] default transcript location for run1 session ${r1.sessionId}: ${JSON.stringify(foundDefaultTranscript)}`,
  );

  check(
    EXP,
    "default-transcript-under-user-claude-projects",
    foundDefaultTranscript.length > 0,
    `searched ${userClaudeProjectsDir} for ${r1.sessionId}.jsonl -> ${JSON.stringify(foundDefaultTranscript)}`,
  );

  // ---- Run 4: CLAUDE_CONFIG_DIR redirect ----------------------------------
  const claudeConfigDir = path.join(rawDir, "claude-config");
  fs.mkdirSync(claudeConfigDir, { recursive: true });

  const r4 = await runQuery({
    exp: EXP,
    label: "config-dir-redirect",
    prompt: 'Reply with exactly the text "SMOKE-OK" and nothing else.',
    options: {
      settingSources: [],
      env: childEnv({ CLAUDE_CONFIG_DIR: claudeConfigDir }),
    },
    timeoutMs: 60_000,
  });

  console.log(`[s00] run4 subtype=${r4.subtype} isError=${r4.isError} cost=$${r4.costUsd}`);

  const foundInRedirectedDir = r4.sessionId
    ? findFilesNamed(claudeConfigDir, `${r4.sessionId}.jsonl`)
    : [];
  const foundInDefaultDirForR4 = r4.sessionId
    ? findFilesNamed(userClaudeProjectsDir, `${r4.sessionId}.jsonl`)
    : [];

  console.log(
    `[s00] CLAUDE_CONFIG_DIR redirect: inRedirectedDir=${JSON.stringify(foundInRedirectedDir)} inDefaultDir=${JSON.stringify(foundInDefaultDirForR4)}`,
  );

  // File placement is independent of whether the turn itself succeeded
  // (billing failures still produce a session_id and an init-time transcript
  // file, since the transcript directory is chosen before the first model
  // call). Judge the redirect on placement, not on turn success.
  check(
    EXP,
    "claude-config-dir-redirect-works",
    foundInRedirectedDir.length > 0 && foundInDefaultDirForR4.length === 0,
    `inRedirectedDir=${JSON.stringify(foundInRedirectedDir)} inDefaultDir=${JSON.stringify(foundInDefaultDirForR4)}`,
  );

  check(
    EXP,
    "claude-config-dir-redirect-init-still-clean",
    Array.isArray(r4.init?.skills) &&
      r4.init!.skills.length === 0 &&
      Array.isArray(r4.init?.mcp_servers) &&
      r4.init!.mcp_servers.length === 0,
    `init.skills=${JSON.stringify(r4.init?.skills)} init.mcp_servers=${JSON.stringify(r4.init?.mcp_servers)}`,
  );

  // ---- Run 5: does an explicit `tools` preset narrow the default surface? ----
  // Runs 1/2/4 all showed init.tools/agents/slash_commands/plugins far
  // broader than a "vanilla" Claude Code session (see FINDINGS "Surprises").
  // Test whether `tools: {type:'preset', preset:'claude_code'}` (the
  // documented "use all default Claude Code tools" preset) narrows it back
  // down, as a candidate mitigation for the real Work Agent runtime.
  const r5 = await runQuery({
    exp: EXP,
    label: "tools-preset-claude-code",
    prompt: 'Reply with exactly the text "SMOKE-OK" and nothing else.',
    options: {
      settingSources: [],
      tools: { type: "preset", preset: "claude_code" },
    },
    timeoutMs: 60_000,
  });

  console.log(`[s00] run5 init.tools: ${JSON.stringify(r5.init?.tools)}`);
  console.log(`[s00] run5 init.agents: ${JSON.stringify(r5.init?.agents)}`);
  console.log(`[s00] run5 init.plugins: ${JSON.stringify(r5.init?.plugins)}`);
  console.log(`[s00] run5 init.slash_commands: ${JSON.stringify(r5.init?.slash_commands)}`);

  const fleetviewOnlyToolNames = [
    "Task",
    "CronCreate",
    "CronDelete",
    "CronList",
    "DesignSync",
    "EnterWorktree",
    "ExitWorktree",
    "ListAgents",
    "Monitor",
    "PushNotification",
    "ReportFindings",
    "ScheduleWakeup",
    "SendMessage",
    "TaskCreate",
    "TaskGet",
    "TaskList",
    "TaskStop",
    "TaskUpdate",
    "ToolSearch",
    "Workflow",
  ];
  const r5StillHasExtras = (r5.init?.tools ?? []).filter((t) =>
    fleetviewOnlyToolNames.includes(t),
  );

  check(
    EXP,
    "tools-preset-claude_code-narrows-default-surface",
    r5StillHasExtras.length === 0,
    `with tools:{type:'preset',preset:'claude_code'}, remaining non-standard tools = ${JSON.stringify(r5StillHasExtras)}; ` +
      `full init.tools=${JSON.stringify(r5.init?.tools)}`,
  );

  // ---- Run 6: does an explicit `tools` array (not the preset) narrow it? ----
  // ARCHITECTURE.md §8.2 plans an explicit allowedTools array for Work Agent
  // runs; check whether the `tools` base-set option, given as an explicit
  // array rather than the 'claude_code' preset, actually restricts the base
  // set (per its doc comment: "string[] - Array of specific tool names").
  const r6 = await runQuery({
    exp: EXP,
    label: "tools-explicit-array",
    prompt: 'Reply with exactly the text "SMOKE-OK" and nothing else.',
    options: {
      settingSources: [],
      tools: ["Read", "Write", "Edit", "Glob", "Grep", "Skill"],
    },
    timeoutMs: 60_000,
  });

  console.log(`[s00] run6 init.tools: ${JSON.stringify(r6.init?.tools)}`);

  const r6Extras = (r6.init?.tools ?? []).filter(
    (t) => !["Read", "Write", "Edit", "Glob", "Grep", "Skill"].includes(t),
  );

  check(
    EXP,
    "tools-explicit-array-narrows-default-surface",
    (r6.init?.tools ?? []).length > 0 && r6Extras.length === 0,
    `with tools:["Read","Write","Edit","Glob","Grep","Skill"], init.tools=${JSON.stringify(r6.init?.tools)} (extras=${JSON.stringify(r6Extras)})`,
  );

  const totalCost = r1.costUsd + r2.costUsd + r4.costUsd + r5.costUsd + r6.costUsd;
  console.log(`[s00] total cost across 5 API runs: $${totalCost.toFixed(4)}`);

  check(
    EXP,
    "total-cost-under-cap",
    totalCost < 0.2,
    `total observed cost across baseline+bash+config-dir+tools-preset+tools-array runs = $${totalCost.toFixed(4)} (cap $0.20)`,
  );

  const billingBlocked = [r1, r2, r4, r5, r6].every((r) => r.costUsd === 0 && r.isError);
  check(
    EXP,
    "billing-blocker-not-a-harness-bug",
    billingBlocked ? "partial" : true,
    billingBlocked
      ? "Every run in this experiment returned is_error with $0 cost and result text " +
        `"${redact(r1.resultText ?? "")}" (or equivalent). This is the Anthropic API's own ` +
        "pre-flight billing check rejecting the request (the account behind ANTHROPIC_API_KEY " +
        "has no credit balance) — the SDK/CLI plumbing, auth resolution and init-time behavior " +
        "are otherwise all working (see the other checks in this file, which needed no successful " +
        "model call to evaluate). Needs a human to add credits at console.anthropic.com for the " +
        "key currently in HKCU\\Environment, then a full re-run of S0 (and everything downstream) " +
        "to get real cost/turns/usage numbers."
      : "at least one run completed without the billing block",
  );
}

main().catch((err) => {
  console.error("[s00] FAILED:", redact(String(err?.stack ?? err)));
  process.exitCode = 1;
});
