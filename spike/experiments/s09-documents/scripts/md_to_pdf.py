"""S9 chosen export CLI: Markdown -> PDF, via the `markdown` package (MD ->
HTML) and headless Microsoft Edge's --print-to-pdf (HTML -> PDF).

Why this over alternatives (see FINDINGS.md "Setup" for what was tried):
- pandoc: not installed on this machine (`where pandoc` found nothing), and
  the plan says "the simplest dependable option *on Windows*" — installing
  a new system tool is not simpler than using what's already there.
- Playwright/Chromium: would need a fresh browser download (explicitly
  discouraged by the task).
- msedge.exe ships with Windows 11 and was found at a fixed path
  (`C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe`);
  headless --print-to-pdf is a documented, dependable Chromium flag.

Usage: python md_to_pdf.py <input.md> <output.pdf>
"""
import os
import shutil
import subprocess
import sys
import tempfile
import time

import markdown

EDGE_CANDIDATES = [
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
]

HTML_TEMPLATE = """<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  body {{ font-family: Calibri, Arial, sans-serif; font-size: 12pt; margin: 2cm; }}
  h1 {{ font-size: 20pt; }}
  h2 {{ font-size: 16pt; }}
  table {{ border-collapse: collapse; }}
  td, th {{ border: 1px solid #888; padding: 4px 8px; }}
</style>
</head>
<body>
{body}
</body>
</html>
"""


def find_edge() -> str:
    for candidate in EDGE_CANDIDATES:
        if os.path.isfile(candidate):
            return candidate
    found = shutil.which("msedge")
    if found:
        return found
    raise FileNotFoundError(
        "msedge.exe not found at known paths or on PATH; cannot export PDF this way"
    )


def md_to_pdf(md_text: str, out_path: str) -> None:
    html_body = markdown.markdown(md_text, extensions=["tables"])
    html = HTML_TEMPLATE.format(body=html_body)

    edge = find_edge()
    out_path_abs = os.path.abspath(out_path)

    with tempfile.TemporaryDirectory() as tmp:
        html_path = os.path.join(tmp, "doc.html")
        with open(html_path, "w", encoding="utf-8") as f:
            f.write(html)

        cmd = [
            edge,
            "--headless",
            "--disable-gpu",
            "--no-sandbox",
            f"--print-to-pdf={out_path_abs}",
            "--print-to-pdf-no-header",
            "--no-pdf-header-footer",
            "file:///" + html_path.replace("\\", "/"),
        ]
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=60)

        # Observed on this machine: msedge --headless --print-to-pdf can
        # return (rc=0) slightly before the PDF is flushed to disk (the
        # renderer process finishes the write asynchronously). Poll briefly
        # rather than trusting the process exit alone.
        deadline = time.time() + 10
        while time.time() < deadline:
            if os.path.isfile(out_path_abs) and os.path.getsize(out_path_abs) > 0:
                break
            time.sleep(0.25)

        if proc.returncode != 0 or not os.path.isfile(out_path_abs) or os.path.getsize(out_path_abs) == 0:
            raise RuntimeError(
                f"msedge --print-to-pdf failed (rc={proc.returncode}): "
                f"stdout={proc.stdout!r} stderr={proc.stderr!r}"
            )


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: python md_to_pdf.py <input.md> <output.pdf>", file=sys.stderr)
        return 2
    in_path, out_path = sys.argv[1], sys.argv[2]
    with open(in_path, "r", encoding="utf-8") as f:
        md_text = f.read()
    md_to_pdf(md_text, out_path)
    print(f"wrote {out_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
