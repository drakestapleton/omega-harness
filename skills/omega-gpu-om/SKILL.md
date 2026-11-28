---
name: omega-gpu-om
description: >-
  Migrate or write Blackwell GPU planners, schedulers, QMD packers, and SM121
  codegen/SASS emitters (PTQ1_0, NVFP4, W4, Full-APU) in pure seeded OM-2 under
  om/gpu/, bound through om/units.sh or om/gpu/engine/. Use when touching
  omega-mv GPU codegen, om/gpu/**/*.om, omega_bw_om_ir.h, or src/omega_om_units.c.
---

# Pure OM-2 Blackwell GPU Migration & Verification

## Placement & Binding
1. Put new pure OM-2 GPU units in `om/gpu/` (do **not** edit pinned `gpu/nvidia/om/*`, which `gpu/runtime/INVENTORY.tsv` hashes against CUDApp).
2. Add each new unit to `UNITS` in `om/units.sh`; add to `FS_UNITS` **only** if a consumer is in `GPU_FS_SRCS` (`mk/omega-gpu-engine.mk`).
3. `src/omega_om_units.c` emits Linux ELF AArch64 inline asm and cannot compile on macOS. Always run `om/units.sh`, `om/units.sh --check`, and host/simulator tests on Spark (`aarch64` Linux).
4. Monitor `src/omega_om_units.c` size as units grow (`omega-bridge` `native.om` has 4 MiB input / 16 MiB output pool caps).

## OM-2 + `omega-bridge` (`src/native.om`) Rules
- `export fn` return types must be `ulong`, `long`, `int`, `bool`, or `void` (`to uint` fails with exit 110).
- Place `export fn` definitions after internal helper `fn`s (calling an `export fn` internally fails `error 16`).
- Generated C ABI v2 signature puts `uint64_t *result` **first**, followed by `(ptr, len)` pairs for every `view`/`edit` array.
- Avoid OM-2 reserved keywords as identifiers (`out`, `ops`, `at` → `error 16`; `layout` → `error 29`); use `rem` instead of `mod` (`error 3`); declare `new T N v` only at function top scope (`error 9`).
- Avoid `error 12` (16-register pool) in large emitters: keep helper signatures ≤ 4–5 params, store vreg handles in `meta[384..511]` and scratch in `meta[16..63]`, read `sp`/`meta` on demand, split chained `if or ...` / 4-way `and`/`or` conditions into separate nested `if`s, and split nested `for` loops or 6-arg emitter calls into small helpers.
- `text` literals reject `\r` (`error 22: malformed text literal`): write `\n` in `text` literals and emit `13` (`CR`) before `10` (`LF`) in a header writer helper.
- Preserve the exact C vreg allocation order (including scalars initialized on declaration lines before `for` loops) so `omega_bw_regalloc_solve` produces bit-identical SM121 SASS SHA-256 against the C emitter.
- Verify `BlackwellIROpcode` integer values against `src/omega_blackwell_codegen.h` before encoding (`IMAD=8`, `IMAD_WIDE=9`, `FFMA=33`, `LDG_E_64=56`, `LDG_E_128=57`, `LDS128=58`).

## Wire Format & Fail-Closed Boundary Rules
- Standard codegen wire format: `ins[8192]` (up to 1,024 insns × 8 `ulong`s) + `meta[512]` (`0=n, 1=nv, 2=nu, 3=nl, 4=pending, 5=err, 64..319=vreg widths, 320..351=loop pairs, 352..383=uvreg widths`), unpacked by `src/omega_bw_om_ir.h`.
- Guard every forward-branch patcher in `.om` with `if ge pos 1024: ret` so buffer overflow sets `meta[5]=1` and returns cleanly instead of trapping.
- In C wrappers (`omega_blackwell_codegen_*.c`): `memset` `ins` and `meta` to 0 before calling `omega2_cg_*_emit`, and call `omega_bw_ir_init(prog)` on any error path so callers never observe a partial `BlackwellIRProgram`.
- Chain `omega2_bw_sched_stalls` directly on `ins[8192]` after `omega_bw_ir_from_om` without re-packing.

