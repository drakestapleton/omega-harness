import fs from 'node:fs';
import path from 'node:path';

export type FindingSeverity = 'ERROR' | 'WARN' | 'INFO';

export type ReceiptCategory =
  | 'rlwe_fhe'
  | 'zk_stark'
  | 'lean4'
  | 'gpu_silicon'
  | 'url_prepublish'
  | 'generic';

export interface LintFinding {
  code: string;
  severity: FindingSeverity;
  category: ReceiptCategory;
  file?: string;
  message: string;
  remediation?: string;
}

export interface LintReport {
  ok: boolean;
  file?: string;
  categories: ReceiptCategory[];
  findings: LintFinding[];
  errorCount: number;
  warnCount: number;
  infoCount: number;
}

export interface BatchLintReport {
  ok: boolean;
  filesChecked: number;
  reports: LintReport[];
  errorCount: number;
  warnCount: number;
  infoCount: number;
}

export type HesSecretDistribution = 'ternary' | 'error' | 'uniform';

/**
 * Homomorphic Encryption Security Standard (HES v1.1, Albrecht et al. 2018)
 * Table 1: Maximum log2(Q) for 128-bit classical security (sigma = 3.2).
 *
 * NOTE: N = 1024 is recorded for completeness against HES, but omega-harness
 * enforces N >= 2048 (and N >= 4096 for Depth >= 2) as the minimum floor for
 * any receipt claiming cryptographic security; smaller rings must be tagged
 * strictly as PROTOTYPE_ALGEBRA_ONLY.
 */
export const HES_128_MAX_LOG2_Q: Record<HesSecretDistribution, Record<number, number>> = {
  ternary: {
    1024: 27,
    2048: 54,
    4096: 109,
    8192: 218,
    16384: 438,
    32768: 881,
  },
  error: {
    1024: 27,
    2048: 54,
    4096: 109,
    8192: 218,
    16384: 438,
    32768: 881,
  },
  uniform: {
    1024: 29,
    2048: 56,
    4096: 111,
    8192: 220,
    16384: 440,
    32768: 880,
  },
};

export const STANDARD_LEAN_AXIOMS = new Set<string>([
  'propext',
  'Classical.choice',
  'Quot.sound',
]);

export const CANONICAL_GATE_VERDICTS = new Set<string>([
  'PASS',
  'FAIL',
  'NOT_RUN',
  'BLOCKED_HARDWARE',
  'BLOCKED_OPERATOR',
  'MISSING_IMPLEMENTATION',
]);

export const GPU_PASS_SCOPES = new Set<string>([
  'MICROKERNEL_SASS_PASS',
  'FULL_WORKLOAD_GPU_PASS',
]);

const MICROKERNEL_WORKLOAD_KINDS = new Set<string>([
  'microkernel',
  'micro_kernel',
  'micro-kernel',
  'arithmetic_microkernel',
  'sass_probe',
  'probe',
  'm16_probe',
  'opcode_probe',
  'smoke',
]);

const FULL_WORKLOAD_KINDS = new Set<string>([
  'gemm',
  'gemv',
  'transformer',
  'attention',
  'flash_attention',
  'prefill',
  'decode',
  'inference',
  'training',
  'moe',
  'full_model',
  'full_workload',
]);

export const MICROKERNEL_BYTE_CEILING = 512;

export function isPowerOfTwo(n: number): boolean {
  return Number.isInteger(n) && n > 0 && (n & (n - 1)) === 0;
}

export function getHes128MaxLog2Q(
  n: number,
  dist: HesSecretDistribution = 'ternary'
): number | null {
  if (!isPowerOfTwo(n) || n < 1024) return null;
  const table = HES_128_MAX_LOG2_Q[dist];
  if (table[n] !== undefined) return table[n];
  if (n > 32768) {
    // Conservative linear scaling beyond N=32768
    return Math.floor((n / 32768) * table[32768]);
  }
  return null;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }
  return null;
}

function asNumber(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v.trim());
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function asString(v: unknown): string | undefined {
  if (typeof v === 'string') return v;
  return undefined;
}

function asBoolean(v: unknown): boolean | undefined {
  if (typeof v === 'boolean') return v;
  return undefined;
}

function collectTags(obj: Record<string, unknown>): string[] {
  const tags: string[] = [];
  for (const key of ['tag', 'scope', 'classification', 'workload_scope', 'gpu_scope', 'label', 'verdict', 'status']) {
    const val = obj[key];
    if (typeof val === 'string' && val.trim()) tags.push(val.trim());
  }
  for (const key of ['tags', 'labels', 'scopes']) {
    const arr = obj[key];
    if (Array.isArray(arr)) {
      for (const item of arr) {
        if (typeof item === 'string' && item.trim()) tags.push(item.trim());
      }
    }
  }
  return tags;
}

function collectProse(obj: Record<string, unknown>): string {
  const chunks: string[] = [];
  for (const key of ['claim', 'summary', 'notes', 'description', 'title', 'security_claim', 'output', 'log']) {
    const v = obj[key];
    if (typeof v === 'string') chunks.push(v);
  }
  return chunks.join('\n');
}

function proseClaimsCryptoSecurity(text: string): boolean {
  if (!text) return false;
  // Ignore explicit negations like "no cryptographic security" or "not cryptographically secure"
  const sanitized = text
    .replace(/\b(?:no|not|without|non[-\s]?|zero)\s+(?:cryptographic(?:ally)?|128-?bit|100-?bit|production)\s+(?:security|secure|soundness)\b/gi, '')
    .replace(/\bnot\s+for\s+cryptographic\s+use\b/gi, '');
  return (
    /\b(?:128|192|256)-?bit\s+(?:classical\s+|post-?quantum\s+)?(?:security|secure|soundness)\b/i.test(sanitized) ||
    /\b(?:cryptographic(?:ally)?\s+secure|production\s+(?:fhe|rlwe|bfv|stark|zk)\s+security|ind-?cpa\s+secure|full\s+cryptographic\s+security)\b/i.test(sanitized) ||
    /\b(?:100\+?-?bit\s+(?:proven\s+|conjectured\s+)?soundness)\b/i.test(sanitized)
  );
}

function parseExtensionDegree(raw: unknown): number | undefined {
  if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 1) return raw;
  if (typeof raw !== 'string') return undefined;
  const s = raw.trim();
  if (/^\d+$/.test(s)) return Number(s);
  // Matches F_{p^2}, F_p^2, Fp2, F_{p^3}, GF(p^2), GF(p^4), Goldilocks2, Fp^2
  const expMatch = s.match(/(?:F_?\{?p\^|GF\(p\^|Fp\^?)(\d+)\}?\)?/i);
  if (expMatch) return Number(expMatch[1]);
  const extMatch = s.match(/\b(?:quadratic|deg(?:ree)?\s*2)\b/i);
  if (extMatch) return 2;
  const cubicMatch = s.match(/\b(?:cubic|deg(?:ree)?\s*3)\b/i);
  if (cubicMatch) return 3;
  const quarticMatch = s.match(/\b(?:quartic|deg(?:ree)?\s*4)\b/i);
  if (quarticMatch) return 4;
  if (/^(?:F_?p|GF\(p\)|base|goldilocks|babybear|koalabear|m31|mersenne31)$/i.test(s)) return 1;
  return undefined;
}

function inferBaseFieldBits(obj: Record<string, unknown>, rawField?: string): number | undefined {
  const direct = asNumber(obj.base_field_bits ?? obj.field_bits ?? obj.prime_bits);
  if (direct !== undefined) return direct;
  const fieldName = (rawField || asString(obj.base_field) || asString(obj.field) || '').toLowerCase();
  if (/goldilocks|2\^64|u64|64-?bit/.test(fieldName)) return 64;
  if (/babybear|koalabear|mersenne31|m31|31-?bit/.test(fieldName)) return 31;
  if (/bn254|bls12|256-?bit|254-?bit/.test(fieldName)) return 254;
  return undefined;
}

