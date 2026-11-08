"""Durable, single-host pilot control plane. Candidate trees never contain this DB."""
import hashlib
import json
import os
import re
import shutil
import sqlite3
import stat
import time
import uuid
from contextlib import contextmanager
from pathlib import Path, PurePosixPath
from pilot import Claims

class Refused(RuntimeError):
    pass


def snapshot(root):
    """Independent inventory: never trust a candidate's Git index or diff."""
    files = {}
    total = 0
    for p in sorted(root.rglob('*')):
        s = p.lstat()
        if stat.S_ISLNK(s.st_mode): raise Refused('symlinks are outside pilot profile')
        if stat.S_ISDIR(s.st_mode): continue
        if not stat.S_ISREG(s.st_mode) or s.st_nlink != 1:
            raise Refused('special files or hardlinks refused')
        total += s.st_size
        if len(files) >= 20000 or total > 100_000_000: raise Refused('snapshot limit exceeded')
        files[p.relative_to(root).as_posix()] = (hashlib.sha256(p.read_bytes()).hexdigest(), s.st_mode & 0o777)
    return files


def write_json(path, data):
    temp = path.with_suffix('.tmp')
    with temp.open('w') as f:
        json.dump(data, f, indent=2); f.flush(); os.fsync(f.fileno())
    os.replace(temp, path)


class Session:
    def __init__(self, root):
        self.root = Path(root).resolve()
        if not (self.root/'state.db').is_file(): raise Refused('session does not exist')

    @classmethod
    def create(cls, root, source, *, seconds=1200, tokens=30000):
        root, source = Path(root).resolve(), Path(source).resolve()
        if root == source or root.is_relative_to(source): raise Refused('session must be outside source')
        root.mkdir(mode=0o700)
        (root/'trees').mkdir(); (root/'workers').mkdir()
        snapshot(source)
        shutil.copytree(source, root/'trees'/'initial')
        c = sqlite3.connect(root/'state.db')
        c.execute('PRAGMA journal_mode=WAL')
        c.execute('CREATE TABLE state (id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL)')
        c.execute('CREATE TABLE events (id INTEGER PRIMARY KEY, at REAL, kind TEXT, body TEXT)')
        state = dict(current='initial', deadline=time.time()+seconds, limit=tokens,
                     tokens=0, reserved=0, tickets={}, workers={}, cancelled=False)
        c.execute('INSERT INTO state VALUES(1,?)', (json.dumps(state),)); c.commit(); c.close()
        return cls(root)

    @contextmanager
    def transaction(self, kind):
        c = sqlite3.connect(self.root/'state.db', timeout=30)
        c.execute('PRAGMA synchronous=FULL'); c.execute('BEGIN IMMEDIATE')
        try:
            state = json.loads(c.execute('SELECT body FROM state WHERE id=1').fetchone()[0])
            yield state
            c.execute('UPDATE state SET body=? WHERE id=1', (json.dumps(state),))
            c.execute('INSERT INTO events(at,kind,body) VALUES(?,?,?)', (time.time(),kind,json.dumps(state)))
            c.commit()
        except BaseException:
            c.rollback(); raise
        finally: c.close()

    def status(self):
        c = sqlite3.connect(self.root/'state.db')
        try: return json.loads(c.execute('SELECT body FROM state WHERE id=1').fetchone()[0])
        finally: c.close()

    @property
    def current(self): return self.root/'trees'/self.status()['current']

    def active(self, state):
        if state['cancelled'] or time.time() >= state['deadline']:
            raise Refused('session cancelled or expired')

    def spawn(self, owner, paths, request_key=None):
        if not re.fullmatch('[a-zA-Z0-9_-]{1,48}', owner): raise Refused('invalid owner')
        with self.transaction('spawn') as s:
            self.active(s)
            if owner in s['workers']: raise Refused('owner already exists')
            active = {k:v for k,v in s['workers'].items() if v['state'] == 'running'}
            if len(active) >= 3: raise Refused('three workers maximum')
            claims = Claims()
            try:
                for k,v in active.items(): claims.acquire(k, v['paths'])
                claims.acquire(owner, paths)
            except ValueError as e: raise Refused(str(e)) from e
            tree = self.root/'workers'/owner
            # A crash before DB commit may leave an unadmitted tree. Never reuse it.
            if tree.exists(): shutil.rmtree(tree)
            shutil.copytree(self.root/'trees'/s['current'], tree)
            s['workers'][owner] = dict(paths=paths, state='running', base=s['current'], request_key=request_key)
        return tree

    def integrate(self, owner):
        with self.transaction('integrate') as s:
            self.active(s)
            w = s['workers'][owner]
            if w['state'] == 'integrated': return
            if w['state'] != 'running': raise Refused('worker is not running')
            base, candidate = self.root/'trees'/w['base'], self.root/'workers'/owner
            before, after = snapshot(base), snapshot(candidate)
            changed = [p for p in before.keys() | after.keys() if before.get(p) != after.get(p)]
            for p in changed:
                if not any(p == claim or PurePosixPath(claim) in PurePosixPath(p).parents for claim in w['paths']):
                    raise Refused('undeclared write: '+p)
            current = self.root/'trees'/s['current']; current_files = snapshot(current)
            if any(current_files.get(p) != before.get(p) for p in changed):
                raise Refused('integration base changed')
            version = uuid.uuid4().hex
            staged = self.root/'trees'/version
            shutil.copytree(current, staged)
            for p in changed:
                dest = staged/p
                if p not in after:
                    dest.unlink()
                else:
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(candidate/p, dest)
            snapshot(staged)
            # Immutable tree first, transactional pointer switch last. A crash leaves
            # an unreachable tree, never a partially applied canonical workspace.
            for p in staged.rglob('*'):
                if p.is_file():
                    with p.open('rb') as f: os.fsync(f.fileno())
            for directory in [*(p for p in staged.rglob('*') if p.is_dir()), staged, staged.parent]:
                fd = os.open(directory, os.O_RDONLY)
                try: os.fsync(fd)
                finally: os.close(fd)
            s['current'] = version
            w['state'] = 'integrated'
            w['changed'] = changed

    def reserve(self, upper_bound):
        if type(upper_bound) is not int or upper_bound <= 0: raise Refused('invalid token reservation')
        with self.transaction('reserve') as s:
            self.active(s)
            if s['tokens']+s['reserved']+upper_bound > s['limit']: raise Refused('token budget exhausted')
            ticket = uuid.uuid4().hex
            s['tickets'][ticket] = upper_bound; s['reserved'] += upper_bound
        return ticket

    def settle(self, ticket, actual):
        with self.transaction('usage') as s:
            bound = s['tickets'][ticket]
            if type(actual) is not int or actual < 0 or actual > bound:
                raise Refused('usage outside reserved bound')
            s['tokens'] += actual; s['reserved'] -= bound; del s['tickets'][ticket]

    def cancel(self):
        with self.transaction('cancel') as s: s['cancelled'] = True
