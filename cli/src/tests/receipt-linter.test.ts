import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execFile, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { detectHarnessRoot } from '../config.js';

const execFileAsync = promisify(execFile);

async function runCliAsync(
  bin: string,
  args: string[]
): Promise<{ status: number; stdout: string; stderr: string }> {
  try {
    const res = await execFileAsync(process.execPath, [bin, ...args], { encoding: 'utf8' });
    return { status: 0, stdout: res.stdout, stderr: res.stderr };
  } catch (err: unknown) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    return {
      status: typeof e.code === 'number' ? e.code : 1,
      stdout: e.stdout || '',
      stderr: e.stderr || '',
    };
  }
}
import {
  HES_128_MAX_LOG2_Q,
  extractUrlsFromText,
  getHes128MaxLog2Q,
  lintPrePublishUrls,
  lintReceiptFile,
  lintReceiptObject,
  lintReceiptText,
} from '../receipt-linter.js';
import { executeTool, needsApproval } from '../tools.js';

const harnessRoot = detectHarnessRoot();
const fixturesDir = path.resolve(harnessRoot, 'cli', 'src', 'tests', 'fixtures');
const lintCliBin = path.resolve(harnessRoot, 'cli', 'dist', 'receipt-lint-cli.js');
const omegaCliBin = path.resolve(harnessRoot, 'cli', 'dist', 'index.js');

function fixture(name: string): string {
  return path.join(fixturesDir, name);
}

// ============================================================================
// LANE 1A: RLWE / BFV / FHE Parameter Floor Guardrails
// ============================================================================

test('HES v1.1 128-bit table bounds match standard values', () => {
  assert.equal(HES_128_MAX_LOG2_Q.ternary[2048], 54);
  assert.equal(HES_128_MAX_LOG2_Q.ternary[4096], 109);
  assert.equal(HES_128_MAX_LOG2_Q.ternary[8192], 218);
  assert.equal(HES_128_MAX_LOG2_Q.ternary[16384], 438);
  assert.equal(HES_128_MAX_LOG2_Q.ternary[32768], 881);
  assert.equal(getHes128MaxLog2Q(64, 'ternary'), null);
  assert.equal(getHes128MaxLog2Q(3000, 'ternary'), null);
  assert.equal(getHes128MaxLog2Q(4096, 'uniform'), 111);
  assert.equal(getHes128MaxLog2Q(65536, 'ternary'), 1762);
});

test('NEGATIVE CONTROL: deliberately weak N=64 FHE receipt is hard-rejected', () => {
  const report = lintReceiptFile(fixture('fhe-weak-n64.json'));
  assert.equal(report.ok, false);
  assert.ok(report.errorCount >= 1);
  assert.ok(report.findings.some((f) => f.code === 'FHE_RING_BELOW_FLOOR'));

  // CLI binary must exit 1 and emit valid JSON on failure
  const cli = spawnSync(process.execPath, [lintCliBin, 'check', fixture('fhe-weak-n64.json'), '--json'], {
    encoding: 'utf8',
  });
  assert.equal(cli.status, 1, `expected exit 1, got ${cli.status}: ${cli.stdout} ${cli.stderr}`);
  const parsed = JSON.parse(cli.stdout) as { ok: boolean; errorCount: number };
  assert.equal(parsed.ok, false);
  assert.ok(parsed.errorCount >= 1);
});

test('FHE Depth>=2 with N=2048 and HES 128-bit log2(Q) overflow are hard-rejected', () => {
  const depthFail = lintReceiptObject({
    category: 'rlwe_fhe',
    N: 2048,
    log2_q: 54,
    depth: 2,
    verdict: 'PASS',
  });
  assert.equal(depthFail.ok, false);
  assert.ok(depthFail.findings.some((f) => f.code === 'FHE_DEPTH_RING_FLOOR'));

  const hesOverflow = lintReceiptObject({
    category: 'rlwe_fhe',
    N: 4096,
    log2_q: 150,
    depth: 2,
    secret_distribution: 'ternary',
    verdict: 'PASS',
  });
  assert.equal(hesOverflow.ok, false);
  assert.ok(hesOverflow.findings.some((f) => f.code === 'FHE_HES_128_EXCEEDED'));

  // PROTOTYPE_ALGEBRA_ONLY cannot be combined with a cryptographic security claim
  const conflated = lintReceiptObject({
    category: 'rlwe_fhe',
    N: 64,
    log2_q: 29,
    tag: 'PROTOTYPE_ALGEBRA_ONLY',
    claims_crypto_security: true,
  });
  assert.equal(conflated.ok, false);
  assert.ok(conflated.findings.some((f) => f.code === 'FHE_PROTOTYPE_SECURITY_CONFLATION'));
});