function detectCategoriesFromObject(obj: Record<string, unknown>): ReceiptCategory[] {
  const cats = new Set<ReceiptCategory>();
  const kind = (
    asString(obj.category) ||
    asString(obj.kind) ||
    asString(obj.scheme) ||
    asString(obj.type) ||
    ''
  ).toLowerCase();

  if (/rlwe|bfv|bgv|ckks|fhe|tfhe/.test(kind)) cats.add('rlwe_fhe');
  if (/stark|fri|zk_stark|zk-stark/.test(kind)) cats.add('zk_stark');
  if (/lean|proof/.test(kind)) cats.add('lean4');
  if (/gpu|silicon|gb10|sm121|sass|kernel/.test(kind)) cats.add('gpu_silicon');

  // Structural field detection even when `category` is omitted or composite
  if (
    obj.ring_degree !== undefined ||
    obj.poly_modulus_degree !== undefined ||
    obj.log2_q !== undefined ||
    obj.log2Q !== undefined ||
    obj.coeff_modulus_bits !== undefined ||
    obj.multiplicative_depth !== undefined ||
    (obj.N !== undefined && (obj.log2_q !== undefined || obj.q_bits !== undefined || /fhe|bfv|rlwe/i.test(collectProse(obj))))
  ) {
    cats.add('rlwe_fhe');
  }

  if (
    obj.conjectured_soundness_bits !== undefined ||
    obj.proven_johnson_bits !== undefined ||
    obj.fri_queries !== undefined ||
    obj.blowup_factor !== undefined ||
    obj.extension_field !== undefined ||
    obj.challenge_field !== undefined ||
    obj.extension_degree !== undefined
  ) {
    cats.add('zk_stark');
  }

  if (
    obj.sorry_count !== undefined ||
    obj.native_decide_count !== undefined ||
    obj.axioms !== undefined ||
    obj.lean_toolchain !== undefined ||
    obj.broken_model_controls !== undefined ||
    (obj.theorem !== undefined && obj.trust !== undefined)
  ) {
    cats.add('lean4');
  }

  if (
    obj.workload_scope !== undefined ||
    obj.gpu_scope !== undefined ||
    obj.xid_delta !== undefined ||
    obj.nvrm_xid_delta !== undefined ||
    obj.sass_sha256 !== undefined ||
    obj.sm_arch !== undefined ||
    collectTags(obj).some((t) => GPU_PASS_SCOPES.has(t))
  ) {
    cats.add('gpu_silicon');
  }

  if (cats.size === 0) cats.add('generic');
  return Array.from(cats);
}

function lintRlweFhe(obj: Record<string, unknown>, findings: LintFinding[], file?: string): void {
  const tags = collectTags(obj);
  const prose = collectProse(obj);
  const isPrototypeAlgebra = tags.some((t) => t.toUpperCase() === 'PROTOTYPE_ALGEBRA_ONLY');
  const explicitClaimsSecurity = asBoolean(obj.claims_crypto_security);
  const proseSecurity = proseClaimsCryptoSecurity(prose);
  const claimsSecurity =
    explicitClaimsSecurity === true ||
    proseSecurity ||
    (!isPrototypeAlgebra && explicitClaimsSecurity !== false);

  if (isPrototypeAlgebra && (explicitClaimsSecurity === true || proseSecurity)) {
    findings.push({
      code: 'FHE_PROTOTYPE_SECURITY_CONFLATION',
      severity: 'ERROR',
      category: 'rlwe_fhe',
      file,
      message:
        'Receipt is tagged PROTOTYPE_ALGEBRA_ONLY but simultaneously claims cryptographic security.',
      remediation:
        'Remove cryptographic security claims (set claims_crypto_security=false) or upgrade parameters to HES 128-bit floors.',
    });
  }

  const n = asNumber(obj.N ?? obj.n ?? obj.ring_degree ?? obj.poly_modulus_degree);
  const depth = asNumber(obj.depth ?? obj.multiplicative_depth) ?? 1;
  const log2Q = asNumber(obj.log2_q ?? obj.log2Q ?? obj.q_bits ?? obj.coeff_modulus_bits);
  const rawDist = (asString(obj.secret_distribution) || 'ternary').toLowerCase();
  const dist: HesSecretDistribution =
    rawDist === 'uniform' ? 'uniform' : rawDist === 'error' ? 'error' : 'ternary';

  if (n === undefined) {
    findings.push({
      code: 'FHE_MISSING_RING_DEGREE',
      severity: 'ERROR',
      category: 'rlwe_fhe',
      file,
      message: 'RLWE/BFV/FHE receipt is missing ring degree N (ring_degree / poly_modulus_degree).',
      remediation: 'Record exact N (power of two; >= 2048, or >= 4096 for Depth >= 2).',
    });
    return;
  }

  if (!isPowerOfTwo(n)) {
    findings.push({
      code: 'FHE_RING_NOT_POWER_OF_TWO',
      severity: 'ERROR',
      category: 'rlwe_fhe',
      file,
      message: `RLWE/BFV/FHE ring degree N=${n} is not a positive power of two.`,
      remediation: 'Use a standard power-of-two cyclotomic ring dimension (2048, 4096, 8192, 16384, 32768).',
    });
    return;
  }

  const minN = depth >= 2 ? 4096 : 2048;
  const maxLog2Q = getHes128MaxLog2Q(n, dist);

  let belowFloor = false;
  if (n < 2048) {
    belowFloor = true;
    if (claimsSecurity) {
      findings.push({
        code: 'FHE_RING_BELOW_FLOOR',
        severity: 'ERROR',
        category: 'rlwe_fhe',
        file,
        message: `RLWE/BFV/FHE ring degree N=${n} is below the 2048 minimum floor for cryptographic security claims.`,
        remediation:
          'Upgrade to N >= 2048 (N >= 4096 for Depth >= 2) within HES 128-bit bounds, or tag strictly PROTOTYPE_ALGEBRA_ONLY with claims_crypto_security=false.',
      });
    }
  } else if (depth >= 2 && n < 4096) {
    belowFloor = true;
    if (claimsSecurity) {
      findings.push({
        code: 'FHE_DEPTH_RING_FLOOR',
        severity: 'ERROR',
        category: 'rlwe_fhe',
        file,
        message: `RLWE/BFV/FHE Depth=${depth} >= 2 requires N >= 4096, but receipt has N=${n}.`,
        remediation:
          'Use N >= 4096 for Depth >= 2 within HES 128-bit bounds, or tag strictly PROTOTYPE_ALGEBRA_ONLY with claims_crypto_security=false.',
      });
    }
  }

  if (log2Q === undefined) {
    if (claimsSecurity) {
      findings.push({
        code: 'FHE_MISSING_LOG2_Q',
        severity: 'ERROR',
        category: 'rlwe_fhe',
        file,
        message: 'RLWE/BFV/FHE receipt is missing coefficient modulus bit-length log2(Q) (log2_q).',
        remediation: `Record log2_q and verify it is <= HES 128-bit limit${maxLog2Q ? ` (${maxLog2Q} bits for N=${n}, ${dist})` : ''}.`,
      });
    }
  } else if (log2Q <= 0) {
    findings.push({
      code: 'FHE_INVALID_LOG2_Q',
      severity: 'ERROR',
      category: 'rlwe_fhe',
      file,
      message: `Invalid coefficient modulus bit-length log2(Q)=${log2Q}.`,
    });
  } else if (n >= minN && maxLog2Q !== null && log2Q > maxLog2Q) {
    belowFloor = true;
    if (claimsSecurity) {
      findings.push({
        code: 'FHE_HES_128_EXCEEDED',
        severity: 'ERROR',
        category: 'rlwe_fhe',
        file,
        message: `RLWE/BFV/FHE parameters (N=${n}, log2(Q)=${log2Q}, ${dist}) exceed the Homomorphic Encryption Standard 128-bit classical bound (max log2(Q)=${maxLog2Q}).`,
        remediation: `Reduce log2(Q) <= ${maxLog2Q} or increase N (e.g. N=${n * 2}), or tag strictly PROTOTYPE_ALGEBRA_ONLY with claims_crypto_security=false.`,
      });
    }
  }

  if (belowFloor && !claimsSecurity && isPrototypeAlgebra) {
    findings.push({
      code: 'FHE_PROTOTYPE_ALGEBRA_TAGGED',
      severity: 'INFO',
      category: 'rlwe_fhe',
      file,
      message: `RLWE/BFV/FHE receipt (N=${n}, Depth=${depth}${log2Q !== undefined ? `, log2(Q)=${log2Q}` : ''}) is properly tagged PROTOTYPE_ALGEBRA_ONLY with no cryptographic security claim.`,
    });
  }
}

