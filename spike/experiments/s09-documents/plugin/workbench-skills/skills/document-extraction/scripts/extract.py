"""S9 chosen extraction CLI: prints Markdown for a PPTX/XLSX/DOCX/PDF path.

Usage: python extract.py <path-to-file>

Chosen implementation: markitdown (MarkItDown().convert(path).text_content).
It installed cleanly on Python 3.14 (venv here) and recovered every known
fact in the S9 fixtures (shared canary + a format-specific hidden fact per
file: PPTX speaker notes, XLSX second-sheet cell, DOCX table cell, PDF body
text) at least as well as calling python-pptx/openpyxl/python-docx/pypdf
directly, while being one dependency and one code path for all four
formats. See FINDINGS.md for the side-by-side fact-recovery table.

Exits non-zero with a message on stderr if the file can't be read or
converted, so a Bash-restricted skill run gets a clear failure signal.
"""
import sys


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: python extract.py <path-to-file>", file=sys.stderr)
        return 2

    path = sys.argv[1]
    try:
        from markitdown import MarkItDown
    except ImportError as e:
        print(f"ERROR: markitdown not installed: {e}", file=sys.stderr)
        return 3

    try:
        md = MarkItDown()
        result = md.convert(path)
    except Exception as e:
        print(f"ERROR: could not convert {path}: {type(e).__name__}: {e}", file=sys.stderr)
        return 1

    print(result.text_content)
    return 0


if __name__ == "__main__":
    sys.exit(main())
