"""Freeze public development tasks from an exact repository commit, outside agent trees."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
from runtime import write_json,snapshot

BASE='f5aa51d'
TASKS=[
 dict(id='bug',paths=['pilot.py'],prompt='Fix matrix(tasks): refuse non-string task IDs and IDs containing slash, backslash, whitespace, or traversal. IDs must match [A-Za-z0-9_-]+. Preserve six unique tasks and existing 36-run behavior.'),
 dict(id='feature',paths=['pilot.py'],prompt='Add Claims.release_all(): remove all owners atomically. Return a sorted list of released owner names. Calling on an empty Claims returns []. Existing acquire/release behavior stays unchanged.'),
 dict(id='omega',paths=['program.om'],prompt='Write program.om in seeded Omega: sum integers 1 through 10 in a bounded loop and return the sum as the process exit status. No output. Use only the supplied public syntax reference. Compile with omc < program.om > /tmp/program, chmod +x /tmp/program, and run /tmp/program; expected exit is 55.'),
 dict(id='parallel',paths=['pilot.py','sandbox.py'],prompt='Use distinct workers for independent changes. In pilot.py add Claims.release_all() returning a sorted list of released owners and clearing claims. In sandbox.py add a module function valid_image(value) returning True only for a nonempty repository followed by @sha256: and exactly 64 lowercase hexadecimal characters, with no whitespace or commas. It must return False for nonstrings. Preserve Sandbox constructor digest validation.'),
 dict(id='conflict',paths=['pilot.py'],prompt='Add Claims.acquire_many(entries), where entries is a mapping of owner names to path lists. Acquire every entry using existing overlap rules, or leave all original ownership unchanged if any entry fails. Reject owners already claimed. Return None. Implement transactionally, including parent/child path conflicts. Use one exclusive worker for pilot.py; conflicting workers must be refused.'),
 dict(id='recovery',paths=['pilot.py'],prompt='Add Claims.to_json() returning a JSON string of owner->list of relative path strings; add @classmethod Claims.from_json(text) returning a new Claims with all owners restored through acquire validation. Reject malformed roots and overlapping or invalid paths. Preserve existing claims when serialization is called. This is for durable recovery across a restarted process.')]

def freeze(repo,out):
    out=Path(out);out.mkdir(mode=0o700)
    sha=subprocess.check_output(['git','-C',str(repo),'rev-parse',BASE],text=True).strip()
    for task in TASKS:
        root=out/task['id'];source=root/'source';source.mkdir(parents=True)
        for name in ['pilot.py','sandbox.py']:
            data=subprocess.check_output(['git','-C',str(repo),'show',sha+':coder/swarm-pilot/'+name])
            (source/name).write_bytes(data)
        if task['id']=='omega':
            # Existing public compiler guide, not the coder/eval held-out task corpus.
            reference=subprocess.check_output(['git','-C',str(repo),'show',sha+':examples/hello.om']).decode()
            reference+='\nLoop reference:\nfn main to int\ni = int 0\nwhile lt i 3 bound 3\ni = add i 1\nend\nret i\nend\n'
            (source/'OMEGA.md').write_text(reference)
        write_json(root/'task.json',{**task,'base_commit':sha,'source_sha256':hashlib.sha256(json.dumps(snapshot(source),sort_keys=True).encode()).hexdigest()})
    write_json(out/'manifest.json',{'base_commit':sha,'tasks':TASKS,'profile':'public authored development tasks; not an unseen general benchmark'})

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('repository',type=Path);p.add_argument('output',type=Path)
    a=p.parse_args();freeze(a.repository,a.output)
