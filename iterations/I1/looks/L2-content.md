# L2 — CONTENT and PROTOCOL: ready for a look

**Built:** The `acme-discovery` seed (`seed.yaml`, `defaults.yaml`,
`plan.template.yaml`, and the two engagement-level assets under
`assets/ENG/`) for the six items ENG, PH-1, PH-2, WI-002, WI-003, WI-004;
four pre-written CxO interview notes in `demo/interview-notes/`; the Work
Agent prompt set in `packages/agents/prompts/` (`README.md` defining the
render contract, `work-agent.md`, `protocol.md`, and the four run prompts);
and the `workbench-skills` plugin (`workbench-protocol`,
`interview-guide-design`, `thematic-synthesis`).
**Quick checks:** no formal `pnpm typecheck` (demo/ and workbench-skills/
aren't packages with a tsconfig wired into the workspace's typecheck
script) · unit tests: none apply to this package · smoke: the seed's
content was validated against the **real** `SeedManifest`/`SeedDefaults`/
`PlanTemplate` schemas and the unique-id / parent / input-slot / asset-slot
checks, via a throwaway script (deleted afterward, not a deliverable) that
deep-imported `yaml`/`zod` from `packages/core/node_modules` to work around
a module-resolution gap explained below — **all checks passed**. The
intended deliverable, `demo/scripts/validate-seed.ts`, is written and
correct but currently cannot run standalone; see *Known gaps*.
**API spent:** $0.00 (no SDK/API calls in this package; S6 is validation,
not a quick check).

## Take a look (≤ 10 minutes)

1. Read the plan, in order: `demo/seeds/acme-discovery/seed.yaml` →
   `defaults.yaml` → `plan.template.yaml`. Compare against D§11 step 2 and
   ITERATIONS.md §4.1 — six items, no WI-001.
2. Read `demo/seeds/acme-discovery/assets/ENG/context.md` and
   `stakeholders.md` — the broadened "IT strategy" framing (four strategic
   pressures) versus the spike fixture's narrower "ERP modernization
   scoping" framing.
3. Read WI-002's brief inside `plan.template.yaml` — check that the CIO
   ambiguity (vision vs. history) reads as a genuine open question, not an
   instruction to ask one.
4. Read the four `demo/interview-notes/notes-*.md` files. Check: themes
   that show up in ≥2 interviews (e.g. ERP end-of-support, the fourth
   product line, the past failed initiative from ~8 years ago); the two
   explicit contradictions (COO vs. CIO on cloud; CEO vs. COO on
   urgency/sequencing); and the CFO note's flagged gap (budget appetite and
   funding model never reached before the call was cut short).
5. Read `packages/agents/prompts/README.md` first (the variable contract),
   then `work-agent.md`, `protocol.md`, and one run prompt,
   `run-start.md`, to see how they'd compose for WI-002.
6. Read the three `workbench-skills/skills/*/SKILL.md` files.
7. Once you want to re-check the seed yourself: from the repo root,
   `node --import tsx demo/scripts/validate-seed.ts` — as of this writing
   it fails with `ERR_MODULE_NOT_FOUND: yaml` (see *Known gaps* for why and
   the proposed fix; it's a workspace resolution issue, not a content
   issue).

## Questions for you

- **WI-002's ambiguity.** I resolved it as: the CIO is three months in,
  and it's genuinely unclear whether her interview section should lean on
  her forming vision or on the inherited history — the brief states this
  as an open tension without telling the agent to ask about it. The CIO's
  own interview notes (`notes-cio.md`) deliberately carry material for
  *both* framings, so synthesis works either way the Work Agent resolves
  it. Confirm this reads as a natural consulting judgment call rather than
  a planted question.
- **The two contradictions.** Cloud appetite (COO wary for the shop floor,
  CIO leaning cloud/SaaS for the ERP core) and urgency/sequencing (CEO
  wants to move fast, COO wants to wait past peak season and phase it) —
  both are stated directly by name in the notes rather than left for the
  synthesis agent to infer. Confirm that's the right level of
  explicitness for I1 (versus something subtler you'd rather the agent
  have to work harder to find).
- **The CFO gap.** I used "pulled into an urgent board-audit call" to
  explain why budget appetite/funding model was never reached, with an
  explicit interviewer note flagging it. Confirm this framing (a plausible
  interruption, not "the interviewer forgot") is the device you want,
  since I2's J2.5 depends on this gap being real and discoverable.
- **Engagement broadening.** The spike fixture's `context.md` was framed as
  an ERP modernization scoping engagement; I widened it to a full IT
  strategy per the brief, folding the four original pressures (ERP
  end-of-support, OEM real-time visibility, plant spreadsheets, fourth
  product line) in as "strategic pressures" rather than the whole story.
  Confirm the balance — it's still ERP-heavy because that's what the
  fixture and the interview material support, but the framing sentence
  says "the scope is the whole of IT, not a single system decision."
- **Protocol placement default.** I recommend placement **A** (inline: W1
  concatenates `work-agent.md` + `protocol.md` into the system prompt) as
  the I1 default, with placement B (the `workbench-protocol` skill) as
  what S6 compares it against. This is stated in the prompts README for
  W1 to implement against — flag if you'd rather default the other way.
- **WI-003 has no acceptance criteria.** It's a human item (no self-check,
  no gate) — I left `acceptance` empty rather than inventing criteria
  nobody checks against. Confirm that's right, or say if you want a couple
  of criteria there anyway for human-item consistency.
