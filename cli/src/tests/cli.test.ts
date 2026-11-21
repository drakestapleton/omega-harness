import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { detectHarnessRoot, detectOmcPath } from '../config.js';
import { discoverSkills, loadErrorTable, readPinInfo } from '../harness.js';
import { executeTool, needsApproval } from '../tools.js';
import { expandAtMentions } from '../agent.js';
import { matchSlashCommands } from '../commands.js';
import { SYMBOL, renderBanner } from '../brand.js';

const harnessRoot = detectHarnessRoot();

test('brand renders custom Ω symbol and banner', () => {
  assert.equal(SYMBOL, 'Ω');
  const lines = renderBanner(80);
  assert.ok(lines.length >= 3);
  const compact = renderBanner(40);
  assert.ok(compact.length >= 3);
});

test('harness discovers skills, PIN, and error table dynamically', () => {
  const skills = discoverSkills(harnessRoot);
  assert.ok(skills.length >= 5, `expected skills in ${harnessRoot}, found ${skills.length}`);
  assert.ok(skills.some((s) => s.name === 'omega-harness'));
  assert.ok(skills.some((s) => s.name === 'writing-omega'));

  const pin = readPinInfo(harnessRoot, detectOmcPath());
  assert.ok(pin.omegaMvCommit && pin.omegaMvCommit.length === 40);
  assert.ok(pin.omcSha256 && pin.omcSha256.length === 64);

  const errors = loadErrorTable(harnessRoot);
  assert.ok(errors.size >= 20, `expected error table entries, got ${errors.size}`);
  assert.ok(errors.get(1)?.meaning);
});

test('tools read, write, edit, glob, grep, and enforce omega-only mode', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-cli-test-'));
  try {
    const ctx = {
      cwd: tmp,
      harnessRoot,
      omcPath: detectOmcPath(),
      approvalMode: 'default' as const,
    };

    const w = await executeTool('write_file', { path: 'hello.txt', content: 'alpha\nbeta\n' }, ctx);
    assert.equal(w.ok, true);

    const r = await executeTool('read_file', { path: 'hello.txt' }, ctx);
    assert.equal(r.ok, true);
    assert.match(r.output, /1: alpha/);

    const e = await executeTool('edit_file', { path: 'hello.txt', target: 'beta', replacement: 'omega' }, ctx);
    assert.equal(e.ok, true);

    const g = await executeTool('grep_search', { query: 'omega' }, ctx);
    assert.equal(g.ok, true);
    assert.match(g.output, /hello\.txt/);

    const gl = await executeTool('glob_files', { pattern: '*.txt' }, ctx);
    assert.equal(gl.ok, true);
    assert.match(gl.output, /hello\.txt/);

    // Negative control: omega-only mode refuses non-.om writes
    const omegaCtx = { ...ctx, approvalMode: 'omega-only' as const };
    const blocked = await executeTool('write_file', { path: 'bad.py', content: 'print(1)\n' }, omegaCtx);
    assert.equal(blocked.ok, false);
    assert.match(blocked.output, /REFUSED/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('approval policy classifies read-only vs mutating tools', () => {
  assert.equal(needsApproval('read_file', 'default'), false);
  assert.equal(needsApproval('omc_compile', 'default'), false);
  assert.equal(needsApproval('write_file', 'default'), true);
  assert.equal(needsApproval('write_file', 'auto-edit'), false);
  assert.equal(needsApproval('run_shell', 'auto-edit'), true);
  assert.equal(needsApproval('run_shell', 'yolo'), false);
});

test('@file mention expands attached file context', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-at-test-'));
  try {
    fs.writeFileSync(path.join(tmp, 'sample.om'), 'fn main to int\n  ret 0\nend\n');
    const res = expandAtMentions('review @sample.om please', tmp);
    assert.deepEqual(res.attachedFiles, ['sample.om']);
    assert.match(res.expanded, /<attached_file path="sample\.om">/);
    assert.match(res.expanded, /fn main to int/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('slash command matching works', () => {
  const m = matchSlashCommands('/sk');
  assert.ok(m.some((c) => c.name === '/skills'));
  assert.ok(m.some((c) => c.name === '/skill'));
  assert.equal(matchSlashCommands('hello').length, 0);
});

test('CLI binary smoke tests (--version, --help, --skills, --pin)', () => {
  const bin = path.resolve(harnessRoot, 'cli', 'dist', 'index.js');
  const ver = execFileSync(process.execPath, [bin, '--version'], { encoding: 'utf8' });
  assert.match(ver, /Ω omega-harness-cli/);

  const help = execFileSync(process.execPath, [bin, '--help'], { encoding: 'utf8' });
  assert.match(help, /Omega Harness CLI/);

  const sk = execFileSync(process.execPath, [bin, '--skills'], { encoding: 'utf8' });
  assert.match(sk, /omega-harness/);

  const pinOut = execFileSync(process.execPath, [bin, '--pin'], { encoding: 'utf8' });
  assert.match(pinOut, /PIN omega-mv:/);
});
