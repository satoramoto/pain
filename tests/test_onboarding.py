"""Exercise desktop setup boundaries without installing host software."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]

class OnboardingTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='pain onboarding ')
        self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name)
        self.bin = self.base / 'tools'; self.bin.mkdir()
        self.scripts = self.base/'project/integrations/macos'
        self.scripts.mkdir(parents=True)
        for name in ('onboarding', 'ai'):
            source = (ROOT/'integrations/macos'/name).read_text()
            source = source.replace('/Applications/Docker.app/Contents/Resources/bin:', '')
            target = self.scripts/name; target.write_text(source); target.chmod(0o755)
        (self.scripts/'common.sh').write_text('pain_data="$PAIN_DATA_DIR"\npain_runtime="$pain_data/runtime/current"\n')
        self.log = self.base / 'calls'
        self.env = dict(os.environ, HOME=str(self.base), PAIN_DATA_DIR=str(self.base/'Application Support/PAIN'), PATH=str(self.bin)+':/usr/bin:/bin', CALLS=str(self.log))
        self.fake('uname', 'if [ "$1" = -s ]; then echo Darwin; else echo arm64; fi')
        self.fake('curl', 'echo unexpected-download >> "$CALLS"; exit 91')

    def fake(self, name, body):
        path = self.bin/name
        path.write_text('#!/bin/sh\n'+body+'\n'); path.chmod(0o755)

    def run_step(self, step, framework='podman'):
        return subprocess.run([str(self.scripts/'onboarding'), step, framework], env=self.env, capture_output=True, text=True)

    def test_reuses_existing_podman_without_downloading(self):
        self.fake('podman', 'echo podman-version')
        result = self.run_step('dependencies')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('podman-version', result.stdout)
        self.assertFalse(self.log.exists())

    def test_reuses_existing_opencode_without_touching_config(self):
        self.fake('opencode', 'echo 2.0.0')
        config = self.base/'.config/opencode/opencode.jsonc'
        config.parent.mkdir(parents=True); config.write_text('// keep my settings\n{}')
        result = self.run_step('opencode')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(config.read_text(), '// keep my settings\n{}')
        self.assertFalse(self.log.exists())

    def test_unknown_framework_is_rejected(self):
        result = self.run_step('dependencies', 'docker; touch bad')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Unknown container framework', result.stderr)

    def test_failed_download_does_not_run_installer(self):
        # No podman in this isolated PATH on CI; exercise fetch using OpenCode instead.
        result = self.run_step('opencode')
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((Path(self.env['PAIN_DATA_DIR'])/'bin/opencode').exists())

    def test_docker_controller_uses_explicit_context_and_remote_host(self):
        self.fake('docker', 'printf "%s\\n" "$*" >> "$CALLS"')
        result = subprocess.run([str(self.scripts/'ai'), 'logs', '--once'], env=dict(self.env, PAIN_RUNTIME='docker'), text=True, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        calls = self.log.read_text()
        self.assertIn('--context desktop-linux run', calls)
        self.assertIn('PAIN_API_HOST=host.docker.internal', calls)
        self.assertNotIn('/dev/dri', calls)
