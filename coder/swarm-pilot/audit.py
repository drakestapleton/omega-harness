"""Reconcile all recorded evidence before issuing a pilot selection."""
import json
from pathlib import Path
import sys
from runner import digest
from runtime import snapshot,Session,Refused
from pilot import select


def audit(root):
    root=Path(root);pin=json.loads((root/'campaign.json').read_text());rows=[]
    qualification=json.loads((root/'qualification.json').read_text())
    if digest(qualification)!=pin['qualification_sha256'] or not qualification['unit_checks'] or not qualification['live']['passed'] or not all(r['passed'] for r in qualification['acceptance']):
        raise Refused('qualification evidence missing')
    if qualification['code_sha256']!=pin['code_sha256']:raise Refused('qualification code mismatch')
    for item in pin['order']:
        run=root/'runs'/item['id']
        row=json.loads((run/'result.json').read_text());config=json.loads((run/'config.json').read_text())
        if row['id']!=item['id'] or row['config_sha256']!=digest(config):raise Refused('configuration evidence mismatch')
        if config['model']!=pin['toolchain']['model'] or config['image']!=pin['toolchain']['image']:raise Refused('mixed model or image')
        if config['qualification_sha256']!=pin['qualification_sha256'] or config['judge_sha256']!=pin['judge_sha256']:raise Refused('mixed qualification or judge')
        source=json.loads((root/'frozen'/item['task']/'task.json').read_text())
        if config['source_sha256']!=source['source_sha256']:raise Refused('mixed task source')
        s=Session(run);state=s.status()
        trace=[json.loads(l) for l in (run/'trace.jsonl').read_text().splitlines()] if (run/'trace.jsonl').exists() else []
        if sum(r['usage'] for r in trace)!=row['tokens'] or row['tokens']!=state['tokens']:raise Refused('usage evidence mismatch')
        if row['tree_sha256']!=digest(snapshot(s.current)):raise Refused('artifact evidence mismatch')
        if row['accepted']:
            if row['judge_exit_code']!=0 or (run/'judge.stdout').read_text().strip()!='PASS '+item['task']:
                raise Refused('acceptance evidence missing')
            if row['tokens']>30000 or row['reserved_tokens'] or state['cancelled']:raise Refused('accepted run exceeds authority')
        rows.append(row)
    if len(rows)!=36:raise Refused('campaign incomplete')
    verdict=select(rows)
    print(json.dumps(dict(audited_runs=36,selection=verdict),indent=2))
    return rows,verdict

if __name__=='__main__':audit(sys.argv[1])
