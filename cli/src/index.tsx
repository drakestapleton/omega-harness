#!/usr/bin/env node
import React from 'react';
import { render } from 'ink';
import chalk from 'chalk';
import { CLI_VERSION, SYMBOL, renderBanner } from './brand.js';
import {
  getConfigPath,
  loadConfig,
  writePersistedConfig,
  type ApprovalMode,
  type ProviderKind,
} from './config.js';
import {
  buildSystemPrompt,
  discoverSkills,
  readPinInfo,
} from './harness.js';
import { probeInkling } from './inkling.js';
import { rebuildSparkInkling, stackDown, stackUp } from './stack.js';
import { TOOL_DECLARATIONS } from './tools.js';
import { OmegaAgent } from './agent.js';
import { App } from './ui/App.js';

interface ParsedArgs {
  help: boolean;
  version: boolean;
  listSkills: boolean;
  listTools: boolean;
  showPin: boolean;
  showStatus: boolean;
  resumeSession?: string;
  stackCommand?: 'up' | 'down' | 'rebuild';
  launchAfterUp: boolean;
  rebuildOnUp: boolean;
  sparkHost: string;
  provider?: ProviderKind;
  endpoint?: string;
  prompt?: string;
  model?: string;
  apiKey?: string;
  approvalMode?: ApprovalMode;
  skills: string[];
  positional: string[];
  configSubcommand?: { action: 'set' | 'get' | 'path'; key?: string; value?: string };
}

function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = {
    help: false,
    version: false,
    listSkills: false,
    listTools: false,
    showPin: false,
    showStatus: false,
    launchAfterUp: false,
    rebuildOnUp: false,
    sparkHost: process.env.OMEGA_SPARK_HOST || 'spark',
    skills: [],
    positional: [],
  };

  if (argv[0] === 'config') {
    const action = argv[1];
    if (action === 'set' || action === 'get' || action === 'path') {
      out.configSubcommand = { action, key: argv[2], value: argv[3] };
      return out;
    }
  }

  let startIdx = 0;
  if (argv[0] === 'up' || argv[0] === 'down' || argv[0] === 'rebuild') {
    out.stackCommand = argv[0];
    startIdx = 1;
  } else if (argv[0] === 'start') {
    out.stackCommand = 'up';
    out.launchAfterUp = true;
    startIdx = 1;
  }

  for (let i = startIdx; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') {
      out.help = true;
    } else if (a === '-v' || a === '--version') {
      out.version = true;
    } else if (a === '--skills') {
      out.listSkills = true;
    } else if (a === '--tools') {
      out.listTools = true;
    } else if (a === '--pin') {
      out.showPin = true;
    } else if (a === '--status') {
      out.showStatus = true;
    } else if (a === '--launch') {
      out.launchAfterUp = true;
    } else if (a === '--rebuild') {
      out.rebuildOnUp = true;
    } else if (a === '--host' && argv[i + 1]) {
      out.sparkHost = argv[++i];
    } else if (a === '-r' || a === '--resume') {
      out.resumeSession = argv[i + 1] && !argv[i + 1].startsWith('-') ? argv[++i] : 'latest';
    } else if (a === '-y' || a === '--yolo') {
      out.approvalMode = 'yolo';
    } else if (a === '--auto-edit') {
      out.approvalMode = 'auto-edit';
    } else if (a === '--omega-only') {
      out.approvalMode = 'omega-only';
    } else if (a === '--provider' && argv[i + 1]) {
      const p = argv[++i].toLowerCase();
      if (p === 'inkling' || p === 'gemini') out.provider = p;
    } else if ((a === '-e' || a === '--endpoint') && argv[i + 1]) {
      out.endpoint = argv[++i];
    } else if ((a === '-m' || a === '--model') && argv[i + 1]) {
      out.model = argv[++i];
    } else if ((a === '-p' || a === '--prompt') && argv[i + 1]) {
      out.prompt = argv[++i];
    } else if (a === '--api-key' && argv[i + 1]) {
      out.apiKey = argv[++i];
    } else if ((a === '-s' || a === '--skill') && argv[i + 1]) {
      out.skills.push(argv[++i]);
    } else if (!a.startsWith('-')) {
      out.positional.push(a);
    }
  }
  return out;
}

