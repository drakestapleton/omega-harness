import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { detectHarnessRoot, detectOmcPath, loadConfig } from '../config.js';
import { discoverSkills, loadErrorTable, readPinInfo } from '../harness.js';
import { executeTool, needsApproval } from '../tools.js';
import { OmegaAgent, expandAtMentions } from '../agent.js';
import { matchSlashCommands } from '../commands.js';
import { SYMBOL, renderBanner } from '../brand.js';
import {
  buildNativeServePayload,
  parseInklingTokens,
  probeInkling,
} from '../inkling.js';

const harnessRoot = detectHarnessRoot();

test('brand renders custom Ω symbol and banner', () => {
  assert.equal(SYMBOL, 'Ω');
  const lines = renderBanner(80);
  assert.ok(lines.length >= 3);
  const compact = renderBanner(40);
  assert.ok(compact.length >= 3);
});

test('default config points to Inkling-2-Mini', () => {
  const cfg = loadConfig();
  assert.equal(cfg.provider, 'inkling');
  assert.equal(cfg.model, 'inkling-2-mini');
  assert.match(cfg.endpoint, /^http:\/\/127\.0\.0\.1:8080/);
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

test('Inkling token parser extracts thinking, tool calls, and clean text', () => {
  const raw =
    '<|content_thinking|>Need to inspect PIN.<|end_message|>' +
    '<|message_model|>omega_pin<|content_invoke_tool_json|>{"name":"omega_pin","args":{}}<|end_message|>' +
    '<|content_text|>Checking the pin now.<|end_message|><|content_model_end_sampling|>';
  const parsed = parseInklingTokens(raw);
  assert.equal(parsed.thinking, 'Need to inspect PIN.');
  assert.equal(parsed.text, 'Checking the pin now.');
  assert.equal(parsed.toolCalls.length, 1);
  assert.equal(parsed.toolCalls[0].name, 'omega_pin');
});

test('buildNativeServePayload sanitizes quotes for serve_live.om slFindContent', () => {
  const body = buildNativeServePayload('inkling-2-mini', 'Say "hello"\nworld');
  const parsed = JSON.parse(body) as { messages: Array<{ content: string }> };
  assert.equal(parsed.messages[0].content, "Say 'hello' world");
});

test('Inkling client talks to native inkling2-serve and retries 503 server_busy', async () => {
  let chatAttempts = 0;
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', model: 'inkling-2-mini', slots_max: 8, slots_active: 1 }));
      return;
    }
    if (req.method === 'POST' && req.url === '/v1/chat/completions') {
      chatAttempts++;
      if (chatAttempts === 1) {
        res.writeHead(503, { 'Content-Type': 'application/json', 'Retry-After': '0' });
        res.end(JSON.stringify({ error: { type: 'server_busy', slots_max: 8 } }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          id: 'cmpl-ik2',
          object: 'chat.completion',
          model: 'inkling-2-mini',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'The capital of France is Paris.' },
              finish_reason: 'stop',
            },
          ],
        })
      );
      return;
    }
    res.writeHead(404);
    res.end();
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  assert.ok(addr && typeof addr === 'object');
  const endpoint = `http://127.0.0.1:${addr.port}`;

  try {
    const health = await probeInkling(endpoint);
    assert.equal(health.online, true);
    assert.equal(health.engine, 'inkling2-serve');
    assert.equal(health.slotsMax, 8);
    assert.equal(health.slotsActive, 1);

    const agent = new OmegaAgent();
    let streamed = '';
    const reply = await agent.sendTurn('What is the capital of France?', {
      provider: 'inkling',
      endpoint,
      model: 'inkling-2-mini',
      systemInstruction: 'sys',
      toolContext: { cwd: process.cwd(), harnessRoot, approvalMode: 'default' },
      callbacks: {
        onTextDelta: (c) => {
          streamed += c;
        },
        onToolStart: () => {},
        onToolUpdate: () => {},
        onRequestApproval: async () => 'allow',
      },
    });
    assert.equal(chatAttempts, 2, 'should retry once on 503 server_busy');
    assert.equal(reply, 'The capital of France is Paris.');
    assert.equal(streamed, 'The capital of France is Paris.');
  } finally {
    server.close();
  }
});

test('Inkling client handles OpenAI-compat SSE streaming and tool calls', async () => {
  let round = 0;
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', model: 'inkling-2-mini' }));
      return;
    }
    if (req.method === 'POST' && req.url === '/v1/chat/completions') {
      round++;
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      if (round === 1) {
        res.write(
          `data: ${JSON.stringify({
            choices: [
              {
                delta: {
                  tool_calls: [
                    { index: 0, id: 'call_1', function: { name: 'list_skills', arguments: '{}' } },
                  ],
                },
              },
            ],
          })}\n\n`
        );
        res.write('data: [DONE]\n\n');
        res.end();
      } else {
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Loaded ' } }] })}\n\n`);
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'skills.' } }] })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
      }
      return;
    }
    res.writeHead(404);
    res.end();
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  assert.ok(addr && typeof addr === 'object');
  const endpoint = `http://127.0.0.1:${addr.port}`;

  try {
    const agent = new OmegaAgent();
    const toolsSeen: string[] = [];
    const reply = await agent.sendTurn('list skills', {
      provider: 'inkling',
      endpoint,
      model: 'inkling-2-mini',
      systemInstruction: 'sys',
      toolContext: { cwd: process.cwd(), harnessRoot, approvalMode: 'default' },
      callbacks: {
        onTextDelta: () => {},
        onToolStart: (ev) => toolsSeen.push(ev.name),
        onToolUpdate: () => {},
        onRequestApproval: async () => 'allow',
      },
    });
    assert.deepEqual(toolsSeen, ['list_skills']);
    assert.equal(reply, 'Loaded skills.');
  } finally {
    server.close();
  }
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
  assert.equal(needsApproval('auto-edit', 'auto-edit'), true);
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
  const m = matchSlashCommands('/st');
  assert.ok(m.some((c) => c.name === '/status'));
  assert.ok(m.some((c) => c.name === '/stats'));
  assert.equal(matchSlashCommands('hello').length, 0);
});

test('CLI binary smoke tests (--version, --help, --skills, --pin)', () => {
  const bin = path.resolve(harnessRoot, 'cli', 'dist', 'index.js');
  const ver = execFileSync(process.execPath, [bin, '--version'], { encoding: 'utf8' });
  assert.match(ver, /Ω omega-harness-cli/);

  const help = execFileSync(process.execPath, [bin, '--help'], { encoding: 'utf8' });
  assert.match(help, /Inkling-2-Mini/);

  const sk = execFileSync(process.execPath, [bin, '--skills'], { encoding: 'utf8' });
  assert.match(sk, /omega-harness/);

  const pinOut = execFileSync(process.execPath, [bin, '--pin'], { encoding: 'utf8' });
  assert.match(pinOut, /PIN omega-mv:/);
});
