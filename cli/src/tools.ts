import fs from 'node:fs';
import path from 'node:path';
import { execSync, spawnSync } from 'node:child_process';
import { Type, type FunctionDeclaration } from '@google/genai';
import type { ApprovalMode } from './config.js';
import {
  compileAndRunOmFile,
  compileOmFile,
  discoverSkills,
  readPinInfo,
  readSkillContent,
} from './harness.js';

export interface ToolContext {
  cwd: string;
  harnessRoot: string;
  omcPath?: string;
  approvalMode: ApprovalMode;
}

export interface ToolExecutionResult {
  ok: boolean;
  output: string;
  preview: string;
}

export const READ_ONLY_TOOLS = new Set([
  'read_file',
  'list_dir',
  'glob_files',
  'grep_search',
  'list_skills',
  'load_skill',
  'omega_pin',
  'omc_compile',
]);

export const EDIT_TOOLS = new Set(['write_file', 'edit_file']);

export function needsApproval(toolName: string, mode: ApprovalMode): boolean {
  if (mode === 'yolo') return false;
  if (READ_ONLY_TOOLS.has(toolName)) return false;
  if (mode === 'auto-edit' && EDIT_TOOLS.has(toolName)) return false;
  if (mode === 'omega-only' && EDIT_TOOLS.has(toolName)) return false;
  return true;
}

export const TOOL_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: 'read_file',
    description: 'Read a text file from disk. Optionally specify 1-based start_line and end_line.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        path: { type: Type.STRING, description: 'Absolute or workspace-relative file path' },
        start_line: { type: Type.INTEGER, description: '1-based start line (optional)' },
        end_line: { type: Type.INTEGER, description: '1-based inclusive end line (optional)' },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Create or overwrite a file with the given content. Creates parent directories automatically.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        path: { type: Type.STRING, description: 'Absolute or workspace-relative file path' },
        content: { type: Type.STRING, description: 'Full file contents to write' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'edit_file',
    description: 'Replace an exact contiguous block of text in an existing file.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        path: { type: Type.STRING, description: 'Absolute or workspace-relative file path' },
        target: { type: Type.STRING, description: 'Exact existing text to replace' },
        replacement: { type: Type.STRING, description: 'Replacement text' },
      },
      required: ['path', 'target', 'replacement'],
    },
  },
  {
    name: 'list_dir',
    description: 'List files and subdirectories in a directory.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        path: { type: Type.STRING, description: 'Directory path (defaults to current working directory)' },
      },
    },
  },
  {
    name: 'glob_files',
    description: 'Find files matching a substring or wildcard pattern (e.g. "*.om", "src/**/*.ts").',
    parameters: {
      type: Type.OBJECT,
      properties: {
        pattern: { type: Type.STRING, description: 'Glob pattern to match relative paths' },
        dir: { type: Type.STRING, description: 'Base directory (defaults to cwd)' },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'grep_search',
    description: 'Search for a text or regex pattern across files in the workspace.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: { type: Type.STRING, description: 'Search text or regex pattern' },
        dir: { type: Type.STRING, description: 'Directory to search (defaults to cwd)' },
        glob: { type: Type.STRING, description: 'Optional filename filter (e.g. "*.om")' },
      },
      required: ['query'],
    },
  },
  {
    name: 'run_shell',
    description: 'Execute a shell command in the working directory and return exit code, stdout, and stderr.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        command: { type: Type.STRING, description: 'Shell command to execute' },
        timeout_ms: { type: Type.INTEGER, description: 'Timeout in milliseconds (default 30000)' },
      },
      required: ['command'],
    },
  },
  {
    name: 'list_skills',
    description: 'List all available Omega Harness skills and their descriptions.',
    parameters: {
      type: Type.OBJECT,
      properties: {},
    },
  },
  {
    name: 'load_skill',
    description: 'Load the full instructions of an Omega Harness skill by name (e.g. "writing-omega", "omega-encoding", "omega-harness").',
    parameters: {
      type: Type.OBJECT,
      properties: {
        name: { type: Type.STRING, description: 'Skill name' },
      },
      required: ['name'],
    },
  },
  {
    name: 'omc_compile',
    description: 'Compile an Omega (.om) source file with the local omc compiler. Automatically enriches any error N with meaning/cause/fix from omega-harness/data/reference.tsv.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        path: { type: Type.STRING, description: 'Path to the .om file' },
        output: { type: Type.STRING, description: 'Optional output binary path' },
      },
      required: ['path'],
    },
  },
  {
    name: 'omc_run',
    description: 'Compile and execute an Omega (.om) file, returning compiler diagnostics, exit status, stdout, and stderr.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        path: { type: Type.STRING, description: 'Path to the .om file' },
        stdin: { type: Type.STRING, description: 'Optional standard input string' },
        timeout_ms: { type: Type.INTEGER, description: 'Execution timeout in ms (default 10000)' },
      },
      required: ['path'],
    },
  },
  {
    name: 'omega_pin',
    description: 'Inspect omega-harness PIN and compare it against the local omc binary sha256.',
    parameters: {
      type: Type.OBJECT,
      properties: {},
    },
  },
];

