"""Packaging regressions for older Super Productivity upload limits."""
import importlib.util
from pathlib import Path
import unittest
import zipfile

ROOT = Path(__file__).absolute().parents[1]
spec = importlib.util.spec_from_file_location("kanban_build", ROOT / "build.py")
assert spec is not None and spec.loader is not None
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


class BuildTests(unittest.TestCase):
    def test_css_keeps_quoted_content_and_meaningful_whitespace(self):
        source = '''/* formatting */
        .card :focus { width: calc(100% - 2px); content: "a  ; } /*keep*/ b"; }
        [title='a  b'] { --gap: 2px  4px; }
        '''
        compact = builder.compact_css(source)
        self.assertIn('.card :focus{width:calc(100% - 2px)', compact)
        self.assertIn('"a  ; } /*keep*/ b"', compact)
        self.assertIn("[title='a  b']", compact)
        self.assertIn('--gap:2px 4px', compact)
        self.assertNotIn('/* formatting */', compact)

    def test_html_fits_released_19_1_upload_limit(self):
        archive = builder.build()
        with zipfile.ZipFile(archive) as package:
            self.assertEqual(set(package.namelist()), {"manifest.json", "plugin.js", "index.html"})
            self.assertLessEqual(len(package.read("index.html")), 100 * 1024)


if __name__ == "__main__":
    unittest.main()
