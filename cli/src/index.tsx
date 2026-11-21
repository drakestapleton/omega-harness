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
} from './config.js';
import {
  buildSystemPrompt,
  discoverSkills,
  readPinInfo,
} from './harness.js';
import { OmegaAgent } from './agent.js';
import { App } from './ui/App.js';

interface ParsedArgs {
  help: boolean;
  version: boolean;
  listSkills: boolean;
  showPin: boolean;
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
    showPin: false,
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

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') {
      out.help = true;
    } else if (a === '-v' || a === '--version') {
      out.version = true;
    } else if (a === '--skills') {
      out.listSkills = true;
    } else if (a === '--pin') {
      out.showPin = true;
    } else if (a === '-y' || a === '--yolo') {
      out.approvalMode = 'yolo';
    } else if (a === '--auto-edit') {
      out.approvalMode = 'auto-edit';
    } else if (a === '--omega-only') {
      out.approvalMode = 'omega-only';
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
  console.log(chalk.cyan.bold(`${SYMBOL} Omega Harness CLI v${CLI_VERSION}`) + chalk.gray(' — powered by Google GenAI SDK'));
  console.log('');
  console.log('Usage:');
  console.log('  omega [options] [initial prompt]');
  console.log('  omega -p "<prompt>"               Non-interactive headless mode (supports piped stdin)');
  console.log('  omega config set apiKey <key>     Save Gemini API key to ~/.config/omega-harness/config.json');
  console.log('  omega config set model <id>       Save default Gemini model');
  console.log('');
  console.log('Options:');
  console.log('  -m, --model <id>        Gemini model ID (default: gemini-2.5-pro)');
  console.log('  -p, --prompt <text>     Run in non-interactive mode and print response to stdout');
  console.log('  -y, --yolo              Auto-approve all tool calls');
  console.log('      --auto-edit         Auto-approve file writes and edits');
  console.log('      --omega-only        Restrict writes to .om / NOTES.md with auto-omc checks');
  console.log('  -s, --skill <name>      Pin an Omega Harness skill into the system prompt (repeatable)');
  console.log('      --skills            List all available Omega Harness skills and exit');
  console.log('      --pin               Show omega-harness PIN and local omc status and exit');
  console.log('      --api-key <key>     Override GEMINI_API_KEY for this invocation');
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
  if (!config.apiKey) {
    console.error(`${SYMBOL} error: No Gemini API key configured. Export GEMINI_API_KEY or run \`omega config set apiKey <key>\`.`);
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
        // In headless mode without --yolo, deny mutating tools safely
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
      if (key === 'apiKey' || key === 'model' || key === 'approvalMode' || key === 'omcPath') {
        writePersistedConfig({ [key]: value });
        console.log(`${SYMBOL} saved ${key} in ${getConfigPath()}`);
        return;
      }
      console.error(`Unknown config key: ${key}. Valid keys: apiKey, model, approvalMode, omcPath`);
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
    model: args.model,
    apiKey: args.apiKey,
    approvalMode: args.approvalMode,
  });

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
    />
  );
}

main().catch((err) => {
  console.error(`${SYMBOL} fatal:`, err instanceof Error ? err.message : err);
  process.exit(1);
});