function lintZkStark(obj: Record<string, unknown>, findings: LintFinding[], file?: string): void {
  const tags = collectTags(obj);
  const prose = collectProse(obj);
  const isPrototypeOnly = tags.some((t) => t.toUpperCase() === 'PROTOTYPE_ONLY');
  const explicitClaimsSecurity = asBoolean(obj.claims_crypto_security);
  const proseSecurity = proseClaimsCryptoSecurity(prose);
  const claimsSecurity =
    explicitClaimsSecurity === true ||
    proseSecurity ||
    (!isPrototypeOnly && explicitClaimsSecurity !== false);

  if (isPrototypeOnly && (explicitClaimsSecurity === true || proseSecurity)) {
    findings.push({
      code: 'STARK_PROTOTYPE_SECURITY_CONFLATION',
      severity: 'ERROR',
      category: 'zk_stark',
      file,
      message: 'ZK-STARK receipt is tagged PROTOTYPE_ONLY but simultaneously claims cryptographic security.',
      remediation: 'Remove cryptographic security claims (set claims_crypto_security=false) or raise parameters to >= 100-bit security.',
    });
  }

  const conjectured = asNumber(obj.conjectured_soundness_bits);
  const johnson = asNumber(obj.proven_johnson_bits);

  if (conjectured === undefined) {
    findings.push({
      code: 'STARK_MISSING_CONJECTURED_SOUNDNESS',
      severity: 'ERROR',
      category: 'zk_stark',
      file,
      message: 'ZK-STARK receipt must explicitly report conjectured_soundness_bits.',
      remediation: 'Compute and record both conjectured_soundness_bits and proven_johnson_bits.',
    });
  }

  if (johnson === undefined) {
    findings.push({
      code: 'STARK_MISSING_PROVEN_JOHNSON_SOUNDNESS',
      severity: 'ERROR',
      category: 'zk_stark',
      file,
      message: 'ZK-STARK receipt must explicitly report proven_johnson_bits alongside conjectured_soundness_bits.',
      remediation: 'Compute and record proven_johnson_bits (Johnson bound: queries * log2(blowup)/2 + grinding, capped by challenge field bits).',
    });
  }

  const rawChallengeField = obj.challenge_field ?? obj.extension_field;
  const extDegree =
    asNumber(obj.extension_degree) ?? parseExtensionDegree(rawChallengeField);
  const baseFieldBits = inferBaseFieldBits(obj, asString(rawChallengeField));

  const challengeFieldBits =
    baseFieldBits !== undefined && extDegree !== undefined
      ? baseFieldBits * extDegree
      : baseFieldBits;

  // Extension-field challenge check for <= 64-bit base fields
  if (baseFieldBits !== undefined && baseFieldBits <= 64) {
    if (extDegree === undefined || extDegree < 2 || (challengeFieldBits !== undefined && challengeFieldBits < 100)) {
      if (claimsSecurity) {
        findings.push({
          code: 'STARK_EXTENSION_FIELD_REQUIRED',
          severity: 'ERROR',
          category: 'zk_stark',
          file,
          message: `ZK-STARK over ${baseFieldBits}-bit base field requires extension-field challenges (F_{p^2}+ for 64-bit fields; >= 100-bit challenge field), got extension_degree=${extDegree ?? 'missing'}.`,
          remediation: 'Draw FRI/DEEP challenges from F_{p^2} or higher (e.g. F_{p^2} = 128-bit for 64-bit Goldilocks, F_{p^4} = 124-bit for 31-bit fields), or tag PROTOTYPE_ONLY.',
        });
      } else {
        findings.push({
          code: 'STARK_EXTENSION_FIELD_PROTOTYPE',
          severity: 'WARN',
          category: 'zk_stark',
          file,
          message: `PROTOTYPE_ONLY STARK uses ${baseFieldBits}-bit base field with extension_degree=${extDegree ?? 1}; not cryptographically sound.`,
        });
      }
    }
  } else if (extDegree === undefined && rawChallengeField === undefined && baseFieldBits === undefined && claimsSecurity) {
    findings.push({
      code: 'STARK_CHALLENGE_FIELD_MISSING',
      severity: 'ERROR',
      category: 'zk_stark',
      file,
      message: 'ZK-STARK receipt claiming security must declare base_field_bits and extension_field / extension_degree.',
      remediation: 'Specify base_field_bits (e.g. 64) and challenge_field (e.g. "F_{p^2}") / extension_degree (>= 2).',
    });
  }

  // Cross-check soundness math when FRI queries and blowup factor are provided
  const queries = asNumber(obj.fri_queries ?? obj.queries ?? obj.num_queries);
  const blowup = asNumber(obj.blowup_factor ?? obj.fri_blowup);
  const grinding = asNumber(obj.pow_grinding_bits ?? obj.grinding_bits) ?? 0;

  let derivedConjecturedMax: number | undefined;
  let derivedJohnsonMax: number | undefined;

  if (queries !== undefined && blowup !== undefined && blowup > 1) {
    const log2B = Math.log2(blowup);
    const fieldCap = challengeFieldBits ?? Number.POSITIVE_INFINITY;
    derivedConjecturedMax = Math.min(fieldCap, queries * log2B + grinding);
    derivedJohnsonMax = Math.min(fieldCap, queries * (log2B / 2) + grinding);

    if (conjectured !== undefined && conjectured > derivedConjecturedMax + 0.5) {
      findings.push({
        code: 'STARK_CONJECTURED_MATH_OVERCLAIM',
        severity: 'ERROR',
        category: 'zk_stark',
        file,
        message: `Reported conjectured_soundness_bits=${conjectured} exceeds mathematical ceiling ${derivedConjecturedMax.toFixed(2)} for queries=${queries}, blowup=${blowup}, grinding=${grinding}${challengeFieldBits ? `, challenge_field=${challengeFieldBits}b` : ''}.`,
        remediation: 'Recompute conjectured_soundness_bits via Wolfram: Min[fieldCap, queries * Log2[blowup] + grinding].',
      });
    }

    if (johnson !== undefined && johnson > derivedJohnsonMax + 0.5) {
      findings.push({
        code: 'STARK_JOHNSON_MATH_OVERCLAIM',
        severity: 'ERROR',
        category: 'zk_stark',
        file,
        message: `Reported proven_johnson_bits=${johnson} exceeds Johnson-bound ceiling ${derivedJohnsonMax.toFixed(2)} for queries=${queries}, blowup=${blowup}, grinding=${grinding}${challengeFieldBits ? `, challenge_field=${challengeFieldBits}b` : ''}.`,
        remediation: 'Recompute proven_johnson_bits via Wolfram: Min[fieldCap, queries * Log2[blowup]/2 + grinding].',
      });
    }
  }

  if (conjectured !== undefined && johnson !== undefined && johnson > conjectured + 0.5) {
    findings.push({
      code: 'STARK_JOHNSON_EXCEEDS_CONJECTURED',
      severity: 'ERROR',
      category: 'zk_stark',
      file,
      message: `proven_johnson_bits (${johnson}) cannot exceed conjectured_soundness_bits (${conjectured}).`,
    });
  }

  const effectiveConjectured =
    conjectured !== undefined ? conjectured : derivedConjecturedMax;
  const effectiveJohnson =
    johnson !== undefined ? johnson : derivedJohnsonMax;

  const below100 =
    (effectiveConjectured !== undefined && effectiveConjectured < 100) ||
    (effectiveJohnson !== undefined && effectiveJohnson < 100);

  if (below100) {
    if (claimsSecurity) {
      findings.push({
        code: 'STARK_SOUNDNESS_BELOW_100_BITS',
        severity: 'ERROR',
        category: 'zk_stark',
        file,
        message: `ZK-STARK soundness below 100-bit floor (conjectured_soundness_bits=${effectiveConjectured ?? 'missing'}, proven_johnson_bits=${effectiveJohnson ?? 'missing'}${queries !== undefined ? `, queries=${queries}` : ''}).`,
        remediation:
          'Increase FRI queries / blowup / grinding + extension field to achieve >= 100 bits, or tag strictly PROTOTYPE_ONLY with claims_crypto_security=false.',
      });
    } else if (isPrototypeOnly) {
      findings.push({
        code: 'STARK_PROTOTYPE_ONLY_TAGGED',
        severity: 'INFO',
        category: 'zk_stark',
        file,
        message: `ZK-STARK receipt (< 100-bit soundness: conjectured=${effectiveConjectured}, proven_johnson=${effectiveJohnson}) is properly tagged PROTOTYPE_ONLY with no cryptographic security claim.`,
      });
    }
  }
}

