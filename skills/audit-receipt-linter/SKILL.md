---
name: audit-receipt-linter
description: "Enforce the 2026-11-28 audit standards across every Omega /swarm: RLWE/BFV/FHE 128-bit HES parameter floors, ZK-STARK extension-field and Johnson/conjectured soundness bounds, Lean 4 0-sorry/0-native_decide/standard-axiom/broken-model controls, GPU MICROKERNEL_SASS_PASS vs FULL_WORKLOAD_GPU_PASS & XID_DELTA=0 discipline, and pre-publish HTTP 200 URL verification via omega-receipt-lint."
---

# Audit Receipt & Pre-Publish Honesty Linter (2026-11-28 Standards)

Run `omega-receipt-lint` (in `omega-harness/cli/`) before accepting any cryptographic, formal-proof, GPU-silicon, or public release artifact across any Omega repository or `/swarm`.

## 1. Lane 1 — Cryptographic Parameter Floor Guardrails

No receipt, README table, or swarm handoff may claim cryptographic security unless it clears these hard floors:

### RLWE / BFV / BGV / CKKS / FHE
- **Minimum ring degree:** `N >= 2048` (and **`N >= 4096` for `Depth >= 2`**); `N` must be a power of 2.
- **HES v1.1 128-bit classical security table** (Albrecht et al. 2018, HomomorphicEncryption.org Standard Table 1, $\sigma = 3.2$):

| Ring Dimension `N` | Max `log2(Q)` (Ternary / Error secret) | Max `log2(Q)` (Uniform secret) | Min Allowed Depth Scope |
|---|---:|---:|---|
| `< 2048` (e.g. `N=64`, `1024`) | Refused for security claims | Refused for security claims | **`PROTOTYPE_ALGEBRA_ONLY`** |
| `2048` | `54` | `56` | `Depth <= 1` only |
| `4096` | `109` | `111` | `Depth >= 2` permitted |
| `8192` | `218` | `220` | `Depth >= 2` permitted |
| `16384` | `438` | `440` | `Depth >= 2` permitted |
| `32768` | `881` | `880` | `Depth >= 2` permitted |

- **Mandatory prototype tag:** Any smaller ring (`N < 2048`, or `N < 4096` at `Depth >= 2`) or `(N, log2(Q))` exceeding the HES 128-bit ceiling MUST be tagged strictly **`PROTOTYPE_ALGEBRA_ONLY`** with `claims_crypto_security: false` and zero security claims in prose.

### ZK-STARKs / FRI
- **Extension-field challenges required:** For 64-bit base fields (e.g. Goldilocks $2^{64} - 2^{32} + 1$), challenges MUST come from an extension field `F_{p^2}` or higher (`extension_degree >= 2`, challenge field `>= 100` bits; 31-bit fields require `F_{p^4}+`). Base-field challenges over 64-bit fields are hard-rejected for cryptographic security claims.
- **Dual soundness reporting required:** Every ZK-STARK receipt MUST explicitly report **BOTH**:
  - `conjectured_soundness_bits` ($\le \min(\text{field\_bits} \cdot d,\; q \cdot \log_2(B) + g)$)
  - `proven_johnson_bits` ($\le \min(\text{field\_bits} \cdot d,\; q \cdot \frac{\log_2(B)}{2} + g)$)
  Compute values via Wolfram (`wolfram-math`), never by hand. The linter cross-checks reported bits against `(fri_queries, blowup_factor, pow_grinding_bits, challenge_field)` and hard-rejects inflated claims.
- **100-bit floor:** Any configuration with `< 100` bits (conjectured or proven Johnson) MUST be tagged strictly **`PROTOTYPE_ONLY`** with `claims_crypto_security: false`.

### Lean 4 Proofs
- **`0 sorry`:** `sorry_count: 0`, no `sorryAx` in `#print axioms`, never `trust: "incomplete"`. (`lean_run_code` returning `success: true` with a `sorry` warning is NOT a proof.)
- **`0 native_decide`:** `native_decide_count: 0`, no `Lean.ofReduceBool`, `Lean.trustCompiler`, or `*._native.native_decide.ax*`.
- **Standard core axioms only:** `#print axioms` MUST be a subset of `[propext, Classical.choice, Quot.sound]` (empty `[]` preferred). No custom `axiom`, `unsafe`, `@[implemented_by]`, or `@[extern]`.
- **Broken-model negative controls:** Every Lean 4 proof receipt MUST record at least one executed broken-model negative control (`broken_model_controls` / `negative_controls`) confirming the invariant fails/is refuted on a deliberately broken model (ruling out vacuous theorems).

## 2. Lane 2 — Silicon Scope Labeling & Pre-Publish URL Gate

### GPU Receipt Scope & Telemetry
- **Strict workload labeling:** Every passing GPU receipt MUST explicitly declare its workload scope:
  - **`MICROKERNEL_SASS_PASS`**: small arithmetic/instruction/M16 probes (`<= 512 B` payload/kernel buffers or micro-kernel smoke tests).
  - **`FULL_WORKLOAD_GPU_PASS`**: real full GEMM, attention, or multi-layer transformer inference/training runs (`> 512 B` payload with concrete `workload_kind` and scale metadata such as `gemm_shape`, `layers`, `tokens`, or `model`).
- **Anti-conflation hard block:** Bare `PASS` without a workload scope label, or labeling a `512 B` arithmetic micro-kernel as `FULL_WORKLOAD_GPU_PASS`, is hard-rejected.
- **Canonical gate verdicts preserved:** `PASS`, `FAIL`, `NOT_RUN`, `BLOCKED_HARDWARE`, `BLOCKED_OPERATOR`, `MISSING_IMPLEMENTATION`. Never attach `*_PASS` scope labels to `NOT_RUN` / `BLOCKED_HARDWARE` / `FAIL`.
- **Mandatory `XID_DELTA=0` telemetry:** Every passing live-GPU receipt MUST record `xid_delta: 0` (or `XID_DELTA=0` in text receipts). Missing or non-zero `XID_DELTA` is hard-rejected.

### Pre-Publish External URL HTTP 200 Gate
- Before generating release notes, README evidence tables, or public announcements, run the URL verifier over every target Markdown/receipt file and verify **every** referenced external URL (including `interplane.io` and GitHub mirror links) returns **HTTP 200**. Any 404/403/5xx/timeout fails closed (exit 1).

## 3. CLI & Agent Tool Commands

Build and run from `omega-harness/cli/`:

```sh
cd cli && npm run build && npm test

# Lint JSON, Markdown, or text receipts (directory or file)
node dist/receipt-lint-cli.js check <receipt-file-or-dir...> [--json]

# Pre-publish URL HTTP 200 verification (files or explicit URLs)
node dist/receipt-lint-cli.js urls README.md RELEASE_NOTES.md [--json]
node dist/receipt-lint-cli.js urls https://interplane.io/drakestapleton/<repo> https://github.com/drakestapleton/<repo> --json

# Combined receipt + URL audit
node dist/receipt-lint-cli.js all docs/evidence/ README.md [--json]

# Or through the main omega CLI / read-only agent tools:
omega lint-receipt <path...> [--json]
omega lint-urls <file|url...> [--json]
# Agent tools: lint_receipt, check_publish_urls
```

Exit codes: `0` pass, `1` hard-block finding or non-200 URL, `2` usage/I/O error. `--json` emits valid JSON on both success and failure.
