import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export interface SkillMeta {
  name: string;
  description: string;
  filePath: string;
}

export interface PinInfo {
  omegaMvCommit?: string;
  omcSha256?: string;
  localOmcPath?: string;
  localOmcSha256?: string;
  pinMatches?: boolean;
}

export interface OmcErrorDoc {
  code: number;
  meaning: string;
  cause?: string;
  fix?: string;
}

export interface OmcCompileResult {
  ok: boolean;
  exitCode: number;
  stderr: string;
  outputPath?: string;
  binarySize?: number;
  errorCode?: number;
  errorDoc?: OmcErrorDoc;
  omcPath?: string;
}

export interface OmcRunResult {
  compile: OmcCompileResult;
  ran: boolean;
  exitCode?: number;
  signal?: string | null;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
}

export function readPinInfo(harnessRoot: string, omcPath?: string): PinInfo {
  const info: PinInfo = { localOmcPath: omcPath };
  const pinFile = path.join(harnessRoot, 'PIN');
  try {
    const raw = fs.readFileSync(pinFile, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const m1 = line.match(/^omega-mv\s+(\S+)/);
      if (m1) info.omegaMvCommit = m1[1];
      const m2 = line.match(/^omc-sha256\s+(\S+)/);
      if (m2) info.omcSha256 = m2[1];
    }
  } catch {
    // PIN missing
  }

  if (omcPath) {
    try {
      const real = fs.realpathSync(omcPath);
      const buf = fs.readFileSync(real);
      info.localOmcSha256 = crypto.createHash('sha256').update(buf).digest('hex');
      if (info.omcSha256) {
        info.pinMatches = info.localOmcSha256 === info.omcSha256;
      }
    } catch {
      // unreadable
    }
  }
  return info;
}

