from http.server import BaseHTTPRequestHandler, HTTPServer
import importlib.machinery
import json
from pathlib import Path
import threading
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

    def test_swap_info(self):
        info = self.paintop.get_swap_info()
        self.assertIn('total_gib', info)
        self.assertIn('used_gib', info)
        self.assertIn('zram_total_gib', info)
        self.assertIn('nvme_total_gib', info)

    def test_split_memory_measured_gtt(self):
        # 40.2G host used, 20.4G of it pinned in GTT (44G ceiling), Muse weights 19.7G + 1.6G draft
        mem = self.paintop.split_memory(40.2, 20.4, 44.0, 58.5, 19.7, 1.6)
        self.assertEqual(mem['base'], 19.7)
        self.assertEqual(mem['draft'], 0.7)   # capped by what GTT actually holds
        self.assertEqual(mem['kv'], 0.0)
        self.assertEqual(mem['sys'], 19.8)    # host usage outside GTT
        self.assertAlmostEqual(mem['base'] + mem['draft'] + mem['kv'] + mem['sys'], 40.2, places=1)
        self.assertEqual(mem['free'], 18.3)
        self.assertAlmostEqual(mem['gtt_ratio'], 20.4 / 44.0)
        self.assertEqual(mem['gtt_share_pct'], 75)

    def test_split_memory_kv_is_gtt_remainder(self):
        mem = self.paintop.split_memory(45.0, 24.0, 44.0, 58.5, 19.7, 1.6)
        self.assertEqual(mem['kv'], 2.7)
        self.assertEqual(mem['sys'], 21.0)

    def test_split_memory_clamps(self):
        # GTT can never exceed host usage; zero totals must not divide by zero
        mem = self.paintop.split_memory(10.0, 12.0, 0.0, 0.0, 19.7, 1.6)
        self.assertEqual(mem['gtt'], 10.0)
        self.assertEqual(mem['sys'], 0.0)
        self.assertEqual(mem['gtt_ratio'], 0.0)
        self.assertEqual(mem['gtt_share_pct'], 0)

    def test_fetch_server_stats_llamacpp_router(self):
        # A llama-server router answers /models for everyone but needs ?model=
        # on /slots and /props; the bare paths return errors.
        seen = []

        class Router(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_GET(self):
                seen.append(self.path)
                routes = {
                    '/models': {'data': [
                        {'id': 'qwen38-q8-tuned', 'status': {'value': 'unloaded'}},
                        {'id': 'muse-glimmer-q4-experimental', 'status': {'value': 'loaded'}}]},
                    '/slots?model=muse-glimmer-q4-experimental': [
                        {'id': 0, 'n_ctx': 131072, 'speculative': True, 'is_processing': False}],
                    '/props?model=muse-glimmer-q4-experimental': {'model_alias': 'muse-glimmer-q4-experimental'},
                }
                body = routes.get(self.path)
                self.send_response(200 if body is not None else 400)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps(body if body is not None else {'error': 'model name is missing'}).encode())

        server = HTTPServer(('127.0.0.1', 0), Router)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            state = self.paintop.fetch_server_stats(server.server_address[1])
        finally:
            server.shutdown()
        self.assertTrue(state['online'])
        self.assertEqual(state['engine'], 'llama.cpp')
        self.assertEqual(state['model_id'], 'muse-glimmer-q4-experimental')
        self.assertEqual(state['model_alias'], 'Muse-Glimmer-30B-Q4_K_XL')
        self.assertEqual(state['slots'][0]['n_ctx'], 131072)
        self.assertIn('/slots?model=muse-glimmer-q4-experimental', seen)
        self.assertEqual([m['id'] for m in state['models'] if m['loaded']], ['muse-glimmer-q4-experimental'])

    def test_fetch_server_stats_offline(self):
        state = self.paintop.fetch_server_stats(1)  # nothing listens on port 1
        self.assertFalse(state['online'])
        self.assertEqual(state['slots'], [])

    def test_swap_io(self):
        io = self.paintop.get_swap_io()
        self.assertIn('in_mb_s', io)
        self.assertIn('out_mb_s', io)
        self.assertIn('total_mb_s', io)

if __name__ == '__main__':
    unittest.main()
