# S2 — Scoped permission rules on Windows

**Verdict:** PASS   **Cost:** $0.22   **Runs:** 13   **SDK:** 0.3.280   **Model:** claude-haiku-4-5

> Written by the main session from `results/s02-permissions/summary.json` and the raw transcripts. Subagent A2 ran the experiment, but it hit the Claude Code session limit before writing this file.

## Hypothesis
With `permissionMode: "dontAsk"` and an allow rule `Edit(<abs item work>/**)`, writes inside `work/` succeed and every other write is denied, with no hook.

## Setup
`experiments/s02-permissions/run.ts` (re-run: `npx tsx experiments/s02-permissions/run.ts`). The fixture is from `createEngagementFixture()`, with `cwd = items/WI-001/work`, `additionalDirectories = [engRoot]` and `permissionMode: "dontAsk"`. No hooks. Every run hashes the whole fixture root before and after (`hashTree`/`diffTrees`).

## Results
| Check | Result | Evidence |
|---|---|---|
| `Edit(//C:/Users/…/work/**)` (documented `//` + drive colon) | **FAIL**: inside write denied too | summary `anchor-form-double-slash-drive-colon` |
| `Edit(/C:/Users/…/work/**)` | **FAIL**: inside denied | `anchor-form-single-slash-drive-colon` |
| `Edit(//c/Users/…/work/**)` (Git Bash form) | PASS | `anchor-form-double-slash-gitbash` |
| `Edit(//C/Users/…/work/**)` | PASS | `anchor-form-double-slash-drive-nocolon-upper` |
| `Edit(C:\Users\…\work/**)` | PASS | `anchor-form-native-backslash` |
| `Edit(C:/Users/…/work/**)` (forward slashes, no leading slash) | PASS | `anchor-form-forward-slash-native-case` (used for the battery) |
| `Edit(./**)` and `Edit(**)` (cwd-relative) | PASS | `anchor-form-cwd-relative-dot`, `…-bare` |
| A `Write(path)` rule does **not** govern writes; only `Edit(path)` rules are matched by file checks | confirmed | `write-rule-alone-does-not-govern-writes` (CLI validator message quoted) |
| Battery: own `work/` Write/Edit/NotebookEdit allowed; own `assets/`, WI-002 `work/`, engagement root, `../outside`, backslash, mixed-case, `..` escape all denied; no unexpected writes (hash diff) | PASS (15 checks) | `battery-*` |
| `disallowedTools: ["Bash"]` removes Bash from `init.tools` | PASS | `disallowedTools-removes-bash-from-init-tools` |
| **Read** of `WI-002/work/secret.md` (inside `additionalDirectories`, no rule) | **allowed**: canary read (3 hits) | `read-wi002-work-under-additionalDirectories` |
| Read of `../outside/secret.txt` (outside cwd + additionalDirectories) | denied by default | `read-outside-engRoot-denied-by-default` |

## Exact working configuration
```ts
options: {
  cwd: itemWorkDir,                          // items/WI-001/work
  additionalDirectories: [engRoot],
  permissionMode: "dontAsk",
  tools: ["Read", "Write", "Edit", ...],     // explicit base set (S0)
  allowedTools: ["Read", "Edit(./**)"],      // or `Edit(${abs.replaceAll("\\", "/")}/**)`
}
```
Prefer `Edit(./**)` with `cwd` set to the item's `work/`, because it avoids anchor syntax altogether. If an absolute rule is needed, use forward slashes with no leading slash (`C:/…/**`), or the Git Bash form `//c/…/**`. **Do not** use `//C:/…`.

## Surprises and deviations from ARCHITECTURE.md
- The obvious absolute forms (`//C:/…` and `/C:/…`) silently match nothing, so writes are denied everywhere. That fails closed (safe), but it's confusing.
- `dontAsk` does **not** restrict reads inside `additionalDirectories`. Any file under the engagement root, including other items' `work/` and `.workbench/`, is readable without a rule. Layer 2 of §8.5 therefore gives write enforcement only; read scope needs the guard hook (S3).
- **Shell reads bypass `dontAsk` too** (main-session addendum, see S3): shell commands that Claude Code classifies as read-only (`head`, `ls`) run with no allow rule and read anything under `additionalDirectories`.

## Recommendation
§8.2: use `Edit(./**)`, with `cwd` = own work/, as the write rule, and remove the "exact syntax is a spike item" note. §8.5: say explicitly that permission rules cover writes only, and that read scope is enforced by the PreToolUse guard.

## Fallback status
Not needed for writes.

## Harness change requests
None.

## Open questions
None blocking.
