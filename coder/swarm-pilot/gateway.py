"""Budgeted loopback proxy reusing OMP's authenticated provider gateway."""
import json
import os
import secrets
import signal
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from runtime import Refused

class Gateway:
    def __init__(self, session, model, tool_handler=None):
        self.session, self.model, self.tool_handler = session, model, tool_handler
        self.token = secrets.token_hex(24)
        self.lock = threading.Lock()
        self.closing=threading.Event();self.providers=set()
        parent = self
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args): pass
            def do_POST(self):
                if self.headers.get('Authorization') != 'Bearer '+parent.token:
                    self.send_error(401); return
                try:
                    n = int(self.headers.get('Content-Length', '0'))
                    if not 0 < n <= 2_000_000: raise Refused('request size refused')
                    body = json.loads(self.rfile.read(n))
                    if self.path == '/tool':
                        response = parent.tool_handler(body)
                    elif self.path in ('/v1/chat/completions','/v1/responses'):
                        stream = bool(body.get('stream'))
                        body['stream'] = False
                        response = parent.complete(body,self.path)
                        if stream:
                            self.send_response(200); self.send_header('Content-Type','text/event-stream'); self.end_headers()
                            choice=response['choices'][0]; delta=dict(choice['message']); delta.pop('role',None)
                            for i,t in enumerate(delta.get('tool_calls',[])): t['index']=i
                            chunk=dict(id=response.get('id','pilot'),object='chat.completion.chunk',created=int(time.time()),model=parent.model,choices=[dict(index=0,delta=delta,finish_reason=None)])
                            self.wfile.write(('data: '+json.dumps(chunk)+'\n\n').encode())
                            chunk['choices']=[dict(index=0,delta={},finish_reason=choice.get('finish_reason','stop'))];chunk['usage']=response.get('usage')
                            self.wfile.write(('data: '+json.dumps(chunk)+'\n\ndata: [DONE]\n\n').encode());return
                    else: raise Refused('route refused')
                    payload = json.dumps(response).encode()
                    self.send_response(200); self.send_header('Content-Type','application/json')
                    self.send_header('Content-Length',str(len(payload))); self.end_headers(); self.wfile.write(payload)
                except Exception as e:
                    # No provider exception text or credentials enter agent-visible output.
                    reason=str(e) if isinstance(e,Refused) else type(e).__name__
                    with parent.session.transaction('gateway_refusal') as state: state['last_refusal']=dict(path=self.path,reason=reason)
                    payload=json.dumps({'error':{'message':reason,'type':'pilot_refusal'}}).encode()
                    self.send_response(400); self.send_header('Content-Type','application/json'); self.end_headers(); self.wfile.write(payload)
        self.server = ThreadingHTTPServer(('127.0.0.1',0), Handler)
        self.server.daemon_threads = False
        self.url = 'http://127.0.0.1:'+str(self.server.server_port)
        self.thread = threading.Thread(target=self.server.serve_forever,daemon=True)
        self.thread.start()

    def close(self):
        self.closing.set()
        self.server.shutdown()
        with self.lock:
            for p in list(self.providers):
                if p.poll() is None:
                    try:os.killpg(p.pid,signal.SIGKILL)
                    except ProcessLookupError:pass
        self.server.server_close();self.thread.join()

    def provider_call(self,request,timeout):
        with self.lock:
            if self.closing.is_set():raise Refused('gateway closing')
            p=subprocess.Popen(['omp','auth-gateway','stdio'],stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,start_new_session=True)
            self.providers.add(p)
        start=time.time();first=True
        try:
            while True:
                if self.closing.is_set() or self.session.status()['cancelled'] or time.time()-start>=timeout:
                    raise Refused('in-flight request cancelled or timed out; reservation retained')
                try:
                    stdout,stderr=p.communicate(json.dumps(request)+'\n' if first else None,timeout=1)
                    return type('Reply',(),dict(returncode=p.returncode,stdout=stdout))()
                except subprocess.TimeoutExpired:first=False
        finally:
            if p.poll() is None:
                try:os.killpg(p.pid,signal.SIGKILL)
                except ProcessLookupError:pass
                p.communicate()
            with self.lock:self.providers.discard(p)

    def complete(self, body, path="/v1/chat/completions"):
        body = dict(body)
        if body.get('stream'): raise Refused('pilot requires nonstreaming accounting')
        if body.get('model') != self.model: raise Refused('model must match frozen pin')
        body.pop('max_completion_tokens',None)
        body['max_tokens'] = min(int(body.get('max_tokens',1024)),1024)
        if body['max_tokens'] <= 0: raise Refused('invalid completion limit')
        body['stream'] = False
        if path == '/v1/responses':
            body['max_output_tokens']=body.pop('max_tokens')
            body['reasoning']={'effort':'low'}
        else: body['reasoning_effort']='low'
        # UTF-8 bytes plus protocol allowance conservatively reserve visible-input
        # tokens. Provider usage is mandatory and must fit this reservation.
        serialized=json.dumps(body,ensure_ascii=False)
        try:
            import tiktoken
            count=len(tiktoken.get_encoding('o200k_base').encode(serialized))
        except ImportError:
            count=len(serialized.encode())
        bound=count+2048+body.get('max_tokens',body.get('max_output_tokens',1024))
        ticket = self.session.reserve(bound)
        remaining = self.session.status()['deadline']-time.time()
        started = time.time()
        request = dict(id=1,path=path,body=body)
        proc = self.provider_call(request,max(.01,min(180,remaining)))
        replies=[]
        for line in proc.stdout.splitlines():
            try:
                d=json.loads(line)
                if d.get('id') == 1 and 'status' in d: replies.append(d)
            except (ValueError,AttributeError): continue
        if proc.returncode or len(replies)!=1 or replies[0]['status']!=200:
            raise Refused('provider transport failed; reservation retained')
        result=replies[0]['body']
        usage=result.get('usage',{}).get('total_tokens')
        self.session.settle(ticket,usage)
        record=dict(at=started,seconds=time.time()-started,request=body,response=result,usage=usage)
        with self.lock:
            with (self.session.root/'trace.jsonl').open('a') as f:
                f.write(json.dumps(record)+'\n'); f.flush(); os.fsync(f.fileno())
        self.session.active(self.session.status())
        return result
