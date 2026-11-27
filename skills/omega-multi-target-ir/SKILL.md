---
name: omega-multi-target-ir
description: >-
  Build, extend, and verify pure seeded-Omega (OM-2) multi-target IR compilers
  driven by external plain-text hardware tables (chips.tsv), targeting Apple
  Silicon Mach-O, Linux ARM64/x86-64/RV64GC ELFs, Universal WebAssembly
  (irwasm.om), Vulkan 1.3 SPIR-V (vkspirv.om), Intel Xe2/Xe3 128-bit EU
  (gpu/intel/xe/isa.om), and Blackwell SM121 SASS (bw_enc_sm121.om +
  monk_check.om). Use whenever building portable pure-Omega IR compilers,
  adding chips to chips.tsv, or compiling through omc OSC IR v1.
---

# Pure-Omega Multi-Target IR & Universal Hardware Table Runbook

Use this skill when building or extending portable pure-Omega compilers (such as `omega-resir`) that compile one hardware-independent recipe across CPUs, GPUs, WebAssembly, and SPIR-V with zero C, LLVM, or CUDA.

## 1. Zero-Recompile Hardware Table Pattern (`chips.tsv`)

- Store chip profiles in a plain-text 15-column tab-separated `chips.tsv` loaded at runtime (`--chips <file>`, default `chips.tsv`, up to 64 rows), never hardcoded-only in `.om` source.
- **Master copy:** `omega-mv/seed/ng/target/chips.tsv` and `chips_tsv.om` (`omega-mv/seed/ng/target/chips_tsv.om`) serve as the master copy of the universal hardware table and parser; keep project-local tables/parsers synced from them rather than diverging schemas.
- Sync each loaded chip's limits (`exec`, `isa`, `ngpr`, `smem`, `subgroup`, `mma`, `feat`) into a scratch `TargetDesc` slot (`tdRegIsa`..`tdRegFeat`) and enforce contracts via `omega-mv/seed/ng/target/target_desc.om` (`tdCheckKernelContract`).
- Always include a **zero-recompile maintainer gate**: append a synthetic chip row (e.g., `future-chip-2030`) to a temporary TSV copy, verify valid recipes pass and emit without recompiling the compiler, and verify an over-limit recipe fails closed (`exit 72`, `TDK_ERR_2`).

## 2. Cross-Platform `omc` Rules (`target a64macos` + Linux `aarch64`)

- **Never compose `seed/ng/multi_target/vendor_targets.om` into `target a64macos` units:** it uses Linux-only `cpunow`/`faccess` (`error 25`). Compose `seed/ng/sha256.om` + `seed/ng/target/target_desc.om` + `om/encoder/bw_enc_sm121.om` + your compiler instead.
- **Type & keyword traps:**
  - `argcnt` is signed (`long`); cast `ulong argcnt` before comparing with `ulong` (`error 7`).
  - `ops` is a reserved keyword (`error 16`); use `opmask`.
  - `exit` diverges; never place a fallback `ret` after `exit` in the same block (`error 17`).
  - Avoid chaining untyped literals inside nested `or`/`xor` (`error 11`); accumulate into a typed `ulong` variable or explicitly tag `ulong <lit>`.
  - Keep functions shallow (`< 12` live locals/temps) and `<= 6` parameters (`error 9` / `error 12`).

## 3. Universal WebAssembly & Vulkan 1.3 SPIR-V via OSC IR v1

Both `omega-mv/seed/wasm/irwasm.om` and `omega-mv/seed/spirv/vkspirv.om` are **OM-1** programs:

```sh
"$OMC" < "$CANON/seed/wasm/irwasm.om"   > bin/irwasm
"$OMC" < "$CANON/seed/spirv/vkspirv.om" > bin/vkspirv
```