function lintLean4(obj: Record<string, unknown>, findings: LintFinding[], file?: string): void {
  const prose = collectProse(obj);
  const sorryCount = asNumber(obj.sorry_count);
  const nativeDecideCount = asNumber(obj.native_decide_count);
  const trust = asString(obj.trust)?.toLowerCase();
  const rawAxioms = Array.isArray(obj.axioms)
    ? obj.axioms.filter((a): a is string => typeof a === 'string').map((a) => a.trim()).filter(Boolean)
    : undefined;

  // 1. Zero sorry
  if (sorryCount === undefined) {
    findings.push({
      code: 'LEAN_SORRY_COUNT_MISSING',
      severity: 'ERROR',
      category: 'lean4',
      file,
      message: 'Lean 4 receipt must explicitly report sorry_count (required: 0).',
      remediation: 'Run lean_verify / #print axioms and record sorry_count: 0.',
    });
  } else if (sorryCount > 0) {
    findings.push({
      code: 'LEAN_SORRY_FORBIDDEN',
      severity: 'ERROR',
      category: 'lean4',
      file,
      message: `Lean 4 receipt contains sorry_count=${sorryCount} (must be 0; lean_run_code success:true does not excuse sorry).`,
      remediation: 'Eliminate all sorry placeholders and re-verify with lean_verify / #print axioms.',
    });
  }

  if (trust === 'incomplete' || (rawAxioms && rawAxioms.includes('sorryAx'))) {
    findings.push({
      code: 'LEAN_SORRY_AXIOM_DETECTED',
      severity: 'ERROR',
      category: 'lean4',
      file,
      message: 'Lean 4 receipt depends on sorryAx or reports trust="incomplete".',
      remediation: 'Prove all obligations without sorry and re-run #print axioms.',
    });
  }

  if (/\bsorryAx\b|declaration uses 'sorry'|:\=\s*sorry\b|\bby\s+sorry\b/.test(prose)) {
    findings.push({
      code: 'LEAN_SORRY_IN_LOG',
      severity: 'ERROR',
      category: 'lean4',
      file,
      message: 'Lean 4 receipt text/log references sorry or sorryAx.',
    });
  }

  // 2. Zero native_decide
  if (nativeDecideCount === undefined) {
    findings.push({
      code: 'LEAN_NATIVE_DECIDE_COUNT_MISSING',
      severity: 'ERROR',
      category: 'lean4',
      file,
      message: 'Lean 4 receipt must explicitly report native_decide_count (required: 0).',
      remediation: 'Verify zero native_decide usage and record native_decide_count: 0.',
    });
  } else if (nativeDecideCount > 0) {
    findings.push({
      code: 'LEAN_NATIVE_DECIDE_FORBIDDEN',
      severity: 'ERROR',
      category: 'lean4',
      file,
      message: `Lean 4 receipt contains native_decide_count=${nativeDecideCount} (must be 0; native_decide trusts compiler instead of kernel).`,
      remediation: 'Replace native_decide with kernel-checked decide or algebraic proof.',
    });
  }

  const hasNativeAxiom = Boolean(
    rawAxioms &&
      rawAxioms.some(
        (a) =>
          a === 'Lean.ofReduceBool' ||
          a === 'Lean.trustCompiler' ||
          a.includes('_native.native_decide.ax')
      )
  );
  if (trust === 'native' || hasNativeAxiom) {
    findings.push({
      code: 'LEAN_NATIVE_DECIDE_AXIOM_DETECTED',
      severity: 'ERROR',
      category: 'lean4',
      file,
      message: 'Lean 4 receipt trusts compiler evaluation (Lean.ofReduceBool / Lean.trustCompiler / trust="native").',
      remediation: 'Remove native_decide and use kernel-checked proofs only.',
    });
  }

  // 3. Standard core axioms only
  if (rawAxioms === undefined) {
    findings.push({
      code: 'LEAN_AXIOMS_MISSING',
      severity: 'ERROR',
      category: 'lean4',
      file,
      message: 'Lean 4 receipt must explicitly record the #print axioms list (use [] if axiom-free).',
      remediation: 'Run #print axioms <theorem> or lean_verify and record the exact axiom list.',
    });
  } else {
    const nonStandard = rawAxioms.filter(
      (a) =>
        !STANDARD_LEAN_AXIOMS.has(a) &&
        a !== 'sorryAx' &&
        a !== 'Lean.ofReduceBool' &&
        a !== 'Lean.trustCompiler' &&
        !a.includes('_native.native_decide.ax')
    );
    if (nonStandard.length > 0) {
      findings.push({
        code: 'LEAN_NONSTANDARD_AXIOM',
        severity: 'ERROR',
        category: 'lean4',
        file,
        message: `Lean 4 receipt uses non-standard axioms: [${nonStandard.join(', ')}]. Only subset of [propext, Classical.choice, Quot.sound] is permitted.`,
        remediation: 'Remove custom axiom declarations and prove from Mathlib / Lean core axioms only.',
      });
    }
  }

  if (trust === 'custom') {
    findings.push({
      code: 'LEAN_CUSTOM_TRUST_FORBIDDEN',
      severity: 'ERROR',
      category: 'lean4',
      file,
      message: 'Lean 4 receipt reports trust="custom" (custom axioms or unsafe escapes are forbidden).',
    });
  }

  if (/\b(?:@\[implemented_by\]|@\[extern\]|\bunsafe\s+(?:def|theorem|axiom))\b/.test(prose)) {
    findings.push({
      code: 'LEAN_UNSAFE_ESCAPE_FORBIDDEN',
      severity: 'ERROR',
      category: 'lean4',
      file,
      message: 'Lean 4 receipt text mentions forbidden proof escape (@[implemented_by], @[extern], or unsafe).',
    });
  }

  // 4. Broken-model negative controls
  const controls = obj.broken_model_controls ?? obj.negative_controls;
  if (!Array.isArray(controls) || controls.length === 0) {
    findings.push({
      code: 'LEAN_NEGATIVE_CONTROL_MISSING',
      severity: 'ERROR',
      category: 'lean4',
      file,
      message: 'Lean 4 receipt is missing broken-model negative controls (broken_model_controls / negative_controls).',
      remediation:
        'Add at least one deliberately broken model and confirm Lean refutes the invariant on it (proving non-vacuity).',
    });
  } else {
    let validRefutations = 0;
    for (const ctrl of controls) {
      const rec = asRecord(ctrl);
      if (!rec) continue;
      const status = asString(rec.status)?.toUpperCase();
      const refuted = asBoolean(rec.refuted ?? rec.rejected_broken_model ?? rec.passed);
      if (refuted === false || status === 'FAIL' || status === 'VACUOUS' || status === 'NOT_RUN') {
        findings.push({
          code: 'LEAN_NEGATIVE_CONTROL_FAILED',
          severity: 'ERROR',
          category: 'lean4',
          file,
          message: `Lean 4 broken-model negative control "${asString(rec.name) || 'unnamed'}" did not refute the broken model (status=${status ?? String(refuted)}).`,
          remediation: 'Fix the vacuous theorem statement or execute the broken-model refutation test.',
        });
      } else if (
        refuted === true ||
        status === 'REFUTED' ||
        status === 'REFUTED_AS_EXPECTED' ||
        status === 'KILLED' ||
        status === 'PASS'
      ) {
        validRefutations++;
      }
    }
    if (validRefutations === 0 && !findings.some((f) => f.code === 'LEAN_NEGATIVE_CONTROL_FAILED')) {
      findings.push({
        code: 'LEAN_NEGATIVE_CONTROL_UNVERIFIED',
        severity: 'ERROR',
        category: 'lean4',
        file,
        message: 'Lean 4 broken-model negative controls list has no verified refutation entry.',
        remediation: 'Record { name, broken_model, refuted: true } for each executed broken-model control.',
      });
    }
  }
}

