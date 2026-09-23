# S9 — Document extraction and export

**Verdict:** PASS (all 15 checks pass with real evidence, including every step-3 agent-mediated check, after credits were added and one real bug in the run script was found and fixed) **Cost:** $0.067 across 5 API runs (1 blocked pre-credit + 4 real Haiku runs; well under the $0.75 cap) **Runs:** 5 API runs + many local Python/Node runs **SDK:** 0.3.280 **Model:** claude-haiku-4-5

## Hypothesis

The agents can read PPTX, XLSX, DOCX and PDF intake, and a skill script can export Markdown to PPTX and PDF, on Windows.

## Setup (what was built; how to re-run)

- `experiments/s09-documents/.venv/` — Python 3.14.0 venv with `markitdown` (0.1.8, with `[pptx,docx,xlsx,pdf]` extras), `python-pptx`, `openpyxl`, `python-docx`, `pypdf`, `reportlab`, `markdown`.
- `experiments/s09-documents/fixtures/make_fixtures.py` — generates `sample.{pptx,xlsx,docx,pdf}` into an output dir (default `fixtures/out/`), each containing a shared `CANARY-FACT-ERP` fact plus one format-specific fact in a place fidelity-testing extractors should miss if they're shallow: PPTX speaker notes (slide 2), XLSX second sheet's B2 cell, DOCX table cell, PDF body text.
- `experiments/s09-documents/scripts/extract.py` — the **chosen** extraction CLI: `python extract.py <path>` prints Markdown, via `markitdown`.
- `experiments/s09-documents/scripts/try_markitdown.py`, `try_direct_libs.py` — the two extraction candidates that were scored (see Results).
- `experiments/s09-documents/scripts/md_to_pptx.py` — chosen Markdown-to-PPTX export CLI (`python-pptx`).
- `experiments/s09-documents/scripts/md_to_pdf.py` — chosen Markdown-to-PDF export CLI (Markdown-to-HTML via the `markdown` package, then headless `msedge.exe --print-to-pdf`).
- `experiments/s09-documents/plugin/workbench-skills/` — a local plugin (modelled on `spike/fixtures/plugin/workbench-skills/`) with one skill, `document-extraction`, whose `scripts/extract.py` is a copy of the chosen extractor.
- `experiments/s09-documents/run-local.ts` — steps 1, 2, 4 (no API calls, $0).
- `experiments/s09-documents/run-agent.ts` — step 3 (one API call through `runQuery()`), self-contained (regenerates fixtures if missing).
- `experiments/s09-documents/run.ts` — runs both, in order.

Re-run with:
```sh
cd spike
npx tsx experiments/s09-documents/run-local.ts    # steps 1, 2, 4 -- no API, $0
npx tsx experiments/s09-documents/run-agent.ts     # step 3 -- one API call
npx tsx experiments/s09-documents/run.ts           # both, in order
```

## Results