## SM121 (GB10) Direct SASS Emitter Hazards & Proven Patterns
When writing direct SM121 emitters (e.g. `om/gpu/q36/emit_{fast,prefill}.om` using `bw_enc_sm121.om`):
- **`LDS`/`STS`/`STG`/`LDG` address-register WAR hazard & helper clobbers (silent corruption / Xid 31):** `LDS` (`op 49`), `STS` (`op 50`), and `STG` (`op 12`) read their address register asynchronously — always emit `qW1` after `STG`/`STS` and `qW0` between back-to-back `LDS` pairs that reuse the same offset GPRs (`R54/R55`), or warps nondeterministically load the next offset into the prior destination. Likewise, `LDG` (`op 11`/`op 56`/`op 57`) reads its 64-bit address pair asynchronously: never overwrite either half (especially `hi32`, e.g. `R59` after `LDG.E R37, [R58.64]`) before `qW0`/`qW1`, or it triggers `Xid 31: FAULT_PDE`. Always call SMEM-init helpers that clobber scratch GPRs (e.g. `uNvfp4InitLut` clobbering `R52..R54`) **before** `qParam` loads (`topK` in `R54`), or `k=0` unit tests pass while `k>=1` silently corrupts.
- **SM121 fixed ALU latency is 6 cycles (`qAlu4 = qcw 6 7 7 0 0`):** Direct dependent `SHF`/`SHR`/`LOP3`/`I2F`/`FMUL`/`FFMA`/`F2FP` pairs need `>= 6` cycles of total stall separation; `stall 4` on a direct dependency silently reads stale values (`NaN`). Terminate multi-accumulator `FFMA` blocks with `qAlu4` (never `qSt1`) before reducing them with `FADD`, or run-to-run nondeterminism appears. For two independent chains, `qAlu3` (`3`) + `qAlu3` (`3`) gives `6` cycles; keep `qAlu4` (`6`) on the final producer before a joint consumer.
- **Never nest `qBssy`/`qBsync` (`B0` hardcoded) and reserve top 2 GPRs:** Nesting two `qBssy` pairs deadlocks the warp silently with zero Xid; use predicated instructions (`@P0` / `@!P0` via `q36Guard = 2` / `1`) or sequential flat `qBssy` blocks. At `nRegs=64`, Blackwell reserves `R62`/`R63` for `B0` — keep all live GPRs `<= R61`.
- **Encoder operand & alignment traps:**
  - `op 19` in `bw_enc_sm121.om` is `LDG.E.STRONG`, **not** register right-shift; for dynamic 0/16-bit shift, use fixed `op 17` (`SHR imm 16`) + predicate select (`@!P0 MOV`).
  - `op 52` (`SHF.L.U32`) computes `o[2] << o[3]` (not `o[4] << o[3]`).
  - `op 57` (`LDG.E.128`) requires a 4-aligned destination (`reg % 4 == 0`); `op 56` (`LDG.E.64`) requires 2-aligned (`reg % 2 == 0`); unaligned destinations hang the GPU.
  - `op 3` (`S2R`) requires scoreboard 0 (`qcw 4 0 7 0 1`) + `qW0` before reading the destination.
- **Verified GB10 throughput patterns:**
  - **Avoid 8-way SMEM bank conflicts on `LDS.128`:** SMEM bank period is `128 B` (32 × 4 B), so 8 warp lanes striding by `blk * 128` all collide on 4 banks (`2.68×` slowdown on M=4 NVFP4). Pad each 32-float block by `+16 B` (`144 B/blk`, `1152 B/tok`, 16-byte aligned) so all 8 lanes hit 32 disjoint banks (`0` conflicts).
  - **Canonical NVFP4 from ternary (`PTQ1_0`) weights:** Ternary `{-1, 0, +1}` maps losslessly into `FP4 E2M1`; pairing global `alpha = 1/256` with refined `(UE4M3, E2M1_mag ∈ {1.0, 1.5})` cuts scale quantization error from `2.285%` to `1.576%` mean and converts 25.6B weights on GPU in `< 1 s`.
  - **Full-APU `fork()` CPU workers & strict sync:** When forking parallel CPU workers over pipes in `.om`, close inherited pipe fds of earlier workers (`0..w-1`) inside each child (`bonClosePrevPipes`) so parent exit delivers immediate EOF with zero orphan workers. Allocate all CPU↔GPU SHM, staging, LUT, and dynamic load-packet buffers GPU-uncached (`nvalloc(..., false)`), and gate strict `WFI+INVALL` sync behind a runtime flag (`engUseStrictSync`) so unrelated engine paths are unaffected.
  - Use `HMMA.16816.F32.BF16` (`op 16`) + `F2FP.BF16.F32.PACK_AB` (`op 61`) for dense W4/BF16 GEMMs, hot-first deduplicated MoE (`EXP_ORDER` with `cnt > 32` first to eliminate tail-straggler waves), and full Flash-Attention-2 (`Q@K^T` + `P@V` with half-warp `SHFL.BFLY` online softmax).
  - For `D = 128` recurrent reductions (e.g. GDN), assign 1 warp (`32` lanes × `4` dims/lane via `LDG.E.128`) and reduce with `qWarpBflySum` (**0 `BAR.SYNC`, 0 SMEM**).
  - Avoid high-SMEM / high-register scalar GQA-8 fusion when KV fits GB10's 24 MiB L2; occupancy + L2 hits beat scalar fusion, and `HMMA.16816` Flash-Attention beats both.
  - For `B <= 16` decode/verify attention, use Split-K (`S=16`, `Grid=(16,16,1) = 256` CTAs) `HMMA.16816` Batched FA2 (`m_init = -5e8` vs `-1e9` causal mask for exact zero-contribution empty splits) + fused Split-K reduce & sigmoid gate to eliminate the `16`-CTA (`32/48` SMs idle) KV-cache wall (`12K`-ctx `batch8` `+45.7%`, cutting `1K→12K` KV latency tax `2.81×`).
  - Do not ship packed-BF16 GDN (`--w4b`) or INT8 KV (`--kv-int8`) in interactive chat serving without full multi-turn chat verification: BF16 GDN accumulates drift across 30 GDN layers during chat prefill (`0 tok` EOS / `!!!`).