function lintGpuSilicon(obj: Record<string, unknown>, findings: LintFinding[], file?: string): void {
  const verdict = (asString(obj.verdict) || asString(obj.status) || '').trim().toUpperCase();
  const scope = (asString(obj.workload_scope) || asString(obj.gpu_scope) || asString(obj.scope) || '')
    .trim()
    .toUpperCase();
  const tags = collectTags(obj).map((t) => t.toUpperCase());
  const prose = collectProse(obj);

  const effectiveScope =
    GPU_PASS_SCOPES.has(scope)
      ? scope
      : GPU_PASS_SCOPES.has(verdict)
        ? verdict
        : tags.find((t) => GPU_PASS_SCOPES.has(t)) || '';

  const isNonPassVerdict =
    verdict === 'FAIL' ||
    verdict === 'NOT_RUN' ||
    verdict === 'BLOCKED_HARDWARE' ||
    verdict === 'BLOCKED_OPERATOR' ||
    verdict === 'MISSING_IMPLEMENTATION';

  // Validate verdict token vocabulary
  if (verdict && !CANONICAL_GATE_VERDICTS.has(verdict) && !GPU_PASS_SCOPES.has(verdict)) {
    findings.push({
      code: 'GPU_INVALID_VERDICT',
      severity: 'ERROR',
      category: 'gpu_silicon',
      file,
      message: `GPU receipt uses non-canonical verdict "${verdict}". Allowed: PASS, FAIL, NOT_RUN, BLOCKED_HARDWARE, BLOCKED_OPERATOR, MISSING_IMPLEMENTATION (plus MICROKERNEL_SASS_PASS / FULL_WORKLOAD_GPU_PASS).`,
    });
  }

  // Contradiction check: non-pass verdict cannot carry a *_PASS workload scope
  if (isNonPassVerdict && effectiveScope) {
    findings.push({
      code: 'GPU_VERDICT_SCOPE_CONTRADICTION',
      severity: 'ERROR',
      category: 'gpu_silicon',
      file,
      message: `GPU receipt has verdict=${verdict} but also declares pass scope ${effectiveScope}.`,
      remediation: 'Remove *_PASS scope tags from FAIL / NOT_RUN / BLOCKED_HARDWARE receipts.',
    });
    return;
  }

  // Honest non-pass verdicts preserve discipline and do not require pass telemetry
  if (isNonPassVerdict) {
    const xidOnFail = asNumber(obj.xid_delta ?? obj.nvrm_xid_delta);
    if (xidOnFail !== undefined && xidOnFail > 0) {
      findings.push({
        code: 'GPU_XID_RECORDED_ON_NONPASS',
        severity: 'INFO',
        category: 'gpu_silicon',
        file,
        message: `Non-pass GPU receipt (${verdict}) honestly records XID_DELTA=${xidOnFail}.`,
      });
    }
    return;
  }

  const isClaimingPass = verdict === 'PASS' || Boolean(effectiveScope);
  if (!isClaimingPass) {
    findings.push({
      code: 'GPU_VERDICT_MISSING',
      severity: 'ERROR',
      category: 'gpu_silicon',
      file,
      message: 'GPU receipt is missing canonical verdict (PASS, FAIL, NOT_RUN, BLOCKED_HARDWARE, BLOCKED_OPERATOR, MISSING_IMPLEMENTATION).',
    });
    return;
  }

  // Must carry explicit MICROKERNEL_SASS_PASS or FULL_WORKLOAD_GPU_PASS
  if (!effectiveScope) {
    findings.push({
      code: 'GPU_SCOPE_LABEL_MISSING',
      severity: 'ERROR',
      category: 'gpu_silicon',
      file,
      message:
        'Passing GPU receipt uses ambiguous bare PASS without explicit workload_scope (MICROKERNEL_SASS_PASS or FULL_WORKLOAD_GPU_PASS).',
      remediation:
        'Label small arithmetic/SASS probes as MICROKERNEL_SASS_PASS and full GEMM/transformer runs as FULL_WORKLOAD_GPU_PASS.',
    });
  }

  // Mandatory XID_DELTA=0 telemetry on passing live-GPU receipts
  const xidDelta = asNumber(obj.xid_delta ?? obj.nvrm_xid_delta);
  if (xidDelta === undefined) {
    findings.push({
      code: 'GPU_XID_TELEMETRY_MISSING',
      severity: 'ERROR',
      category: 'gpu_silicon',
      file,
      message: 'Passing GPU receipt is missing XID_DELTA telemetry (xid_delta / nvrm_xid_delta).',
      remediation: 'Capture kernel Xid delta across the run and require XID_DELTA=0 for PASS.',
    });
  } else if (xidDelta !== 0) {
    findings.push({
      code: 'GPU_XID_NONZERO',
      severity: 'ERROR',
      category: 'gpu_silicon',
      file,
      message: `Passing GPU receipt reports non-zero XID_DELTA=${xidDelta} (must be 0).`,
      remediation: 'Mark receipt FAIL (or BLOCKED_HARDWARE) and triage the faulting Xid before re-running.',
    });
  }

  // Anti-conflation checks between 512B micro-kernels and full GEMM/transformer workloads
  const workloadKind = (asString(obj.workload_kind) || asString(obj.workload) || '').trim().toLowerCase();
  const payloadBytes = asNumber(obj.payload_bytes ?? obj.tensor_bytes ?? obj.buffer_bytes ?? obj.kernel_bytes);
  const proseMentions512B = /\b(?:512\s*b(?:yte)?s?|512-?byte|micro-?kernel|sass\s+probe)\b/i.test(prose);
  const isMicrokernelByKind = MICROKERNEL_WORKLOAD_KINDS.has(workloadKind);
  const isMicrokernelBySize = payloadBytes !== undefined && payloadBytes <= MICROKERNEL_BYTE_CEILING;

  if (effectiveScope === 'FULL_WORKLOAD_GPU_PASS') {
    if (isMicrokernelByKind || isMicrokernelBySize || proseMentions512B) {
      findings.push({
        code: 'GPU_MICROKERNEL_CONFLATED_AS_FULL_WORKLOAD',
        severity: 'ERROR',
        category: 'gpu_silicon',
        file,
        message: `GPU receipt claims FULL_WORKLOAD_GPU_PASS for a micro-kernel workload (workload_kind="${workloadKind || 'unset'}", payload_bytes=${payloadBytes ?? 'unset'}). 512B arithmetic micro-kernels must be labeled MICROKERNEL_SASS_PASS.`,
        remediation:
          'Relabel as MICROKERNEL_SASS_PASS, or run an actual full GEMM/transformer workload (> 512 B) with verified outputs.',
      });
    } else {
      const hasFullKind = FULL_WORKLOAD_KINDS.has(workloadKind) || /\b(gemm|transformer|attention|prefill|decode|moe|training)\b/i.test(workloadKind);
      const hasNonTrivialScale =
        (payloadBytes !== undefined && payloadBytes > MICROKERNEL_BYTE_CEILING) ||
        asNumber(obj.layers) !== undefined ||
        asNumber(obj.tokens) !== undefined ||
        asNumber(obj.m) !== undefined ||
        asNumber(obj.M) !== undefined ||
        obj.gemm_shape !== undefined ||
        obj.model !== undefined;

      if (!hasFullKind || !hasNonTrivialScale) {
        findings.push({
          code: 'GPU_FULL_WORKLOAD_METADATA_MISSING',
          severity: 'ERROR',
          category: 'gpu_silicon',
          file,
          message:
            'FULL_WORKLOAD_GPU_PASS receipt must declare both a full workload_kind (gemm/transformer/attention/prefill/decode/training) and non-trivial scale metadata (payload_bytes > 512, gemm_shape/M, layers, tokens, or model).',
          remediation:
            'Add concrete workload_kind and scale dimensions, or downgrade to MICROKERNEL_SASS_PASS if this was a probe.',
        });
      }
    }
  }

  if (
    effectiveScope === 'MICROKERNEL_SASS_PASS' &&
    /\b(?:full\s+transformer\s+(?:qualified|pass|verified)|full\s+gemm\s+(?:qualified|pass|verified)|full_workload_gpu_pass)\b/i.test(prose)
  ) {
    findings.push({
      code: 'GPU_MICROKERNEL_PROSE_OVERCLAIM',
      severity: 'ERROR',
      category: 'gpu_silicon',
      file,
      message:
        'MICROKERNEL_SASS_PASS receipt prose overclaims full GEMM/transformer qualification.',
      remediation: 'Scope the summary strictly to micro-kernel SASS execution.',
    });
  }
}

