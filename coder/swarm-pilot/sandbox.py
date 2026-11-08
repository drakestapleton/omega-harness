"""Run commands in disposable offline Docker containers, never on the host."""
import subprocess
import re
import uuid
import os
from pathlib import Path

class Sandbox:
    def __init__(self, workspace, image, writable=None, label="unscoped", compiler=None, judge=None):
        self.workspace = Path(workspace).resolve(strict=True)
        if not self.workspace.is_dir() or not re.fullmatch(r'[^\s,@]+@sha256:[0-9a-f]{64}', image):
            raise ValueError('directory and digest-pinned image required')
        self.image = image
        self.writable, self.label, self.compiler, self.judge = writable, label, compiler, judge

    def execute(self, command, seconds=120):
        name = 'aien-pilot-' + uuid.uuid4().hex
        argv = ['docker', 'run', '--rm', '--name', name, '--network=none',
                '--label', 'aien.pilot='+self.label, '--user', f'{os.getuid()}:{os.getgid()}', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--read-only',
                '--pids-limit=128', '--memory=2g', '--cpus=2', '--tmpfs', '/tmp:rw,exec,size=256m',
                '--mount', f'type=bind,src={self.workspace},dst=/work'+(',readonly' if self.writable is not None else ''), '-w', '/work',
                self.image, '/bin/sh', '-c', command]
        if self.judge:
            argv[argv.index(self.image):argv.index(self.image)] = ['--mount', f'type=bind,src={Path(self.judge).resolve(strict=True)},dst=/judge.py,readonly']
        if self.compiler:
            import hashlib
            file = Path(self.compiler['path']).resolve(strict=True)
            if hashlib.sha256(file.read_bytes()).hexdigest() != self.compiler['sha256']:
                raise ValueError('compiler pin mismatch')
            argv[argv.index(self.image):argv.index(self.image)] = ['--mount', f'type=bind,src={file},dst=/usr/local/bin/omc,readonly']
        for path in self.writable or []:
            source = self.workspace/path
            if not source.resolve().is_relative_to(self.workspace): raise ValueError('write mount escapes workspace')
            if not source.exists():
                source.parent.mkdir(parents=True, exist_ok=True); source.touch()
            argv[argv.index(self.image):argv.index(self.image)] = ['--mount', f'type=bind,src={source},dst=/work/{path}']
        try:
            r = subprocess.run(argv, capture_output=True, text=True, timeout=seconds)
            return dict(exit_code=r.returncode, output=(r.stdout + r.stderr)[-16000:])
        except subprocess.TimeoutExpired:
            return dict(exit_code=124, output='sandbox command timed out')
        finally:
            subprocess.run(['docker', 'rm', '-f', name], capture_output=True, timeout=15)
