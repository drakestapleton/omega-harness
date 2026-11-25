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
- **Host target header (`scripts/build.sh`):** Portable `.om` targets (`tok`, `openwaldo`, `univ`, `interchange`) must emit `target a64macos` on `Darwin/arm64`, `target x86linux` on `Linux/x86_64`, and no target override on `Linux/aarch64` (before `om2`).
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
- Run Python suites with `python3 -W error::ResourceWarning` (use `with` on `urlopen`, `srv.shutdown(); srv.server_close()` in `finally:`) and `python3 -W error::SyntaxWarning -m py_compile`.
- `tests/oracle.py` `xprep` requires `<|endoftext|>` delimiters so `ollm-held.bin` is non-empty for `xeval`.
- `ollm gcheck` takes 2 args (`ck`, `corpus`); `ollm kvcmp` requires `V > 256` and a `bpefit` merges file.
- Fast negative controls: `OLLM_ORACLE_MUTANT=tiemaxa python3 tests/oracle.py selftest-v1` (`rc=1`), and flipping 1 bit at byte offset 48 of an `OLLMSP01` `.sp` trips `ollm spapp` with `rc=61`.
- In POSIX `sh`, never check `$?` after `cmd | tail` (pipe masks exit code to `0`); redirect to a temp file, capture `$?`, then `tail`.

## 5. Pure-Omega RFC 8032 Ed25519 Release Signing
- Compose on Spark with `printf 'om2\n'` at top followed by `omega-mv` `sha512.om`, `ed25519.om` (do not strip `om2`), `ed_sign.om`, and `sign_ddc.om`.
- Keep the 32-byte hex seed strictly outside git (`~/.config/omega-helix/release-*.key`, `chmod 600`); commit only the 64-hex public key (`evidence/<tag>/release-pubkey.ed25519.hex`).
- Dual-verify every signed `SHA256SUMS.txt` with both pure-Omega `edverify` (strict mode 0) and Python `cryptography` `Ed25519PublicKey.verify()`.
