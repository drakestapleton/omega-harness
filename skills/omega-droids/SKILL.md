---
name: omega-droids
description: >-
  Build, configure, train, and operate 100% pure seeded-Omega (OM-2) autonomous droids
  across omega-resir (resir_bot.om, resir_bot_linux.om) and omega-fleet (fleetd, droid_ops.om,
  fleet-mac.om). Use when designing droid cascades, replacing TinyStories with Omegese/omg
  non-English models, running OLLMSP02 spcryst DNA crystallization, wiring spark-mail safe
  drafts, or debugging execpure/omc cross-target traps.
---

# Pure-Omega Autonomous Droids Runbook

## 1. Non-Negotiable Principles
1. **Call them `droids`, never `bots`** across APIs, UI, HUDs, CLI, prompts, and docs.
2. **Zero TinyStories:** Never route droids to Spark `:18097` (`hop-omega-chat`, `ollm-ck02-v4096`) or TinyStories `.ck` checkpoints (`omega-v2.ck`).
3. **Non-English droid internals:** Droid-to-droid messages and Tier-1 local reasoning stay in Omegese (`T-002` Trinary + signed `ocb2:` 3-digit codebook, `R45` wire), native `.om` `omg` AST token streams (`ollm omg pack/decode/samp`), and binary capsules (`ORESSD01`, `OMCAPS01`, `OMTN01`, `OMBTJ01`). Translate to English only at the outer human boundary (`q36-35b` via `omega-router` `:18090`, or human UI).
4. **`OMCG01` Write Policy:**
   - **Docs/checksums/hygiene:** Auto-heal with reversible `OMBTJ01` undo journal; land Interplane-first.
   - **`.om` code edits:** Stage strictly as PRs (`droid/*` branch), never auto-push to `main`.
   - **`spark-mail` (`:18092`):** Read `~/.local/share/sovereign/mail/inbox/*.json` via `fopen`/`getdnts` and write `drafts/droid-draft-*.json` with `"requires_human_send": true` only. Never write `sent/` or hit SMTP `:2525`.
   - **Hard forbidden targets:** `omega-mv` write (from downstream repos), `nntc`, `/boot/efi`, `efivars`, `.git/` raw objects, and `.c/.h/.py/.js/.ts/.html/.css` inside pure-OM-2 repos (`omega-resir`).

## 2. Tiered Local Model Cascade (Zero Unwanted GPU Wakes)
| Tier | Purpose | Allowed Models / Endpoints | Prohibited |
|---|---|---|---|
| **Tier 0** | Deterministic audits, `getdnts` scans, SHA-256 verification, `OMEM01` memo hits, `T-002` wake frames | `resir_bot`, `resir_bot_linux`, `fleetd` `dp_run_patrol_cycle` (0 LLM tokens, `< 5 ms`) | Any LLM call |
| **Tier 1** | Non-English Omegese / `.om` code reasoning & fast local specialization | Spark CPU `:18098` `omega-llm-15.8m-om2.ck` (`champ_r17_p21_h2315347.ck`), `omega-code-v3.ck`, `P1_om2_rlvr_15m.sp`, `ollm omg` native AST token models + `< 30 KB` `OLLMSP02` W4 `spcryst` crystals (`~/.local/share/omega-droids/strands/`) | **NEVER `:18097` TinyStories** |
| **Tier 2** | Human-facing English prose (external email drafts, PR writeups) only when GB10 GPU is free/warm | Spark `omega-router` (`:18090`) -> `q36-serve` (`:18091`, `qwen3.6-35b-a3b-w4-mtp`, 20-min idle auto-unload) | Unprompted cold GPU wakes during silent background cron |

## 3. DNA Crystallization (`OLLMSP02` `spcryst` & `omg`)
- Never commit `.ck`, `.sp`, or `.sp2` binary checkpoints into git; store strands under `~/.local/share/omega-droids/strands/` and commit only text receipts + SHA-256 hashes.
- For pure Omega code models (`omg`), encode `.om` files directly via `ollm omg pack <in.om> <out.tok>` (zero English BPE needed).
- For `V > 256` BPE checkpoints, always encode text first with `ollm bpeenc <merges.bin> <V> <in.txt> <out.tok>` (raw odd-byte UTF-8 fails `odopen` with `rc=21`).
- Prefer `OLLMSP02` Spiral-2048 W4 `spcryst` over `spforge` on 8L+ checkpoints (`spforge` exits `16` on large `V=4096` caches; `spcryst` produces ~18 KB W4 crystals with cryptographic 1-bit tamper refusal `rc=61`):
  ```sh
  ollm spcryst <base.ck> <domain.tok> <out.sp2> 64 1000 1024 1 4
  ollm spweval <base.ck> <domain.tok> 1 8 <out.sp2>
  ```

## 4. Verified `omc` & Sandbox Traps
- **`execpure` stdin hang:** Always redirect child `fd 0` (closed stdin pipe or `/dev/null`) before calling `execpure`/`execprog`; otherwise a child reading stdin blocks indefinitely on inherited SSH stdin.
- **No globals as array arguments (`error 19`):** Copy `global` buffers into an outermost-block `new uchar N 0` local array before passing to `view uchar *` / `edit uchar *` helpers.
- **Register pool (`error 12`):** `omc` keeps loop counters and locals alive across a function (16-reg cap). Keep functions small (1 loop, <= 6 locals) and split nested loops or multi-`get` comparisons into tiny leaf helpers.
- **Reserved words (`error 16`):** Never name locals `out`, `part`, `sub`, `le`, `open`, `len`, `ops`, `fresh`, `seal`.
- **`get` threshold arity (`error 4`):** `gt get x 0 0` requires both index `0` and threshold `0`.
- **Mac `68a590c3` vs Spark `85b84c6d` `target x86linux`:** Mac's Nov 18 pinned `omc` (`68a590c3`) rejects `execpure` and dynamic `global ... *` (`enlarge`) under `target x86linux` (`error 25`); Spark's `85b84c6d` compiles both.
- **Portable Linux `getdnts`:** Open directories with `fopen path 0 len 0 0` (`O_RDONLY = 0`, identical across AArch64 and x86-64 Linux; `O_DIRECTORY` differs between AArch64 `16384` and x86-64 `65536`).

## 5. Services & Verification
- **Spark `systemd --user`:** `omega-router.service` (`:18090`), `omega-fleet.service` (`:18500`), `spark-mail.service` (`:18092`). Confirm `nvidia-smi` stays idle (`0%`) unless Tier 2 was explicitly requested.
- **Mac `launchd`:** `~/Library/LaunchAgents/dev.aien.omega-droid-patrol.plist` -> `~/.local/bin/omega-droid-patrol`.
- **Gates:**
  - `omega-resir`: `sh verify_spark.sh` (`SPARK_RESIR_GATE PASS`), `./bin/resir_bot selftest`, `shasum -a 256 -c receipts/SHA256SUMS.txt`.
  - `omega-fleet`: `make spark-test && make bridges-test && make spark-bench && make mac-test`.
