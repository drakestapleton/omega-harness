---
name: yang-mills-gb10-lean
description: >-
  Run and extend the pure seeded-OM-2 Zero-CUDA GB10 lattice gauge suite,
  outward-rounded zero-Monte-Carlo interval verifiers, and Mathlib-linked Lean 4
  mass-gap bridges in workspace/yang (connected to omega-mv and OpenAI-YM-20261028).
  Use when touching workspace/yang, ufbi_check*, ufbi_interval_rg_cert,
  OpenAiYmBridge.lean, DobrushinShlosman.lean, or WilsonPolymerBridge.lean.
---

# Yang–Mills GB10 Pure-OM-2 & Lean 4 Bridge Runbook (`workspace/yang`)

## 1. Lattice-Physics Anti-Artifact Guardrails
Apply these six checks before trusting any finite-box boundary-sensitivity or RG claim:
1. **Zero-contact collar invariant:** Assert `ZERO_CONTACT_ASSERT max_direct_err = 0.000000` on every geometry (smearing and blocked-plaquette footprints must never touch frozen boundary collars).
2. **Scale operators with lattice spacing ($a \to 0$):** Never extrapolate a fixed-lattice $a^4$ operator as $a \to 0$. Scale Wilson loop size $r$ and smearing steps $n_s \propto L^2$ proportionally at fixed physical box size $\ell\sqrt{\sigma}$ (`L=8, β=2.300 -> L=12, β=2.426 -> L=16, β=2.500`, non-perturbative $a\sqrt{\sigma}$ scaling—not 2-loop asymptotic scaling, which overshoots to `β=2.575`). A physical box held at fixed $\ell\sqrt{\sigma}$ must settle to a flat, finite continuum plateau, not plunge by `100×`.
3. **Smooth $k=0$ IR collars + weak-coupling control:** Always test smooth $k=0$ IR collars (`C7_smooth_thooft`, `C8_smooth_hol`) alongside a weak-coupling $\beta=6.0$ control. Checkerboard parity collars carry $k=\pi/a$ UV momentum that weak coupling damps artificially.
4. **UV-regular composite observables & pole-free denominators (`INV-4`):** Flow-time smear *all* terms in composite observables (mixing bare `R1x2(0)` with smeared loops inflates variance `3.6×`) and reject any denominator that is not strictly sign-definite with margin across MC snapshots (prevents strong-coupling zero poles like `chi1(ADJ_PLAQ_S0)` at $\beta=2.30$).
5. **Fixed-box RG geometry & calibration clamps:** Extend bulk calibration grids to $\beta \le 10.0$ so weak-coupling controls do not clamp at `β=6.0`. Note that on a fixed $16^4$ box, blocked `4a×4a` plaquettes sit closer to the collar than `2a×2a` plaquettes (geometric sensitivity rise, not RG anti-contraction).
6. **Calibration-free $S^3$ Schwinger–Dyson Hamiltonian tomography:** Single-plaquette $\beta_{\text{eff}}$ hides genuine $O(0.1)$ crossover couplings (`β_R = -0.128`, `β_Cr = +0.087`). Extract actual blocked couplings `(β_F, β_A, β_R, β_22, β_Cr)` via exact $S^3$ Lie-algebraic score-matching (`M c = b`) and require $k=0$ bare self-verification to recover `(β_bare, 0, 0, 0, 0)` within ~1%.

## 2. Pure Seeded-OM-2 GB10 & Zero-MC Interval Patterns
- **Build pipeline:** Compose after `omega-mv` native NVRM/Blackwell/SM121 units (`gpu/nvidia/native/nvrm/context.om`, `blackwell/{vector,launch,batch}.om`, `om/encoder/bw_enc_sm121.om`, `src/ufbi_math.om`, `src/ufbi_check3_kernels.om`) via `seed/out/omc`. Verify `file`/`ldd` shows a static AArch64 ELF (`not a dynamic executable`, zero C/Python/Rust/`libcuda.so.1`).
- **`32^4` (`1,048,576` sites) without `error 16`:** Never declare a `32^4` host `global` array (`omc` rejects `16M` globals with `error 16`). Allocate `32^4` purely in `nvalloc` GPU buffers (`189 MB` total), stream init/neighbor/flag tables via a `65,536 B` `hStage`, and read fine `32^4` links directly from cached unified-memory `dLinks` (`mapget`).
- **Avoid `omc` traps:** Never use `rb` as a local name (collides with `bw_enc_sm121.om` → `error 7`), write `neg 20.0f64` instead of unary `-20.0f64`, never reuse a `for` loop variable name in the same function, and factor functions with >8 live `f64` values or deep nested loops (`error 12` register pool).
- **Zero-MC interval certificates (`src/ufbi_interval_rg_cert.om`):** Use explicit outward rounding inflation (`rel=1e-12, abs=1e-15`) over monotone subintervals (`2048` $\theta$-boxes $\times$ `32` $r$-boxes covering all $r \in [0, 6\beta]$) so upper bounds are strictly deterministic with zero quadrature or field-sampling gaps.

## 3. Lean 4 Bridge & `OpenAI-YM-20261028` Scope Discipline
- **Spark Lean workspace:** `spark:~/workspace/yang-lean-bridge` (`leanprover/lean4:v4.32.0`, cached Mathlib `81a5d257c8e4...`, Mathlib-only public closure `PublicTheory.lean`, `PublicWilson.lean`, `ChallengeSpec.lean`). Incremental builds: `lake build OpenAiYmBridge DobrushinShlosman WilsonPolymerBridge` (~6–7 s).
- **Required standards:** Prove the full Lorentz-invariant mass hyperboloid (`minkowskiSquare p < Δ²`), not just an energy strip (`0 < time p < Δ`); verify zero `sorryAx` and strictly `[propext, Classical.choice, Quot.sound]` on every theorem.
- **Honest scope separation:** `OpenAI-YM-20261028`'s `History.Selected` stops at an existentially large perturbative `Calendar.bar` (`EventuallyPaid`/`DelayLe` in `YM/R2I/Campaign/Clock.lean`), leaving a finite unbridged canyon $[\beta_{\text{DS}}, \bar{\beta}]$ across the crossover. Always separate unconditional Lean theorems, conditional bridges, live GB10 statistical evidence, zero-MC interval ceilings, and the open Part II Clay Millennium crossover bound.

## 4. Verification Commands (`workspace/yang`)
```sh
sh scripts/build_and_run_spark.sh check9          # live GB10: 12-pt cal + tomography + 32^4 k=3 RG
sh scripts/build_and_run_spark.sh check10         # live GB10: calibration-free S^3 Schwinger-Dyson 5-op
sh scripts/build_and_run_spark.sh interval_cert   # Spark CPU: zero-MC outward-rounded interval verifier
sh scripts/build_and_run_spark.sh proofs          # Spark: standalone UfbiMassGap.lean
sh scripts/build_and_run_spark.sh openai_bridge   # Spark: OpenAiYmBridge + DobrushinShlosman + WilsonPolymerBridge
```
