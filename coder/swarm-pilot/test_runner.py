import tempfile
from pathlib import Path
import threading
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from runner import Runner
from runtime import Session

class RunnerTests(unittest.TestCase):
    def test_duplicate_worker_request_executes_once(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);(root/'src').mkdir();(root/'src/a').write_text('a')
            r=Runner.__new__(Runner);r.s=Session.create(root/'run',root/'src');r.config={'allowed_paths':['a']}
            r.worker_locks={};r.worker_locks_guard=threading.Lock()
            started=threading.Event();calls=[]
            def agent(owner,prompt):
                calls.append(owner);started.set();time.sleep(.1)
            r.agent=agent
            request={'owner':'conductor','name':'delegate','arguments':{'owner':'one','paths':['a'],'instruction':'work'}}
            with ThreadPoolExecutor(max_workers=2) as pool:
                first=pool.submit(r.tool,request);started.wait(2);second=pool.submit(r.tool,request)
                first.result();second.result()
            self.assertEqual(calls,['one'])

    def test_sdk_mounts_never_include_judge_or_reference_directory(self):
        from unittest.mock import patch,MagicMock
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);(root/'src').mkdir()
            r=Runner.__new__(Runner);r.s=Session.create(root/'run',root/'src')
            r.arm='deepagents';r.processes=set()
            r.config={'model':'frozen','environments':{'deepagents':str(root)}}
            r.gateway=MagicMock(url='http://127.0.0.1:1',token='temporary')
            process=MagicMock(pid=123,returncode=0)
            process.communicate.return_value=('','');process.poll.return_value=0
            with patch('runner.subprocess.Popen',return_value=process) as launch:
                r.agent('conductor','test')
            argv=launch.call_args.args[0]
            from runner import HERE
            self.assertNotIn(str(HERE),argv)
            self.assertIn(str(HERE/'adapters.py'),argv)
            self.assertNotIn(str(HERE/'judge.py'),argv)
            self.assertNotIn(str(HERE/'controls.py'),argv)

    def test_sandbox_lifecycle_error_cancels_authority(self):
        import subprocess
        from unittest.mock import patch
        from runtime import Refused
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);(root/'src').mkdir()
            r=Runner.__new__(Runner);r.s=Session.create(root/'run',root/'src')
            r.config={'image':'pinned'};r.label='test'
            with patch('runner.Sandbox') as sandbox:
                sandbox.return_value.execute.side_effect=subprocess.TimeoutExpired('docker',15)
                with self.assertRaises(Refused):r.tool({'owner':'conductor','name':'execute','arguments':{'command':'true'}})
            self.assertTrue(r.s.status()['cancelled'])
