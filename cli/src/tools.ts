import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, execSync, spawnSync } from 'node:child_process';
import { Type, type FunctionDeclaration } from '@google/genai';
import type { ApprovalMode } from './config.js';
import {
  compileAndRunOmFile,
  compileOmFile,
  discoverSkills,
  readPinInfo,
  readSkillContent,
} from './harness.js';
import {
  SessionState,
  formatMemories,
  saveMemory,
  type TodoItem,
} from './state.js';

export interface ToolContext {
  cwd: string;
  harnessRoot: string;
  omcPath?: string;
  approvalMode: ApprovalMode;
  state?: SessionState;
  readOnlyOnly?: boolean;
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
  'git_status',
  'git_diff',
  'git_log',
  'web_fetch',
  'web_search',
  'todo_read',
  'todo_write',
  'memory_read',
  'memory_save',
  'list_subagents',
  'spawn_subagent',
  'spawn_parallel_subagents',
  'message_subagent',
  'list_skills',
  'load_skill',
  'omega_pin',
  'omc_compile',
]);

export const EDIT_TOOLS = new Set(['write_file', 'edit_file', 'delete_file']);

export function needsApproval(toolName: string, mode: ApprovalMode): boolean {
  if (mode === 'yolo') return false;
  if (READ_ONLY_TOOLS.has(toolName)) return false;
  if (mode === 'auto-edit' && EDIT_TOOLS.has(toolName)) return false;
  if (mode === 'omega-only' && EDIT_TOOLS.has(toolName)) return false;
  return true;
}

