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

## 7. Omega Helix Studio UI & SSH Remote Conventions (`tools/studio/`)
- Keep `tools/studio/ui/` aligned with `aienos.com` craft: pitch-black `#000000` starry dark mode + clean light mode, native `<dialog closedby="any">`, and zero inline `<script>` under `script-src 'self'` CSP (use synchronous external `theme-init.js` for FOUC prevention).
- Preserve Orca-style SSH remote/pairing/tunneling CLI & API patterns (`tools/studio/ssh_remote.py`, `~/.ssh/config` discovery, managed `ssh -L` `TunnelManager`, `/api/remotes*`).
