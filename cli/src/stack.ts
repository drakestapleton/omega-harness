import { execFileSync, spawnSync } from 'node:child_process';
import chalk from 'chalk';
import { SYMBOL } from './brand.js';
import { probeInkling } from './inkling.js';

export interface StackOptions {
  sparkHost: string;
  endpoint: string;
  apiKey?: string;
}

function getPortFromEndpoint(endpoint: string): number {
  try {
    const u = new URL(endpoint);
    return u.port ? Number(u.port) : 8080;
  } catch {
    return 8080;
  }
}

const BUILD_REMOTE_SCRIPT = `set -eu
mkdir -p ~/.local/opt/inkling2
cd ~/canon/omega-mv
( echo om2
  cat gpu/nvidia/native/nvrm/context.om \\
    gpu/nvidia/native/blackwell/vector.om \\
    gpu/nvidia/native/blackwell/launch.om \\
    gpu/nvidia/native/blackwell/batch.om \\
    om/encoder/bw_enc_sm121.om \\
    om/gpu/inkling2/emit_fast.om \\
    om/arboris_online.om \\
    om/gpu/inkling2/arboris/prefetch.om \\
    om/gpu/inkling2/decoder/safetensors.om \\
    om/gpu/inkling2/decoder/tokenizer.om \\
    om/gpu/inkling2/decoder/decode.om \\
    om/gpu/inkling2/multistream/batcher.om \\
    om/gpu/inkling2/multistream/serve_live.om
) > /tmp/inkling2-serve-build.om
seed/out/omc < /tmp/inkling2-serve-build.om > ~/.local/opt/inkling2/inkling2-serve.new
chmod +x ~/.local/opt/inkling2/inkling2-serve.new
mv ~/.local/opt/inkling2/inkling2-serve.new ~/.local/opt/inkling2/inkling2-serve
rm -f /tmp/inkling2-serve-build.om
sha256sum ~/.local/opt/inkling2/inkling2-serve
ls -lh ~/.local/opt/inkling2/inkling2-serve
`;

export function rebuildSparkInkling(sparkHost: string): { sha256: string; output: string } {
  console.log(chalk.cyan(`${SYMBOL} Rebuilding pure seeded-Omega inkling2-serve (with Arboris + SM121 speedups) on ${sparkHost}…`));
  const out = execFileSync('ssh', ['-o', 'ConnectTimeout=8', sparkHost, BUILD_REMOTE_SCRIPT], {
    encoding: 'utf8',
    timeout: 60_000,
  });
  const sha = out.trim().split(/\s+/)[0] || '';
  return { sha256: sha, output: out.trim() };
}

export function ensureTunnel(sparkHost: string, localPort: number, remotePort = 8080): void {
  const spec = `127.0.0.1:${localPort}:127.0.0.1:${remotePort}`;
  // Check if already listening on localPort
  const check = spawnSync('lsof', [`-iTCP:${localPort}`, '-sTCP:LISTEN', '-n', '-P'], {
    encoding: 'utf8',
  });
  if (check.status === 0 && (check.stdout || '').trim().length > 0) {
    return;
  }
  console.log(chalk.gray(`${SYMBOL} Opening SSH tunnel ${spec} → ${sparkHost}…`));
  execFileSync(
    'ssh',
    [
      '-f',
      '-N',
      '-o', 'ControlMaster=no',
      '-o', 'ControlPath=none',
      '-o', 'BatchMode=yes',
      '-o', 'ExitOnForwardFailure=yes',
      '-o', 'ServerAliveInterval=15',
      '-o', 'ServerAliveCountMax=3',
      '-o', 'ConnectTimeout=8',
      '-L', spec,
      sparkHost,
    ],
    { stdio: 'ignore', timeout: 15_000 }
  );
}