export function lintReceiptObject(
  input: unknown,
  opts?: { file?: string }
): LintReport {
  const file = opts?.file;
  const obj = asRecord(input);
  if (!obj) {
    return buildReport(
      [
        {
          code: 'RECEIPT_INVALID_JSON_ROOT',
          severity: 'ERROR',
          category: 'generic',
          file,
          message: 'Receipt JSON root must be an object.',
        },
      ],
      ['generic'],
      file
    );
  }

  const categories = detectCategoriesFromObject(obj);
  const findings: LintFinding[] = [];

  for (const cat of categories) {
    if (cat === 'rlwe_fhe') lintRlweFhe(obj, findings, file);
    if (cat === 'zk_stark') lintZkStark(obj, findings, file);
    if (cat === 'lean4') lintLean4(obj, findings, file);
    if (cat === 'gpu_silicon') lintGpuSilicon(obj, findings, file);
  }

  return buildReport(findings, categories, file);
}

/**
 * Lightweight parser for plain-text / Markdown receipts so the static linter
 * can enforce Lane 1 & Lane 2 rules on both JSON receipts and text/Markdown logs.
 */
export function lintReceiptText(
  text: string,
  opts?: { file?: string }
): LintReport {
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      return lintReceiptObject(parsed, opts);
    } catch {
      // Fall through to text linting if not valid JSON
    }
  }

  const file = opts?.file;
  const categories = new Set<ReceiptCategory>();
  const findings: LintFinding[] = [];

  const hasFhe = /\b(?:RLWE|BFV|BGV|CKKS|FHE|TFHE)\b/i.test(text);
  const hasStark = /\b(?:ZK-?STARK|STARK|FRI)\b/i.test(text);
  const hasLean = /\b(?:Lean\s*4|lean_verify|#print\s+axioms|sorryAx|native_decide)\b/i.test(text) || /\.lean\b/.test(text);
  const hasGpu =
    /\b(?:MICROKERNEL_SASS_PASS|FULL_WORKLOAD_GPU_PASS|XID_DELTA|sm_?121|GB10|GB20B|SASS)\b/i.test(text);

  if (hasFhe) {
    categories.add('rlwe_fhe');
    const nMatch = text.match(/\b(?:N|ring_degree|poly_modulus_degree)\s*[=:]\s*(\d+)\b/);
    const qMatch = text.match(/\b(?:log2\s*\(\s*Q\s*\)|log2_?q|q_bits|coeff_modulus_bits)\s*[=:]\s*(\d+(?:\.\d+)?)\b/i);
    const dMatch = text.match(/\b(?:depth|multiplicative_depth)\s*[=:]\s*(\d+)\b/i);
    const distMatch = text.match(/\bsecret_distribution\s*[=:]\s*(ternary|uniform|error)\b/i);
    const isProto = /\bPROTOTYPE_ALGEBRA_ONLY\b/.test(text);
    const explicitFalse = /\bclaims_crypto_security\s*[=:]\s*false\b/i.test(text);
    const explicitTrue = /\bclaims_crypto_security\s*[=:]\s*true\b/i.test(text);

    const synthetic: Record<string, unknown> = {
      category: 'rlwe_fhe',
      ...(nMatch ? { N: Number(nMatch[1]) } : {}),
      ...(qMatch ? { log2_q: Number(qMatch[1]) } : {}),
      ...(dMatch ? { depth: Number(dMatch[1]) } : {}),
      ...(distMatch ? { secret_distribution: distMatch[1].toLowerCase() } : {}),
      ...(isProto ? { tag: 'PROTOTYPE_ALGEBRA_ONLY' } : {}),
      ...(explicitFalse ? { claims_crypto_security: false } : {}),
      ...(explicitTrue ? { claims_crypto_security: true } : {}),
      summary: text,
    };
    lintRlweFhe(synthetic, findings, file);
  }

  if (hasStark) {
    categories.add('zk_stark');
    const conjMatch = text.match(/\bconjectured_soundness_bits\s*[=:]\s*(\d+(?:\.\d+)?)\b/i);
    const johnMatch = text.match(/\bproven_johnson_bits\s*[=:]\s*(\d+(?:\.\d+)?)\b/i);
    const qMatch = text.match(/\b(?:fri_queries|num_queries|queries)\s*[=:]\s*(\d+)\b/i) || text.match(/\b(\d+)-query\b/i);
    const bMatch = text.match(/\b(?:blowup_factor|fri_blowup|blowup)\s*[=:]\s*(\d+)\b/i);
    const gMatch = text.match(/\b(?:pow_grinding_bits|grinding_bits|grinding)\s*[=:]\s*(\d+(?:\.\d+)?)\b/i);
    const fbMatch = text.match(/\b(?:base_field_bits|field_bits)\s*[=:]\s*(\d+)\b/i);
    const extMatch =
      text.match(/\b(?:challenge_field|extension_field)\s*[=:]\s*([^\s,;]+)/i) ||
      text.match(/\b(F_?\{?p\^\d+\}?|GF\(p\^\d+\)|Fp\d+)\b/);
    const extDegMatch = text.match(/\bextension_degree\s*[=:]\s*(\d+)\b/i);
    const isProto = /\bPROTOTYPE_ONLY\b/.test(text);
    const explicitFalse = /\bclaims_crypto_security\s*[=:]\s*false\b/i.test(text);
    const explicitTrue = /\bclaims_crypto_security\s*[=:]\s*true\b/i.test(text);

    const synthetic: Record<string, unknown> = {
      category: 'zk_stark',
      ...(conjMatch ? { conjectured_soundness_bits: Number(conjMatch[1]) } : {}),
      ...(johnMatch ? { proven_johnson_bits: Number(johnMatch[1]) } : {}),
      ...(qMatch ? { fri_queries: Number(qMatch[1]) } : {}),
      ...(bMatch ? { blowup_factor: Number(bMatch[1]) } : {}),
      ...(gMatch ? { pow_grinding_bits: Number(gMatch[1]) } : {}),
      ...(fbMatch
        ? { base_field_bits: Number(fbMatch[1]) }
        : /\bgoldilocks|64-?bit\b/i.test(text)
          ? { base_field_bits: 64 }
          : /\bbabybear|koalabear|m31|mersenne31|31-?bit\b/i.test(text)
            ? { base_field_bits: 31 }
            : {}),
      ...(extMatch ? { challenge_field: extMatch[1] } : {}),
      ...(extDegMatch ? { extension_degree: Number(extDegMatch[1]) } : {}),
      ...(isProto ? { tag: 'PROTOTYPE_ONLY' } : {}),
      ...(explicitFalse ? { claims_crypto_security: false } : {}),
      ...(explicitTrue ? { claims_crypto_security: true } : {}),
      summary: text,
    };
    lintZkStark(synthetic, findings, file);
  }

  if (hasLean) {
    categories.add('lean4');
    const sorryNum = text.match(/\bsorry_count\s*[=:]\s*(\d+)\b/i) || text.match(/\b(\d+)\s+sorry\b/i);
    const nativeNum =
      text.match(/\bnative_decide_count\s*[=:]\s*(\d+)\b/i) ||
      text.match(/\b(\d+)\s+native_decide\b/i);
    const hasBareSorry = /\bsorryAx\b|declaration uses 'sorry'|:\=\s*sorry\b|\bby\s+sorry\b/.test(text);
    const hasBareNative =
      /\bLean\.ofReduceBool\b|\bLean\.trustCompiler\b|_native\.native_decide\.ax|:\=\s*by\s+native_decide\b/.test(
        text
      );
    const axiomsMatch = text.match(/\baxioms\s*[=:]\s*\[([^\]]*)\]/i);
    const axiomsList = axiomsMatch
      ? axiomsMatch[1]
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : /does not depend on any axioms/i.test(text)
        ? []
        : undefined;
    const hasNegControl =
      /\b(?:broken[_ -]model|negative[_ -]control)[^\n]*(?:refuted|killed|pass|rejected)\b/i.test(text);

    const synthetic: Record<string, unknown> = {
      category: 'lean4',
      sorry_count: sorryNum ? Number(sorryNum[1]) : hasBareSorry ? 1 : undefined,
      native_decide_count: nativeNum ? Number(nativeNum[1]) : hasBareNative ? 1 : undefined,
      ...(axiomsList !== undefined ? { axioms: axiomsList } : {}),
      ...(hasNegControl
        ? { broken_model_controls: [{ name: 'text-negative-control', refuted: true }] }
        : {}),
      summary: text,
    };
    lintLean4(synthetic, findings, file);
  }

  if (hasGpu) {
    categories.add('gpu_silicon');
    const scopeMatch = text.match(/\b(MICROKERNEL_SASS_PASS|FULL_WORKLOAD_GPU_PASS)\b/);
    const verdictMatch =
      text.match(/\bverdict\s*[=:]\s*([A-Z_]+)\b/i) ||
      text.match(/\b(BLOCKED_HARDWARE|BLOCKED_OPERATOR|MISSING_IMPLEMENTATION|NOT_RUN|FAIL|PASS)\b/);
    const xidMatch = text.match(/\bXID_DELTA\s*[=:]\s*(\d+)\b/i);
    const bytesMatch =
      text.match(/\b(?:payload_bytes|tensor_bytes|buffer_bytes|kernel_bytes)\s*[=:]\s*(\d+)\b/i) ||
      text.match(/\b(\d+)\s*B\b/);
    const kindMatch = text.match(/\bworkload_kind\s*[=:]\s*([a-z0-9_-]+)\b/i);

    const synthetic: Record<string, unknown> = {
      category: 'gpu_silicon',
      ...(verdictMatch ? { verdict: verdictMatch[1].toUpperCase() } : {}),
      ...(scopeMatch ? { workload_scope: scopeMatch[1] } : {}),
      ...(xidMatch ? { xid_delta: Number(xidMatch[1]) } : {}),
      ...(bytesMatch ? { payload_bytes: Number(bytesMatch[1]) } : {}),
      ...(kindMatch ? { workload_kind: kindMatch[1] } : {}),
      summary: text,
    };
    lintGpuSilicon(synthetic, findings, file);
  }

  if (categories.size === 0) categories.add('generic');
  return buildReport(findings, Array.from(categories), file);
}

