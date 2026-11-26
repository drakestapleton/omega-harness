---
name: omega-helix-dev
description: >-
  Build, verify, benchmark, and release the standalone pure-Omega `omega-helix` repository across
  macOS Apple Silicon, DGX Spark Linux AArch64 (GB10), Linux x86_64, and GitHub Actions CI. Use
  whenever editing `omega-helix` sources, scripts, tests, CI workflows, GPU H2H benchmarks, or
  cutting signed releases.
---

# Omega Helix Cross-Platform Dev, CI, GB10 H2H & Release Runbook

## 1. Three-Platform Build & Test Hygiene (`macos`, `x86linux`, `aarch64`)
- **Pure-Omega zero-Python gate first:** Run `sh scripts/verify-om.sh` to verify native builds, CPU smoke tests, all 8 pillars, and all 4 byte-traceability locks (`BTLOCK_OK`) with zero Python. Reserve Python strictly for independent `f64` referee mathematical oracles (`tests/`) and Studio stdlib tests.
- **Host target header (`scripts/build.sh`):** Portable `.om` targets (`tok`, `openwaldo`, `univ`, `interchange`) must emit `target a64macos` on `Darwin/arm64`, `target x86linux` on `Linux/x86_64`, and no target override on `Linux/aarch64` (before `om2`).
- **Multi-site `.om` composition ripple:** Whenever a new `.om` unit is called from `native/cli.om` or `native/gpu/gg.om`, update **all** manual concatenation lists—not just `scripts/build.sh`, but also `tools/contrast/Makefile` (`MODEL := ...`), `tests/gpu-disasm.sh`, and standalone test drivers.
- **`x86linux` / `x86efi` dynamic-heap & `omc` rules:** `target x86linux` and UEFI targets refuse dynamic `global ... *` (`error 25`); pair dynamic-heap modules (`native/rev.om`) with static stubs (`native/norev.om`) on those targets. Never place `ret` after `exit` (`omc error 17`).
- **Cross-platform `target a64macos` test guards:** Spark's Linux `omc` rejects `target a64macos` (`error 25`). Guard `target a64macos` builds and Mach-O checks behind `if platform.system() == "Darwin":` and execute the native Linux ELF on `Linux/aarch64`.
- **Binary resolution across scripts & tests:** Every script (`verify.sh`, `quickstart-cpu.sh`, `demo-10s-wow.sh`, `verify-30s.sh`) and Python harness (`test_adaptive_loop.py`, `chain_runner.py`) must select `ollm-macos` on Darwin, `ollm-x86linux` on Linux `x86_64`, and `ollm` on Linux `aarch64`.
- **`x86linux` register pressure (`error 12`):** `omc` has no register spilling and tighter slot ceilings on `x86_64` than AArch64. After editing `native/univ/*.om` or `native/*.om`, test compilation with the published `omega-compiler-*-linux-x86_64.tar.gz` under `qemu-x86_64` on Spark before pushing CI.
- **Standalone `omc` tarballs:** `efirt.om` is not bundled in standalone `omc` tarballs; guard `TARGET=a64efi` on `[ -f "${EFIRT:-$(dirname "$OMC")/../a64efi/efirt.om}" ]`.

## 2. GitHub Actions CI (`.github/workflows/verify.yml`)
- Use `actions/checkout@v4` with `fetch-depth: 0` (required by `tests/test_adaptive_loop.py` `HEAD^` baseline check).
- Download pinned `omc` tarballs + `.sha256` from `https://interplane.io/omega/downloads/`, verify with `grep -F <tarball> *.sha256 | sha256sum -c -` (Linux) or `shasum -a 256 -c -` (macOS), and run `xattr -cr omc && codesign -s - -f omc` on macOS.
- Watch `gh run watch <run-id> --repo drakestapleton/omega-helix --exit-status` to 100% green across `linux-x86_64`, `linux-aarch64`, and `macos-arm64` before cutting a release tag.

## 3. Remote Spark Verification & Fair GB10 H2H Benchmarks
- Sync cleanly without macOS extended attributes or caches:
  `COPYFILE_DISABLE=1 tar --exclude='.git' --exclude='._*' --exclude='.DS_Store' --exclude='build' --exclude='.cache' --exclude='__pycache__' -cf - .`
