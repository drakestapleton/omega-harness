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