function resolvePath(cwd: string, p?: string): string {
  if (!p) return cwd;
  if (p.startsWith('~/')) {
    return path.join(process.env.HOME || '', p.slice(2));
  }
  return path.isAbsolute(p) ? p : path.resolve(cwd, p);
}

function makePreview(text: string, maxLines = 4, maxChars = 260): string {
  const trimmed = text.trim();
  if (!trimmed) return '(empty output)';
  const lines = trimmed.split(/\r?\n/);
  const head = lines.slice(0, maxLines).join('\n');
  const truncated = head.length > maxChars ? head.slice(0, maxChars) + '…' : head;
  if (lines.length > maxLines) {
    return `${truncated}\n… (+${lines.length - maxLines} more lines)`;
  }
  return truncated;
}

function isAllowedInOmegaOnly(filePath: string): boolean {
  const base = path.basename(filePath);
  return base.endsWith('.om') || base === 'NOTES.md';
}

function formatOmcCompileFeedback(res: ReturnType<typeof compileOmFile>): string {
  if (res.ok) {
    return `omc compile PASS (${res.binarySize ?? 0} bytes${res.outputPath ? `, out=${res.outputPath}` : ''})`;
  }
  const parts = [`omc compile FAIL (exit ${res.exitCode}): ${res.stderr}`];
  if (res.errorDoc) {
    parts.push(`error ${res.errorDoc.code} meaning: ${res.errorDoc.meaning}`);
    if (res.errorDoc.cause) parts.push(`cause: ${res.errorDoc.cause}`);
    if (res.errorDoc.fix) parts.push(`fix: ${res.errorDoc.fix}`);
  }
  return parts.join('\n');
}

function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '___GLOBSTAR___')
    .replace(/\*/g, '[^/]*')
    .replace(/___GLOBSTAR___/g, '.*')
    .replace(/\?/g, '[^/]');
  return new RegExp(`^${escaped}$`);
}

function walkFiles(baseDir: string, maxFiles = 2000): string[] {
  const out: string[] = [];
  const skip = new Set(['.git', 'node_modules', 'dist', 'build', '.next', 'target']);

  function visit(dir: string) {
    if (out.length >= maxFiles) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (out.length >= maxFiles) return;
      if (skip.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(full);
      } else if (entry.isFile()) {
        out.push(path.relative(baseDir, full));
      }
    }
  }

  visit(baseDir);
  return out;
}

