---
name: document-extraction
description: This skill should be used when the user asks to extract, read or summarize the content of a PPTX, XLSX, DOCX or PDF file, or mentions "document extraction". It runs a bundled Python script (markitdown) that converts any of those four formats to Markdown, and reports any facts found in the output.
allowed-tools: Bash, Read
---

# Document extraction

This skill converts PPTX, XLSX, DOCX and PDF files to Markdown so their
content (including things that are easy to miss, like PowerPoint speaker
notes, a second spreadsheet sheet, or a table cell) can be read and
reported on.

## How to run it

This skill has one bundled script, `scripts/extract.py`, next to this
SKILL.md file. It takes exactly one argument (the path to the file to
convert) and prints Markdown to stdout.

Run it with the project's own Python (it has `markitdown` installed in a
venv — the system/default `python` on PATH does NOT have it installed, so
you must use this exact interpreter path):

```
C:/Users/michi/dev/ai-project/spike/experiments/s09-documents/.venv/Scripts/python.exe C:/Users/michi/dev/ai-project/spike/experiments/s09-documents/plugin/workbench-skills/skills/document-extraction/scripts/extract.py <path-to-file>
```

Use the `Bash` tool to run exactly that command line, substituting
`<path-to-file>` with the file you were asked to extract (use forward
slashes in that path too). Do not run any other Bash command — only this
one script, once per file.

## What to report

For each file you are asked about:

1. Run the script on it as shown above.
2. Read the Markdown it prints.
3. Report every fact you find that looks like it starts with `CANARY-`
   (these are the known facts this spike is checking for), quoting each
   one verbatim.

## Native PDF reading

If you are asked to read a PDF file directly (not through this script),
use the `Read` tool on the PDF path instead of Bash — Claude Code can read
PDF files natively. Report the same kind of `CANARY-` facts from what the
`Read` tool returns.