function parseFrontmatter(content: string): { name?: string; description?: string } {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const fm = m[1];
  const nameMatch = fm.match(/^name:\s*(.+)$/m);
  let desc = '';
  const descIdx = fm.search(/^description:/m);
  if (descIdx >= 0) {
    const after = fm.slice(descIdx).replace(/^description:\s*/, '');
    const firstLine = after.split(/\r?\n/)[0].trim();
    if (firstLine === '>' || firstLine === '>-' || firstLine === '|' || firstLine === '|-') {
      const lines = after.split(/\r?\n/).slice(1);
      const collected: string[] = [];
      for (const l of lines) {
        if (/^\s+/.test(l)) {
          collected.push(l.trim());
        } else {
          break;
        }
      }
      desc = collected.join(' ');
    } else {
      desc = firstLine.replace(/^["']|["']$/g, '');
    }
  }
  return {
    name: nameMatch ? nameMatch[1].trim().replace(/^["']|["']$/g, '') : undefined,
    description: desc || undefined,
  };
}

export function discoverSkills(harnessRoot: string): SkillMeta[] {
  const skillsDir = path.join(harnessRoot, 'skills');
  const results: SkillMeta[] = [];
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(skillsDir, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillPath = path.join(skillsDir, entry.name, 'SKILL.md');
    if (!fs.existsSync(skillPath)) continue;
    try {
      const content = fs.readFileSync(skillPath, 'utf8');
      const fm = parseFrontmatter(content);
      results.push({
        name: fm.name || entry.name,
        description: fm.description || 'Omega Harness skill',
        filePath: skillPath,
      });
    } catch {
      // skip unreadable
    }
  }

  return results.sort((a, b) => a.name.localeCompare(b.name));
}

export function readSkillContent(harnessRoot: string, skillName: string): { meta: SkillMeta; content: string } | null {
  const skills = discoverSkills(harnessRoot);
  const match = skills.find(
    (s) => s.name === skillName || s.name.toLowerCase() === skillName.toLowerCase()
  );
  if (!match) return null;
  const content = fs.readFileSync(match.filePath, 'utf8');
  return { meta: match, content };
}

export function loadErrorTable(harnessRoot: string): Map<number, OmcErrorDoc> {
  const table = new Map<number, OmcErrorDoc>();
  const refPath = path.join(harnessRoot, 'data', 'reference.tsv');
  let raw = '';
  try {
    raw = fs.readFileSync(refPath, 'utf8');
  } catch {
    return table;
  }

  for (const line of raw.split(/\r?\n/)) {
    const tab = line.indexOf('\t');
    if (tab < 0) continue;
    const key = line.slice(0, tab);
    const val = line.slice(tab + 1);
    const m = key.match(/^\/errors\/(\d+)\/(meaning|cause|fix)$/);
    if (!m) continue;
    const code = Number(m[1]);
    const field = m[2] as 'meaning' | 'cause' | 'fix';
    const doc = table.get(code) || { code, meaning: '' };
    doc[field] = val;
    table.set(code, doc);
  }
  return table;
}

export function compileOmFile(
  sourcePath: string,
  opts: { omcPath?: string; harnessRoot: string; outputPath?: string }
): OmcCompileResult {
  if (!opts.omcPath) {
    return {
      ok: false,
      exitCode: 127,
      stderr: 'omc compiler binary not found. Set OMEGA_OMC or install omc into ~/.local/bin/omc.',
    };
  }
  if (!fs.existsSync(sourcePath)) {
    return {
      ok: false,
      exitCode: 1,
      stderr: `Source file not found: ${sourcePath}`,
      omcPath: opts.omcPath,
    };
  }

  const src = fs.readFileSync(sourcePath);
  const tmpOut =
    opts.outputPath ||
    path.join(os.tmpdir(), `omega-cli-${process.pid}-${Date.now()}.bin`);

  const res = spawnSync(opts.omcPath, [], {
    input: src,
    maxBuffer: 64 * 1024 * 1024,
    timeout: 30_000,
  });

  const stderr = res.stderr ? res.stderr.toString('utf8').trim() : '';
  const exitCode = res.status ?? 1;

  if (exitCode !== 0) {
    const errMatch = stderr.match(/error\s+(\d+)/);
    const errorCode = errMatch ? Number(errMatch[1]) : undefined;
    let errorDoc: OmcErrorDoc | undefined;
    if (errorCode !== undefined) {
      errorDoc = loadErrorTable(opts.harnessRoot).get(errorCode);
    }
    return {
      ok: false,
      exitCode,
      stderr,
      errorCode,
      errorDoc,
      omcPath: opts.omcPath,
    };
  }

  const bin = res.stdout || Buffer.alloc(0);
  fs.writeFileSync(tmpOut, bin, { mode: 0o755 });
  return {
    ok: true,
    exitCode: 0,
    stderr,
    outputPath: tmpOut,
    binarySize: bin.length,
    omcPath: opts.omcPath,
  };
}

export function compileAndRunOmFile(
  sourcePath: string,
  opts: { omcPath?: string; harnessRoot: string; stdin?: string; timeoutMs?: number }
): OmcRunResult {
  const compile = compileOmFile(sourcePath, {
    omcPath: opts.omcPath,
    harnessRoot: opts.harnessRoot,
  });
  if (!compile.ok || !compile.outputPath) {
    return { compile, ran: false, stdout: '', stderr: compile.stderr };
  }

  try {
    const run = spawnSync(compile.outputPath, [], {
      input: opts.stdin ?? '',
      encoding: 'utf8',
      timeout: opts.timeoutMs ?? 10_000,
      maxBuffer: 16 * 1024 * 1024,
    });
    const timedOut = Boolean(run.error && (run.error as NodeJS.ErrnoException).code === 'ETIMEDOUT');
    return {
      compile,
      ran: true,
      exitCode: run.status ?? undefined,
      signal: run.signal,
      stdout: run.stdout || '',
      stderr: run.stderr || (run.error ? String(run.error.message) : ''),
      timedOut,
    };
  } finally {
    try {
      fs.unlinkSync(compile.outputPath);
    } catch {
      // ignore cleanup error
    }
  }
}

export function buildSystemPrompt(opts: {
  harnessRoot: string;
  cwd: string;
  activeSkills: string[];
  approvalMode: string;
  pinInfo: PinInfo;
}): string {
  const skills = discoverSkills(opts.harnessRoot);
  const skillNames = skills.map((s) => s.name).join(', ');

  const loadedSkillBlocks: string[] = [];
  for (const name of opts.activeSkills) {
    const loaded = readSkillContent(opts.harnessRoot, name);
    if (loaded) {
      const body =
        loaded.content.length > 16000
          ? loaded.content.slice(0, 16000) + '\n...[truncated; use read_file for full skill]...'
          : loaded.content;
      loadedSkillBlocks.push(`### Active Skill: ${loaded.meta.name}\n\n${body}`);
    }
  }

  const omegaOnlyNote =
    opts.approvalMode === 'omega-only'
      ? ' OMEGA-ONLY MODE: write/edit only .om files and NOTES.md.'
      : '';

  return [
    `You are Ω Omega Harness CLI, Drake Stapleton's systems-engineering coding agent (Inkling-2-Mini on GB10).`,
    `cwd: ${opts.cwd} | harness: ${opts.harnessRoot} | mode: ${opts.approvalMode}.${omegaOnlyNote}`,
    `Use your tools (files, shell, git, web, todo, memory, omc, spawn_subagent, spawn_parallel_subagents) to verify facts and execute work. Never fabricate outputs. Interplane is the canonical forge.`,
    `Available skills (use load_skill): ${skillNames || 'none'}.`,
    ...(loadedSkillBlocks.length > 0 ? ['', ...loadedSkillBlocks] : []),
  ].join('\n');
}
