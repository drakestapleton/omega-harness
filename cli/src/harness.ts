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
  const skillIndex = skills
    .map((s) => `- **${s.name}**: ${s.description}`)
    .join('\n');

  const loadedSkillBlocks: string[] = [];
  for (const name of opts.activeSkills) {
    const loaded = readSkillContent(opts.harnessRoot, name);
    if (loaded) {
      // Keep active skill content bounded so we leave room for conversation
      const body =
        loaded.content.length > 24000
          ? loaded.content.slice(0, 24000) + '\n\n...[truncated; use read_file for full skill]...'
          : loaded.content;
      loadedSkillBlocks.push(`### Active Skill: ${loaded.meta.name}\n\n${body}`);
    }
  }

  const omcStatus = opts.pinInfo.localOmcPath
    ? `available at ${opts.pinInfo.localOmcPath}${opts.pinInfo.pinMatches ? ' (matches PIN)' : ' (local build; differs from Linux AArch64 PIN)'}`
    : 'not detected on PATH';

  const omegaOnlyNote =
    opts.approvalMode === 'omega-only'
      ? '\n- **OMEGA-ONLY MODE ACTIVE**: You may only write/edit `.om` files and `NOTES.md`. Every `.om` write is automatically compiled with `omc`.'
      : '';

  return [
    `You are Ω Omega Harness CLI, Drake Stapleton's systems-engineering coding agent for Omega (.om) and the AIEN ecosystem.`,
    ``,
    `## Operating Environment`,
    `- Working directory: \`${opts.cwd}\``,
    `- Omega Harness root: \`${opts.harnessRoot}\``,
    `- Local \`omc\` compiler: ${omcStatus}`,
    `- Approval mode: \`${opts.approvalMode}\`${omegaOnlyNote}`,
    ``,
    `## Core Discipline`,
    `- Follow Human-Directed Agentic Engineering (HDAE): inspect actual source files before editing, verify with real tool runs, and never fabricate compiler or test output.`,
    `- Separate status labels strictly: PROPOSED, IMPLEMENTED, HOST_TESTED, EXERCISED, QUALIFIED, NOT_RUN, BLOCKED_HARDWARE.`,
    `- Interplane (https://interplane.io) is the canonical forge. Never push to GitHub unless explicitly requested.`,
    `- For Omega (.om) tasks, call \`load_skill\` on \`writing-omega\` or \`omega-encoding\` before writing non-trivial \`.om\`, and verify with \`omc_compile\` / \`omc_run\`.`,
    `- Be concise, direct, and actionable. Cite file paths clearly.`,
    ``,
    `## Available Omega Harness Skills (call \`load_skill\` when relevant)`,
    skillIndex || '(no skills found)',
    ...(loadedSkillBlocks.length > 0
      ? ['', '## Pinned Skills for This Session', ...loadedSkillBlocks]
      : []),
  ].join('\n');
}
