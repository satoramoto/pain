"""Exercise the installer with fake macOS tools, never a real VM or host library."""
import hashlib
import io
import os
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]

class MacInstallerTests(unittest.TestCase):
    def install(self, *, corrupt=False, running=False, traversal=False):
        temporary = tempfile.TemporaryDirectory(prefix='pain mac installer ')
        self.addCleanup(temporary.cleanup)
        base = Path(temporary.name)
        tools = base / 'tools'; tools.mkdir()
        scripts = {
            'uname': 'if [ "$1" = -s ]; then echo Darwin; else echo arm64; fi',
            'codesign': 'exit 0',
            'podman': 'echo running' if running else 'exit 1',
        }
        for name, script in scripts.items():
            path = tools / name; path.write_text('#!/bin/sh\n' + script + '\n'); path.chmod(0o755)
        archive = base / 'runtime.tar.gz'
        files = {'bin/krunkit':b'#!/bin/sh\n', 'libexec/krunkit.real':b'fake',
                 'lib/libvirglrenderer.1.dylib':b'fake', 'lib/libggml-metal.dylib':b'fake',
                 'lib/libggml-virtgpu-backend.dylib':b'fake',
                 'llama-revision':(ROOT/'containers/virtgpu/llama-revision').read_bytes(),
                 'virgl-revision':(ROOT/'integrations/macos/virgl-revision').read_bytes()}
        if traversal: files['../escaped']=b'bad'
        with tarfile.open(archive,'w:gz') as tar:
            for name, contents in files.items():
                info=tarfile.TarInfo('macos-runtime/'+name);info.size=len(contents);info.mode=0o755
                tar.addfile(info,io.BytesIO(contents))
        digest=hashlib.sha256(archive.read_bytes()).hexdigest()
        Path(str(archive)+'.sha256').write_text(('0'*64 if corrupt else digest)+'  runtime.tar.gz\n')
        data=base/'Application Support/PAIN'
        env=dict(os.environ, PATH=str(tools)+os.pathsep+os.environ['PATH'], PAIN_DATA_DIR=str(data))
        result=subprocess.run([str(ROOT/'integrations/macos/install-runtime'),str(archive)],env=env,text=True,capture_output=True)
        return result,data,base

    def test_installs_private_runtime_with_spaces_in_path(self):
        result,data,_=self.install()
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertTrue((data/'runtime/current').is_symlink())
        self.assertTrue((data/'runtime/current/lib/libggml-metal.dylib').is_file())

    def test_bad_checksum_does_not_activate_runtime(self):
        result,data,_=self.install(corrupt=True)
        self.assertNotEqual(result.returncode,0)
        self.assertIn('checksum mismatch',result.stderr)
        self.assertFalse((data/'runtime/current').exists())

    def test_running_vm_is_not_modified(self):
        result,data,_=self.install(running=True)
        self.assertNotEqual(result.returncode,0)
        self.assertIn('Stop the dedicated',result.stderr)
        self.assertFalse((data/'runtime/current').exists())

    def test_archive_cannot_escape_runtime_directory(self):
        result,data,base=self.install(traversal=True)
        self.assertNotEqual(result.returncode,0)
        self.assertFalse((data/'runtime/current').exists())
        self.assertFalse((base/'escaped').exists())
