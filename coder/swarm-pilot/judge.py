"""Independent acceptance oracle. Execute only in an offline judge container."""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys

root=Path(sys.argv[2]);task=sys.argv[1]
sys.path.insert(0,str(root))
def load(name):
    spec=importlib.util.spec_from_file_location(name,root/(name+'.py'))
    m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m

if task=='smoke':
    assert (root/'hello.txt').read_text()=='ready\n'
elif task=='omega':
    binary=subprocess.run(['omc'],input=(root/'program.om').read_bytes(),capture_output=True,check=True,timeout=20).stdout
    Path('/tmp/program').write_bytes(binary);Path('/tmp/program').chmod(0o700)
    p=subprocess.run(['/tmp/program'],capture_output=True,timeout=5)
    assert p.returncode==55 and p.stdout==b''
else:
    m=load('pilot')
    # Preserve baseline behavior as well as implementing the requested feature.
    regression=m.Claims();regression.acquire('first',['src'])
    try:regression.acquire('second',['src/file'])
    except ValueError:pass
    else:raise AssertionError('baseline overlap protection regressed')
    assert set(regression.owners)=={'first'}
    regression.release('first');regression.acquire('next',['src'])
    rows=m.matrix(['a','b','c','d','e','f'])
    expected={(t,n,a) for t in ['a','b','c','d','e','f'] for n in (1,2) for a in ('baseline','deepagents','openhands')}
    assert len(rows)==36 and {(r['task'],r['repeat'],r['arm']) for r in rows}==expected
    assert len({r['id'] for r in rows})==36

    assert m.select([])['winner']=='baseline'

    if task=='bug':
        for bad in ['../x','a/b','a\\b','x y','a\nb',None,3,{},'']:
            try:m.matrix(['a','b','c','d','e',bad])
            except (ValueError,TypeError):pass
            else:raise AssertionError('invalid task ID admitted')
        rows=m.matrix(['a','b','c','d','e','f'])
    expected={(t,n,a) for t in ['a','b','c','d','e','f'] for n in (1,2) for a in ('baseline','deepagents','openhands')}
    assert len(rows)==36 and {(r['task'],r['repeat'],r['arm']) for r in rows}==expected
    assert len({r['id'] for r in rows})==36

    elif task in ('feature','parallel'):
        c=m.Claims();c.acquire('b',['src']);c.acquire('a',['docs'])
        assert c.release_all()==['a','b'] and c.release_all()==[]
        c.acquire('b',['src'])
        if task=='parallel':
            v=load('sandbox').valid_image
            assert v('registry/image@sha256:'+'a'*64)
            for bad in [None,1,'x','x@sha256:'+'A'*64,'x@sha256:'+'a'*63,'x,y@sha256:'+'a'*64,' x@sha256:'+'a'*64]:assert v(bad) is False
    elif task=='conflict':
        c=m.Claims();c.acquire('old',['keep'])
        try:c.acquire_many({'a':['src'],'b':['src/main']})
        except ValueError:pass
        else:raise AssertionError('overlap admitted')
        assert list(c.owners)==['old']
        c.acquire_many({'a':['src'],'b':['docs']});assert set(c.owners)=={'old','a','b'}
    elif task=='recovery':
        c=m.Claims();c.acquire('a',['src']);c.acquire('b',['docs'])
        text=c.to_json();assert set(c.owners)=={'a','b'}
        d=m.Claims.from_json(text);assert set(c.owners)=={'a','b'}
        assert json.loads(d.to_json())=={'a':['src'],'b':['docs']}
        for bad in ['[]','null','{"a":["src"],"b":["src/x"]}','{"a":["../x"]}']:
            try:m.Claims.from_json(bad)
            except (ValueError,TypeError):pass
            else:raise AssertionError('invalid restored claims')
    else:raise AssertionError('unknown task')
print('PASS',task)
