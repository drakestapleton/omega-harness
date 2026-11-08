import unittest
from pilot import Claims, matrix, select
from sandbox import Sandbox
from unittest.mock import patch
import tempfile
import subprocess

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
            with patch('sandbox.subprocess.run') as run:
                run.side_effect = [subprocess.TimeoutExpired('docker', 1), None]
                result = Sandbox(directory, 'test@sha256:' + 'a'*64).execute('sleep 10', 1)
                self.assertEqual(result['exit_code'], 124)
                command = run.call_args_list[0].args[0]
                self.assertIn('--network=none', command)
                self.assertIn('--read-only', command)
                self.assertIn('--cap-drop=ALL', command)
                self.assertEqual(run.call_args_list[1].args[0][:3], ['docker', 'rm', '-f'])

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
