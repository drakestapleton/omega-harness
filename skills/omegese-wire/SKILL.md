---
name: omegese-wire
description: "Omegese Wire protocols and wake hygiene: Trinary Doctrine (tools/trit), signed 3-digit layered codebook (tools/codebook), R45 Omegese (aien-train/docs/omegese45), bot-wire wake hygiene, and PROPOSED open tracks (R45 inst 041-099 and Gen 3 error-resistant codebook). Use when implementing, verifying, or routing agent wake signals, codebook frames, or R45 wire messages."
---

# Omegese Wire

Protocols, verification boundaries, and wake hygiene for Omega agent signaling and compact wire frames. Keep every status claim on the `omega-communication` claim ladder (`PROPOSED` / `IMPLEMENTED` / `EXERCISED` / `VERIFIED` / `QUALIFIED` / `MERGED` / `DEPLOYED`): host checks and Lean proofs do not establish hardware qualification or live deployment.

## Protocol map (2026-11-19)

| Component | Source path | Claim-ladder status | Scope and limits |
|---|---|---|---|
| T-002 Trinary Wake (`trit`) | `omega-mv` `tools/trit/` | `MERGED`, host-`VERIFIED` | Gate `tests/gates/omega-trinary.gate`. Legacy read/ack is Lean-proved (`TritSignal.lean`) + differential-checked; daily `--inspect`/`--consume` are host-tested (`test-daily.py`, `mutate-daily.py`), not Lean-proved. Not deployed/hardware-qualified. |
| T-002 Layered Codebook v1 | `omega-mv` `tools/codebook/` | `MERGED`, host-`VERIFIED` | Gate `tests/gates/omega-trinary.gate`. 50 data rows in `codebook.tsv`; `CodebookProof.lean` (0 `sorry`, 0 extra axioms) + `test.sh` + `mutate.sh`. |
| T-002 Codebook r8/r9 candidate | Review candidate (unlanded) | `EXERCISED` (not `MERGED`) | 3-digit anchors `000`/`111`/`222` + 74-token vocabulary (197 tests, 45 mutants in review). Not on `omega-mv` main; do not conflate with landed v1 `codebook.tsv`. |
| R45 Omegese Wire | `aien-train` `docs/omegese45/` | `IMPLEMENTED`, `EXERCISED` | 41-row lexical vocabulary + deterministic `.om` translator (`en2goal`, `goal2en`, `rep2en`), exercised on Grace CPU (`evidence/OMEGESE45/{contract,translator}/`). |
| Bot-Wire Wake Hygiene | `omega-harness` `rules/rules.txt`, `WIRE.md` §9 | `IMPLEMENTED` (policy) | Active daily coordination rules (`rule trinary-daily-flow` + Reviewer-approved wake hygiene). |
| R45 `inst` Codebook (`041-099`, DRA-504) | Design proposal | `PROPOSED` (canceled for internal bots) | Canceled for internal bots on 2026-11-10 in favor of Trinary Doctrine; kept as reference if external-bot compact wire scope reopens. |
| Gen 3 Error-Resistant Codebook | Combinatorial design | `PROPOSED` | Verified Hamming-distance bounds on 3-digit vs 5-digit ternary triples/5-tuples; no implementation or proof landed. |

For latent Neuralese envelopes (`LTP0`/`NL4`), see `skills/omega-communication/SKILL.md`: Neuralese envelopes are separate from Omegese Wire.

## 1. T-002 Trinary Wake (`tools/trit`)