| Check | Result | Evidence (file:line / command output) |
|---|---|---|
| Step 1 -- fixtures generated with known facts | PASS | `results/s09-documents/summary.json` -> `step1-fixtures-generated`: all four files created, non-zero size (sample.pptx=33927B, sample.xlsx=5437B, sample.docx=35553B, sample.pdf=1915B) |
| Step 2 -- markitdown installs on Python 3.14 | PASS | `pip install markitdown` and `pip install "markitdown[pptx,docx,xlsx,pdf]"` both completed with no errors in `experiments/s09-documents/.venv` (Python 3.14.0). This includes onnxruntime==1.30.0 with a cp314-win_amd64 wheel (a dependency of magika, markitdown's file-type sniffer) -- often a lagging-compatibility risk for a brand-new Python version, but a compatible wheel exists. `pip show markitdown` -> Version: 0.1.8. |
| Step 2 -- chosen extractor (markitdown) recovers every fact | PASS | `step2-chosen-extractor-recovers-all-facts`: all 8 facts (shared canary x 4 files + 1 distinct fact x 4 files) found in extract.py's stdout for every file, including the PPTX speaker notes, the XLSX second sheet, and the DOCX table cell. See "Exact working configuration" for a sample. |
| Step 2 -- direct-library baseline (python-pptx/openpyxl/python-docx/pypdf) recovers every fact | PASS | `step2-direct-libs-baseline-recovers-all-facts`: same 8/8 recovery. Scored purely as a comparison baseline -- not the chosen path (see Recommendation for why markitdown was chosen anyway). |
| Step 4 -- Markdown to PPTX export runs | PASS | `step4-pptx-export-runs`: md_to_pptx.py exit 0, export_test.pptx written, 29303B |
| Step 4 -- PPTX export validated by reading text back | PASS | `step4-pptx-export-readback-has-content`: python-pptx read-back finds both EXPORT-CANARY-1 and EXPORT-CANARY-2 across the two generated slides |
| Step 4 -- Markdown to PDF export runs | PASS | `step4-pdf-export-runs`: md_to_pdf.py exit 0, export_test.pdf written, 33416B, via msedge.exe --headless --print-to-pdf |
| Step 4 -- PDF export validated by page count + text | PASS | `step4-pdf-export-readback-pages-and-content`: pypdf reports 1 page, both EXPORT-CANARY-1/EXPORT-CANARY-2 present in extracted text |
| Step 4 -- page counting confirmed on a genuinely multi-page PDF | PASS | `step4-pdf-page-counting-confirmed-multipage`: the step-1 sample.pdf fixture (built with two explicit showPage() calls) reports exactly 2 pages via pypdf |
| Step 3 -- plugin + document-extraction skill loads, scoped per-query | PASS | `step3-plugin-skill-loads`: init.skills includes "workbench-skills:document-extraction" (plugin-qualified name) |
| Step 3 -- Bash restricted to an explicit base tool set | PASS | `step3-tools-restricted-to-explicit-base-set`: init.tools = ["Bash","Read","Skill"] exactly, with tools: ["Read","Skill","Bash"] passed as an explicit array (not the 'preset' form -- see S0's finding that only the array form narrows this build's much broader default tool surface) |
| Step 3 -- agent reports the known facts from each file | PASS (real run, after fixing a bug -- see below) | `step3-agent-reports-facts-from-all-files`: all 8 facts recovered across the 4 files via the document-extraction skill (Skill tool -> Bash -> extract.py), e.g. `sample.pptx: CANARY-FACT-ERP=true, CANARY-PPTX-NOTES=true \| sample.xlsx: ... \| sample.docx: ... \| sample.pdf: ...` (all true). `results/raw/s09-documents/extraction-agent-2026-09-23-1209-ca007c.jsonl` |
| Step 3 -- native PDF reading via the Read tool | PASS | `step3-native-pdf-read-via-Read-tool`: agent used `Read` directly on `sample.pdf` (no Bash, no skill) and reported both `CANARY-FACT-ERP` and `CANARY-PDF-BODY` correctly, labeled "native PDF read" as instructed |
| Step 3 -- Bash restricted to only the extraction script (incl. adversarial test) | PASS | `step3-bash-restricted-to-extract-script-only`: all 4 legitimate `extract.py` Bash calls succeeded (no denial); the adversarial command `python -c "print(1)"` was **denied** -- present in `r.denials` (`{"tool_name":"Bash","tool_use_id":"toolu_01H4Stk...","tool_input":{"command":"python -c \"print(1)\"",...}}`) and the model's own report confirms it: *"Permission to use Bash has been denied because Claude Code is running in don't ask mode."* |
| **Bonus** -- can `skills: ["workbench-skills:document-extraction"]` still invoke an unrelated CLI-bundled skill (`simplify`)? | **No — blocked** | `bonus-skill-scope-isolation-probe`: `init.skills` for this probe still *lists* `"simplify"` (same broader surface noted in Surprises), but invoking it via the `Skill` tool was refused with the exact message *"Skill simplify is not in this session's skills allowlist"*. One data point; see "Answer to the coordinator's question" below. |

## Exact working configuration (copy-pasteable snippets, rule syntax, option shapes)

**Chosen extraction path -- markitdown** (over calling python-pptx/openpyxl/python-docx/pypdf directly, even though both recovered 8/8 facts): one dependency, one code path, one CLI for all four formats, versus four format-specific libraries and four extraction functions to maintain. `extract.py`:
```python
from markitdown import MarkItDown
md = MarkItDown()
result = md.convert(path)
print(result.text_content)
```
Sample output for sample.pptx (speaker notes recovered):
```
<!-- Slide number: 1 -->
# S9 Sample Deck
CANARY-FACT-ERP: ERP vendor is Contoso ERP

<!-- Slide number: 2 -->
# Rollout
See notes for the go-live date.

### Notes:
CANARY-PPTX-NOTES: Go-live date is 2027-03-01
```

**Chosen PPTX export -- python-pptx**, driven by a small deliberate Markdown subset (`# `/`## ` -> new slide title, `- ` or plain line -> body paragraph). See `scripts/md_to_pptx.py`.

**Chosen PDF export -- headless Microsoft Edge, not pandoc or Playwright**:
```python
cmd = [
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    "--headless", "--disable-gpu", "--no-sandbox",
    f"--print-to-pdf={out_path_abs}",
    "--print-to-pdf-no-header", "--no-pdf-header-footer",
    "file:///" + html_path.replace("\\", "/"),
]
```
What was tried/checked first, per the plan's "simplest dependable option on Windows":
- pandoc: `where pandoc` found nothing -- not installed on this machine, and installing a new system tool isn't "simplest" when something already ships with Windows.
- Playwright/Chromium: explicitly discouraged by the task (fresh browser download).
- msedge.exe: found at `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe` (Windows 11 ships Edge by default) -- used the `markdown` pip package to render MD to HTML, then Edge's documented headless --print-to-pdf flag.

**Surprise: the PDF write is asynchronous relative to process exit.** The first version of md_to_pdf.py checked os.path.isfile(out_path) immediately after subprocess.run() returned with rc=0 and got a false negative -- the file did not exist yet, then appeared 1-2 seconds later (confirmed by re-listing the output directory). Fixed by polling for the file (up to 10s, 250ms interval) after the process exits, instead of trusting rc==0 alone. This is a real, reproducible Windows/Edge behavior worth carrying into the real pdf-export skill implementation, not a fluke -- it happened on the very first attempt and was then reproduced with a manual command-line call to msedge.exe as well.

**Bash-restriction rule syntax for the document-extraction skill -- confirmed working end-to-end, including a real adversarial denial:**
```ts
options: {
  settingSources: [],
  plugins: [{ type: "local", path: PLUGIN_DIR }],
  skills: ["document-extraction"],
  tools: ["Read", "Skill", "Bash"],          // explicit base-set array, not {type:'preset'}
  allowedTools: [
    "Skill",                                 // bare tool name -- see bug below
    `Bash(${venvPythonFwd} ${extractScriptFwd} *)`   // e.g. Bash(C:/.../python.exe C:/.../extract.py *)
  ],
  permissionMode: "dontAsk",                 // "deny if not pre-approved" per sdk.d.ts
}
```
Found by reading `node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs`'s bundled validation logic for permission rules (search "Bash("): the wildcard form `Bash(<prefix> *)` is the recommended syntax; a trailing `:*` (e.g. `Bash(npm run:*)`) also works but is flagged "legacy" prefix matching, with the SDK's own error message suggesting `*` instead: "Move :* to the end for prefix matching, or use * for wildcard matching". `allowedTools` entries are of the form `"Tool(specifier)"` (confirmed by the same file's schema-error tip: `Permission rules must be in an array. Format: ["Tool(specifier)"]`).

**Real bug found and fixed: `Skill` itself must be allow-listed under `permissionMode: "dontAsk"`.** The first real run (after credits were added) passed only the `bashRule` in `allowedTools`, assuming `tools: [...,"Skill",...]` (the *base tool set*) was enough to let the agent invoke the skill. It was not: `dontAsk` denies **any** tool call not pre-approved by an allow-rule, and that includes the `Skill` tool call itself, which is a separate permission check from being present in the base tool set. Result: the model's `Skill` call for `workbench-skills:document-extraction` was auto-denied, it fell back to raw `Bash` calls (`python -m markitdown ...`, correctly also denied since they don't match the `extract.py`-only rule), and only the unrestricted `Read` tool succeeded (native PDF facts only). Fixed by adding a bare `"Skill"` entry to `allowedTools`. After the fix, the same run recovered all 8 facts across all 4 files via the skill, exactly as intended. **This is an important, generalizable finding for ARCHITECTURE.md's `dontAsk`-mode skill designs: allow-listing a tool in the base `tools` array is necessary but not sufficient under `dontAsk` — each tool that should actually run (including `Skill` itself) needs its own `allowedTools` entry.**

**Adversarial Bash test — real denial confirmed.** With the fix above in place, the agent was explicitly instructed to also attempt `python -c "print(1)"` (a different, unapproved Bash command) as a deliberate test. It was **denied**: present in `result.permission_denials` (`{"tool_name":"Bash","tool_use_id":"...","tool_input":{"command":"python -c \"print(1)\"",...}}`), and the model's own final report confirms it verbatim: *"Permission to use Bash has been denied because Claude Code is running in don't ask mode."* Meanwhile all 4 legitimate `extract.py` Bash calls in the same run succeeded without any denial. This is the strongest possible confirmation available from this experiment that the `Bash(<script> *)` allow-rule genuinely restricts Bash to that one command line, not just in theory but observed denying a real, different command in the same session.

**Answer to the coordinator's question — can `skills: ["workbench-skills:document-extraction"]` still invoke an unrelated CLI-bundled skill?** No. A dedicated probe run (`skill-scope-probe`, tools: `["Skill"]` only, `skills: ["workbench-skills:document-extraction"]`) asked the agent to invoke a skill named `"simplify"` (one of the ~17 unrequested names that show up in `init.skills` regardless of the `skills` filter — see Surprises). The `Skill` tool call for `"simplify"` was refused with the exact message *"Skill simplify is not in this session's skills allowlist"*. So while `init.skills` (the system-prompt-visible listing) is broader than what was requested, **actual invocation is enforced by the `skills` allowlist** — the earlier open question from before credits were added is now resolved: the extra listed skills are not invocable, at least for this one probed skill. This is one data point from a small, cheap run; A1's S1 experiment is the authoritative, in-depth investigation of skill scoping.

**Windows-path gotcha for the Bash rule and the instructed command:** both the rule text and the command the agent is told to run use forward-slash absolute paths (`C:/Users/...`) with no quoting, deliberately. Backslash paths (`C:\Users\...`) are risky inside a Bash command line: unquoted, a backslash escapes the next character (corrupting the path); inside double quotes it's usually preserved, but getting this right reliably (and matching a permission rule's literal text) is simpler by just avoiding backslashes -- Windows Python accepts forward slashes natively, so there's no downside. Both experiment paths here happen to contain no spaces, so no quoting was needed either way.