export const TOOL_DECLARATIONS: FunctionDeclaration[] = [
  // File & Code tools
  {
    name: 'read_file',
    description: 'Read a text file from disk with optional 1-based start_line and end_line.',
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
    name: 'delete_file',
    description: 'Delete a file from disk.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        path: { type: Type.STRING, description: 'File path to delete' },
      },
      required: ['path'],
    },
  },
  {
    name: 'list_dir',
    description: 'List files and subdirectories in a directory.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        path: { type: Type.STRING, description: 'Directory path (defaults to cwd)' },
      },
    },
  },
  {
    name: 'glob_files',
    description: 'Find files matching a wildcard pattern (e.g. "*.om", "src/**/*.ts").',
    parameters: {
      type: Type.OBJECT,
      properties: {
        pattern: { type: Type.STRING, description: 'Glob pattern' },
        dir: { type: Type.STRING, description: 'Base directory (defaults to cwd)' },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'grep_search',
    description: 'Search for text or regex across workspace files.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: { type: Type.STRING, description: 'Search text or regex' },
        dir: { type: Type.STRING, description: 'Directory to search (defaults to cwd)' },
        glob: { type: Type.STRING, description: 'Optional filename filter (e.g. "*.om")' },
      },
      required: ['query'],
    },
  },

  // Execution & Git tools
  {
    name: 'run_shell',
    description: 'Execute a shell command in cwd and return exit code, stdout, and stderr.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        command: { type: Type.STRING, description: 'Shell command to run' },
        timeout_ms: { type: Type.INTEGER, description: 'Timeout in ms (default 30000)' },
      },
      required: ['command'],
    },
  },
  {
    name: 'git_status',
    description: 'Show git branch and short working-tree status.',
    parameters: { type: Type.OBJECT, properties: {} },
  },
  {
    name: 'git_diff',
    description: 'Show git diff for unstaged or staged changes.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        path: { type: Type.STRING, description: 'Optional file path filter' },
        staged: { type: Type.BOOLEAN, description: 'If true, show staged diff (--cached)' },
      },
    },
  },
  {
    name: 'git_log',
    description: 'Show recent git commit history.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        count: { type: Type.INTEGER, description: 'Number of commits (default 10)' },
      },
    },
  },
  {
    name: 'git_commit',
    description: 'Stage specified files (or all modified files) and create a git commit.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        message: { type: Type.STRING, description: 'Commit message' },
        files: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: 'Optional list of file paths to stage (defaults to git add -u)',
        },
      },
      required: ['message'],
    },
  },

  // Web tools
  {
    name: 'web_fetch',
    description: 'Fetch a URL over HTTP/HTTPS and return clean readable text.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        url: { type: Type.STRING, description: 'HTTP or HTTPS URL to fetch' },
        max_chars: { type: Type.INTEGER, description: 'Max characters to return (default 8000)' },
      },
      required: ['url'],
    },
  },
  {
    name: 'web_search',
    description: 'Search the web and return top results with titles, URLs, and snippets.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: { type: Type.STRING, description: 'Search query' },
        max_results: { type: Type.INTEGER, description: 'Max results (default 5)' },
      },
      required: ['query'],
    },
  },

  // Task Planning & Persistent Memory tools
  {
    name: 'todo_write',
    description: 'Create or update the session task checklist.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        items: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING },
              title: { type: Type.STRING },
              status: { type: Type.STRING, description: 'pending | in_progress | completed' },
            },
            required: ['title'],
          },
          description: 'List of todo items',
        },
      },
      required: ['items'],
    },
  },
  {
    name: 'todo_read',
    description: 'Read the current session task checklist.',
    parameters: { type: Type.OBJECT, properties: {} },
  },
  {
    name: 'memory_save',
    description: 'Save a persistent key-value memory across sessions.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        key: { type: Type.STRING, description: 'Short memory key' },
        value: { type: Type.STRING, description: 'Fact or preference to remember' },
      },
      required: ['key', 'value'],
    },
  },
  {
    name: 'memory_read',
    description: 'Read one or all persistent memories.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        key: { type: Type.STRING, description: 'Optional specific memory key' },
      },
    },
  },

  // Subagent & Multi-Agent Delegation tools (runs Inkling-2-Mini subagents!)
  {
    name: 'spawn_subagent',
    description: 'Spin up an autonomous subagent using the same model (Inkling-2-Mini / Gemini) in an isolated context to research, audit, or execute a subtask and return its result.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        role: { type: Type.STRING, description: 'Short role title (e.g. "Codebase Researcher", "Verifier")' },
        task: { type: Type.STRING, description: 'Clear actionable instructions for the subagent' },
        mode: { type: Type.STRING, description: '"read-only" (default) or "full"' },
      },
      required: ['role', 'task'],
    },
  },
  {
    name: 'spawn_parallel_subagents',
    description: 'Launch multiple subagents concurrently (leveraging inkling2-serve N=8 KV slots) and aggregate all results.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        tasks: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              role: { type: Type.STRING },
              task: { type: Type.STRING },
              mode: { type: Type.STRING },
            },
            required: ['role', 'task'],
          },
          description: 'Array of subagent specifications to execute in parallel',
        },
      },
      required: ['tasks'],
    },
  },
  {
    name: 'list_subagents',
    description: 'List all subagents spawned in this session with their status and summaries.',
    parameters: { type: Type.OBJECT, properties: {} },
  },
  {
    name: 'message_subagent',
    description: 'Send a follow-up task or question to an existing subagent by ID.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        id: { type: Type.STRING, description: 'Subagent ID from spawn_subagent or list_subagents' },
        message: { type: Type.STRING, description: 'Follow-up prompt for the subagent' },
      },
      required: ['id', 'message'],
    },
  },

  // Omega Harness Native tools
  {
    name: 'list_skills',
    description: 'List all available Omega Harness skills and their descriptions.',
    parameters: { type: Type.OBJECT, properties: {} },
  },
  {
    name: 'load_skill',
    description: 'Load the full instructions of an Omega Harness skill by name.',
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
    description: 'Compile an Omega (.om) source file with local omc and enrich error N from reference.tsv.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        path: { type: Type.STRING, description: 'Path to .om file' },
        output: { type: Type.STRING, description: 'Optional output binary path' },
      },
      required: ['path'],
    },
  },
  {
    name: 'omc_run',
    description: 'Compile and execute an Omega (.om) file, returning exit code, stdout, and stderr.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        path: { type: Type.STRING, description: 'Path to .om file' },
        stdin: { type: Type.STRING, description: 'Optional stdin string' },
        timeout_ms: { type: Type.INTEGER, description: 'Execution timeout in ms (default 10000)' },
      },
      required: ['path'],
    },
  },
  {
    name: 'omega_pin',
    description: 'Inspect omega-harness PIN and compare it against local omc sha256.',
    parameters: { type: Type.OBJECT, properties: {} },
  },
];