test('Valid HES 128-bit FHE receipt and honest PROTOTYPE_ALGEBRA_ONLY N=64 receipt pass', () => {
  const valid = lintReceiptFile(fixture('fhe-valid-hes128.json'));
  assert.equal(valid.ok, true, JSON.stringify(valid.findings));
  assert.equal(valid.errorCount, 0);

  const proto = lintReceiptFile(fixture('fhe-prototype-n64.json'));
  assert.equal(proto.ok, true, JSON.stringify(proto.findings));
  assert.ok(proto.findings.some((f) => f.code === 'FHE_PROTOTYPE_ALGEBRA_TAGGED'));
});

// ============================================================================
// LANE 1B: ZK-STARK Soundness & Extension-Field Guardrails
// ============================================================================

test('NEGATIVE CONTROL: deliberately weak 16-query STARK receipt is hard-rejected', () => {
  const report = lintReceiptFile(fixture('stark-weak-16queries.json'));
  assert.equal(report.ok, false);
  assert.ok(report.findings.some((f) => f.code === 'STARK_MISSING_PROVEN_JOHNSON_SOUNDNESS'));
  assert.ok(report.findings.some((f) => f.code === 'STARK_EXTENSION_FIELD_REQUIRED'));
  assert.ok(report.findings.some((f) => f.code === 'STARK_SOUNDNESS_BELOW_100_BITS'));

  const cli = spawnSync(
    process.execPath,
    [lintCliBin, 'check', fixture('stark-weak-16queries.json'), '--json'],
    { encoding: 'utf8' }
  );
  assert.equal(cli.status, 1);
  const parsed = JSON.parse(cli.stdout) as { ok: boolean; errorCount: number };
  assert.equal(parsed.ok, false);
  assert.ok(parsed.errorCount >= 3);
});

test('STARK math overclaim and base-field challenges over 64-bit Goldilocks are hard-rejected', () => {
  // 16 queries * log2(8)=3 => max 48 conjectured / 24 Johnson; claiming 128/100 is fabricated
  const overclaim = lintReceiptObject({
    category: 'zk_stark',
    base_field_bits: 64,
    challenge_field: 'F_{p^2}',
    fri_queries: 16,
    blowup_factor: 8,
    conjectured_soundness_bits: 128,
    proven_johnson_bits: 100,
  });
  assert.equal(overclaim.ok, false);
  assert.ok(overclaim.findings.some((f) => f.code === 'STARK_CONJECTURED_MATH_OVERCLAIM'));
  assert.ok(overclaim.findings.some((f) => f.code === 'STARK_JOHNSON_MATH_OVERCLAIM'));

  // 64-bit base field without extension field fails even with many queries
  const baseOnly = lintReceiptObject({
    category: 'zk_stark',
    base_field_bits: 64,
    challenge_field: 'F_p',
    fri_queries: 80,
    blowup_factor: 8,
    conjectured_soundness_bits: 64,
    proven_johnson_bits: 64,
  });
  assert.equal(baseOnly.ok, false);
  assert.ok(baseOnly.findings.some((f) => f.code === 'STARK_EXTENSION_FIELD_REQUIRED'));
  assert.ok(baseOnly.findings.some((f) => f.code === 'STARK_SOUNDNESS_BELOW_100_BITS'));
});

