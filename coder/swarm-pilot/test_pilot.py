import unittest
from pilot import Claims, matrix, select
from sandbox import Sandbox, _capture_process
from unittest.mock import patch
import tempfile
import subprocess
import sys

REAL_POPEN = subprocess.Popen

class PilotTests(unittest.TestCase):
    def test_matrix_is_36_unique_runs(self):
        rows = matrix(['bug', 'feature', 'omega', 'parallel', 'conflict', 'recovery'])
        self.assertEqual(len(rows), 36)
        self.assertEqual(len({r['id'] for r in rows}), 36)

    def test_parent_child_claims_conflict(self):
        c = Claims()
        c.acquire('a', ['src'])
        with self.assertRaises(ValueError): c.acquire('b', ['src/main.rs'])
        c.acquire('b', ['docs'])
        c.release('a')
        c.acquire('c', ['src/main.rs'])

    def test_traversal_and_duplicate_claim_rejected(self):
        for path in ['../secret', '/etc', '.', 'src/../secret']:
            with self.assertRaises(ValueError): Claims().acquire('a', [path])
        c = Claims(); c.acquire('a', ['src'])
        with self.assertRaises(ValueError): c.acquire('a', ['docs'])

    def test_sandbox_timeout_kills_container(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch('sandbox.subprocess.Popen') as popen, patch('sandbox.subprocess.run') as run:
                process = REAL_POPEN([sys.executable, '-c', 'import time; time.sleep(10)'], stdout=subprocess.PIPE)
                popen.return_value = process
                result = Sandbox(directory, 'test@sha256:' + 'a'*64).execute('sleep 10', 1)
                self.assertEqual(result['exit_code'], 124)
                command = popen.call_args.args[0]
                self.assertIn('--network=none', command)
                self.assertIn('--read-only', command)
                self.assertIn('--cap-drop=ALL', command)
                self.assertEqual(run.call_args.args[0][:3], ['docker', 'rm', '-f'])
                self.assertIsNotNone(process.returncode)

    def test_sandbox_refuses_noisy_subprocess_and_keeps_bounded_tail(self):
        process = REAL_POPEN(
            [sys.executable, '-c', "import sys; sys.stdout.write('x' * 20000); sys.stdout.flush()"],
            stdout=subprocess.PIPE,
        )
        result = _capture_process(process, 5)
        self.assertEqual(result[0], 125)
        self.assertEqual(result[1], 'sandbox refused: output exceeded 16000 bytes')
        self.assertLessEqual(len(result[1].encode()), 16000)

    def test_sandbox_cleanup_failure_is_not_reported_as_success(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch('sandbox.subprocess.Popen') as popen, patch('sandbox.subprocess.run') as run:
                process = REAL_POPEN([sys.executable, '-c', 'print("ok")'], stdout=subprocess.PIPE)
                popen.return_value = process
                run.side_effect = subprocess.TimeoutExpired('docker', 15)
                with self.assertRaises(subprocess.TimeoutExpired):
                    Sandbox(directory, 'test@sha256:' + 'a'*64).execute('echo ok', 5)

    def test_missing_evidence_never_qualifies(self):
        self.assertEqual(select([])['winner'], 'baseline')

    def test_gate_failure_disqualifies_better_completion(self):
        rows = []
        for arm, accepted in [('baseline', 8), ('deepagents', 10), ('openhands', 7)]:
            for i in range(12):
                rows.append(dict(model='frozen',image='pinned',qualification_sha256='qualified',judge_sha256='judge',source_sha256='source',arm=arm, task=f'task-{i//2}', repeat=i%2+1, id=f'{arm}-{i}', accepted=i < accepted,
                    gates_passed=arm != 'deepagents', cost=1, seconds=5))
        self.assertEqual(select(rows)['winner'], 'baseline')

    def test_improvement_qualifies_only_complete_matrix(self):
        rows = []
        for arm, accepted in [('baseline', 8), ('deepagents', 10), ('openhands', 7)]:
            for i in range(12):
                rows.append(dict(model='frozen',image='pinned',qualification_sha256='qualified',judge_sha256='judge',source_sha256='source',arm=arm, task=f'task-{i//2}', repeat=i%2+1, id=f'{arm}-{i}', accepted=i < accepted,
                    gates_passed=True, cost=None, seconds=5))
        self.assertEqual(select(rows)['winner'], 'deepagents')
        self.assertEqual(select(rows[:-1])['winner'], 'baseline')

if __name__ == '__main__': unittest.main()
