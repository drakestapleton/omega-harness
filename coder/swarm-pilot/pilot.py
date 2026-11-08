"""Experimental pilot control plane. No benchmark results are synthesized."""
import argparse
import json
import math
from pathlib import PurePosixPath, Path

ARMS = ('baseline', 'deepagents', 'openhands')

class Claims:
    def __init__(self):
        self.owners = {}

    def acquire(self, owner, paths):
        if not owner or owner in self.owners or not paths:
            raise ValueError('owner must be new and paths nonempty')
        checked = []
        for value in paths:
            p = PurePosixPath(value)
            if p.is_absolute() or '..' in p.parts or str(p) == '.':
                raise ValueError('claims must be relative paths without traversal')
            for existing in [*checked, *(q for ps in self.owners.values() for q in ps)]:
                if p == existing or p in existing.parents or existing in p.parents:
                    raise ValueError('overlapping ownership claim')
            checked.append(p)
        self.owners[owner] = checked

    def release(self, owner):
        del self.owners[owner]


def matrix(tasks):
    if len(tasks) != 6 or len(set(tasks)) != 6:
        raise ValueError('six distinct frozen tasks required')
    return [dict(id=f'{task}-{repeat}-{arm}', task=task, repeat=repeat, arm=arm,
                 seconds_limit=1200, token_limit=30000, max_workers=3)
            for task in tasks for repeat in (1, 2) for arm in ARMS]


def select(rows):
    summary = {}
    ids = [r['id'] for r in rows]
    if len(rows) != 36 or len(set(ids)) != 36:
        return dict(winner='baseline', reason='incomplete or duplicate evidence')
    if not all('task' in r and 'repeat' in r for r in rows):
        return dict(winner='baseline',reason='missing task/repetition evidence')
    if rows:
        tasks={r.get('task') for r in rows}
        expected={(t,n,a) for t in tasks for n in (1,2) for a in ARMS}
        actual={(r.get('task'),r.get('repeat'),r.get('arm')) for r in rows}
        if len(tasks)!=6 or actual!=expected:
            return dict(winner='baseline',reason='task/repetition pairs do not match')
    for key in ('model','image','qualification_sha256','judge_sha256'):
        values={r.get(key) for r in rows}
        if len(values)!=1 or not next(iter(values)):
            return dict(winner='baseline',reason='missing or mixed '+key)
    for task in tasks:
        if len({r.get('source_sha256') for r in rows if r['task']==task})!=1 or any(not r.get('source_sha256') for r in rows if r['task']==task):
            return dict(winner='baseline',reason='missing or mixed task source')
    for arm in ARMS:
        group = [r for r in rows if r['arm'] == arm]
        if len(group) != 12:
            return dict(winner='baseline', reason='unbalanced evidence')
        for r in group:
            if type(r.get('accepted')) is not bool or type(r.get('gates_passed')) is not bool:
                raise ValueError('acceptance and gates require explicit booleans')
            for key in ('seconds', 'cost'):
                v = r.get(key)
                if v is None and key == 'cost': continue
                if type(v) not in (int, float) or not math.isfinite(v) or v < 0:
                    raise ValueError('invalid measurement')
        accepted = sum(r['accepted'] for r in group)
        cost = None if any(r.get('cost') is None for r in group) or not accepted else sum(r['cost'] for r in group)/accepted
        summary[arm] = dict(accepted=accepted, cost_per_accepted=cost,
                            seconds=sum(r['seconds'] for r in group),
                            gates=all(r['gates_passed'] for r in group))
    base = summary['baseline']
    qualified = []
    for arm in ARMS[1:]:
        s = summary[arm]
        cheaper = (s['accepted'] == base['accepted'] and s['accepted'] > 0
                   and s['cost_per_accepted'] is not None
                   and base['cost_per_accepted'] is not None
                   and base['cost_per_accepted'] > 0
                   and s['cost_per_accepted'] <= .8 * base['cost_per_accepted'])
        if s['gates'] and (s['accepted'] >= base['accepted'] + 2 or cheaper):
            qualified.append(arm)
    qualified.sort(key=lambda a: (-summary[a]['accepted'],
        summary[a]['cost_per_accepted'] if summary[a]['cost_per_accepted'] is not None else float('inf'),
        summary[a]['seconds'], a))
    return dict(winner=qualified[0] if qualified else 'baseline', summary=summary,
                reason='pilot selection only; not a general performance claim')


def main():
    p = argparse.ArgumentParser()
    p.add_argument('command', choices=['matrix', 'select'])
    p.add_argument('input', type=Path)
    a = p.parse_args()
    data = json.loads(a.input.read_text())
    print(json.dumps(matrix(data) if a.command == 'matrix' else select(data), indent=2))

if __name__ == '__main__': main()
