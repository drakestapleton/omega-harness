---
name: omega-c-to-om-migration
description: >-
  Runbook for migrating legacy C modules, tools, and tests in omega-mv to pure
  seeded OM-2 from a MacBook using Spark's AArch64 omc. Use when porting C
  subsystems to .om, fixing omc errors during migration, cutting over mk/*.mk
  targets, or retiring superseded C/H files.
---

# Omega C → OM-2 Wave Migration Runbook

## 1. Remote Compile & Test Loop (MacBook → Spark)

Pipe concatenated `.om` sources directly to Spark's `seed/out/omc` using a
unique temp directory per wave (`/tmp/om_<wave>`) so parallel lanes never collide:

```sh
(printf 'om2\n'; sed -e '/^om2$/d' -e 's/^export fn /fn /' lib1.om lib2.om test.om) \
  | ssh spark 'mkdir -p /tmp/om_wXX && ~/canon/omega-mv/seed/out/omc > /tmp/om_wXX/bin && chmod +x /tmp/om_wXX/bin && /tmp/om_wXX/bin'
```

- Always strip duplicate `om2` headers (only one `om2` line may appear at the top).
- Always verify parity against the original C binary or fixtures on Spark before deleting C.

## 2. Top `omc` Porting Errors & Direct Fixes

| `omc` Error | Cause | Fix |
|---|---|---|
| **error 12** | 16-register pool exhausted (each local `new` array uses 2 regs; chained `and`/`or` or >5 arrays in one `fn`) | Split large functions into small helpers, reuse scratch `new` arrays sequentially, and unnest chained `and`/`or` checks into separate statements. |
| **error 19** | Passing a `global` array to a `view`/`edit` parameter, or passing two `part`/`view`/`edit` slices of the same array in one call | Use local `new` arrays for `view`/`edit` arguments (or read globals directly inside callees); copy a slice into a separate buffer instead of aliasing one array twice. |
| **error 16** | Reserved keyword used as identifier (`out`, `at`, `in`, `len`, `part`, `view`, `edit`) or duplicate `om2` line | Rename locals/params (e.g., `dst`, `pos`) and keep a single `om2` at line 1. |
| **error 11** | Untyped literal `>= 2^63` (e.g. `0xffffffffffffffff`) | Prefix with `ulong` (e.g., `ulong 0xffffffffffffffff`). |
| **error 7** | Type mismatch (`argread` index is `ulong`, not `int`; `unlink`/`write`/`fclose` return `long`, not `int`; `eq`/`ne` return `bool`, not `int`) | Match exact types; use separate discard vars (`ign` for `int`, `ign_l` for `long`). |

## 3. Safe Cutover & C Retirement Checklist

1. **Update `mk/*.mk`** to compile and run the pure OM-2 binary via `*_OMC ?= seed/out/omc`.
2. **Grep before deleting**: `grep -rn '<filename>' Makefile mk/ src/ tests/ tools/`. Delete only `.c`/`.h` files with zero remaining active C callers; keep shared C libraries still linked by unported targets.
3. **Never touch** `evidence/`, `.aien/`, `tests/gates/`, `.github/workflows/`, `.forgejo/`, or `tools/aien-test/`.
4. **Credit the wave** in `CONTRIBUTORS.md` in the same commit.
5. **Parallel waves & recovery**: Before rewriting an interrupted wave, check `git worktree list` for existing `.om` drafts. When cherry-picking wave commits onto `main`, resolve `CONTRIBUTORS.md` append conflicts by keeping all wave entries.

## 4. `mk/*.mk` & Full-`Makefile` Verification Rules

- **Define your own variables inside `mk/*.mk`:** `-include mk/*.mk` runs *before* root `Makefile` sets variables; never reference root `Makefile` variables as prerequisites in `mk/*.mk`.
- **Always verify under the full `Makefile` from a clean `git archive HEAD` on Spark:**
  ```sh
  git archive HEAD | ssh spark 'rm -rf /tmp/om_v && mkdir -p /tmp/om_v && tar -xf - -C /tmp/om_v && cd /tmp/om_v && make PHYSICS_DIR=/nonexistent PHYSICS_LOCK_CHECK=0 <target>'
  ```
  Running only `make -f mk/<file>.mk` misses cross-`mk/*.mk` target-name collisions (warning: `overriding recipe for target`).
- **Static-only / data-only C files & `parity_check.sh`:** `tools/migration/cfuncs.awk` extracts 0 external functions from files containing only `static` helpers and `const` tables, causing `parity_check.sh` to error if a same-stem `.om` exists in `src/`. Put their OM-2 implementations under a non-same-stem path (e.g., `om/<family>/...`) and keep same-stem `.om` twins for C files with external functions.
- **Pinned / non-deletable C files:** Before `git rm`, check that the C file is not SHA-256-pinned by committed receipts (`protocol.json`, `candidate_manifest.json`, `tests/one_layer/generalization/records/receipts/*`), an intentional cross-language baseline (`bench/{inference_cost,omc_efficiency}/`, `research/{atemporal,m15,om-bench}/`), or a macOS-host build tool (`tools/quietlock/`). Cut over the Make target and keep pinned C files on disk as `live`.

## 5. Parallel Swarm Landing Hygiene

- **Keep wave diffs disjoint:** Never let parallel waves edit root `Makefile`, `CONTRIBUTORS.md`, or `docs/migration/C-TO-OM-INVENTORY.md` (batch docs updates on `main`).
- **Resolve `docs/migration/PARITY.tsv` conflicts deterministically:** Strip conflict markers, deduplicate `c\t<path>` rows (preferring `retired` over `live`), run `GIT_EDITOR=true git cherry-pick --continue` (not bare `--continue`, which fails when `GIT_EDITOR=false`), then verify `PARITY_BASE=<prev-head> sh tools/migration/parity_check.sh`.
- **Serialize `.git` mutations:** Never call `git worktree add` (e.g., `swarm add` with `workspace:"share"`) while a background `git rebase` or `cherry-pick` is running on the root repo — wait for the push/rebase task to finish first to avoid `.git/index.lock` collisions.

## 6. Live GB10 GPU Migration Waves (Authorized Window Only)

- **Dual-mode Make targets:** Split every GPU wave into `*-host` (CPU-only structural/QMD/contract/negative-control test, zero `/dev/nvidia*`, safe for `verifier` and CI) and `*-silicon` (live GB10 value/parity test, static ELF `ldd: not a dynamic executable`).
- **Compile before claiming the GPU:** Complete all coding and `seed/out/omc` builds *before* calling `spark-window open` (never hold `/tmp/aien-gb10.lock` idle — `chip-watchdog` kills idle holders after 45 s).
- **One GPU worker at a time:** Only one wave may open `/dev/nvidia*` at a time, wrapped in an `EXIT` trap (`WID=$(spark-window open <name> --lease 15 --gb10 exclusive --quiet none | tail -n 1); trap 'spark-window close "$WID" >/dev/null 2>&1 || true' EXIT`) with `CLAIM`/`RELEASE` lines in `~/handoffs/BOARD.md` and `spark-window run spark-receipt <name> -- ...`.
