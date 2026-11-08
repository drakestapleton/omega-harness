"""Frozen, resumable 36-run development campaign. Never tune a running campaign."""
import argparse
import hashlib
import json
from pathlib import Path
import random
import subprocess
import sys
from controls import run as acceptance_controls
from live_controls import run as live_controls
from runner import run,digest
from pilot import matrix,select
from runtime import snapshot,write_json,Refused
from suite import freeze

HERE=Path(__file__).resolve().parent

def code_hash():
    return hashlib.sha256(b''.join(p.name.encode()+p.read_bytes() for p in sorted(p for p in HERE.iterdir() if p.suffix in ('.py','.ts')))).hexdigest()


def campaign(toolchain,repository,output):
    output=Path(output)
    if not output.exists():
        output.mkdir(mode=0o700)
        freeze(repository,output/'frozen')
        order=matrix(['bug','feature','omega','parallel','conflict','recovery'])
        random.Random(498).shuffle(order)
        subprocess.run([sys.executable,'-m','unittest','discover','-s',str(HERE),'-p','test_*.py'],check=True)
        live_controls(toolchain,output/'live-controls.json')
        acceptance_controls(output/'frozen',output/'acceptance-controls',toolchain['image'],toolchain['compiler'])
        qualification=dict(unit_checks=True,live=json.loads((output/'live-controls.json').read_text()),
            acceptance=json.loads((output/'acceptance-controls'/'controls.json').read_text()),code_sha256=code_hash())
        write_json(output/'qualification.json',qualification)
        write_json(output/'campaign.json',dict(toolchain=toolchain,code_sha256=code_hash(),order=order,
            qualification_sha256=digest(qualification),judge_sha256=hashlib.sha256((HERE/'judge.py').read_bytes()).hexdigest()))
    pin=json.loads((output/'campaign.json').read_text())
    if pin['toolchain']!=toolchain or pin['code_sha256']!=code_hash():raise Refused('campaign implementation/configuration changed')
    (output/'runs').mkdir(exist_ok=True)
    rows=[]
    for item in pin['order']:
        if pin['code_sha256']!=code_hash():raise Refused('implementation changed during campaign')
        task_root=output/'frozen'/item['task'];task=json.loads((task_root/'task.json').read_text())
        if hashlib.sha256(json.dumps(snapshot(task_root/'source'),sort_keys=True).encode()).hexdigest()!=task['source_sha256']:
            raise Refused('frozen source changed')
        config={**toolchain,**item,'qualification_sha256':pin['qualification_sha256'],'judge_sha256':pin['judge_sha256'],
                'source_sha256':task['source_sha256'],'allowed_paths':task['paths'],'prompt':task['prompt']}
        row=run(config,output/'runs'/item['id'],task_root/'source')
        rows.append(row)
        write_json(output/'results.json',rows)
        print(json.dumps(dict(completed=len(rows),total=36,id=item['id'],accepted=row['accepted'],tokens=row['tokens'],error=row['error'])),flush=True)
    selection=select(rows);write_json(output/'selection.json',selection)
    print(json.dumps(selection),flush=True)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('toolchain',type=Path);p.add_argument('repository',type=Path);p.add_argument('output',type=Path)
    a=p.parse_args();campaign(json.loads(a.toolchain.read_text()),a.repository,a.output)
