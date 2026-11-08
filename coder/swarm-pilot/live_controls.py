"""Exercise real Docker boundaries. These are qualification checks, not performance scores."""
import argparse
import hashlib
import json
from pathlib import Path
import tempfile
import shlex
from sandbox import Sandbox
from runtime import write_json

def run(config,output):
    with tempfile.TemporaryDirectory(prefix='pilot-controls-') as directory:
        root=Path(directory);(root/'owned.txt').write_text('original')
        ro=Sandbox(root,config['image'],writable=[])
        checks={
            'conductor_write_refused':ro.execute('echo bad > /work/owned.txt')['exit_code']!=0,
            'judge_not_visible_during_generation':ro.execute('test ! -e /judge.py')['exit_code']==0,
            'credential_store_not_visible':ro.execute('test ! -e '+shlex.quote(str(Path.home()/'.omp'/'agent'/'agent.db')))['exit_code']==0,
            'offline_command_network':ro.execute("python -c 'import socket; s=socket.socket(); s.settimeout(1); s.connect((\"1.1.1.1\",443))'")['exit_code']!=0,
            'timed_out_command_stopped':ro.execute('sleep 20',seconds=1)['exit_code']==124,
        }
        rw=Sandbox(root,config['image'],writable=['owned.txt'])
        checks['claimed_write_works']=rw.execute('printf changed > owned.txt')['exit_code']==0 and (root/'owned.txt').read_text()=='changed'
        checks['unclaimed_write_refused']=rw.execute('printf bad > outside.txt')['exit_code']!=0
        code_hash=hashlib.sha256(b''.join(p.read_bytes() for p in sorted(Path(__file__).parent.glob('*.py')))).hexdigest()
        report=dict(checks=checks,passed=all(checks.values()),source_sha256=code_hash)
        write_json(Path(output),report);print(json.dumps(report,indent=2))
        if not report['passed']:raise SystemExit(1)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('config',type=Path);p.add_argument('output',type=Path)
    a=p.parse_args();run(json.loads(a.config.read_text()),a.output)