- Always export `OMC="$HOME/canon/omega-mv/seed/out/omc"` on Spark (`~/.local/bin/omc` does not exist there).
- Follow `nvidia-gb10` window discipline (`CLAIM`/`RELEASE` in `~/handoffs/BOARD.md`, `spark-window open ... --wait` with `EXIT` trap, 10 s GPU RM cooldown between GPU processes).
- For fair `gtrainb` steady-state H2H against PyTorch (`tests/bench_pytorch_h2h.py`, `~/.venv/bin/python3` on Spark): match `H=12` (`P=15,833,472`, `init ... 4096 256 384 12 1536 8 64 1 60000 3000 16`) and pass `every = UNTIL` (e.g. `35 35` minus `5 5`) so 380 MB `f64` `ocksave` disk I/O is not mixed into per-step GPU compute. Never commit `.ck` checkpoints under `evidence/`.

## 4. `oracle.py`, `OLLMSP01` & Python Stdlib Test Contracts
- Run Python suites with `python3 -W error::ResourceWarning` (use `with` on `urlopen`, close `urllib.error.HTTPError` via `try: ... finally: e.close()`, and call `srv.shutdown(); srv.server_close()` in `finally:`) and `python3 -W error::SyntaxWarning -m py_compile`.
- `tests/oracle.py` `xprep` requires `<|endoftext|>` delimiters so `ollm-held.bin` is non-empty for `xeval`.
- `ollm gcheck` takes 2 args (`ck`, `corpus`); `ollm kvcmp` requires `V > 256` and a `bpefit` merges file.
- Fast negative controls: `OLLM_ORACLE_MUTANT=tiemaxa python3 tests/oracle.py selftest-v1` (`rc=1`), and flipping 1 bit at byte offset 48 of an `OLLMSP01` `.sp` trips `ollm spapp` with `rc=61`.
- In POSIX `sh`, never check `$?` after `cmd | tail` (pipe masks exit code to `0`); redirect to a temp file, capture `$?`, then `tail`.

## 5. Pure-Omega RFC 8032 Ed25519 Release Signing
- Compose on Spark with `printf 'om2\n'` at top followed by `omega-mv` `sha512.om`, `ed25519.om` (do not strip `om2`), `ed_sign.om`, and `sign_ddc.om`.
- Keep the 32-byte hex seed strictly outside git (`~/.config/omega-helix/release-*.key`, `chmod 600`); commit only the 64-hex public key (`evidence/<tag>/release-pubkey.ed25519.hex`).
- Dual-verify every signed `SHA256SUMS.txt` with both pure-Omega `edverify` (strict mode 0) and Python `cryptography` `Ed25519PublicKey.verify()`.

## 6. Four Byte-Traceability Invariants (Do Not Regress in GB10 / Phase 1 Kernels)
1. **No unordered cross-CTA FP atomics (`native/gpu/gm.om`):** Audit emitted SM121 SASS with `gm_audit_no_fp_atomics` (fail closed on `ATOM`/`ATOMG` FP opcodes) and use fixed-order reduction trees or exact associative `i64` Q30 fixed-point accumulation (`gm_reduce_i64_fixed`).
2. **Epoch ping-pong Grace ↔ Blackwell sharing (`native/gpu/ring.om`):** GPU reads immutable bank `epoch & 1` while Grace stages `(epoch + 1) & 1`; fail closed (`-8` / `RING_ERR_EPOCH_VIOLATION`) on any mid-step active-bank mutation or mid-step commit; swap only at deterministic step boundaries with `cpufence`.
3. **Receipt-logged JIT promotions (`native/gpu/ejit.om`):** Admit only bit-identical schedules through the 4-wall gate, record `(step_index, gen, kernel_sha256)` on every flip, and verify exact digest & step order on deterministic replay (`EJ_ERR_REPLAY_DIGEST` / `EJ_ERR_REPLAY_ORDER`).
4. **Exact fixed-point reversible residuals (`native/rev.om`):** Preserve `REV_FL_Q32` (`i64` Q30 `(x + F) - F == x`, 0-bit reconstruction error across extreme dynamic range / BF16 branch outputs) and bit-identical backward passes (`rev_det_bwd_selftest`).

