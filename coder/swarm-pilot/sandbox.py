"""Run commands in disposable offline Docker containers, never on the host."""
import subprocess
import re
import uuid
from pathlib import Path

class Sandbox:
    def __init__(self, workspace, image):
        self.workspace = Path(workspace).resolve(strict=True)
        if not self.workspace.is_dir() or not re.fullmatch(r'[^\s,@]+@sha256:[0-9a-f]{64}', image):
            raise ValueError('directory and digest-pinned image required')
        self.image = image

    def execute(self, command, seconds=120):
        name = 'aien-pilot-' + uuid.uuid4().hex
        argv = ['docker', 'run', '--rm', '--name', name, '--network=none',
                '--cap-drop=ALL', '--security-opt=no-new-privileges', '--read-only',
                '--pids-limit=128', '--memory=2g', '--cpus=2', '--tmpfs', '/tmp:rw,size=256m',
                '--mount', f'type=bind,src={self.workspace},dst=/work', '-w', '/work',
                self.image, '/bin/sh', '-c', command]
        try:
            r = subprocess.run(argv, capture_output=True, text=True, timeout=seconds)
            return dict(exit_code=r.returncode, output=(r.stdout + r.stderr)[-16000:])
        except subprocess.TimeoutExpired:
            return dict(exit_code=124, output='sandbox command timed out')
        finally:
            subprocess.run(['docker', 'rm', '-f', name], capture_output=True, timeout=15)