- **SM121 hardware register ceiling (`Xid 13: Out Of Range Register`):** Blackwell reserves 2 warp registers out of `REGISTER_COUNT_V` (`gbq1 35` bits 8..15). `64`-reg kernels may only use **`R0..R61`** (never `R62/R63`); `128`-reg kernels may only use **`R0..R125`** (never `R126/R127`).
- **Deterministic Tensor Core & ALU spacing (avoid silent `tok=0` / run-to-run drift):**
  - Never use `stall=1` (`qS1`) in 4-way/8-way ALU unpack (`SHF`/`SHR`/`LOP3`/`FADD`/`FMUL`); use `qAlu1` (`stall=2`) and `qAlu4` (`stall=6`) on the final `F2FP` before `HMMA`.
  - `HMMA.16816.F32.BF16` same-accumulator RAW latency requires **`22` cycles** (`3× qHmmaFast(4) + qHmma(10)`); `16` cycles (`4×4`) causes non-deterministic output across runs.
  - Always emit `qW1` after `STS` (`op 50`) before reusing any address register (overwriting `R60` with `1` before `qW1` triggers `Xid 13: Misaligned Address`).
- **Encoder shift traps:** `op 17` is immediate `SHR.U32` (ignores register `o[3]`). `op 52` (`SHF.L.U32`) is a **left** shift (`o[2] << o[3]`); to extract byte `b = k & 3`, compute `sh = 24 - 8*b`, emit `qic4 52 dst src sh QZ`, then `qic 17 dst dst QZ 24`.
- **Blackwell Native NVFP4 Tensor Core (`OMMA.SF.16864.F32.E2M1.E2M1.UE4M3.4X`, silicon-verified on GB10):**
  - **128-bit encoding:** `w0 = 29823 | (rD<<16) | (rA<<24)`, `w1 = 1879048192 | rB | (rSa<<8) | (rSb<<20)`, `w2 = 278016 | rD`, `w3 = qcw(8|15, 7, 7, 0, 0)` (29-cycle same-acc RAW latency; 4-tile interleaved `3×8 + 15 = 39` cycles is safe).
  - **Fragment layout (`g = lane>>2`, `t = lane&3`):** `Ra` (`4` u32) = `[W[rA,0..3], W[rB,0..3], W[rA,4..7], W[rB,4..7]]`; `Rb` (`2` u32) = `[X[g,0..3], X[g,4..7]]`; `Rsa` (`4× UE4M3`) = row `g` at `t=0`, row `g+8` at `t=1`; `Rsb` (`4× UE4M3`) = col `g` at `t=0`.
  - **1-cycle hardware quantizers:** `op 65` (`F2FP.SATFINITE.E4M3`, `w2=0x048070ff`) and `op 66` (`F2FP.SATFINITE.E2M1`, `w2=0x042070ff`) in `emit_fast.om`; decode quantized `UE4M3` back to exact `f32` via the 256-entry SMEM FP8 LUT (`SMEM[ue4m3*4]`).
  - **Activation quantizer NaN guard (`F2FP.E4M3`):** Never let `amax * scale_shift > 448.0` reach `op 65` (`F2FP.E4M3` emits `0x7f = NaN`, poisoning `engLut[127]`). Use `ACT_SHIFT = 1.0` (`maxabs * 1/6`, headroom to `2,688`) + explicit `FMNMX.MIN` (`op 36`) clamp at `448.0f32` before `op 65`, paired with `W_SHIFT = 256.0` and a `2^-8` (`0.00390625f32`) epilogue scale.