export async function stackUp(opts: StackOptions & { rebuild?: boolean }): Promise<boolean> {
  const port = getPortFromEndpoint(opts.endpoint);

  // Fast path: already online
  const initial = await probeInkling(opts.endpoint, opts.apiKey);
  if (initial.online && !opts.rebuild) {
    console.log(
      chalk.green(`${SYMBOL} Inkling-2-Mini is already ONLINE`) +
        chalk.gray(` (${initial.endpoint} · ${initial.engine} · Arboris ACTIVE)`)
    );
    return true;
  }

  // Ensure binary exists on Spark (or rebuild if requested)
  if (opts.rebuild) {
    const built = rebuildSparkInkling(opts.sparkHost);
    console.log(chalk.gray(`  sha256: ${built.sha256}`));
  } else {
    const hasBin = spawnSync(
      'ssh',
      ['-o', 'ConnectTimeout=8', opts.sparkHost, 'test -x ~/.local/opt/inkling2/inkling2-serve'],
      { stdio: 'ignore', timeout: 10_000 }
    );
    if (hasBin.status !== 0) {
      const built = rebuildSparkInkling(opts.sparkHost);
      console.log(chalk.gray(`  sha256: ${built.sha256}`));
    }
  }

  // Check if inkling2-serve is already running on Spark
  const startCmd = `set -eu
if [ -f /tmp/inkling2-serve.pid ] && kill -0 $(cat /tmp/inkling2-serve.pid) 2>/dev/null; then
  if [ "${opts.rebuild ? '1' : '0'}" = "1" ]; then
    kill $(cat /tmp/inkling2-serve.pid) 2>/dev/null || true
    sleep 4
  else
    echo "ALREADY_RUNNING=$(cat /tmp/inkling2-serve.pid)"
    exit 0
  fi
fi
setsid -f ~/.local/opt/inkling2/inkling2-serve </dev/null >/tmp/inkling2-serve.log 2>&1
sleep 1
PID=$(pgrep -n -x inkling2-serve || true)
echo "$PID" > /tmp/inkling2-serve.pid
echo "STARTED=$PID"
`;

  console.log(chalk.cyan(`${SYMBOL} Starting pure-Omega inkling2-serve (GB10 zero-CUDA + Arboris) on ${opts.sparkHost}…`));
  const startOut = execFileSync('ssh', ['-o', 'ConnectTimeout=8', opts.sparkHost, startCmd], {
    encoding: 'utf8',
    timeout: 20_000,
  }).trim();
  console.log(chalk.gray(`  ${startOut}`));

  ensureTunnel(opts.sparkHost, port, 8080);

  // Wait for Inkling-2-Mini 18.3 GB checkpoint to finish streaming into GB10 UVM
  process.stdout.write(chalk.gray(`${SYMBOL} Waiting for Inkling-2-Mini checkpoint load on GB10…`));
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const h = await probeInkling(opts.endpoint, opts.apiKey);
    if (h.online) {
      process.stdout.write('\n');
      console.log(
        chalk.green(`${SYMBOL} ONLINE: ${h.model || 'inkling-2-mini'}`) +
          chalk.gray(
            ` · ${h.engine} · ${h.slotsActive ?? 0}/${h.slotsMax ?? 8} KV slots` +
              (h.arborisTransitions !== undefined ? ` · Arboris ACTIVE` : '')
          )
      );
      return true;
    }
    process.stdout.write('.');
    await new Promise((r) => setTimeout(r, 2000));
  }
  process.stdout.write('\n');
  console.error(chalk.red(`${SYMBOL} Timed out waiting for Inkling-2-Mini at ${opts.endpoint}. Check ssh ${opts.sparkHost} 'cat /tmp/inkling2-serve.log'`));
  return false;
}

export function stackDown(opts: StackOptions): void {
  const port = getPortFromEndpoint(opts.endpoint);
  console.log(chalk.cyan(`${SYMBOL} Stopping inkling2-serve on ${opts.sparkHost}…`));
  spawnSync(
    'ssh',
    [
      '-o', 'ConnectTimeout=8',
      opts.sparkHost,
      'if [ -f /tmp/inkling2-serve.pid ]; then kill $(cat /tmp/inkling2-serve.pid) 2>/dev/null || true; rm -f /tmp/inkling2-serve.pid; fi; pkill -x inkling2-serve 2>/dev/null || true',
    ],
    { stdio: 'ignore', timeout: 15_000 }
  );
  console.log(chalk.cyan(`${SYMBOL} Closing local SSH tunnel on port ${port}…`));
  spawnSync('pkill', ['-f', `127.0.0.1:${port}:127.0.0.1:8080 ${opts.sparkHost}`], { stdio: 'ignore' });
  console.log(chalk.green(`${SYMBOL} Stack stopped cleanly (Spark GPU idle).`));
}
