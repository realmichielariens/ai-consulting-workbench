# Work Agent prompts

W1 renders these with **simple `{{variable}}` substitution** (no loops, no
conditionals in the template files themselves — every list-shaped value is
pre-formatted into a single string by W1 before substitution, as described
below). This file is the contract W1 implements against; if you need a
variable that isn't here, add it here first and say so in your look report
rather than inventing a name in the code.

## Files

| File | Used for | Becomes |
|---|---|---|
| `work-agent.md` | Every run (`ARCHITECTURE.md §8.2` `systemPrompt`) | The system prompt, rendered with the item and settings. Role, locus of control, tool list, end-of-turn rules. |
| `protocol.md` | Every run | The detailed work protocol (draft → publish → log → self-check → submit; question handling; minor/material; no fabrication). Static text, no variables. Placement is a run-time choice by W1 (see below); **the default is placement A**. |
| `run-start.md` | `reason: "start"` | The run prompt (the `prompt` passed to `query()`) for a brand-new session. |
| `run-resume-answer.md` | `reason: "resume-answer"` | The run prompt for a resumed session, after a question was answered. |
| `run-changes-requested.md` | `reason: "changes-requested"` | The run prompt for a resumed session, after a gate reviewer requested changes. |
| `run-resume.md` | `reason: "resume"` | The run prompt for a resumed session after a restart (R1) or a retry after a run issue (R3). |

`reason: "stale-rerun"` is out of scope for I1 (it arrives in I4 with
staleness); there is no prompt file for it yet.

## Protocol placement (A vs B)

The workbench protocol (`protocol.md`) can be delivered to the agent two
ways, and the S6 benchmark (I1-PLAN §6, W2) compares them:

- **Placement A — inline (default).** W1 concatenates the rendered
  `work-agent.md` with the verbatim contents of `protocol.md` to build the
  full `systemPrompt`: `render("work-agent", vars) + "\n\n" + read("protocol.md")`.
  The item's `skills` list is used as declared in `item.md` (for example
  `[interview-guide-design]`); `workbench-protocol` is **not** added.
- **Placement B — skill.** W1 uses only the rendered `work-agent.md` as
  `systemPrompt`, and adds `workbench-skills:workbench-protocol` to the
  run's `skills` list (in addition to the item's own skills). The skill
  body at `workbench-skills/skills/workbench-protocol/SKILL.md` is
  word-for-word the same text as `protocol.md`, so the two placements teach
  the identical protocol.

**Recommend placement A (inline) as the I1 default.** A system-prompt
instruction cannot be "forgotten" the way a skill that the model chooses
not to invoke can; S6 measures whether that matters in practice on Haiku.

## Variables

Values come from `BriefView` (`packages/core/src/ports.ts`) plus the run's
`RunInput` (`packages/core/src/ports.ts`). Multi-line values are already
formatted as a block of text (e.g. one `- ` line per entry); substitute them
as-is, don't re-indent or re-wrap them.

### Common (available in `work-agent.md` and `run-start.md`)

| Variable | Type | Content | Example |
|---|---|---|---|
| `{{itemId}}` | string | The item's id | `WI-002` |
| `{{itemTitle}}` | string | The item's title | `Prepare interview guide` |
| `{{brief}}` | string (block) | The item's brief, verbatim Markdown | *(the brief body)* |
| `{{acceptance}}` | string (block) | One `- ` line per acceptance criterion, or `(none)` if empty | `- Every theme is backed by at least two interviews` |
| `{{inputs}}` | string (block) | One line per declared input: `- {slot} v{version} — {absolutePath}` (version/path `(not yet published)` if a required input is somehow missing; `(optional, not yet published)` for an unpublished optional input), or `(none)` | `- ENG/context v1.0 — C:\...\items\ENG\assets\context\v1.0.md` |
| `{{outputs}}` | string (block) | One line per output slot: `- {slot} ({format}, {required\|optional}): {description}` | `- interview-guide (md, required): A single guide covering the CEO, CFO, COO and CIO interviews` |
| `{{gate}}` | string | One line describing the gate chain: `none`, or `human review`, or a comma-separated chain (later iterations) | `human review` |
| `{{workDir}}` | string | Absolute path of the item's `work/` folder — the only place the agent writes | `C:\...\items\WI-002\work` |
| `{{engagementRoot}}` | string | Absolute path of the engagement root | `C:\...\engagements\acme-discovery-1` |
| `{{engagementContextPath}}` | string | Absolute path of the latest `ENG/context` version, or `(not yet published)` | `C:\...\items\ENG\assets\context\v1.0.md` |

### Reason-specific (only in the matching `run-*.md` file)

| Variable | File | Type | Content |
|---|---|---|---|
| `{{question}}` | `run-resume-answer.md` | string | The question the agent itself raised (`raise_question` input, verbatim) |
| `{{answer}}` | `run-resume-answer.md` | string | The answer text |
| `{{answerMode}}` | `run-resume-answer.md` | string | `approve` \| `amend` \| `replace` |
| `{{reviewComments}}` | `run-changes-requested.md` | string (block) | The reviewer's comments, verbatim |
| `{{reviewedVersions}}` | `run-changes-requested.md` | string (block) | One line per reviewed slot: `- {slot} v{version}` |
| `{{resumeNote}}` | `run-resume.md` | string | A free-text note about why the run is resuming (e.g. "The server restarted while you were working."), or `(none)` |

`run-resume-answer.md` and `run-changes-requested.md` deliberately do **not**
repeat `{{brief}}`, `{{inputs}}` etc.: these are resumes of the *same*
session, which already has that context, and J1.7 disables brief edits once
an item is `in_progress` or later, so the brief cannot have changed under
the agent. Keep these two prompts short.

## Rendering contract

- Unknown `{{variable}}` tokens are a template bug, not a runtime
  condition — W1 should throw rather than leave `{{...}}` in a live prompt.
- All paths are absolute, OS-native (`path.win32` on Windows), never
  engagement-relative — the agent has no way to resolve a relative path
  against the engagement root on its own.
- `{{brief}}`, `{{reviewComments}}` and similar Markdown blocks are inserted
  verbatim; they may themselves contain `{{`-looking text only if a human
  writes it into a brief, which W1 does not need to guard against in I1.