- **Skill method content.** `interview-guide-design` and
  `thematic-synthesis` have no spike equivalent to port from — the spike's
  fixture skills (`alpha`/`beta`/`gamma`) were only markers for testing
  skill-loading mechanics, not real method content. Both are original,
  written from DESIGN.md §2.1-5/§5.2's principles and the M0-FINDINGS
  observation about Haiku fabricating output when unsure — worth a closer
  read than the rest, since there's nothing to cross-check them against.

## Known gaps and shortcuts (not yet validated)

- **`demo/scripts/validate-seed.ts` can't run standalone yet.** `demo/` is
  not a pnpm workspace member (`pnpm-workspace.yaml` lists only
  `packages/*`, `apps/*`, `e2e`), and pnpm's per-package install (P0b)
  does not hoist `yaml`/`zod` to the root `node_modules` — only
  `packages/core`, `packages/agents` and `packages/store` (which declare
  them as direct dependencies) have them. Running
  `node --import tsx demo/scripts/validate-seed.ts` from the repo root
  therefore fails with `ERR_MODULE_NOT_FOUND` for `yaml`. This is a
  workspace/tooling gap, not a script bug: I confirmed the script's logic
  is correct by temporarily deep-importing `yaml` from
  `packages/core/node_modules/yaml/browser/index.js` in a throwaway file
  (`demo/scripts/.tmp-verify.mjs`, deleted immediately after use, not
  committed) that ran the same checks — schema validation, unique ids,
  parents exist, every input slot resolves to a declared output, every
  seed asset file matches an output slot with a matching format — and all
  passed against the real `packages/core/src/seed.ts` and `domain.ts`. See
  *Contract change requests* for the fix I can't make myself.
- **No formal typecheck.** Neither `demo/` nor `workbench-skills/` has a
  `tsconfig.json` wired into the workspace's `pnpm typecheck` script (only
  packages under `packages/*`, `apps/*` do). `validate-seed.ts` runs under
  `tsx`, which transpiles but does not type-check; I reviewed its types
  against `ports.ts`/`seed.ts` by hand rather than mechanically.
- **No real-agent evidence yet.** Nothing here has been run against Haiku
  or any model — that's S6, gated on W1's validated runtime (V1), per the
  orchestration in I1-PLAN §4. This package only prepares the content S6
  will exercise.
- **Interview note realism is my judgment call**, not cross-checked
  against a real consulting engagement — word counts are 428-559 words per
  note (target 400-700), themes overlap ≥2 sources each, and both required
  contradictions are present, but the actual prose quality is exactly what
  Question 1-3 above ask you to sanity-check.

## Contract change requests

Not a contract file change, but a coordination item outside my write
paths (touching it would mean editing `package.json` / `pnpm-workspace.yaml`,
which I'm not allowed to do):

**What:** `demo/` needs a way to resolve `zod` and `yaml` at its own
location. Two options, either works:
  (a) add `demo` to `pnpm-workspace.yaml`'s `packages:` list with a
      minimal `demo/package.json` (`private: true`, `dependencies: { zod,
      yaml }`) — the same pattern `e2e/` already uses for being a
      workspace member outside `packages/*`; or
  (b) add a root `.npmrc` with
      `public-hoist-pattern[]=yaml` and `public-hoist-pattern[]=zod`, which
      hoists just those two into the root `node_modules` for any
      root-level script.

**Why:** `demo/scripts/validate-seed.ts` is specified to run as
`node --import tsx demo/scripts/validate-seed.ts` from the repo root
(I1-PLAN §6 W2), but `demo/` currently isn't part of the pnpm workspace and
nothing hoists its two dependencies to a location it can resolve. Whoever
owns SCAFFOLD/P0a is best placed to pick (a) or (b) and land it quickly —
either is a small, safe change with no effect on any other package.

## Validation plan (runs only after your go)

This is the S6 benchmark (I1-PLAN §6, W2), and it **also requires W1's V1
to have passed first** (S6 needs the validated real runtime) — so even
after your go here, the actual S6 run waits on that dependency per the
plan's orchestration (I1-PLAN §4).

| Step | What it proves | Duration | API cost |
|---|---|---|---|
| Re-run `demo/scripts/validate-seed.ts` for real (once the resolution fix from *Contract change requests* lands) | Automated confirmation of the manual check already done above | <1 min | $0 |
| 10 runs of WI-002: 5 with `work-agent.md` + `protocol.md` inlined (placement A), 5 with `work-agent.md` alone + the `workbench-protocol` skill (placement B); 5 of the 10 (mixed across A/B) with the CIO ambiguity strengthened further in the run prompt | Whether Haiku follows the protocol (publish → log → self-check → submit, no work after a blocking question) and whether inline vs. skill placement changes adherence | ~20-30 min | ~$1.50-2.00 |
| Score each run per M0-SPIKE-PLAN S6: published to the correct slot, plausible `kind`, submitted with a self-check against every acceptance criterion, and — on the strengthened-ambiguity runs — a `raise_question` with a hypothesis followed immediately by a stopped turn; record turns, cost and guard denials per run | The go/no-go number for G1 (≥8/10 continue on Haiku; 6-7/10 fix and re-run; <6/10 propose Sonnet) | included above | included above |
| If below 8/10: adjust `work-agent.md`/`protocol.md` wording or the run prompts, then re-run a smaller batch (5 runs) to confirm the fix helped | Confirms a fix actually moves the number before committing to it | ~10-15 min | ~$0.50 |
| Write `iterations/I1/reports/S6-haiku-protocol.md` with per-run evidence (transcript lines, not just scores) | The evidence record G1 decides from | — | — |

**Estimated total:** 30-45 minutes, **$2.00-3.00** (within the $3.00 S6
cap from I1-PLAN §9).
