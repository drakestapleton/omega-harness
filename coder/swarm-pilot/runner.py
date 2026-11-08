"""Single-host bounded conductor with isolated SDK processes and independent judges."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import tempfile
import shlex
import fcntl
import threading
import time
from gateway import Gateway
from runtime import Session,Refused,snapshot,write_json
from sandbox import Sandbox

HERE=Path(__file__).resolve().parent

def digest(value): return hashlib.sha256(json.dumps(value,sort_keys=True).encode()).hexdigest()

class Runner:
    def __init__(self,session,config):
        self.s,self.config=session,config
        self.arm=config['arm'];self.processes=set()
        self.worker_locks={};self.worker_locks_guard=threading.Lock()
        self.gateway=Gateway(session,config['model'],self.tool)
        self.label=digest(str(session.root))[:20]

    def close(self):
        for p in list(self.processes):
            if p.poll() is None:
                try:os.killpg(p.pid,signal.SIGKILL)
                except ProcessLookupError:pass
        ids=subprocess.run(['docker','ps','-aq','--filter','label=aien.pilot='+self.label],capture_output=True,text=True,timeout=15).stdout.split()
        if ids:subprocess.run(['docker','rm','-f',*ids],capture_output=True,timeout=30)
        self.gateway.close()

    def tool(self,request):
        self.s.active(self.s.status())
        owner,name,args=request['owner'],request['name'],request['arguments']
        state=self.s.status()
        if owner!='conductor' and (owner not in state['workers'] or state['workers'][owner]['state']!='running'):
            raise Refused('worker does not hold active authority')
        if name=='execute':
            tree=self.s.current if owner=='conductor' else self.s.root/'workers'/owner
            writable=[] if owner=='conductor' else state['workers'][owner]['paths']
            remaining=max(1,min(120,state['deadline']-time.time()))
            result=Sandbox(tree,self.config['image'],writable=writable,label=self.label,compiler=self.config.get("compiler")).execute(args['command'],remaining)
            with self.s.transaction('tool_result') as s:
                s['last_tool']={'owner':owner,'exit_code':result['exit_code']}
            return result
        if name!='delegate' or owner!='conductor': raise Refused('workers cannot delegate')
        worker,paths,instruction=args['owner'],args['paths'],args['instruction']
        if worker=='conductor': raise Refused('reserved actor name')
        allowed=self.config['allowed_paths']
        if not paths or any(p not in allowed for p in paths): raise Refused('claim outside task allowlist')
        with self.worker_locks_guard:
            lock=self.worker_locks.setdefault(worker,threading.Lock())
        with lock:
            state=self.s.status()
            existing=state['workers'].get(worker)
            key=digest([paths,instruction])
            if existing:
                if existing.get('request_key')!=key: raise Refused('worker ID reused for a different request')
                if existing['state']=='integrated': return {'status':'already integrated','changed':existing['changed']}
            else:
                self.s.spawn(worker,paths,request_key=key)
            prompt='You are a worker. You cannot delegate. All commands run in /work via POSIX /bin/sh. Use one-line shell commands with semicolons; do not encode command separators as literal backslash-n. Modify only '+json.dumps(paths)+'.\n'+instruction
            self.agent(worker,prompt)
            self.s.integrate(worker)
            return {'status':'integrated','changed':self.s.status()['workers'][worker]['changed']}

    def agent(self,owner,prompt):
        # SDK processes see system libraries, their own environment and this code;
        # no home directory, credential DB, repository, Docker socket or judges.
        with tempfile.TemporaryDirectory(prefix='pilot-sdk-') as temporary:
            temp=Path(temporary)
            env={k:os.environ[k] for k in ('PATH','LANG') if k in os.environ}
            env.update(HOME='/tmp/home',PILOT_OWNER=owner,PILOT_MODEL=self.config['model'],
                PILOT_GATEWAY_URL=self.gateway.url,PILOT_GATEWAY_TOKEN=self.gateway.token,
                OPENHANDS_SUPPRESS_BANNER='1',PYTHONUNBUFFERED='1',DO_NOT_TRACK='1',
                PI_CODING_AGENT_DIR='/tmp/profile',OPENAI_API_KEY=self.gateway.token)
            wrapper=['bwrap','--ro-bind','/usr','/usr','--symlink','usr/lib','/lib',
                '--symlink','usr/bin','/bin','--proc','/proc','--dev','/dev','--tmpfs','/tmp',
                '--dir','/tmp/home','--unshare-pid','--die-with-parent',
                '--dir','/pilot','--ro-bind',str(HERE/'adapters.py'),'/pilot/adapters.py',
                '--ro-bind',str(HERE/'baseline.ts'),'/pilot/baseline.ts','--ro-bind',str(temp),'/input',
                '--chdir','/tmp']
            if self.arm=='baseline':
                profile={'providers':{'pilot':{'baseUrl':self.gateway.url+'/v1',
                    'api':'openai-completions','apiKey':'PILOT_GATEWAY_TOKEN',
                    'models':[{'id':self.config['model'],'name':'Frozen pilot model',
                        'reasoning':False,'input':['text'],'contextWindow':131072,'maxTokens':1024}]}}}
                (temp/'models.yml').write_text(json.dumps(profile))
                (temp/'prompt.txt').write_text(prompt)
                omp=Path(self.config['omp']).resolve()
                wrapper+=['--ro-bind',str(omp),'/omp']
                command=['/bin/sh','-c',
                    'mkdir -p /tmp/profile; cp /input/models.yml /tmp/profile/models.yml; '
                    'exec /omp --model "pilot/$PILOT_MODEL" --print --mode json --no-session '
                    '--no-extensions --no-skills --no-rules --no-context-files --no-lsp --no-title '
                    '--tools '+('repo_command,delegate' if owner=='conductor' else 'repo_command')+
                    ' -e /pilot/baseline.ts "$(cat /input/prompt.txt)"']
                data=None
            else:
                venv=Path(self.config['environments'][self.arm]).resolve()
                wrapper+=['--ro-bind',str(venv),str(venv)]
                command=[str(venv/'bin/python'),'/pilot/adapters.py']
                data=json.dumps({'arm':self.arm,'prompt':prompt})
            timeout=max(1,self.s.status()['deadline']-time.time())
            p=subprocess.Popen(wrapper+command,stdin=subprocess.PIPE,stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,text=True,env=env,start_new_session=True)
            self.processes.add(p)
            try:
                first=True
                while True:
                    self.s.active(self.s.status())
                    try:
                        stdout,stderr=p.communicate(data if first else None,timeout=min(1,timeout))
                        break
                    except subprocess.TimeoutExpired:
                        first=False
                        timeout=max(0,self.s.status()['deadline']-time.time())
                        if timeout<=0: raise
                (self.s.root/f'{owner}.stdout').write_text(stdout)
                (self.s.root/f'{owner}.stderr').write_text(stderr)
                if p.returncode: raise Refused('SDK process failed; inspect private run logs')
            except subprocess.TimeoutExpired:
                self.s.cancel();os.killpg(p.pid,signal.SIGKILL);p.communicate();raise Refused('run deadline exhausted')
            finally:
                if p.poll() is None:
                    os.killpg(p.pid,signal.SIGKILL);p.communicate()
                self.processes.discard(p)

    def run(self):
        prompt=('All commands run in /work via POSIX /bin/sh. Use one-line shell commands with semicolons; do not encode command separators as literal backslash-n. You are the conductor for this repository task. Use repo_command to read/check the repository. '
            'The conductor workspace is read-only. Use delegate(owner, paths, instruction) for all edits. '
            'Each worker owns exact allowed paths. At most three active workers; workers cannot delegate. '
            'Use stable worker IDs and reuse the same ID for retries. Judge results are independent. '
            'Do not claim success without actual checks.\nAllowed paths: '+json.dumps(self.config['allowed_paths'])+
            '\nTask:\n'+self.config['prompt']+'\nPrior durable worker state:\n'+json.dumps(self.s.status()['workers']))
        self.agent('conductor',prompt)


def _run(config,root,source):
    root=Path(root)
    if root.exists():
        session=Session(root)
        if json.loads((root/'config.json').read_text())!=config: raise Refused('resume configuration changed')
        if (root/'result.json').exists(): return json.loads((root/'result.json').read_text())
    else:
        session=Session.create(root,source)
        write_json(root/'config.json',config)
    runner=Runner(session,config);start=time.time();error=None
    # Remove orphan command containers from an interrupted owner before resuming.
    ids=subprocess.run(['docker','ps','-aq','--filter','label=aien.pilot='+runner.label],capture_output=True,text=True,timeout=15).stdout.split()
    if ids:subprocess.run(['docker','rm','-f',*ids],capture_output=True,timeout=30)
    try:runner.run()
    except Exception as e:error=type(e).__name__
    finally:runner.close()
    state=session.status()
    # Never trust candidate-reported checks. The judge is outside all agent trees.
    judged=None
    if error is None and not state['cancelled'] and not state['reserved']:
        remaining=state['deadline']-time.time()
        judged=Sandbox(session.current,config['image'],writable=[],label=runner.label,
            compiler=config.get('compiler'),judge=HERE/'judge.py').execute(
                'python /judge.py '+shlex.quote(config['task'])+' /work',max(.01,min(120,remaining)))
        (root/'judge.stdout').write_text(judged['output'])
    within_deadline=time.time()<=state['deadline']
    parallel_ok=(config['task']!='parallel' or sum(w['state']=='integrated' for w in state['workers'].values())>=2)
    result=dict(id=config['id'],task=config['task'],repeat=config['repeat'],arm=config['arm'],
        accepted=within_deadline and parallel_ok and judged is not None and judged['exit_code']==0 and judged['output'].strip()=='PASS '+config['task'],gates_passed=within_deadline and bool(config.get('qualification_sha256')) and error is None and not state['reserved'],
        seconds=time.time()-(state['deadline']-1200),cost=None,tokens=state['tokens'],reserved_tokens=state['reserved'],
        judge_exit_code=judged['exit_code'] if judged else None,error=error,image=config['image'],qualification_sha256=config.get('qualification_sha256'),
        judge_sha256=config.get('judge_sha256'),source_sha256=config.get('source_sha256'),model=config['model'],config_sha256=digest(config),tree_sha256=digest(snapshot(session.current)))
    write_json(root/'result.json',result)
    return result

def run(config,root,source):
    root=Path(root)
    with (root.parent/('.'+root.name+'.runner.lock')).open('a') as lease:
        try:fcntl.flock(lease,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError as e:raise Refused('another conductor owns this session') from e
        return _run(config,root,source)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('config',type=Path);p.add_argument('source',type=Path);p.add_argument('output',type=Path)
    a=p.parse_args();print(json.dumps(run(json.loads(a.config.read_text()),a.output,a.source),indent=2))
