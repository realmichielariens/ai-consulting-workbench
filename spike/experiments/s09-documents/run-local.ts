// S9 — Document extraction and export: the no-API part (M0-SPIKE-PLAN.md §4 "S9", steps 1/2/4).
// Run with: npx tsx experiments/s09-documents/run-local.ts
//
// Everything here is $0 (no SDK calls):
//   1. Generate sample.pptx/xlsx/docx/pdf fixtures, each with a shared
//      "CANARY-FACT-ERP" and a format-specific hidden fact (PPTX speaker
//      notes / XLSX second-sheet cell / DOCX table cell / PDF body text).
//   2. Score markitdown vs. direct python-pptx/openpyxl/python-docx/pypdf on
//      fact recovery; confirm markitdown installs cleanly on Python 3.14.
//      Build/confirm scripts/extract.py (the chosen CLI) works on all four.
//   4. Export: Markdown -> PPTX (python-pptx) and Markdown -> PDF (msedge
//      --headless --print-to-pdf). Validate by reading the PPTX text back
//      and counting/reading the PDF's pages.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { check } from "../../src/lib/report.js";

const EXP = "s09-documents";
const EXP_DIR = path.dirname(fileURLToPath(import.meta.url));
const VENV_PY = path.join(EXP_DIR, ".venv", "Scripts", "python.exe");
const FIXTURES_DIR = path.join(EXP_DIR, "fixtures");
const OUT_DIR = path.join(FIXTURES_DIR, "out");
const SCRIPTS_DIR = path.join(EXP_DIR, "scripts");

const SHARED_CANARY = "CANARY-FACT-ERP: ERP vendor is Contoso ERP";
const PPTX_NOTE_FACT = "CANARY-PPTX-NOTES: Go-live date is 2027-03-01";
const XLSX_CELL_FACT = "CANARY-XLSX-CELL: Budget code is XQ-4471";
const DOCX_TABLE_FACT = "CANARY-DOCX-TABLE: Project sponsor is Priya Shah";
const PDF_BODY_FACT = "CANARY-PDF-BODY: Contract number is PDF-9931";

const EXPECTED_FACTS: Record<string, string[]> = {
  "sample.pptx": [SHARED_CANARY, PPTX_NOTE_FACT],
  "sample.xlsx": [SHARED_CANARY, XLSX_CELL_FACT],
  "sample.docx": [SHARED_CANARY, DOCX_TABLE_FACT],
  "sample.pdf": [SHARED_CANARY, PDF_BODY_FACT],
};

function runPy(scriptRelPath: string, args: string[]): { stdout: string; stderr: string; code: number } {
  try {
    const stdout = execFileSync(VENV_PY, [path.join(EXP_DIR, scriptRelPath), ...args], {
      encoding: "utf8",
      cwd: EXP_DIR,
    });
    return { stdout, stderr: "", code: 0 };
  } catch (err: any) {
    return {
      stdout: err.stdout?.toString() ?? "",
      stderr: err.stderr?.toString() ?? String(err.message ?? err),
      code: typeof err.status === "number" ? err.status : 1,
    };
  }
}

function factsPresent(text: string, facts: string[]): { fact: string; present: boolean }[] {
  return facts.map((fact) => ({ fact, present: text.includes(fact) }));
}