export function lintReceiptFile(filePath: string): LintReport {
  const abs = path.resolve(filePath);
  const raw = fs.readFileSync(abs, 'utf8');
  if (abs.endsWith('.json')) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return lintReceiptObject(parsed, { file: filePath });
    } catch (err) {
      return buildReport(
        [
          {
            code: 'RECEIPT_JSON_PARSE_ERROR',
            severity: 'ERROR',
            category: 'generic',
            file: filePath,
            message: `Invalid JSON receipt: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        ['generic'],
        filePath
      );
    }
  }
  return lintReceiptText(raw, { file: filePath });
}

function collectReceiptFiles(targetPath: string, out: string[]): void {
  const stat = fs.statSync(targetPath);
  if (stat.isFile()) {
    out.push(targetPath);
    return;
  }
  if (stat.isDirectory()) {
    const entries = fs.readdirSync(targetPath, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist') {
        continue;
      }
      const full = path.join(targetPath, entry.name);
      if (entry.isDirectory()) {
        collectReceiptFiles(full, out);
      } else if (/\.(?:json|md|txt|log)$/i.test(entry.name)) {
        out.push(full);
      }
    }
  }
}

export function lintReceiptPaths(paths: string[]): BatchLintReport {
  const files: string[] = [];
  for (const p of paths) {
    collectReceiptFiles(p, files);
  }
  const reports = files.map((f) => lintReceiptFile(f));
  let errorCount = 0;
  let warnCount = 0;
  let infoCount = 0;
  for (const r of reports) {
    errorCount += r.errorCount;
    warnCount += r.warnCount;
    infoCount += r.infoCount;
  }
  return {
    ok: errorCount === 0,
    filesChecked: reports.length,
    reports,
    errorCount,
    warnCount,
    infoCount,
  };
}

function buildReport(
  findings: LintFinding[],
  categories: ReceiptCategory[],
  file?: string
): LintReport {
  let errorCount = 0;
  let warnCount = 0;
  let infoCount = 0;
  for (const f of findings) {
    if (f.severity === 'ERROR') errorCount++;
    else if (f.severity === 'WARN') warnCount++;
    else infoCount++;
  }
  return {
    ok: errorCount === 0,
    file,
    categories,
    findings,
    errorCount,
    warnCount,
    infoCount,
  };
}

// ============================================================================
// LANE 2B: Pre-Publish External URL HTTP 200 Verifier
// ============================================================================

export interface UrlCheckResult {
  url: string;
  ok: boolean;
  status?: number;
  finalUrl?: string;
  method: 'HEAD' | 'GET';
  latencyMs: number;
  error?: string;
}

export interface UrlCheckReport {
  ok: boolean;
  totalUrls: number;
  passed: number;
  failed: number;
  results: UrlCheckResult[];
  findings: LintFinding[];
}

export interface UrlCheckOptions {
  timeoutMs?: number;
  concurrency?: number;
  skipLocalhost?: boolean;
  ignorePatterns?: RegExp[];
  fetchImpl?: typeof fetch;
}

function cleanExtractedUrl(raw: string): string {
  let url = raw.trim();
  // Strip wrapping markdown/punctuation characters while preserving balanced parentheses
  while (url.length > 0 && /[.,;:!?'"\]}>`]$/.test(url)) {
    url = url.slice(0, -1);
  }
  while (url.endsWith(')')) {
    const opens = (url.match(/\(/g) || []).length;
    const closes = (url.match(/\)/g) || []).length;
    if (closes > opens) {
      url = url.slice(0, -1);
    } else {
      break;
    }
  }
  return url;
}

function isTemplateOrPlaceholderUrl(url: string): boolean {
  return (
    /<[^>]+>/.test(url) ||
    /\$\{[^}]+\}/.test(url) ||
    /\$[A-Z_]+/.test(url) ||
    url.includes('...') ||
    url.includes('…')
  );
}

function isLocalhostUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.hostname === 'localhost' ||
      parsed.hostname === '127.0.0.1' ||
      parsed.hostname === '::1' ||
      parsed.hostname.endsWith('.local')
    );
  } catch {
    return false;
  }
}

export function extractUrlsFromText(
  text: string,
  opts?: { skipLocalhost?: boolean; ignorePatterns?: RegExp[] }
): string[] {
  const skipLocalhost = opts?.skipLocalhost ?? true;
  const ignorePatterns = opts?.ignorePatterns ?? [];
  const seen = new Set<string>();
  const ordered: string[] = [];

  // Keep '<' and '>' inside the candidate token so template URLs like
  // https://interplane.io/projects/<repo>/repo.git are detected and skipped
  // instead of truncating at '<' into a false partial URL.
  const matches = text.match(/https?:\/\/[^\s"'`]+/g) || [];
  for (const raw of matches) {
    // Strip trailing '>' only when it closes an angle-bracket-wrapped URL (<https://...>)
    // rather than an internal template placeholder like <repo>.
    const candidate = /<[^>]+>/.test(raw) ? raw : raw.replace(/>+$/, '');
    const url = cleanExtractedUrl(candidate);
    if (!url || isTemplateOrPlaceholderUrl(url)) continue;
    try {
      new URL(url);
    } catch {
      continue;
    }
    if (skipLocalhost && isLocalhostUrl(url)) continue;
    if (ignorePatterns.some((re) => re.test(url))) continue;
    if (!seen.has(url)) {
      seen.add(url);
      ordered.push(url);
    }
  }
  return ordered;
}

async function probeSingleUrl(
  url: string,
  timeoutMs: number,
  fetchImpl: typeof fetch
): Promise<UrlCheckResult> {
  const started = Date.now();
  const headers = { 'User-Agent': 'omega-receipt-lint/1.0 (+https://interplane.io/drakestapleton/omega-harness)' };

  const attempt = async (method: 'HEAD' | 'GET') => {
    const res = await fetchImpl(url, {
      method,
      redirect: 'follow',
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });
    // Drain/cancel body to avoid open socket leaks
    try {
      await res.body?.cancel();
    } catch {
      // ignore cancel errors
    }
    return res;
  };

  try {
    let method: 'HEAD' | 'GET' = 'HEAD';
    let res = await attempt('HEAD');
    // Some static/git hosts reject HEAD with 403/405/501 even when GET returns 200
    if (res.status === 405 || res.status === 403 || res.status === 501) {
      method = 'GET';
      res = await attempt('GET');
    }
    return {
      url,
      ok: res.status === 200,
      status: res.status,
      finalUrl: res.url || url,
      method,
      latencyMs: Date.now() - started,
      ...(res.status !== 200 ? { error: `HTTP ${res.status}` } : {}),
    };
  } catch (headErr) {
    // Retry once with GET if HEAD threw a protocol/method error
    try {
      const res = await attempt('GET');
      return {
        url,
        ok: res.status === 200,
        status: res.status,
        finalUrl: res.url || url,
        method: 'GET',
        latencyMs: Date.now() - started,
        ...(res.status !== 200 ? { error: `HTTP ${res.status}` } : {}),
      };
    } catch (getErr) {
      const msg =
        getErr instanceof Error
          ? getErr.message
          : headErr instanceof Error
            ? headErr.message
            : String(getErr);
      return {
        url,
        ok: false,
        method: 'GET',
        latencyMs: Date.now() - started,
        error: msg,
      };
    }
  }
}

export async function checkUrlsHttp200(
  urls: string[],
  opts?: UrlCheckOptions
): Promise<UrlCheckReport> {
  const timeoutMs = opts?.timeoutMs ?? 8000;
  const concurrency = Math.max(1, opts?.concurrency ?? 6);
  const fetchImpl = opts?.fetchImpl ?? globalThis.fetch;
  const uniqueUrls = Array.from(new Set(urls));

  const results: UrlCheckResult[] = new Array(uniqueUrls.length);
  let cursor = 0;

  const workers = Array.from({ length: Math.min(concurrency, uniqueUrls.length) }, async () => {
    while (true) {
      const idx = cursor++;
      if (idx >= uniqueUrls.length) break;
      results[idx] = await probeSingleUrl(uniqueUrls[idx], timeoutMs, fetchImpl);
    }
  });
  await Promise.all(workers);

  const findings: LintFinding[] = [];
  let passed = 0;
  let failed = 0;
  for (const r of results) {
    if (r.ok) {
      passed++;
    } else {
      failed++;
      findings.push({
        code: r.status !== undefined ? 'URL_HTTP_NOT_200' : 'URL_FETCH_ERROR',
        severity: 'ERROR',
        category: 'url_prepublish',
        message: `Pre-publish URL check failed for ${r.url}: ${r.error || 'non-200 response'} (${r.method}, ${r.latencyMs} ms).`,
        remediation:
          'Verify the Interplane page / GitHub mirror / referenced URL is published and returns HTTP 200 before generating release notes or README tables.',
      });
    }
  }

  return {
    ok: failed === 0,
    totalUrls: uniqueUrls.length,
    passed,
    failed,
    results,
    findings,
  };
}

export async function lintPrePublishUrls(
  filePaths: string[],
  opts?: UrlCheckOptions
): Promise<UrlCheckReport> {
  const allUrls: string[] = [];
  for (const filePath of filePaths) {
    const content = fs.readFileSync(path.resolve(filePath), 'utf8');
    const urls = extractUrlsFromText(content, {
      skipLocalhost: opts?.skipLocalhost ?? true,
      ignorePatterns: opts?.ignorePatterns,
    });
    allUrls.push(...urls);
  }
  return checkUrlsHttp200(allUrls, opts);
}

export function formatLintReport(report: BatchLintReport): string {
  const lines: string[] = [];
  for (const r of report.reports) {
    const label = r.file || '(inline)';
    const status = r.ok ? 'PASS' : 'REJECTED';
    lines.push(`[${status}] ${label} (${r.categories.join(', ')})`);
    for (const f of r.findings) {
      lines.push(`  ${f.severity} [${f.code}] ${f.message}`);
      if (f.remediation) lines.push(`    -> ${f.remediation}`);
    }
  }
  lines.push(
    `RECEIPT_LINT ${report.ok ? 'PASS' : 'FAIL'} files=${report.filesChecked} errors=${report.errorCount} warnings=${report.warnCount}`
  );
  return lines.join('\n');
}

export function formatUrlCheckReport(report: UrlCheckReport): string {
  const lines: string[] = [];
  for (const r of report.results) {
    const tag = r.ok ? 'HTTP 200' : `FAIL (${r.error || 'error'})`;
    lines.push(`[${tag}] ${r.url} (${r.method}, ${r.latencyMs}ms)`);
  }
  lines.push(
    `URL_CHECK ${report.ok ? 'PASS' : 'FAIL'} total=${report.totalUrls} passed=${report.passed} failed=${report.failed}`
  );
  return lines.join('\n');
}
