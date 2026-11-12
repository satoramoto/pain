import os
from pathlib import Path
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1]/'scripts/ci/macos-signing.sh'
SECRETS = ('MACOS_CERTIFICATE', 'MACOS_CERTIFICATE_PASSWORD', 'APPLE_API_KEY_P8', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER')

class SigningGuardTests(unittest.TestCase):
    def prepare(self, required=False, partial=False):
        with tempfile.TemporaryDirectory() as directory:
            env = dict(os.environ, **{name:'' for name in SECRETS}, RUNNER_TEMP=directory,
                       GITHUB_OUTPUT=directory+'/output', GITHUB_ENV=directory+'/env',
                       REQUIRE_SIGNING=str(required).lower())
            if partial: env['APPLE_API_KEY_ID'] = 'test-id'
            result = subprocess.run(['bash',str(SCRIPT),'prepare'], env=env, text=True, capture_output=True)
            output = Path(directory+'/output')
            return result, output.read_text() if output.exists() else ''

    def test_unconfigured_push_is_explicitly_unsigned(self):
        result, output = self.prepare()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(output, 'signed=false\n')
        self.assertIn('UNSIGNED QA', result.stdout)

    def test_requested_signed_build_never_silently_falls_back(self):
        result, output = self.prepare(required=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Missing repository secret', result.stdout)
        self.assertEqual(output, '')

    def test_partial_credentials_fail_even_for_push(self):
        result, _ = self.prepare(partial=True)
        self.assertNotEqual(result.returncode, 0)
