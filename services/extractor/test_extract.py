import io
import os
import unittest
from unittest.mock import patch

from extract import extract


class ExtractionContractTests(unittest.TestCase):
    def test_long_text_is_split_without_losing_source_or_text(self):
        text = "a" * 60001
        result = extract(text.encode(), "notes.txt")
        self.assertEqual("".join(fragment["text"] for fragment in result["fragments"]), text)
        self.assertTrue(all(len(fragment["text"]) <= 30000 for fragment in result["fragments"]))
        self.assertTrue(all(fragment["locator"] == {"line": 1} for fragment in result["fragments"]))

    def test_blank_pdf_warning_count_fits_worker_contract(self):
        from pypdf import PdfWriter

        writer = PdfWriter()
        for _ in range(101):
            writer.add_blank_page(width=100, height=100)
        buffer = io.BytesIO()
        writer.write(buffer)
        with patch.dict(os.environ, {"ENABLE_OCR": "false"}):
            result = extract(buffer.getvalue(), "scanned.pdf")
        self.assertLessEqual(len(result["warnings"]), 100)
        self.assertIn("no_readable_text_do_not_infer_document_contents", result["warnings"])


if __name__ == "__main__":
    unittest.main()
