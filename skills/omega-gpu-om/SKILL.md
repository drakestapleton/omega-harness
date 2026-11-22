---
name: omega-gpu-om
description: >-
  Migrate or write Blackwell GPU planners, schedulers, QMD packers, and SM121
  codegen emitters in pure seeded OM-2 under om/gpu/, bound through om/units.sh.
  Use when touching omega-mv GPU codegen, om/gpu/*.om, omega_bw_om_ir.h, or
  regenerating src/omega_om_units.c.
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
- Avoid `error 12` (16-register pool) in large emitters: keep helper signatures ≤ 4–5 params, store vreg handles in `meta[384..511]` and scratch in `meta[16..63]`, read `sp`/`meta` on demand, split chained `if or ...` conditions into separate `if`s, and split nested `for` loops or 6-arg emitter calls into small helpers.
- Preserve the exact C vreg allocation order (including scalars initialized on declaration lines before `for` loops) so `omega_bw_regalloc_solve` produces bit-identical SM121 SASS SHA-256 against the C emitter.
- Verify `BlackwellIROpcode` integer values against `src/omega_blackwell_codegen.h` before encoding (`IMAD=8`, `IMAD_WIDE=9`, `FFMA=33`, `LDG_E_64=56`, `LDG_E_128=57`, `LDS128=58`).

## Wire Format & Fail-Closed Boundary Rules
- Standard codegen wire format: `ins[8192]` (up to 1,024 insns × 8 `ulong`s) + `meta[512]` (`0=n, 1=nv, 2=nu, 3=nl, 4=pending, 5=err, 64..319=vreg widths, 320..351=loop pairs, 352..383=uvreg widths`), unpacked by `src/omega_bw_om_ir.h`.
- Guard every forward-branch patcher in `.om` with `if ge pos 1024: ret` so buffer overflow sets `meta[5]=1` and returns cleanly instead of trapping.
- In C wrappers (`omega_blackwell_codegen_*.c`): `memset` `ins` and `meta` to 0 before calling `omega2_cg_*_emit`, and call `omega_bw_ir_init(prog)` on any error path so callers never observe a partial `BlackwellIRProgram`.
- Chain `omega2_bw_sched_stalls` directly on `ins[8192]` after `omega_bw_ir_from_om` without re-packing.

## SM121 (GB10) Direct SASS Emitter Hazards & Proven Patterns
When writing direct SM121 emitters (e.g. `om/gpu/q36/emit_{fast,prefill}.om` using `bw_enc_sm121.om`):
- **`LDS.32`/`STS.32` address-register clobber hazard (silent corruption / `NaN`, 0 Xid):** `LDS` (`op 49`) and `STS` (`op 50`) read their address register asynchronously on scoreboard 1 (`rbar=1`). Never modify an address register (e.g. `IADD addr, addr, 4`) or load into a register that was an address source of an in-flight `LDS` before `qW1`/`qW0`. Compute disjoint address registers first, issue batched `LDS`/`STS`, then emit one `qW0`/`qW1`.
- **SM121 fixed ALU latency is 6 cycles (`qAlu4 = qcw 6 7 7 0 0`):** Direct dependent `SHF`/`SHR`/`LOP3`/`I2F`/`FMUL`/`FFMA`/`F2FP` pairs need `>= 6` cycles of total stall separation; `stall 4` on a direct dependency silently reads stale values (`NaN`). For two independent chains, `qAlu3` (`3`) + `qAlu3` (`3`) gives `6` cycles of separation; keep `qAlu4` (`6`) on the final producer before a joint consumer.
- **Never nest `qBssy`/`qBsync` (`B0` hardcoded):** Nesting two `qBssy` pairs deadlocks the warp silently with zero Xid. Use predicated instructions (`@P0` / `@!P0` via `q36Guard = 2` / `1`) or sequential flat `qBssy` blocks.
- **Encoder operand & alignment traps:**
  - `op 52` (`SHF.L.U32`) computes `o[2] << o[3]` (not `o[4] << o[3]`).
  - `op 57` (`LDG.E.128`) requires a 4-aligned destination (`reg % 4 == 0`); `op 56` (`LDG.E.64`) requires 2-aligned (`reg % 2 == 0`); unaligned destinations hang the GPU.
  - `op 3` (`S2R`) requires scoreboard 0 (`qcw 4 0 7 0 1`) + `qW0` before reading the destination.
- **Verified GB10 throughput patterns:**
  - Use `HMMA.16816.F32.BF16` (`op 16`) + `F2FP.BF16.F32.PACK_AB` (`op 61`) for dense W4/BF16 GEMMs, hot-first deduplicated MoE (`EXP_ORDER` with `cnt > 32` first to eliminate tail-straggler waves), and full Flash-Attention-2 (`Q@K^T` + `P@V` with half-warp `SHFL.BFLY` online softmax).
  - For `D = 128` recurrent reductions (e.g. GDN), assign 1 warp (`32` lanes × `4` dims/lane via `LDG.E.128`) and reduce with `qWarpBflySum` (**0 `BAR.SYNC`, 0 SMEM**).
  - Avoid high-SMEM / high-register scalar GQA-8 fusion when KV fits GB10's 24 MiB L2; occupancy + L2 hits beat scalar fusion, and `HMMA.16816` Flash-Attention beats both.

## Mandatory 4-Stage Verification Before Landing
### Spark Scratch & Pinned Dependencies
- Do not rely on `~/workspace/physics` or `~/workspace/omega-bridge` being at the pinned commits: materialize `native.om` at `om/omega-bridge.lock` (`git -C ~/workspace/omega-bridge show <sha>:src/native.om > /tmp/omega-bridge-pin/src/native.om`) and clone `~/git/physics-mv.git` at `physics.lock` into `/tmp/physics-pin`.
- Run baseline diff, `om/units.sh`, and host/sim/hazard tests in a scratch clone (`/tmp/bw-mig-*`) so `~/canon/omega-mv` stays clean.

1. **Regeneration**: `om/units.sh --check` PASS on Spark.
2. **Correctness & Hazards**: Run the target's host + warp-simulator suite (`test-gpu-bf16-gemv`, `test-gpu-fp8gemm`, `test-gpu-fp8`, `gpu_pfhost_test --sim`, etc.) AND `make test-bw-hazard` (0 new findings).
3. **Boundary & Error Paths**: Run `test_bw_om_codegen_bounds` (hostile `meta`/`ins` rejection + invalid spec error-path preservation).
4. **Compiled Kernel Diff vs Parent**: Compare `insns`, peak/declared GPRs, SM121 occupancy, avg stall cycles, and encoded SM121 SASS SHA-256 against the pre-migration parent commit. For live GB10 silicon validation, build `--chip` test binaries **before** opening `spark-window` (`--gb10 exclusive --quiet exclusive` with an `EXIT` trap that closes the window and posts `RELEASE` to `~/handoffs/BOARD.md`), then run one binary at a time with a brief pause (`sleep 2`) between processes.
