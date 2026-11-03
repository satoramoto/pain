import importlib.machinery
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parent.parent

class TestPaintop(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        paintop_path = str(ROOT / 'paintop')
        cls.paintop = importlib.machinery.SourceFileLoader('paintop_mod', paintop_path).load_module()

    def test_paintop_import(self):
        self.assertTrue(callable(self.paintop.get_hwmon))
        self.assertTrue(callable(self.paintop.get_system_mem))
        self.assertTrue(callable(self.paintop.fetch_server_stats))

    def test_smooth_bar(self):
        filled, empty = self.paintop.make_smooth_bar(0.5, 20)
        self.assertEqual(len(filled) + len(empty), 20)
        self.assertTrue(filled.startswith('█'))

    def test_braille_wave(self):
        wave = self.paintop.braille_wave([0.0, 0.5, 1.0, 0.5], width=10)
        self.assertEqual(len(wave), 10)

    def test_system_mem(self):
        mem = self.paintop.get_system_mem()
        self.assertIn('total_gib', mem)
        self.assertIn('used_gib', mem)
        self.assertGreater(mem['total_gib'], 0)

if __name__ == '__main__':
    unittest.main()
