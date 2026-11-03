"""Exercise benchmark requests and recorded timings through a real HTTP socket."""
import argparse
import contextlib
import http.server
import importlib.machinery
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch

loader = importlib.machinery.SourceFileLoader('pain', str(Path(__file__).resolve().parents[1] / 'ai'))
spec = importlib.util.spec_from_loader(loader.name, loader)
pain = importlib.util.module_from_spec(spec)
loader.exec_module(pain)


class BenchmarkIntegrationTest(unittest.TestCase):
    def test_sweep_preserves_preset_and_accounts_for_cache(self):
        requests = []
        class Handler(http.server.BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_GET(self):
                self.respond(None)

            def do_POST(self):
                self.respond(json.loads(self.rfile.read(int(self.headers['Content-Length']))))

            def respond(self, body):
                requests.append((self.path, body))
                if self.path == '/api/show':
                    result = {'parameters': 'draft_num_predict 2', 'template': 'example'}
                elif self.path == '/api/version':
                    result = {'version': 'test'}
                elif self.path == '/api/ps':
                    result = {'models': [{'digest': 'test-model-digest'}]}
                elif body.get('keep_alive') == 0:
                    self.server.generated = 0
                    result = {'done': True}
                else:
                    self.server.generated += 1
                    result = {'response': 'example', 'done_reason': 'length',
                              'prompt_eval_count': 100,
                              'prompt_eval_duration': 1_000_000_000,
                              'eval_count': 20, 'eval_duration': 2_000_000_000}
                    if self.server.generated == 2:
                        result['prompt_eval_cached_count'] = 90
                self.send_response(200)
                self.end_headers()
                self.wfile.write(json.dumps(result).encode())

        server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                prompt = root / 'prompt.txt'
                prompt.write_text('test prompt')
                args = argparse.Namespace(model='test-model', prompt=prompt, drafts=[0, 4],
                                          batches=[512], repeats=1, context=65536,
                                          tokens=20, think='off', note='test')
                info = {'Image': 'sha256:test', 'Config': {'Image': 'test:tag', 'Env': []}}
                with patch.object(pain, 'ROOT', root), \
                     patch.object(pain, 'config', return_value={'PAIN_PORT': str(server.server_port)}), \
                     patch.object(pain, 'container', return_value=info), \
                     patch.object(pain, 'backend', return_value='rocm'), \
                     contextlib.redirect_stdout(io.StringIO()):
                    pain.benchmark(args)
                rows = [json.loads(line) for line in next((root / 'benchmarks/results').glob('*.jsonl')).read_text().splitlines()]
                self.assertEqual([r['phase'] for r in rows], ['fresh', 'repeat'] * 2)
                self.assertEqual([r['uncached_prompt_tokens_per_second'] for r in rows], [100, 10] * 2)
                self.assertTrue(all(r['generation_tokens_per_second'] == 10 for r in rows))
                generated = [b for p, b in requests if p == '/api/generate' and 'prompt' in b]
                self.assertEqual([b['options']['draft_num_predict'] for b in generated], [0, 0, 4, 4])
                self.assertEqual(sum(b.get('keep_alive') == 0 for p, b in requests if b), 2)
                self.assertFalse(any(p in ('/api/create', '/api/delete') for p, _ in requests))
        finally:
            server.shutdown()
            server.server_close()
            thread.join()


if __name__ == '__main__':
    unittest.main()
