#!/bin/sh
# Real process-exit control. Uses only a new disposable session, never a live task.
set -eu
export PYTHONPATH="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)${PYTHONPATH:+:$PYTHONPATH}"
case "$1" in /*) task_output="$1" ;; *) task_output="$(pwd)/$1" ;; esac
cd "$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)"
python3 - "$task_output" <<'PY' 
import json,os,pathlib,subprocess,sys
from runtime import Session,Refused,write_json
root=pathlib.Path(sys.argv[1]);root.mkdir(mode=0o700)
source=root/'source';source.mkdir();(source/'file.txt').write_text('original')
s=Session.create(root/'run',source);worker=s.spawn('worker',['file.txt'],request_key='fixed-request')
(worker/'file.txt').write_text('changed')
code='''
import inspect,os,sys
from runtime import Session
s=Session(sys.argv[1])
lines,start=inspect.getsourcelines(Session.integrate)
cut=start+next(i for i,line in enumerate(lines) if "s['current'] = version" in line)
def crash(frame,event,arg):
    if event=='line' and frame.f_code.co_name=='integrate' and frame.f_lineno==cut:os._exit(77)
    return crash
sys.settrace(crash)
s.integrate('worker')
'''
p=subprocess.run([sys.executable,'-c',code,str(root/'run')])
assert p.returncode==77
restored=Session(root/'run')
assert (restored.current/'file.txt').read_text()=='original'
assert restored.status()['workers']['worker']['request_key']=='fixed-request'
restored.integrate('worker');version=restored.status()['current']
assert (restored.current/'file.txt').read_text()=='changed'
Session(root/'run').integrate('worker')
assert restored.status()['current']==version
assert (root/'run/trees/initial/file.txt').read_text()=='original'
restored.cancel()
try:Session(root/'run').reserve(1)
except Refused:pass
else:raise AssertionError('cancel did not survive process restart')
report=dict(abrupt_exit_before_commit=True,atomic_rollback=True,recovered_integration=True,
    idempotent_integration=True,original_snapshot_unchanged=True,cancellation_persistent=True)
write_json(root/'receipt.json',report);print(json.dumps(report,indent=2))
PY
