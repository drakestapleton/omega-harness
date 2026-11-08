import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from types import SimpleNamespace
from gateway import Gateway
from runtime import Session,Refused

class GatewayTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        root=Path(self.tmp.name);(root/'src').mkdir()
        self.s=Session.create(root/'run',root/'src')
        self.g=Gateway(self.s,'frozen-model');self.addCleanup(self.g.close)
    def test_refuses_model_substitution_before_transport(self):
        with patch('gateway.subprocess.run') as run:
            with self.assertRaises(Refused):self.g.complete({'model':'other'})
            run.assert_not_called()
    def test_missing_usage_keeps_reserved_budget(self):
        p=SimpleNamespace(returncode=0,stdout='{"id":1,"status":200,"body":{}}\n')
        with patch.object(self.g,'provider_call',return_value=p):
            with self.assertRaises(Refused):self.g.complete({'model':'frozen-model'})
        self.assertGreater(self.s.status()['reserved'],0)
    def test_usage_charged_and_trace_excludes_gateway_token(self):
        p=SimpleNamespace(returncode=0,stdout='{"id":1,"status":200,"body":{"usage":{"total_tokens":10}}}\n')
        with patch.object(self.g,'provider_call',return_value=p):self.g.complete({'model':'frozen-model'})
        self.assertEqual(self.s.status()['tokens'],10)
        self.assertNotIn(self.g.token,(self.s.root/'trace.jsonl').read_text())

    def test_cancellation_kills_and_reconciles_provider_process(self):
        import subprocess,sys,time
        from concurrent.futures import ThreadPoolExecutor
        original=subprocess.Popen
        children=[]
        def fake(*args,**kwargs):
            p=original([sys.executable,'-c','import time; time.sleep(20)'],**kwargs)
            children.append(p);return p
        with patch('gateway.subprocess.Popen',side_effect=fake):
            with ThreadPoolExecutor(max_workers=1) as pool:
                future=pool.submit(self.g.provider_call,{},30)
                deadline=time.time()+2
                while not children and time.time()<deadline:time.sleep(.01)
                self.s.cancel()
                with self.assertRaises(Refused):future.result(timeout=3)
        self.assertTrue(children)
        self.assertIsNotNone(children[0].poll())
        self.assertFalse(self.g.providers)