export function formatToolArgsPreview(name: string, args: Record<string, unknown>): string {
  const pick = (k: string) => (args[k] !== undefined ? String(args[k]) : undefined);
  switch (name) {
    case 'read_file':
    case 'write_file':
    case 'edit_file':
    case 'omc_compile':
    case 'omc_run':
      return pick('path') || '';
    case 'run_shell': {
      const cmd = pick('command') || '';
      return cmd.length > 72 ? cmd.slice(0, 69) + '...' : cmd;
    }
    case 'grep_search':
      return `"${pick('query') || ''}"${args.dir ? ` in ${pick('dir')}` : ''}`;
    case 'glob_files':
      return pick('pattern') || '';
    case 'load_skill':
      return pick('name') || '';
    case 'list_dir':
      return pick('path') || '.';
    default:
      return Object.keys(args).length ? JSON.stringify(args).slice(0, 60) : '';
  }
}

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext
): Promise<ToolExecutionResult> {
  try {
    switch (name) {
      case 'read_file': {
        const target = resolvePath(ctx.cwd, String(args.path || ''));
        if (!fs.existsSync(target)) {
          return { ok: false, output: `File not found: ${target}`, preview: `File not found: ${target}` };
        }
        const stat = fs.statSync(target);
        if (stat.isDirectory()) {
          return { ok: false, output: `Path is a directory: ${target}`, preview: `Path is a directory` };
        }
        const content = fs.readFileSync(target, 'utf8');
        const lines = content.split(/\r?\n/);
        const start = Math.max(1, Number(args.start_line || 1));
        const end = Math.min(lines.length, Number(args.end_line || Math.min(lines.length, start + 399)));
        const slice = lines.slice(start - 1, end).map((l, idx) => `${start + idx}: ${l}`).join('\n');
        const header = `File: ${target} (lines ${start}-${end} of ${lines.length})\n`;
        const output = header + slice;
        return { ok: true, output, preview: `Read ${end - start + 1} lines of ${path.basename(target)}` };
      }

      case 'write_file': {
        const target = resolvePath(ctx.cwd, String(args.path || ''));
        if (ctx.approvalMode === 'omega-only' && !isAllowedInOmegaOnly(target)) {
          const msg = `REFUSED (omega-only mode): Only .om files and NOTES.md may be written. Blocked: ${target}`;
          return { ok: false, output: msg, preview: msg };
        }
        const content = String(args.content ?? '');
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, content, 'utf8');
        const lineCount = content.split(/\r?\n/).length;
        let output = `Wrote ${target} (${lineCount} lines, ${Buffer.byteLength(content, 'utf8')} bytes).`;

        if (target.endsWith('.om') && ctx.omcPath) {
          const comp = compileOmFile(target, { omcPath: ctx.omcPath, harnessRoot: ctx.harnessRoot });
          if (comp.outputPath) {
            try { fs.unlinkSync(comp.outputPath); } catch { /* ignore */ }
          }
          output += '\n' + formatOmcCompileFeedback(comp);
        }
        return { ok: true, output, preview: makePreview(output, 3) };
      }

      case 'edit_file': {
        const target = resolvePath(ctx.cwd, String(args.path || ''));
        if (ctx.approvalMode === 'omega-only' && !isAllowedInOmegaOnly(target)) {
          const msg = `REFUSED (omega-only mode): Only .om files and NOTES.md may be edited. Blocked: ${target}`;
          return { ok: false, output: msg, preview: msg };
        }
        if (!fs.existsSync(target)) {
          return { ok: false, output: `File not found: ${target}`, preview: `File not found` };
        }
        const oldText = fs.readFileSync(target, 'utf8');
        const needle = String(args.target ?? '');
        const repl = String(args.replacement ?? '');
        if (!needle || !oldText.includes(needle)) {
          return {
            ok: false,
            output: `Target block not found in ${target}. Read the file first to verify exact text.`,
            preview: 'Target block not found',
          };
        }
        const occurrences = oldText.split(needle).length - 1;
        const newText = oldText.split(needle).join(repl);
        fs.writeFileSync(target, newText, 'utf8');
        let output = `Edited ${target} (${occurrences} replacement${occurrences === 1 ? '' : 's'}).`;

        if (target.endsWith('.om') && ctx.omcPath) {
          const comp = compileOmFile(target, { omcPath: ctx.omcPath, harnessRoot: ctx.harnessRoot });
          if (comp.outputPath) {
            try { fs.unlinkSync(comp.outputPath); } catch { /* ignore */ }
          }
          output += '\n' + formatOmcCompileFeedback(comp);
        }
        return { ok: true, output, preview: makePreview(output, 3) };
      }

      case 'list_dir': {
        const dir = resolvePath(ctx.cwd, args.path ? String(args.path) : undefined);
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        const rows = entries
          .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
          .map((e) => (e.isDirectory() ? `${e.name}/` : e.name));
        const output = rows.join('\n') || '(empty directory)';
        return { ok: true, output, preview: `${rows.length} entries in ${path.basename(dir) || dir}` };
      }

      case 'glob_files': {
        const base = resolvePath(ctx.cwd, args.dir ? String(args.dir) : undefined);
        const pattern = String(args.pattern || '*');
        const regex = globToRegex(pattern.includes('/') ? pattern : `**/${pattern}`);
        const baseRegex = globToRegex(pattern);
        const files = walkFiles(base).filter((f) => regex.test(f) || baseRegex.test(f) || baseRegex.test(path.basename(f)));
        const output = files.slice(0, 200).join('\n') || '(no matches)';
        return { ok: true, output, preview: `${files.length} file${files.length === 1 ? '' : 's'} matched` };
      }

      case 'grep_search': {
        const base = resolvePath(ctx.cwd, args.dir ? String(args.dir) : undefined);
        const query = String(args.query || '');
        const glob = args.glob ? String(args.glob) : undefined;
        // Prefer ripgrep if installed
        const rgArgs = ['-n', '--max-count', '50', '--max-filesize', '2M'];
        if (glob) rgArgs.push('-g', glob);
        rgArgs.push(query, base);
        const rg = spawnSync('rg', rgArgs, { encoding: 'utf8', timeout: 15_000, maxBuffer: 8 * 1024 * 1024 });
        if (!rg.error) {
          const out = (rg.stdout || '').trim();
          const lines = out ? out.split(/\r?\n/) : [];
          const capped = lines.slice(0, 120).join('\n') || '(no matches)';
          return { ok: true, output: capped, preview: `${lines.length} match${lines.length === 1 ? '' : 'es'}` };
        }

        // Pure Node fallback
        const files = walkFiles(base, 1000);
        const re = new RegExp(query, 'i');
        const hits: string[] = [];
        for (const rel of files) {
          if (hits.length >= 120) break;
          if (glob && !globToRegex(glob).test(path.basename(rel))) continue;
          try {
            const text = fs.readFileSync(path.join(base, rel), 'utf8');
            const lines = text.split(/\r?\n/);
            for (let i = 0; i < lines.length; i++) {
              if (re.test(lines[i])) {
                hits.push(`${rel}:${i + 1}:${lines[i]}`);
                if (hits.length >= 120) break;
              }
            }
          } catch {
            // ignore binary/unreadable
          }
        }
        const output = hits.join('\n') || '(no matches)';
        return { ok: true, output, preview: `${hits.length} match${hits.length === 1 ? '' : 'es'}` };
      }

      case 'run_shell': {
        const command = String(args.command || '');
        const timeout = Math.min(300_000, Math.max(1000, Number(args.timeout_ms || 30_000)));
        try {
          const stdout = execSync(command, {
            cwd: ctx.cwd,
            encoding: 'utf8',
            timeout,
            maxBuffer: 16 * 1024 * 1024,
            stdio: ['ignore', 'pipe', 'pipe'],
          });
          const output = stdout.trim() || '(command exited 0 with no output)';
          return { ok: true, output, preview: makePreview(output, 4) };
        } catch (err: unknown) {
          const e = err as { status?: number; stdout?: string; stderr?: string; message?: string };
          const combined = [
            `Exit code: ${e.status ?? 1}`,
            e.stdout ? `STDOUT:\n${String(e.stdout).trim()}` : '',
            e.stderr ? `STDERR:\n${String(e.stderr).trim()}` : '',
          ]
            .filter(Boolean)
            .join('\n');
          return { ok: false, output: combined || String(e.message || err), preview: makePreview(combined, 4) };
        }
      }

      case 'list_skills': {
        const skills = discoverSkills(ctx.harnessRoot);
        const output = skills.map((s) => `- ${s.name}: ${s.description}`).join('\n') || '(no skills found)';
        return { ok: true, output, preview: `${skills.length} skills available` };
      }

      case 'load_skill': {
        const skillName = String(args.name || '');
        const loaded = readSkillContent(ctx.harnessRoot, skillName);
        if (!loaded) {
          const avail = discoverSkills(ctx.harnessRoot).map((s) => s.name).join(', ');
          return {
            ok: false,
            output: `Skill "${skillName}" not found. Available: ${avail}`,
            preview: `Skill "${skillName}" not found`,
          };
        }
        return {
          ok: true,
          output: `# Skill: ${loaded.meta.name} (${loaded.meta.filePath})\n\n${loaded.content}`,
          preview: `Loaded skill ${loaded.meta.name} (${loaded.content.length} chars)`,
        };
      }

      case 'omc_compile': {
        const target = resolvePath(ctx.cwd, String(args.path || ''));
        const outPath = args.output ? resolvePath(ctx.cwd, String(args.output)) : undefined;
        const res = compileOmFile(target, {
          omcPath: ctx.omcPath,
          harnessRoot: ctx.harnessRoot,
          outputPath: outPath,
        });
        if (!outPath && res.outputPath) {
          try { fs.unlinkSync(res.outputPath); } catch { /* ignore */ }
        }
        const output = formatOmcCompileFeedback(res);
        return { ok: res.ok, output, preview: makePreview(output, 3) };
      }

      case 'omc_run': {
        const target = resolvePath(ctx.cwd, String(args.path || ''));
        const res = compileAndRunOmFile(target, {
          omcPath: ctx.omcPath,
          harnessRoot: ctx.harnessRoot,
          stdin: args.stdin !== undefined ? String(args.stdin) : '',
          timeoutMs: Number(args.timeout_ms || 10_000),
        });
        if (!res.compile.ok) {
          const msg = formatOmcCompileFeedback(res.compile);
          return { ok: false, output: msg, preview: makePreview(msg, 3) };
        }
        const parts = [
          `compile: PASS (${res.compile.binarySize} bytes)`,
          `run: exit=${res.exitCode ?? 'null'}${res.signal ? ` signal=${res.signal}` : ''}${res.timedOut ? ' TIMED_OUT' : ''}`,
        ];
        if (res.stdout) parts.push(`STDOUT:\n${res.stdout}`);
        if (res.stderr) parts.push(`STDERR:\n${res.stderr}`);
        const output = parts.join('\n');
        return {
          ok: res.exitCode === 0 && !res.timedOut,
          output,
          preview: makePreview(output, 4),
        };
      }

      case 'omega_pin': {
        const pin = readPinInfo(ctx.harnessRoot, ctx.omcPath);
        const lines = [
          `harness root: ${ctx.harnessRoot}`,
          `PIN omega-mv: ${pin.omegaMvCommit || '(missing)'}`,
          `PIN omc-sha256: ${pin.omcSha256 || '(missing)'}`,
          `local omc: ${pin.localOmcPath || '(not found)'}`,
          `local omc sha256: ${pin.localOmcSha256 || '(n/a)'}`,
          `pin match: ${pin.pinMatches === undefined ? 'unknown' : pin.pinMatches ? 'EXACT MATCH' : 'DIFFERENT (local/macOS build)'}`,
        ];
        const output = lines.join('\n');
        return { ok: true, output, preview: `PIN ${pin.omegaMvCommit?.slice(0, 8) || '?'} · omc ${pin.localOmcPath ? 'found' : 'missing'}` };
      }

      default:
        return { ok: false, output: `Unknown tool: ${name}`, preview: `Unknown tool: ${name}` };
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, output: `Tool error (${name}): ${msg}`, preview: msg };
  }
}
