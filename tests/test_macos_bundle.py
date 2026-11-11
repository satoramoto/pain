import importlib.util
from pathlib import Path
import tempfile
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
