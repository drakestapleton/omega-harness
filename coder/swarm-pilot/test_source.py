import ast
from pathlib import Path
import unittest

class SourceChecks(unittest.TestCase):
    def test_all_pilot_entrypoints_parse(self):
        for p in Path(__file__).parent.glob('*.py'):
            with self.subTest(file=p.name):ast.parse(p.read_text(),filename=str(p))
