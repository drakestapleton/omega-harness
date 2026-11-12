# Omega Harness

Agent skills for working in Omega, the `.om` language of AienOS, and in the AIEN repositories. An agent that loads these skills finds the actual source before acting, writes `.om` code that the seeded compiler accepts, runs what it builds, and reports its status without overstating it.

Skills can't make agents flawless. What these do is turn the mistakes agents keep repeating into checks they must run before they claim anything: stale syntax, guessed compiler limits, compiling without running, labeling host-only runs as qualified, and choosing the wrong repository.

<!-- gen:skills -->
7 skills, each `skills/<name>/SKILL.md`; the use column is the skill's own frontmatter `description`:

| Skill | Use |
|---|---|
| `skills/aien-repositories/SKILL.md` | What AIEN builds and which repository owns a task: mission, doctrine, plan authority, task routing, evidence and status discipline, known source drift. Use before choosing an AIEN repository or making a cross-repository or status claim. |
| `skills/lean-verify/SKILL.md` | Machine-checked proofs with Lean 4 + Mathlib through the `lean` MCP server on the Spark. Use to prove a safety invariant (core disjointness, disk floor, lease exclusion, queue bounds, protocol/state-machine properties) about an explicit model, and to check that a proof has no sorry and no extra axioms. |
| `skills/omega-communication/SKILL.md` | Communicate Omega and AIEN work precisely: status and evidence labels, reports, PR text, agent handoffs, receipts, semantic needs, wire formats and corrections. Use when reporting, briefing agents, reviewing or publishing claims. |
| `skills/omega-encoding/SKILL.md` | Write .om that the seeded Omega compiler actually accepts: syntax, types, traps, bounds, register limits, host I/O, byte encoding, compiler errors, verified examples. Use before writing, reviewing or explaining any Omega program. |
| `skills/omega-harness/SKILL.md` | Operate in Omega and the AIEN repositories. Use for any Omega or .om task, compiler or migration work, AIEN architecture, repository routing, or project status claim. Covers source pins, .om-first implementation, compile and run evidence, safe effects, communication and stopping repeated errors. |
| `skills/wolfram-math/SKILL.md` | Mandatory mathematics through Wolfram. Use for any computation, derivation, identity, unit conversion, numeric constant, formula check or quantitative claim, and to set up or repair the Wolfram tools so an agent never computes by hand. |
| `skills/writing-omega/SKILL.md` | Portable guide to writing Omega (.om) programs that the seeded omc compiler accepts and runs correctly: program shape, types, words, traps, compiler errors 1..30, common mistakes with the exact refusal, and tested examples. Use before writing or reviewing any .om program on any machine. |
<!-- /gen:skills -->

The skills use the Agent Skills layout (`skills/<name>/SKILL.md` with `name` and `description` frontmatter), so any agent that reads that layout picks them up.

## Human-Directed Agentic Engineering

Development follows Human-Directed Agentic Engineering (HDAE): humans define goals, architecture, constraints, acceptance criteria and stopping points; agents implement, execute checks, diagnose failures and revise within those boundaries. Human review retains responsibility for claims, acceptance and release decisions. These skills make the agent's inner loop explicit without transferring the human's authority to a model.

