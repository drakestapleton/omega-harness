"""Run commands in disposable offline Docker containers, never on the host."""
import subprocess
import re
import uuid
import os
import selectors
import time
from pathlib import Path

MAX_OUTPUT = 16000
OUTPUT_LIMIT_EXIT = 125


def _stop_process(process):
    """Stop a Docker client without allowing cleanup to hang forever."""
    if process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=5)


def _capture_process(process, seconds):
    """Capture only the last MAX_OUTPUT bytes from a running process."""
    selector = selectors.DefaultSelector()
    selector.register(process.stdout, selectors.EVENT_READ)
    tail = bytearray()
    total = 0
    deadline = time.monotonic() + seconds
    timed_out = False
    excessive = False
    try:
        while True:
            if process.poll() is not None and not selector.get_map():
                break
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                timed_out = process.poll() is None
                break
            events = selector.select(min(remaining, 0.1))
            if not events:
                if process.poll() is not None:
                    break
                continue
            for key, _ in events:
                chunk = os.read(key.fileobj.fileno(), 4096)
                if not chunk:
                    selector.unregister(key.fileobj)
                    continue
                total += len(chunk)
                tail.extend(chunk)
                if len(tail) > MAX_OUTPUT:
                    del tail[:-MAX_OUTPUT]
                if total > MAX_OUTPUT:
                    excessive = True
                    break
            if timed_out or excessive:
                break
    finally:
        selector.close()

    if timed_out or excessive:
        _stop_process(process)
    else:
        process.wait()
    process.stdout.close()

    output = bytes(tail).decode('utf-8', errors='replace')
    if timed_out:
        return 124, 'sandbox command timed out'
    if excessive:
        return OUTPUT_LIMIT_EXIT, 'sandbox refused: output exceeded 16000 bytes'
    return process.returncode, output

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
            process = subprocess.Popen(argv, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
            exit_code, output = _capture_process(process, seconds)
            return dict(exit_code=exit_code, output=output)
        finally:
            subprocess.run(['docker', 'rm', '-f', name], capture_output=True, timeout=15)