function printHelp(): void {
  console.log(renderBanner(80).join('\n'));
  console.log('');
  console.log(
    chalk.cyan.bold(`${SYMBOL} Omega Harness CLI v${CLI_VERSION}`) +
      chalk.gray(' — hooked to Inkling-2-Mini (with Gemini SDK fallback)')
  );
  console.log('');
  console.log('Usage:');
  console.log('  omega [options] [initial prompt]      Launch interactive Ω TUI');
  console.log('  omega start                           Boot Inkling-2-Mini + Arboris on Spark, tunnel, and launch TUI');
  console.log('  omega up [--rebuild]                  Start Inkling-2-Mini + Arboris on Spark + SSH tunnel');
  console.log('  omega down                            Stop Inkling-2-Mini on Spark + close SSH tunnel');
  console.log('  omega rebuild                         Recompile pure-Omega inkling2-serve on Spark');
  console.log('  omega --status                        Check Inkling-2-Mini health, KV slots & Arboris hits');
  console.log('  omega -p "<prompt>"                   Non-interactive headless mode (supports piped stdin)');
  console.log('  omega config set endpoint <url>       Save default Inkling HTTP endpoint');
  console.log('  omega config set provider <name>      Save default provider (inkling | gemini)');
  console.log('');
  console.log('Options:');
  console.log('  -e, --endpoint <url>    Inkling HTTP endpoint (default: http://127.0.0.1:8080 or INKLING_URL)');
  console.log('      --provider <name>   Backend provider: inkling (default) | gemini');
  console.log('  -m, --model <id>        Model ID (default: inkling-2-mini)');
  console.log('  -p, --prompt <text>     Run in non-interactive mode and print response to stdout');
  console.log('  -y, --yolo              Auto-approve all tool calls');
  console.log('      --auto-edit         Auto-approve file writes and edits');
  console.log('      --omega-only        Restrict writes to .om / NOTES.md with auto-omc checks');
  console.log('  -s, --skill <name>      Pin an Omega Harness skill into the system prompt (repeatable)');
  console.log('      --status            Probe Inkling server health and exit');
  console.log('      --tools             List all 27 available agent tools and exit');
  console.log('      --skills            List all available Omega Harness skills and exit');
  console.log('      --pin               Show omega-harness PIN and local omc status and exit');
  console.log('      --api-key <key>     Optional bearer token (Inkling) or Gemini API key');
  console.log('  -v, --version           Print version');
  console.log('  -h, --help              Show this help');
}

async function readStdinIfPiped(): Promise<string> {
  if (process.stdin.isTTY) return '';
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8').trim();
}