## 7. Omega Helix Studio UI, Security & Remote Contracts (`tools/studio/`)
- Keep `tools/studio/ui/` aligned with `aienos.com` craft: pitch-black `#000000` starry dark mode + clean light mode (semantic CSS vars only — never hardcode dark hexes), native `<dialog closedby="any">`, and zero inline `<script>` under `script-src 'self'` CSP (use synchronous external `theme-init.js` for FOUC prevention).
- **CSS specificity & dedup hygiene:** Define modifier badge classes (e.g. `.badge.apu-b-{sps,ov,merkle}`) *after* base `.badge` with explicit `border: 1px solid ...`, and never duplicate rule blocks inside `@media` queries.
- **Headless Spark Studio launch:** Start headless Studio with `--headless --no-open` (there is no `--no-browser` flag); preserve Orca-style SSH remote/pairing/tunneling CLI & API patterns (`tools/studio/ssh_remote.py`, `~/.ssh/config` discovery, managed `ssh -L` `TunnelManager`, `/api/remotes*`).
- **Bounded manifest & cross-platform `apuweave` security invariants (`DRA-1021`, `#23`, `#25`):**
  - Open caller-selected shard manifests with `O_RDONLY | O_NONBLOCK`, verify `stat.S_ISREG(fstat(fd).st_mode)` (rejecting FIFOs/devices/dirs without blocking), and enforce `MAX_MANIFEST_BYTES = 1 MiB` (`1048576` B) + `MAX_MANIFEST_ENTRIES = 2048` before spawning workers.
  - On non-Linux hosts when `shards_dir` is a directory, synthesize `out_dir/shards.list` from `sorted(p for p in src.glob("*.tok") if p.is_file() and not p.name.startswith("."))` (skipping macOS `._*` AppleDouble files and `*.tok/` subdirs); clamp `workers <= 16` (`APU_MAX_WORKERS`); match native `apu_parse_list_line` 2/3-column parsing so `out_packs` never pulls stale `.sp2` files.
- **Tokenizer alignment & Arboris bypass:** Default `V=256` presets (`OMG` / `nano`) must set `tokenizer: "byte"` (not `"bpe"`); use multi-order `3/2/1-gram` Arboris recall + multi-seed OMG corpora so demo bypass telemetry is realistically non-zero (`33–94%`).

## 8. Spiral-2048 (`OLLMSP02`), Full-APU `apuweave` & SM121 78-Slot Silicon Baselines
- **Pure-Omega Spiral & Full-APU CLIs (`native/spiral.om`, `native/apu_weave.om`):**
  - `ollm spcryst <base.ck> <domain.tok> <out.sp2> <f_exp> <lambda_milli> [max_toks=4096] [strand_id=1] [quant_bits=4]` — zero-backprop analytical Cholesky crystallization with Arboris/Rho-1 surprisal weighting into 80-byte Merkle `OLLMSP02` W4/f64 packs (1-bit header/payload tamper `rc=61`, base mismatch `rc=62`).
  - `ollm spweval <base.ck> <eval.tok> <top_k> <W> <s1.sp2> ...` and `ollm spwsamp` (or `spsamp` auto-dispatch — always probe `OLLMSP02` via non-fatal `fopen`/`read`/`fclose`, never `oprd`, so 8-arg `OLLMSP01` `spsamp` with numeric seed never exits `70`).
  - `ollm-gb10 apuweave <base.ck> <shards_dir_or_list> <out_dir> <f_exp> <lambda_milli> <max_toks> <quant_bits> [workers=16]` — fires 48 Blackwell SMs (`gfcache` + `ggxw` over uncached `nvalloc(..., false)`) simultaneously with 20 Grace ARMv9 cores (`fork()` + `bonClosePrevPipes` + `MAP_SHARED` ring).
  - `ollm-gb10 nvfp4 4096 4096 8192 20` — live SM121 `OMMA.SF.16864` NVFP4 Tensor Core benchmark & exactness check.
- **Verified DGX Spark GB10 Baselines (do not regress; tip `193389d`):**
  - `GPU_DISASM_OK slots=78 bad=0` across default, `D=1536`, and `D=2048 T=512 F=8192` (`RMSF`/`RMSB`/`CE_BF16 <= 72 GPR`).
  - `15.83M` H2H (`B=64 T=256 L=8`): **`63.34 ms/step` (`258,648 tok/s`, `24.57 TF`)** — beats `torch.compile` (`63.64 ms`).
  - `116.6M` (`D=768 L=16`): **`104.52 ms/step` (`39,190 tok/s`, `27.43 TF` full / `31.97 TF` fwd+bwd)**.
  - `Spiral-2048` (`D=2048 L_phys=8×NP=4=32L`, `1.083B` eff): **`368.28 ms/step` (`5,561 tok/s`, `36.12 TF` full / `40.46 TF` fwd+bwd)**.
  - Live SM121 `OMMA.SF.16864` NVFP4: **`458.9–462.9 TFLOP/s`** (`91.8%–92.6%` of `500 TF` peak, bit-exact `PASS`).
  - Full-APU `apuweave` (64 W4 strands): **`3.915 s` steady-state (`16.35 strands/s`)**, live `90%` GPU + `91.7%` all 20 Grace cores (`93.8%` of `2.0×` overlap), `64/64` tamper `rc=61` PASS.
