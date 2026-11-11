import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

PATH = Path(__file__).resolve().parents[1] / 'integrations/omarchy/pain/bridge.py'
spec = importlib.util.spec_from_file_location('desktop', PATH)
desktop = importlib.util.module_from_spec(spec)
spec.loader.exec_module(desktop)


class DesktopTests(unittest.TestCase):
    def test_status_uses_configured_port_and_saved_backend(self):
        ports = []
        ai = {'config': lambda: {'PAIN_PORT': '12345'},
              'backend': lambda: 'rocm', 'BACKENDS': ('rocm', 'vulkan')}
        top = {'fetch_server_stats': lambda port: ports.append(port) or {'online': False},
               'get_system_mem': lambda: {}, 'get_hwmon': lambda: {}}
        with patch.object(desktop.runpy, 'run_path', side_effect=[ai, top]):
            result = desktop.snapshot()
        self.assertEqual(ports, [12345])
        self.assertEqual(result['backend'], 'rocm')
        self.assertEqual(result['endpoint'], 'http://127.0.0.1:12345')

    def test_summarize_inference_prefers_busy_slot(self):
        server = {'slots': [
            {'id': 0, 'n_ctx': 131072, 'is_processing': False, 'speculative': True,
             'n_prompt_tokens': 0, 'n_prompt_tokens_cache': 0},
            {'id': 1, 'n_ctx': 131072, 'is_processing': True, 'speculative': True,
             'n_prompt_tokens': 4000, 'n_prompt_tokens_cache': 3000,
             'next_token': [{'n_decoded': 120, 'n_remain': -1}]}]}
        inf = desktop.summarize_inference(server)
        self.assertTrue(inf['processing'])
        self.assertEqual((inf['prompt'], inf['cached'], inf['decoded']), (4000, 3000, 120))
        self.assertEqual(inf['cache_hit_pct'], 75)
        self.assertEqual(inf['n_ctx'], 131072)
        self.assertFalse(desktop.summarize_inference({'slots': []})['has_slot'])

    def test_status_includes_memory_split_and_swap(self):
        calls = []
        ai = {'config': lambda: {}, 'backend': lambda: 'llamacpp-vulkan', 'BACKENDS': ('llamacpp-vulkan',)}
        top = {'fetch_server_stats': lambda port: {'online': True, 'model_alias': 'Muse-Glimmer-30B-Q4_K_XL', 'slots': []},
               'get_system_mem': lambda: {'total_gib': 58.5, 'used_gib': 40.2},
               'get_hwmon': lambda: {'gtt_used_gib': 20.4, 'gtt_total_gib': 44.0},
               'get_swap_info': lambda: {'total_gib': 198.5},
               'MODEL_WEIGHTS_GIB': (('muse', 18.3),), 'DEFAULT_WEIGHTS_GIB': 18.0, 'DRAFT_WEIGHTS_GIB': 1.5,
               'split_memory': lambda *args: calls.append(args) or {'gtt_ratio': 0.46}}
        with patch.object(desktop.runpy, 'run_path', side_effect=[ai, top]):
            result = desktop.snapshot()
        self.assertEqual(calls, [(40.2, 20.4, 44.0, 58.5, 18.3, 1.5)])
        self.assertEqual(result['memory_split'], {'gtt_ratio': 0.46})
        self.assertEqual(result['swap'], {'total_gib': 198.5})
        self.assertFalse(result['inference']['has_slot'])

    def test_invalid_backend_never_runs_command(self):
        with patch.object(desktop.runpy, 'run_path', return_value={'BACKENDS': ('rocm',), 'runtime': lambda: 'docker'}), \
                patch.object(desktop.subprocess, 'run') as run:
            with self.assertRaises(ValueError):
                desktop.action('up', 'invalid')
            run.assert_not_called()

    def test_start_preserves_arguments_and_uses_sudo_when_needed(self):
        with tempfile.TemporaryDirectory(prefix='pain checkout ') as directory, \
                patch.object(desktop, 'ROOT', Path(directory)), \
                patch.object(desktop.runpy, 'run_path', return_value={'BACKENDS': ('rocm',), 'runtime': lambda: 'docker'}), \
                patch.object(desktop.subprocess, 'run') as run:
            run.return_value.returncode = 1
            desktop.action('up', 'rocm')
            self.assertEqual(run.call_args.args[0], ['sudo', str(Path(directory) / 'ai'), 'up', 'rocm'])

    def test_background_start_escalates_with_pkexec(self):
        with tempfile.TemporaryDirectory(prefix='pain checkout ') as directory, \
                patch.object(desktop, 'ROOT', Path(directory)), \
                patch.object(desktop.runpy, 'run_path', return_value={'BACKENDS': ('rocm',), 'runtime': lambda: 'docker'}), \
                patch.object(desktop.subprocess, 'run') as run:
            run.return_value.returncode = 1
            desktop.action('up', 'rocm', escalate='pkexec')
            self.assertEqual(run.call_args.args[0], ['pkexec', str(Path(directory) / 'ai'), 'up', 'rocm'])

    def test_background_run_notifies_instead_of_waiting_for_enter(self):
        with patch.object(desktop.sys, 'argv', ['bridge.py', 'up', 'rocm']), \
                patch.object(desktop.sys.stdin, 'isatty', return_value=False), \
                patch.object(desktop, 'action', return_value=0) as action, \
                patch.object(desktop, 'notify') as notify, \
                patch('builtins.input', side_effect=AssertionError('must not block on stdin')):
            self.assertEqual(desktop.main(), 0)
            self.assertEqual(action.call_args.kwargs['escalate'], 'pkexec')
            self.assertIn('rocm started', notify.call_args.args[1])

    def test_background_failure_notifies_urgently(self):
        with patch.object(desktop.sys, 'argv', ['bridge.py', 'down']), \
                patch.object(desktop.sys.stdin, 'isatty', return_value=False), \
                patch.object(desktop, 'action', side_effect=ValueError('already in progress')), \
                patch.object(desktop, 'notify') as notify:
            self.assertEqual(desktop.main(), 1)
            self.assertTrue(notify.call_args.kwargs['urgent'])
            self.assertIn('already in progress', notify.call_args.args[1])

    def test_podman_failure_does_not_escalate_to_a_different_store(self):
        with tempfile.TemporaryDirectory() as directory, \
                patch.object(desktop, 'ROOT', Path(directory)), \
                patch.object(desktop.runpy, 'run_path', return_value={'BACKENDS': ('rocm',), 'runtime': lambda: 'podman'}), \
                patch.object(desktop.subprocess, 'run') as run:
            run.return_value.returncode = 1
            with self.assertRaisesRegex(ValueError, 'will not switch to rootful'):
                desktop.action('up', 'rocm')
            self.assertEqual(run.call_count, 1)
            self.assertEqual(run.call_args.args[0], ['podman', 'info'])