async function runHeadless(
  prompt: string,
  config: ReturnType<typeof loadConfig>,
  cwd: string,
  skills: string[]
): Promise<void> {
  if (config.provider === 'gemini' && !config.apiKey) {
    console.error(`${SYMBOL} error: No Gemini API key configured. Export GEMINI_API_KEY or use --provider inkling.`);
    process.exit(1);
  }

  const stdinText = await readStdinIfPiped();
  const fullPrompt = stdinText ? `${prompt}\n\n<stdin>\n${stdinText}\n</stdin>` : prompt;
  const pinInfo = readPinInfo(config.harnessRoot, config.omcPath);
  const systemInstruction = buildSystemPrompt({
    harnessRoot: config.harnessRoot,
    cwd,
    activeSkills: Array.from(new Set([...config.defaultSkills, ...skills])),
    approvalMode: config.approvalMode,
    pinInfo,
  });

  const agent = new OmegaAgent(config.apiKey);
  await agent.sendTurn(fullPrompt, {
    provider: config.provider,
    endpoint: config.endpoint,
    apiKey: config.apiKey,
    model: config.model,
    systemInstruction,
    toolContext: {
      cwd,
      harnessRoot: config.harnessRoot,
      omcPath: config.omcPath,
      approvalMode: config.approvalMode,
    },
    callbacks: {
      onTextDelta: (chunk) => process.stdout.write(chunk),
      onToolStart: (ev) => {
        process.stderr.write(chalk.gray(`[${SYMBOL} tool] ${ev.name}(${ev.argsPreview})\n`));
      },
      onToolUpdate: (ev) => {
        if (ev.status === 'error' || ev.status === 'denied') {
          process.stderr.write(chalk.red(`[${SYMBOL} ${ev.status}] ${ev.name}: ${ev.preview || ''}\n`));
        }
      },
      onRequestApproval: async () => {
        return config.approvalMode === 'yolo' ? 'allow' : 'deny';
      },
    },
  });
  process.stdout.write('\n');
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const cwd = process.cwd();

  if (args.help) {
    printHelp();
    return;
  }

  if (args.version) {
    console.log(`${SYMBOL} omega-harness-cli ${CLI_VERSION}`);
    return;
  }

  if (args.configSubcommand) {
    const { action, key, value } = args.configSubcommand;
    if (action === 'path') {
      console.log(getConfigPath());
      return;
    }
    if (action === 'set' && key && value) {
      if (
        key === 'provider' ||
        key === 'endpoint' ||
        key === 'apiKey' ||
        key === 'model' ||
        key === 'approvalMode' ||
        key === 'omcPath'
      ) {
        writePersistedConfig({ [key]: value });
        console.log(`${SYMBOL} saved ${key} in ${getConfigPath()}`);
        return;
      }
      console.error(`Unknown config key: ${key}. Valid keys: provider, endpoint, apiKey, model, approvalMode, omcPath`);
      process.exit(1);
    }
    if (action === 'get' && key) {
      const cfg = loadConfig();
      const raw = (cfg as unknown as Record<string, unknown>)[key];
      if (key === 'apiKey' && typeof raw === 'string') {
        console.log(`${raw.slice(0, 6)}…${raw.slice(-4)}`);
      } else {
        console.log(raw ?? '(unset)');
      }
      return;
    }
    console.error('Usage: omega config [path | get <key> | set <key> <value>]');
    process.exit(1);
  }

  const config = loadConfig({
    provider: args.provider,
    endpoint: args.endpoint,
    model: args.model,
    apiKey: args.apiKey,
    approvalMode: args.approvalMode,
  });

  if (args.stackCommand === 'rebuild') {
    const res = rebuildSparkInkling(args.sparkHost);
    console.log(res.output);
    return;
  }

  if (args.stackCommand === 'down') {
    stackDown({ sparkHost: args.sparkHost, endpoint: config.endpoint, apiKey: config.apiKey });
    return;
  }

  if (args.stackCommand === 'up') {
    const ok = await stackUp({
      sparkHost: args.sparkHost,
      endpoint: config.endpoint,
      apiKey: config.apiKey,
      rebuild: args.rebuildOnUp,
    });
    if (!ok) process.exit(1);
    if (!args.launchAfterUp) return;
  }

  if (args.showStatus) {
    const h = await probeInkling(config.endpoint, config.apiKey);
    console.log(`${SYMBOL} Provider:     ${config.provider}`);
    console.log(`  Inkling URL:  ${h.endpoint}`);
    console.log(`  Status:       ${h.online ? chalk.green('ONLINE') : chalk.red(`OFFLINE (${h.error || 'unreachable'})`)}`);
    console.log(`  Engine:       ${h.engine}`);
    console.log(`  Model:        ${h.model || config.model}`);
    if (h.contextWindow !== undefined) {
      console.log(`  Context:      ${h.contextWindow.toLocaleString()} tokens/slot`);
    }
    if (h.kvPrefixHits !== undefined) {
      console.log(`  KV Cache:     ${h.kvPrefixHits} prefix hits`);
    }
    if (h.slotsMax !== undefined) {
      console.log(`  KV Slots:     ${h.slotsActive ?? 0} / ${h.slotsMax} active`);
    }
    if (h.arborisTransitions !== undefined) {
      const denom = Math.max(1, h.arborisTransitions * 8);
      const pct8 = h.arborisTransitions > 0 ? ((100 * (h.arborisTop8Hits ?? 0)) / denom).toFixed(1) : '0.0';
      const pct16 = h.arborisTransitions > 0 ? ((100 * (h.arborisTop16Hits ?? 0)) / denom).toFixed(1) : '0.0';
      console.log(`  Arboris:      ACTIVE (transitions=${h.arborisTransitions}, top8=${pct8}%, top16=${pct16}%)`);
    }
    if (!h.online) {
      console.log(chalk.gray('  Tunnel Spark: ssh -N -L 8080:127.0.0.1:8080 spark'));
      process.exitCode = 1;
    }
    return;
  }

  if (args.listTools) {
    console.log(chalk.cyan.bold(`${SYMBOL} Omega Harness Agent Tools (${TOOL_DECLARATIONS.length})`));
    for (const t of TOOL_DECLARATIONS) {
      console.log(`  ${chalk.bold((t.name || '').padEnd(26))} ${chalk.gray(t.description || '')}`);
    }
    return;
  }

  if (args.listSkills) {
    const skills = discoverSkills(config.harnessRoot);
    console.log(chalk.cyan.bold(`${SYMBOL} Omega Harness Skills (${skills.length})`));
    for (const s of skills) {
      console.log(`  ${chalk.bold(s.name.padEnd(22))} ${chalk.gray(s.description)}`);
    }
    return;
  }

  if (args.showPin) {
    const pin = readPinInfo(config.harnessRoot, config.omcPath);
    console.log(`${SYMBOL} Harness root:    ${config.harnessRoot}`);
    console.log(`  PIN omega-mv:    ${pin.omegaMvCommit || '(missing)'}`);
    console.log(`  PIN omc-sha256:  ${pin.omcSha256 || '(missing)'}`);
    console.log(`  Local omc:       ${pin.localOmcPath || '(not found)'}`);
    console.log(`  Local sha256:    ${pin.localOmcSha256 || '(n/a)'}`);
    console.log(`  Match:           ${pin.pinMatches === undefined ? 'unknown' : pin.pinMatches ? 'EXACT MATCH' : 'DIFFERENT (local/macOS build)'}`);
    return;
  }

  if (args.prompt !== undefined) {
    await runHeadless(args.prompt, config, cwd, args.skills);
    return;
  }

  const initialPrompt = args.positional.length > 0 ? args.positional.join(' ') : undefined;
  render(
    <App
      config={config}
      cwd={cwd}
      initialPrompt={initialPrompt}
      initialSkills={args.skills}
      resumeSession={args.resumeSession}
    />
  );
}

main().catch((err) => {
  console.error(`${SYMBOL} fatal:`, err instanceof Error ? err.message : err);
  process.exit(1);
});