export const VALID_TOOL_NAMES = new Set(TOOL_DECLARATIONS.map((d) => d.name || ''));

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

export function stripHtmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseDuckDuckGoHtml(html: string, maxResults = 5): Array<{ title: string; url: string; snippet: string }> {
  const results: Array<{ title: string; url: string; snippet: string }> = [];
  const linkRe = /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  const snippetRe = /<a[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>|<div[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;

  const links: Array<{ url: string; title: string }> = [];
  for (const m of html.matchAll(linkRe)) {
    let url = m[1];
    const uddg = url.match(/uddg=([^&]+)/);
    if (uddg) {
      try {
        url = decodeURIComponent(uddg[1]);
      } catch {
        // keep original
      }
    }
    links.push({ url, title: stripHtmlToText(m[2]) });
    if (links.length >= maxResults) break;
  }

  const snippets: string[] = [];
  for (const m of html.matchAll(snippetRe)) {
    snippets.push(stripHtmlToText(m[1] || m[2] || ''));
    if (snippets.length >= maxResults) break;
  }

  for (let i = 0; i < links.length; i++) {
    results.push({
      title: links[i].title,
      url: links[i].url,
      snippet: snippets[i] || '',
    });
  }
  return results;
}

export function formatToolArgsPreview(name: string, args: Record<string, unknown>): string {
  const pick = (k: string) => (args[k] !== undefined ? String(args[k]) : undefined);
  switch (name) {
    case 'read_file':
    case 'write_file':
    case 'edit_file':
    case 'delete_file':
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
    case 'web_fetch':
      return pick('url') || '';
    case 'web_search':
      return `"${pick('query') || ''}"`;
    case 'spawn_subagent':
      return `${pick('role') || 'worker'}: ${(pick('task') || '').slice(0, 50)}`;
    case 'spawn_parallel_subagents': {
      const n = Array.isArray(args.tasks) ? args.tasks.length : 0;
      return `${n} parallel subagents`;
    }
    case 'message_subagent':
      return `${pick('id') || ''}: ${(pick('message') || '').slice(0, 40)}`;
    case 'git_commit':
      return `"${(pick('message') || '').slice(0, 50)}"`;
    case 'memory_save':
      return `${pick('key') || ''}`;
    default:
      return Object.keys(args).length ? JSON.stringify(args).slice(0, 60) : '';
  }
}

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext
): Promise<ToolExecutionResult> {
  if (ctx.readOnlyOnly && !READ_ONLY_TOOLS.has(name)) {
    const msg = `REFUSED: read-only subagent cannot invoke mutating tool "${name}".`;
    return { ok: false, output: msg, preview: msg };
  }

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
        const end = Math.min(lines.length, Number(args.end_line || Math.min(lines.length, start + 199)));
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

      case 'delete_file': {
        const target = resolvePath(ctx.cwd, String(args.path || ''));
        if (!fs.existsSync(target)) {
          return { ok: false, output: `File not found: ${target}`, preview: 'File not found' };
        }
        fs.unlinkSync(target);
        const msg = `Deleted ${target}`;
        return { ok: true, output: msg, preview: msg };
      }

      case 'list_dir': {
        const dir = resolvePath(ctx.cwd, args.path ? String(args.path) : undefined);
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        const rows = entries
          .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
          .map((e) => (e.isDirectory() ? `${e.name}/` : e.name));
        const limit = 60;
        const shown = rows.slice(0, limit);
        const suffix = rows.length > limit ? `\n... (+${rows.length - limit} more entries; use glob_files to filter)` : '';
        const output = (shown.join('\n') + suffix) || '(empty directory)';
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
        const rgArgs = ['-n', '--max-count', '50', '--max-filesize', '2M'];
        if (glob) rgArgs.push('-g', glob);
        rgArgs.push(query, base);
        const rg = spawnSync('rg', rgArgs, { encoding: 'utf8', timeout: 15_000, maxBuffer: 8 * 1024 * 1024 });
        if (!rg.error) {
          const out = (rg.stdout || '').trim();
          const lines = out ? out.split(/\r?\n/) : [];
          const capped = lines.slice(0, 40).join('\n') || '(no matches)';
          return { ok: true, output: capped, preview: `${lines.length} match${lines.length === 1 ? '' : 'es'}` };
        }
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
          } catch { /* ignore */ }
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

      case 'git_status': {
        const out = execFileSync('git', ['status', '-sb'], { cwd: ctx.cwd, encoding: 'utf8', timeout: 10_000 }).trim();
        return { ok: true, output: out || '(clean)', preview: makePreview(out, 3) };
      }

      case 'git_diff': {
        const gArgs = ['diff'];
        if (args.staged) gArgs.push('--cached');
        if (args.path) gArgs.push('--', String(args.path));
        const out = execFileSync('git', gArgs, { cwd: ctx.cwd, encoding: 'utf8', timeout: 10_000, maxBuffer: 8 * 1024 * 1024 }).trim();
        const capped = out.length > 16000 ? out.slice(0, 16000) + '\n...[diff truncated]...' : out || '(no diff)';
        return { ok: true, output: capped, preview: makePreview(capped, 4) };
      }

      case 'git_log': {
        const n = Math.min(50, Math.max(1, Number(args.count || 10)));
        const out = execFileSync('git', ['log', `-n`, String(n), '--oneline'], { cwd: ctx.cwd, encoding: 'utf8', timeout: 10_000 }).trim();
        return { ok: true, output: out || '(no commits)', preview: makePreview(out, 4) };
      }

      case 'git_commit': {
        const msg = String(args.message || '').trim();
        if (!msg) return { ok: false, output: 'Commit message is required.', preview: 'Missing commit message' };
        if (Array.isArray(args.files) && args.files.length > 0) {
          execFileSync('git', ['add', ...args.files.map(String)], { cwd: ctx.cwd, encoding: 'utf8', timeout: 10_000 });
        } else {
          execFileSync('git', ['add', '-u'], { cwd: ctx.cwd, encoding: 'utf8', timeout: 10_000 });
        }
        const out = execFileSync('git', ['commit', '-m', msg], { cwd: ctx.cwd, encoding: 'utf8', timeout: 15_000 }).trim();
        return { ok: true, output: out, preview: makePreview(out, 3) };
      }

      case 'web_fetch': {
        const url = String(args.url || '').trim();
        if (!/^https?:\/\//i.test(url)) {
          return { ok: false, output: `Invalid URL: ${url}`, preview: 'Invalid URL' };
        }
        const maxChars = Math.min(24_000, Math.max(200, Number(args.max_chars || 8000)));
        const res = await fetch(url, {
          headers: { 'User-Agent': 'Omega-Harness-CLI/0.1' },
          signal: AbortSignal.timeout(15_000),
        });
        const ct = res.headers.get('content-type') || '';
        const raw = await res.text();
        const cleaned = ct.includes('html') ? stripHtmlToText(raw) : raw;
        const body = cleaned.slice(0, maxChars);
        const output = `HTTP ${res.status} (${url})\n${body}`;
        return { ok: res.ok, output, preview: `HTTP ${res.status} · ${body.length} chars` };
      }

      case 'web_search': {
        const query = String(args.query || '').trim();
        const maxResults = Math.min(10, Math.max(1, Number(args.max_results || 5)));
        const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
        const res = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) OmegaHarness/0.1' },
          signal: AbortSignal.timeout(15_000),
        });
        if (!res.ok) {
          return { ok: false, output: `Search HTTP ${res.status}`, preview: `Search HTTP ${res.status}` };
        }
        const html = await res.text();
        const items = parseDuckDuckGoHtml(html, maxResults);
        if (items.length === 0) {
          return { ok: true, output: '(no search results found)', preview: '0 results' };
        }
        const output = items
          .map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}${r.snippet ? `\n   ${r.snippet}` : ''}`)
          .join('\n');
        return { ok: true, output, preview: `${items.length} results for "${query}"` };
      }

      case 'todo_write': {
        if (!ctx.state) return { ok: false, output: 'Session state unavailable', preview: 'No state' };
        const items = Array.isArray(args.items) ? (args.items as TodoItem[]) : [];
        ctx.state.setTodos(items);
        const out = ctx.state.formatTodos();
        return { ok: true, output: out, preview: `${items.length} tasks updated` };
      }

      case 'todo_read': {
        if (!ctx.state) return { ok: false, output: '(no tasks)', preview: '0 tasks' };
        const out = ctx.state.formatTodos();
        return { ok: true, output: out, preview: `${ctx.state.todos.length} tasks` };
      }

      case 'memory_save': {
        const key = String(args.key || '').trim();
        const val = String(args.value || '').trim();
        if (!key || !val) return { ok: false, output: 'Both key and value are required.', preview: 'Missing args' };
        saveMemory(key, val);
        return { ok: true, output: `Saved memory "${key}".`, preview: `Saved memory "${key}"` };
      }

      case 'memory_read': {
        const out = formatMemories(args.key ? String(args.key) : undefined);
        return { ok: true, output: out, preview: makePreview(out, 3) };
      }

      case 'spawn_subagent': {
        if (!ctx.state?.runSubagent) {
          return { ok: false, output: 'Subagent runner is not initialized.', preview: 'No subagent runner' };
        }
        const role = String(args.role || 'Worker');
        const task = String(args.task || '');
        const mode: 'read-only' | 'full' = args.mode === 'full' && !ctx.readOnlyOnly ? 'full' : 'read-only';
        const id = ctx.state.nextSubagentId(role);
        const rec = {
          id,
          role,
          task,
          mode,
          status: 'running' as const,
          startedAt: Date.now(),
          toolCalls: 0,
        };
        ctx.state.registerSubagent(rec);
        try {
          const res = await ctx.state.runSubagent({ id, role, task, mode });
          ctx.state.registerSubagent({
            ...rec,
            status: 'completed',
            finishedAt: Date.now(),
            toolCalls: res.toolCalls,
            result: res.text,
          });
          const out = `[Subagent ${id} (${role}) completed, ${res.toolCalls} tool calls]\n${res.text}`;
          return { ok: true, output: out, preview: `${id} done (${res.toolCalls} tools)` };
        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : String(err);
          ctx.state.registerSubagent({
            ...rec,
            status: 'failed',
            finishedAt: Date.now(),
            error: errMsg,
          });
          return { ok: false, output: `[Subagent ${id} failed]: ${errMsg}`, preview: `${id} failed` };
        }
      }

      case 'spawn_parallel_subagents': {
        if (!ctx.state?.runSubagent) {
          return { ok: false, output: 'Subagent runner is not initialized.', preview: 'No subagent runner' };
        }
        const specs = Array.isArray(args.tasks)
          ? (args.tasks as Array<{ role?: string; task?: string; mode?: string }>)
          : [];
        if (specs.length === 0) {
          return { ok: false, output: 'No tasks provided to spawn_parallel_subagents.', preview: '0 tasks' };
        }
        const results = await Promise.all(
          specs.map((s) =>
            executeTool(
              'spawn_subagent',
              { role: s.role || 'Worker', task: s.task || '', mode: s.mode || 'read-only' },
              ctx
            )
          )
        );
        const combined = results.map((r, i) => `### Subagent ${i + 1}\n${r.output}`).join('\n\n');
        const okCount = results.filter((r) => r.ok).length;
        return {
          ok: okCount > 0,
          output: combined,
          preview: `${okCount}/${results.length} parallel subagents completed`,
        };
      }

      case 'list_subagents': {
        if (!ctx.state) return { ok: true, output: '(no subagents)', preview: '0 subagents' };
        const out = ctx.state.formatSubagents();
        return { ok: true, output: out, preview: `${ctx.state.subagents.size} subagents` };
      }

      case 'message_subagent': {
        if (!ctx.state?.runSubagent) {
          return { ok: false, output: 'Subagent runner is not initialized.', preview: 'No subagent runner' };
        }
        const id = String(args.id || '');
        const existing = ctx.state.subagents.get(id);
        if (!existing) {
          return { ok: false, output: `Subagent "${id}" not found.`, preview: 'Subagent not found' };
        }
        const message = String(args.message || '');
        const res = await ctx.state.runSubagent({
          id,
          existingId: id,
          role: existing.role,
          task: message,
          mode: existing.mode,
        });
        ctx.state.registerSubagent({
          ...existing,
          status: 'completed',
          finishedAt: Date.now(),
          toolCalls: existing.toolCalls + res.toolCalls,
          result: res.text,
        });
        return { ok: true, output: `[Subagent ${id} reply]\n${res.text}`, preview: `${id} replied` };
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