test('Valid >=100-bit F_{p^2} STARK and honest PROTOTYPE_ONLY 16-query STARK pass', () => {
  const valid = lintReceiptFile(fixture('stark-valid-100bit.json'));
  assert.equal(valid.ok, true, JSON.stringify(valid.findings));

  const proto = lintReceiptFile(fixture('stark-prototype-16queries.json'));
  assert.equal(proto.ok, true, JSON.stringify(proto.findings));
  assert.ok(proto.findings.some((f) => f.code === 'STARK_PROTOTYPE_ONLY_TAGGED'));
});

// ============================================================================
// LANE 1C: Lean 4 Proof Verification Guardrails
// ============================================================================

test('NEGATIVE CONTROL: sorry-containing Lean 4 receipt is hard-rejected even when success:true', () => {
  const report = lintReceiptFile(fixture('lean-sorry.json'));
  assert.equal(report.ok, false);
  assert.ok(report.findings.some((f) => f.code === 'LEAN_SORRY_FORBIDDEN'));
  assert.ok(report.findings.some((f) => f.code === 'LEAN_SORRY_AXIOM_DETECTED'));
  assert.ok(report.findings.some((f) => f.code === 'LEAN_NEGATIVE_CONTROL_MISSING'));

  const cli = spawnSync(process.execPath, [lintCliBin, 'check', fixture('lean-sorry.json'), '--json'], {
    encoding: 'utf8',
  });
  assert.equal(cli.status, 1);
  const parsed = JSON.parse(cli.stdout) as { ok: boolean; errorCount: number };
  assert.equal(parsed.ok, false);
  assert.ok(parsed.errorCount >= 3);
});

test('Lean 4 native_decide, non-standard axioms, and missing/vacuous negative controls are hard-rejected', () => {
  const nativeDecide = lintReceiptObject({
    category: 'lean4',
    theorem: 't',
    sorry_count: 0,
    native_decide_count: 1,
    trust: 'native',
    axioms: ['propext', 'Lean.ofReduceBool', 'Lean.trustCompiler'],
    broken_model_controls: [{ name: 'bad', refuted: true }],
  });
  assert.equal(nativeDecide.ok, false);
  assert.ok(nativeDecide.findings.some((f) => f.code === 'LEAN_NATIVE_DECIDE_FORBIDDEN'));
  assert.ok(nativeDecide.findings.some((f) => f.code === 'LEAN_NATIVE_DECIDE_AXIOM_DETECTED'));

  const customAxiom = lintReceiptObject({
    category: 'lean4',
    theorem: 't',
    sorry_count: 0,
    native_decide_count: 0,
    axioms: ['propext', 'MyRepo.assumed_soundness'],
    broken_model_controls: [{ name: 'bad', refuted: true }],
  });
  assert.equal(customAxiom.ok, false);
  assert.ok(customAxiom.findings.some((f) => f.code === 'LEAN_NONSTANDARD_AXIOM'));

  const vacuousControl = lintReceiptObject({
    category: 'lean4',
    theorem: 't',
    sorry_count: 0,
    native_decide_count: 0,
    axioms: ['propext'],
    broken_model_controls: [{ name: 'bad', refuted: false, status: 'VACUOUS' }],
  });
  assert.equal(vacuousControl.ok, false);
  assert.ok(vacuousControl.findings.some((f) => f.code === 'LEAN_NEGATIVE_CONTROL_FAILED'));
});

test('Valid Lean 4 receipt (0 sorry, 0 native_decide, standard axioms, broken-model control) passes', () => {
  const valid = lintReceiptFile(fixture('lean-valid.json'));
  assert.equal(valid.ok, true, JSON.stringify(valid.findings));
  assert.equal(valid.errorCount, 0);
});

// ============================================================================
// LANE 2A: Silicon Scope & Honesty Linter (GPU Receipts)
// ============================================================================

test('NEGATIVE CONTROL: 512B micro-kernel conflated as FULL_WORKLOAD_GPU_PASS is hard-rejected', () => {
  const report = lintReceiptFile(fixture('gpu-conflated-512b.json'));
  assert.equal(report.ok, false);
  assert.ok(report.findings.some((f) => f.code === 'GPU_MICROKERNEL_CONFLATED_AS_FULL_WORKLOAD'));
});

