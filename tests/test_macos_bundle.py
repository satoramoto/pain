import importlib.util
from pathlib import Path
import tempfile
import os
import unittest
from unittest.mock import patch

PATH=Path(__file__).resolve().parents[1]/'scripts/bundle-macos-runtime.py'
spec=importlib.util.spec_from_file_location('mac_bundle',PATH)
bundle=importlib.util.module_from_spec(spec);spec.loader.exec_module(bundle)

class BundleTests(unittest.TestCase):
    def test_loader_relative_dependencies_are_resolved_beside_the_library(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);dependency=root/'libggml-base.dylib';dependency.touch()
            self.assertEqual(bundle.resolve('@loader_path/libggml-base.dylib',root/'libggml-metal.dylib',[]),dependency)

    def test_unresolved_dependency_stops_packaging(self):
        with self.assertRaisesRegex(RuntimeError,'Unresolved dependency'):
            bundle.resolve('/missing/libdependency.dylib',Path('/missing/libmetal.dylib'),[])

    def test_system_frameworks_are_not_copied_from_the_builder(self):
        self.assertTrue(bundle.system_library('/System/Library/Frameworks/Metal.framework/Versions/A/Metal'))
        self.assertFalse(bundle.system_library('/opt/homebrew/lib/libepoxy.dylib'))

    def test_wrong_architecture_cannot_enter_the_package(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);binary=root/'krunkit';binary.write_bytes(b'fake')
            with patch.object(bundle,'output',return_value='x86_64'):
                with self.assertRaisesRegex(RuntimeError,'Not an ARM64'):
                    bundle.bundle(root/'runtime',[(binary,Path('libexec/krunkit.real'))],[],root/'virgl',root/'entitlements')

    def test_developer_id_signing_preserves_hypervisor_entitlement(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); binary = root/'krunkit'; binary.write_bytes(b'fake')
            def tool(*args):
                return 'arm64' if args[0] == 'lipo' else 'binary:\n'
            with patch.dict(os.environ, {'APPLE_SIGNING_IDENTITY':'Developer ID Application: Test'}), patch.object(bundle, 'output', side_effect=tool), patch.object(bundle.subprocess, 'run') as run:
                bundle.bundle(root/'runtime', [(binary, Path('libexec/krunkit.real'))], [], root/'virgl', root/'entitlements')
            signing = next(call.args[0] for call in run.call_args_list if '--sign' in call.args[0])
            self.assertIn('Developer ID Application: Test', signing)
            self.assertIn('--timestamp', signing)
            self.assertIn('runtime', signing)
            self.assertIn('--entitlements', signing)

    def test_cmake_modules_get_apir_aliases(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name in ('ggml-metal', 'ggml-virtgpu-backend'):
                (root/f'lib{name}.so').touch()
            targets = {str(target) for _, target in bundle.metal_seeds(root)}
            self.assertIn('lib/libggml-metal.dylib', targets)
            self.assertIn('lib/libggml-virtgpu-backend.dylib', targets)
            self.assertIn('lib/libggml-metal.so', targets)

    def test_missing_metal_module_fails_before_packaging(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(RuntimeError, 'Missing required runtime module'):
                bundle.metal_seeds(Path(directory))