- **120M+ / Cross-Platform Native Invariants (Do Not Regress):**
  - All parameter & GPU arena loops (`spec.om:osp_basehash`, `osp_hsnap`/`osp_hrest`, `context.om` `nvalloc > 15.26 GiB`) must use `bound 9223372036854775807` or `OCKC`-chunking; keep `spclip` max depth `>= 24`.
  - Linux `apu_scan_dir_entry` (`native/apu_fabric_linux.om`): check `linux_dirent64.d_type` at offset `p + 18` (`DT_REG=8`, `DT_LNK=10`, `DT_UNKNOWN=0`) and verify `DT_LNK`/`DT_UNKNOWN` via Omega's arch-portable 1-syscall `stat` (`and apu_get4_io 16 61440 == 32768`, `S_ISREG`) — never `fopen+fseek+getdnts` heuristics (misclassifies `/dev/null` symlinks and opens untrusted targets).
  - macOS cold store (`native/mio.om`): grow dynamically on demand to avoid `rc=103` bounds traps on large checkpoints (`tests/test_sp_closed_form.py` 19/19).
  - Avoid AArch64-only `fma` in portable `x86linux` tests (`add mul` instead); keep `verify-om.sh` Sections 11 (`SPIRAL_WEAVE_OM_PASS`) & 12 (`APU_WEAVE_OM_PASS`) green across macOS and Spark.
- **`D=2048` Helix Razor Overnight Training & Bundling Invariants:**
  - `V` is hard-capped at `4096` (`ogok`); `D=2048 T=128 H=32 F=4096 L_phys=8 NP=4 (LV=32) B=32` (`277.1M` base / `1.08B` 32L eff, `6.65 GB` `.ck`) is the verified fastest `D=2048` shape (`~636 ms/step`, `41.8 TF` BF16).
  - Use `LR_MICRO=250` (`2.5e-4`) for `D=2048 32L-eff` (`LR_MICRO=1500` diverges post-warmup).
  - Keep `.tok` chunks `<= 30 MiB` (`ODCAP=33,554,432 B`), pass `<merges4096.bin>` as the **5th arg** to `ollm-gb10 geval` whenever `V > 256` (4 args exits `2`), and use `APU_SUMMARY` from Full-APU `apuweave` (~14 min/2,048-strand bundle) rather than blocking on the slow 45-min CPU `spweval` probe.
- **SM121 NVFP4 (`OMMA.SF.16864`) Training-Loop Invariants (slots `88..95`, `gtrain4`/`gnv4gemm`/`gnv4cmp`):**
  - Apply 2-level tensor pre-scaling (`pre_scale` in `gkarg[9]` + `alpha = 1/(sA*sB)` in `gkarg[25]`: `sW=16.0`, `sGrad=4096.0`) so backward gradients (`~1e-4`) do not underflow `UE4M3`'s `2^-6` normal floor.
  - Reset `ggmm4_sc 1.0 1.0` on **every** BF16 / Split-K fallback path in `ggxwh`/`ggxwth`/`ggwgh` so scales never leak into subsequent `ggmm4` calls.
  - In `gkgemmnv4_128`, never use `gkldc64 10 ...` while `R11` holds live `tid >> 1` (`gkldc64` writes the `R10:R11` pair).
- **`/dev/aien-gpu` Pure-Omega Backend & Live Baselines (`a909888` / PR #39):**
  - `native/gpu/context.om` matches `aien_gpu_uapi.h` ABI v1 (`handle @20`, `mmap_off @24`, `st @32`) and auto-selects `/dev/aien-gpu` whenever `/dev/nvidiactl` is absent (zero `nvidia.ko`, no env var needed).
  - Build standalone 16 KB pure-Omega M16 hardware gate via `TARGET=aien-m16 sh scripts/build.sh` (`native/gpu/aien_m16.om`).
  - Verified live on Spark `/dev/aien-gpu`: `nvfp4 4096 4096 8192 20` **`456.80 TF`**, `gnv4gemm 4096` Case 4 `cos=0.999118`, `D=2048 8x4 gtrain4` **`12,840 ms`** (**`1.17×` faster** than `nvidia.ko`'s `14,960 ms`), `verify-om.sh` PASS.
  - Exact test invocations: `sh tests/gpu-disasm.sh --all` (`--all` required -> `GPU_DISASM_OK slots=86 bad=0`) and `python3 tests/test_gpu_nvfp4_train.py`.
