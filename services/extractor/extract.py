"""Offline extraction. Original bytes are never executed or sent to a model."""
from __future__ import annotations
import io
import os
import shutil
import subprocess
import tempfile
import zipfile
from pathlib import Path

MAX_BYTES = 20 * 1024 * 1024
MAX_TEXT = 1_000_000
MAX_FRAGMENTS = 3000
MAX_FRAGMENT_TEXT = 30000
MAX_PAGES = 200


def inspect_office(data: bytes) -> None:
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        entries = archive.infolist()
        if len(entries) > 10000 or sum(i.file_size for i in entries) > 100 * 1024 * 1024:
            raise ValueError("office_expansion_limit")
        for entry in entries:
            if "vbaproject" in entry.filename.lower():
                raise ValueError("macros_not_supported")
            if entry.file_size > max(1, entry.compress_size) * 200:
                raise ValueError("office_compression_limit")


def extract(data: bytes, filename: str, mime: str = "") -> dict:
    if not data or len(data) > MAX_BYTES:
        raise ValueError("empty_or_oversize_document")
    suffix = Path(filename).suffix.lower()
    fragments: list[dict] = []
    warnings: list[str] = []
    pages_requiring_ocr: list[int] = []
    total = 0

    def add(text: str, **locator):
        nonlocal total
        text = str(text).strip().replace("\x00", "")
        if not text:
            return
        count = (len(text) + MAX_FRAGMENT_TEXT - 1) // MAX_FRAGMENT_TEXT
        if total + len(text) > MAX_TEXT or len(fragments) + count > MAX_FRAGMENTS:
            raise ValueError("extracted_content_limit")
        for start in range(0, len(text), MAX_FRAGMENT_TEXT):
            fragments.append({"locator": locator, "text": text[start:start + MAX_FRAGMENT_TEXT]})
        total += len(text)

    if data.startswith(b"%PDF-"):
        from pypdf import PdfReader
        reader = PdfReader(io.BytesIO(data), strict=True)
        if reader.is_encrypted:
            raise ValueError("encrypted_pdf_requires_unlocked_copy")
        if len(reader.pages) > MAX_PAGES:
            raise ValueError("pdf_page_limit")
        for number, page in enumerate(reader.pages, 1):
            text = page.extract_text() or ""
            if text.strip():
                add(text, page=number)
            elif os.environ.get("ENABLE_OCR") == "true" and shutil.which("pdftoppm") and shutil.which("tesseract"):
                with tempfile.TemporaryDirectory() as temporary:
                    source = Path(temporary) / "source.pdf"
                    source.write_bytes(data)
                    destination = Path(temporary) / "page"
                    subprocess.run(["pdftoppm", "-f", str(number), "-l", str(number), "-scale-to", "2000", "-png", "-singlefile", str(source), str(destination)], check=True, timeout=12, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                    from PIL import Image
                    import pytesseract
                    with Image.open(str(destination) + ".png") as image:
                        add(pytesseract.image_to_string(image, lang=os.environ.get("OCR_LANGUAGES", "spa+eng"), timeout=12), page=number)
            else:
                pages_requiring_ocr.append(number)
    elif data.startswith((b"\x89PNG\r\n\x1a\n", b"\xff\xd8\xff")):
        from PIL import Image
        Image.MAX_IMAGE_PIXELS = 20_000_000
        with Image.open(io.BytesIO(data)) as image:
            if image.width * image.height > 20_000_000:
                raise ValueError("image_pixel_limit")
            image.verify()
        if os.environ.get("ENABLE_OCR") == "true" and shutil.which("tesseract"):
            import pytesseract
            with Image.open(io.BytesIO(data)) as image:
                add(pytesseract.image_to_string(image, lang=os.environ.get("OCR_LANGUAGES", "spa+eng"), timeout=15), page=1)
        else:
            warnings.append("image_requires_ocr_enable_tesseract")
    elif data.startswith(b"PK") and suffix in {".docx", ".pptx", ".xlsx"}:
        inspect_office(data)
        if suffix == ".docx":
            from docx import Document
            document = Document(io.BytesIO(data))
            for number, paragraph in enumerate(document.paragraphs, 1):
                add(paragraph.text, paragraph=number)
            for table_number, table in enumerate(document.tables, 1):
                for row_number, row in enumerate(table.rows, 1):
                    add(" | ".join(cell.text for cell in row.cells), table=table_number, row=row_number)
            warnings.append("docx_has_paragraph_locators_not_rendered_page_numbers")
        elif suffix == ".pptx":
            from pptx import Presentation
            presentation = Presentation(io.BytesIO(data))
            if len(presentation.slides) > MAX_PAGES:
                raise ValueError("slide_limit")
            for number, slide in enumerate(presentation.slides, 1):
                text = []
                for shape in slide.shapes:
                    if shape.has_text_frame:
                        text.append(shape.text)
                    if shape.has_table:
                        text.extend(" | ".join(cell.text for cell in row.cells) for row in shape.table.rows)
                add("\n".join(text), slide=number)
        else:
            from openpyxl import load_workbook
            workbook = load_workbook(io.BytesIO(data), read_only=True, data_only=True, keep_links=False)
            try:
                for sheet in workbook:
                    if sheet.max_row and sheet.max_row > 100000:
                        raise ValueError("spreadsheet_row_limit")
                    for number, row in enumerate(sheet.iter_rows(), 1):
                        cells = [f"{cell.coordinate}: {cell.value}" for cell in row if cell.value is not None]
                        add(" | ".join(cells), sheet=sheet.title, row=number)
            finally:
                workbook.close()
            warnings.append("formula_values_are_cached_values_only_no_calculation")
    elif suffix in {".txt", ".md", ".csv", ".tsv", ".eml"} or mime in {"text/plain", "text/markdown", "text/csv"}:
        if b"\x00" in data:
            raise ValueError("binary_file_not_text")
        try:
            text = data.decode("utf-8-sig")
        except UnicodeDecodeError as error:
            raise ValueError("text_must_be_utf8") from error
        for number, line in enumerate(text.splitlines(), 1):
            add(line, line=number)
    else:
        raise ValueError("unsupported_or_mismatched_file_type")
    if pages_requiring_ocr:
        warnings.append("pages_require_ocr:" + ",".join(map(str, pages_requiring_ocr)))
    if not fragments:
        warnings.append("no_readable_text_do_not_infer_document_contents")
    return {"text": "\n\n".join(f["text"] for f in fragments), "fragments": fragments, "warnings": warnings}
