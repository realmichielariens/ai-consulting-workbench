# S1 — Skills through a local plugin, scoped per query

**Verdict:** PASS (scoping works, personal skills are excluded, a skill's own scripts can be found and run — with one important negative finding and a validated fallback: see Surprises)
**Cost:** $0.1906 (cap $0.50)
**Runs:** 18 API calls (14 in `core.ts` + 3 in `addendum.ts` + 1 in `probe-bash-scope.ts`)
**SDK:** 0.3.280
**Model:** claude-haiku-4-5

## Hypothesis

`plugins: [{type:"local", path}]` + `settingSources: []` + a per-query `skills` allowlist loads only
the plugin's skills, and restricts them per query.

## Setup (what was built; how to re-run)

- Read-only use of the shared marker-skills plugin at `spike/fixtures/plugin/workbench-skills/`
  (alpha/beta/gamma, tokens `SKILL-ALPHA-OK-7f3` / `SKILL-BETA-OK-2c9` / `SKILL-GAMMA-OK-a41`, gamma's
  `scripts/token.mjs` prints `SKILL-GAMMA-SCRIPT-OK-5d0`).
- `experiments/s01-skills/fixtures/fallback-project/.claude/skills/{alpha,beta}/` — a copy of two of the
  marker skills, for the `settingSources: ["project"]` fallback (step 7). Nothing else lives there (no
  `settings.json`, no `CLAUDE.md`).
- `experiments/s01-skills/core.ts` — 14 runs covering steps 1-3, 4 (bundled skills, one name), 5 (gamma's
  own script), 6 (allowed-tools front-matter vs. session `disallowedTools`), 7 (the fallback).
- `experiments/s01-skills/addendum.ts` — 3 follow-up runs triggered by a surprise found in `core.ts` (see
  Surprises): a PreToolUse-hook recipe for scoping `Bash` reliably, more bundled-skill names, and an
  isolated `disallowedTools:["Bash"]` probe.
- `experiments/s01-skills/probe-bash-scope.ts` — a minimal, skill/plugin-free standalone confirmation of
  the same Bash-scoping surprise (kept separate; not part of the main checklist).
- `experiments/s01-skills/run.ts` — thin wrapper, runs `core.ts` then `addendum.ts` in order (mirrors S9's
  `run-local.ts`/`run-agent.ts`/`run.ts` pattern).

Re-run with:
```sh
cd spike
npx tsx experiments/s01-skills/run.ts              # everything, in order
npx tsx experiments/s01-skills/core.ts              # just the main checklist
npx tsx experiments/s01-skills/addendum.ts          # just the follow-up probes
npx tsx experiments/s01-skills/probe-bash-scope.ts  # the standalone Bash-scoping confirmation
```

**A note on evidence-gathering, since it shaped several results below:** two of `core.ts`'s original
grading helpers had bugs found and fixed during this experiment (both are fixed in the delivered
`core.ts`; the checks below reflect the corrected grading, re-derived from the already-saved transcripts
without any extra API calls):
1. `containsToken()` originally only scanned the final `resultText` and `toolResults`, missing a token
   that appeared in an *intermediate* assistant text block (between two tool calls) — undercounted a
   real pass as a fail (gamma's own marker token).
2. A "was the beta token found via the Skill tool" check scanned the *whole transcript* instead of that
   specific tool call's own result, false-positiving on the token legitimately appearing via a separate,
   deliberate Read-bypass call in the same run.

Both are called out explicitly in the affected check's evidence field in `results/s01-skills/summary.json`.

## Results

| Check | Result | Evidence (file:line / summary.json check name) |
|---|---|---|
| `skills: ["workbench-skills:alpha"]` + `plugins` + `settingSources: []`: `init.skills` lists the plugin skill | PASS | `scoped-skills-init-lists-plugin-skill` — `init.skills` includes `"workbench-skills:alpha"` |
| Asking for alpha invokes it, token appears | PASS | `scoped-skills-alpha-invocable-and-token-emitted` — Skill tool call `{"skill":"workbench-skills:alpha"}`, token in result |
| Asking for beta (not in the allowlist) is refused via the Skill tool | PASS | `scoped-skills-beta-refused-via-Skill-tool` — tool_result: `<tool_use_error>Skill beta is not in this session's skills allowlist</tool_use_error>` |
| The `skills` allowlist is a context filter, not a sandbox — beta's SKILL.md is still readable via `Read` | PASS (security-relevant) | `skills-allowlist-is-context-filter-not-sandbox-bypass-via-Read` — `Read` on beta's SKILL.md succeeds, token recovered that way |
| Personal `~/.claude/skills` (pptx/docx/morning/etc.) absent | PASS | `personal-claude-skills-absent` |
| Naming: bare name (`skills: ["alpha"]`, no plugin prefix) | PASS (works) | `naming-variant-bare-name-works` |
| Naming: `skills: "all"` | PASS (enables everything, incl. beta) | `naming-variant-skills-all-enables-every-skill` |
| Naming: `skills: []` (explicit empty array) | PASS (disables everything) | `naming-variant-empty-array-disables-every-skill` |
| Naming: `skills` omitted entirely | PASS (not "skills off" — broad default surface, plugin skill included) | `naming-variant-omitted-is-not-skills-off` |
| Bundled skill (`simplify`) invocation with `skills: ["workbench-skills:alpha"]` only | PASS (correctly denied) | `scoped-skills-array-blocks-bundled-skill-invocation` — tool_result: `Skill simplify is not in this session's skills allowlist` |
| Same, for 3 more bundled names (`claude-api`, `dataviz`, `code-review`) | PASS (all denied) | `scoped-skills-array-blocks-multiple-bundled-skill-names` |
| `settings: { disableBundledSkills: true }` removes bundled skills from `init.skills` itself | PASS | `disableBundledSkills-settings-option-removes-bundled-skills` — `init.skills` shrinks to only the plugin's own 3 + 2 CLI-internal names |
| `CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1` env var — same effect | PASS | `CLAUDE_CODE_DISABLE_BUNDLED_SKILLS-env-var-equivalent` |
| PreToolUse hook on `Skill`: fires, allows alpha | PASS | `pretooluse-hook-fires-for-Skill-tool-and-allows-alpha` |
| PreToolUse hook on `Skill`: denies a bundled skill with a reason the agent sees | PASS | `pretooluse-hook-denies-bundled-skill-with-reason` |
| gamma locates and runs its own bundled script | PASS | `gamma-skill-locates-and-runs-its-own-script` |
| A scoped `allowedTools: ["Bash(node <abs-script> *)"]` rule, alone, under `dontAsk`, denies an unrelated `node -e ...` command | **FAIL (real negative finding)** | `gamma-scoped-bash-rule-allows-script-denies-other-node-calls` — the unrelated command ran anyway, no denial |
| A PreToolUse hook on `Bash` reliably restricts it to one exact command | PASS (validated fallback) | `pretooluse-hook-is-the-reliable-way-to-scope-Bash-to-one-command` |
| `disallowedTools: ["Bash"]` is a real, working blanket deny | PASS | `disallowedTools-Bash-is-a-real-blanket-deny-distinct-from-allowedTools-scoping` — `init.tools` becomes `[]`, Bash entirely absent |
| A skill's own `allowed-tools: Bash` front-matter does **not** override the session's `disallowedTools: ["Bash"]` | PASS | `skill-frontmatter-allowed-tools-does-not-override-session-disallowedTools` |
| Fallback: `.claude/skills/` + `settingSources: ["project"]` works | PASS | `fallback-project-settingSources-loads-local-claude-skills` |
| What else `"project"` pulls in | PASS (documented) | `fallback-project-settingSources-scope-of-what-else-loads` |
| Total cost under cap | PASS | $0.1906 / $0.50 |

## Exact working configuration (copy-pasteable snippets, rule syntax, option shapes)

**Scoped plugin skills, per query** — the core recipe, confirmed working exactly as ARCHITECTURE.md
§17.1 hypothesized:
```ts
options: {
  settingSources: [],
  plugins: [{ type: "local", path: PLUGIN_DIR }],   // absolute path to the plugin dir (has .claude-plugin/plugin.json)
  skills: ["workbench-skills:alpha"],                 // plugin-qualified name; bare "alpha" also works (see Surprises)
  tools: ["Read", "Skill"],                           // explicit array — see S0 FINDINGS: omission/preset don't narrow
  permissionMode: "dontAsk",
}
```
`skills` accepts: `string[]` (only those load AND are invocable — see Surprises for the nuance),
`"all"` (everything, including the ~17-20 CLI-bundled names becomes invocable too), `[]` (nothing
invocable), or omitted (broad default surface, "not skills off" per sdk.d.ts's own comment).

**Removing bundled skills entirely** (answers the ARCHITECTURE §8.7 security question — see Surprises
for why this is a *second, independent* layer on top of what `skills: [...]` already does):
```ts
options: {
  settings: { disableBundledSkills: true },   // sdk.d.ts's "flag settings" layer, highest priority
}
// equivalently:
options: {
  env: childEnv({ CLAUDE_CODE_DISABLE_BUNDLED_SKILLS: "1" }),
}
```
Both shrink `init.skills` down to only the plugin's own skills (plus two CLI-internal plugin names,
`agents-md`/`telemetry`, unrelated to skills). Confirmed by two independent runs (`disable-bundled-settings`,
`disable-bundled-env`), each also re-confirming the plugin skill (alpha) still works.

**PreToolUse hook fallback for skills** (works, in-process JS callback — no shell script needed since
`query()` is called directly):
```ts
hooks: {
  PreToolUse: [{
    matcher: "Skill",
    hooks: [async (input) => {
      const name = String(input?.tool_input?.name ?? input?.tool_input?.skill ?? "");
      const allowed = ["alpha", "workbench-skills:alpha"].some(a => name === a || name.includes(a));
      return {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: allowed ? "allow" : "deny",
          ...(allowed ? {} : { permissionDecisionReason: `skill "${name}" is not in the allowlist` }),
        },
      };
    }],
  }],
}
```
Note the actual `tool_input` shape observed for the `Skill` tool call was `{"skill": "workbench-skills:alpha"}`
(a `skill` field, not `name` or `command` — the hook above checks all three defensively; only `skill` was
ever populated in these runs).

**gamma's own script directory** — no `${CLAUDE_SKILL_DIR}`/`${CLAUDE_PLUGIN_ROOT}`-style variable
substitution was observed anywhere in any transcript (`grep -c "CLAUDE_" *.jsonl` -> 0 across every S1
transcript). The model instead combined `init.plugins[].path` (the plugin's absolute root — visible to it
in its own session context, since it correctly used this exact string) with the *relative* path mentioned
in the SKILL.md body text (`scripts/token.mjs`), and constructed the absolute path itself — this is
gamma's SKILL.md's own fallback option 2 ("a path relative to this SKILL.md file's own directory"), not
option 1 (a variable). **The working, harness-side recipe** (what S9 already does, and what this
confirms is necessary — do not rely on the model resolving the path on its own in a Bash-restricted
session, since it needs to be in `allowedTools` *before* the run starts):
```ts
const scriptAbs = path.join(PLUGIN_DIR, "skills", "gamma", "scripts", "token.mjs").replace(/\\/g, "/");
options: {
  tools: ["Read", "Skill", "Bash"],
  // See Surprises: this allowedTools rule alone does NOT reliably restrict Bash to just this
  // command under dontAsk — pair it with the PreToolUse hook below for real enforcement.
  allowedTools: [`Bash(node ${scriptAbs} *)`],
  permissionMode: "dontAsk",
}
```

**The Bash scoping fix that actually works** (see Surprises — this replaces, not supplements, the
`allowedTools` rule above as the *enforcement* mechanism):
```ts
hooks: {
  PreToolUse: [{
    matcher: "Bash",
    hooks: [async (input) => {
      const command = String(input?.tool_input?.command ?? "").trim();
      const allowed = command === `node "${scriptAbs}"` || command === `node ${scriptAbs}`;
      return {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: allowed ? "allow" : "deny",
          ...(allowed ? {} : { permissionDecisionReason: `only "node ${scriptAbs}" is allowed via Bash` }),
        },
      };
    }],
  }],
}
```
Confirmed in `addendum.ts`'s `gamma-bash-pretooluse-hook` run: the real script command was allowed, an
adversarial `node -e "console.log(...)"` command was denied with the reason surfaced to the agent, and
the denial actually held (unlike the `allowedTools`-only version).

**`disallowedTools` is a real, working blanket deny** — distinct from (and simpler/stronger than) an
`allowedTools` scoped rule:
```ts
options: {
  tools: ["Bash"],
  disallowedTools: ["Bash"],
  permissionMode: "dontAsk",
}
```
This produces `init.tools = []` — Bash is removed from the tool listing entirely (same mechanism as
`tools` narrowing the base set per S0 FINDINGS), not merely denied at call time. Confirmed by a forced,
explicit probe (`addendum.ts`'s `disallowed-bash-forced-probe`).

**Fallback: project-scoped skill directory**
```ts
options: {
  settingSources: ["project"],
  cwd: "<item work dir with .claude/skills/<name>/SKILL.md>",
  skills: ["alpha"],   // bare name — no plugin prefix in this mode
  tools: ["Read", "Skill"],
  permissionMode: "dontAsk",
}
```
Works. With no `.claude/settings.json` or `CLAUDE.md` in that directory, `"project"` pulled in nothing
else observable beyond the skill itself (`init.mcp_servers=[]`; `init.plugins` only the same two
CLI-internal builtins seen everywhere). A real project directory with its own `settings.json`/`CLAUDE.md`/
`.mcp.json` would also load those under `"project"` — untested here since the fixture deliberately has
none, to isolate what the skill directory alone contributes.

## Surprises and deviations from ARCHITECTURE.md

1. **`init.skills` is always broader than what you asked for — but the `skills` array already blocks
   actual invocation, not just the listing.** With `settingSources: []` and any plugin/skills config,
   `init.skills` still includes ~17-20 CLI-bundled names (`deep-research`, `design`, `dataviz`,
   `update-config`, `verify`, `debug`, `code-review`, `simplify`, `batch`, `fewer-permission-prompts`,
   `doctor`, `loop`, `claude-api`, `workflow-authoring`, `run`, `run-skill-generator`, plus
   `design-sync`) — reproducing S0/S9's "Surprises" finding for skills specifically. **The important,
   good news, confirmed here for the first time with a real completed model turn:** despite being
   *listed*, none of these are actually *invocable* via the `Skill` tool when an explicit `skills: [...]`
   array is passed — every attempt (tested: `simplify`, `claude-api`, `dataviz`, `code-review`) returns
   `<tool_use_error>Skill <name> is not in this session's skills allowlist</tool_use_error>`. So
   `skills: [...]` is already an effective **invocation allowlist**, not merely a "what's shown to the
   model" filter — it just doesn't also scrub `init.skills` itself. If hiding the names from the model's
   own listing matters (e.g. so it never even tries, or doesn't waste a turn discovering the denial), use
   `settings: { disableBundledSkills: true }` (or the equivalent `CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1`
   env var) *in addition* — this is a genuinely separate, cleaner mechanism, not just a duplicate.

2. **`allowedTools: ["Bash(node <abs-path> *)"]` under `permissionMode: "dontAsk"` does NOT reliably
   restrict Bash to that one command.** This contradicts `sdk.d.ts`'s own documented semantics for
   `dontAsk` ("deny if not pre-approved") and the pattern the harness README and S9's FINDINGS both
   recommend. Found while testing gamma's scoped script rule (`gamma-scoped-rule-confirm`): a
   deliberately unrelated `node -e "console.log('ADVERSARIAL-NODE-CALL')"` command, which does not match
   the allow-rule's literal prefix under any plausible interpretation, ran successfully anyway —
   `tool_result.isError: false`, `result.permission_denials: []`. Confirmed independently, and even more
   starkly, by a minimal standalone probe (`probe-bash-scope.ts`) with **no skill/plugin machinery at
   all**: `tools: ["Bash"]`, `allowedTools: ["Bash(node C:/some/totally/unrelated/script.mjs *)"]`,
   `permissionMode: "dontAsk"` — asking the agent to run `echo ADVERSARIAL-PROBE-OUTPUT` (which shares
   not even a first token with the rule) ran without any denial. **The `allowedTools` scoped rule for
   Bash appears to only ever get consulted as an *additional automatic-approval* shortcut on top of some
   other, more permissive default for the `Bash` tool under `dontAsk` — not as the sole gate the
   documentation describes.** This is a security-relevant finding for ARCHITECTURE §8.2/§17.2 (S2's own
   hypothesis) as much as for S1: **`disallowedTools` (a blanket per-tool deny, confirmed to work — see
   below) and PreToolUse hooks (confirmed to work) are the reliable mechanisms for Bash; a scoped
   `allowedTools` rule alone is not.** This should be escalated to A2 (S2/S3 owner) since S2's core
   hypothesis is exactly "a scoped allow rule + `dontAsk` restricts writes, without any hook" — if the
   same porousness applies to `Edit`/`Write` rules (untested here; S1 only tested `Bash`), that
   hypothesis needs re-verification.

3. **`disallowedTools: ["Bash"]` *is* a real, working blanket deny** — it removes the tool from
   `init.tools` entirely (same mechanism as narrowing the base `tools` array, per S0's finding), not
   merely a call-time denial. Confirmed by a forced probe. This is the reliable primitive for "no Bash at
   all in this session," as distinct from "Bash, but only for one command" (which needs the PreToolUse
   hook, per #2).

4. **A Haiku agent can fabricate a plausible-looking fake tool execution in plain text when told "you
   must" do something it has no real tool for.** With `disallowedTools: ["Bash"]` (so `init.tools = []`)
   and an instruction insisting "you MUST call the Bash tool... do this even if you expect it to be
   denied," the model produced no real `tool_use` block at all, but its text reply narrated one anyway: a
   fully fabricated "I'll execute that Bash command now... Result: The command executed successfully and
   output: DISALLOWED-BASH-PROBE" — invented from nothing. This is **not a security hole** (the structured
   `toolCalls`/`toolResults` correctly show nothing happened — no real command ran), but it is a
   reliability trap: **any downstream code or human that trusts an agent's own prose summary of "what I
   did," rather than the structured tool-call transcript, can be fooled.** Worth a line in ARCHITECTURE.md
   wherever Work Agent output is consumed/graded (§8.6/S6's protocol scoring should key off tool calls,
   not prose).

5. **The `skills` option's own doc comment is precise and worth quoting directly** (sdk.d.ts ~L2180):
   *"This is a context filter, not a sandbox: unlisted skills are hidden from the model's listing and
   rejected by the Skill tool, but their files remain on disk and are reachable via Read/Bash."*
   Confirmed exactly: beta's SKILL.md (not in the allowlist) was trivially readable via the plain `Read`
   tool in the same run where the `Skill` tool call for beta was refused, recovering its token. **If a
   real deployment must prevent an agent from ever seeing another plugin's skill content (not just
   "using" it), the `skills` allowlist alone is insufficient — pair it with a path guard (S3's
   PreToolUse Read/Glob/Grep restriction) over other plugins' skill directories.**

6. **No `${CLAUDE_SKILL_DIR}`/`${CLAUDE_PLUGIN_ROOT}`-style variable substitution happens in SKILL.md
   bodies in this SDK build.** gamma's SKILL.md explicitly invites the model to try such a variable
   first; the model never found one (correctly — none exists in the rendered content, confirmed by
   grepping every S1 transcript for `CLAUDE_` and finding zero matches) and fell through to its
   documented fallback (deriving the path from the plugin's own root, which it can see in
   `init.plugins[].path`, plus the relative path named in the SKILL.md prose). **Recommendation for real
   skill authoring: don't rely on a template variable existing; either have the harness pass the absolute
   script path explicitly in the prompt/allowedTools (as S9 already does), or write the SKILL.md's
   relative-path fallback clearly enough that the model can reconstruct it, as gamma's did.**

## Recommendation (what to change in ARCHITECTURE.md, if anything)

1. **§8.7** (skill loading): confirm the working recipe above — `plugins` + `settingSources: []` +
   `skills: [...]` (plugin-qualified names) does scope invocation correctly, including against
   adversarial requests for CLI-bundled skills. Add `settings: { disableBundledSkills: true }` (or the
   `CLAUDE_CODE_DISABLE_BUNDLED_SKILLS` env var) as a recommended *additional* layer if hiding
   unrequested skill names from the model's own context (not just blocking invocation) matters for token
   budget or reducing wasted turns.
2. **§8.7 / §15**: note that the `skills` allowlist is a context filter, not a file-access sandbox — a
   real deployment that must prevent an agent from reading another plugin's skill content needs a path
   guard, not just the `skills` option.
3. **§8.2 / §17.2 (S2's hypothesis) — escalate:** a scoped `allowedTools` rule for `Bash` did not reliably
   restrict it under `permissionMode: "dontAsk"` in this build; only `disallowedTools` (blanket) and a
   PreToolUse hook (per-command) were confirmed to actually enforce. This directly touches S2's own core
   hypothesis ("a scoped allow rule + `dontAsk` restricts writes, without any hook") — worth an explicit
   re-check there for `Edit`/`Write` rules specifically, since S1 only tested `Bash`.
4. **§8.7** (the export/extraction skills, e.g. S9's `document-extraction`): document the working
   script-path recipe — pass the absolute script path explicitly via the harness (in the prompt and in
   `allowedTools`), don't rely on a `${CLAUDE_SKILL_DIR}`-style variable existing in the rendered
   SKILL.md.
5. **§8.6 / S6's scoring**: score Work Agent protocol adherence from the structured tool-call transcript,
   not the agent's own prose summary — Haiku can narrate a plausible but entirely fabricated tool result
   when pressured and given no real tool to use (Surprise #4).

## Fallback status (tested? works?)

- **Fallback from the plan** ("copy the selected skills per run into `<item>/work/.claude/skills/` with
  `settingSources: ["project"]`"): **tested, works.** `fallback-project-settingSources-loads-local-claude-skills`
  passed — the skill loaded and was invocable from a project-local `.claude/skills/` directory with no
  plugin involved at all.
- **New fallback found necessary during this experiment** (not in the original plan, but needed once
  Surprise #2 was found): a PreToolUse hook on `Bash`, as the reliable replacement for a scoped
  `allowedTools` rule. **Tested, works** — see `pretooluse-hook-is-the-reliable-way-to-scope-Bash-to-one-command`.
- The PreToolUse-hook fallback for `Skill` itself (in case `skills: [...]` alone were found insufficient)
  was also built and tested, even though it turned out not to be strictly necessary (Surprise #1 shows
  `skills: [...]` already blocks invocation on its own) — it's a valid extra layer, confirmed working.

## Harness change requests

None. `core.ts`/`addendum.ts`/`probe-bash-scope.ts` use the shared harness (`runQuery`, `check`,
`childEnv`) exactly as documented in `spike/README.md`; no changes to `src/lib/` were needed.

## Open questions

1. **Does the `allowedTools`-scoped-rule porousness (Surprise #2) also affect `Edit`/`Write` rules, not
   just `Bash`?** This is S2's job to check directly (its own hypothesis is exactly this pattern for
   `Edit`), but it's flagged here since it was found in S1's own gamma-script testing and is
   security-critical enough to not sit unescalated.
2. **Why does the scoped rule fail to restrict, given `sdk.d.ts` explicitly documents `dontAsk` as "deny
   if not pre-approved"?** Not root-caused here (would require reading the CLI's actual permission-
   matching implementation, likely in the compiled binary rather than the bundled `sdk.mjs`, which is
   mostly re-exported types plus a thin process-spawning wrapper) — treated as an empirical fact to design
   around (`disallowedTools` + hooks), not a solved mechanism.
3. Only one bundled-skill *invocation pathway* (the `Skill` tool with a `{"skill": "<name>"}` input) was
   tested. Whether a bundled skill could be triggered some other way (e.g. a slash command alias, or
   auto-triggering from its own description without an explicit request) was not tested here.
4. The `settingSources: ["project"]` fallback was tested against a deliberately minimal fixture directory
   (no `settings.json`, no `CLAUDE.md`, no `.mcp.json`) specifically to isolate what the skill directory
   alone contributes. What else `"project"` pulls in when those other files ARE present is undemonstrated
   here (documented as a gap in the relevant check's evidence, not assumed).
