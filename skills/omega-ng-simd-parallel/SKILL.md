---
name: omega-ng-simd-parallel
description: >-
  Design, compile, and benchmark high-throughput Pure-Omega (.om) compute kernels
  using Omega NG (@ng opt + @ng a64) 128-bit AArch64 NEON SIMD workers and
  heterogeneous 20-core Grace X925/A725 fork+cpuset+pipe coordinators on DGX Spark.
  Use whenever porting or optimizing compute-bound kernels in Pure-Omega instead of
  shipping single-core scalar omc ports.
---

# Pure-Omega Parallel Volume-Push: Omega NG NEON SIMD + Grace 20-Core Runbook

Never stop at a single-core scalar `omc` port when benchmarking or competing with
`g++ -O3` / CUDA / Vulkan. Default immediately to **wide parallel volume pushes**:
128-bit AArch64 NEON SIMD via Omega NG (`seed/ng`) combined with heterogeneous
all-core Grace (`10× X925 + 10× A725`) worker parallelism (and SM121 / Full-APU
co-execution when GPU access is unblocked).

## 1. Two-Tier Pure-Omega Architecture (Zero C, Zero libc, Zero Dynamic Libs)

1. **NG NEON Worker (`emit_*_ir.om` → `tools/ng` → static AArch64 ELF):**
   - An OM-2 generator emits binary ΩIR (`*.ir`) with `vec f32 4` / `vec f64 2`
     SIMD loops and constant-bound guards.
   - Verify & compile strictly through `tools/ngcheck` and `tools/ng`:
     ```sh
     # omc ALWAYS reads stdin and writes stdout (passing file args triggers error 16)
     seed/out/omc < emit_worker_ir.om > bin/emit_worker_ir && chmod +x bin/emit_worker_ir
     ./bin/emit_worker_ir > work/worker.ir
     tools/ngcheck < work/worker.ir
     { printf '@ng opt\n'; cat work/worker.ir; } | tools/ng > work/worker.opt.ir
     { printf '@ng opt-count\n'; cat work/worker.ir; } | tools/ng
     tools/ngcheck < work/worker.opt.ir
     { printf '@ng a64\n'; cat work/worker.opt.ir; } | tools/ng > bin/worker && chmod +x bin/worker
     readelf -d bin/worker   # must report: There is no dynamic section in this file.
     ```
   - **Important:** `tools/ng` reads its mode directive (`@ng opt`, `@ng opt-count`,
     `@ng a64`) on **line 1 of stdin**; `tools/ngcheck` reads raw binary IR directly.

2. **OM-2 Multi-Worker Coordinator (`*_coord.om` → `seed/out/omc`):**
   - Loads inputs once into a single `global c_in uchar <N>` BSS buffer and streams
     per-worker slices directly from byte offsets (`write fd c_in off len`)—**zero**
     pack/unpack/bitcast CPU loops.
   - Spawns `W` pinned workers via `pipefds` + `fork` + `dupfd` + `cpuset` + `execprog`.

## 2. `@ng opt` Optimization & Bit-Exact Parity Checklist

- **Unlock BCE (Bounds-Check Elimination):** Add explicit constant-bound guards on
  loop/index variables (`lt x 512`, `lt px 511`, `lt tx 5120`) so `@ng opt` hoists
  and eliminates in-loop traps (verified to drop in-loop ops by ~35–40% and clear
  170–209+ bounds checks per worker).
- **Preserve 0-ULP FP Parity:** Match exact IEEE-754 evaluation order (e.g.
  left-to-right `(cw * e) * e` instead of re-associated products) and fold worker
  partial reductions in a fixed deterministic `(pass, colour, worker, chunk)` order
  in the coordinator.
- **Avoid `omc` Refusals in Emitters & Coordinators:**
  - Use `f32`/`f64` (never `float`/`double`), `f64 0` (no bare float literals), and
    `bitcast ulong long -1` (no `ulong -1`).
  - `for k ulong cnt bound B` requires strict `B >= cnt + 1`.
  - Variables declared inside `if`/`else` go out of scope at `end`.
  - Keep functions to `<= 6` parameter slots (`error 9`) and `<= ~8` local/param
    names with flat call trees (`error 12`).
  - `monons`, `argread`, and `argcnt` return `long`.

## 3. `execprog` IPC & Deadlock-Free Halo Relay

- **`execprog` closes every fd `>= 3`** (`close_range(3, UINT_MAX)`). Never pass
  inherited pipes on fd `>= 3`; always `dupfd` worker stdin/stdout to `fd 0` and
  `fd 1` before `execprog`.
- **Deadlock-free bidirectional halo sync:** For stencil/checkerboard kernels that
  exchange border rows (`<= 8192 B` fits comfortably in the Linux `>= 64 KB` pipe
  buffer):
  - Workers **write** their outgoing border row to `fd 1` **before** blocking on
    `read(fd 0)` for their neighbor's incoming halo.
  - Coordinator reads all sending workers' rows into a relay buffer first, then
    writes to all receiving workers.

## 4. Heterogeneous DGX Spark Grace Pinning & Noise-Resistant Timing

- **Core topology (20 Grace ARMv9 cores):**
  - **10× Cortex-X925 @ 3.9 GHz (fast):** CPUs `5, 6, 7, 8, 9, 15, 16, 17, 18, 19`
  - **10× Cortex-A725 @ 2.8 GHz (efficiency):** CPUs `0, 1, 2, 3, 4, 10, 11, 12, 13, 14`
- **Pinning & weighted splits:**
  - `W=1`: pin worker 0 to CPU `5` (X925).
  - `W=20`: map `w=0..9` to X925 and `w=10..19` to A725 with weighted contiguous
    row partitions (e.g., ~`76` rows on X925 vs ~`52` rows on A725 for `128` rows)
    so fast and efficiency cores finish the barrier together.
- **Timing hygiene:** Shared Spark load (e.g., concurrent jobs on X925 cores) causes
  single-iteration barrier tail spikes. Always run **`1` warmup + `9` timed passes**
  and take the median (`med9`), plus verify `3×` deterministic rebuild SHA-256 parity.
