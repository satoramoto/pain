"""Runtime dispatch and Metal admission checks, without a real container daemon."""
import importlib.machinery
import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch, Mock

ROOT = Path(__file__).resolve().parents[1]

def load(name, path):
    loader = importlib.machinery.SourceFileLoader(name, str(path))
    spec = importlib.util.spec_from_loader(name, loader)
    module = importlib.util.module_from_spec(spec)
    loader.exec_module(module)
    return module

pain = load('pain_runtime', ROOT / 'ai')
entry = load('metal_entry', ROOT / 'containers/virtgpu/entrypoint.py')


class RuntimeTests(unittest.TestCase):
    def test_runtime_is_explicit_and_validated(self):
        for config, expected in (({}, 'docker'), ({'PAIN_RUNTIME': 'podman'}, 'podman')):
            with patch.object(pain, 'config', return_value=config):
                self.assertEqual(pain.runtime(), expected)
        with patch.object(pain, 'config', return_value={'PAIN_RUNTIME': 'arbitrary command'}):
            with self.assertRaisesRegex(ValueError, 'docker or podman'):
                pain.runtime()

    def test_compose_passes_resolved_model_directory_to_both_runtimes(self):
        with tempfile.TemporaryDirectory(prefix='pain models ') as directory:
            for runtime in ('docker', 'podman'):
                with patch.object(pain, 'config', return_value={'PAIN_RUNTIME': runtime, 'PAIN_MODELS_DIR': directory}), \
                     patch.object(pain.subprocess, 'run') as run:
                    pain.compose('config', selected='llamacpp-metal')
                    self.assertEqual(run.call_args.args[0][:2], [runtime, 'compose'])
                    self.assertEqual(run.call_args.kwargs['env']['PAIN_MODELS_DIR'], directory)

    def test_cannot_stop_or_start_through_a_different_runtime(self):
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory) / 'runtime'
            state.write_text('docker\n')
            with patch.object(pain, 'RUNTIME_STATE', state), \
                 patch.object(pain, 'config', return_value={'PAIN_RUNTIME': 'podman'}), \
                 patch.object(pain.subprocess, 'run') as run:
                for command in ('up', 'down', 'ps'):
                    with self.assertRaisesRegex(ValueError, 'before switching'):
                        pain.compose(command)
                run.assert_not_called()

    def test_failed_metal_probe_preserves_running_engine(self):
        def compose(*args, **kwargs):
            if args[0] == 'run':
                raise subprocess.CalledProcessError(1, args)
        with patch.object(pain, 'models_dir'), \
             patch.object(pain, 'runtime', return_value='podman'), \
             patch.object(pain, 'compose', side_effect=compose) as calls, \
             patch.object(pain, 'generate_models_ini') as presets:
            with self.assertRaises(subprocess.CalledProcessError):
                pain.up('llamacpp-metal')
            self.assertEqual([call.args[0] for call in calls.call_args_list], ['config', 'build', 'run'])
            presets.assert_not_called()

    def test_metal_rejects_docker_before_building(self):
        with patch.object(pain, 'models_dir'), patch.object(pain, 'compose') as compose, \
             patch.object(pain, 'runtime', return_value='docker'):
            with self.assertRaisesRegex(ValueError, 'requires Podman'):
                pain.up('llamacpp-metal')
            self.assertEqual([call.args[0] for call in compose.call_args_list], ['config'])

    def test_lab_uses_podman_for_build_and_inspection(self):
        with patch.object(pain, 'config', return_value={'PAIN_RUNTIME': 'podman'}), \
             patch.object(pain.subprocess, 'check_output', return_value='sha256:test\n') as inspect, \
             patch.object(pain.subprocess, 'run') as run:
            pain.lab(Mock(lab_command='build'))
            self.assertEqual(run.call_args.args[0][:2], ['podman', 'build'])
            self.assertEqual(inspect.call_args.args[0][:2], ['podman', 'inspect'])


class MetalProbeTests(unittest.TestCase):
    def test_requires_remoted_metal_device_not_log_messages(self):
        self.assertEqual(entry.metal_device('Available devices:\n  [virtgpu] Metal0: Apple M4 (123 MiB)'), '[virtgpu] Metal0')
        for output in ('Available devices:\n', 'Vulkan0: Apple M4', 'Metal0: Apple M4',
                       'ggml_virtgpu: Metal support compiled\nCPU: ARM', '[virtgpu] Vulkan0: Apple M4'):
            with self.subTest(output=output), self.assertRaises(ValueError):
                entry.metal_device(output)

    def test_probe_failure_never_launches_server(self):
        with patch.object(entry.subprocess, 'run', return_value=Mock(returncode=0, stdout='CPU: ARM', stderr='')), \
             patch.object(entry.os, 'execv') as execute:
            with self.assertRaises(ValueError):
                entry.main(['--port', '11434'])
            execute.assert_not_called()

    def test_success_explicitly_selects_metal(self):
        with patch.object(entry.subprocess, 'run', return_value=Mock(returncode=0, stdout='[virtgpu] Metal0: Apple M4', stderr='')), \
             patch.object(entry.os, 'execv') as execute:
            entry.main(['--port', '11434'])
            self.assertEqual(execute.call_args.args[1][-2:], ['--device', '[virtgpu] Metal0'])

class PodmanCompatibilityTests(unittest.TestCase):
    def test_container_lookup_uses_portable_ps_and_selected_runtime(self):
        with patch.object(pain, 'compose', return_value=Mock(stdout='container-id\n')) as compose, \
             patch.object(pain, 'config', return_value={'PAIN_RUNTIME': 'podman'}), \
             patch.object(pain, 'backend', return_value='llamacpp-metal'), \
             patch.object(pain.subprocess, 'check_output', return_value='[{"Config":{"Labels":{"ai.pain.backend":"llamacpp-metal"}}}]') as inspect:
            pain.container()
            compose.assert_called_once_with('ps', '-q', capture=True)
            self.assertEqual(inspect.call_args.args[0], ['podman', 'inspect', 'container-id'])

    def test_model_download_container_uses_podman(self):
        with tempfile.TemporaryDirectory() as directory, \
             patch.object(pain, 'models_dir', return_value=Path(directory)), \
             patch.object(pain, 'config', return_value={'PAIN_RUNTIME': 'podman'}), \
             patch.object(pain.subprocess, 'run') as run, \
             patch.object(pain, 'find_ollama_manifest', return_value={}), \
             patch.object(pain, 'ollama_model_layer', return_value=None):
            with self.assertRaisesRegex(ValueError, 'manifest'):
                pain.pull_ollama('example:test')
            self.assertEqual(run.call_args.args[0][:3], ['podman', 'run', '--rm'])
