---
name: omega-si2-stack
description: >-
  Build, verify, and extend the pure seeded-OM-2 Sovereign Intelligence 2.0 stack
  in omega-mv: ΩIR v2 purity/contracts and @ng sem-id (seed/ng/), OMEGA-MEMO
  (seed/ng/memo/), Reversible & Counterfactual Replay (seed/ng/replay/ + ngrun),
  Physics-Typed Computing (seed/ng/physics/ + PhysicsDispatch.lean),
  omega-metabd (apps/omega-metabd/), and omega-mesh (apps/omega-mesh/). Use when
  modifying, verifying, or integrating any SI 2.0 subsystem or updating its receipts.
---

# Sovereign Intelligence 2.0 Pure-OM-2 Stack Runbook

## 1. Critical Spark Pinned-`omc` Extraction Rule

Never assume `~/canon/omega-mv/seed/out/omc` on Spark matches `omega-mv` `main` (it can drift on stale worktrees, e.g. `28fca13d...` vs pinned `85b84c6de85083e4d9d2368015c1ddcab3d863aada922be0e63d774dddf23134`). Before compiling any `seed/ng/` or `apps/omega-*` SI 2.0 binary on Spark, extract the pinned compiler directly from the canonical git store and verify its SHA-256:

```sh
git -C ~/git/omega-mv.git show main:seed/out/omc > /tmp/omc-pin
chmod +x /tmp/omc-pin
sha256sum /tmp/omc-pin
```

Keep frozen OM-2 `seed/omc/omc.om` untouched unless explicitly re-pinning the 4-strand BFT DDC ladder.

## 2. Subsystem Map, Compose Commands & Invariants

| Stage | Subsystem | Key Files | Invariants & Safety Rules |
|---|---|---|---|
| **0** | `ΩIR v2` Spine | `seed/ng/{IR.md,ngcheck.om,gate_ir_v2.om}`, `seed/ng/src/{ir,front,main}.om`, `seed/ng/infix/infix_front.om`, `seed/ng/pack/sem_pack.om` | `omega.ng.ir.v1` (ver 9) stays 100% backward-compatible; `v2` (ver 10) carries 28-byte contracts; `ck_pure` structurally proves purity (never trust hints); infix == prefix `SEMANTIC_ID`. Rebuild tools via `ngbuild build "$OMC" seed/ng/{ng,ngcheck,ngrun,ngrand}.units`. |
| **1** | `OMEGA-MEMO` (Pillar 2) | `seed/ng/memo/{memo_policy,memo_store,gate_memo}.om` | Only structurally verified `@pure` functions admitted; one-way dominance (`@exact → @tol` and tighter→looser `@tol` OK; reverse strictly refused); dual SHA-256 check on every read; disk-backed CAS with loud disk-floor alarms and **no arbitrary hard entry cap**. |
| **2** | Reversible & Counterfactual Replay (Pillar 4) | `seed/ng/replay/{tok_journal,slab_ckpt,cf_fork,state_stream,gate_replay}.om`, `seed/ng/ngrun.om` | Hash-chained `OTKJ` v1 `tok` journal + periodic `SLAB` checkpoints + `OSTM` v1 delta codec in growable pools; `ngrun --journal/--rewind/--ckpt-every` must leave default `gate-ir` (302/302) unchanged. |
| **3** | Physics-Typed Computing (Pillar 3) | `seed/ng/physics/{pareto_bank,phys_solver,gate_physics}.om`, `seed/helix/proofs/PhysicsDispatch.lean` | Strict Lean-proved hierarchy: `WattCBF > @err > @deadline` (`@hard_deadline` fails closed; soft emits `ALARM_DEADLINE_SLIP`); `proof_mask == 7` required; strictly `DRY_RUN_READONLY` (`hw_writes=0`); verify `~/.elan/bin/lean seed/helix/proofs/PhysicsDispatch.lean` (`0 sorry`, standard axioms only). |
| **4** | `omega-metabd` (Pillar 1) | `apps/omega-metabd/{profile_ring,general_pe,metabd_main,gate_metabd}.om` | Strict `W^X` (`0600 RW → SHA-256 → fchmod 0500 RX`, single `PT_LOAD R E`, zero `W`; refuse `--rwx` exit 2); 3-bit proof gate (`Contract\|EGP3\|Monk+Immune == 7`); `TID_A725` schedule; cooperative `fabHotSwap` + `SLAB_MUTABLE_ALARMED` OOD rollback. |
| **5** | `omega-mesh` (Pillar 5) | `apps/omega-mesh/{mesh_verify,mesh_route,mesh_daemon,gate_mesh}.om` | Refuse wildcard `0.0.0.0` bind (`rc=12`); Tier A RFC 8032 Ed25519 signed receipts + spot-check quarantine; Tier B Freivalds (`os_rng=1`) + Merkle `O(log2 M)` bisection + dual-peer BFT quorum; TOCTOU-proof `mv_admit_to_memo` gating `OMEGA-MEMO`. |

## 3. Evidence & Status Discipline

- Every SI 2.0 stage change requires passing its standalone pure-OM-2 gate **plus** at least one killed runtime mutation control, recorded as a new immutable directory under `evidence/SI2-<STAGE>-<YYYYMMDD>/{RECEIPT.txt,SHA256SUMS.txt}` (never modify existing files under `evidence/`).
- Report Spark CPU runs strictly as `HOST-VERIFIED` (`hw_writes=0`), never `GB10 QUALIFIED`. Only flip `NOT RUN` / `NOT BUILT YET` badges on `aienos.com/si-2/` and `interplane.io/si-2/` after the corresponding hardware or integration receipt lands on Interplane `main`.
