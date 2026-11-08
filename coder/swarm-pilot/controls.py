"""Positive/negative acceptance controls; never mount reference solutions into agents."""
import json
from pathlib import Path
import shutil
import sys
from sandbox import Sandbox
from runtime import write_json

METHODS='''
def _release_all(self):
    owners=sorted(self.owners)
    self.owners.clear()
    return owners
Claims.release_all=_release_all

def _acquire_many(self, entries):
    trial=Claims()
    trial.owners=dict(self.owners)
    for owner, paths in entries.items(): trial.acquire(owner,paths)
    self.owners=trial.owners
Claims.acquire_many=_acquire_many

def _to_json(self):
    return json.dumps({k:[str(p) for p in v] for k,v in self.owners.items()})

def _from_json(cls,text):
    obj=json.loads(text)
    if not isinstance(obj,dict): raise ValueError('mapping required')
    c=cls()
    for k,v in obj.items():
        if not isinstance(v,list): raise ValueError('paths required')
        c.acquire(k,v)
    return c
Claims.to_json=_to_json
Claims.from_json=classmethod(_from_json)
'''

def run(frozen,output,image,compiler):
    frozen,output=Path(frozen),Path(output);output.mkdir(mode=0o700)
    results=[]
    for task in json.loads((frozen/'manifest.json').read_text())['tasks']:
        name=task['id'];source=frozen/name/'source'
        negative=Sandbox(source,image,writable=[],compiler=compiler,judge=Path(__file__).with_name('judge.py')).execute('python /judge.py '+name+' /work')
        positive=output/name;shutil.copytree(source,positive)
        p=positive/'pilot.py';s=p.read_text()
        s=s.replace("    if len(tasks) != 6", "    import re\n    if any(not isinstance(t,str) or not re.fullmatch('[A-Za-z0-9_-]+',t) for t in tasks): raise ValueError('invalid ID')\n    if len(tasks) != 6")
        p.write_text(s+METHODS)
        with (positive/'sandbox.py').open('a') as f:
            f.write("\ndef valid_image(v):\n    return isinstance(v,str) and bool(re.fullmatch(r'[^\\s,@]+@sha256:[0-9a-f]{64}',v))\n")
        (positive/'program.om').write_text('fn main to int\ni = int 1\ns = int 0\nwhile lt i 11 bound 10\ns = add s i\ni = add i 1\nend\nret s\nend\n')
        result=Sandbox(positive,image,writable=[],compiler=compiler,judge=Path(__file__).with_name('judge.py')).execute('python /judge.py '+name+' /work')
        results.append(dict(task=name,negative=negative,positive=result,
                            passed=negative['exit_code']!=0 and result['exit_code']==0 and result['output'].strip()=='PASS '+name))
    write_json(output/'controls.json',results)
    print(json.dumps([dict(task=r['task'],passed=r['passed']) for r in results],indent=2))
    if not all(r['passed'] for r in results):raise SystemExit(1)

if __name__=='__main__':
    cfg=json.loads(Path(sys.argv[1]).read_text());run(sys.argv[2],sys.argv[3],cfg['image'],cfg['compiler'])
