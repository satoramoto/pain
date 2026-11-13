"""GPU routing, lifecycle safety and ComfyUI API behavior without a physical GPU."""
import argparse
import contextlib
import http.server
import importlib.machinery
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import tempfile
import threading
import unittest
from unittest.mock import patch

import comfy_backend as comfy

loader = importlib.machinery.SourceFileLoader('pain_comfy_test', str(Path(__file__).resolve().parents[1] / 'ai'))
spec = importlib.util.spec_from_loader(loader.name, loader)
pain = importlib.util.module_from_spec(spec)
loader.exec_module(pain)


class DetectionTest(unittest.TestCase):
    def test_inventory_filters_non_gpu_and_ignores_unreadable_devices(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name, kind, vendor, device in [
                ('amd', '0x030000', '0x1002', '0x1586'),
                ('nv', '0x030200', '0x10de', '0x1234'),
                ('audio', '0x040300', '0x10de', '0x1234'),
                ('intel', '0x030000', '0x8086', '0x1234'),
            ]:
                p = root / name
                p.mkdir()
                for field, value in [('class', kind), ('vendor', vendor), ('device', device)]:
                    (p / field).write_text(value)
            (root / 'gone').mkdir()
            self.assertEqual([g['vendor'] for g in comfy.inventory(root)], ['amd', 'nvidia'])

    @patch.object(comfy.platform, 'system', return_value='Linux')
    def test_auto_explicit_missing_and_dual_vendor(self, _):
        for vendor, expected in [('amd', 'comfyui-rocm'), ('nvidia', 'comfyui-cuda')]:
            with patch.object(comfy, 'inventory', return_value=[{'vendor': vendor}]):
                self.assertEqual(comfy.resolve('comfyui'), expected)
        with patch.object(comfy, 'inventory', return_value=[]):
            with self.assertRaisesRegex(ValueError, 'No AMD or NVIDIA'):
                comfy.resolve('comfyui')
        with patch.object(comfy, 'inventory', return_value=[{'vendor': 'amd'}, {'vendor': 'nvidia'}]):
            with self.assertRaisesRegex(ValueError, 'Choose'):
                comfy.resolve('comfyui')
            self.assertEqual(comfy.resolve('comfyui', 'cuda'), 'comfyui-cuda')
        with self.assertRaisesRegex(ValueError, 'disagree'):
            comfy.resolve('comfyui-rocm', 'cuda')
        with self.assertRaisesRegex(ValueError, 'only'):
            comfy.resolve('vulkan', 'cuda')

    def test_mac_choices_and_explicit_rejection(self):
        with patch.object(comfy.platform, 'system', return_value='Darwin'):
            self.assertEqual(comfy.choices(), ())
            with self.assertRaisesRegex(ValueError, 'Linux only'):
                comfy.resolve('comfyui-cuda')
            out = io.StringIO()
            with patch('sys.argv', ['ai', 'up', '--help']), contextlib.redirect_stdout(out):
                with self.assertRaises(SystemExit) as exc:
                    pain.main()
            self.assertEqual(exc.exception.code, 0)
            self.assertNotIn('comfyui', out.getvalue())
            self.assertNotIn('--device', out.getvalue())

    def test_other_amd_requires_matching_image(self):
        with patch.object(comfy, 'inventory', return_value=[{'vendor': 'amd', 'device': '0x9999'}]), \
             patch.object(Path, 'exists', return_value=True), \
             patch.object(Path, 'glob', return_value=[Path('/dev/dri/renderD128')]):
            with self.assertRaisesRegex(ValueError, 'targets Strix Halo'):
                comfy.check_host('comfyui-rocm', {})
            comfy.check_host('comfyui-rocm', {'PAIN_COMFYUI_ROCM_IMAGE': 'custom:image'})

    def test_no_driver_device_fails_before_docker(self):
        with patch.object(comfy, 'inventory', return_value=[{'vendor': 'amd', 'device': '0x1586'}]), \
             patch.object(Path, 'exists', return_value=False):
            with self.assertRaisesRegex(ValueError, '/dev/kfd'):
                comfy.check_host('comfyui-rocm', {})

    def test_environment_uses_invoking_user_with_sudo_and_validates_paths(self):
        with patch.object(comfy.pwd, 'getpwuid', return_value=argparse.Namespace(pw_dir='/home/alice')):
            env = comfy.environment({'SUDO_UID': '1234', 'SUDO_GID': '2345'})
        self.assertEqual(env['PAIN_COMFYUI_UID'], '1234')
        self.assertEqual(env['PAIN_COMFYUI_GID'], '2345')
        self.assertEqual(env['PAIN_COMFYUI_DATA_DIR'], '/home/alice/.local/share/pain/comfyui')
        with self.assertRaisesRegex(ValueError, 'absolute'):
            comfy.environment({'PAIN_COMFYUI_DATA_DIR': '../relative'})
        with self.assertRaises(ValueError):
            comfy.url({'PAIN_COMFYUI_PORT': '65536'})


class LifecycleTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.state = self.root / 'backend'
        self.state.write_text('vulkan\n')
        self.stack = contextlib.ExitStack()
        self.addCleanup(self.stack.close)
        for name, value in [('STATE', self.state), ('CONTAINER_STATE', self.root / 'container.json')]:
            self.stack.enter_context(patch.object(pain, name, value))
        self.stack.enter_context(patch.object(pain, 'config', return_value={'PAIN_COMFYUI_PORT': '8199'}))
        self.stack.enter_context(patch.object(comfy, 'check_host'))
        self.cleanup = self.stack.enter_context(patch.object(pain, 'remove_probe'))
        self.stack.enter_context(contextlib.redirect_stdout(io.StringIO()))
        self.stats = {'system': {}, 'devices': [{'name': 'test GPU', 'type': 'cuda'}]}

    def test_preflight_failure_preserves_existing_backend_and_never_replaces_it(self):
        calls = []
        def compose(*args, **kwargs):
            calls.append(args)
            if args[0] == 'run':
                raise subprocess.CalledProcessError(1, 'probe')
        with patch.object(pain, 'compose', side_effect=compose):
            with self.assertRaisesRegex(ValueError, 'not replaced'):
                pain.up_comfyui('comfyui-cuda')
        self.assertEqual([c[0] for c in calls], ['config', 'pull', 'run'])
        self.assertEqual(self.state.read_text(), 'vulkan\n')
        self.cleanup.assert_called_once()
        self.assertIn(self.cleanup.call_args.args[0], calls[2])

    def test_probe_timeout_and_interrupt_clean_up_without_switching(self):
        for failure in (subprocess.TimeoutExpired('probe', 120), KeyboardInterrupt()):
            self.cleanup.reset_mock()
            def compose(*args, **kwargs):
                if args[0] == 'run':
                    raise failure
            with patch.object(pain, 'compose', side_effect=compose):
                with self.assertRaises((ValueError, KeyboardInterrupt)):
                    pain.up_comfyui('comfyui-cuda')
            self.cleanup.assert_called_once()
            self.assertEqual(self.state.read_text(), 'vulkan\n')

    def test_success_probes_before_switch_and_never_calls_llm_setup(self):
        with patch.object(pain, 'compose') as compose, \
             patch.object(pain, 'container', return_value={'Image': 'pinned'}), \
             patch.object(comfy, 'api', return_value=self.stats), \
             patch.object(pain, 'get_paths') as paths, \
             patch.object(pain, 'apply') as apply, \
             patch.object(pain, 'sync_opencode') as sync:
            pain.up_comfyui('comfyui-rocm')
        self.assertEqual([c.args[0] for c in compose.call_args_list], ['config', 'pull', 'run', 'up'])
        paths.assert_not_called()
        apply.assert_not_called()
        sync.assert_not_called()
        self.assertEqual(self.state.read_text().strip(), 'comfyui-rocm')
        self.assertEqual(json.loads((self.root / 'container.json').read_text()), {'Image': 'pinned'})

    def test_readiness_timeout_leaves_state_for_logs_and_cleanup(self):
        with patch.object(pain, 'compose'), patch.object(pain, 'container', return_value={}), \
             patch.object(pain.time, 'monotonic', side_effect=[0, 181]):
            with self.assertRaisesRegex(ValueError, 'not ready after 180'):
                pain.up_comfyui('comfyui-cuda')
        self.assertEqual(pain.backend(), 'comfyui-cuda')

    def test_cpu_response_is_not_ready(self):
        with self.assertRaisesRegex(ValueError, 'not using a GPU'):
            comfy.validate_stats({'devices': [{'type': 'cpu'}, {'type': 'cuda'}]})
        with self.assertRaisesRegex(ValueError, 'Invalid'):
            comfy.validate_stats({'not': 'comfy'})

    def test_llm_commands_refuse_comfyui_before_calling_ollama(self):
        self.state.write_text('comfyui-cuda\n')
        with patch.object(pain, 'api') as api, patch.object(pain, 'compose') as compose:
            for command in [['pull', 'model'], ['run', 'model'], ['bench', 'model'], ['sync'], ['top']]:
                with self.subTest(command=command), patch('sys.argv', ['ai', *command]):
                    with self.assertRaisesRegex(ValueError, 'LLM command'):
                        pain.main()
            with self.assertRaisesRegex(ValueError, 'LLM command'):
                pain.apply('test')
        api.assert_not_called()
        compose.assert_not_called()

    def test_switch_back_takes_original_llm_path(self):
        self.state.write_text('comfyui-rocm\n')
        with patch.object(pain, 'get_paths'), patch.object(pain, 'compose') as compose, \
             patch.object(pain, 'container', return_value={}), \
             patch.object(pain, 'api', return_value={'version': 'test'}), \
             patch.object(pain, 'presets', return_value={}), patch.object(pain, 'sync_opencode'), \
             patch.object(comfy, 'api') as comfy_api:
            pain.up('vulkan')
        self.assertEqual(pain.backend(), 'vulkan')
        self.assertEqual([c.args[0] for c in compose.call_args_list], ['config', 'pull', 'up'])
        comfy_api.assert_not_called()

    def test_status_and_logs_and_down_use_comfy_backend(self):
        self.state.write_text('comfyui-cuda\n')
        with patch.object(pain, 'compose') as compose, patch.object(comfy, 'api', return_value=self.stats) as api, \
             patch.object(pain, 'api') as llm_api:
            for command in ['status', 'logs', 'down']:
                with patch('sys.argv', ['ai', command]):
                    pain.main()
        self.assertEqual([c.args[0] for c in compose.call_args_list], ['ps', 'logs', 'down'])
        api.assert_called_once()
        llm_api.assert_not_called()

    def test_compose_isolated_from_llm_volumes_and_environment(self):
        for selected, expected in [('comfyui-rocm', 'compose.comfyui.yaml'), ('vulkan', 'compose.yaml')]:
            with patch.object(pain.subprocess, 'run') as run:
                pain.compose('config', selected=selected)
            args = run.call_args.args[0]
            self.assertIn(str(pain.ROOT / expected), args)
            self.assertEqual(run.call_args.kwargs['env']['PAIN_BACKEND'], selected)


class ApiTest(unittest.TestCase):
    def test_system_stats_over_http_on_separate_port(self):
        requests = []
        class Handler(http.server.BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass
            def do_GET(self):
                requests.append(self.path)
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b'{"devices":[{"type":"cuda"}],"system":{}}')
        server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            comfy.validate_stats(comfy.api({'PAIN_COMFYUI_PORT': str(server.server_port)}))
            self.assertEqual(requests, ['/system_stats'])
        finally:
            server.shutdown()
            server.server_close()
            thread.join()


if __name__ == '__main__':
    unittest.main()