- **Never** prepend `om2\n` when compiling `irwasm.om` or `vkspirv.om` (`error 16`).
- Every generated scalar unit fed to `{ printf 'ir\n'; cat unit.om; } | "$OMC"` **must** obey all five `omc` OSC IR v1 ceilings:
  1. **All function, parameter, and local names `<= 8` bytes** (`error 13`).
  2. **Hard per-unit/function caps (`error 14`):** `<= 32` functions per unit, `< 32` basic blocks (`ir_block`), `< 32` literals (`ir_lit`), and `< 256` ops (`ir_op`) per function. Split 16-way lookups into two 8-way helpers (`wave_lo`/`wave_hi`) or straight-line 8-term functions.
  3. **No forward calls** (`error 3`): emit every helper strictly before its callers.
  4. **Loop `bound <= 999999`** (`1000001` fails `error 8` in OM-1 IR mode).
  5. **Pure scalar subset only:** no `global`, `text`, host I/O, or `rotr`/`rotl` (expand rotates via `or shr x k shl x (64-k)`, use decimal 64-bit constants, and type inner constant binary ops `xor ulong K V`).
- Verify **2× byte determinism** (`cmp`) on both `.wasm` and `.spv`, execute `.wasm` live in `node` on both Spark and MacBook, and validate `.spv` with `spirv-val --target-env vulkan1.3` + `spirv-dis`.

## 4. Direct Native & GPU Binary Verification Playbook

- **Intel Xe2 / Xe3 128-bit EU (`gpu/intel/xe/isa.om`):**
  - Emit 16-byte LE instructions (`16..4096 B` total), valid opcodes (`0x31/0x38/0x40/0x41/0x5c/0x60/0x61/0x62/0x70`), non-zero SWSB scoreboard token in `lo[15:8]` on every instruction, zero `XE_SEND` loads inside resident loops, and mandatory `SEND_EOT` (`bit 34`) terminator.
  - Validate with `isa check <bin>` (`exit 0`) and kill a zero-SWSB mutant (`b[1] = 0` → `exit 1`).
- **Blackwell SM121 SASS (`bw_enc_sm121.om` + `monk_check.om`):**
  - Compose `sha256.om` + `bw_hazard.om` + `hx_dec_ext.om` + `monk_check.om` (omitting `hx_dec_ext.om` fails `error 3`).
  - Test **two** negative controls:
    1. Unsigned 1-byte SASS tamper → `MONK REJECT code=12 reason=digest-spoof` (`exit 12`).
    2. Self-signed mutant (`cand_sha` updated at HXP1 bytes `40..71`) with `pc=17` stall shaved `6→2` at byte `pc*16+13` (`(b & ~0x1e) | 0x04`) → `MONK REJECT code=17 reason=sm121-hazard` (`exit 17`).
- **Direct RISC-V 64 Static ELF64 (`EM_RISCV=243`):**
  - Handle RV64I 12-bit signed `ADDI` sign-extension in `LUI+ADDI` (`if lo >= 2048` increment `hi20`), encode B-type `BNE` offsets accurately, and normalize 64-bit error masks with `SLTU a0, x0, a0` before `ecall` (`a7=93`) so non-zero mismatches never wrap mod-256 to `exit 0`.
  - Verify `file` (`UCB RISC-V`), `readelf -d` (no dynamic section), live `qemu-riscv64` (`exit 0`), and a 1-bit valid-instruction reverse mutant (`exit 1`).

## 5. Spark Telemetry, Asymmetric Cores & Checksum Discipline

- **PCI driver check:** Use `[ -L /sys/bus/pci/devices/000f:01:00.0/driver ]`, never bare `readlink -f` (which prints the nonexistent path instead of `UNBOUND`).
- **Spark Grace heterogeneous variance:** Unpinned runs bounce between `Cortex-X925` (big) and `Cortex-A725` (efficiency); always run 5 trials, report min/median/max via Wolfram, and note core-class spread.
- **Evidence badges:** Strictly separate `HOST-VERIFIED` (physical CPU / Node WASM), `ELF BUILT + EMULATED` (`qemu-x86_64`/`qemu-riscv64`), `SPEC-VALIDATED` / `ISA-VALIDATED` / `MONK-VERIFIED`, and `NOT_RUN` (never claim physical GPU execution without a live silicon receipt).
- **Checksum hygiene:** When generating `receipts/SHA256SUMS.txt` from repo root, always exclude `SHA256SUMS.txt` itself (`grep -v 'SHA256SUMS\.txt$'`) and verify `shasum -a 256 -c receipts/SHA256SUMS.txt` exits `0` with zero warnings.