Canonical trit semantics follow Trinary Doctrine v1.0 ([Zenodo 24287768](https://zenodo.org/records/24287768)), `omega-mv` `tools/trit/README.md`, and `omega-harness` `rules/rules.txt` (`rule trinary-daily-flow`):

- **silence**: nothing to do / no task.
- **`1`**: task / read unread work.
- **`2`**: stop (requests an authorized stop and reading its reason).
- **`0`**: **help** (sender needs help while still working; never stop, idle, or acknowledgement).

**Critical receipt distinction:** legacy `trit DIR --ack BOT TOKEN` prints `<bot> 0` as a local read/done receipt. Never forward legacy `--ack` output as help (`0`).

### Daily vs legacy CLI

```sh
# Current daily flow (Trinary Doctrine)
trit DIR --inspect BOT...       # emits "<bot> 1 <token>" for unread work; silence when quiet
trit DIR --consume BOT TOKEN    # advances cursor durably; no stdout, no next wake

# Legacy receipt-era interface (historical callers only)
trit DIR BOT...                 # emits "<bot> <1|2> <token>"
trit DIR --ack BOT TOKEN        # prints local receipt "<bot> 0", then next wake if any
```

- `--inspect` emits only inspection requests (`1`), even for signed stop records. It never grants runtime stop authority.
- In legacy read mode, `2` is emitted **only** for a MAC-verified, counter-valid `3xx` codebook emergency. Everything else that is not `fyi` (including plain `STOP` text, a `stop` tag, unsigned, tampered, wrong-key, wrong-recipient, stale, replayed, or legacy `ocb1:` lines) is demoted to `1`. There is no `--trust-unsigned`.

### Full-line signed format and replay/retarget rejection

`trit` reads `DIR/inbox/<bot>.md` (normal lane `n`) and `DIR/inbox/<bot>.emergency.md` (emergency lane `e`). Content lines begin with `YYYY-MM-DDT`; `fyi` lines never wake.

- **Signed 6-field line:** `ts|from|to|tag|text|ref|ocb2:<cbsha>:<counter>:<digits>:<mac>`
- **MAC preimage:** `HMAC-SHA256(key, "ocb2|cbsha|counter|lane|ts|from|to|tag|text|ref|digits")`
- **Binding and key checks:** `lane` (`n` or `e`) comes from the file being read, never from the line; `to` must equal the receiving bot; key file `DIR/codebook/key` must have mode `& 077 == 0` and no `boards/` path segment; `DIR/codebook/codebook.tsv` must match `<cbsha>`.
- **Replay and ordering rejection:** per-sender counter file `DIR/inbox/<bot>.<sender>.ctr` stores `<counter> <ts>`. Verification requires strictly increasing `counter` (above both the stored counter and any earlier verified line from that sender in the same pass) and monotonic `ts >= last_ts`. Reading never mutates counters; `--ack`/`--consume` locks `DIR/inbox/<bot>.ctr.lock` (`flock LOCK_EX`), writes `.tmp`, `fsync`s, atomically renames (`renameat2`), and `fsync`s the directory.
- **Cursor integrity:** token format is `L<offset>:<sha256 of bytes 0..offset>` (`L` in `{n,e}`). Cursor file `DIR/inbox/<bot>[.emergency].md.cur` stores `<offset> <sha256>`. Any rewrite or truncation before `<offset>`, or a malformed/out-of-bounds token, is refused (exit 3) or resets the file to unread.
- **Emergency lane admission and quota:** sender must be `drake` or a slug with `DIR/inbox/<slug>.md` and a valid timestamp; at most 3 MAC-verified lines per sender per 60 minutes (counted once per `(sender, counter)`; unsigned, forged, or replayed lines consume no quota).
- **Authority limit:** the current shared HMAC key proves key possession, not individual sender identity, and counter ordering does not prove wall-clock freshness. Establish fresh sender identity and existing runtime authorization separately before stopping any process.

### Verification scope

- Build and host suite: `sh tools/trit/build.sh && sh tools/trit/test.sh` (gate: `tests/gates/run.sh trinary`).
- Lean 4 proof: `lean tools/trit/proof/TritSignal.lean` (0 `sorry`, 0 extra axioms) proves the legacy read/ack state machine and mirrors `trit.om` in `TritBin` for differential testing (`sh tools/trit/proof/difftest.sh`).
- Daily interface oracle: `python3 tools/trit/test-daily.py` and `python3 tools/trit/mutate-daily.py` independently sign fixtures and verify refusal of stop promotion, receipt leakage, next-wake leakage, and bypassed consumption. They are external test oracles (not runtime dependencies); the daily entry points are host-tested, not Lean-proved.

## 2. T-002 3-Digit Layered Codebook (`tools/codebook`)

### Landed v1 (`omega-mv` main)

Native OM-2 (`tools/codebook/codebook.om`, compiled directly into `tools/trit` by `tools/trit/build.sh` because OM-2 has no imports).

- **Wire format:** `(9xx)^k t` — `k >= 0` escape groups in `900..999` followed by one terminal group in `000..899`, every group exactly 3 decimal digits (1 tokenizer token each), concatenated with no separator. Fixed 3-digit width makes the encoding prefix-free and recursively extensible.
- **Transport:** rides only in the trailing `ocb2:<cbsha>:<counter>:<digits>:<mac>` field of a 6-field inbox line. Bot DMs stay a single bare trit. Legacy `ocb1:` lines never verify and are capped at trit `1`.
- **Codebook identity:** `tools/codebook/codebook.tsv` (`code<TAB>type<TAB>meaning`, types `r45 inst sig emerg`, `#` comments; 55 lines = 5 comment lines + 50 data rows). Its SHA-256 is the wire `<cbsha>` identity. Append-only evolution is checked by `codebook ext OLD NEW` (exits 0 with `ok <newsha>` if `NEW` is valid and starts with every byte of `OLD`, else `ERR notprefix` exit 6).
- **Landed v1 code ranges:**
  - `000`: `<pad>`
  - `001-040`: R45 lexical tokens (pinned to `aien-train/docs/omegese45/vocab.tsv` SHA-256)
  - `041-099`: reserved for R45 instruction ids
  - `1xx` signals: `100` `read-receipt`, `101` `task-waiting`
  - `3xx` emergencies: `300` `stop-now`, `301` `security`, `302` `data-loss`, `303` `disk-full`, `304` `build-broken`, `310` `power-OB`, `311` `power-LB`
  - `9xx`: recursive escape layers
- **Lean 4 proof:** `tools/codebook/proof/CodebookProof.lean` (0 `sorry`, 0 extra axioms) proves prefix-free encode/decode, `append_preserves`, `unverified_never_two`, `unsigned_demoted`, `stale_demoted`, and `badmac_demoted`.

```sh
sh tools/codebook/build.sh
printf '901.12 345\n' | build/codebook/codebook enc    # 901012345
printf '901012345\n'  | build/codebook/codebook dec    # 901.12 345
build/codebook/codebook sha tools/codebook/codebook.tsv
sh tools/codebook/test.sh && sh tools/codebook/mutate.sh
lean tools/codebook/proof/CodebookProof.lean
```

### Unlanded T-002 r8/r9 review candidate (`EXERCISED`, not `MERGED`)

A separate unlanded review candidate (r8/r9) evaluated 3-digit anchors `000` stop / `111` task / `222` help with a 74-token vocabulary (197 tests, 45 mutants reported in review). Two design invariants from that review remain important:

- A damaged stop frame demotes to task (`1`) so the receiver inspects the durable record rather than silently executing an unverified stop or dropping the event.
- Ambiguous bare tokens (such as bare `FAIL` without structured context) are rejected rather than guessed.

This candidate is **not** present in `omega-mv` main `tools/codebook/codebook.tsv`. Preserve landed v1 meanings and never silently deploy r8/r9.

## 3. R45 Omegese Wire (`aien-train/docs/omegese45/`)

R45 is a bounded, DFA-checked 41-row dialect for structured `mm`/`pair` job episodes (`CONTRACT.md`, `vocab.tsv`, `TRANSLATOR.md`). Status: `IMPLEMENTED` and `EXERCISED` on Grace CPU (receipts in `evidence/OMEGESE45/{contract,translator}/`).

- **Vocabulary and bounds:** fixed 41-row `vocab.tsv` (2188 bytes, 6 bits/id via `Ceiling[Log2[41]]`), DFA table `256 x 41 = 10496 B`, longest message `31` ids (`rep ok pair`), longest attained episode `175` ids, `MAXLEN = 176`.
- **Four frame types:**
  - `G` (goal): `goal mm|pair ... end`
  - `A` (action): `act job mm ... end | act refuse bound end`
  - `R` (result): `res ok|refused C'|fail C' end`
  - `P` (report): `rep ok mm|pair ... | rep refused C | rep fail C end`
- **Deterministic `.om` translator edges:** `en2goal`, `goal2en`, `rep2en`. Zero model calls on the translation path; MEASURED `<10 ms` wall time and `192 KB` RSS. Held-out accuracy: `38/45` raw (`84.44%`), `39/45` (`86.67%`, 0 wrong) with erratum. Exit codes: `20-23` (`en2goal`), `30-31` (`goal2en`/`rep2en`), `40-43` (contract).

### Choosing R45 vs Trinary Doctrine

- Use **Trinary Doctrine** (durable record + 1-digit wake) for daily agent coordination, task assignment, reviews, and multi-agent routing. Never strip task scope, authority, or evidence to shorten a signal.
- Use **R45 Omegese** when a bounded `mm`/`pair` pipeline needs deterministic, zero-model, DFA-checked structured frames (`goal`/`act`/`res`/`rep`) pinned to `vocab.tsv`.

## 4. Bot-Wire Wake Hygiene Rules

Active coordination rules from `rules/rules.txt` (`rule trinary-daily-flow`) and Reviewer-approved `WIRE.md` §9 / §1a:

1. **Durable record first, 1-digit wake second:** write task details once in the durable append-only record (sender, recipient, task/turn, bounded scope, authority, source/evidence refs). Send the wake trit only after the record exists. Reading is silent; no ack loops, polling turns, or agent heartbeats. Human communication remains plain, complete prose.
2. **Single shared rules digest (`RULES-DIGEST.md`):** post rule updates once as a no-wake note rather than fanning out inbox broadcasts to every bot (audit MEASURED `322/631 = 51%` of inbox traffic was rule announcements).
3. **Batch review wakes:** wake Reviewer once per finished revision. Re-reviews inspect deltas only. Minor wording edits wake nobody.
4. **Pace-gated non-urgent wakes:** hold non-urgent wakes when usage pace exceeds weekly allowance. Fail open: if the pace line is missing or more than 24 hours stale, wake normally.
5. **Inbox line discipline (`WIRE.md` §1a):** 5-field unsigned lines (`ts|from|tag|text|ref`) or 6-field signed lines (`ts|from|to|tag|text|ref|ocb2:...`), with tags `task|turn|fail|fyi|result`. `fyi` and `result` never wake.

## 5. Open Design Tracks (`PROPOSED` — not implemented or merged)

Per `omega-communication`, both tracks below are strictly `PROPOSED`. Do not cite them as landed code, deployed behavior, or measured production savings.

### R45 `inst` codebook (`041-099`, DRA-504) — `PROPOSED`

- **Status:** `PROPOSED` (comment posted 2026-11-09; live push of `inst-v0` canceled by Drake on 2026-11-10; superseded for internal bots by Trinary Doctrine). Retained as a design reference only if an external-bot compact wire scope is reopened.
- **Grammar:** `I := inst V (O|M|Arg)* end`, bounded at `<= 31` ids per message, using reserved slots `041-099` in `codebook.tsv`.
- **Recorded offline measurements (MEASURED, not live production savings):**
  - 17 real bot messages: `595 -> 233` `cl100k` tokens (~61% reduction; `13/17` fully expressible).
  - Offline N=10 benchmark: English `401` -> R45/`inst` `133` (-67%); hex baseline `6212` (15.5×).

### Gen 3 Error-Resistant Codebook — `PROPOSED`

- **Status:** `PROPOSED` (combinatorics verified; no `.om` implementation, `codebook.tsv` rows, or Lean proof landed; strictly separate from landed v1 `tools/codebook`).
- **Kraft capacity check:** 10 single-digit decimal codes saturate prefix capacity (`10 * (1/10) = 1`); reserving `9` as an escape prefix yields `9/10 + 100/1000 = 1`.
- **Verified Hamming-distance finding on `{0,1,2}^3` (27 ternary triples) around `{000, 111, 222}`:**
  - `21` of `27` triples lie at Hamming distance `<= 1` from an anchor (`6` at distance `1` from `000`).
  - Only **`6` of `27`** (`012, 021, 102, 120, 201, 210`) have distance `>= 2` from all three anchors (minimum pairwise distance `2`).
  - **`0` of `27`** have distance `>= 3` from all three anchors.
- **5-digit ternary design direction on `{0,1,2}^5` (243 ternary 5-tuples) around `{00000, 11111, 22222}`:**
  - **`90` of `243`** have Hamming distance `>= 3` from all three anchors (`210` at `>= 2`, `0` at `>= 4`), enabling single-trit error detection/correction without colliding with the stop anchor.

## 6. Pinned revisions and hashes (2026-11-19)

| Repo / branch | Commit | Path | SHA-256 (`shasum -a 256`) |
|---|---|---|---|
| `omega-mv` (`main`) | `e703c1b78d85034931904b657bece99e4bc2935e` | `tools/trit/README.md` | `a5eaccc9c699c11816e5aff60c7ad60f299123321e0ad4999ed89c5cf028baa1` |
| `omega-mv` (`main`) | `e703c1b78d85034931904b657bece99e4bc2935e` | `tools/trit/trit.om` | `a2c3a61ff1b5b8107e39236cb28c3fb2d13018bf88a006e1cbcb05a38a951969` |
| `omega-mv` (`main`) | `e703c1b78d85034931904b657bece99e4bc2935e` | `tools/trit/proof/TritSignal.lean` | `ec72ca856608e1469f223ad58cd4e40fb29adee8a9ebd158de12cf34c47b8c9a` |
| `omega-mv` (`main`) | `e703c1b78d85034931904b657bece99e4bc2935e` | `tools/trit/test.sh` | `e669a94308113e04e8109430af5a223d64da312b1b048f6cbf1fd8817e591127` |
| `omega-mv` (`main`) | `e703c1b78d85034931904b657bece99e4bc2935e` | `tools/codebook/README.md` | `d4f66b967712264b261ffa2381a650cf0a6b342707e48dc8f0a08ab91a559315` |
| `omega-mv` (`main`) | `e703c1b78d85034931904b657bece99e4bc2935e` | `tools/codebook/codebook.tsv` | `d2942e9f3c014781f38bc33054e117fef70c52941ad11beeb6f68c89cdac21fb` |
| `omega-mv` (`main`) | `e703c1b78d85034931904b657bece99e4bc2935e` | `tools/codebook/codebook.om` | `cde2b935b0b7389a49ba788b07d93daa58b77082009e1ad7775a2c4fc7959574` |
| `omega-mv` (`main`) | `e703c1b78d85034931904b657bece99e4bc2935e` | `tools/codebook/proof/CodebookProof.lean` | `cabe08efa0867f05f620cd4d3517941e34ce5ee5b524cc58dfca5ce2a59a6ea1` |
| `omega-mv` (`main`) | `e703c1b78d85034931904b657bece99e4bc2935e` | `tools/codebook/test.sh` | `5e47cf4d52568c7370faee49c74bfddb5fcddc52d7baa13c08e3b7d187061ec2` |
| `aien-train` (`feat/darwin-ollm-specialists`) | `e993f179651b8dd5e99a040b6ec7284fff8cb12e` | `docs/omegese45/CONTRACT.md` | `df47d5d2e0630f03289142a9a1b178e2ccd5c10a3928f38f0dbac381461b9a06` |
| `aien-train` (`feat/darwin-ollm-specialists`) | `e993f179651b8dd5e99a040b6ec7284fff8cb12e` | `docs/omegese45/vocab.tsv` | `c1d7e15466e6585a776314c5c05f35466b2697d9631ad2e11c7918a434a4c18d` |
| `aien-train` (`feat/darwin-ollm-specialists`) | `e993f179651b8dd5e99a040b6ec7284fff8cb12e` | `docs/omegese45/TRANSLATOR.md` | `8417919d76901d4a111bbd9031343430caca3fa3ff5fd27c1337944f233729dc` |