- **High-throughput GEMM patterns:**
  - **L2-sharing grid swizzle for prefill:** Launch `(ceil(B/128), N/64, 1)` (not `(N/64, ceil(B/128), 1)`) so all `B`-tiles hit the same weight tile in GB10's 24 MiB L2 (`4×` less LPDDR5X weight traffic).
  - **Zero-`I2F` W4 unpack:** Use `LOP3.LUT` (`op 51`, `imm=234=0xEA`) IEEE-754 magic bias (`(q & 0x0f) | 0x4b000000 - 8388616.0f`, `(b & 0xf0) | 0x49000000 - 524296.0f`) instead of `I2F`.
- **Live verification & triage hygiene:** Never accept `PARITY=EXACT` without inspecting actual generated token IDs or English text (guards against `0 == 0` false parity), and poll `/health` up to `60 s` when starting `q38-serve` for HTTP benchmarks. For batched `B=8` GDN conv (`uGdnConvB8`), always keep the `1/sqrt(128) = 0.08838835f32` scale on Q heads (`ctaid.x < nK`). On any `engWaitFast` timeout (`gbmem[3][0] == 0`), check `sudo dmesg -T | grep -i Xid` immediately to pinpoint the faulting VA. When wrapping a run with `spark-window` + `spark-receipt`, pass `SPARK_WINDOW="$WID" spark-receipt <name> -- <cmd>` (do not pass `$WID` as a positional argument to `spark-window run`).

## Mandatory 4-Stage Verification Before Landing
### Spark Scratch & Pinned Dependencies
- Do not rely on `~/workspace/physics` or `~/workspace/omega-bridge` being at the pinned commits: materialize `native.om` at `om/omega-bridge.lock` (`git -C ~/workspace/omega-bridge show <sha>:src/native.om > /tmp/omega-bridge-pin/src/native.om`) and clone `~/git/physics-mv.git` at `physics.lock` into `/tmp/physics-pin`.
- Run baseline diff, `om/units.sh`, and host/sim/hazard tests in a scratch clone (`/tmp/bw-mig-*`) so `~/canon/omega-mv` stays clean.

1. **Regeneration**: `om/units.sh --check` PASS on Spark.
2. **Correctness & Hazards**: Run the target's host + warp-simulator suite (`test-gpu-bf16-gemv`, `test-gpu-fp8gemm`, `test-gpu-fp8`, `gpu_pfhost_test --sim`, etc.) AND `make test-bw-hazard` (0 new findings).
3. **Boundary & Error Paths**: Run `test_bw_om_codegen_bounds` (hostile `meta`/`ins` rejection + invalid spec error-path preservation).
4. **Compiled Kernel Diff vs Parent**: Compare `insns`, peak/declared GPRs, SM121 occupancy, avg stall cycles, and encoded SM121 SASS SHA-256 against the pre-migration parent commit. For live GB10 silicon validation, build `--chip` test binaries **before** opening `spark-window` (`--gb10 exclusive --quiet exclusive` with an `EXIT` trap that closes the window and posts `RELEASE` to `~/handoffs/BOARD.md`), then run one binary at a time with a brief pause (`sleep 2`) between processes.
5. **Receipt Scope & `XID_DELTA=0` Gate (2026-11-28 Audit Standard)**: Label every passing GPU receipt explicitly as `MICROKERNEL_SASS_PASS` (for `<= 512 B` arithmetic/SASS probes) or `FULL_WORKLOAD_GPU_PASS` (for full GEMM/attention/transformer runs with scale metadata), include `XID_DELTA=0` telemetry, preserve `PASS / FAIL / NOT_RUN / BLOCKED_HARDWARE` discipline, and lint with `omega-receipt-lint check` (`skills/audit-receipt-linter/SKILL.md`).
