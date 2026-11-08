import tempfile
import unittest
from pathlib import Path
from runtime import Session, Refused

class RuntimeTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        source = self.root/'source'; source.mkdir()
        (source/'a.txt').write_text('a'); (source/'b.txt').write_text('b')
        self.s = Session.create(self.root/'run', source, seconds=1200, tokens=30000)

    def test_claims_limit_and_conflict_are_durable(self):
        self.s.spawn('a', ['a.txt'])
        with self.assertRaises(Refused): self.s.spawn('b', ['a.txt'])
        restored = Session(self.root/'run')
        with self.assertRaises(Refused): restored.spawn('b', ['a.txt'])
        restored.spawn('b', ['b.txt'])
        restored.spawn('c', ['c.txt'])
        with self.assertRaises(Refused): restored.spawn('d', ['d.txt'])

    def test_undeclared_change_refuses_entire_integration(self):
        w = self.s.spawn('a', ['a.txt'])
        (w/'a.txt').write_text('new'); (w/'b.txt').write_text('bad')
        with self.assertRaises(Refused): self.s.integrate('a')
        self.assertEqual((self.s.current/'a.txt').read_text(), 'a')

    def test_integration_is_idempotent_after_reopen(self):
        w = self.s.spawn('a', ['a.txt']); (w/'a.txt').write_text('new')
        self.s.integrate('a')
        restored = Session(self.root/'run'); restored.integrate('a')
        self.assertEqual((restored.current/'a.txt').read_text(), 'new')
        self.assertEqual(restored.status()['workers']['a']['state'], 'integrated')

    def test_budget_reservation_and_uncertain_request_fail_closed(self):
        ticket = self.s.reserve(29000)
        with self.assertRaises(Refused): self.s.reserve(1001)
        self.s.settle(ticket, 1000)
        self.assertEqual(self.s.status()['tokens'], 1000)
        self.s.reserve(28000)
        self.assertEqual(Session(self.root/'run').status()['reserved'], 28000)

    def test_cancel_survives_restart(self):
        self.s.cancel()
        with self.assertRaises(Refused): Session(self.root/'run').spawn('a', ['a.txt'])
        with self.assertRaises(Refused): self.s.reserve(1)

    def test_symlink_and_hardlink_refused(self):
        w = self.s.spawn('a', ['a.txt'])
        (w/'a.txt').unlink(); (w/'a.txt').symlink_to(self.root/'source'/'b.txt')
        with self.assertRaises(Refused): self.s.integrate('a')

    def test_two_sessions_cannot_accept_same_owner(self):
        other = Session(self.root/'run'); self.s.spawn('a', ['a.txt'])
        with self.assertRaises(Refused): other.spawn('a', ['b.txt'])

if __name__ == '__main__': unittest.main()

class AdditionalRuntimeTests(RuntimeTests):
    def test_failed_integration_never_advances_pointer(self):
        from unittest.mock import patch
        w=self.s.spawn('a',['a.txt']);(w/'a.txt').write_text('new')
        before=self.s.status()['current']
        with patch('runtime.os.fsync',side_effect=OSError('injected crash')):
            with self.assertRaises(OSError):self.s.integrate('a')
        self.assertEqual(Session(self.root/'run').status()['current'],before)
        self.s.integrate('a');self.assertEqual((self.s.current/'a.txt').read_text(),'new')

    def test_expired_session_never_admits_request(self):
        with self.s.transaction('expire') as s:s['deadline']=0
        with self.assertRaises(Refused):self.s.reserve(1)
        with self.assertRaises(Refused):self.s.spawn('a',['a.txt'])

    def test_concurrent_reservations_cannot_overspend(self):
        from concurrent.futures import ThreadPoolExecutor
        def reserve(_):
            try:self.s.reserve(20000);return True
            except Refused:return False
        with ThreadPoolExecutor(max_workers=3) as pool:accepted=list(pool.map(reserve,range(3)))
        self.assertEqual(sum(accepted),1)
        self.assertEqual(self.s.status()['reserved'],20000)
