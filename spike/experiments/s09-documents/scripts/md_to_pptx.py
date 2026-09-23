"""S9 chosen export CLI: Markdown -> PPTX, using python-pptx.

Markdown convention (a small, deliberate subset — not a full CommonMark
renderer): a line starting with "# " starts a new slide with that text as
the title; a line starting with "## " starts a new slide with that text as
the title (same level, kept simple for a slide deck); a line starting with
"- " becomes a bullet on the current slide's body placeholder; any other
non-blank line becomes a plain paragraph on the current slide's body.
The first slide is created lazily on the first heading.

Usage: python md_to_pptx.py <input.md> <output.pptx>
"""
import sys

from pptx import Presentation


def md_to_pptx(md_text: str, out_path: str) -> None:
    prs = Presentation()
    slide = None
    body_tf = None

    def new_slide(title: str):
        nonlocal slide, body_tf
        slide = prs.slides.add_slide(prs.slide_layouts[1])
        slide.shapes.title.text = title
        body_tf = slide.placeholders[1].text_frame
        body_tf.clear()

    first_para_used = False

    for raw_line in md_text.splitlines():
        line = raw_line.rstrip()
        if not line.strip():
            continue
        if line.startswith("# ") or line.startswith("## "):
            title = line.lstrip("#").strip()
            new_slide(title)
            first_para_used = False
            continue
        if slide is None:
            new_slide("")
            first_para_used = False

        text = line[2:].strip() if line.startswith("- ") else line.strip()
        if not first_para_used and len(body_tf.paragraphs) == 1 and not body_tf.paragraphs[0].text:
            body_tf.paragraphs[0].text = text
            first_para_used = True
        else:
            p = body_tf.add_paragraph()
            p.text = text

    prs.save(out_path)


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: python md_to_pptx.py <input.md> <output.pptx>", file=sys.stderr)
        return 2
    in_path, out_path = sys.argv[1], sys.argv[2]
    with open(in_path, "r", encoding="utf-8") as f:
        md_text = f.read()
    md_to_pptx(md_text, out_path)
    print(f"wrote {out_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