test('GPU bare PASS without workload scope, missing XID_DELTA, nonzero XID_DELTA, and verdict contradictions are rejected', () => {
  const barePass = lintReceiptObject({
    category: 'gpu_silicon',
    verdict: 'PASS',
    xid_delta: 0,
  });
  assert.equal(barePass.ok, false);
  assert.ok(barePass.findings.some((f) => f.code === 'GPU_SCOPE_LABEL_MISSING'));

  const noXid = lintReceiptObject({
    category: 'gpu_silicon',
    verdict: 'PASS',
    workload_scope: 'MICROKERNEL_SASS_PASS',
    workload_kind: 'microkernel',
    payload_bytes: 512,
  });
  assert.equal(noXid.ok, false);
  assert.ok(noXid.findings.some((f) => f.code === 'GPU_XID_TELEMETRY_MISSING'));

  const badXid = lintReceiptObject({
    category: 'gpu_silicon',
    verdict: 'PASS',
    workload_scope: 'MICROKERNEL_SASS_PASS',
    workload_kind: 'microkernel',
    payload_bytes: 512,
    xid_delta: 2,
  });
  assert.equal(badXid.ok, false);
  assert.ok(badXid.findings.some((f) => f.code === 'GPU_XID_NONZERO'));

  const contradiction = lintReceiptObject({
    category: 'gpu_silicon',
    verdict: 'BLOCKED_HARDWARE',
    workload_scope: 'FULL_WORKLOAD_GPU_PASS',
  });
  assert.equal(contradiction.ok, false);
  assert.ok(contradiction.findings.some((f) => f.code === 'GPU_VERDICT_SCOPE_CONTRADICTION'));
});

test('Valid MICROKERNEL_SASS_PASS, FULL_WORKLOAD_GPU_PASS, and BLOCKED_HARDWARE receipts pass', () => {
  assert.equal(lintReceiptFile(fixture('gpu-valid-microkernel.json')).ok, true);
  assert.equal(lintReceiptFile(fixture('gpu-valid-full-workload.json')).ok, true);
  assert.equal(lintReceiptFile(fixture('gpu-blocked-hardware.json')).ok, true);
});

test('Markdown/plain-text receipt linting catches weak FHE, 16-query STARK, sorry Lean, and 512B GPU conflation', () => {
  const mdFhe = lintReceiptText('BFV RLWE benchmark: N=64, log2(Q)=29 — 128-bit secure PASS');
  assert.equal(mdFhe.ok, false);
  assert.ok(mdFhe.findings.some((f) => f.code === 'FHE_RING_BELOW_FLOOR'));

  const mdStark = lintReceiptText('ZK-STARK over Goldilocks 64-bit F_p: 16-query blowup=8 conjectured_soundness_bits=48 PASS');
  assert.equal(mdStark.ok, false);
  assert.ok(mdStark.findings.some((f) => f.code === 'STARK_MISSING_PROVEN_JOHNSON_SOUNDNESS'));

  const mdLean = lintReceiptText("Lean 4 verification: theorem foo := sorry\n'foo' depends on axioms: [sorryAx]");
  assert.equal(mdLean.ok, false);
  assert.ok(mdLean.findings.some((f) => f.code === 'LEAN_SORRY_FORBIDDEN'));

  const mdGpu = lintReceiptText('GB10 sm_121 FULL_WORKLOAD_GPU_PASS: 512B arithmetic micro-kernel XID_DELTA=0');
  assert.equal(mdGpu.ok, false);
  assert.ok(mdGpu.findings.some((f) => f.code === 'GPU_MICROKERNEL_CONFLATED_AS_FULL_WORKLOAD'));
});

// ============================================================================
// LANE 2B: Pre-Publish External URL HTTP 200 Verifier & Agent Tool Wiring
// ============================================================================