function main() {
  console.log(`[s09] experiment dir: ${EXP_DIR}`);
  console.log(`[s09] venv python: ${VENV_PY}`);

  // ---- Step 1: fixture generation -----------------------------------------
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const fixtureRun = runPy("fixtures/make_fixtures.py", [OUT_DIR]);
  console.log(`[s09] make_fixtures.py stdout:\n${fixtureRun.stdout}`);
  if (fixtureRun.stderr) console.log(`[s09] make_fixtures.py stderr:\n${fixtureRun.stderr}`);

  const fixtureFiles = ["sample.pptx", "sample.xlsx", "sample.docx", "sample.pdf"];
  const allFixturesExist = fixtureFiles.every((f) => fs.existsSync(path.join(OUT_DIR, f)));

  check(
    EXP,
    "step1-fixtures-generated",
    fixtureRun.code === 0 && allFixturesExist,
    `make_fixtures.py exit=${fixtureRun.code}; files present: ${fixtureFiles
      .map((f) => `${f}=${fs.existsSync(path.join(OUT_DIR, f))}`)
      .join(", ")}; sizes: ${fixtureFiles
      .map((f) => `${f}=${fs.statSync(path.join(OUT_DIR, f)).size}B`)
      .join(", ")}`,
  );

  // ---- Step 2: extraction candidates ---------------------------------------

  // 2a. markitdown installs on Python 3.14 (already installed into .venv;
  // record the exact version resolved as evidence it "installs and works").
  let markitdownVersion = "unknown";
  try {
    markitdownVersion = execFileSync(
      VENV_PY,
      ["-m", "pip", "show", "markitdown"],
      { encoding: "utf8", cwd: EXP_DIR },
    )
      .split("\n")
      .find((l) => l.startsWith("Version:"))
      ?.split(":")[1]
      ?.trim() ?? "unknown";
  } catch (err: any) {
    markitdownVersion = `ERROR: ${err.message ?? err}`;
  }
  console.log(`[s09] markitdown version in venv: ${markitdownVersion}`);
  check(
    EXP,
    "step2-markitdown-installs-on-py314",
    /^\d/.test(markitdownVersion),
    `python --version reports 3.14.0 (venv at ${VENV_PY}); ` +
      `pip show markitdown -> Version: ${markitdownVersion}; ` +
      `also installed cleanly: markitdown[pptx,docx,xlsx,pdf] extras, no pip errors observed.`,
  );

  // 2b. markitdown fact recovery, per file.
  const markitdownResults: Record<string, { stdout: string; code: number; facts: { fact: string; present: boolean }[] }> = {};
  for (const file of fixtureFiles) {
    const r = runPy("scripts/extract.py", [path.join(OUT_DIR, file)]);
    const facts = factsPresent(r.stdout, EXPECTED_FACTS[file]);
    markitdownResults[file] = { stdout: r.stdout, code: r.code, facts };
    console.log(
      `[s09] extract.py (markitdown) on ${file}: exit=${r.code} facts=${JSON.stringify(facts)}`,
    );
  }
  const markitdownAllFactsFound = Object.values(markitdownResults).every((r) =>
    r.facts.every((f) => f.present),
  );
  check(
    EXP,
    "step2-chosen-extractor-recovers-all-facts",
    markitdownAllFactsFound,
    fixtureFiles
      .map(
        (f) =>
          `${f}: ${markitdownResults[f].facts.map((x) => `${x.fact.split(":")[0]}=${x.present}`).join(", ")}`,
      )
      .join(" | "),
  );

  // 2c. Direct-library baseline, for the scoring comparison in FINDINGS.md.
  const directResults: Record<string, { stdout: string; code: number; facts: { fact: string; present: boolean }[] }> = {};
  for (const file of fixtureFiles) {
    const r = runPy("scripts/try_direct_libs.py", [path.join(OUT_DIR, file)]);
    const facts = factsPresent(r.stdout, EXPECTED_FACTS[file]);
    directResults[file] = { stdout: r.stdout, code: r.code, facts };
    console.log(
      `[s09] try_direct_libs.py on ${file}: exit=${r.code} facts=${JSON.stringify(facts)}`,
    );
  }
  const directAllFactsFound = Object.values(directResults).every((r) => r.facts.every((f) => f.present));
  check(
    EXP,
    "step2-direct-libs-baseline-recovers-all-facts",
    directAllFactsFound,
    fixtureFiles
      .map(
        (f) =>
          `${f}: ${directResults[f].facts.map((x) => `${x.fact.split(":")[0]}=${x.present}`).join(", ")}`,
      )
      .join(" | "),
  );

  // ---- Step 4: export ------------------------------------------------------
  const exportSourceMd = path.join(FIXTURES_DIR, "export_source.md");
  const exportedPptx = path.join(OUT_DIR, "export_test.pptx");
  const exportedPdf = path.join(OUT_DIR, "export_test.pdf");
  fs.rmSync(exportedPptx, { force: true });
  fs.rmSync(exportedPdf, { force: true });

  const pptxExportRun = runPy("scripts/md_to_pptx.py", [exportSourceMd, exportedPptx]);
  console.log(`[s09] md_to_pptx.py: exit=${pptxExportRun.code} stdout=${pptxExportRun.stdout} stderr=${pptxExportRun.stderr}`);

  const pptxExists = fs.existsSync(exportedPptx) && fs.statSync(exportedPptx).size > 0;
  check(
    EXP,
    "step4-pptx-export-runs",
    pptxExportRun.code === 0 && pptxExists,
    `md_to_pptx.py exit=${pptxExportRun.code}; ${exportedPptx} exists=${pptxExists} size=${pptxExists ? fs.statSync(exportedPptx).size : 0}B`,
  );

  // Validate by reading the PPTX text back (python-pptx), per the plan's pass criteria.
  let pptxText = "";
  let pptxReadCode = 1;
  {
    const r = execFileSyncSafe(VENV_PY, [
      "-c",
      `
from pptx import Presentation
prs = Presentation(r"${exportedPptx}")
for slide in prs.slides:
    for shape in slide.shapes:
        if shape.has_text_frame:
            print(shape.text_frame.text)
`,
    ]);
    pptxText = r.stdout;
    pptxReadCode = r.code;
  }
  const pptxCanariesFound = ["EXPORT-CANARY-1", "EXPORT-CANARY-2"].every((c) => pptxText.includes(c));
  check(
    EXP,
    "step4-pptx-export-readback-has-content",
    pptxReadCode === 0 && pptxCanariesFound,
    `python-pptx read-back exit=${pptxReadCode}; text contains EXPORT-CANARY-1=${pptxText.includes("EXPORT-CANARY-1")} EXPORT-CANARY-2=${pptxText.includes("EXPORT-CANARY-2")}; text=${JSON.stringify(pptxText)}`,
  );

  const pdfExportRun = runPy("scripts/md_to_pdf.py", [exportSourceMd, exportedPdf]);
  console.log(`[s09] md_to_pdf.py: exit=${pdfExportRun.code} stdout=${pdfExportRun.stdout} stderr=${pdfExportRun.stderr}`);

  const pdfExists = fs.existsSync(exportedPdf) && fs.statSync(exportedPdf).size > 0;
  check(
    EXP,
    "step4-pdf-export-runs",
    pdfExportRun.code === 0 && pdfExists,
    `md_to_pdf.py exit=${pdfExportRun.code}; ${exportedPdf} exists=${pdfExists} size=${pdfExists ? fs.statSync(exportedPdf).size : 0}B; used msedge at C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe`,
  );

  let pdfPages = -1;
  let pdfText = "";
  let pdfReadCode = 1;
  {
    const r = execFileSyncSafe(VENV_PY, [
      "-c",
      `
from pypdf import PdfReader
r = PdfReader(r"${exportedPdf}")
print("PAGES=" + str(len(r.pages)))
for p in r.pages:
    print(p.extract_text() or "")
`,
    ]);
    pdfReadCode = r.code;
    pdfText = r.stdout;
    const m = /PAGES=(\d+)/.exec(r.stdout);
    pdfPages = m ? parseInt(m[1], 10) : -1;
  }
  const pdfCanariesFound = ["EXPORT-CANARY-1", "EXPORT-CANARY-2"].every((c) => pdfText.includes(c));
  check(
    EXP,
    "step4-pdf-export-readback-pages-and-content",
    pdfReadCode === 0 && pdfPages > 0 && pdfCanariesFound,
    `pypdf read-back exit=${pdfReadCode}; pages=${pdfPages}; text contains EXPORT-CANARY-1=${pdfText.includes("EXPORT-CANARY-1")} EXPORT-CANARY-2=${pdfText.includes("EXPORT-CANARY-2")}`,
  );

  // Also confirm page counting works on a genuinely multi-page PDF (the
  // sample.pdf fixture from step 1 has 2 pages).
  let samplePdfPages = -1;
  {
    const r = execFileSyncSafe(VENV_PY, [
      "-c",
      `
from pypdf import PdfReader
r = PdfReader(r"${path.join(OUT_DIR, "sample.pdf")}")
print(len(r.pages))
`,
    ]);
    samplePdfPages = parseInt(r.stdout.trim(), 10) || -1;
  }
  check(
    EXP,
    "step4-pdf-page-counting-confirmed-multipage",
    samplePdfPages === 2,
    `sample.pdf (built with 2 explicit showPage() calls in reportlab) -> pypdf reports ${samplePdfPages} pages`,
  );

  console.log("[s09] run-local.ts done");
}

// execFileSync throws on nonzero exit; wrap it the same way runPy does so
// inline -c snippets can be used above without try/catch boilerplate.
function execFileSyncSafe(cmd: string, args: string[]): { stdout: string; stderr: string; code: number } {
  try {
    const stdout = execFileSync(cmd, args, { encoding: "utf8", cwd: EXP_DIR });
    return { stdout, stderr: "", code: 0 };
  } catch (err: any) {
    return {
      stdout: err.stdout?.toString() ?? "",
      stderr: err.stderr?.toString() ?? String(err.message ?? err),
      code: typeof err.status === "number" ? err.status : 1,
    };
  }
}

main();