For the documented method and systems-software case study, see Gregory M. Kurtzer, *Ginux: Building an Independent Kernel That Runs Linux Userspace through Human-Directed Agentic Engineering* (2026), [doi:10.5281/zenodo.23682548](https://doi.org/10.5281/zenodo.23682548). Project authorship, compiler pins and historical evidence remain unchanged.

## Install

One command installs the skills from Radicle `main` and records the head it installed in
`DIR/.installed-from-omega-harness`; the same command with `--check` exits 1 when `main` has moved past
that head or an installed skill was edited:

```sh
rad clone rad:z39gvwWsnkRZsAConQLjaKiNVLHfW omega-harness
# or, without Radicle installed:
git clone https://www.aienos.com/rad/z39gvwWsnkRZsAConQLjaKiNVLHfW.git omega-harness
omega-harness/tools/install.sh --skills ~/.agents/skills            # pick the directory for your agent
omega-harness/tools/install.sh --skills ~/.agents/skills --check    # is the installed head current?
```

`install.sh` takes `main` from Radicle itself (the local Radicle storage when it exists, else the HTTPS
mirror), so the clone only provides the script. It replaces only this repository's skills in that
directory. On a Linux AArch64 machine with an overlay (`~/.config/omega-harness/local.rules`, never
published), `tools/install.sh --omc OMC` also renders and installs the agents' instruction files that the
overlay names (`omp` `RULES.md`, Claude Code `CLAUDE.md`, Codex and home `AGENTS.md`) from
`rules/rules.txt`; after a landing on main, the landing tools' `land-hooks.sh` `harness` hook re-runs it
from the landed head.

**Interplane is the only forge (Drake, 2026-11-11).** This repository is shown at
https://interplane.io/drakestapleton/omega-harness, and its Radicle `main` is the canonical source.
Never push to a GitHub remote, open or update a GitHub PR or issue, publish with `gh`, or cite a GitHub
branch as current state. The `aien-dev` GitHub organization has been frozen since 2026-11-07; its
`github.com/aien-dev/...` links below are historical citations of the commits they name, not live
destinations. Only Drake reverses this rule.

| Agent | Skill directory |
|---|---|
| oh-my-pi (`omp`) | `~/.omp/agent/skills/` or a project's `.omp/skills/` |
| Claude Code | `~/.claude/skills/` or a project's `.claude/skills/` |
| Codex and other Agent Skills readers | `~/.agents/skills/` or a project's `.agents/skills/` |

Install into the directory your agent reads with the command above.

`omp` can also read them in place. Add the clone's `skills` directory to `skills.customDirectories` in `~/.omp/agent/config.yml`. Once installed, agents load a skill automatically when the task matches its description. In `omp` you can also invoke one directly with `/skill:omega-harness`.

## Conversion

The November 6 local Mac model experiment has explicit
[runtime receipts and an open host-language migration boundary](skills/omega-harness/SKILL.md#2-implement-in-the-actual-language).
Omega inference inside an Aienux firmware guest does not make the temporary
C++ browser adapter Omega, and firmware-hosted emulation does not establish
standalone-kernel or native Apple Silicon support. These are unmerged experiment
branches; they do not change the compiler pin or supported language.

These skills cover working in Omega itself. Conversion between Omega and other languages belongs to [`omega-bridge`](https://interplane.io/drakestapleton/omega-bridge). It converts a declared, checked subset and refuses to attempt universal conversion. You can run an MCP server in front of it if you want automated conversion, but that wrapper doesn't let it convert anything beyond that subset.

Merged [omega-bridge #32](https://github.com/aien-dev/omega-bridge/pull/32) localizes private
ABI1/ABI2 runtime symbols so independent generated translation units link without collisions.
[#33](https://github.com/aien-dev/omega-bridge/pull/33) adds conservative integer-scalar
freestanding output without pthread, mmap, heap or TLS; [#35](https://github.com/aien-dev/omega-bridge/pull/35)
extends finite aggregate frame/output pools with checked refusal. Section 2 pins main
`2efdd48cd0c7c232064d5870e77660a5a75966e1` and records host evidence and negative controls.
Merged host-exercised source is not deployment or GPU qualification.

Merged [omega-bridge #36](https://github.com/aien-dev/omega-bridge/pull/36) (merge
`2ed42c3818e72da321c3218d22d7662be607633c`, 2026-11-01) adds an explicitly pinned
`bridge-seeded` frontend for portable checked C/Python and C declarations.
Section 2 records head `3dc4a00e9966770cce58bdedb401c3b3932c35ee`, compiler and converter
hashes, canonical composition and binary32 limits, the import-free scalar profile,
and exercised differential/refusal controls. Consumer host acceptance is separately
recorded. This does not replace baseline gates or depend on a native x86 Omega compiler.

The merged [omega-mv WebAssembly backend (#787)](https://github.com/aien-dev/omega-mv/pull/787)
is a compiler backend for the existing scalar OSC IR v1 wire format, not a foreign-source
converter. Its seeded Omega writer and read-only Node oracle boundary are documented in
`omega-encoding` section 0 and `omega-harness` sections 2-3. Backend merge:
`3364a1dfd0ca50c1b82bf19ba34932d8bc10a7a9`; boolean IR prerequisite #786:
`87489da90a1a7a750fd4a7f9eeb005b1221721f6`.

The [SPIR-V backend (#804)](https://github.com/aien-dev/omega-mv/pull/804)
merged as `3a10bd29fb7debdcf2c8f5cb58680cc74cb5b1f3`: an Omega-written OpenCL Kernel
emitter, a PoCL CPU parity gate and a minimal OpenCL IL demo. `omega-harness`
section 3 records the exact exercised source, toolchain, ABI, refusal boundary
and evidence. CPU execution is not GPU or DPC++ qualification.

The Neuralese supplement ([#919](https://github.com/aien-dev/omega-mv/pull/919), merged by
train r1 #971 as `f56a372a`) keeps Omega's name and proposes model/decoder-bound
representations that decode into explicit Omega operations on the ordinary checked
path. `omega-harness` section 2 and `omega-communication` record its pin, native host
codebook evidence and trust boundary. The learned experiment is PROPOSED / NOT_RUN; the
bounded reference is MERGED and IMPLEMENTED / EXERCISED on the host, not hardware
QUALIFIED or deployed.

## Host-only NL1R diagnostics

`omega-harness` documents the separate capacity and task-conditioned experiments
under [aien-train #39](https://github.com/aien-dev/aien-train/issues/39), with exact
frozen source/compiler pins, independent judge custody, actual carrier/context
budgets and retained negative results. Constructive capacity, learned recovery,
heldout performance and production execution authority are separate claims.
These host experiments do not qualify device execution or deployment.

## Check the examples yourself

The examples run on Linux AArch64 hosts only. [`examples/`](examples/) holds each `NAME.om` with
`NAME.expect` (and `NAME.stdout` when it prints): every trap, one refusal per error code, the common
mistakes, the known defects, and `execenv`. `examples/gate.sh` refuses any compiler but the one pinned
in [`PIN`](PIN), then compiles and runs every program here and in `skills/*/examples/`:

<!-- gen:examples -->
`examples/gate.sh` reruns 126 programs: 121 in `examples/` and 5 in `skills/*/examples/`.
<!-- /gen:examples -->

<!-- gen:pin -->
| Pin (`PIN`) | Value |
|---|---|
| omega-mv commit | `5a260fc6907ba82565dd173b6369cd2bc158c6af` |
| `seed/out/omc` sha256 | `17657be4842e08d2ccb3b5c6f65b5f7209e584ad73274518cbdf0263d1fcb182` |
| reference data | `data/reference.tsv`: omega-mcp's `data/reference.json` for this pin, with 198 keyword-table entries (80 host words), 29 compiler error codes, 14 traps and 13 topics |
<!-- /gen:pin -->

```sh
git clone rad://z6do9WDBhuSnvopDkgFdFr1yWA62 omega-src
git -C omega-src checkout "$(sed -n 's/^omega-mv //p' PIN)"
sha256sum omega-src/seed/out/omc   # must equal the omc-sha256 line of PIN
examples/gate.sh omega-src/seed/out/omc
tools/check.sh omega-src/seed/out/omc   # the generated guide blocks and the rules source
```

It prints `PASS name` or `FAIL name: reason` per program and ends with a line like this one
(exit 0), `GATE FAIL ...` (exit 1), or a hash refusal (exit 2):

<!-- gen:gateline -->
```text
GATE PASS examples=126 pass=126 fail=0 omc=17657be4842e08d2ccb3b5c6f65b5f7209e584ad73274518cbdf0263d1fcb182
```
<!-- /gen:gateline -->

The `omega-encoding` skill (section 0 and section 13) records how the pinned compiler was established,
the earlier pins and their negative controls; [`examples/WOLFRAM.md`](examples/WOLFRAM.md) records the
Wolfram checks of the arithmetic expectations.

## Keeping it current

**Nothing here is maintained by hand that can be generated.** The compiler pin is written once, in
`PIN`; the pin tables, the word, error and trap tables, the example counts and the skill lists are
generated from it, from omega-mcp's reference data for that pin and from this repository, by
`tools/guides.om`, and `tools/check.sh` fails the landing when one of them is stale or typed by hand.
Repinning is editing `PIN` and running `tools/regen.sh`. The agents' standing rules are one source,
`rules/rules.txt`, rendered into each agent program's instruction file by `tools/rules.om`. What people
and agents still write is prose: explanations, method, rules and dated observations with their
evidence. When your change makes that prose untrue, rewrite it in the same piece of work and land it on
Radicle `main` with a receipt (`examples/gate.sh` and `tools/check.sh` on a fresh clone of the exact
head, the landing receipt, then the new head on https://interplane.io/drakestapleton/omega-harness).
Never push to github.com. If you can't make the change, open a Radicle issue (`rad issue open`) saying
what is now stale. `omega-harness` section 6 has the full map. Contributions follow the
[shared AIEN agent rules](https://www.aienos.com/agents/RULES.md).

The [native GPU realization guidance](skills/omega-communication/SKILL.md#native-gpu-realization-records-2026-10-28) distinguishes quantization indexes, canonical artifact identity, session residency and independent qualification. It tracks the CUDApp #26 work without treating host fixtures or unmerged components as production admission.

Written by Drake Stapleton with AIEN agents. Apache License 2.0.
