"""Exercise GGUF downloads and Ollama-import de-duplication without Docker."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import contextlib
import hashlib
import http.server
import importlib.machinery
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch

loader = importlib.machinery.SourceFileLoader(
    'pain_pull', str(Path(__file__).resolve().parents[1] / 'ai'))
spec = importlib.util.spec_from_loader(loader.name, loader)
pain = importlib.util.module_from_spec(spec)
loader.exec_module(pain)


class PullTest(unittest.TestCase):
    def test_resolve_download(self):
        self.assertEqual(
            pain.resolve_download('hf.co/owner/repo/sub/file.gguf'),
            ('https://huggingface.co/owner/repo/resolve/main/sub/file.gguf', 'file.gguf'))
        self.assertEqual(
            pain.resolve_download('owner/repo:file.gguf'),
            ('https://huggingface.co/owner/repo/resolve/main/file.gguf', 'file.gguf'))
        self.assertEqual(
            pain.resolve_download('owner/repo/file.gguf'),
            ('https://huggingface.co/owner/repo/resolve/main/file.gguf', 'file.gguf'))
        self.assertEqual(
            pain.resolve_download('https://example.com/models/file.gguf?token=x'),
            ('https://example.com/models/file.gguf?token=x', 'file.gguf'))
        self.assertIsNone(pain.resolve_download('qwen3.8:27b-q8_0'))

    def test_model_filename(self):
        self.assertEqual(pain.model_filename('owner/model.gguf'), 'model.gguf')
        self.assertEqual(pain.model_filename('qwen3.8:27b-q8_0'), 'qwen3.8_27b-q8_0.gguf')
        self.assertEqual(pain.model_filename('../bad name'), 'bad_name.gguf')

    def test_download_file(self):
        payload = b'GGUF' + os.urandom(2 * 1024 * 1024 + 17)

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_GET(self):
                self.send_response(200)
                self.send_header('Content-Length', str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)

        server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with tempfile.TemporaryDirectory() as directory:
                destination = Path(directory) / 'file.gguf'
                with contextlib.redirect_stdout(io.StringIO()):
                    pain.download_file(
                        f'http://127.0.0.1:{server.server_port}/file.gguf', destination)
                self.assertEqual(destination.read_bytes(), payload)
                self.assertFalse(destination.with_name('file.gguf.part').exists())
        finally:
            server.shutdown()
            server.server_close()
            thread.join()

    def test_dedupe_hardlinks_ollama_blob(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            payload = b'fake weights'
            digest = hashlib.sha256(payload).hexdigest()
            store = root / 'ollama'
            blob = store / 'blobs' / f'sha256-{digest}'
            blob.parent.mkdir(parents=True)
            blob.write_bytes(payload)
            source = root / 'model.gguf'
            source.write_bytes(payload)
            manifest = json.dumps({
                'layers': [{
                    'mediaType': 'application/vnd.ollama.image.model',
                    'digest': f'sha256:{digest}',
                    'size': len(payload),
                }]
            }).encode()
            manifest_digest = hashlib.sha256(manifest).hexdigest()
            manifest_blob = store / 'blobs' / f'sha256-{manifest_digest}'
            manifest_blob.write_bytes(manifest)
            link = store / 'manifests-v2' / 'ollama.com' / 'library' / 't' / 'latest'
            link.parent.mkdir(parents=True)
            os.symlink(manifest_blob, link)
            with patch.object(pain, 'models_dir', return_value=root), \
                    contextlib.redirect_stdout(io.StringIO()), \
                    contextlib.redirect_stderr(io.StringIO()):
                pain.dedupe_ollama_import('t', 'FROM /models/model.gguf\n')
            self.assertEqual(source.stat().st_ino, blob.stat().st_ino)


if __name__ == '__main__':
    unittest.main()
