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
- Avoid OM-2 reserved keywords as identifiers (`out`, `ops`, `at` → `error 16`); use `rem` instead of `mod` (`error 3`); declare `new T N v` only at function top scope (`error 9`).
- Avoid `error 12` (16-register pool) in large emitters: keep helper signatures ≤ 4–5 params, store vreg handles in `meta[384..511]` and scratch in `meta[16..63]`, and split nested `for` loops or 6-arg emitter calls into small helpers.
- Verify `BlackwellIROpcode` integer values against `src/omega_blackwell_codegen.h` before encoding (`IMAD=8`, `IMAD_WIDE=9`, `FFMA=33`, `LDG_E_64=56`, `LDG_E_128=57`, `LDS128=58`).

## Wire Format & Fail-Closed Boundary Rules
- Standard codegen wire format: `ins[8192]` (up to 1,024 insns × 8 `ulong`s) + `meta[512]` (`0=n, 1=nv, 2=nu, 3=nl, 4=pending, 5=err, 64..319=vreg widths, 320..351=loop pairs, 352..383=uvreg widths`), unpacked by `src/omega_bw_om_ir.h`.
- Guard every forward-branch patcher in `.om` with `if ge pos 1024: ret` so buffer overflow sets `meta[5]=1` and returns cleanly instead of trapping.
- In C wrappers (`omega_blackwell_codegen_*.c`): `memset` `ins` and `meta` to 0 before calling `omega2_cg_*_emit`, and call `omega_bw_ir_init(prog)` on any error path so callers never observe a partial `BlackwellIRProgram`.
- Chain `omega2_bw_sched_stalls` directly on `ins[8192]` after `omega_bw_ir_from_om` without re-packing.

## Mandatory 4-Stage Verification Before Landing
1. **Regeneration**: `om/units.sh --check` PASS on Spark.
2. **Correctness & Hazards**: Run the target's host + warp-simulator suite (`test-gpu-bf16-gemv`, `test-gpu-fp8gemm`, `test-gpu-fp8`, `gpu_pfhost_test --sim`, etc.) AND `make test-bw-hazard` (0 new findings).
3. **Boundary & Error Paths**: Run `test_bw_om_codegen_bounds` (hostile `meta`/`ins` rejection + invalid spec error-path preservation).
4. **Compiled Kernel Diff vs Parent**: Compare `insns`, peak/declared GPRs, SM121 occupancy, avg stall cycles, and encoded SM121 SASS SHA-256 against the pre-migration parent commit. If claiming speed, also run live GB10 benchmarks inside an exclusive `spark-window`.
