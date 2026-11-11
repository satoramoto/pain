"""Exercise lab command assembly without Docker: mounts, env, and provenance."""
import argparse
import importlib.machinery
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

loader = importlib.machinery.SourceFileLoader('pain', str(Path(__file__).resolve().parents[1] / 'ai'))
spec = importlib.util.spec_from_loader(loader.name, loader)
pain = importlib.util.module_from_spec(spec)
loader.exec_module(pain)


def lab_namespace(command, code=None, threads=None, seed=None, cmd=None):
    return argparse.Namespace(lab_command=command, code=code, threads=threads,
                              seed=seed, cmd=cmd or [])


class LabRunArgsTest(unittest.TestCase):
    def test_run_argv_mounts_env_and_command(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            code = root / 'code'
            code.mkdir()
            with patch.object(pain, 'ROOT', root), \
                 patch.object(pain, 'config', return_value={
                     'PAIN_LAB_EXPERIMENTS': str(root / 'experiments'),
                     'PAIN_LAB_THREADS': '8', 'PAIN_LAB_SEED': '0'}), \
                 patch.object(pain, 'lab_image_id', return_value='sha256:testlab'), \
                 patch.object(pain, 'code_git', return_value=None):
                argv, record = pain.lab_run_args(
                    lab_namespace('run', code=str(code), cmd=['python', 'train.py', '--alpha', '1']))
            joined = ' '.join(argv)
            self.assertIn(f'-v {code}:/workspace/code', joined)
            self.assertIn(f'-v {root / "experiments"}:/workspace/experiments', joined)
            self.assertIn('-v pain-lab-data:/data', joined)
            self.assertIn('-e PYTHONHASHSEED=0', joined)
            self.assertIn('-e OMP_NUM_THREADS=8', joined)
            self.assertIn('-e MKL_NUM_THREADS=8', joined)
            self.assertIn('-e SEED=0', joined)
            self.assertEqual(argv[-4:], ['python', 'train.py', '--alpha', '1'])
            self.assertEqual(record['image_id'], 'sha256:testlab')
            self.assertEqual(record['threads'], '8')
            self.assertEqual(record['seed'], '0')

    def test_code_resolves_from_env(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            code = root / 'envcode'
            code.mkdir()
            with patch.object(pain, 'ROOT', root), \
                 patch.object(pain, 'config', return_value={
                     'PAIN_LAB_CODE': str(code),
                     'PAIN_LAB_EXPERIMENTS': str(root / 'experiments')}), \
                 patch.object(pain, 'lab_image_id', return_value='sha256:testlab'), \
                 patch.object(pain, 'code_git', return_value=None):
                argv, record = pain.lab_run_args(lab_namespace('run', cmd=['echo', 'hi']))
            self.assertIn(f'-v {code}:/workspace/code', ' '.join(argv))
            self.assertEqual(record['code_dir'], str(code))

    def test_run_requires_code_and_command(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with patch.object(pain, 'ROOT', root), \
                 patch.object(pain, 'config', return_value={}), \
                 patch.object(pain, 'lab_image_id', return_value='sha256:testlab'):
                with self.assertRaises(ValueError):
                    pain.lab_run_args(lab_namespace('run', cmd=['python', 'x.py']))
            with patch.object(pain, 'ROOT', root), \
                 patch.object(pain, 'config', return_value={'PAIN_LAB_CODE': '/tmp'}), \
                 patch.object(pain, 'lab_image_id', return_value='sha256:testlab'):
                with self.assertRaises(ValueError):
                    pain.lab_run_args(lab_namespace('run', code='/tmp'))

    def test_shell_argv_has_tty_and_no_seed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            code = root / 'code'
            code.mkdir()
            with patch.object(pain, 'ROOT', root), \
                 patch.object(pain, 'config', return_value={}), \
                 patch.object(pain, 'lab_image_id', return_value='sha256:testlab'), \
                 patch.object(pain, 'code_git', return_value=None):
                argv, record = pain.lab_run_args(lab_namespace('shell', code=str(code)), shell=True)
            joined = ' '.join(argv)
            self.assertIn('-it --entrypoint bash pain-lab', joined)
            self.assertEqual(record['threads'], '8')


class LabDispatchTest(unittest.TestCase):
    def test_build_assembles_docker_build(self):
        calls = []
        with patch.object(pain, 'ROOT', Path('/tmp/pain')), \
             patch.object(pain.subprocess, 'run', side_effect=lambda *a, **k: calls.append(a[0])), \
             patch.object(pain, 'lab_image_id', return_value='sha256:testlab'):
            pain.lab(argparse.Namespace(lab_command='build'))
        self.assertEqual(calls[0][:3], ['docker', 'build', '-t'])
        self.assertIn('lab/Dockerfile', calls[0][5])

    def test_run_writes_provenance_row(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            code = root / 'code'
            code.mkdir()
            completed = type('Completed', (), {'returncode': 0})()
            with patch.object(pain, 'ROOT', root), \
                 patch.object(pain, 'config', return_value={}), \
                 patch.object(pain, 'lab_image_id', return_value='sha256:testlab'), \
                 patch.object(pain, 'code_git', return_value=None), \
                 patch.object(pain.subprocess, 'run', return_value=completed):
                pain.lab(lab_namespace('run', code=str(code), cmd=['python', 'train.py']))
            rows = [json.loads(line) for line in (root / 'experiments' / 'lab_runs.jsonl').read_text().splitlines()]
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0]['exit_code'], 0)
            self.assertEqual(rows[0]['image_id'], 'sha256:testlab')
            self.assertEqual(rows[0]['command'][-2:], ['python', 'train.py'])

    def test_ps_lists_running_containers(self):
        completed = type('Completed', (), {'stdout': 'abc123\t2 minutes\tpython train.py\n'})()
        with patch.object(pain.subprocess, 'run', return_value=completed) as run:
            pain.lab(argparse.Namespace(lab_command='ps'))
        args = run.call_args[0][0]
        self.assertEqual(args[:4], ['docker', 'ps', '--filter', 'ancestor=pain-lab'])

    def test_failed_run_records_and_raises(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            code = root / 'code'
            code.mkdir()
            completed = type('Completed', (), {'returncode': 3})()
            with patch.object(pain, 'ROOT', root), \
                 patch.object(pain, 'config', return_value={}), \
                 patch.object(pain, 'lab_image_id', return_value='sha256:testlab'), \
                 patch.object(pain, 'code_git', return_value=None), \
                 patch.object(pain.subprocess, 'run', return_value=completed):
                with self.assertRaises(ValueError):
                    pain.lab(lab_namespace('run', code=str(code), cmd=['python', 'bad.py']))
            rows = [json.loads(line) for line in (root / 'experiments' / 'lab_runs.jsonl').read_text().splitlines()]
            self.assertEqual(rows[0]['exit_code'], 3)


if __name__ == '__main__':
    unittest.main()