test('Pre-publish URL checker extracts links, falls back HEAD->GET on 405, and hard-rejects non-200 URLs', async () => {
  const server = http.createServer((req, res) => {
    if (req.url === '/ok') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok');
      return;
    }
    if (req.url === '/redirect') {
      res.writeHead(301, { Location: '/ok' });
      res.end();
      return;
    }
    if (req.url === '/get-only') {
      if (req.method === 'HEAD') {
        res.writeHead(405);
        res.end();
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('get ok');
      return;
    }
    if (req.url === '/missing') {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    res.writeHead(500);
    res.end('err');
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  assert.ok(addr && typeof addr === 'object');
  const base = `http://127.0.0.1:${addr.port}`;

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-url-lint-'));
  try {
    // Template placeholders are skipped cleanly
    const extracted = extractUrlsFromText(
      `Clone https://interplane.io/projects/<repo>/repo.git and visit [ok](${base}/ok).`,
      { skipLocalhost: false }
    );
    assert.deepEqual(extracted, [`${base}/ok`]);

    const goodMd = path.join(tmp, 'GOOD_RELEASE.md');
    fs.writeFileSync(
      goodMd,
      `# Release\n- [Interplane](${base}/ok)\n- [Redirect](${base}/redirect)\n- [Git mirror](${base}/get-only)\n`
    );
    const goodRep = await lintPrePublishUrls([goodMd], { skipLocalhost: false, timeoutMs: 3000 });
    assert.equal(goodRep.ok, true, JSON.stringify(goodRep.results));
    assert.equal(goodRep.passed, 3);
    assert.equal(goodRep.failed, 0);

    const badMd = path.join(tmp, 'BAD_RELEASE.md');
    fs.writeFileSync(
      badMd,
      `# Release\n- [Live](${base}/ok)\n- [Broken 404](${base}/missing)\n- [Server 500](${base}/boom)\n`
    );
    const badRep = await lintPrePublishUrls([badMd], { skipLocalhost: false, timeoutMs: 3000 });
    assert.equal(badRep.ok, false);
    assert.equal(badRep.passed, 1);
    assert.equal(badRep.failed, 2);
    assert.ok(badRep.findings.every((f) => f.code === 'URL_HTTP_NOT_200'));

    // Standalone CLI hard-rejects badMd with exit 1 and valid JSON
    const badCli = await runCliAsync(lintCliBin, [
      'urls',
      badMd,
      '--allow-localhost',
      '--timeout-ms',
      '3000',
      '--json',
    ]);
    assert.equal(badCli.status, 1);
    const badJson = JSON.parse(badCli.stdout) as { ok: boolean; failed: number };
    assert.equal(badJson.ok, false);
    assert.equal(badJson.failed, 2);

    const goodCli = await runCliAsync(lintCliBin, [
      'urls',
      goodMd,
      '--allow-localhost',
      '--timeout-ms',
      '3000',
      '--json',
    ]);
    assert.equal(goodCli.status, 0);
    const goodJson = JSON.parse(goodCli.stdout) as { ok: boolean; passed: number };
    assert.equal(goodJson.ok, true);
    assert.equal(goodJson.passed, 3);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    server.close();
  }
});

test('Agent tools lint_receipt and check_publish_urls are read-only and enforce audit rejections', async () => {
  assert.equal(needsApproval('lint_receipt', 'default'), false);
  assert.equal(needsApproval('check_publish_urls', 'default'), false);

  const roCtx = {
    cwd: harnessRoot,
    harnessRoot,
    approvalMode: 'default' as const,
    readOnlyOnly: true,
  };

  const rejected = await executeTool('lint_receipt', { path: fixture('fhe-weak-n64.json') }, roCtx);
  assert.equal(rejected.ok, false);
  assert.match(rejected.output, /FHE_RING_BELOW_FLOOR/);

  const accepted = await executeTool('lint_receipt', { path: fixture('lean-valid.json') }, roCtx);
  assert.equal(accepted.ok, true);
  assert.match(accepted.output, /RECEIPT_LINT PASS/);

  // omega CLI subcommand wiring
  const omegaReject = spawnSync(
    process.execPath,
    [omegaCliBin, 'lint-receipt', fixture('lean-sorry.json'), '--json'],
    { encoding: 'utf8' }
  );
  assert.equal(omegaReject.status, 1);
  const parsed = JSON.parse(omegaReject.stdout) as { ok: boolean };
  assert.equal(parsed.ok, false);
});
