"""S9 fixture generator: sample.pptx, sample.xlsx, sample.docx, sample.pdf,
each containing a shared CANARY-FACT plus one fact hidden in a
format-specific "hard to reach" location (speaker notes / second sheet /
table cell), to test extraction fidelity. Run from anywhere; writes into
the directory given as argv[1] (or ./out next to this script).

Facts are intentionally distinct per file so a FINDINGS table can show,
per (file, fact), whether the chosen extractor recovered it.
"""
import os
import sys

from pptx import Presentation
from pptx.util import Inches
import openpyxl
from docx import Document
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import letter

SHARED_CANARY = "CANARY-FACT-ERP: ERP vendor is Contoso ERP"
PPTX_NOTE_FACT = "CANARY-PPTX-NOTES: Go-live date is 2027-03-01"
XLSX_CELL_FACT = "CANARY-XLSX-CELL: Budget code is XQ-4471"
DOCX_TABLE_FACT = "CANARY-DOCX-TABLE: Project sponsor is Priya Shah"
PDF_BODY_FACT = "CANARY-PDF-BODY: Contract number is PDF-9931"


def make_pptx(out_path: str) -> None:
    prs = Presentation()
    # Slide 1: title + body with the shared canary, visible in slide text.
    slide1 = prs.slides.add_slide(prs.slide_layouts[1])
    slide1.shapes.title.text = "S9 Sample Deck"
    body = slide1.placeholders[1]
    body.text_frame.text = SHARED_CANARY

    # Slide 2: the distinct fact lives ONLY in the speaker notes, not in
    # any visible shape text, to test whether extraction reaches notes.
    slide2 = prs.slides.add_slide(prs.slide_layouts[1])
    slide2.shapes.title.text = "Rollout"
    slide2.placeholders[1].text_frame.text = "See notes for the go-live date."
    notes = slide2.notes_slide.notes_text_frame
    notes.text = PPTX_NOTE_FACT

    prs.save(out_path)


def make_xlsx(out_path: str) -> None:
    wb = openpyxl.Workbook()
    ws1 = wb.active
    ws1.title = "Overview"
    ws1["A1"] = "Fact"
    ws1["A2"] = SHARED_CANARY

    # Second sheet, in a table cell not at A1, to test multi-sheet reach.
    ws2 = wb.create_sheet("Budget")
    ws2["A1"] = "Line item"
    ws2["B1"] = "Value"
    ws2["A2"] = "ERP budget code"
    ws2["B2"] = XLSX_CELL_FACT

    wb.save(out_path)


def make_docx(out_path: str) -> None:
    doc = Document()
    doc.add_heading("S9 Sample Document", level=1)
    doc.add_paragraph(SHARED_CANARY)
    doc.add_paragraph("Stakeholder table below.")

    table = doc.add_table(rows=2, cols=2)
    table.style = "Table Grid"
    table.rows[0].cells[0].text = "Role"
    table.rows[0].cells[1].text = "Value"
    table.rows[1].cells[0].text = "Sponsor"
    table.rows[1].cells[1].text = DOCX_TABLE_FACT

    doc.save(out_path)


def make_pdf(out_path: str) -> None:
    c = canvas.Canvas(out_path, pagesize=letter)
    width, height = letter
    c.setFont("Helvetica", 12)
    c.drawString(72, height - 72, "S9 Sample PDF")
    c.drawString(72, height - 108, SHARED_CANARY)
    c.drawString(72, height - 126, PDF_BODY_FACT)
    c.showPage()
    c.setFont("Helvetica", 12)
    c.drawString(72, height - 72, "Page 2 (no facts here, layout check only).")
    c.showPage()
    c.save()


def main() -> None:
    out_dir = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "out")
    os.makedirs(out_dir, exist_ok=True)

    make_pptx(os.path.join(out_dir, "sample.pptx"))
    make_xlsx(os.path.join(out_dir, "sample.xlsx"))
    make_docx(os.path.join(out_dir, "sample.docx"))
    make_pdf(os.path.join(out_dir, "sample.pdf"))

    print(f"wrote fixtures to {out_dir}")
    print(f"  shared canary: {SHARED_CANARY}")
    print(f"  pptx notes fact: {PPTX_NOTE_FACT}")
    print(f"  xlsx cell fact: {XLSX_CELL_FACT}")
    print(f"  docx table fact: {DOCX_TABLE_FACT}")
    print(f"  pdf body fact: {PDF_BODY_FACT}")


if __name__ == "__main__":
    main()