**Structural confirmation (works despite the billing block):** init.skills from the actual blocked run was:
```json
["deep-research","workbench-skills:document-extraction","design","design-sync","dataviz","update-config","verify","debug","code-review","simplify","batch","fewer-permission-prompts","doctor","loop","claude-api","workflow-authoring","run","run-skill-generator"]
```
-- the plugin skill loaded correctly as "workbench-skills:document-extraction" (plugin-qualified name), and init.tools was exactly ["Bash","Read","Skill"] as requested. See Surprises for the other, unrelated entries in that list.

## Surprises and deviations from ARCHITECTURE.md

1. **markitdown installs and works cleanly on Python 3.14**, including its heaviest dependency (onnxruntime, via magika), contrary to the plan's stated risk ("Python 3.14 is too new for the document libraries"). No fallback to a Node toolchain was needed. This is worth re-confirming closer to implementation time, since Python 3.14 was released very recently and library compatibility windows shift.
2. **Direct format-specific libraries recover the same facts as markitdown, 8/8.** markitdown was still chosen as the implementation because it collapses "4 formats -> 4 libraries -> 4 extraction functions" into "4 formats -> 1 library -> 1 function", which matters more for a skill script that has to stay simple and auditable than a marginal fidelity difference that didn't materialize in this test. If a future fixture finds a fact markitdown misses that a direct library catches (e.g. embedded images with OCR-only text, complex nested tables, or PPTX SmartArt), that would flip this recommendation -- worth a follow-up fixture with harder cases before committing further.
3. **The PDF export write is asynchronous relative to msedge.exe's process exit** (see "Exact working configuration" above) -- a real, Windows-specific timing hazard, not a script bug. Any real implementation of the pdf-export skill must poll for the file rather than trust the process's exit code alone.
4. **init.skills is not confined to what plugins/skills requested, even with settingSources: [].** This reproduces S0's "Surprises" finding (init.tools/agents/plugins are broader than "vanilla" Claude Code by default) but for skills specifically: alongside the intended "workbench-skills:document-extraction", the session's init.skills also listed 17 unrelated built-in-looking skill names (deep-research, design, dataviz, code-review, etc.) that were never configured. **Resolved (after credits were added):** a dedicated probe confirmed that even though `"simplify"` (one of those 17) is *listed* in `init.skills`, actually invoking it via the `Skill` tool is refused with `"Skill simplify is not in this session's skills allowlist"`. So the `skills: [...]` filter does enforce real invocation restriction; it just doesn't also scrub the model's own visible listing. One skill probed, not all 17 -- treat as a strong single data point, not exhaustive coverage (A1's S1 covers this in depth).
5. **Both extraction candidates tested here recovered facts from "hidden" locations (PPTX speaker notes, a second XLSX sheet, a DOCX table cell) without any special-casing** -- no extractor needed to be told where to look; both walk the full document structure by default. This is a mild positive surprise; the plan's design anticipated this might need per-format handling.
6. **Under `permissionMode: "dontAsk"`, allow-listing a tool in the base `tools` array does not make it usable -- it also needs its own `allowedTools` entry, including for `Skill` itself.** The first real agent run (after credits were added) allow-listed only the `Bash(<script> *)` rule, assuming `tools: [...,"Skill",...]` was enough for the agent to invoke the `document-extraction` skill. It was not: the `Skill` tool call itself was auto-denied (`dontAsk` = "deny if not pre-approved," and nothing had pre-approved `Skill`), so the whole skill-mediated extraction path silently failed and the agent fell back to whatever *was* allowed (the unrestricted `Read` tool, for the PDF only). Fixed by adding a bare `"Skill"` entry to `allowedTools`. This is a real, reproducible gotcha (not a fluke -- it happened on the first attempt and is fully explained by `dontAsk`'s own documented semantics) that would silently break any real `dontAsk`-mode skill in ARCHITECTURE.md's design if not accounted for.

## Recommendation (what to change in ARCHITECTURE.md, if anything)

1. Section 8.7's document-extraction skill description ("Read PPTX, XLSX and DOCX; PDF is read natively") should be read together with this experiment's finding that markitdown is a viable single-script implementation for all three non-PDF formats -- no need for three separate bundled scripts/libraries in the real skill.
2. Section 8.7's pdf-export skill (and any future PPTX/PDF export code) should account for the asynchronous-write hazard documented above: poll for the output file rather than trusting the exporting subprocess's exit code.
3. Surprise #4 is now resolved for one probed skill: ARCHITECTURE.md's plan to scope skills per-query (8.7, "selected per session with skills") does enforce real invocation restriction, not just a preference -- `simplify` was listed in `init.skills` but refused on actual invocation. Still worth a broader sweep across more of the 17 unrequested names before treating this as fully general.
4. **New, from the real step-3 run:** ARCHITECTURE.md's `dontAsk`-mode skill designs (e.g. the `document-extraction`, `pptx-export`, `pdf-export` skills in 8.7, all meant to run under restricted Bash) must allow-list `Skill` itself in `allowedTools`, not just include it in the base `tools` array -- see Surprise #6. This should be called out explicitly wherever the real Work Agent runtime documents its `dontAsk` permission setup, since it's easy to get silently wrong (the agent just falls back to whatever else is allowed, with no obvious error).

## Fallback status (tested? works?)

- **Extraction fallback** (direct python-pptx/openpyxl/python-docx/pypdf instead of markitdown): tested and works -- 8/8 facts recovered (see try_direct_libs.py and the step2-direct-libs-baseline-recovers-all-facts check). Not needed as a fallback in practice since the primary choice (markitdown) worked, but confirmed as a working Plan B if markitdown ever regresses (e.g. on a future Python version).
- **Node-only toolchain fallback** (per the plan's "Python 3.14 is too new" risk): not tested -- not needed, since Python 3.14 compatibility was fine (Surprise #1).
- **PDF export fallback** (pandoc, or Playwright/Chromium): not tested -- pandoc isn't installed on this machine (checked, see "Exact working configuration"); Playwright was explicitly out of scope per the task instructions (avoid a fresh browser download). The primary choice (headless Edge) worked, so neither fallback was exercised.

## Harness change requests

None. run-local.ts and run-agent.ts use the shared harness (runQuery, check) as documented in spike/README.md; no changes to src/lib/ were needed.

## Open questions

All step-3 questions from the pre-credit version of this document are now resolved (see Results and "Exact working configuration" above): fact recovery through the skill works (8/8), native PDF reading via `Read` works, the `Bash(<script> *)` allow-rule was confirmed to deny a real adversarial command while allowing the legitimate ones, and the skill-scope isolation question has one confirmed data point (`simplify` listed but not invocable). Remaining open items:

1. The skill-scope isolation probe (Surprise #4 / bonus check) tested exactly one unrequested skill (`simplify`) out of the ~17 that appear in `init.skills`. A broader sweep (A1's S1 territory) would strengthen confidence that this generalizes rather than being specific to that one skill.
2. Whether `markitdown`'s fact recovery holds up on harder fixtures (embedded images, nested tables, PPTX SmartArt) is unknown -- this experiment's fixtures were deliberately simple (one fact per hard-to-reach location), matching the plan's stated fixture design, but a production skill will see messier real documents.
3. The `Skill`-must-be-separately-allow-listed gotcha (Surprise #6) was found and fixed here for one skill in one session; it's worth confirming this generalizes to every `dontAsk`-mode skill design in ARCHITECTURE.md §8.7 (`pptx-export`, `pdf-export`, `workbench-protocol`, etc.) rather than assuming it does.
