---
name: omega-helix-rlvr
description: >-
  Run and extend the pure seeded-Omega Proof-Carrying Evolutionary Helix
  (4-strand BFT braid, Four-Wall Loop-1 RSI gate, SM121 Evolutionary JIT) and
  the Omega LLM closed-loop RLVR + OLLMSP01 Merkle specialist training factory
  on DGX Spark GB10. Use when touching seed/helix/, seed/helix/ollm_factory/,
  ollm-helix-gb10, q36-helix-*, or training Omega LLM with RLVR/specialists.
---

# Omega Helix SM121 JIT & Omega LLM Closed-Loop RLVR Runbook

## 1. Silicon-Verified SM121 SASS Laws (Antibodies #13–#15)
Never violate these three Blackwell SM121 laws when mutating or scheduling SASS in `seed/helix/helix_jit.om` or `monk_check.om`:
- **Antibody #13 (Basic-Block Leaders)**: Always pin `pc=0`, every `BRA` target (`pc + hz_u2l(target)`), and every `BRA` fall-through (`pc + 1`) as non-swappable anchors.
- **Antibody #14 (6-Cycle ALU Floor)**: Enforce `rawFloor >= 6` unconditionally for general fixed-latency ALU ops (dropping to 4 causes live GB10 GPU timeouts).
- **Antibody #15 (`I2F` Fixed Latency)**: Never compact `I2F` (`nm==31`) stalls below `rawFloor=6`, even when `wbar < 6` (corrupts W4 unpack kernels).
- **Safe Warp-Hiding (`G6` Ascetic)**: Setting `yield=1` (`w3 |= 8192`, control bit 109) on `FFMA`/`I2F`/`MUFU` is safe and improves DRAM-bound throughput and overnight training stability.
- **Helix JIT Serving Parity Gate (`q36-helix-serve`)**: When composing `seed/helix/helix_jit.om` into `q36-serve`, always gate on multi-prompt SHA-256 token parity as well as `hxMonkVerify`: `G6` (`swaps=0`, `yield=1`) achieved 15/15 bit-exact parity (`+1.4%` to `+2.3%` faster), whereas `G2` (`swaps=2524`) degenerated into repeated `'!'` tokens despite passing Monk's static checks.

## 2. Non-Invasive `helix_jit.om` Composition & Stderr Discipline
- Genome selection reads `/tmp/helix_genome.cfg` (`0`=Monk, `1`=Predator, `2`=Mitosis Hybrid, `5`=Trickster Chaos, `6`=Ascetic) — seeded OM-2 has no `getenv`.
- Always print JIT summaries (`OLLM_HELIX_JIT_SUMMARY`) to **stderr (`write 2`)**, never stdout (`write 1`), so `gsample`/`bench sample` stdout stays pure OM-2 code.
- Resolve known symbol collisions via `sed` in build wrappers rather than editing upstream modules: `rb -> hzrb` in `bw_hazard.om` (for `bw_enc_sm121.om`) and `ow -> hxow` in `helix_jit.om` (for `train/omega-llm/native/`).
- When syncing files from macOS to Spark, always use `COPYFILE_DISABLE=1 tar --exclude='._*' --exclude='.DS_Store'` so AppleDouble `._*` files never pollute clones.

## 3. Omega LLM Closed-Loop RLVR & `OLLMSP01` Specialist Rules
- **NUL (`\x00`) EOS Delimiters & Shuffling**: `osampleloaded` pushes BOS `0` and stops only on token `0` (`\x00`). Always terminate every RLVR training record with `end\n\x00` and shuffle records randomly across epochs (otherwise models emit trailing functions and score `passcut` instead of `pass`).
- **Zero-Leakage Guarantee**: Before every training round, run `bench seen train/omega-llm/tools/bench/tasks.om <RLVR_CORPUS>` and prune any incidental AST collision until `SEENSUM tasks 165 seen 0`.
- **Arboris Anti-Forgetting Rehearsal**: Mix `20–32%` `repo-train.om` NUL-delimited files into RLVR GPU batches; for `OLLMSP01` Merkle chains, gate every link on held-out `held.tok` regression (rollback overfitting links).
- **Exact `ollm` CLI**:
  - Tokenize: `ollm bpeenc MERGES 4096 IN.om OUT.tok`
  - Fine-tune schedule: `ollm tune IN.ck OUT.ck TOTAL LRMICRO` (preserves `OLLMCK03` looped core)
  - Frozen-core specialist: `ollm growpro BASE.ck SPEC.ck NEW_L TOTAL LRMICRO` → `fcache` → `trainfc` → `spext BASE.ck SPEC.ck PACK.sp`
  - Variable-`NP` looped-core training & eval:
    - `ollm vtrain CK DATA UNTIL EVERY NP_MIN NP_MAX` (cycles core passes `[NP_MIN..NP_MAX]`, preserves base `OLLMCK03` header)
    - `ollm veval CK HELD W NP [MERGES]` (evaluates a looped checkpoint at arbitrary `NP`)
    - `ollm nsample CK SEED N TEMPMILLI PROMPT MERGES ADAPT_EXTRA THRESH_MILLI`
- **Neuralese `OLLMCK03` & `LTP0` Invariants (`model.om` / `serve.om`)**:
  - Extra core passes in `onlpass1` must feed **pre-coda core output** (`oaout (LV - coda - 1)`) back into `LP` (never post-coda `HF`), and checkpoints trained at fixed `NP` need `vtrain` before extra test-time passes improve accuracy.
  - `LTP0` latent injection (`onlinject`) must be **unit-RMS normalized** (`onlv_rms`) before scaling by `alpha` (`HF` norm `~381` saturates layer-0 embeddings otherwise).
  - `train/omega-llm/native/net/json.om` uses `js_type == 3` for JSON arrays (object=`1`, string=`6`, number=`7`, null=`10`). Reset per-request Neuralese state (`onlreset`) *after* `svnl_reply`, and keep `model.om`/`serve.om` helpers `<= 6` live locals to avoid `omc` `error 12`.
- **Fast Benchmark Sampling**: Never run 165 sequential `gsample` calls inside an exclusive GPU window (GPU init overhead overruns the 20m lease). Run 16-way parallel CPU `ollm sample` (`xargs -P 16`) outside the GPU window (~27–40 s on Spark Grace cores).
- **Pure Seeded-OM-2 Zero-Python RLVR Factory**: Use `seed/helix/ollm_factory/{rlvr_broad.om,rlvr_mix.om,rlvr_sp_worker.om}` (static AArch64 ELFs, zero Python) for 10-family broad natural-English RLVR generation (`188` fns/variant, built-in `SEENSUM tasks 165 seen 0`), streaming NUL-delimited corpus mixing/Fisher-Yates shuffling (`66 ms` for `81K` docs), and 5-shape self-play equivalence harness generation (`POS_CTRL`/`NEG_CTRL`).
- **Latest Verified Champion**: `~/work/ollm-apu-phase2-20261124/ckpt/champ_r17_p21_h2315347.ck` (`21 / 159` pass on frozen 165-task benchmark, `0` Xids across 57 GB10 APU rounds), also served live on Spark CPU `:18098` via `omega-router` as `omega-llm-15.8m-om2`.

## 4. Verification Commands (Spark AArch64)
- Full 4-wall RSI + 4-strand BFT + 29 Lean 4 theorems: `PATH="$HOME/.elan/bin:$PATH" sh seed/helix/rsi-loop1.sh --lean`
- Full 5-stage Omega LLM closed-loop factory gate: `PATH="$HOME/.elan/bin:$PATH" sh seed/helix/ollm_factory/closed-loop-gate.sh --full`
